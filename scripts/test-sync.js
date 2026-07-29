/**
 * Sync Retail POS - End-to-End API Integration Sync & Shift Test
 * Run this script to verify offline checkout queuing, shift gate security, and cloud reconciliation.
 */

const LOCAL_POS_URL = 'http://localhost:3000';
const CLOUD_SERVER_URL = 'http://localhost:4000';

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
  log('   STARTING SYNC RETAIL INTEGRATION TEST LOGIC    ', BLUE);
  log('==================================================', BLUE);

  try {
    // 0. Ensure no shift is open (close active shift if exists)
    log('\n0. Checking for open shift and resetting...', BLUE);
    try {
      const closeRes = await fetch(`${LOCAL_POS_URL}/api/shifts/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual_cash: 5000 })
      });
      if (closeRes.ok) {
        log('Closed previously left-open shift.', YELLOW);
      }
    } catch (_) {}

    // 1. Set Local POS to ONLINE and check shift gate blockage
    log('\n1. Setting POS to ONLINE and verifying shift gate block...', BLUE);
    let netRes = await fetch(`${LOCAL_POS_URL}/api/sim-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: false })
    });
    let netData = await netRes.json();
    await assert(netData.simulatedOffline === false, 'POS simulated connection is ONLINE.');

    // Try checking out cart (should fail with 400 because no shift is open)
    const salePayload = {
      items: [
        { productId: 1, name: "Organic Coffee Beans (500g)", price: 15.99, quantity: 2 }
      ],
      paymentMethod: 'Card',
      totalAmount: 35.18
    };

    const blockedRes = await fetch(`${LOCAL_POS_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(salePayload)
    });
    await assert(blockedRes.status === 400, `Checkout blocked before opening shift. (Response code: ${blockedRes.status})`);
    const blockedData = await blockedRes.json();
    log(`Blocked error message: "${blockedData.error}"`, YELLOW);

    // 2. Open register shift with starting cash float
    log('\n2. Opening register shift with Rs. 5,000 float...', BLUE);
    const openRes = await fetch(`${LOCAL_POS_URL}/api/shifts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opening_float: 5000 })
    });
    const openData = await openRes.json();
    await assert(openData.status === 'success', 'Open shift command succeeded.');
    await assert(openData.data.opening_float === 5000, 'Starting cash float set to Rs. 5,000.');

    // 3. Set network to OFFLINE
    log('\n3. Toggling network connection to OFFLINE...', BLUE);
    netRes = await fetch(`${LOCAL_POS_URL}/api/sim-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: true })
    });
    netData = await netRes.json();
    await assert(netData.simulatedOffline === true, 'POS simulated connection set to OFFLINE.');

    // 4. Perform an offline transaction (should succeed now!)
    log('\n4. Creating an offline transaction under active shift...', BLUE);
    const saleRes = await fetch(`${LOCAL_POS_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(salePayload)
    });
    const saleData = await saleRes.json();
    await assert(saleData.id !== undefined, 'Offline transaction recorded in SQLite.');
    await assert(saleData.shiftId === openData.data.id, 'Transaction linked to active shift ID.');
    const testSaleId = saleData.id;
    log(`Offline Transaction ID: ${testSaleId}`, YELLOW);

    // Verify unsynced queue count incremented
    let statusRes = await fetch(`${LOCAL_POS_URL}/api/sync/status`);
    let statusData = await statusRes.json();
    await assert(statusData.unsyncedCount > 0, `Local queue count incremented. Current queue: ${statusData.unsyncedCount}`);

    // 5. Verify cloud server has NOT received the transaction
    log('\n5. Verifying transaction is NOT present on the Cloud database...', BLUE);
    const cloudSalesRes = await fetch(`${CLOUD_SERVER_URL}/api/admin/sales`);
    const cloudSales = await cloudSalesRes.json();
    const foundInCloudBefore = cloudSales.some(s => s.id === testSaleId);
    await assert(foundInCloudBefore === false, 'Cloud database correctly does not contain the transaction.');

    // 6. Set network to ONLINE
    log('\n6. Toggling network connection back to ONLINE...', BLUE);
    netRes = await fetch(`${LOCAL_POS_URL}/api/sim-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: false })
    });
    netData = await netRes.json();
    await assert(netData.simulatedOffline === false, 'POS simulated connection restored to ONLINE.');

    // 7. Manually trigger synchronization
    log('\n7. Triggering synchronization worker...', BLUE);
    const syncRes = await fetch(`${LOCAL_POS_URL}/api/sync/trigger`, { method: 'POST' });
    const syncData = await syncRes.json();
    await assert(syncData.success === true, 'Sync request completed successfully.');

    // Assert queue is now empty
    statusRes = await fetch(`${LOCAL_POS_URL}/api/sync/status`);
    statusData = await statusRes.json();
    await assert(statusData.unsyncedCount === 0, 'Local SQLite queue is empty.');

    // 8. Assert transaction is now present in PostgreSQL cloud server
    log('\n8. Verifying transaction has synchronized and exists in Postgres...', BLUE);
    const cloudSalesResAfter = await fetch(`${CLOUD_SERVER_URL}/api/admin/sales`);
    const cloudSalesAfter = await cloudSalesResAfter.json();
    const syncedSale = cloudSalesAfter.find(s => s.id === testSaleId);
    await assert(syncedSale !== undefined, 'Transaction found in cloud PostgreSQL logs.');
    await assert(parseFloat(syncedSale.total_amount) === 35.18, 'Reconciled amounts matched (Rs. 35.18).');

    // 9. Close shift and reconcile cash drawer
    log('\n9. Closing register shift & auditing cash drawer...', BLUE);
    const closeRes = await fetch(`${LOCAL_POS_URL}/api/shifts/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual_cash: 5000 }) // Expected cash is 5000 since card sales do not add cash to drawer
    });
    const closeData = await closeRes.json();
    await assert(closeData.status === 'success', 'Close shift command succeeded.');
    await assert(closeData.data.expected_cash === 5000, 'Expected closing cash evaluated to Rs. 5,000.');
    await assert(closeData.data.discrepancy === 0, 'Shift discrepancy evaluated to Rs. 0.00 (Reconciliation perfect).');
    await assert(closeData.data.card_sales === 35.18, 'Shift recorded Rs. 35.18 in credit card transactions.');

    log('\n==================================================', GREEN);
    log('   ALL E2E ENHANCEMENTS TESTS PASSED!             ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   TEST FAILED: ${error.message}                 `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
