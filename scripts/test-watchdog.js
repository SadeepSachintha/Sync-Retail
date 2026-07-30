/**
 * Sync Retail POS - Database Watchdog Integrity Integration Test
 * Asserts corrupted files are isolated and resynced cleanly.
 */

const fs = require('fs');
const path = require('path');

const LOCAL_POS_URL = 'http://localhost:3000';
const DATA_DIR = path.join(__dirname, '..', 'local-pos', 'data');

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
  log('   STARTING SQLITE INTEGRITY WATCHDOG TEST SUITE  ', BLUE);
  log('==================================================', BLUE);

  try {
    // 1. Audit files in data folder
    log('\n1. Auditing data directory for isolated corrupted databases...', BLUE);
    const files = fs.readdirSync(DATA_DIR);
    const corruptedFiles = files.filter(f => f.includes('local_pos.sqlite.corrupted-'));
    
    log(`Found corrupted backups: ${JSON.stringify(corruptedFiles)}`, YELLOW);
    await assert(corruptedFiles.length > 0, 'At least one corrupted database file was isolated and renamed.');

    // 2. Verify new main database file is created
    log('\n2. Verifying a new database file was initialized...', BLUE);
    const hasMainDb = fs.existsSync(path.join(DATA_DIR, 'local_pos.sqlite'));
    await assert(hasMainDb, 'New healthy "local_pos.sqlite" initialized on restart.');

    // 3. Query local API with retries to verify products have synced back
    log('\n3. Verifying self-healing sync (downloading catalog from cloud)...', BLUE);
    let synced = false;
    let retries = 10;
    
    while (retries > 0) {
      try {
        log(`Checking local POS products (Retries left: ${retries})...`, YELLOW);
        const res = await fetch(`${LOCAL_POS_URL}/api/products`);
        if (res.ok) {
          const products = await res.json();
          if (products.length > 0) {
            log(`Successfully recovered catalog. Synced product count: ${products.length}`, GREEN);
            synced = true;
            break;
          }
        }
      } catch (err) {
        // POS server might still be booting up, wait and retry
      }
      retries--;
      await new Promise(r => setTimeout(r, 1500));
    }

    await assert(synced, 'Database self-healed and successfully downloaded fresh product listings from the cloud.');

    log('\n==================================================', GREEN);
    log('   INTEGRITY WATCHDOG DIAGNOSTICS SUCCESSFUL!     ', GREEN);
    log('==================================================', GREEN);

  } catch (error) {
    log('\n==================================================', RED);
    log(`   WATCHDOG TESTS FAILED: ${error.message}        `, RED);
    log('==================================================', RED);
    process.exit(1);
  }
}

runTest();
