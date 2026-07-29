import express from 'express';
import cors from 'cors';
import { getDb } from './db.js';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
const CLOUD_SERVER_URL = process.env.CLOUD_SERVER_URL || 'http://localhost:4000';
const REGISTER_ID = process.env.REGISTER_ID || 'REG-01';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Simulated network state
let simulatedOffline = false;
let syncLogs = [];

function addSyncLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  syncLogs.unshift({ timestamp, message, type });
  if (syncLogs.length > 50) syncLogs.pop();
}

// POS Endpoints

// Get local catalog
app.get('/api/products', async (req, res) => {
  try {
    const db = await getDb();
    const products = await db.all('SELECT * FROM products');
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process a POS transaction locally (offline-first)
app.post('/api/sales', async (req, res) => {
  const { items, paymentMethod, totalAmount } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  try {
    const db = await getDb();
    const saleId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // SQLite Transaction
    await db.run('BEGIN TRANSACTION;');

    // Insert sale metadata
    await db.run(
      'INSERT INTO sales (id, register_id, total_amount, payment_method, created_at, synced) VALUES (?, ?, ?, ?, ?, 0)',
      [saleId, REGISTER_ID, totalAmount, paymentMethod, createdAt]
    );

    // Insert sale items and decrement stock
    for (const item of items) {
      await db.run(
        'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [saleId, item.productId, item.quantity, item.price]
      );

      // Decrement stock in SQLite
      await db.run(
        'UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?',
        [item.quantity, item.productId]
      );
    }

    await db.run('COMMIT;');

    addSyncLog(`Sale created locally: ${saleId.slice(0,8)}... Total: $${totalAmount}`, 'info');

    res.status(201).json({
      id: saleId,
      registerId: REGISTER_ID,
      totalAmount,
      paymentMethod,
      createdAt,
      synced: 0
    });
  } catch (error) {
    try {
      const db = await getDb();
      await db.run('ROLLBACK;');
    } catch (_) {}
    res.status(500).json({ error: error.message });
  }
});

// Get sync status
app.get('/api/sync/status', async (req, res) => {
  try {
    const db = await getDb();
    const unsyncedCount = await db.get('SELECT COUNT(*) as count FROM sales WHERE synced = 0');
    res.json({
      registerId: REGISTER_ID,
      unsyncedCount: unsyncedCount.count,
      simulatedOffline,
      syncLogs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Configure simulated network status
app.post('/api/sim-network', (req, res) => {
  const { offline } = req.body;
  if (typeof offline !== 'boolean') {
    return res.status(400).json({ error: "Invalid body. 'offline' boolean required." });
  }
  simulatedOffline = offline;
  addSyncLog(`Simulated connection: ${offline ? 'OFFLINE' : 'ONLINE'}`, offline ? 'warning' : 'success');
  res.json({ simulatedOffline });
});

// Manually trigger synchronization
app.post('/api/sync/trigger', async (req, res) => {
  if (simulatedOffline) {
    return res.status(400).json({ error: "Cannot sync while network simulation is OFFLINE" });
  }
  const syncSuccess = await syncData();
  if (syncSuccess) {
    res.json({ success: true, message: "Manual synchronization completed" });
  } else {
    res.status(503).json({ success: false, message: "Synchronization failed. Cloud server unreachable." });
  }
});

// Core Sync Logic
async function syncData() {
  if (simulatedOffline) return false;

  try {
    const db = await getDb();

    // 1. Sync Sales (Local SQLite -> Cloud PG)
    const unsyncedSales = await db.all('SELECT * FROM sales WHERE synced = 0');
    
    if (unsyncedSales.length > 0) {
      // Gather full transaction detail (sales + items)
      const salesPayload = [];
      for (const sale of unsyncedSales) {
        const items = await db.all('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
        salesPayload.push({
          ...sale,
          items: items.map(i => ({
            productId: i.product_id,
            quantity: i.quantity,
            unitPrice: i.unit_price
          }))
        });
      }

      addSyncLog(`Attempting to sync ${unsyncedSales.length} transaction(s)...`, 'info');

      // Send to central cloud API
      const syncResponse = await fetch(`${CLOUD_SERVER_URL}/api/sync/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registerId: REGISTER_ID, sales: salesPayload })
      });

      if (!syncResponse.ok) {
        throw new Error(`Cloud server returned ${syncResponse.status}`);
      }

      const syncResult = await syncResponse.json();

      // Mark local sales as synced
      const now = new Date().toISOString();
      for (const sale of unsyncedSales) {
        await db.run(
          'UPDATE sales SET synced = 1, synced_at = ? WHERE id = ?',
          [now, sale.id]
        );
      }
      addSyncLog(`Successfully synchronized ${unsyncedSales.length} transaction(s) to cloud!`, 'success');
    }

    // 2. Sync Catalog (Cloud PG -> Local SQLite)
    const catalogResponse = await fetch(`${CLOUD_SERVER_URL}/api/sync/catalog`);
    if (catalogResponse.ok) {
      const cloudProducts = await catalogResponse.json();
      
      for (const cp of cloudProducts) {
        // Calculate adjusted stock to avoid overwriting pending local sales stock level
        const pendingQtyRow = await db.get(
          `SELECT SUM(si.quantity) as qty 
           FROM sale_items si 
           JOIN sales s ON s.id = si.sale_id 
           WHERE si.product_id = ? AND s.synced = 0`,
          [cp.id]
        );
        const pendingQty = pendingQtyRow.qty || 0;
        const adjustedStock = cp.stock_quantity - pendingQty;

        // Upsert product locally
        const existing = await db.get('SELECT id FROM products WHERE id = ?', [cp.id]);
        if (existing) {
          await db.run(
            `UPDATE products 
             SET name = ?, sku = ?, price = ?, stock_quantity = ?, updated_at = ? 
             WHERE id = ?`,
            [cp.name, cp.sku, cp.price, adjustedStock, cp.updated_at, cp.id]
          );
        } else {
          await db.run(
            `INSERT INTO products (id, name, sku, price, stock_quantity, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [cp.id, cp.name, cp.sku, cp.price, adjustedStock, cp.updated_at]
          );
        }
      }
      // Keep local products that are not present in cloud (if any, but cloud is source of truth)
    }

    return true;
  } catch (error) {
    addSyncLog(`Sync Failed: ${error.message}`, 'error');
    return false;
  }
}

// Background sync loop
setInterval(async () => {
  await syncData();
}, 5000);

app.listen(PORT, () => {
  console.log(`Local POS Server running on port ${PORT}`);
  addSyncLog(`Register started. Register ID: ${REGISTER_ID}`, 'success');
});
