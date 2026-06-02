'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err.message);
  process.exit(1);
});

/**
 * Execute a parameterised query and return the result.
 * @param {string} text   - SQL statement
 * @param {Array}  params - Bound parameters
 */
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.debug('query', { text, duration, rows: res.rowCount });
  }
  return res;
}

/**
 * Acquire a client for multi-statement transactions.
 * Caller is responsible for calling client.release().
 */
async function getClient() {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  // Wrap to log in dev
  client.query = (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug('transaction query', args[0]);
    }
    return originalQuery(...args);
  };
  return client;
}

module.exports = { pool, query, getClient };
