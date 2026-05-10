/**
 * backend/config/database.js
 * Conexão com PostgreSQL — Railway / Render
 *
 * Railway e Render fornecem a variável DATABASE_URL automaticamente
 * quando você adiciona um banco PostgreSQL ao projeto.
 * Formato: postgresql://user:password@host:port/dbname
 */

'use strict';

const { Pool } = require('pg');

/* ============================================================
   POOL DE CONEXÕES
   Railway/Render → variável DATABASE_URL gerada automaticamente
   ============================================================ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // connectionString: process.env.postgresql://gestao_eleitores_db_user:u7KyEncSDj49214CaSOBNOJ5eBeK2x5Q@dpg-d7vnl33eo5us73ettk7g-a/gestao_eleitores_db,

  // SSL obrigatório em produção (Railway e Render exigem)
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,

  // Pool settings
  max:                 10,
  idleTimeoutMillis:   30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message);
});

/* ============================================================
   API DO BANCO
   ============================================================ */
const db = {
  /**
   * Executa uma query parametrizada.
   * SEGURANÇA: SEMPRE use $1, $2... para parâmetros — nunca concatene strings.
   *
   * Exemplo:
   *   await db.query(
   *     'SELECT * FROM eleitores WHERE bairro = $1',
   *     ['Centro']
   *   );
   */
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
      console.error('[DB] Query:', text.substring(0, 200));
      throw err;
    }
  },

  /**
   * Executa múltiplas queries em transação atômica.
   *
   * Exemplo:
   *   await db.transaction(async (client) => {
   *     await client.query('INSERT INTO ...');
   *     await client.query('UPDATE ...');
   *   });
   */
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

  /** Testa a conexão com o banco */
  async ping() {
    const result = await this.query('SELECT NOW() AS now');
    return result.rows[0].now;
  },

  /** Fecha o pool (usado no graceful shutdown) */
  async end() {
    await pool.end();
  },
};

module.exports = db;
