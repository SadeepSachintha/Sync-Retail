import pg from 'pg';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres_pass',
  database: process.env.DB_NAME || 'sync_retail_cloud',
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new Pool(dbConfig);
export let useSqlite = false;
let sqliteDb = null;

// Helper to delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function query(text, params) {
  if (useSqlite) {
    // Translate PG placeholders ($1, $2) to SQLite placeholders (?)
    const sqliteQuery = text.replace(/\$\d+/g, '?');
    const isQuery = /select|returning/i.test(sqliteQuery);
    if (isQuery) {
      const rows = await sqliteDb.all(sqliteQuery, params || []);
      // SQLite returning numeric types might differ slightly, but JS numbers are same
      return { rows };
    } else {
      const result = await sqliteDb.run(sqliteQuery, params || []);
      return { rows: [], lastID: result.lastID, changes: result.changes };
    }
  } else {
    return await pool.query(text, params);
  }
}

// Get transaction client (abstracts pg client vs sqlite db connection)
export async function getTransactionClient() {
  if (useSqlite) {
    return {
      query: (text, params) => query(text, params),
      release: () => {} // No-op in SQLite
    };
  } else {
    const client = await pool.connect();
    return client;
  }
}

export async function initDb() {
  let retries = 3;
  let pgConnected = false;

  // Only try connecting to Postgres if DB_HOST env var is defined or we are not in standalone local mode
  if (process.env.DB_HOST || process.env.NODE_ENV === 'production') {
    while (retries > 0) {
      try {
        console.log(`Connecting to Postgres at ${dbConfig.host}:${dbConfig.port}... (Retries left: ${retries})`);
        const client = await pool.connect();
        client.release();
        console.log('Connected to PostgreSQL successfully!');
        pgConnected = true;
        break;
      } catch (err) {
        console.error('Failed to connect to Postgres. Retrying in 2 seconds...', err.message);
        retries--;
        await delay(2000);
      }
    }
  }

  if (pgConnected) {
    useSqlite = false;
    await initPostgresSchema();
  } else {
    console.log('\n[WARNING] PostgreSQL server is unreachable or not configured.');
    console.log('Falling back to SQLite database for Cloud Central!\n');
    useSqlite = true;
    await initSqliteSchema();
  }

  await seedProductsIfEmpty();
}

async function initPostgresSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        sku VARCHAR(50) UNIQUE NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        stock_quantity INTEGER NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sales (
        id UUID PRIMARY KEY,
        register_id VARCHAR(50) NOT NULL,
        total_amount NUMERIC(10, 2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL,
        synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id),
        quantity INTEGER NOT NULL,
        unit_price NUMERIC(10, 2) NOT NULL
      );
    `);
  } finally {
    client.release();
  }
}

import fs from 'fs';

async function initSqliteSchema() {
  const sqliteDbPath = path.join(__dirname, 'data', 'cloud_central.sqlite');
  
  // Ensure data folder exists
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  sqliteDb = await open({
    filename: sqliteDbPath,
    driver: sqlite3.Database
  });

  await sqliteDb.run('PRAGMA foreign_keys = ON;');
  
  await sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      price REAL NOT NULL,
      stock_quantity INTEGER NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      register_id TEXT NOT NULL,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL
    );
  `);
}

async function seedProductsIfEmpty() {
  const productCountResult = await query('SELECT COUNT(*) as count FROM products');
  const count = parseInt(productCountResult.rows[0].count);

  if (count === 0) {
    const now = new Date().toISOString();
    const initialProducts = [
      { id: 1, name: "Organic Coffee Beans (500g)", sku: "COF-ORG-500", price: 15.99, stock_quantity: 50 },
      { id: 2, name: "Handcrafted Wooden Souvenir", sku: "SOU-WDN-01", price: 24.50, stock_quantity: 30 },
      { id: 3, name: "Reusable Bamboo Water Bottle", sku: "BOT-BAM-01", price: 18.00, stock_quantity: 40 },
      { id: 4, name: "Local Rainforest Honey", sku: "HNY-LCL-250", price: 12.50, stock_quantity: 60 },
      { id: 5, name: "Eco-Friendly Sunscreen SPF 50", sku: "SUN-ECO-50", price: 22.00, stock_quantity: 25 },
      { id: 6, name: "Artisan Woven Beach Tote", sku: "BAG-ART-01", price: 35.00, stock_quantity: 15 }
    ];

    for (const p of initialProducts) {
      if (useSqlite) {
        await query(
          'INSERT INTO products (id, name, sku, price, stock_quantity, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [p.id, p.name, p.sku, p.price, p.stock_quantity, now]
        );
      } else {
        await query(
          'INSERT INTO products (id, name, sku, price, stock_quantity, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
          [p.id, p.name, p.sku, p.price, p.stock_quantity, now]
        );
      }
    }
    console.log(`Central Cloud database products seeded successfully! (Database: ${useSqlite ? 'SQLite' : 'Postgres'})`);
  }
}
