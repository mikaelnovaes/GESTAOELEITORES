/**
 * backend/config/database.js
 * Conexão com PostgreSQL — Render / Railway
 *
 * IMPORTANTE: Nunca colocar credenciais no código.
 * Use APENAS process.env.DATABASE_URL (configurado no painel do Render).
 */

'use strict';

const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error(
    '[DB] DATABASE_URL não definida.\n' +
    'No Render: adicione um PostgreSQL ao serviço e a variável será injetada automaticamente.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message);
});

const db = {
  async query(text, params = []) {
    const start = Date.now();
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      if (duration > 1000) {
        console.warn(`[DB] Query lenta (${duration}ms):`, text.substring(0, 100));
      }
      return result;
    } catch (err) {
      console.error('[DB] Erro na query:', err.message);
      // Não logar o text completo em produção (pode ter dados sensíveis)
      if (process.env.NODE_ENV !== 'production') {
        console.error('[DB] Query:', text.substring(0, 200));
      }
      throw err;
    }
  },

  async transaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async ping() {
    const result = await this.query('SELECT NOW() AS now');
    return result.rows[0].now;
  },

  async end() {
    await pool.end();
  },
};

module.exports = db;
