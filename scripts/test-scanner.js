/**
 * Sync Retail POS - Barcode Interceptor Timing Unit Test
 * Validates that the keyboard emulation parser separates human keystrokes from fast laser hardware inputs.
 */

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let mockToastMsg = '';
let cartAddedId = null;

// Mock products catalog
const mockProducts = [
  { id: 101, sku: 'COF-ORG-500', name: 'Organic Coffee Beans' },
  { id: 102, sku: 'SOU-MAG-01', name: 'Ceramic Magnet Souvenir' }
];

// Parser state variables (exact mirror of app.js)
let barcodeBuffer = '';
let lastKeyTime = 0;

function showToast(msg) {
  mockToastMsg = msg;
}

function addToCart(id) {
  cartAddedId = id;
}

// Interceptor logic
function handleKeystroke(key, timestamp) {
  const timeDiff = timestamp - lastKeyTime;
  lastKeyTime = timestamp;

  if (timeDiff < 40) {
    if (key === 'Enter') {
      if (barcodeBuffer.length > 2) {
        addSkuByBarcode(barcodeBuffer.trim());
      }
      barcodeBuffer = '';
      return true; // Intercepted
    } else if (key.length === 1) {
      barcodeBuffer += key;
    }
  } else {
    // Slow typing, reset buffer
    barcodeBuffer = key.length === 1 ? key : '';
  }
  return false;
}

function addSkuByBarcode(barcode) {
  const cleanBarcode = barcode.toUpperCase().trim();
  const product = mockProducts.find(p => p.sku.toUpperCase() === cleanBarcode);
  if (product) {
    addToCart(product.id);
    showToast(`Scanned: ${product.name}`);
  } else {
    showToast(`Unknown SKU: ${barcode}`);
  }
}

async function runTests() {
  console.log('==================================================');
  console.log('   RUNNING BARCODE SCANNER TIMING ALGORITHM TESTS ');
  console.log('==================================================');

  // Test Case 1: Simulate Rapid Keystrokes (Hardware Scan)
  console.log('\nTest Case 1: Simulating Hardware Laser Scan (COF-ORG-500, 10ms intervals)...');
  barcodeBuffer = '';
  lastKeyTime = Date.now() - 5000; // start fresh
  
  const scanSequence = ['C', 'O', 'F', '-', 'O', 'R', 'G', '-', '5', '0', '0', 'Enter'];
  let simulatedTime = Date.now();
  let intercepted = false;

  for (const char of scanSequence) {
    simulatedTime += 12; // 12ms delay
    const result = handleKeystroke(char, simulatedTime);
    if (char === 'Enter') intercepted = result;
  }

  if (intercepted && cartAddedId === 101 && mockToastMsg.includes('Organic Coffee')) {
    console.log(`${GREEN}[PASS] Hardware laser scan successfully parsed and matched product!${RESET}`);
  } else {
    console.log(`${RED}[FAIL] Hardware laser scan failed. Intercepted: ${intercepted}, CartId: ${cartAddedId}${RESET}`);
    process.exit(1);
  }

  // Test Case 2: Simulate Slow Keystrokes (Human Cashier Typing)
  console.log('\nTest Case 2: Simulating Human Cashier typing SKU slowly (300ms intervals)...');
  cartAddedId = null;
  mockToastMsg = '';
  barcodeBuffer = '';
  lastKeyTime = Date.now() - 5000;

  const humanSequence = ['C', 'O', 'F', '-', 'O', 'R', 'G', '-', '5', '0', '0', 'Enter'];
  simulatedTime = Date.now();
  intercepted = false;

  for (const char of humanSequence) {
    simulatedTime += 300; // 300ms delay (human typing speed)
    const result = handleKeystroke(char, simulatedTime);
    if (char === 'Enter') intercepted = result;
  }

  if (!intercepted && cartAddedId === null) {
    console.log(`${GREEN}[PASS] Human slow keypresses successfully bypassed parser (no fake scanning triggered).${RESET}`);
  } else {
    console.log(`${RED}[FAIL] Human keypresses incorrectly triggered scanning parser!${RESET}`);
    process.exit(1);
  }

  console.log('\n==================================================');
  console.log(`   ALL TIMING DIAGNOSTICS TESTS PASSED! `);
  console.log('==================================================');
}

runTests();
