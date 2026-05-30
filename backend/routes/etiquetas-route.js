/**
 * backend/routes/etiquetas-route.js 
 * Histórico de geração de etiquetas
 */

'use strict';

const express = require('express');
const { body, param, query, validationResult } = require('express-validator');
const db = require('../config/database');

const router = express.Router();

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/* ── POST /api/etiquetas/log ───────────────────────────────
   Registra uma geração de etiquetas no histórico            */
router.post('/log',
  [
    body('tamanho').isIn(['carta','media','pequena']),
    body('quantidade').isInt({ min: 0 }).toInt(),
    body('folhas').isInt({ min: 0 }).toInt(),
    body('escopo').optional().isString().isLength({ max: 20 }),
    body('filtro_bairro').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('filtro_cidade').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('ids').optional().isArray({ max: 5000 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const d = req.body;
      const r = await db.query(`
        INSERT INTO etiquetas_log
          (tenant_id, gerado_por, gerado_por_nome, tamanho, quantidade, folhas,
           filtro_bairro, filtro_cidade, escopo, ids_eleitores)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id, criado_em
      `, [
        req.user.tenant_id,
        req.user.id,
        req.user.nome || req.user.login || null,
        d.tamanho,
        d.quantidade,
        d.folhas,
        d.filtro_bairro || null,
        d.filtro_cidade || null,
        d.escopo || 'todos',
        d.ids ? JSON.stringify(d.ids) : null,
      ]);
      res.status(201).json({ id: Number(r.rows[0].id), criado_em: r.rows[0].criado_em });
    } catch (err) {
      console.error('[ETIQUETAS] POST /log:', err);
      res.status(500).json({ error: 'Erro ao registrar log.' });
    }
  }
);

/* ── GET /api/etiquetas/historico ──────────────────────────
   Lista o histórico de gerações do tenant                   */
router.get('/historico',
  [query('limit').optional().isInt({ min: 1, max: 200 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const limit = req.query.limit || 50;
      const r = await db.query(`
        SELECT id, gerado_por, gerado_por_nome, tamanho, quantidade, folhas,
               filtro_bairro, filtro_cidade, escopo, criado_em
        FROM etiquetas_log
        WHERE tenant_id = $1
        ORDER BY criado_em DESC
        LIMIT $2
      `, [req.user.tenant_id, limit]);

      res.json(r.rows.map(row => ({ ...row, id: Number(row.id) })));
    } catch (err) {
      console.error('[ETIQUETAS] GET /historico:', err);
      res.status(500).json({ error: 'Erro ao buscar histórico.' });
    }
  }
);

/* ── GET /api/etiquetas/:id ────────────────────────────────
   Recupera detalhes de uma geração (para reimprimir)        */
router.get('/:id',
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const r = await db.query(`
        SELECT id, gerado_por_nome, tamanho, quantidade, folhas,
               filtro_bairro, filtro_cidade, escopo, ids_eleitores, criado_em
        FROM etiquetas_log
        WHERE id = $1 AND tenant_id = $2
      `, [req.params.id, req.user.tenant_id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Registro não encontrado.' });
      const row = r.rows[0];
      row.id = Number(row.id);
      row.ids_eleitores = row.ids_eleitores ? JSON.parse(row.ids_eleitores) : null;

      // Se tem IDs, busca os eleitores atuais (podem ter mudado/sido excluídos)
      if (row.ids_eleitores?.length) {
        const eR = await db.query(`
          SELECT id, nome, endereco, numero, bairro, cidade
          FROM eleitores
          WHERE id = ANY($1::BIGINT[]) AND tenant_id = $2 AND ativo = TRUE
          ORDER BY nome
        `, [row.ids_eleitores, req.user.tenant_id]);
        row.eleitores = eR.rows.map(e => ({ ...e, id: Number(e.id) }));
      } else {
        row.eleitores = [];
      }
      res.json(row);
    } catch (err) {
      console.error('[ETIQUETAS] GET /:id:', err);
      res.status(500).json({ error: 'Erro ao buscar registro.' });
    }
  }
);

module.exports = router;
