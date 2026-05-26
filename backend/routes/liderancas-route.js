/**
 * backend/routes/liderancas.js
 * CRUD de lideranças (cadastro espelhado de eleitor + campos próprios)
 *
 * Regras:
 * - Multi-tenant: cada liderança pertence ao tenant do usuário
 * - Criação/edição/exclusão: apenas admin/master
 * - Listagem/leitura: qualquer usuário autenticado do tenant
 * - Métricas: a lista enriquece cada liderança com:
 *     - vinculados_count: número de eleitores ativos com lideranca_id = liderança
 *     - cobertura_total: vinculados + expectativa_nao_vinculados
 *     - pct_atingido:    cobertura_total / expectativa_total
 */

'use strict';

const geocoder = require('../services/geocoder');
const express = require('express');
const { body, param, validationResult, query } = require('express-validator');
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

/* ── GET /api/liderancas ─────────────────────────────────── */
// Lista todas as lideranças do tenant (com métricas)
router.get('/',
  [
    query('page').optional().toInt().isInt({ min: 1 }),
    query('pageSize').optional().toInt().isInt({ min: 1, max: 1000 }),
    query('nome').optional().isLength({ max: 200 }),
    query('bairro').optional().isLength({ max: 100 }),
    query('cidade').optional().isLength({ max: 100 }),
    query('partido').optional().isLength({ max: 50 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const page     = +req.query.page     || 1;
      const pageSize = +req.query.pageSize || 1000;
      const offset   = (page - 1) * pageSize;

      const conds = ['l.tenant_id = $1', 'l.ativo = TRUE'];
      const params = [req.user.tenant_id];
      let pIdx = 2;
      if (req.query.nome)    { conds.push(`l.nome    ILIKE $${pIdx++}`); params.push(`%${req.query.nome}%`); }
      if (req.query.bairro)  { conds.push(`l.bairro  ILIKE $${pIdx++}`); params.push(`%${req.query.bairro}%`); }
      if (req.query.cidade)  { conds.push(`l.cidade  ILIKE $${pIdx++}`); params.push(`%${req.query.cidade}%`); }
      if (req.query.partido) { conds.push(`l.partido ILIKE $${pIdx++}`); params.push(`%${req.query.partido}%`); }
      const where = conds.join(' AND ');

      // total
      const countR = await db.query(
        `SELECT COUNT(*)::INT AS total FROM liderancas l WHERE ${where}`,
        params
      );
      const total = countR.rows[0].total;

      // data + count de vinculados via subselect (eficiente para escala média)
      const dataR = await db.query(
        `SELECT l.id, l.nome, l.data_nascimento, l.telefone, l.email,
                l.endereco, l.numero, l.bairro, l.cidade,
                l.titulo_eleitor, l.secao, l.escola_votacao, l.foto_url,
                l.cargo, l.partido, l.area_atuacao,
                l.expectativa_total, l.expectativa_nao_vinculados,
                l.observacoes, l.criado_em, l.atualizado_em,
                COALESCE((
                  SELECT COUNT(*)::INT FROM eleitores e
                  WHERE e.lideranca_id = l.id AND e.ativo = TRUE
                ), 0) AS vinculados_count
         FROM liderancas l
         WHERE ${where}
         ORDER BY l.nome ASC
         LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
        [...params, pageSize, offset]
      );

      const data = dataR.rows.map(r => {
        const id = Number(r.id);
        const vinc = Number(r.vinculados_count || 0);
        const naoVinc = Number(r.expectativa_nao_vinculados || 0);
        const meta = Number(r.expectativa_total || 0);
        const cobertura = vinc + naoVinc;
        const pct = meta > 0 ? Math.round((cobertura / meta) * 100) : null;
        return {
          ...r,
          id,
          vinculados_count: vinc,
          cobertura_total: cobertura,
          pct_atingido: pct,
        };
      });

      res.json({ data, total, page, pageSize, pages: Math.ceil(total / pageSize) });
    } catch (err) {
      console.error('[LIDERANCAS] GET /:', err);
      res.status(500).json({ error: 'Erro ao listar lideranças.' });
    }
  }
);

/* ── GET /api/liderancas/:id ─────────────────────────────── */
// Detalhe completo de uma liderança + eleitores vinculados
router.get('/:id',
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const r = await db.query(
        `SELECT l.id, l.nome, l.data_nascimento, l.telefone, l.email,
                l.endereco, l.numero, l.bairro, l.cidade,
                l.titulo_eleitor, l.secao, l.escola_votacao, l.foto_url,
                l.cargo, l.partido, l.area_atuacao,
                l.expectativa_total, l.expectativa_nao_vinculados,
                l.observacoes, l.criado_em, l.atualizado_em
         FROM liderancas l
         WHERE l.id = $1 AND l.tenant_id = $2 AND l.ativo = TRUE`,
        [req.params.id, req.user.tenant_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Liderança não encontrada.' });

      // Eleitores vinculados
      const vincR = await db.query(
        `SELECT id, nome, telefone, bairro, cidade
         FROM eleitores
         WHERE lideranca_id = $1 AND tenant_id = $2 AND ativo = TRUE
         ORDER BY nome ASC`,
        [req.params.id, req.user.tenant_id]
      );

      const row = r.rows[0];
      row.id = Number(row.id);
      row.eleitores_vinculados = vincR.rows.map(e => ({ ...e, id: Number(e.id) }));
      row.vinculados_count = vincR.rowCount;
      const meta = Number(row.expectativa_total || 0);
      const naoVinc = Number(row.expectativa_nao_vinculados || 0);
      row.cobertura_total = vincR.rowCount + naoVinc;
      row.pct_atingido = meta > 0 ? Math.round((row.cobertura_total / meta) * 100) : null;
      res.json(row);
    } catch (err) {
      console.error('[LIDERANCAS] GET /:id:', err);
      res.status(500).json({ error: 'Erro ao buscar liderança.' });
    }
  }
);

/* ── POST /api/liderancas (admin/master) ─────────────────── */
router.post('/',
  requireAdmin,
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
    body('cargo').optional({ nullable: true }).isLength({ max: 100 }),
    body('partido').optional({ nullable: true }).isLength({ max: 50 }),
    body('area_atuacao').optional({ nullable: true }).isLength({ max: 300 }),
    body('expectativa_total').optional({ nullable: true }).toInt().isInt({ min: 0, max: 99999999 }),
    body('expectativa_nao_vinculados').optional({ nullable: true }).toInt().isInt({ min: 0, max: 99999999 }),
    body('observacoes').optional({ nullable: true }).isLength({ max: 5000 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(
        `INSERT INTO liderancas
           (tenant_id, nome, data_nascimento, telefone, email, endereco, numero,
            bairro, cidade, titulo_eleitor, secao, escola_votacao,
            cargo, partido, area_atuacao,
            expectativa_total, expectativa_nao_vinculados,
            observacoes, criado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
          clean(d.cargo, 100),
          clean(d.partido, 50),
          clean(d.area_atuacao, 300),
          +d.expectativa_total || 0,
          +d.expectativa_nao_vinculados || 0,
          clean(d.observacoes, 5000),
          req.user.id,
        ]
      );
      const created = r.rows[0];
      geocoder.geocodeInBackground(db, 'liderancas', Number(created.id), req.user.tenant_id);
      res.status(201).json({ id: Number(created.id), criado_em: created.criado_em });
    } catch (err) {
      console.error('[LIDERANCAS] POST /:', err);
      res.status(500).json({ error: 'Erro ao criar liderança.' });
    }
  }
);

/* ── PUT /api/liderancas/:id (admin/master) ──────────────── */
router.put('/:id',
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('nome').trim().notEmpty().isLength({ max: 200 }),
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
    body('cargo').optional({ nullable: true }).isLength({ max: 100 }),
    body('partido').optional({ nullable: true }).isLength({ max: 50 }),
    body('area_atuacao').optional({ nullable: true }).isLength({ max: 300 }),
    body('expectativa_total').optional({ nullable: true }).toInt().isInt({ min: 0, max: 99999999 }),
    body('expectativa_nao_vinculados').optional({ nullable: true }).toInt().isInt({ min: 0, max: 99999999 }),
    body('observacoes').optional({ nullable: true }).isLength({ max: 5000 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(
        `UPDATE liderancas SET
            nome                       = $1,
            data_nascimento            = $2,
            telefone                   = $3,
            email                      = $4,
            endereco                   = $5,
            numero                     = $6,
            bairro                     = $7,
            cidade                     = $8,
            titulo_eleitor             = $9,
            secao                      = $10,
            escola_votacao             = $11,
            cargo                      = $12,
            partido                    = $13,
            area_atuacao               = $14,
            expectativa_total          = $15,
            expectativa_nao_vinculados = $16,
            observacoes                = $17,
            atualizado_em              = NOW()
          WHERE id = $18 AND tenant_id = $19 AND ativo = TRUE
        RETURNING id, atualizado_em`,
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
          clean(d.cargo, 100),
          clean(d.partido, 50),
          clean(d.area_atuacao, 300),
          +d.expectativa_total || 0,
          +d.expectativa_nao_vinculados || 0,
          clean(d.observacoes, 5000),
          req.params.id,
          req.user.tenant_id,
        ]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Liderança não encontrada.' });
      res.json({ success: true, atualizado_em: r.rows[0].atualizado_em });
    } catch (err) {
      console.error('[LIDERANCAS] PUT /:id:', err);
      await db.query(
  `UPDATE liderancas SET geocoded_status='pending' WHERE id=$1 AND tenant_id=$2`,
  [req.params.id, req.user.tenant_id]
);
geocoder.geocodeInBackground(db, 'liderancas', Number(req.params.id), req.user.tenant_id);
      res.status(500).json({ error: 'Erro ao atualizar liderança.' });
    }
  }
);

/* ── DELETE /api/liderancas/:id (admin/master) ───────────── */
// Soft delete: marca ativo=false. Eleitores vinculados ficam órfãos (lideranca_id null via SET NULL).
router.delete('/:id',
  requireAdmin,
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      // Quando soft-delete, também desvincula eleitores manualmente (porque o FK SET NULL só dispara em DELETE real)
      await db.transaction(async (client) => {
        await client.query(
          `UPDATE eleitores SET lideranca_id = NULL, atualizado_em = NOW()
            WHERE lideranca_id = $1 AND tenant_id = $2`,
          [req.params.id, req.user.tenant_id]
        );
        const r = await client.query(
          `UPDATE liderancas SET ativo = FALSE, atualizado_em = NOW()
            WHERE id = $1 AND tenant_id = $2 AND ativo = TRUE
          RETURNING id`,
          [req.params.id, req.user.tenant_id]
        );
        if (!r.rowCount) throw new Error('NOT_FOUND');
      });
      res.json({ success: true });
    } catch (err) {
      if (err.message === 'NOT_FOUND') {
        return res.status(404).json({ error: 'Liderança não encontrada.' });
      }
      console.error('[LIDERANCAS] DELETE /:id:', err);
      res.status(500).json({ error: 'Erro ao excluir liderança.' });
    }
  }
);

module.exports = router;
