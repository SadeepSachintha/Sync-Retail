import express from 'express';
import cors from 'cors';
import { query, getTransactionClient, initDb } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ----------------------------------------------------
// SYNCHRONIZATION API
// ----------------------------------------------------

// Endpoint for POS to download the latest product catalog
app.get('/api/sync/catalog', async (req, res) => {
  try {
    const result = await query('SELECT * FROM products ORDER BY id ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint for POS to upload transactions
app.post('/api/sync/sales', async (req, res) => {
  const { registerId, sales } = req.body;
  if (!sales || !Array.isArray(sales)) {
    return res.status(400).json({ error: "Invalid sync payload: 'sales' array required" });
  }

  console.log(`Received synchronization request from register: ${registerId}. Processing ${sales.length} sale(s)...`);

  const processedSales = [];
  const client = await getTransactionClient();

  try {
    for (const sale of sales) {
      // 1. Check for duplicate sale (Idempotency check)
      const checkSale = await client.query('SELECT id FROM sales WHERE id = $1', [sale.id]);
      if (checkSale.rows.length > 0) {
        console.log(`Sale ${sale.id} already processed. Skipping.`);
        continue;
      }

      await client.query('BEGIN');

      // 2. Insert Sale metadata with explicit synced_at
      const syncedAt = new Date().toISOString();
      await client.query(
        `INSERT INTO sales (id, register_id, total_amount, payment_method, created_at, synced_at) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [sale.id, registerId, sale.total_amount, sale.payment_method, sale.created_at, syncedAt]
      );

      // 3. Insert items and decrement cloud stock
      for (const item of sale.items) {
        await client.query(
          `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price) 
           VALUES ($1, $2, $3, $4)`,
          [sale.id, item.productId, item.quantity, item.unitPrice]
        );

        // Decrement product stock
        await client.query(
          'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
          [item.quantity, item.productId]
        );
      }

      await client.query('COMMIT');
      processedSales.push(sale.id);
      console.log(`Sale ${sale.id} successfully synced.`);
    }

    res.json({
      status: "success",
      syncedCount: processedSales.length,
      syncedIds: processedSales
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error("Synchronization transaction error:", error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ----------------------------------------------------
// ADMIN DASHBOARD API
// ----------------------------------------------------

// Get aggregated dashboard statistics
app.get('/api/admin/stats', async (req, res) => {
  try {
    // Total Revenue & sales count
    const summaryRes = await query(
      'SELECT COALESCE(SUM(total_amount), 0) as total_revenue, COUNT(*) as sales_count FROM sales'
    );
    const { total_revenue, sales_count } = summaryRes.rows[0];

    // Distinct register count
    const registersRes = await query('SELECT COUNT(DISTINCT register_id) as count FROM sales');
    const registerCount = registersRes.rows[0].count;

    // Items sold by product
    const itemsRes = await query(`
      SELECT p.name, COALESCE(SUM(si.quantity), 0) as units_sold
      FROM products p
      LEFT JOIN sale_items si ON p.id = si.product_id
      GROUP BY p.id, p.name
      ORDER BY units_sold DESC
    `);

    res.json({
      totalRevenue: parseFloat(total_revenue),
      salesCount: parseInt(sales_count),
      registerCount: parseInt(registerCount),
      productPerformance: itemsRes.rows.map(row => ({
        name: row.name,
        units_sold: parseInt(row.units_sold)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get detailed sales log for dashboard table
app.get('/api/admin/sales', async (req, res) => {
  try {
    // Database-agnostic query & JS joining to avoid Postgres/SQLite JSON compatibility issues
    const salesRes = await query(
      'SELECT id, register_id, total_amount, payment_method, created_at, synced_at FROM sales ORDER BY created_at DESC'
    );
    
    const itemsRes = await query(
      'SELECT si.sale_id, p.name, si.quantity, si.unit_price as price FROM sale_items si JOIN products p ON p.id = si.product_id'
    );

    const itemsBySale = {};
    for (const item of itemsRes.rows) {
      if (!itemsBySale[item.sale_id]) {
        itemsBySale[item.sale_id] = [];
      }
      itemsBySale[item.sale_id].push({
        name: item.name,
        quantity: parseInt(item.quantity),
        price: parseFloat(item.price)
      });
    }

    const sales = salesRes.rows.map(s => ({
      id: s.id,
      register_id: s.register_id,
      total_amount: parseFloat(s.total_amount),
      payment_method: s.payment_method,
      created_at: s.created_at,
      synced_at: s.synced_at,
      items: itemsBySale[s.id] || []
    }));

    res.json(sales);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create or update a product from dashboard
app.post('/api/admin/products', async (req, res) => {
  const { id, name, sku, price, stock_quantity } = req.body;
  if (!name || !sku || !price || stock_quantity === undefined) {
    return res.status(400).json({ error: "Missing required product fields" });
  }

  const now = new Date().toISOString();

  try {
    if (id) {
      // Update
      const result = await query(
        `UPDATE products 
         SET name = $1, sku = $2, price = $3, stock_quantity = $4, updated_at = $5 
         WHERE id = $6 
         RETURNING *`,
        [name, sku, price, stock_quantity, now, id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Product not found" });
      }
      res.json(result.rows[0]);
    } else {
      // Create new product
      const result = await query(
        `INSERT INTO products (name, sku, price, stock_quantity, updated_at) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING *`,
        [name, sku, price, stock_quantity, now]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initialize database schema and start server
initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Cloud Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Server failed to start due to database init error:', err);
    process.exit(1);
  });
