import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.NODE_ENV === 'test' 
  ? ':memory:' 
  : path.join(__dirname, 'data', 'local_pos.sqlite');

let dbConnection = null;

export async function getDb() {
  if (dbConnection) return dbConnection;

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  dbConnection = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await dbConnection.run('PRAGMA foreign_keys = ON;');

  // Create tables
  await dbConnection.exec(`
    CREATE TABLE IF NOT EXISTS register_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      register_id TEXT NOT NULL,
      opening_float REAL NOT NULL,
      closing_cash REAL,
      actual_cash REAL,
      discrepancy REAL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      status TEXT DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT UNIQUE NOT NULL,
      price REAL NOT NULL,
      stock_quantity INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      register_id TEXT NOT NULL,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      synced_at TEXT,
      shift_id INTEGER REFERENCES register_shifts(id)
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS exchange_rates (
      currency TEXT PRIMARY KEY,
      rate REAL NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Seed default exchange rates (relative to native LKR)
  try {
    const now = new Date().toISOString();
    await dbConnection.run("INSERT OR IGNORE INTO exchange_rates (currency, rate, updated_at) VALUES ('LKR', 1.0, ?)", [now]);
    await dbConnection.run("INSERT OR IGNORE INTO exchange_rates (currency, rate, updated_at) VALUES ('USD', 300.0, ?)", [now]);
    await dbConnection.run("INSERT OR IGNORE INTO exchange_rates (currency, rate, updated_at) VALUES ('EUR', 330.0, ?)", [now]);
    await dbConnection.run("INSERT OR IGNORE INTO exchange_rates (currency, rate, updated_at) VALUES ('GBP', 390.0, ?)", [now]);
  } catch (e) {
    console.error("Error seeding default exchange rates:", e);
  }

  // Migrate sales column if DB was already created in previous runs
  try {
    await dbConnection.run('ALTER TABLE sales ADD COLUMN shift_id INTEGER REFERENCES register_shifts(id);');
    console.log("Database schema successfully altered to include shift_id.");
  } catch (e) {
    // Column already exists, safe to ignore
  }

  // Seed initial products if DB is empty
  const count = await dbConnection.get('SELECT COUNT(*) as count FROM products');
  if (count.count === 0) {
    const now = new Date().toISOString();
    const initialProducts = [
      { id: 1, name: "Organic Coffee Beans (500g)", sku: "COF-ORG-500", price: 15.99, stock_quantity: 50, updated_at: now },
      { id: 2, name: "Handcrafted Wooden Souvenir", sku: "SOU-WDN-01", price: 24.50, stock_quantity: 30, updated_at: now },
      { id: 3, name: "Reusable Bamboo Water Bottle", sku: "BOT-BAM-01", price: 18.00, stock_quantity: 40, updated_at: now },
      { id: 4, name: "Local Rainforest Honey", sku: "HNY-LCL-250", price: 12.50, stock_quantity: 60, updated_at: now },
      { id: 5, name: "Eco-Friendly Sunscreen SPF 50", sku: "SUN-ECO-50", price: 22.00, stock_quantity: 25, updated_at: now },
      { id: 6, name: "Artisan Woven Beach Tote", sku: "BAG-ART-01", price: 35.00, stock_quantity: 15, updated_at: now }
    ];

    for (const p of initialProducts) {
      await dbConnection.run(
        'INSERT INTO products (id, name, sku, price, stock_quantity, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [p.id, p.name, p.sku, p.price, p.stock_quantity, p.updated_at]
      );
    }
    console.log("Local SQLite database seeded successfully!");
  }

  return dbConnection;
}
