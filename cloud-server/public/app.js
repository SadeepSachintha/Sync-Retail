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

    catalogTableBody.innerHTML = products.map(p => {
      // Evaluate safety indicators
      let badgeClass = 'healthy';
      let badgeText = 'Healthy';
      if (p.stock_quantity <= 0) {
        badgeClass = 'out-of-stock';
        badgeText = 'Out of Stock';
      } else if (p.stock_quantity <= p.safety_stock) {
        badgeClass = 'safety-alert';
        badgeText = 'Safety Alert';
      } else if (p.stock_quantity <= p.reorder_point) {
        badgeClass = 'reorder';
        badgeText = 'Reorder Suggested';
      }

      return `
        <tr data-product-id="${p.id}">
          <td><strong>${p.id}</strong></td>
          <td>${escapeHTML(p.name)}</td>
          <td><code>${escapeHTML(p.sku)}</code></td>
          <td>${formatCurrency(p.price)}</td>
          <td>${p.stock_quantity} units</td>
          <td><span class="safety-badge ${badgeClass}">${badgeText}</span></td>
          <td>
            <button class="action-link" onclick="event.stopPropagation(); openEditModal(${p.id}, '${escapeHTML(p.name)}', '${escapeHTML(p.sku)}', ${p.price}, ${p.stock_quantity})">
              Edit
            </button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (error) {
    console.error('Error fetching catalog:', error);
  }
}

// Formatting helper for rendering transaction log table rows
function renderSaleRowHtml(s, flash = false) {
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

  const rowClass = flash ? 'glow-new-row' : '';

  return `
    <tr class="${rowClass}">
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

    salesTableBody.innerHTML = sales.map(s => renderSaleRowHtml(s, false)).join('');
    initIcons();

  } catch (error) {
    console.error('Error fetching sales log:', error);
  }
}

// ----------------------------------------------------
// AI DEMAND FORECASTING & SAFETY ALERTS MODAL LOGIC
// ----------------------------------------------------
const forecastModal = document.getElementById('forecast-modal');
const closeForecastBtn = document.getElementById('close-forecast-btn');
const closeForecastActionBtn = document.getElementById('close-forecast-action-btn');
const forecastModalProductName = document.getElementById('forecast-modal-product-name');
const forecastModalProductSku = document.getElementById('forecast-modal-product-sku');
const forecastSafetyStock = document.getElementById('forecast-safety-stock');
const forecastReorderPoint = document.getElementById('forecast-reorder-point');
const forecastWmape = document.getElementById('forecast-wmape');
const forecastChartContainer = document.getElementById('forecast-chart-container');
const forecastTableBody = document.getElementById('forecast-table-body');

// Catalog table row click delegation
catalogTableBody.addEventListener('click', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  // Skip trigger if clicking inside the Actions edit button column
  if (e.target.closest('td:last-child')) return;

  const productId = tr.getAttribute('data-product-id');
  if (productId) {
    openForecastModal(productId);
  }
});

async function openForecastModal(productId) {
  // Populate loading state
  forecastModalProductName.innerText = "Computing predictions...";
  forecastModalProductSku.innerText = "-";
  forecastSafetyStock.innerText = "-";
  forecastReorderPoint.innerText = "-";
  forecastWmape.innerText = "-";
  forecastChartContainer.innerHTML = '<span style="font-size:12px; color:var(--text-muted);">Predicting trends via LightGBM...</span>';
  forecastTableBody.innerHTML = '<tr><td colspan="2" style="text-align:center; padding:10px; color:var(--text-muted);">Loading...</td></tr>';
  
  forecastModal.classList.add('active');

  try {
    const res = await fetch(`/api/admin/products/${productId}/forecast`);
    if (!res.ok) throw new Error("Failed to retrieve product forecast.");
    const data = await res.json();

    // Find product details from list
    const prod = products.find(p => p.id === parseInt(productId));
    if (prod) {
      forecastModalProductName.innerText = prod.name;
      forecastModalProductSku.innerText = `SKU: ${prod.sku}`;
    }

    forecastSafetyStock.innerText = data.safety_stock;
    forecastReorderPoint.innerText = data.reorder_point;
    forecastWmape.innerText = `${data.wmape}%`;

    // Draw vector chart
    drawForecastChart(data.forecast);

    // Populate forecasts table
    forecastTableBody.innerHTML = data.forecast.map((val, idx) => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.02);">
        <td style="padding: 6px 12px; font-weight: 500; text-align: left;">Day ${idx + 1}</td>
        <td style="padding: 6px 12px; text-align: right; font-weight: bold; color: var(--color-primary-light);">${val} units</td>
      </tr>
    `).join('');

  } catch (error) {
    console.error("Forecasting display error:", error);
    forecastChartContainer.innerHTML = `<span style="font-size:12px; color:var(--color-danger);">${escapeHTML(error.message)}</span>`;
  }
}

function drawForecastChart(forecast) {
  const width = 540;
  const height = 130;
  const padding = 15;
  
  const maxVal = Math.max(...forecast, 10);
  const minVal = Math.min(...forecast, 0);
  const valRange = maxVal - minVal || 1;
  
  const points = forecast.map((val, idx) => {
    const x = padding + (idx * (width - padding * 2)) / 13;
    const y = height - padding - ((val - minVal) * (height - padding * 2)) / valRange;
    return `${x},${y}`;
  }).join(' ');
  
  // Generate dots and values labels
  const circles = forecast.map((val, idx) => {
    const x = padding + (idx * (width - padding * 2)) / 13;
    const y = height - padding - ((val - minVal) * (height - padding * 2)) / valRange;
    return `<circle cx="${x}" cy="${y}" r="3.5" fill="var(--color-primary)" stroke="#151722" stroke-width="1.5" />
            <text x="${x}" y="${y - 8}" font-size="8" font-family="monospace" text-anchor="middle" fill="#a5b4fc" font-weight="bold">${val}</text>`;
  }).join('');
  
  const svgHtml = `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
      <!-- Baseline axis -->
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
      
      <!-- Sparkline path -->
      <polyline fill="none" stroke="var(--color-primary)" stroke-width="2" points="${points}" stroke-linecap="round" stroke-linejoin="round" />
      
      <!-- Area fill -->
      <polygon fill="rgba(99, 102, 241, 0.08)" points="${padding},${height - padding} ${points} ${width - padding},${height - padding}" />
      
      <!-- Grid dots & text values -->
      ${circles}
    </svg>
  `;
  forecastChartContainer.innerHTML = svgHtml;
}

function closeForecastModal() {
  forecastModal.classList.remove('active');
}

closeForecastBtn.addEventListener('click', closeForecastModal);
closeForecastActionBtn.addEventListener('click', closeForecastModal);

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

// ----------------------------------------------------
// WEBSOCKETS REAL-TIME DASHBOARD SYNC OVERLAY
// ----------------------------------------------------
let socketActive = false;

function connectWS() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  const ws = new WebSocket(wsUrl);
  const statusBadge = document.getElementById('sync-active-badge');

  ws.onopen = () => {
    socketActive = true;
    if (statusBadge) {
      statusBadge.innerText = 'Live Feed Active';
      statusBadge.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
      statusBadge.style.color = 'var(--color-success)';
    }
  };

  ws.onclose = () => {
    socketActive = false;
    if (statusBadge) {
      statusBadge.innerText = 'Polling mode';
      statusBadge.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
      statusBadge.style.color = 'var(--color-warning)';
    }
    // Reconnect after 5s
    setTimeout(connectWS, 5000);
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'NEW_SALE') {
        handlePushSale(payload.data);
      }
    } catch (error) {
      console.error("WS message parse error:", error);
    }
  };
}

function handlePushSale(sale) {
  // Clear empty table text if present
  const firstRow = salesTableBody.querySelector('tr');
  if (firstRow && firstRow.querySelector('td[colspan]')) {
    salesTableBody.innerHTML = '';
  }

  // Check if sale already exists in table to avoid double render on manual sync click
  const existingRows = salesTableBody.querySelectorAll('tr');
  for (const row of existingRows) {
    if (row.innerHTML.includes(sale.id.slice(0, 8))) {
      return; // Already rendered, skip
    }
  }

  // Prepend new row
  const rowHtml = renderSaleRowHtml(sale, true);
  salesTableBody.insertAdjacentHTML('afterbegin', rowHtml);

  // Recalculate KPI summary metrics dynamically
  const currentRevenue = parseFloat(statRevenue.innerText.replace('Rs. ', '').replace(/,/g, '')) || 0;
  statRevenue.innerText = formatCurrency(currentRevenue + sale.total_amount);

  const currentSalesCount = parseInt(statSales.innerText) || 0;
  statSales.innerText = currentSalesCount + 1;

  // Enforce table row count limits
  const updatedRows = salesTableBody.querySelectorAll('tr');
  if (updatedRows.length > 50) {
    updatedRows[updatedRows.length - 1].remove();
  }

  initIcons();
}

// Initial pull and periodic loop
async function init() {
  await refreshData();
  connectWS();
  
  // Poll statistics for real-time dashboards
  setInterval(async () => {
    await fetchStats();
    await fetchCatalog();
    
    // Only query heavy transaction logs from db if WebSockets connection is down
    if (!socketActive) {
      await fetchSales();
    }
  }, 3000);
}

init();
