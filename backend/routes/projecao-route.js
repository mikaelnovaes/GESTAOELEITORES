/**
 * backend/routes/projecao-route.js
 * Projeção de Votos — calcula intenção de voto da base cadastrada
 */

'use strict';

const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/* ── GET /api/projecao/resumo ────────────────────────────────
   Retorna contagens por intenção de voto + projeção geral     */
router.get('/resumo', async (req, res) => {
  try {
    const tid = req.user.tenant_id;

    // Contagem por intenção
    const r = await db.query(`
      SELECT
        COUNT(*)::INT                                                             AS total,
        COUNT(*) FILTER (WHERE intencao_voto = 'confirmado')::INT                AS confirmados,
        COUNT(*) FILTER (WHERE intencao_voto = 'provavel')::INT                  AS provaveis,
        COUNT(*) FILTER (WHERE intencao_voto = 'indeciso')::INT                  AS indecisos,
        COUNT(*) FILTER (WHERE intencao_voto = 'risco')::INT                     AS em_risco,
        COUNT(*) FILTER (WHERE intencao_voto = 'contra')::INT                    AS contra,
        COUNT(*) FILTER (WHERE intencao_voto IS NULL)::INT                       AS sem_classificacao,
        COUNT(*) FILTER (WHERE ultimo_contato >= NOW() - INTERVAL '7 days')::INT AS contatados_semana,
        COUNT(*) FILTER (WHERE ultimo_contato < NOW() - INTERVAL '30 days'
                           OR ultimo_contato IS NULL)::INT                       AS sem_contato_30d
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
    `, [tid]);

    // Meta de votos configurada
    const metaR = await db.query(
      `SELECT meta, candidato, cargo FROM meta_votos WHERE tenant_id = $1`,
      [tid]
    );
    const meta = metaR.rows[0] || { meta: 0, candidato: null, cargo: null };

    const d = r.rows[0];
    const projecao_otimista  = d.confirmados + d.provaveis;
    const projecao_pessimista = d.confirmados;
    const pct_meta_otimista  = meta.meta > 0 ? Math.round(projecao_otimista  / meta.meta * 100) : null;
    const pct_meta_pessimista = meta.meta > 0 ? Math.round(projecao_pessimista / meta.meta * 100) : null;

    res.json({
      ...d,
      projecao_otimista,
      projecao_pessimista,
      meta: meta.meta,
      candidato: meta.candidato,
      cargo: meta.cargo,
      pct_meta_otimista,
      pct_meta_pessimista,
    });
  } catch (err) {
    console.error('[PROJECAO] GET /resumo:', err);
    res.status(500).json({ error: 'Erro ao calcular projeção.' });
  }
});

/* ── GET /api/projecao/por-bairro ────────────────────────────
   Projeção segmentada por bairro                              */
router.get('/por-bairro', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        COALESCE(bairro, '— Sem bairro') AS bairro,
        COUNT(*)::INT                                          AS total,
        COUNT(*) FILTER (WHERE intencao_voto = 'confirmado')::INT AS confirmados,
        COUNT(*) FILTER (WHERE intencao_voto = 'provavel')::INT   AS provaveis,
        COUNT(*) FILTER (WHERE intencao_voto = 'risco')::INT      AS em_risco,
        COUNT(*) FILTER (WHERE intencao_voto IS NULL)::INT        AS sem_class
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
      GROUP BY bairro
      ORDER BY (COUNT(*) FILTER (WHERE intencao_voto = 'confirmado') +
                COUNT(*) FILTER (WHERE intencao_voto = 'provavel')) DESC
      LIMIT 20
    `, [req.user.tenant_id]);

    res.json(r.rows);
  } catch (err) {
    console.error('[PROJECAO] GET /por-bairro:', err);
    res.status(500).json({ error: 'Erro ao buscar projeção por bairro.' });
  }
});

/* ── GET /api/projecao/por-lideranca ─────────────────────────
   Projeção por liderança + % da meta individual               */
router.get('/por-lideranca', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        COALESCE(l.nome, '— Sem liderança') AS lideranca,
        l.id                                AS lideranca_id,
        l.expectativa_total                 AS meta_lideranca,
        COUNT(e.id)::INT                                            AS total,
        COUNT(e.id) FILTER (WHERE e.intencao_voto = 'confirmado')::INT AS confirmados,
        COUNT(e.id) FILTER (WHERE e.intencao_voto = 'provavel')::INT   AS provaveis,
        COUNT(e.id) FILTER (WHERE e.intencao_voto = 'risco')::INT      AS em_risco
      FROM eleitores e
      LEFT JOIN liderancas l ON l.id = e.lideranca_id AND l.tenant_id = e.tenant_id
      WHERE e.tenant_id = $1 AND e.ativo = TRUE
      GROUP BY l.id, l.nome, l.expectativa_total
      ORDER BY (COUNT(e.id) FILTER (WHERE e.intencao_voto = 'confirmado') +
                COUNT(e.id) FILTER (WHERE e.intencao_voto = 'provavel')) DESC
    `, [req.user.tenant_id]);

    res.json(r.rows.map(row => ({
      ...row,
      projecao: row.confirmados + row.provaveis,
      pct_meta: row.meta_lideranca > 0
        ? Math.round((row.confirmados + row.provaveis) / row.meta_lideranca * 100)
        : null,
    })));
  } catch (err) {
    console.error('[PROJECAO] GET /por-lideranca:', err);
    res.status(500).json({ error: 'Erro ao buscar projeção por liderança.' });
  }
});

/* ── PUT /api/projecao/meta ─────────────────────────────────
   Atualiza a meta de votos do tenant                          */
router.put('/meta',
  requireAdmin,
  [
    body('meta').isInt({ min: 0, max: 9999999 }),
    body('candidato').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('cargo').optional({ nullable: true }).isString().isLength({ max: 100 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      await db.query(`
        INSERT INTO meta_votos (tenant_id, meta, candidato, cargo, atualizado_em)
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (tenant_id) DO UPDATE
          SET meta = $2, candidato = $3, cargo = $4, atualizado_em = NOW()
      `, [req.user.tenant_id, req.body.meta, req.body.candidato || null, req.body.cargo || null]);
      res.json({ success: true });
    } catch (err) {
      console.error('[PROJECAO] PUT /meta:', err);
      res.status(500).json({ error: 'Erro ao salvar meta.' });
    }
  }
);

/* ── PATCH /api/projecao/eleitor/:id ────────────────────────
   Atualiza intenção de voto de um eleitor individual          */
router.patch('/eleitor/:id',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('intencao_voto').isIn(['confirmado','provavel','indeciso','risco','contra','']),
    body('ultimo_contato').optional({ nullable: true }).isISO8601(),
    body('meta_votos_notas').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const intencao = req.body.intencao_voto || null;
      const r = await db.query(`
        UPDATE eleitores
        SET intencao_voto     = $1,
            ultimo_contato    = COALESCE($2::TIMESTAMPTZ, ultimo_contato),
            meta_votos_notas  = COALESCE($3, meta_votos_notas),
            atualizado_em     = NOW()
        WHERE id = $4 AND tenant_id = $5 AND ativo = TRUE
        RETURNING id
      `, [intencao, req.body.ultimo_contato || null, req.body.meta_votos_notas || null,
          req.params.id, req.user.tenant_id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Eleitor não encontrado.' });
      res.json({ success: true });
    } catch (err) {
      console.error('[PROJECAO] PATCH /eleitor/:id:', err);
      res.status(500).json({ error: 'Erro ao atualizar intenção.' });
    }
  }
);

/* ── GET /api/projecao/eleitores ────────────────────────────
   Lista eleitores filtrados por intenção de voto              */
router.get('/eleitores',
  [
    query('intencao').optional().isIn(['confirmado','provavel','indeciso','risco','contra','sem_class']),
    query('bairro').optional().isString().isLength({ max: 100 }),
    query('lideranca_id').optional().isInt({ min: 1 }).toInt(),
    query('sem_contato_dias').optional().isInt({ min: 1, max: 365 }).toInt(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const conds = ['e.tenant_id = $1', 'e.ativo = TRUE'];
      const params = [req.user.tenant_id];
      let p = 2;

      if (req.query.intencao === 'sem_class') {
        conds.push('e.intencao_voto IS NULL');
      } else if (req.query.intencao) {
        conds.push(`e.intencao_voto = $${p++}`);
        params.push(req.query.intencao);
      }
      if (req.query.bairro) {
        conds.push(`e.bairro ILIKE $${p++}`);
        params.push(`%${req.query.bairro}%`);
      }
      if (req.query.lideranca_id) {
        conds.push(`e.lideranca_id = $${p++}`);
        params.push(req.query.lideranca_id);
      }
      if (req.query.sem_contato_dias) {
        conds.push(`(e.ultimo_contato < NOW() - ($${p++} || ' days')::INTERVAL OR e.ultimo_contato IS NULL)`);
        params.push(req.query.sem_contato_dias);
      }

      const r = await db.query(`
        SELECT e.id, e.nome, e.telefone, e.bairro, e.cidade,
               e.intencao_voto, e.ultimo_contato, e.meta_votos_notas,
               l.nome AS lideranca_nome
        FROM eleitores e
        LEFT JOIN liderancas l ON l.id = e.lideranca_id AND l.tenant_id = e.tenant_id
        WHERE ${conds.join(' AND ')}
        ORDER BY e.nome ASC
        LIMIT 500
      `, params);

      res.json(r.rows.map(row => ({ ...row, id: Number(row.id) })));
    } catch (err) {
      console.error('[PROJECAO] GET /eleitores:', err);
      res.status(500).json({ error: 'Erro ao buscar eleitores.' });
    }
  }
);

module.exports = router;
