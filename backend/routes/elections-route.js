/**
 * backend/routes/elections.js
 * CRUD de simulações eleitorais (Calculadora de Coeficiente Eleitoral)
 *
 * Regras:
 * - Multi-tenant: cada simulação pertence ao tenant do usuário
 * - Todos do mesmo tenant veem as simulações; campo criado_por registra autor
 * - Apenas admin e master podem criar/editar/excluir
 */

'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

/* ── HELPERS ─────────────────────────────────────────────── */
function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

function clean(v, max = 200) {
  if (v == null) return null;
  return String(v).replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').trim().substring(0, max) || null;
}

// Sanitiza estrutura de partidos para gravar no banco
// Aceita: [{id, nome, legenda, cor, candidatos: [{nome, votos}]}, ...]
function sanitizePartidos(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 50).map((p, idx) => ({
    id:       Number.isFinite(+p?.id) ? +p.id : idx,
    nome:     clean(p?.nome, 100) || '',
    legenda:  Math.max(0, Math.min(99999999, +p?.legenda || 0)),
    cor:      clean(p?.cor, 20) || '#5b8dee',
    candidatos: Array.isArray(p?.candidatos)
      ? p.candidatos.slice(0, 500).map(c => ({
          nome:  clean(c?.nome, 200) || '',
          votos: Math.max(0, Math.min(99999999, +c?.votos || 0))
        }))
      : []
  }));
}

/* ── GET /api/elections/simulations ──────────────────────── */
// Lista as simulações do tenant atual
router.get('/simulations', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT s.id, s.nome, s.municipio, s.cadeiras,
              s.votos_validos, s.votos_brancos, s.votos_nulos,
              s.partidos, s.criado_em, s.atualizado_em,
              s.criado_por, u.nome AS criado_por_nome
       FROM simulacoes_eleitorais s
       LEFT JOIN usuarios u ON u.id = s.criado_por
       WHERE s.tenant_id = $1
       ORDER BY s.atualizado_em DESC
       LIMIT 100`,
      [req.user.tenant_id]
    );
    res.json(r.rows.map(row => ({
      ...row,
      id: Number(row.id),
      criado_por: row.criado_por ? Number(row.criado_por) : null,
      // partidos já vem como JSONB parseado pelo pg
    })));
  } catch (err) {
    console.error('[ELECTIONS] GET /simulations:', err);
    res.status(500).json({ error: 'Erro ao listar simulações.' });
  }
});

/* ── GET /api/elections/simulations/:id ──────────────────── */
// Detalhe de uma simulação específica
router.get('/simulations/:id',
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const r = await db.query(
        `SELECT s.id, s.nome, s.municipio, s.cadeiras,
                s.votos_validos, s.votos_brancos, s.votos_nulos,
                s.partidos, s.criado_em, s.atualizado_em,
                s.criado_por, u.nome AS criado_por_nome
         FROM simulacoes_eleitorais s
         LEFT JOIN usuarios u ON u.id = s.criado_por
         WHERE s.id = $1 AND s.tenant_id = $2`,
        [req.params.id, req.user.tenant_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Simulação não encontrada.' });
      const row = r.rows[0];
      res.json({
        ...row,
        id: Number(row.id),
        criado_por: row.criado_por ? Number(row.criado_por) : null,
      });
    } catch (err) {
      console.error('[ELECTIONS] GET /simulations/:id:', err);
      res.status(500).json({ error: 'Erro ao buscar simulação.' });
    }
  }
);

/* ── POST /api/elections/simulations (admin/master) ──────── */
// Cria nova simulação
router.post('/simulations',
  requireAdmin,
  [
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('municipio').optional({ nullable: true, checkFalsy: true }).isLength({ max: 200 }),
    body('cadeiras').optional().isInt({ min: 1, max: 100 }).toInt(),
    body('votos_validos').optional().isInt({ min: 0 }).toInt(),
    body('votos_brancos').optional().isInt({ min: 0 }).toInt(),
    body('votos_nulos').optional().isInt({ min: 0 }).toInt(),
    body('partidos').optional().isArray({ max: 50 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(
        `INSERT INTO simulacoes_eleitorais
           (tenant_id, criado_por, nome, municipio, cadeiras,
            votos_validos, votos_brancos, votos_nulos, partidos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         RETURNING id, criado_em, atualizado_em`,
        [
          req.user.tenant_id,
          req.user.id,
          clean(d.nome, 200),
          clean(d.municipio, 200),
          d.cadeiras || 15,
          d.votos_validos || 0,
          d.votos_brancos || 0,
          d.votos_nulos || 0,
          JSON.stringify(sanitizePartidos(d.partidos)),
        ]
      );
      const row = r.rows[0];
      res.status(201).json({
        id: Number(row.id),
        criado_em: row.criado_em,
        atualizado_em: row.atualizado_em,
      });
    } catch (err) {
      console.error('[ELECTIONS] POST /simulations:', err);
      res.status(500).json({ error: 'Erro ao salvar simulação.' });
    }
  }
);

/* ── PUT /api/elections/simulations/:id (admin/master) ───── */
// Atualiza simulação existente
router.put('/simulations/:id',
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('municipio').optional({ nullable: true, checkFalsy: true }).isLength({ max: 200 }),
    body('cadeiras').optional().isInt({ min: 1, max: 100 }).toInt(),
    body('votos_validos').optional().isInt({ min: 0 }).toInt(),
    body('votos_brancos').optional().isInt({ min: 0 }).toInt(),
    body('votos_nulos').optional().isInt({ min: 0 }).toInt(),
    body('partidos').optional().isArray({ max: 50 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(
        `UPDATE simulacoes_eleitorais
            SET nome          = $1,
                municipio     = $2,
                cadeiras      = $3,
                votos_validos = $4,
                votos_brancos = $5,
                votos_nulos   = $6,
                partidos      = $7::jsonb,
                atualizado_em = NOW()
          WHERE id = $8 AND tenant_id = $9
        RETURNING id, atualizado_em`,
        [
          clean(d.nome, 200),
          clean(d.municipio, 200),
          d.cadeiras || 15,
          d.votos_validos || 0,
          d.votos_brancos || 0,
          d.votos_nulos || 0,
          JSON.stringify(sanitizePartidos(d.partidos)),
          req.params.id,
          req.user.tenant_id,
        ]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Simulação não encontrada.' });
      res.json({ success: true, atualizado_em: r.rows[0].atualizado_em });
    } catch (err) {
      console.error('[ELECTIONS] PUT /simulations/:id:', err);
      res.status(500).json({ error: 'Erro ao atualizar simulação.' });
    }
  }
);

/* ── DELETE /api/elections/simulations/:id (admin/master) ─ */
router.delete('/simulations/:id',
  requireAdmin,
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const r = await db.query(
        `DELETE FROM simulacoes_eleitorais
          WHERE id = $1 AND tenant_id = $2
         RETURNING id`,
        [req.params.id, req.user.tenant_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Simulação não encontrada.' });
      res.json({ success: true });
    } catch (err) {
      console.error('[ELECTIONS] DELETE /simulations/:id:', err);
      res.status(500).json({ error: 'Erro ao excluir simulação.' });
    }
  }
);

module.exports = router;
