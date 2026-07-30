// State variables
let products = [];
let cart = [];
let simulatedOffline = false;
let unsyncedCount = 0;
let selectedCategory = 'all';

// Advanced POS state variables
let activeShift = null;
let discountType = 'percent'; // 'percent' or 'val'
let discountValue = 0;
let barcodeModalProduct = null;
let barcodePrintQty = 'single'; // 'single' or 'sheet'
let activeSuggestionIndex = -1;
let filteredSuggestions = [];
let vatRate = 0.10;
let oscillatorType = 'sine';
let synthPitch = 800;
let synthVolume = 0.30;
let synthDuration = 150;

// Multi-Currency rates state
let exchangeRates = { LKR: 1.0, USD: 300.0, EUR: 330.0, GBP: 390.0 };
async function fetchExchangeRates() {
  try {
    const res = await fetch('/api/exchange-rates');
    if (res.ok) {
      const data = await res.json();
      for (const r of data) {
        exchangeRates[r.currency] = r.rate;
      }
    }
  } catch (err) {
    console.warn("Could not load exchange rates:", err);
  }
}

// DOM elements
const productsGrid = document.getElementById('products-grid');
const cartItemsContainer = document.getElementById('cart-items-container');
const emptyCartState = document.getElementById('empty-cart-state');
const subtotalDisplay = document.getElementById('subtotal-display');
const taxDisplay = document.getElementById('tax-display');
const totalDisplay = document.getElementById('total-display');
const checkoutBtn = document.getElementById('checkout-btn');
const clearCartBtn = document.getElementById('clear-cart-btn');
const networkToggle = document.getElementById('network-toggle');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const unsyncedCountDisplay = document.getElementById('unsynced-count');
const syncNowBtn = document.getElementById('sync-now-btn');
const logsContainer = document.getElementById('logs-container');
const searchInput = document.getElementById('search-input');
const searchSuggestions = document.getElementById('search-suggestions');
const receiptModal = document.getElementById('receipt-modal');
const closeReceiptBtn = document.getElementById('close-receipt-btn');

// Multi-Currency Assistant DOM selectors
const checkoutCurrencySelect = document.getElementById('checkout-currency-select');
const foreignTotalRow = document.getElementById('foreign-total-row');
const foreignTotalDisplay = document.getElementById('foreign-total-display');
const multiCurrencyCalc = document.getElementById('multi-currency-calc');
const foreignPaidLabel = document.getElementById('foreign-paid-label');
const foreignPaidInput = document.getElementById('foreign-paid-input');
const lkrEquivalentPaid = document.getElementById('lkr-equivalent-paid');
const lkrChangeDue = document.getElementById('lkr-change-due');
const receiptForeignDetails = document.getElementById('receipt-foreign-details');
const receiptForeignCalc = document.getElementById('receipt-foreign-calc');
const receiptForeignChange = document.getElementById('receipt-foreign-change');

// Advanced POS DOM elements
const navPosBtn = document.getElementById('nav-pos-btn');
const navShiftBtn = document.getElementById('nav-shift-btn');
const navSettingsBtn = document.getElementById('nav-settings-btn');
const posTerminalView = document.getElementById('pos-terminal-view');
const posCartPanel = document.getElementById('pos-cart-panel');
const shiftPanelView = document.getElementById('shift-panel-view');
const settingsPanelView = document.getElementById('settings-panel-view');
const vatRateSelect = document.getElementById('vat-rate-select');
const soundOscSelect = document.getElementById('sound-osc-select');
const synthPitchInput = document.getElementById('synth-pitch');
const synthPitchVal = document.getElementById('synth-pitch-val');
const synthVolumeInput = document.getElementById('synth-volume');
const synthVolumeVal = document.getElementById('synth-volume-val');
const synthDurationInput = document.getElementById('synth-duration');
const synthDurationVal = document.getElementById('synth-duration-val');
const synthTestBtn = document.getElementById('synth-test-btn');

// Broadcast Channel API for cross-tab synchronization
const configChannel = new BroadcastChannel('pos_config_channel');
const shiftGateModal = document.getElementById('shift-gate-modal');
const openShiftForm = document.getElementById('open-shift-form');
const openingFloatInput = document.getElementById('opening-float-input');
const closeShiftModal = document.getElementById('close-shift-modal');
const closeShiftForm = document.getElementById('close-shift-form');
const actualCashInput = document.getElementById('actual-cash-input');
const closeShiftTriggerBtn = document.getElementById('close-shift-trigger-btn');
const closeShiftCancelBtn = document.getElementById('close-shift-cancel-btn');
const closeShiftAbortBtn = document.getElementById('close-shift-abort-btn');

// Shift summary displays
const shiftOpeningFloat = document.getElementById('shift-opening-float');
const shiftCashSales = document.getElementById('shift-cash-sales');
const shiftCardSales = document.getElementById('shift-card-sales');
const shiftMobileSales = document.getElementById('shift-mobile-sales');
const shiftTotalSales = document.getElementById('shift-total-sales');
const shiftOpenedTime = document.getElementById('shift-opened-time');

// Discount DOM elements
const discPercentBtn = document.getElementById('disc-percent-btn');
const discValBtn = document.getElementById('disc-val-btn');
const discountInput = document.getElementById('discount-input');
const discountSummaryRow = document.getElementById('discount-summary-row');
const discountDisplay = document.getElementById('discount-display');

// Barcode DOM elements
const barcodeModal = document.getElementById('barcode-modal');
const barcodeCloseBtn = document.getElementById('barcode-close-btn');
const barcodeModalProductName = document.getElementById('barcode-modal-product-name');
const barcodeModalProductSku = document.getElementById('barcode-modal-product-sku');
const barcodeGraphicBox = document.getElementById('barcode-graphic-box');
const printSingleBtn = document.getElementById('print-single-btn');
const printSheetBtn = document.getElementById('print-sheet-btn');
const barcodeTriggerPrintBtn = document.getElementById('barcode-trigger-print-btn');
const printBarcodeWrapper = document.getElementById('print-barcode-wrapper');
const printShiftAuditWrapper = document.getElementById('print-shift-audit-wrapper');

// ==========================================================
// 1. CLIENT-SIDE WEB AUDIO SYNTHESIZER
// ==========================================================
function playPOSSound(type) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.type = oscillatorType;
      osc.frequency.setValueAtTime(synthPitch, ctx.currentTime);
      gain.gain.setValueAtTime(synthVolume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (synthDuration / 1000));
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + (synthDuration / 1000));
    } else if (type === 'error') {
      osc.type = oscillatorType;
      osc.frequency.setValueAtTime(synthPitch / 5, ctx.currentTime);
      gain.gain.setValueAtTime(synthVolume, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + (synthDuration * 2 / 1000));
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + (synthDuration * 2 / 1000));
    } else if (type === 'trash') {
      osc.type = oscillatorType;
      osc.frequency.setValueAtTime(synthPitch, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(synthPitch / 4, ctx.currentTime + (synthDuration * 2.5 / 1000));
      gain.gain.setValueAtTime(synthVolume, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + (synthDuration * 2.5 / 1000));
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + (synthDuration * 2.5 / 1000));
    }
  } catch (err) {
    console.warn("Audio feedback block:", err);
  }
}

// ==========================================================
// 2. OFFLINE CODE39 BARCODE SVG ENCODER
// ==========================================================
function getCode39SVG(value) {
  const code3Map = {
    '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000',
    '4': '000110001', '5': '100110000', '6': '001110000', '7': '000100101',
    '8': '100100100', '9': '001100100', 'A': '100001001', 'B': '001001001',
    'C': '101001000', 'D': '000011001', 'E': '100011000', 'F': '001011000',
    'G': '000001101', 'H': '100001100', 'I': '001001100', 'J': '000011100',
    'K': '100000011', 'L': '001000011', 'M': '101000010', 'N': '000010011',
    'O': '100010010', 'P': '001010010', 'Q': '000000111', 'R': '100000110',
    'S': '001000110', 'T': '000010110', 'U': '110000001', 'V': '011000001',
    'W': '111000000', 'X': '010010001', 'Y': '110010000', 'Z': '011010000',
    '-': '010000101', '.': '110000010', ' ': '011000010', '*': '010010100',
    '$': '010101000', '/': '010100010', '+': '010001010', '%': '000101010'
  };

  if (!value) return '';
  const text = '*' + value.toUpperCase() + '*';
  let svgPaths = '';
  let x = 10;
  const height = 40;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const pattern = code3Map[char] || code3Map[' '];
    for (let j = 0; j < 9; j++) {
      const isBar = (j % 2 === 0);
      const isWide = (pattern[j] === '1');
      const width = isWide ? 3 : 1;
      if (isBar) {
        svgPaths += `<rect x="${x}" y="5" width="${width}" height="${height}" fill="black" />`;
      }
      x += width;
    }
    x += 1; // space between characters
  }

  return `<svg width="100%" height="65" viewBox="0 0 ${x + 10} 65" xmlns="http://www.w3.org/2000/svg" style="max-width:100%;">
    ${svgPaths}
    <text x="${(x + 10) / 2}" y="57" font-family="monospace" font-size="10" text-anchor="middle" fill="black" font-weight="bold">${value.toUpperCase()}</text>
  </svg>`;
}

// Format Currency
function formatLKR(amount) {
  return `Rs. ${parseFloat(amount).toFixed(2)}`;
}

// Initialize Lucide Icons
function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Fetch products from local server
async function fetchProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error('Failed to load products');
    products = await res.json();
    renderProducts();
  } catch (error) {
    console.error('Error fetching products:', error);
    showToast('Failed to load local inventory', 'error');
  }
}

// Fetch register shift state on boot
async function fetchActiveShift() {
  try {
    const res = await fetch('/api/shifts/active');
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      activeShift = data.data;
      shiftGateModal.classList.remove('active');
      
      // Populate active shift views
      shiftOpeningFloat.innerText = formatLKR(activeShift.opening_float);
      shiftOpenedTime.innerText = new Date(activeShift.opened_at).toLocaleString();
      
      // Calculate drawer updates
      await updateShiftDashboardTotals();
    } else {
      activeShift = null;
      shiftGateModal.classList.add('active');
    }
  } catch (error) {
    console.error("Shift gate server unreachable:", error);
    activeShift = null;
    shiftGateModal.classList.add('active');
  }
}

// Fetch sync status and logs
async function fetchSyncStatus() {
  try {
    const res = await fetch('/api/sync/status');
    if (!res.ok) throw new Error('Failed to fetch sync status');
    const data = await res.json();
    
    // Update network state UI
    simulatedOffline = data.simulatedOffline;
    networkToggle.checked = simulatedOffline;
    
    if (simulatedOffline) {
      statusDot.className = 'status-dot offline';
      statusText.innerText = 'OFFLINE';
      statusText.style.color = 'var(--color-warning)';
    } else {
      statusDot.className = 'status-dot online';
      statusText.innerText = 'ONLINE';
      statusText.style.color = 'var(--color-success)';
    }

    // Update queue count
    unsyncedCount = data.unsyncedCount;
    unsyncedCountDisplay.innerText = unsyncedCount;
    
    // Update logs
    renderLogs(data.syncLogs);
    
    // Refresh products if queue was flushed
    const prevCount = parseInt(unsyncedCountDisplay.getAttribute('data-prev-count') || '0');
    if (prevCount > 0 && unsyncedCount === 0) {
      fetchProducts();
      if (activeShift) updateShiftDashboardTotals();
    }
    unsyncedCountDisplay.setAttribute('data-prev-count', unsyncedCount);

  } catch (error) {
    console.error('Error fetching sync status:', error);
  }
}

// Update running active shift drawer statistics on screen
async function updateShiftDashboardTotals() {
  if (!activeShift) return;
  try {
    // We can fetch expected numbers by querying local transactions
    // Since we are offline-first, let's query the local state from APIs
    const res = await fetch('/api/sync/status'); // to check active network
    // Fetch active shift status by performing a mock closing request or checking sales
    // We can calculate sums from transactions that are loaded or query shift sales from sqlite
    // Let's implement expected total calculations directly in the UI or fetch.
    // For simplicity, we can fetch active totals from a closing check, or compute it locally by loading historical checkouts
    // Let's calculate expected totals using transaction counts. We can query a temporary calculation
    // Wait, the client can call a dry-run closing check or we can make a lightweight API to fetch shift totals.
    // Actually, calling POST /api/shifts/close with a fake cash can return totals, but it writes to the DB.
    // Let's create a lightweight route or we can just fetch shift statistics!
    // Since we don't have a separate stats route, let's look: when we close, we call POST /api/shifts/close.
    // Let's query totals from sqlite database by adding a lightweight calculation.
    // Wait! Can we calculate shift totals directly by loading local sales?
    // Since sync is local, we can perform a call or we can calculate it from sales list.
    // Let's create an endpoint in local-pos/server.js to get active shift totals!
    // Oh, wait, instead of modifying the server again, let's think: is there an easier way?
    // Yes! We can query sales locally, but we don't have a GET /api/sales route.
    // Let's add a quick endpoint `GET /api/shifts/active/totals` in `local-pos/server.js` to return expected cash, card, mobile totals!
    // That is very clean and avoids frontend math bugs.
    // Wait, let's check: did we already write `server.js`? Yes. Can we modify it? Yes, we have replace_file_content!
    // Let's modify `local-pos/server.js` first to add a `GET /api/shifts/active/totals` endpoint, and then fetch it!
    // Let's do that. This makes the shift dashboard real-time and extremely precise.
  } catch (e) {
    console.error("Error updating shift dashboard:", e);
  }
}

// Render product logs
function renderLogs(logs) {
  if (!logs || logs.length === 0) return;
  logsContainer.innerHTML = logs.map(log => `
    <div class="log-item ${log.type || 'info'}">
      <span class="time">${log.timestamp}</span>
      <span class="msg">${escapeHTML(log.message)}</span>
    </div>
  `).join('');
}

// Render product grid
function renderProducts() {
  const query = searchInput.value.toLowerCase().trim();
  let filtered = products;
  
  if (selectedCategory !== 'all') {
    filtered = filtered.filter(p => {
      const name = p.name.toLowerCase();
      if (selectedCategory === 'coffee') return name.includes('coffee') || p.sku.includes('COF');
      if (selectedCategory === 'souvenir') return name.includes('souvenir') || p.sku.includes('SOU');
      if (selectedCategory === 'eco') return name.includes('sunscreen') || name.includes('bottle') || p.sku.includes('SUN') || p.sku.includes('BOT');
      if (selectedCategory === 'food') return name.includes('honey') || p.sku.includes('HNY');
      return true;
    });
  }

  if (query) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.sku.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    productsGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <p>No products found matching filters</p>
      </div>
    `;
    return;
  }

  productsGrid.innerHTML = filtered.map(p => {
    const cartItem = cart.find(item => item.productId === p.id);
    const cartQty = cartItem ? cartItem.quantity : 0;
    const remainingStock = p.stock_quantity - cartQty;
    
    let stockClass = 'in-stock';
    let stockText = `${remainingStock} left`;
    
    if (remainingStock <= 0) {
      stockClass = 'out-of-stock';
      stockText = 'Out of stock';
    } else if (remainingStock <= 5) {
      stockClass = 'low-stock';
      stockText = `Only ${remainingStock} left`;
    }

    const disabledClass = remainingStock <= 0 ? 'disabled' : '';

    return `
      <div class="product-card ${disabledClass}" onclick="addToCart(${p.id})">
        <div class="img-placeholder">${escapeHTML(p.name[0])}</div>
        <h4>${escapeHTML(p.name)}</h4>
        <span class="sku">${escapeHTML(p.sku)}</span>
        <div class="price-row">
          <span class="price">${formatLKR(p.price)}</span>
          <div style="display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation();">
            <button class="barcode-btn" onclick="triggerBarcodeSticker(${p.id})" title="Print Barcode">
              <i data-lucide="barcode"></i>
            </button>
            <span class="stock-badge ${stockClass}">${stockText}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  initIcons();
}

// Autocomplete suggestions search controller
function updateSearchSuggestions() {
  const queryText = searchInput.value.toLowerCase().trim();
  
  if (!queryText) {
    // Zero-state suggestions: Top 5 in-stock products
    filteredSuggestions = products
      .filter(p => p.stock_quantity > 0)
      .slice(0, 5);
  } else {
    // Filter matches
    filteredSuggestions = products.filter(p => 
      p.name.toLowerCase().includes(queryText) || 
      p.sku.toLowerCase().includes(queryText)
    );
  }

  if (filteredSuggestions.length === 0) {
    searchSuggestions.classList.remove('active');
    activeSuggestionIndex = -1;
    return;
  }

  searchSuggestions.innerHTML = filteredSuggestions.map((p, idx) => {
    const activeClass = idx === activeSuggestionIndex ? 'active' : '';
    const stockClass = p.stock_quantity <= 0 ? 'out-of-stock' : (p.stock_quantity <= 5 ? 'low-stock' : 'in-stock');
    return `
      <div class="suggestion-item ${activeClass}" onclick="selectSuggestion(${idx})">
        <div>
          <span class="s-name">${escapeHTML(p.name)}</span>
          <span class="s-sku">${escapeHTML(p.sku)}</span>
        </div>
        <span class="stock-badge ${stockClass}">${p.stock_quantity} left</span>
      </div>
    `;
  }).join('');
  
  searchSuggestions.classList.add('active');
}

// Select dynamic SKU suggestion
window.selectSuggestion = function(idx) {
  const product = filteredSuggestions[idx];
  if (product) {
    if (product.stock_quantity <= 0) {
      showToast('Cannot add: SKU is out of stock', 'warning');
      playPOSSound('error');
    } else {
      addToCart(product.id);
    }
  }
  closeSuggestions();
};

function closeSuggestions() {
  searchSuggestions.classList.remove('active');
  activeSuggestionIndex = -1;
  searchInput.value = '';
  renderProducts(); // Reset grid filter
}

// Keyboard shortcuts for search inputs
searchInput.addEventListener('keydown', (e) => {
  const active = searchSuggestions.classList.contains('active');
  if (!active) {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      updateSearchSuggestions();
      e.preventDefault();
    }
    return;
  }

  if (e.key === 'ArrowDown') {
    activeSuggestionIndex = (activeSuggestionIndex + 1) % filteredSuggestions.length;
    updateSearchSuggestions();
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    activeSuggestionIndex = (activeSuggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
    updateSearchSuggestions();
    e.preventDefault();
  } else if (e.key === 'Enter') {
    if (activeSuggestionIndex >= 0) {
      selectSuggestion(activeSuggestionIndex);
    } else if (filteredSuggestions.length > 0) {
      selectSuggestion(0); // Select first suggestion by default
    }
    e.preventDefault();
  } else if (e.key === 'Escape') {
    closeSuggestions();
    e.preventDefault();
  }
});

// Close search suggestions on click outside
document.addEventListener('click', (e) => {
  if (!document.querySelector('.search-bar-container').contains(e.target)) {
    searchSuggestions.classList.remove('active');
  }
});

searchInput.addEventListener('focus', () => {
  updateSearchSuggestions();
});

searchInput.addEventListener('input', () => {
  activeSuggestionIndex = -1;
  updateSearchSuggestions();
});

// Add product to cart
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const cartItem = cart.find(item => item.productId === productId);
  const cartQty = cartItem ? cartItem.quantity : 0;

  if (product.stock_quantity - cartQty <= 0) {
    showToast('Cannot add: Out of stock', 'warning');
    playPOSSound('error');
    return;
  }

  if (cartItem) {
    cartItem.quantity++;
  } else {
    cart.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: 1
    });
  }

  playPOSSound('success');
  renderCart();
  renderProducts();
}

// Update item quantity inside cart
function updateQty(productId, amount) {
  const itemIndex = cart.findIndex(item => item.productId === productId);
  if (itemIndex === -1) return;

  const item = cart[itemIndex];
  const product = products.find(p => p.id === productId);

  if (amount > 0 && product.stock_quantity - item.quantity <= 0) {
    showToast('Cannot add: Out of stock', 'warning');
    playPOSSound('error');
    return;
  }

  item.quantity += amount;

  if (item.quantity <= 0) {
    cart.splice(itemIndex, 1);
  }

  playPOSSound('success');
  renderCart();
  renderProducts();
}

// Render shopping cart contents and compute discounts/tax
function renderCart() {
  if (cart.length === 0) {
    cartItemsContainer.innerHTML = `
      <div class="empty-cart-state" id="empty-cart-state">
        <i data-lucide="shopping-bag" class="empty-icon"></i>
        <p>Cart is empty</p>
      </div>
    `;
    emptyCartState.style.display = 'flex';
    checkoutBtn.disabled = true;
    
    subtotalDisplay.innerText = formatLKR(0);
    taxDisplay.innerText = formatLKR(0);
    totalDisplay.innerText = formatLKR(0);
    discountSummaryRow.style.display = 'none';
    initIcons();
    return;
  }

  emptyCartState.style.display = 'none';
  checkoutBtn.disabled = false;

  cartItemsContainer.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-details">
        <h4>${escapeHTML(item.name)}</h4>
        <span class="price">${formatLKR(item.price)} x ${item.quantity}</span>
      </div>
      <div class="cart-item-controls">
        <button class="btn-qty" onclick="updateQty(${item.productId}, -1)">-</button>
        <span class="qty">${item.quantity}</span>
        <button class="btn-qty" onclick="updateQty(${item.productId}, 1)">+</button>
      </div>
    </div>
  `).join('');

  // Cart level Discount Calculations
  const grossSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = grossSubtotal * (discountValue / 100);
  } else {
    discountAmount = Math.min(grossSubtotal, discountValue);
  }

  const netSubtotal = Math.max(0, grossSubtotal - discountAmount);
  const tax = netSubtotal * vatRate; // Dynamic VAT tax
  const total = netSubtotal + tax;

  subtotalDisplay.innerText = formatLKR(grossSubtotal);
  
  if (discountAmount > 0) {
    discountDisplay.innerText = `-${formatLKR(discountAmount)}`;
    discountSummaryRow.style.display = 'flex';
  } else {
    discountSummaryRow.style.display = 'none';
  }

  taxDisplay.innerText = formatLKR(tax);
  totalDisplay.innerText = formatLKR(total);

  // Multi-Currency conversions
  const selectedCurrency = checkoutCurrencySelect.value;
  const rate = exchangeRates[selectedCurrency] || 1.0;
  const convertedTotal = total / rate;

  if (selectedCurrency === 'LKR') {
    foreignTotalRow.style.display = 'none';
    multiCurrencyCalc.style.display = 'none';
  } else {
    foreignTotalRow.style.display = 'flex';
    let symbol = '$';
    if (selectedCurrency === 'EUR') symbol = '€';
    if (selectedCurrency === 'GBP') symbol = '£';
    foreignTotalDisplay.innerText = `${symbol}${convertedTotal.toFixed(2)}`;

    // Show cashier calculator if payment method is set to Cash
    const paymentMethodEl = document.querySelector('input[name="payment-method"]:checked');
    const paymentMethod = paymentMethodEl ? paymentMethodEl.value : 'Cash';
    if (paymentMethod === 'Cash') {
      multiCurrencyCalc.style.display = 'flex';
      foreignPaidLabel.innerText = `Paid (${selectedCurrency}):`;
      
      const foreignPaid = parseFloat(foreignPaidInput.value || 0);
      const lkrPaid = foreignPaid * rate;
      const lkrChange = lkrPaid - total;

      lkrEquivalentPaid.innerText = formatLKR(lkrPaid);

      if (lkrPaid >= total) {
        lkrChangeDue.innerText = formatLKR(lkrChange);
        lkrChangeDue.style.color = 'var(--color-success)';
        checkoutBtn.disabled = false;
      } else {
        lkrChangeDue.innerText = `Short by ${formatLKR(total - lkrPaid)}`;
        lkrChangeDue.style.color = 'var(--color-danger)';
        checkoutBtn.disabled = true;
      }
    } else {
      multiCurrencyCalc.style.display = 'none';
    }
  }

  initIcons();
}

// Clear cart
clearCartBtn.addEventListener('click', () => {
  cart = [];
  playPOSSound('trash');
  renderCart();
  renderProducts();
});

// Configure discount inputs
discountInput.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value || 0);
  discountValue = Math.max(0, val);
  renderCart();
});

discPercentBtn.addEventListener('click', () => {
  discountType = 'percent';
  discPercentBtn.classList.add('active');
  discValBtn.classList.remove('active');
  discountInput.placeholder = "0 %";
  renderCart();
});

discValBtn.addEventListener('click', () => {
  discountType = 'val';
  discValBtn.classList.add('active');
  discPercentBtn.classList.remove('active');
  discountInput.placeholder = "Rs. 0";
  renderCart();
});

// Navigation tab switches
navPosBtn.addEventListener('click', () => {
  navPosBtn.classList.add('active');
  navShiftBtn.classList.remove('active');
  navSettingsBtn.classList.remove('active');
  posTerminalView.style.display = 'flex';
  posCartPanel.style.display = 'flex';
  shiftPanelView.style.display = 'none';
  settingsPanelView.style.display = 'none';
});

navShiftBtn.addEventListener('click', async () => {
  navShiftBtn.classList.add('active');
  navPosBtn.classList.remove('active');
  navSettingsBtn.classList.remove('active');
  posTerminalView.style.display = 'none';
  posCartPanel.style.display = 'none';
  shiftPanelView.style.display = 'flex';
  settingsPanelView.style.display = 'none';
  await updateShiftDashboardTotals();
});

navSettingsBtn.addEventListener('click', () => {
  navSettingsBtn.classList.add('active');
  navPosBtn.classList.remove('active');
  navShiftBtn.classList.remove('active');
  posTerminalView.style.display = 'none';
  posCartPanel.style.display = 'none';
  shiftPanelView.style.display = 'none';
  settingsPanelView.style.display = 'flex';
});

// Close shift triggers
closeShiftTriggerBtn.addEventListener('click', () => {
  actualCashInput.value = '';
  closeShiftModal.classList.add('active');
});

closeShiftCancelBtn.addEventListener('click', () => closeShiftModal.classList.remove('active'));
closeShiftAbortBtn.addEventListener('click', () => closeShiftModal.classList.remove('active'));

// Handle Open Shift
openShiftForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const floatVal = parseFloat(openingFloatInput.value || 0);
  if (isNaN(floatVal) || floatVal < 0) {
    playPOSSound('error');
    alert("Please enter a valid cash float.");
    return;
  }

  try {
    const res = await fetch('/api/shifts/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opening_float: floatVal })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      playPOSSound('success');
      showToast("Register Shift Opened!", "success");
      await fetchActiveShift();
      configChannel.postMessage({ type: 'shift_change' });
    } else {
      playPOSSound('error');
      alert(data.message || "Failed to open shift");
    }
  } catch (error) {
    playPOSSound('error');
    alert("Communication error opening shift.");
  }
});

// Handle Close Shift (Reconciliation Audit)
closeShiftForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const countedVal = parseFloat(actualCashInput.value || 0);
  if (isNaN(countedVal) || countedVal < 0) {
    playPOSSound('error');
    alert("Please enter counted cash drawer balance.");
    return;
  }

  try {
    const res = await fetch('/api/shifts/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual_cash: countedVal })
    });
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      playPOSSound('success');
      closeShiftModal.classList.remove('active');
      showToast("Shift Closed successfully!", "success");
      
      // Render print-only shift audit report wrapper
      renderShiftAuditPrintout(data.data);
      
      // Instantly open print dialog
      window.print();
      
      // Reload shift gate block
      await fetchActiveShift();
      configChannel.postMessage({ type: 'shift_change' });
    } else {
      playPOSSound('error');
      alert(data.message || "Failed to close shift");
    }
  } catch (error) {
    playPOSSound('error');
    alert("Communication error closing shift.");
  }
});

// Helper to update active shift stats on screen
async function updateShiftDashboardTotals() {
  if (!activeShift) return;
  try {
    const res = await fetch('/api/shifts/active');
    const data = await res.json();
    if (res.ok && data.status === 'success') {
      // Perform expected calculations by hitting local database triggers.
      // Since our close shift endpoint uses aggregation calculations insideSQLite,
      // we can do a temporary math call to get expected running values!
      // To run expected shift totals dynamically, let's hit a temporary totals API
      const totalsRes = await fetch(`/api/shifts/active/totals`);
      if (totalsRes.ok) {
        const totals = await totalsRes.json();
        shiftOpeningFloat.innerText = formatLKR(activeShift.opening_float);
        shiftCashSales.innerText = formatLKR(totals.cash_sales);
        shiftCardSales.innerText = formatLKR(totals.card_sales);
        shiftMobileSales.innerText = formatLKR(totals.mobile_sales);
        shiftTotalSales.innerText = formatLKR(totals.total_sales);
      }
    }
  } catch (e) {
    console.error("Dashboard totals update failed:", e);
  }
}

// Render printable shift audit report layout
function renderShiftAuditPrintout(report) {
  printShiftAuditWrapper.innerHTML = `
    <div style="text-align: center; border-bottom: 2px solid black; padding-bottom: 12px; margin-bottom: 20px;">
      <h2>REGISTER RECONCILIATION AUDIT</h2>
      <p>Sync Retail POS - Terminal REG-01</p>
    </div>
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr>
        <td style="padding: 6px 0;"><strong>Shift Audit ID:</strong></td>
        <td style="text-align: right;">#SH-${report.id}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0;"><strong>Opened At:</strong></td>
        <td style="text-align: right;">${new Date(report.opened_at).toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding: 6px 0;"><strong>Closed At:</strong></td>
        <td style="text-align: right;">${new Date(report.closed_at).toLocaleString()}</td>
      </tr>
    </table>
    
    <div style="border-bottom: 1px solid black; padding-bottom: 6px; margin-bottom: 12px;">
      <h3>FINANCIAL BALANCE</h3>
    </div>
    <table style="width: 100%; margin-bottom: 20px;">
      <tr>
        <td>Opening Float:</td>
        <td style="text-align: right;">${formatLKR(report.opening_float)}</td>
      </tr>
      <tr>
        <td>+ Cash Sales Inflow:</td>
        <td style="text-align: right;">${formatLKR(report.cash_sales)}</td>
      </tr>
      <tr style="border-top: 1px solid #ccc; font-weight: bold;">
        <td>Expected Drawer Cash:</td>
        <td style="text-align: right;">${formatLKR(report.expected_cash)}</td>
      </tr>
      <tr style="font-weight: bold; font-size: 1.1em;">
        <td>Counted Drawer Cash:</td>
        <td style="text-align: right;">${formatLKR(report.actual_cash)}</td>
      </tr>
      <tr style="color: ${report.discrepancy < 0 ? 'red' : 'green'}; font-weight: bold;">
        <td>Difference (Short/Over):</td>
        <td style="text-align: right;">${formatLKR(report.discrepancy)}</td>
      </tr>
    </table>

    <div style="border-bottom: 1px solid black; padding-bottom: 6px; margin-bottom: 12px;">
      <h3>OTHER PAYMENT METHOD SUMMARY</h3>
    </div>
    <table style="width: 100%; margin-bottom: 30px;">
      <tr>
        <td>Card Sales Total:</td>
        <td style="text-align: right;">${formatLKR(report.card_sales)}</td>
      </tr>
      <tr>
        <td>Mobile QR Sales Total:</td>
        <td style="text-align: right;">${formatLKR(report.mobile_sales)}</td>
      </tr>
      <tr style="border-top: 1px dashed black; font-weight: bold;">
        <td>Total Sales Turnover:</td>
        <td style="text-align: right;">${formatLKR(report.total_sales)}</td>
      </tr>
    </table>
    
    <div style="text-align: center; margin-top: 40px; border-top: 1px solid black; padding-top: 20px;">
      <p style="font-size: 11px;">I certify that the above cash drawers was physically counted and reconciled.</p>
      <div style="display: flex; justify-content: space-between; margin-top: 40px;">
        <span style="border-top: 1px solid black; width: 120px; font-size: 10px;">Cashier Signature</span>
        <span style="border-top: 1px solid black; width: 120px; font-size: 10px;">Manager Signature</span>
      </div>
    </div>
  `;
}

// ==========================================================
// 3. PRODUCT CODE39 BARCODE STICKER LOGIC
// ==========================================================
window.triggerBarcodeSticker = function(productId) {
  const p = products.find(prod => prod.id === productId);
  if (!p) return;

  barcodeModalProduct = p;
  barcodePrintQty = 'single';
  barcodeModalProductName.innerText = p.name;
  barcodeModalProductSku.innerText = `SKU: ${p.sku}`;
  
  // Render Barcode SVG inside preview card
  barcodeGraphicBox.innerHTML = getCode39SVG(p.sku);
  
  // Reset buttons status
  printSingleBtn.className = "btn btn-secondary active";
  printSheetBtn.className = "btn btn-secondary";
  
  barcodeModal.classList.add('active');
};

barcodeCloseBtn.addEventListener('click', () => barcodeModal.classList.remove('active'));

printSingleBtn.addEventListener('click', () => {
  barcodePrintQty = 'single';
  printSingleBtn.classList.add('active');
  printSheetBtn.classList.remove('active');
});

printSheetBtn.addEventListener('click', () => {
  barcodePrintQty = 'sheet';
  printSheetBtn.classList.add('active');
  printSingleBtn.classList.remove('active');
});

// Trigger print layout and open browser print utility
barcodeTriggerPrintBtn.addEventListener('click', () => {
  if (!barcodeModalProduct) return;
  
  // Set wrapper styles based on configuration
  printBarcodeWrapper.className = barcodePrintQty === 'sheet' ? 'print-barcode-sheet-layout' : 'print-barcode-single-layout';
  printBarcodeWrapper.style.display = 'block'; // force display for print engine
  
  if (barcodePrintQty === 'single') {
    printBarcodeWrapper.innerHTML = `
      <div class="barcode-sticker-print-cell">
        <div style="font-size:11px;font-weight:bold;margin:2px 0;text-align:center;">${escapeHTML(barcodeModalProduct.name)}</div>
        <div style="width:100%;background:#ffffff;margin:2px 0;">${getCode39SVG(barcodeModalProduct.sku)}</div>
        <div style="font-size:11px;font-weight:bold;margin-top:2px;text-align:center;">${formatLKR(barcodeModalProduct.price)}</div>
      </div>
    `;
  } else {
    // Render sheet of 30 stickers
    let gridCells = '';
    for (let i = 0; i < 30; i++) {
      gridCells += `
        <div class="barcode-sticker-print-cell">
          <div style="font-size:9px;font-weight:bold;margin:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${escapeHTML(barcodeModalProduct.name)}</div>
          <div style="width:100%;background:#ffffff;margin:2px 0;">${getCode39SVG(barcodeModalProduct.sku)}</div>
          <div style="font-size:9px;font-weight:bold;margin-top:2px;">${formatLKR(barcodeModalProduct.price)}</div>
        </div>
      `;
    }
    printBarcodeWrapper.innerHTML = gridCells;
  }

  // Close modal
  barcodeModal.classList.remove('active');
  
  // Trigger Print dialog
  window.print();
});

// Clean print wrapper content after printing closes
window.addEventListener('afterprint', () => {
  printBarcodeWrapper.style.display = 'none';
  printBarcodeWrapper.innerHTML = '';
  printShiftAuditWrapper.style.display = 'none';
  printShiftAuditWrapper.innerHTML = '';
});

// Toggle simulated network status
networkToggle.addEventListener('change', async (e) => {
  const offline = e.target.checked;
  try {
    const res = await fetch('/api/sim-network', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline })
    });
    if (!res.ok) throw new Error('Failed to set simulated network');
    await fetchSyncStatus();
    configChannel.postMessage({ type: 'network_change', offline });
  } catch (error) {
    console.error('Error toggling simulated network:', error);
    e.target.checked = !offline;
  }
});

// Trigger manual sync
syncNowBtn.addEventListener('click', async () => {
  if (simulatedOffline) {
    showToast('Cannot sync while network is OFFLINE', 'error');
    playPOSSound('error');
    return;
  }
  
  syncNowBtn.disabled = true;
  const originalHtml = syncNowBtn.innerHTML;
  syncNowBtn.innerHTML = '<i data-lucide="refresh-cw" class="animate-spin"></i> Syncing...';
  initIcons();

  try {
    const res = await fetch('/api/sync/trigger', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast('Synchronization complete!', 'success');
      playPOSSound('success');
    } else {
      showToast(data.message || 'Sync failed', 'error');
      playPOSSound('error');
    }
  } catch (error) {
    showToast('Sync failed: cloud server offline', 'error');
    playPOSSound('error');
  } finally {
    syncNowBtn.disabled = false;
    syncNowBtn.innerHTML = originalHtml;
    initIcons();
    await fetchSyncStatus();
  }
});

// Checkout Order
checkoutBtn.addEventListener('click', async () => {
  if (cart.length === 0) return;

  const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
  
  // Calculate discount calculations for final checkout total
  const grossSubtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  let discountAmount = 0;
  if (discountType === 'percent') {
    discountAmount = grossSubtotal * (discountValue / 100);
  } else {
    discountAmount = Math.min(grossSubtotal, discountValue);
  }

  const netSubtotal = Math.max(0, grossSubtotal - discountAmount);
  const tax = netSubtotal * vatRate;
  const totalAmount = netSubtotal + tax;

  checkoutBtn.disabled = true;

  try {
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart,
        paymentMethod,
        totalAmount: parseFloat(totalAmount.toFixed(2))
      })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to check out');
    }

    const sale = await res.json();
    
    const currency = checkoutCurrencySelect.value;
    const rate = exchangeRates[currency] || 1.0;
    const foreignPaid = parseFloat(foreignPaidInput.value || 0);

    playPOSSound('success');
    showReceipt(sale, discountAmount, currency, rate, foreignPaid);

    // Reset Cart & Discounts & Currencies
    cart = [];
    discountValue = 0;
    discountInput.value = '';
    checkoutCurrencySelect.value = 'LKR';
    foreignPaidInput.value = '';
    renderCart();
    await fetchProducts(); 
    await fetchSyncStatus(); 

  } catch (error) {
    playPOSSound('error');
    showToast(`Checkout failed: ${error.message}`, 'error');
  } finally {
    checkoutBtn.disabled = false;
  }
});

// Show receipt popup modal
function showReceipt(sale, discountAmount = 0, currency = 'LKR', rate = 1.0, foreignPaid = 0) {
  document.getElementById('receipt-id').innerText = `#${sale.id.slice(0, 8)}`;
  document.getElementById('receipt-time').innerText = new Date(sale.createdAt).toLocaleString();
  document.getElementById('receipt-payment').innerText = sale.paymentMethod;
  document.getElementById('receipt-total').innerText = formatLKR(sale.totalAmount);

  // Multi-Currency details inside receipt
  const receiptForeignRow = document.getElementById('receipt-foreign-details');
  const receiptForeignCalc = document.getElementById('receipt-foreign-calc');
  const receiptForeignChange = document.getElementById('receipt-foreign-change');

  if (currency !== 'LKR' && sale.paymentMethod === 'Cash') {
    let symbol = '$';
    if (currency === 'EUR') symbol = '€';
    if (currency === 'GBP') symbol = '£';
    
    const lkrPaid = foreignPaid * rate;
    const change = lkrPaid - sale.totalAmount;

    receiptForeignCalc.innerText = `Paid: ${symbol}${foreignPaid.toFixed(2)} (Rate: 1 ${currency} = ${rate.toFixed(2)} LKR)`;
    receiptForeignChange.innerText = `Change: ${formatLKR(change)}`;
    receiptForeignRow.style.display = 'flex';
  } else {
    receiptForeignRow.style.display = 'none';
  }

  const discountRow = document.getElementById('receipt-discount-row');
  const discountDivider = document.getElementById('receipt-discount-divider');
  
  if (discountAmount > 0) {
    document.getElementById('receipt-discount-val').innerText = `-${formatLKR(discountAmount)}`;
    discountRow.style.display = 'flex';
    discountDivider.style.display = 'block';
  } else {
    discountRow.style.display = 'none';
    discountDivider.style.display = 'none';
  }

  const badge = document.getElementById('receipt-sync-badge');
  if (simulatedOffline) {
    badge.innerText = 'Saved Locally (Offline)';
    badge.className = 'offline-badge-receipt';
  } else {
    badge.innerText = 'Synced to Central Cloud';
    badge.className = 'offline-badge-receipt online';
  }

  // Populate receipt item list
  const list = document.getElementById('receipt-items-list');
  list.innerHTML = cart.map(item => `
    <div class="receipt-item-row">
      <span>${escapeHTML(item.name)}</span>
      <span class="qty-price">x${item.quantity} - ${formatLKR(item.price * item.quantity)}</span>
    </div>
  `).join('');

  receiptModal.classList.add('active');
  initIcons();
}

closeReceiptBtn.addEventListener('click', () => {
  receiptModal.classList.remove('active');
});

// Category filtering buttons
document.querySelectorAll('.category-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    selectedCategory = e.target.getAttribute('data-category');
    renderProducts();
  });
});

// Payment option styles toggle
document.querySelectorAll('.payment-option').forEach(option => {
  option.addEventListener('click', () => {
    document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('active'));
    option.classList.add('active');
    
    const radio = option.querySelector('input[type="radio"]');
    if (radio) {
      radio.checked = true;
    }
    renderCart(); // Refresh cart to show/hide the cash calculator instantly!
  });
});

// Exchange Rate selection and input change listeners
checkoutCurrencySelect.addEventListener('change', () => {
  foreignPaidInput.value = '';
  renderCart();
});

foreignPaidInput.addEventListener('input', () => {
  renderCart();
});

// Toast Notifications helper
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.padding = '12px 20px';
  toast.style.borderRadius = '8px';
  toast.style.zIndex = '2000';
  toast.style.fontWeight = '600';
  toast.style.fontSize = '14px';
  toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.5)';
  
  if (type === 'success') {
    toast.style.backgroundColor = 'var(--color-success)';
    toast.style.color = 'var(--text-inverse)';
  } else if (type === 'warning') {
    toast.style.backgroundColor = 'var(--color-warning)';
    toast.style.color = '#000';
  } else if (type === 'error') {
    toast.style.backgroundColor = 'var(--color-danger)';
    toast.style.color = 'var(--text-inverse)';
  } else {
    toast.style.backgroundColor = 'var(--color-primary)';
    toast.style.color = 'var(--text-inverse)';
  }
  
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transition = 'opacity 0.5s ease';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

// Helpers
function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ==========================================================
// 4. HARDWARE BARCODE SCANNER INTERCEPTOR (KEYBOARD EMULATION)
// ==========================================================
let barcodeBuffer = '';
let lastKeyTime = 0;

window.addEventListener('keydown', (e) => {
  // Ignore scanner buffer collection if cashier is currently focusing in an input form field (except search-input)
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.id !== 'search-input') {
    return;
  }

  const currentTime = Date.now();
  const timeDiff = currentTime - lastKeyTime;
  lastKeyTime = currentTime;

  // Real physical scanners typings have inter-char intervals under 35-40ms
  if (timeDiff < 40) {
    if (e.key === 'Enter') {
      if (barcodeBuffer.length > 2) {
        addSkuByBarcode(barcodeBuffer.trim());
      }
      barcodeBuffer = '';
      e.preventDefault();
    } else if (e.key.length === 1) {
      barcodeBuffer += e.key;
    }
  } else {
    // Regular human typing (reset buffer with current key)
    barcodeBuffer = e.key.length === 1 ? e.key : '';
  }
});

function addSkuByBarcode(barcode) {
  if (!barcode) return;
  const cleanBarcode = barcode.toUpperCase().trim();
  
  // Find product by SKU
  const product = products.find(p => p.sku.toUpperCase() === cleanBarcode);
  if (product) {
    addToCart(product.id);
    showToast(`Scanned: ${product.name} added to cart`, 'success');
  } else {
    playPOSSound('error');
    showToast(`Scanned unknown SKU: ${barcode}`, 'warning');
  }
}

// Global testing helper to simulate hardware scanner keyboard emulation via developer console
window.simulateScanner = function(sku) {
  console.log(`[TEST] Starting mock scan for SKU: ${sku}`);
  let idx = 0;
  let lastTime = Date.now();
  
  function typeChar() {
    if (idx >= sku.length) {
      // Dispatch Enter
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      window.dispatchEvent(enterEvent);
      console.log(`[TEST] Dispatched Enter. Mock scan complete.`);
      return;
    }
    
    const char = sku[idx];
    const keyEvent = new KeyboardEvent('keydown', { key: char, bubbles: true });
    window.dispatchEvent(keyEvent);
    
    idx++;
    // Simulate rapid input at 12ms interval (well under 40ms threshold)
    setTimeout(typeChar, 12);
  }
  
  typeChar();
};

// Startup
async function init() {
  await fetchExchangeRates();
  await fetchActiveShift();
  await fetchProducts();
  await fetchSyncStatus();
  
  setInterval(fetchSyncStatus, 3000);
  initIcons();
}

init();

// Settings Event Listeners & Broadcast Channel Synchronization
vatRateSelect.addEventListener('change', (e) => {
  vatRate = parseFloat(e.target.value);
  updateCartDisplay();
  configChannel.postMessage({
    type: 'setting_change',
    vatRate,
    oscillatorType,
    synthPitch,
    synthVolume,
    synthDuration
  });
});

soundOscSelect.addEventListener('change', (e) => {
  oscillatorType = e.target.value;
  playPOSSound('success'); // Play confirmation pitch
  configChannel.postMessage({
    type: 'setting_change',
    vatRate,
    oscillatorType,
    synthPitch,
    synthVolume,
    synthDuration
  });
});

// Sound customizer sliders event listeners
synthPitchInput.addEventListener('input', (e) => {
  synthPitch = parseInt(e.target.value);
  synthPitchVal.innerText = `${synthPitch} Hz`;
  configChannel.postMessage({
    type: 'setting_change',
    vatRate,
    oscillatorType,
    synthPitch,
    synthVolume,
    synthDuration
  });
});

synthVolumeInput.addEventListener('input', (e) => {
  synthVolume = parseFloat(e.target.value);
  synthVolumeVal.innerText = synthVolume.toFixed(2);
  configChannel.postMessage({
    type: 'setting_change',
    vatRate,
    oscillatorType,
    synthPitch,
    synthVolume,
    synthDuration
  });
});

synthDurationInput.addEventListener('input', (e) => {
  synthDuration = parseInt(e.target.value);
  synthDurationVal.innerText = `${synthDuration} ms`;
  configChannel.postMessage({
    type: 'setting_change',
    vatRate,
    oscillatorType,
    synthPitch,
    synthVolume,
    synthDuration
  });
});

synthTestBtn.addEventListener('click', () => {
  playPOSSound('success');
});

configChannel.onmessage = async (e) => {
  console.log('Received settings broadcast message:', e.data);
  if (e.data.type === 'shift_change') {
    await fetchActiveShift();
    showToast('Shift state synchronized from another tab.', 'info');
  } else if (e.data.type === 'network_change') {
    await fetchSyncStatus();
    showToast(`Network state synced: ${e.data.offline ? 'OFFLINE' : 'ONLINE'}`, 'info');
  } else if (e.data.type === 'setting_change') {
    vatRate = e.data.vatRate;
    oscillatorType = e.data.oscillatorType;
    synthPitch = e.data.synthPitch || synthPitch;
    synthVolume = e.data.synthVolume !== undefined ? e.data.synthVolume : synthVolume;
    synthDuration = e.data.synthDuration || synthDuration;
    
    // Sync settings forms elements
    vatRateSelect.value = vatRate.toFixed(2);
    soundOscSelect.value = oscillatorType;
    synthPitchInput.value = synthPitch;
    synthPitchVal.innerText = `${synthPitch} Hz`;
    synthVolumeInput.value = synthVolume;
    synthVolumeVal.innerText = synthVolume.toFixed(2);
    synthDurationInput.value = synthDuration;
    synthDurationVal.innerText = `${synthDuration} ms`;
    
    updateCartDisplay();
    showToast('System configuration updated via cross-tab broadcast.', 'info');
  }
};

// Alias for BroadcastChannel settings compatibility
const updateCartDisplay = renderCart;
