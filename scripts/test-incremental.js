/**
 * Sync Retail POS - Incremental Replication E2E Integration Test
 * Verifies that the client requests only changed catalog products using updated_at filters.
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
  log('   STARTING INCREMENTAL SYNC REPLICATION TESTS   ', BLUE);
  log('==================================================', BLUE);

  try {
    // 1. Trigger sync to ensure databases are fully aligned
    log('\n1. Alignment handshake: Forcing catalog sync...', BLUE);
    const syncRes = await fetch(`${LOCAL_POS_URL}/api/sync/trigger`, { method: 'POST' });
    await assert(syncRes.ok, 'Sync handshake succeeded.');

    // 2. Query Local POS for the maximum updated_at timestamp
    log('\n2. Retrieving maximum local product timestamp...', BLUE);
    const posProductsRes = await fetch(`${LOCAL_POS_URL}/api/products`);
    const posProducts = await posProductsRes.json();
    await assert(posProducts.length > 0, `Local database contains ${posProducts.length} product(s).`);
    
    // Find max updated_at
    const timestamps = posProducts.map(p => new Date(p.updated_at).getTime());
    const maxTime = Math.max(...timestamps);
    const maxTimestampStr = new Date(maxTime).toISOString();
    log(`Latest local catalog timestamp: "${maxTimestampStr}"`, YELLOW);

    // 3. Query Cloud Server with ?since=MAX_TIMESTAMP
    log('\n3. Querying Cloud Catalog with ?since parameter (expecting empty updates)...', BLUE);
    const cloudIncrementalRes = await fetch(`${CLOUD_SERVER_URL}/api/sync/catalog?since=${encodeURIComponent(maxTimestampStr)}`);
    const cloudIncrementalProducts = await cloudIncrementalRes.json();
    await assert(cloudIncrementalProducts.length === 0, `Replication bandwidth is zero: returned ${cloudIncrementalProducts.length} items (expected 0).`);

    // 4. Update a single product price on the Cloud Server
    log('\n4. Simulating product update on Cloud Admin Dashboard...', BLUE);
    const targetProduct = posProducts[0]; // e.g. Organic Coffee Mug or Eco care item
    const newPrice = targetProduct.price + 150; // increment price by Rs. 150
    log(`Updating Product "${targetProduct.name}" (SKU: ${targetProduct.sku}) price from Rs. ${targetProduct.price} -> Rs. ${newPrice}`, YELLOW);
    
    const updateRes = await fetch(`${CLOUD_SERVER_URL}/api/admin/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: targetProduct.id,
        name: targetProduct.name,
        sku: targetProduct.sku,
        price: newPrice,
        stock_quantity: targetProduct.stock_quantity // keep stock same
      })
    });
    await assert(updateRes.ok, 'Cloud product update accepted.');
    const updatedCloudProduct = await updateRes.json();
    log(`Cloud product updated_at set to: "${updatedCloudProduct.updated_at}"`, YELLOW);

    // 5. Query Cloud Server again with since filter
    log('\n5. Re-querying Cloud Catalog with since filter (expecting exactly 1 modified item)...', BLUE);
    const cloudIncrementalRes2 = await fetch(`${CLOUD_SERVER_URL}/api/sync/catalog?since=${encodeURIComponent(maxTimestampStr)}`);
    const cloudIncrementalProducts2 = await cloudIncrementalRes2.json();
    await assert(cloudIncrementalProducts2.length === 1, `Incremental sync returned exactly ${cloudIncrementalProducts2.length} item.`);
    await assert(cloudIncrementalProducts2[0].id === targetProduct.id, 'Returned item ID matches updated product.');
    await assert(parseFloat(cloudIncrementalProducts2[0].price) === newPrice, `Price field correctly matched updated value: Rs. ${cloudIncrementalProducts2[0].price}`);

    // 6. Trigger sync on local POS
    log('\n6. Running local sync to pull catalog modifications...', BLUE);
    const syncRes2 = await fetch(`${LOCAL_POS_URL}/api/sync/trigger`, { method: 'POST' });
    await assert(syncRes2.ok, 'Sync completed.');

    // 7. Verify local database was updated
    log('\n7. Auditing local SQLite database for updated pricing...', BLUE);
    const posProductsRes2 = await fetch(`${LOCAL_POS_URL}/api/products`);
    const posProducts2 = await posProductsRes2.json();
    const localProductAfter = posProducts2.find(p => p.id === targetProduct.id);
    await assert(localProductAfter !== undefined, 'Updated product is present in local database.');
    await assert(parseFloat(localProductAfter.price) === newPrice, `Local price successfully synced to: Rs. ${localProductAfter.price}`);

    log('\n==================================================', GREEN);
    log('   INCREMENTAL SYNC REPLICATION TESTS PASSED!      ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   INCREMENTAL SYNC TESTS FAILED: ${error.message} `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
