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

// Get active register shift
app.get('/api/shifts/active', async (req, res) => {
  try {
    const db = await getDb();
    const activeShift = await db.get("SELECT * FROM register_shifts WHERE status = 'open' LIMIT 1");
    if (activeShift) {
      res.json({ status: 'success', data: activeShift });
    } else {
      res.status(404).json({ status: 'error', message: 'No active shift found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get expected running totals for active register shift
app.get('/api/shifts/active/totals', async (req, res) => {
  try {
    const db = await getDb();
    const activeShift = await db.get("SELECT id FROM register_shifts WHERE status = 'open' LIMIT 1");
    if (!activeShift) {
      return res.status(404).json({ status: 'error', message: 'No active shift found' });
    }

    const cashRow = await db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE shift_id = ? AND payment_method = 'Cash'", [activeShift.id]);
    const cardRow = await db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE shift_id = ? AND payment_method = 'Card'", [activeShift.id]);
    const mobileRow = await db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE shift_id = ? AND payment_method = 'Mobile'", [activeShift.id]);

    const cash = cashRow.total;
    const card = cardRow.total;
    const mobile = mobileRow.total;

    res.json({
      status: 'success',
      cash_sales: cash,
      card_sales: card,
      mobile_sales: mobile,
      total_sales: cash + card + mobile
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Open a new register shift
app.post('/api/shifts/open', async (req, res) => {
  const { opening_float } = req.body;
  try {
    const db = await getDb();
    const activeShift = await db.get("SELECT id FROM register_shifts WHERE status = 'open' LIMIT 1");
    if (activeShift) {
      return res.status(400).json({ status: 'error', message: 'A register shift is already open' });
    }

    const openedAt = new Date().toISOString();
    const result = await db.run(
      'INSERT INTO register_shifts (register_id, opening_float, opened_at, status) VALUES (?, ?, ?, ?)',
      [REGISTER_ID, opening_float, openedAt, 'open']
    );

    addSyncLog(`Register Shift Opened with float: Rs. ${opening_float}`, 'success');
    res.json({
      status: 'success',
      data: { id: result.lastID, register_id: REGISTER_ID, opening_float, opened_at: openedAt, status: 'open' }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Close active register shift and return reconciliation totals
app.post('/api/shifts/close', async (req, res) => {
  const { actual_cash } = req.body;
  try {
    const db = await getDb();
    const activeShift = await db.get("SELECT * FROM register_shifts WHERE status = 'open' LIMIT 1");
    if (!activeShift) {
      return res.status(404).json({ status: 'error', message: 'No active register shift to close' });
    }

    // Expected totals calculation
    const cashSalesRow = await db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE shift_id = ? AND payment_method = 'Cash'", [activeShift.id]);
    const cardSalesRow = await db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE shift_id = ? AND payment_method = 'Card'", [activeShift.id]);
    const mobileSalesRow = await db.get("SELECT COALESCE(SUM(total_amount), 0) as total FROM sales WHERE shift_id = ? AND payment_method = 'Mobile'", [activeShift.id]);

    const cashSales = cashSalesRow.total;
    const cardSales = cardSalesRow.total;
    const mobileSales = mobileSalesRow.total;

    const expectedClosingCash = activeShift.opening_float + cashSales;
    const discrepancy = actual_cash - expectedClosingCash;
    const closedAt = new Date().toISOString();

    await db.run(
      `UPDATE register_shifts 
       SET closing_cash = ?, actual_cash = ?, discrepancy = ?, closed_at = ?, status = 'closed' 
       WHERE id = ?`,
      [expectedClosingCash, actual_cash, discrepancy, closedAt, activeShift.id]
    );

    addSyncLog(`Register Shift Closed. Discrepancy: Rs. ${discrepancy.toFixed(2)}`, discrepancy === 0 ? 'success' : 'warning');

    res.json({
      status: 'success',
      data: {
        id: activeShift.id,
        opening_float: activeShift.opening_float,
        cash_sales: cashSales,
        card_sales: cardSales,
        mobile_sales: mobileSales,
        total_sales: cashSales + cardSales + mobileSales,
        expected_cash: expectedClosingCash,
        actual_cash: actual_cash,
        discrepancy: discrepancy,
        opened_at: activeShift.opened_at,
        closed_at: closedAt
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    
    // Shift Gate check
    const activeShift = await db.get("SELECT id FROM register_shifts WHERE status = 'open' LIMIT 1");
    if (!activeShift) {
      return res.status(400).json({ error: "Register shift is locked. You must open a shift with an initial cash float to checkout." });
    }

    const saleId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // SQLite Transaction
    await db.run('BEGIN TRANSACTION;');

    // Insert sale metadata with shift_id link
    await db.run(
      'INSERT INTO sales (id, register_id, total_amount, payment_method, created_at, synced, shift_id) VALUES (?, ?, ?, ?, ?, 0, ?)',
      [saleId, REGISTER_ID, totalAmount, paymentMethod, createdAt, activeShift.id]
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

    addSyncLog(`Sale created locally: ${saleId.slice(0,8)}... Total: Rs. ${totalAmount}`, 'info');

    res.status(201).json({
      id: saleId,
      registerId: REGISTER_ID,
      totalAmount,
      paymentMethod,
      createdAt,
      synced: 0,
      shiftId: activeShift.id
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
