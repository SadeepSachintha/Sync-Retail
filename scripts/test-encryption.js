/**
 * Sync Retail POS - Local SQLite Column-Level Encryption at Rest Test
 * Directly inspects the raw SQLite database file to verify columns are encrypted at rest.
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
  log('   STARTING SQLITE ENCRYPTION-AT-REST DIAGNOSTICS ', BLUE);
  log('==================================================', BLUE);

  try {
    // 1. Re-open shift to generate a transaction if not already present
    log('\n1. Creating test encrypted transaction via POS API...', BLUE);
    
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

    // Checkout test sale
    const checkoutRes = await fetch(`${LOCAL_POS_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: 1, name: "Organic Coffee Beans (500g)", price: 150, quantity: 2 }],
        paymentMethod: 'Cash',
        totalAmount: 330.00
      })
    });
    await assert(checkoutRes.ok, 'POS Checkout accepted.');
    const saleData = await checkoutRes.json();
    log(`Created transaction: ${saleData.id}`, YELLOW);

    // 2. Open SQLite Database file directly in Node
    log('\n2. Opening raw SQLite database file directly (bypassing APIs)...', BLUE);
    const db = await open({
      filename: DB_FILE_PATH,
      driver: sqlite3.Database
    });
    await assert(db !== undefined, 'SQLite database file opened successfully.');

    // 3. Inspect register_shifts table
    log('\n3. Inspecting "register_shifts" table columns at rest...', BLUE);
    const shift = await db.get('SELECT * FROM register_shifts WHERE status = "open" LIMIT 1');
    log(`Raw stored opening_float column value: "${shift.opening_float}"`, YELLOW);
    
    // Assert value is encrypted (format: hex_iv:hex_ciphertext)
    await assert(shift.opening_float.includes(':'), 'opening_float column contains IV separator (":").');
    await assert(isNaN(Number(shift.opening_float)), 'opening_float fails float casting (secured as ciphertext string).');

    // 4. Inspect sales table
    log('\n4. Inspecting "sales" table columns at rest...', BLUE);
    const sale = await db.get('SELECT * FROM sales WHERE id = ?', [saleData.id]);
    log(`Raw stored total_amount column value: "${sale.total_amount}"`, YELLOW);
    log(`Raw stored payment_method column value: "${sale.payment_method}"`, YELLOW);
    
    await assert(sale.total_amount.includes(':'), 'total_amount column contains IV separator (":").');
    await assert(sale.payment_method.includes(':'), 'payment_method column contains IV separator (":").');
    await assert(isNaN(Number(sale.total_amount)), 'total_amount fails float casting (secured as ciphertext string).');

    // 5. Inspect sale_items table
    log('\n5. Inspecting "sale_items" table columns at rest...', BLUE);
    const item = await db.get('SELECT * FROM sale_items WHERE sale_id = ? LIMIT 1', [saleData.id]);
    log(`Raw stored unit_price column value: "${item.unit_price}"`, YELLOW);
    log(`Raw stored quantity column value: "${item.quantity}"`, YELLOW);

    await assert(item.unit_price.includes(':'), 'unit_price column contains IV separator (":").');
    await assert(item.quantity.includes(':'), 'quantity column contains IV separator (":").');

    await db.close();

    log('\n==================================================', GREEN);
    log('   SQLITE ENCRYPTION-AT-REST DIAGNOSTICS PASSED!   ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   ENCRYPTION TESTS FAILED: ${error.message}      `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
