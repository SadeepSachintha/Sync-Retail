/**
 * Sync Retail POS - SQLite Database Purge & Compaction E2E Integration Test
 * Verifies that synced transactions older than the threshold are automatically purged and compacted.
 */

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');

const LOCAL_POS_URL = 'http://localhost:3000';
const DB_FILE_PATH = path.join(__dirname, '..', 'local-pos', 'data', 'local_pos.sqlite');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

async function log(msg, color = RESET) {
  console.log(`${color}${msg}${RESET}`);
}

async function assert(condition, message) {
  if (condition) {
    log(`[PASS] ${message}`, GREEN);
  } else {
    log(`[FAIL] ${message}`, RED);
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTest() {
  log('==================================================', BLUE);
  log('   STARTING SQLITE AUTO-PURGE & VACUUM COMPACTION ', BLUE);
  log('==================================================', BLUE);

  try {
    // 1. Force the database status ONLINE to allow trigger sync
    log('\n1. Setting POS connection to ONLINE...', BLUE);
    await fetch(`${LOCAL_POS_URL}/api/sim-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: false })
    });

    // Check if shift is open
    const activeShiftRes = await fetch(`${LOCAL_POS_URL}/api/shifts/active`);
    if (activeShiftRes.status === 404) {
      log('No active shift found. Opening shift with Rs. 10,000 float...', YELLOW);
      await fetch(`${LOCAL_POS_URL}/api/shifts/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opening_float: 10000 })
      });
    }

    // 2. Checkout a new transaction
    log('\n2. Creating a new checkout sale...', BLUE);
    const checkoutRes = await fetch(`${LOCAL_POS_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: 1, name: "Organic Coffee Beans (500g)", price: 150, quantity: 1 }],
        paymentMethod: 'Cash',
        totalAmount: 165.00
      })
    });
    await assert(checkoutRes.ok, 'POS Checkout accepted.');
    const saleData = await checkoutRes.json();
    log(`Created transaction ID: ${saleData.id}`, YELLOW);

    // 3. Directly verify SQLite database contains the transaction before sync
    log('\n3. Direct SQL Auditing: Verifying transaction exists locally...', BLUE);
    let db = await open({ filename: DB_FILE_PATH, driver: sqlite3.Database });
    const localSaleBefore = await db.get('SELECT COUNT(*) as count FROM sales WHERE id = ?', [saleData.id]);
    await assert(localSaleBefore.count === 1, 'Sale exists in SQLite "sales" table.');
    const localItemsBefore = await db.get('SELECT COUNT(*) as count FROM sale_items WHERE sale_id = ?', [saleData.id]);
    await assert(localItemsBefore.count === 1, 'Sale line items exist in SQLite "sale_items" table.');
    await db.close();

    // 4. Trigger sync (since we set environment PURGE_THRESHOLD_DAYS=0 on POS server restart, it will trigger immediate delete)
    log('\n4. Triggering POS cloud synchronization...', BLUE);
    const syncRes = await fetch(`${LOCAL_POS_URL}/api/sync/trigger`, { method: 'POST' });
    await assert(syncRes.ok, 'POS sync worker executed.');

    // Wait a brief moment for database compaction task to finalize file writing
    log('Waiting 1000ms for SQLite vacuum disk compaction...', YELLOW);
    await new Promise(r => setTimeout(r, 1000));

    // 5. Directly verify SQLite database has purged the synced sale (since threshold is 0 days)
    log('\n5. Direct SQL Auditing: Checking if synced sale was purged...', BLUE);
    db = await open({ filename: DB_FILE_PATH, driver: sqlite3.Database });
    const localSaleAfter = await db.get('SELECT COUNT(*) as count FROM sales WHERE id = ?', [saleData.id]);
    await assert(localSaleAfter.count === 0, 'Sale successfully deleted from local "sales" table (Purged!).');
    const localItemsAfter = await db.get('SELECT COUNT(*) as count FROM sale_items WHERE sale_id = ?', [saleData.id]);
    await assert(localItemsAfter.count === 0, 'Sale line items successfully deleted from local "sale_items" table.');
    await db.close();

    // 6. Verify sync status logs contain the vacuum notifications
    log('\n6. Checking POS sync dashboard logs...', BLUE);
    const statusRes = await fetch(`${LOCAL_POS_URL}/api/sync/status`);
    const statusData = await statusRes.json();
    const logs = statusData.syncLogs.map(l => l.message);
    
    const hasVacuumLog = logs.some(m => m.includes('vacuum') || m.includes('compaction'));
    await assert(hasVacuumLog, 'Sync logs contains database vacuum/compaction events.');

    log('\n==================================================', GREEN);
    log('   SQLITE AUTO-PURGE & VACUUM DIAGNOSTICS PASSED! ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   COMPACTION TESTS FAILED: ${error.message}      `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
