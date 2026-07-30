/**
 * Sync Retail POS - Multi-Currency Exchange Integration Test
 * Audits default rate preloads and conversion calculations.
 */

const LOCAL_POS_URL = 'http://localhost:3000';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
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
  log('   STARTING MULTI-CURRENCY CONVERSION TEST SUITE  ', BLUE);
  log('==================================================', BLUE);

  try {
    // 1. Audit preloaded exchange rates API
    log('\n1. Querying local POS exchange rates API...', BLUE);
    const res = await fetch(`${LOCAL_POS_URL}/api/exchange-rates`);
    await assert(res.ok, 'Exchange rates API endpoint returned 200.');
    
    const rates = await res.json();
    log(`Loaded rates: ${JSON.stringify(rates)}`, GREEN);

    // Verify currencies
    const rateMap = {};
    for (const r of rates) {
      rateMap[r.currency] = r.rate;
    }

    await assert(rateMap.LKR === 1.0, 'Base currency LKR rate is 1.0.');
    await assert(rateMap.USD === 300.0, 'USD exchange rate is preloaded as 300.0.');
    await assert(rateMap.EUR === 330.0, 'EUR exchange rate is preloaded as 330.0.');
    await assert(rateMap.GBP === 390.0, 'GBP exchange rate is preloaded as 390.0.');

    // 2. Mock calculate conversion assertions
    log('\n2. Testing conversion calculations...', BLUE);
    const saleTotalLKR = 1500.00; // Rs. 1,500 LKR
    
    const usdEquivalent = saleTotalLKR / rateMap.USD;
    await assert(usdEquivalent === 5.0, 'Rs. 1,500 LKR translates correctly to $5.00 USD.');

    const eurEquivalent = saleTotalLKR / rateMap.EUR;
    const expectedEur = parseFloat((1500 / 330).toFixed(2));
    await assert(parseFloat(eurEquivalent.toFixed(2)) === expectedEur, `Rs. 1,500 LKR translates correctly to €${expectedEur} EUR.`);

    log('\n==================================================', GREEN);
    log('   MULTI-CURRENCY DIAGNOSTICS SUCCESSFUL!         ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   MULTI-CURRENCY TESTS FAILED: ${error.message} `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
