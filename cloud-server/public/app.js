// DOM Elements
const statRevenue = document.getElementById('stat-revenue');
const statRegisters = document.getElementById('stat-registers');
const statSales = document.getElementById('stat-sales');
const catalogTableBody = document.getElementById('catalog-table-body');
const performanceList = document.getElementById('performance-list');
const salesTableBody = document.getElementById('sales-table-body');
const refreshBtn = document.getElementById('refresh-btn');

// Modal Elements
const productModal = document.getElementById('product-modal');
const addProductBtn = document.getElementById('add-product-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const cancelModalBtn = document.getElementById('cancel-modal-btn');
const productForm = document.getElementById('product-form');
const modalTitle = document.getElementById('modal-title');
const productIdInput = document.getElementById('product-id');
const productNameInput = document.getElementById('product-name');
const productSkuInput = document.getElementById('product-sku');
const productPriceInput = document.getElementById('product-price');
const productStockInput = document.getElementById('product-stock');

// Initialize Lucide Icons
function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// Format Currency
function formatCurrency(amount) {
  return `Rs. ${parseFloat(amount).toFixed(2)}`;
}

// Fetch KPI statistics and product sales
async function fetchStats() {
  try {
    const res = await fetch('/api/admin/stats');
    if (!res.ok) throw new Error('Failed to fetch statistics');
    const data = await res.json();

    statRevenue.innerText = formatCurrency(data.totalRevenue);
    statRegisters.innerText = data.registerCount;
    statSales.innerText = data.salesCount;

    // Render Product Performance
    performanceList.innerHTML = data.productPerformance.map(p => `
      <div class="performance-item">
        <span class="prod-name">${escapeHTML(p.name)}</span>
        <span class="prod-sold">${p.units_sold} sold</span>
      </div>
    `).join('');

  } catch (error) {
    console.error('Error fetching stats:', error);
  }
}

// Fetch product catalog listing
async function fetchCatalog() {
  try {
    const res = await fetch('/api/sync/catalog');
    if (!res.ok) throw new Error('Failed to fetch catalog');
    const products = await res.json();

    catalogTableBody.innerHTML = products.map(p => `
      <tr>
        <td><strong>${p.id}</strong></td>
        <td>${escapeHTML(p.name)}</td>
        <td><code>${escapeHTML(p.sku)}</code></td>
        <td>${formatCurrency(p.price)}</td>
        <td>${p.stock_quantity} units</td>
        <td>
          <button class="action-link" onclick="openEditModal(${p.id}, '${escapeHTML(p.name)}', '${escapeHTML(p.sku)}', ${p.price}, ${p.stock_quantity})">
            Edit
          </button>
        </td>
      </tr>
    `).join('');

  } catch (error) {
    console.error('Error fetching catalog:', error);
  }
}

// Fetch detailed sales logs and calculate sync latency (delay)
async function fetchSales() {
  try {
    const res = await fetch('/api/admin/sales');
    if (!res.ok) throw new Error('Failed to fetch sales log');
    const sales = await res.json();

    if (sales.length === 0) {
      salesTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">
            No transactions synchronized yet.
          </td>
        </tr>
      `;
      return;
    }

    salesTableBody.innerHTML = sales.map(s => {
      // Calculate sync latency (difference between created_at at device and synced_at at server)
      const createdTime = new Date(s.created_at).getTime();
      const syncedTime = new Date(s.synced_at).getTime();
      const latencySeconds = Math.max(0, Math.round((syncedTime - createdTime) / 1000));

      let latencyBadgeHtml = '';
      if (latencySeconds <= 5) {
        latencyBadgeHtml = `<span class="latency-badge realtime"><i data-lucide="zap"></i> Real-time</span>`;
      } else {
        const minutes = Math.floor(latencySeconds / 60);
        const seconds = latencySeconds % 60;
        const durationText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        latencyBadgeHtml = `<span class="latency-badge delayed"><i data-lucide="clock"></i> + ${durationText}</span>`;
      }

      // Generate items description list
      const itemsListHtml = s.items.map(item => 
        `• ${escapeHTML(item.name)} (x${item.quantity})`
      ).join('<br>');

      return `
        <tr>
          <td><span class="badge" style="background-color:rgba(99, 102, 241, 0.1); border-color:rgba(99, 102, 241, 0.2); color:#a5b4fc;">${escapeHTML(s.register_id)}</span></td>
          <td><code>${s.id.slice(0, 8)}</code></td>
          <td><strong>${formatCurrency(s.total_amount)}</strong></td>
          <td>${escapeHTML(s.payment_method)}</td>
          <td>${latencyBadgeHtml}</td>
          <td>
            <div class="items-list-detail">${itemsListHtml}</div>
          </td>
        </tr>
      `;
    }).join('');

    initIcons();

  } catch (error) {
    console.error('Error fetching sales log:', error);
  }
}

// Modal actions
function openAddModal() {
  modalTitle.innerText = "Add New Product";
  productIdInput.value = "";
  productNameInput.value = "";
  productSkuInput.value = "";
  productPriceInput.value = "";
  productStockInput.value = "";
  productModal.classList.add('active');
}

window.openEditModal = function(id, name, sku, price, stock) {
  modalTitle.innerText = "Edit Product";
  productIdInput.value = id;
  productNameInput.value = name;
  productSkuInput.value = sku;
  productPriceInput.value = price;
  productStockInput.value = stock;
  productModal.classList.add('active');
};

function closeModal() {
  productModal.classList.remove('active');
}

addProductBtn.addEventListener('click', openAddModal);
closeModalBtn.addEventListener('click', closeModal);
cancelModalBtn.addEventListener('click', closeModal);

// Submit Product Form
productForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    id: productIdInput.value ? parseInt(productIdInput.value) : undefined,
    name: productNameInput.value,
    sku: productSkuInput.value,
    price: parseFloat(productPriceInput.value),
    stock_quantity: parseInt(productStockInput.value)
  };

  try {
    const res = await fetch('/api/admin/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Failed to save product');

    closeModal();
    await refreshData();

  } catch (error) {
    alert(`Error saving product: ${error.message}`);
  }
});

// Refresh Data trigger
async function refreshData() {
  refreshBtn.disabled = true;
  const originalHtml = refreshBtn.innerHTML;
  refreshBtn.innerHTML = '<i data-lucide="refresh-cw" class="animate-spin"></i> Refreshing...';
  initIcons();

  await Promise.all([
    fetchStats(),
    fetchCatalog(),
    fetchSales()
  ]);

  refreshBtn.disabled = false;
  refreshBtn.innerHTML = originalHtml;
  initIcons();
}

refreshBtn.addEventListener('click', refreshData);

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

// Initial pull and periodic loop
async function init() {
  await refreshData();
  
  // Poll statistics for real-time dashboards
  setInterval(async () => {
    await fetchStats();
    await fetchCatalog();
    await fetchSales();
  }, 3000);
}

init();
