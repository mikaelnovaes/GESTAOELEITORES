/**
 * backend/routes/mapa.js
 * Endpoints do Mapa Eleitoral
 *
 * GET    /api/mapa/pontos                       — pontos do tenant (eleitores + lideranças com coords)
 * GET    /api/mapa/stats                        — contadores de geocodificação
 * POST   /api/mapa/geocode/:tipo/:id            — força regeocodificação de um registro
 * POST   /api/mapa/geocode-pendentes            — geocodifica todos pendentes do tenant (lote, async)
 */

'use strict';

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const db       = require('../config/database');
const geocoder = require('../services/geocoder');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/* ── GET /api/mapa/pontos ────────────────────────────────── */
// Retorna eleitores + lideranças do tenant que já têm coordenadas
router.get('/pontos',
  [
    query('tipo').optional().isIn(['eleitor', 'lideranca', 'ambos']),
    query('bairro').optional().isLength({ max: 100 }),
    query('cidade').optional().isLength({ max: 100 }),
    query('lideranca_id').optional().toInt().isInt({ min: 1 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;

    const tipo   = req.query.tipo   || 'ambos';
    const bairro = req.query.bairro || null;
    const cidade = req.query.cidade || null;
    const lidId  = req.query.lideranca_id || null;

    try {
      const conds = ['tenant_id = $1'];
      const params = [req.user.tenant_id];
      let pIdx = 2;

      if (tipo !== 'ambos') {
        conds.push(`tipo = $${pIdx++}`);
        params.push(tipo);
      }
      if (bairro) {
        conds.push(`bairro ILIKE $${pIdx++}`);
        params.push(`%${bairro}%`);
      }
      if (cidade) {
        conds.push(`cidade ILIKE $${pIdx++}`);
        params.push(`%${cidade}%`);
      }
      if (lidId) {
        // Eleitores vinculados à liderança OU a própria liderança
        conds.push(`(lideranca_id = $${pIdx} OR (tipo = 'lideranca' AND id = $${pIdx}))`);
        params.push(lidId);
        pIdx++;
      }

      const r = await db.query(
        `SELECT tipo, id, nome, telefone, email, endereco, numero,
                bairro, cidade, foto_url, latitude, longitude,
                lideranca_id, cargo, partido
         FROM v_mapa_pontos
         WHERE ${conds.join(' AND ')}
         LIMIT 5000`,
        params
      );

      res.json(r.rows.map(p => ({
        ...p,
        id: Number(p.id),
        lideranca_id: p.lideranca_id ? Number(p.lideranca_id) : null,
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
      })));
    } catch (err) {
      console.error('[MAPA] GET /pontos:', err);
      res.status(500).json({ error: 'Erro ao buscar pontos.' });
    }
  }
);

/* ── GET /api/mapa/stats ─────────────────────────────────── */
router.get('/stats', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
        (SELECT COUNT(*)::INT FROM eleitores
          WHERE tenant_id = $1 AND ativo = TRUE) AS eleitores_total,
        (SELECT COUNT(*)::INT FROM eleitores
          WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status = 'done') AS eleitores_geocoded,
        (SELECT COUNT(*)::INT FROM eleitores
          WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status = 'pending') AS eleitores_pending,
        (SELECT COUNT(*)::INT FROM eleitores
          WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status IN ('failed','no_address')) AS eleitores_failed,
        (SELECT COUNT(*)::INT FROM liderancas
          WHERE tenant_id = $1 AND ativo = TRUE) AS liderancas_total,
        (SELECT COUNT(*)::INT FROM liderancas
          WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status = 'done') AS liderancas_geocoded,
        (SELECT COUNT(*)::INT FROM liderancas
          WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status = 'pending') AS liderancas_pending,
        (SELECT COUNT(*)::INT FROM liderancas
          WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status IN ('failed','no_address')) AS liderancas_failed`,
      [req.user.tenant_id]
    );
    res.json(r.rows[0] || {});
  } catch (err) {
    console.error('[MAPA] GET /stats:', err);
    res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
});

/* ── POST /api/mapa/geocode/:tipo/:id ────────────────────── */
// Força nova geocodificação de um registro específico
router.post('/geocode/:tipo/:id',
  requireAdmin,
  [
    param('tipo').isIn(['eleitor', 'lideranca']),
    param('id').isInt({ min: 1 }).toInt(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const table = req.params.tipo === 'eleitor' ? 'eleitores' : 'liderancas';
    try {
      const result = await geocoder.geocodeAndUpdate(db, table, req.params.id, req.user.tenant_id);
      res.json(result);
    } catch (err) {
      console.error('[MAPA] geocode/:tipo/:id:', err);
      res.status(500).json({ error: 'Erro ao geocodificar.' });
    }
  }
);

/* ── POST /api/mapa/geocode-pendentes ────────────────────── */
// Dispara geocodificação em LOTE de todos os pendentes do tenant.
// Roda em background (não bloqueia a resposta).
// Retorna imediatamente com a quantidade que será processada.
router.post('/geocode-pendentes',
  requireAdmin,
  async (req, res) => {
    try {
      // Conta quantos serão processados
      const eR = await db.query(
        `SELECT id FROM eleitores
         WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status IN ('pending', 'failed')
         LIMIT 500`,
        [req.user.tenant_id]
      );
      const lR = await db.query(
        `SELECT id FROM liderancas
         WHERE tenant_id = $1 AND ativo = TRUE AND geocoded_status IN ('pending', 'failed')
         LIMIT 500`,
        [req.user.tenant_id]
      );

      const eleitorIds   = eR.rows.map(r => Number(r.id));
      const liderancaIds = lR.rows.map(r => Number(r.id));
      const total = eleitorIds.length + liderancaIds.length;

      // Dispara processamento em background
      (async () => {
        for (const id of eleitorIds) {
          try { await geocoder.geocodeAndUpdate(db, 'eleitores', id, req.user.tenant_id); }
          catch (e) { console.warn('[MAPA] bg eleitor', id, e.message); }
        }
        for (const id of liderancaIds) {
          try { await geocoder.geocodeAndUpdate(db, 'liderancas', id, req.user.tenant_id); }
          catch (e) { console.warn('[MAPA] bg lideranca', id, e.message); }
        }
        console.log(`[MAPA] Geocode em lote concluído: ${total} registros (tenant ${req.user.tenant_id})`);
      })();

      res.json({
        scheduled: total,
        eleitores: eleitorIds.length,
        liderancas: liderancaIds.length,
        estimated_seconds: total * 1.2,
        message: total > 0
          ? `${total} registro(s) sendo processado(s) em segundo plano. Volte e recarregue o mapa em alguns minutos.`
          : 'Nenhum registro pendente.',
      });
    } catch (err) {
      console.error('[MAPA] geocode-pendentes:', err);
      res.status(500).json({ error: 'Erro ao iniciar geocodificação em lote.' });
    }
  }
);

module.exports = router;
