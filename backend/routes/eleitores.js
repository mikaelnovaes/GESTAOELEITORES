/**
 * backend/routes/eleitores.js 
 * CRUD de eleitores — multi-tenant + segurança reforçada
 */

'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const { body, query, param, validationResult } = require('express-validator');
const db      = require('../config/database');
const geocoder = require('../services/geocoder');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

/* ── HELPERS ─────────────────────────────────────────────── */
function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

function clean(v, max = 200) {
  if (!v) return null;
  return String(v).replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').trim().substring(0, max) || null;
}

async function logAudit(req, acao, detalhes) {
  try {
    await db.query(
      `INSERT INTO audit_log (usuario_id, tenant_id, acao, detalhes, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, req.user.tenant_id, acao, JSON.stringify(detalhes || {}), req.ip || null]
    );
  } catch (e) {
    console.error('[AUDIT] Falha ao gravar:', e.message);
  }
}

/* ── GET /api/eleitores ──────────────────────────────────── */
router.get('/',
  [
    query('nome').optional().isString().isLength({ max: 200 }).trim(),
    query('bairro').optional().isString().isLength({ max: 100 }).trim(),
    query('cidade').optional().isString().isLength({ max: 100 }).trim(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('pageSize').optional().isInt({ min: 1, max: 200 }).toInt(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;

    const nome     = req.query.nome     || null;
    const bairro   = req.query.bairro   || null;
    const cidade   = req.query.cidade   || null;
    const page     = parseInt(req.query.page     || '1');
    const pageSize = parseInt(req.query.pageSize || '50');
    const offset   = (page - 1) * pageSize;

    try {
      // Sempre filtra por tenant + ativo
      const conditions = ['ativo = TRUE', 'tenant_id = $1'];
      const params     = [req.user.tenant_id];
      let   pIdx       = 2;

      if (nome)   { conditions.push(`nome   ILIKE $${pIdx++}`); params.push(`%${nome}%`); }
      if (bairro) { conditions.push(`bairro ILIKE $${pIdx++}`); params.push(`%${bairro}%`); }
      if (cidade) { conditions.push(`cidade ILIKE $${pIdx++}`); params.push(`%${cidade}%`); }

      const where = conditions.join(' AND ');

      const countR = await db.query(
        `SELECT COUNT(*)::INT AS total FROM eleitores WHERE ${where}`,
        params
      );
      const total = countR.rows[0].total;

   const dataR = await db.query(
        `SELECT e.id, e.nome, e.data_nascimento, e.telefone, e.email,
                e.endereco, e.numero, e.bairro, e.cidade,
                e.titulo_eleitor, e.secao, e.escola_votacao,
                e.foto_url, e.lideranca_id, e.criado_em, e.atualizado_em,
                l.nome AS lideranca_nome
         FROM eleitores e
         LEFT JOIN liderancas l ON l.id = e.lideranca_id AND l.tenant_id = e.tenant_id
         WHERE ${where}
         ORDER BY e.nome ASC
         LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
        [...params, pageSize, offset]
      );

      res.json({
        data:     dataR.rows.map(r => ({ ...r, id: Number(r.id) })),  // ← ID sempre number
        total,
        page,
        pageSize,
        pages: Math.ceil(total / pageSize),
      });

    } catch (err) {
      console.error('[ELEITORES] GET /:', err);
      res.status(500).json({ error: 'Erro ao buscar eleitores.' });
    }
  }
);

/* ── GET /api/eleitores/:id ──────────────────────────────── */
router.get('/:id',
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
    const r = await db.query(
        `SELECT e.id, e.nome, e.data_nascimento, e.telefone, e.email,
                e.endereco, e.numero, e.bairro, e.cidade,
                e.titulo_eleitor, e.secao, e.escola_votacao, e.foto_url,
                e.lideranca_id, e.criado_em, e.atualizado_em,
                l.nome AS lideranca_nome
         FROM eleitores e
         LEFT JOIN liderancas l ON l.id = e.lideranca_id AND l.tenant_id = e.tenant_id
         WHERE e.id = $1 AND e.tenant_id = $2 AND e.ativo = TRUE`,
        [req.params.id, req.user.tenant_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Eleitor não encontrado.' });
      const row = r.rows[0];
      row.id = Number(row.id);
      res.json(row);
    } catch {
      res.status(500).json({ error: 'Erro ao buscar eleitor.' });
    }
  }
);

/* ── POST /api/eleitores ─────────────────────────────────── */
router.post('/',
  [
    body('nome').trim().notEmpty().withMessage('Nome obrigatório.').isLength({ max: 200 }),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail().isLength({ max: 200 }),
    body('telefone').optional({ nullable: true }).isLength({ max: 20 }),
    body('data_nascimento').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('endereco').optional({ nullable: true }).isLength({ max: 300 }),
    body('numero').optional({ nullable: true }).isLength({ max: 20 }),
    body('bairro').optional({ nullable: true }).isLength({ max: 100 }),
    body('cidade').optional({ nullable: true }).isLength({ max: 100 }),
    body('titulo_eleitor').optional({ nullable: true }).isLength({ max: 20 }),
    body('secao').optional({ nullable: true }).isLength({ max: 10 }),
    body('escola_votacao').optional({ nullable: true }).isLength({ max: 200 }),
    body('lideranca_id').optional({ nullable: true, checkFalsy: true }).toInt().isInt({ min: 1 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(
        `INSERT INTO eleitores
           (tenant_id, nome, data_nascimento, telefone, email, endereco, numero,
            bairro, cidade, titulo_eleitor, secao, escola_votacao, lideranca_id, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, criado_em`,
        [
          req.user.tenant_id,
          clean(d.nome, 200),
          d.data_nascimento || null,
          clean(d.telefone, 20),
          clean(d.email, 200)?.toLowerCase() || null,
          clean(d.endereco, 300),
          clean(d.numero, 20),
          clean(d.bairro, 100),
          clean(d.cidade, 100),
          clean(d.titulo_eleitor, 20),
          clean(d.secao, 10),
          clean(d.escola_votacao, 200),
          d.lideranca_id ? Number(d.lideranca_id) : null,
          req.user.id,
        ]
      );
     const created = r.rows[0];
      // Geocodifica em background (não bloqueia resposta)
      geocoder.geocodeInBackground(db, 'eleitores', Number(created.id), req.user.tenant_id);
      res.status(201).json({ id: Number(created.id), criado_em: created.criado_em });
    } catch (err) {
      console.error('[ELEITORES] POST /:', err);
      res.status(500).json({ error: 'Erro ao criar eleitor.' });
    }
  }
);

/* ── PUT /api/eleitores/:id ──────────────────────────────── */
router.put('/:id',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('email').optional({ nullable: true, checkFalsy: true }).isEmail().isLength({ max: 200 }),
    body('data_nascimento').optional({ nullable: true, checkFalsy: true }).isDate(),
    body('lideranca_id').optional({ nullable: true, checkFalsy: true }).toInt().isInt({ min: 1 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(
        `UPDATE eleitores SET
           nome = $1, data_nascimento = $2, telefone = $3,
           email = $4, endereco = $5, numero = $6,
           bairro = $7, cidade = $8, titulo_eleitor = $9,
           secao = $10, escola_votacao = $11, lideranca_id = $12,
           atualizado_em = NOW()
         WHERE id = $13 AND tenant_id = $14 AND ativo = TRUE
         RETURNING id`,
        [
          clean(d.nome, 200),
          d.data_nascimento || null,
          clean(d.telefone, 20),
          clean(d.email, 200)?.toLowerCase() || null,
          clean(d.endereco, 300),
          clean(d.numero, 20),
          clean(d.bairro, 100),
          clean(d.cidade, 100),
          clean(d.titulo_eleitor, 20),
          clean(d.secao, 10),
          clean(d.escola_votacao, 200),
          d.lideranca_id || null,
          req.params.id,
          req.user.tenant_id,
        ]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Eleitor não encontrado.' });
     await db.query(
        `UPDATE eleitores SET geocoded_status='pending' WHERE id=$1 AND tenant_id=$2`,
        [req.params.id, req.user.tenant_id]
      );
      geocoder.geocodeInBackground(db, 'eleitores', Number(req.params.id), req.user.tenant_id);
      res.json({ success: true });
    } catch (err) {
      console.error('[ELEITORES] PUT /:id:', err);
      res.status(500).json({ error: 'Erro ao atualizar eleitor.' });
    }
  }
);

/* ── DELETE /api/eleitores/:id (soft delete, só admin) ───── */
router.delete('/:id',
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).toInt(),
    query('hard').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const hard = req.query.hard === true;

    try {
      let r;
      if (hard) {
        // Hard delete (irreversível) — só por admin com ?hard=true explícito
        r = await db.query(
          `DELETE FROM eleitores WHERE id = $1 AND tenant_id = $2 RETURNING id`,
          [req.params.id, req.user.tenant_id]
        );
        await logAudit(req, 'ELEITOR_HARD_DELETE', { id: req.params.id });
      } else {
        r = await db.query(
          `UPDATE eleitores SET ativo = FALSE, atualizado_em = NOW()
           WHERE id = $1 AND tenant_id = $2 AND ativo = TRUE RETURNING id`,
          [req.params.id, req.user.tenant_id]
        );
        await logAudit(req, 'ELEITOR_SOFT_DELETE', { id: req.params.id });
      }
      if (!r.rowCount) return res.status(404).json({ error: 'Eleitor não encontrado.' });
      res.json({ success: true });
    } catch (err) {
      console.error('[ELEITORES] DELETE /:id:', err);
      res.status(500).json({ error: 'Erro ao excluir eleitor.' });
    }
  }
);

/* ── POST /api/eleitores/admin/purge ──────────────────────
   EXCLUSÃO EM MASSA (todos eleitores do tenant)
   Requer:
     - admin
     - body.senha (reautenticação)
     - body.confirmacao === 'EXCLUIR-TUDO'
   Faz HARD delete apenas dos eleitores do próprio tenant.
─────────────────────────────────────────────────────────── */
router.post('/admin/purge',
  requireAdmin,
  [
    body('senha').isString().isLength({ min: 1, max: 200 }),
    body('confirmacao').equals('EXCLUIR-TUDO').withMessage('Confirmação inválida.'),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;

    try {
      // Reautenticação
      const u = await db.query(
        `SELECT senha_hash FROM usuarios WHERE id = $1 AND ativo = TRUE`,
        [req.user.id]
      );
      if (!u.rowCount) return res.status(401).json({ error: 'Usuário não encontrado.' });

      const ok = await bcrypt.compare(req.body.senha, u.rows[0].senha_hash);
      if (!ok) {
        await logAudit(req, 'PURGE_DENIED_BAD_PASSWORD', {});
        return res.status(401).json({ error: 'Senha incorreta.' });
      }

      // Conta antes
      const cR = await db.query(
        `SELECT COUNT(*)::INT AS total FROM eleitores WHERE tenant_id = $1`,
        [req.user.tenant_id]
      );
      const total = cR.rows[0].total;

      // Hard delete em transação
      await db.transaction(async (client) => {
        await client.query(
          `DELETE FROM eleitores WHERE tenant_id = $1`,
          [req.user.tenant_id]
        );
      });

      await logAudit(req, 'PURGE_EXECUTED', { total_eleitores_excluidos: total });
      res.json({ success: true, excluidos: total });

    } catch (err) {
      console.error('[ELEITORES] purge:', err);
      res.status(500).json({ error: 'Erro ao executar exclusão em massa.' });
    }
  }
);

/* ── POST /api/eleitores/importar (lote, só admin) ──────── */
router.post('/importar',
  requireAdmin,
  async (req, res) => {
    const records = req.body.records;
    if (!Array.isArray(records) || !records.length) {
      return res.status(400).json({ error: 'Nenhum registro enviado.' });
    }
    if (records.length > 10000) {
      return res.status(400).json({ error: 'Máximo de 10.000 registros por importação.' });
    }

    let imported = 0, failed = 0;
    const errors = [];

    try {
      await db.transaction(async (client) => {
        for (const raw of records) {
          if (!raw.nome?.trim()) { failed++; continue; }
          // SAVEPOINT isola o erro: se um registro falhar, os demais continuam OK
          await client.query('SAVEPOINT row_save');
          try {
            await client.query(
              `INSERT INTO eleitores
                 (tenant_id, nome, data_nascimento, telefone, email, endereco, numero,
                  bairro, cidade, titulo_eleitor, secao, escola_votacao, criado_por)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                req.user.tenant_id,
                clean(raw.nome, 200),
                raw.data_nascimento || null,
                clean(raw.telefone, 20),
                clean(raw.email, 200)?.toLowerCase() || null,
                clean(raw.endereco, 300),
                clean(raw.numero, 20),
                clean(raw.bairro, 100),
                clean(raw.cidade, 100),
                clean(raw.titulo_eleitor, 20),
                clean(raw.secao, 10),
                clean(raw.escola_votacao, 200),
                req.user.id,
              ]
            );
            await client.query('RELEASE SAVEPOINT row_save');
            imported++;
          } catch (rowErr) {
            await client.query('ROLLBACK TO SAVEPOINT row_save');
            failed++;
            if (errors.length < 10) errors.push({ nome: raw.nome, error: rowErr.message });
          }
        }
      });

      await logAudit(req, 'ELEITORES_IMPORT', { imported, failed });
           (async () => {
        try {
          const r = await db.query(
            `SELECT id FROM eleitores
             WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status = 'pending'
             ORDER BY criado_em DESC LIMIT 500`,
            [req.user.tenant_id]
          );
          for (const row of r.rows) {
            await geocoder.geocodeAndUpdate(db, 'eleitores', Number(row.id), req.user.tenant_id);
          }
        } catch (e) {
          console.error('[ELEITORES] geocode pós-importação:', e.message);
        }
      })();
      res.json({ imported, failed, errors });
    } catch (err) {
      console.error('[ELEITORES] POST /importar:', err);
      res.status(500).json({ error: 'Erro na importação.' });
    }
  }
);

/* ── GET /api/eleitores/meta/stats ───────────────────────── */
router.get('/meta/stats', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        COUNT(*)::INT                                              AS total_ativos,
        COUNT(*) FILTER (WHERE telefone IS NOT NULL)::INT          AS com_telefone,
        COUNT(*) FILTER (WHERE email    IS NOT NULL)::INT          AS com_email,
        COUNT(DISTINCT bairro) FILTER (WHERE bairro IS NOT NULL)::INT AS bairros,
        COUNT(DISTINCT cidade) FILTER (WHERE cidade IS NOT NULL)::INT AS cidades
      FROM eleitores WHERE tenant_id = $1 AND ativo = TRUE
    `, [req.user.tenant_id]);

    // Também total histórico (incluindo soft-deleted)
    const h = await db.query(
      `SELECT COUNT(*)::INT AS total_historico FROM eleitores WHERE tenant_id = $1`,
      [req.user.tenant_id]
    );

    res.json({ ...r.rows[0], total_historico: h.rows[0].total_historico });
  } catch {
    res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
});

module.exports = router;
