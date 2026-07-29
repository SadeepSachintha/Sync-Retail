import express from 'express';
import cors from 'cors';
import { getDb } from './db.js';
import crypto from 'crypto';
import { encrypt, decrypt } from './crypto.js';

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
      // Decrypt values for client views
      const decryptedShift = {
        ...activeShift,
        opening_float: decrypt(activeShift.opening_float),
        closing_cash: decrypt(activeShift.closing_cash),
        actual_cash: decrypt(activeShift.actual_cash),
        discrepancy: decrypt(activeShift.discrepancy)
      };
      res.json({ status: 'success', data: decryptedShift });
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
    const activeShift = await db.get("SELECT id, opening_float FROM register_shifts WHERE status = 'open' LIMIT 1");
    if (!activeShift) {
      return res.status(404).json({ status: 'error', message: 'No active shift found' });
    }

    // Query sales and decrypt in-memory to accumulate aggregates
    const sales = await db.all("SELECT total_amount, payment_method FROM sales WHERE shift_id = ?", [activeShift.id]);
    
    let cash = 0;
    let card = 0;
    let mobile = 0;
    for (const s of sales) {
      const amt = decrypt(s.total_amount);
      const method = decrypt(s.payment_method);
      if (method === 'Cash') cash += amt;
      else if (method === 'Card') card += amt;
      else if (method === 'Mobile') mobile += amt;
    }

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
    // Encrypt opening float at rest
    const encryptedFloat = encrypt(opening_float);
    const result = await db.run(
      'INSERT INTO register_shifts (register_id, opening_float, opened_at, status) VALUES (?, ?, ?, ?)',
      [REGISTER_ID, encryptedFloat, openedAt, 'open']
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

    // Query sales and decrypt in-memory to compile reconciliation audit
    const sales = await db.all("SELECT total_amount, payment_method FROM sales WHERE shift_id = ?", [activeShift.id]);
    
    let cashSales = 0;
    let cardSales = 0;
    let mobileSales = 0;
    for (const s of sales) {
      const amt = decrypt(s.total_amount);
      const method = decrypt(s.payment_method);
      if (method === 'Cash') cashSales += amt;
      else if (method === 'Card') cardSales += amt;
      else if (method === 'Mobile') mobileSales += amt;
    }

    const decryptedOpeningFloat = decrypt(activeShift.opening_float);
    const expectedClosingCash = decryptedOpeningFloat + cashSales;
    const discrepancy = actual_cash - expectedClosingCash;
    const closedAt = new Date().toISOString();

    // Encrypt summary variables at rest
    const encryptedExpected = encrypt(expectedClosingCash);
    const encryptedActual = encrypt(actual_cash);
    const encryptedDiscrepancy = encrypt(discrepancy);

    await db.run(
      `UPDATE register_shifts 
       SET closing_cash = ?, actual_cash = ?, discrepancy = ?, closed_at = ?, status = 'closed' 
       WHERE id = ?`,
      [encryptedExpected, encryptedActual, encryptedDiscrepancy, closedAt, activeShift.id]
    );

    addSyncLog(`Register Shift Closed. Discrepancy: Rs. ${discrepancy.toFixed(2)}`, discrepancy === 0 ? 'success' : 'warning');

    res.json({
      status: 'success',
      data: {
        id: activeShift.id,
        opening_float: decryptedOpeningFloat,
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

// Process a POS transaction locally (offline-first) with Column-Level Encryption at Rest
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

    // Insert sale metadata (encrypted fields: total_amount, payment_method)
    const encryptedTotal = encrypt(totalAmount);
    const encryptedMethod = encrypt(paymentMethod);
    await db.run(
      'INSERT INTO sales (id, register_id, total_amount, payment_method, created_at, synced, shift_id) VALUES (?, ?, ?, ?, ?, 0, ?)',
      [saleId, REGISTER_ID, encryptedTotal, encryptedMethod, createdAt, activeShift.id]
    );

    // Insert sale items (encrypted fields: quantity, unit_price)
    for (const item of items) {
      const encryptedQty = encrypt(item.quantity);
      const encryptedPrice = encrypt(item.price);
      await db.run(
        'INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
        [saleId, item.productId, encryptedQty, encryptedPrice]
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
      // Gather full transaction detail (sales + items) - Decrypting payloads for cloud Central
      const salesPayload = [];
      for (const sale of unsyncedSales) {
        const items = await db.all('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
        salesPayload.push({
          id: sale.id,
          total_amount: decrypt(sale.total_amount),
          payment_method: decrypt(sale.payment_method),
          created_at: sale.created_at,
          items: items.map(i => ({
            productId: i.product_id,
            quantity: decrypt(i.quantity),
            unitPrice: decrypt(i.unit_price)
          }))
        });
      }

      addSyncLog(`Attempting to sync ${unsyncedSales.length} transaction(s)...`, 'info');

      // Send decrypted JSON payload to central cloud API
      const syncResponse = await fetch(`${CLOUD_SERVER_URL}/api/sync/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registerId: REGISTER_ID, sales: salesPayload })
      });

      if (!syncResponse.ok) {
        throw new Error(`Cloud server returned ${syncResponse.status}`);
      }

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

    // 2. Sync Catalog (Cloud PG -> Local SQLite) - Incremental Timestamp Replication
    const lastUpdatedRow = await db.get('SELECT MAX(updated_at) as last_updated FROM products');
    const since = lastUpdatedRow ? lastUpdatedRow.last_updated : null;
    const catalogUrl = `${CLOUD_SERVER_URL}/api/sync/catalog` + (since ? `?since=${encodeURIComponent(since)}` : '');

    const catalogResponse = await fetch(catalogUrl);
    if (catalogResponse.ok) {
      const cloudProducts = await catalogResponse.json();
      
      if (cloudProducts.length > 0) {
        addSyncLog(`Received catalog updates for ${cloudProducts.length} product(s).`, 'info');
        
        for (const cp of cloudProducts) {
          // Decrypt pending quantities in-memory to calculate adjusted local stock levels accurately
          const pendingQtyRows = await db.all(
            `SELECT si.quantity 
             FROM sale_items si 
             JOIN sales s ON s.id = si.sale_id 
             WHERE si.product_id = ? AND s.synced = 0`,
            [cp.id]
          );
          
          let pendingQty = 0;
          for (const pr of pendingQtyRows) {
            pendingQty += decrypt(pr.quantity);
          }
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
      }
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
