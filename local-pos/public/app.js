// State variables
let products = [];
let cart = [];
let simulatedOffline = false;
let unsyncedCount = 0;
let selectedCategory = 'all';

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
const receiptModal = document.getElementById('receipt-modal');
const closeReceiptBtn = document.getElementById('close-receipt-btn');

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
    
    // If the queue count drops and we are rendering products, refresh list to show updated stock
    const prevCount = parseInt(unsyncedCountDisplay.getAttribute('data-prev-count') || '0');
    if (prevCount > 0 && unsyncedCount === 0) {
      fetchProducts();
    }
    unsyncedCountDisplay.setAttribute('data-prev-count', unsyncedCount);

  } catch (error) {
    console.error('Error fetching sync status:', error);
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
  
  // Filter by category
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

  // Filter by search query
  if (query) {
    filtered = filtered.filter(p => 
      p.name.toLowerCase().includes(query) || 
      p.sku.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    productsGrid.innerHTML = `
      <div class="empty-products-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <p>No products found matching filters</p>
      </div>
    `;
    return;
  }

  productsGrid.innerHTML = filtered.map(p => {
    // Determine effective stock (local stock minus what's in cart)
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
          <span class="price">$${p.price.toFixed(2)}</span>
          <span class="stock-badge ${stockClass}">${stockText}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Add product to cart
function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;

  const cartItem = cart.find(item => item.productId === productId);
  const cartQty = cartItem ? cartItem.quantity : 0;

  if (product.stock_quantity - cartQty <= 0) {
    showToast('Cannot add: Out of stock', 'warning');
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

  renderCart();
  renderProducts(); // Update stock status displayed in grid
}

// Update item quantity inside cart
function updateQty(productId, amount) {
  const itemIndex = cart.findIndex(item => item.productId === productId);
  if (itemIndex === -1) return;

  const item = cart[itemIndex];
  const product = products.find(p => p.id === productId);

  if (amount > 0 && product.stock_quantity - item.quantity <= 0) {
    showToast('Cannot add: Out of stock', 'warning');
    return;
  }

  item.quantity += amount;

  if (item.quantity <= 0) {
    cart.splice(itemIndex, 1);
  }

  renderCart();
  renderProducts();
}

// Render shopping cart contents
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
    
    subtotalDisplay.innerText = '$0.00';
    taxDisplay.innerText = '$0.00';
    totalDisplay.innerText = '$0.00';
    initIcons();
    return;
  }

  emptyCartState.style.display = 'none';
  checkoutBtn.disabled = false;

  cartItemsContainer.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-details">
        <h4>${escapeHTML(item.name)}</h4>
        <span class="price">$${item.price.toFixed(2)} x ${item.quantity}</span>
      </div>
      <div class="cart-item-controls">
        <button class="btn-qty" onclick="updateQty(${item.productId}, -1)">-</button>
        <span class="qty">${item.quantity}</span>
        <button class="btn-qty" onclick="updateQty(${item.productId}, 1)">+</button>
      </div>
    </div>
  `).join('');

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = subtotal * 0.10; // 10% tax
  const total = subtotal + tax;

  subtotalDisplay.innerText = `$${subtotal.toFixed(2)}`;
  taxDisplay.innerText = `$${tax.toFixed(2)}`;
  totalDisplay.innerText = `$${total.toFixed(2)}`;
  
  initIcons();
}

// Clear cart
clearCartBtn.addEventListener('click', () => {
  cart = [];
  renderCart();
  renderProducts();
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
  } catch (error) {
    console.error('Error toggling simulated network:', error);
    e.target.checked = !offline; // revert switch
  }
});

// Trigger manual sync
syncNowBtn.addEventListener('click', async () => {
  if (simulatedOffline) {
    showToast('Cannot sync while network is OFFLINE', 'error');
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
    } else {
      showToast(data.message || 'Sync failed', 'error');
    }
  } catch (error) {
    showToast('Sync failed: cloud server offline', 'error');
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
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = subtotal * 0.10;
  const totalAmount = subtotal + tax;

  checkoutBtn.disabled = true;

  try {
    const res = await fetch('/api/sales', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart,
        paymentMethod,
        totalAmount
      })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to check out');
    }

    const sale = await res.json();
    showReceipt(sale);

    // Reset Cart
    cart = [];
    renderCart();
    await fetchProducts(); // Reload products to get latest local inventory
    await fetchSyncStatus(); // Update queue counter

  } catch (error) {
    showToast(`Checkout failed: ${error.message}`, 'error');
  } finally {
    checkoutBtn.disabled = false;
  }
});

// Show visual receipt modal
function showReceipt(sale) {
  document.getElementById('receipt-id').innerText = `#${sale.id.slice(0, 8)}`;
  document.getElementById('receipt-time').innerText = new Date(sale.createdAt).toLocaleString();
  document.getElementById('receipt-payment').innerText = sale.paymentMethod;
  document.getElementById('receipt-total').innerText = `$${sale.totalAmount.toFixed(2)}`;

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
      <span class="qty-price">x${item.quantity} - $${(item.price * item.quantity).toFixed(2)}</span>
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

// Search input listener
searchInput.addEventListener('input', () => {
  renderProducts();
});

// Payment option styles toggle
document.querySelectorAll('.payment-option').forEach(option => {
  option.addEventListener('click', () => {
    document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('active'));
    option.classList.add('active');
  });
});

// Toast Notifications helper
function showToast(message, type = 'info') {
  // Simple toast creator
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

  // Fade out
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

// Startup
async function init() {
  await fetchProducts();
  await fetchSyncStatus();
  
  // Status check intervals
  setInterval(fetchSyncStatus, 3000);
  
  initIcons();
}

init();
