/**
 * Sync Retail POS - End-to-End API Integration Sync Test
 * Run this script to verify offline checkout queuing and cloud reconciliation.
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
    // 1. Set Local POS to ONLINE and clean up/check state
    log('\n1. Setting POS to ONLINE and checking initial state...', BLUE);
    let netRes = await fetch(`${LOCAL_POS_URL}/api/sim-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: false })
    });
    let netData = await netRes.json();
    await assert(netData.simulatedOffline === false, 'POS simulated connection is ONLINE.');

    // Trigger sync to clear any previous runs
    await fetch(`${LOCAL_POS_URL}/api/sync/trigger`, { method: 'POST' });

    let statusRes = await fetch(`${LOCAL_POS_URL}/api/sync/status`);
    let statusData = await statusRes.json();
    log(`Unsynced local sales: ${statusData.unsyncedCount}`, YELLOW);

    // 2. Set network to OFFLINE
    log('\n2. Toggling network connection to OFFLINE...', BLUE);
    netRes = await fetch(`${LOCAL_POS_URL}/api/sim-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: true })
    });
    netData = await netRes.json();
    await assert(netData.simulatedOffline === true, 'POS simulated connection set to OFFLINE.');

    // 3. Perform an offline transaction
    log('\n3. Creating an offline transaction...', BLUE);
    const salePayload = {
      items: [
        { productId: 1, name: "Organic Coffee Beans (500g)", price: 15.99, quantity: 2 },
        { productId: 4, name: "Local Rainforest Honey", price: 12.50, quantity: 1 }
      ],
      paymentMethod: 'Card',
      totalAmount: 48.93 // (15.99 * 2 + 12.50) * 1.10 = 44.48 * 1.10 = 48.928
    };

    const saleRes = await fetch(`${LOCAL_POS_URL}/api/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(salePayload)
    });
    const saleData = await saleRes.json();
    await assert(saleData.id !== undefined, 'Offline transaction recorded locally in SQLite.');
    const testSaleId = saleData.id;
    log(`Offline Transaction ID: ${testSaleId}`, YELLOW);

    // 4. Verify unsynced queue count incremented
    statusRes = await fetch(`${LOCAL_POS_URL}/api/sync/status`);
    statusData = await statusRes.json();
    await assert(statusData.unsyncedCount > 0, `Local queue count incremented. Current queue: ${statusData.unsyncedCount}`);

    // 5. Verify cloud server has NOT received the transaction
    log('\n4. Verifying transaction is NOT present on the Cloud database...', BLUE);
    const cloudSalesRes = await fetch(`${CLOUD_SERVER_URL}/api/admin/sales`);
    const cloudSales = await cloudSalesRes.json();
    const foundInCloudBefore = cloudSales.some(s => s.id === testSaleId);
    await assert(foundInCloudBefore === false, 'Cloud database correctly does not contain the transaction.');

    // 6. Set network to ONLINE
    log('\n5. Toggling network connection back to ONLINE...', BLUE);
    netRes = await fetch(`${LOCAL_POS_URL}/api/sim-network`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline: false })
    });
    netData = await netRes.json();
    await assert(netData.simulatedOffline === false, 'POS simulated connection restored to ONLINE.');

    // 7. Manually trigger synchronization
    log('\n6. Triggering synchronization worker...', BLUE);
    const syncRes = await fetch(`${LOCAL_POS_URL}/api/sync/trigger`, { method: 'POST' });
    const syncData = await syncRes.json();
    await assert(syncData.success === true, 'Sync request completed successfully.');

    // 8. Assert queue is now empty
    statusRes = await fetch(`${LOCAL_POS_URL}/api/sync/status`);
    statusData = await statusRes.json();
    await assert(statusData.unsyncedCount === 0, 'Local SQLite queue is empty.');

    // 9. Assert transaction is now present in PostgreSQL cloud server
    log('\n7. Verifying transaction has synchronized and exists in Postgres...', BLUE);
    const cloudSalesResAfter = await fetch(`${CLOUD_SERVER_URL}/api/admin/sales`);
    const cloudSalesAfter = await cloudSalesResAfter.json();
    const syncedSale = cloudSalesAfter.find(s => s.id === testSaleId);
    await assert(syncedSale !== undefined, 'Transaction found in cloud PostgreSQL logs.');
    
    // Calculate latency metrics
    const latency = Math.round((new Date(syncedSale.synced_at) - new Date(syncedSale.created_at)) / 1000);
    log(`Transaction latency measured: ${latency} seconds.`, YELLOW);
    await assert(syncedSale.payment_method === 'Card', 'Transaction fields successfully reconciled (Payment Method: Card).');
    await assert(parseFloat(syncedSale.total_amount) === 48.93, 'Transaction amounts successfully reconciled (Total: $48.93).');

    log('\n==================================================', GREEN);
    log('   ALL E2E SYNCHRONIZATION TESTS PASSED!          ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   TEST FAILED: ${error.message}                 `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
