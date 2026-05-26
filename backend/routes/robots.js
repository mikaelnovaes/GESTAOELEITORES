/**
 * backend/routes/robots.js
 * Configuração e execução dos robôs (Aniversá rio e Reativação)
 * por tenant. Persistência via PostgreSQL — resolve os pontos 8, 9 e 7.
 */

'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db      = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/* ============================================================
   ROBÔ DE ANIVERSÁRIO
   ============================================================ */

router.get('/birthday/config', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT enabled, mode, text_message, template_name, template_lang,
              template_vars, send_time, atualizado_em
       FROM birthday_config WHERE tenant_id = $1`,
      [req.user.tenant_id]
    );
    if (!r.rowCount) {
      // Garante a linha para este tenant
      await db.query(
        `INSERT INTO birthday_config (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [req.user.tenant_id]
      );
      return res.json({
        enabled: false, mode: 'template', text_message: '', template_name: '',
        template_lang: 'pt_BR', template_vars: '', send_time: '09:00',
      });
    }
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ROBOTS] GET birthday:', err);
    res.status(500).json({ error: 'Erro ao buscar configuração.' });
  }
});

router.put('/birthday/config',
  requireAdmin,
  [
    body('enabled').isBoolean(),
    body('mode').isIn(['template', 'text']),
    body('text_message').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('template_name').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('template_lang').optional({ nullable: true }).isString().isLength({ max: 10 }),
    body('template_vars').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('send_time').optional({ nullable: true }).matches(/^\d{2}:\d{2}$/),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      await db.query(
        `INSERT INTO birthday_config
           (tenant_id, enabled, mode, text_message, template_name,
            template_lang, template_vars, send_time, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
         ON CONFLICT (tenant_id) DO UPDATE SET
           enabled       = EXCLUDED.enabled,
           mode          = EXCLUDED.mode,
           text_message  = EXCLUDED.text_message,
           template_name = EXCLUDED.template_name,
           template_lang = EXCLUDED.template_lang,
           template_vars = EXCLUDED.template_vars,
           send_time     = EXCLUDED.send_time,
           atualizado_em = NOW()`,
        [
          req.user.tenant_id,
          d.enabled,
          d.mode,
          d.text_message || null,
          d.template_name || null,
          d.template_lang || 'pt_BR',
          d.template_vars || null,
          d.send_time || '09:00',
        ]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[ROBOTS] PUT birthday:', err);
      res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
  }
);

/* GET aniversariantes de hoje (do tenant) */
router.get('/birthday/today', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, nome, telefone, bairro, cidade, data_nascimento
       FROM eleitores
       WHERE tenant_id = $1
         AND ativo = TRUE
         AND data_nascimento IS NOT NULL
         AND EXTRACT(MONTH FROM data_nascimento) = EXTRACT(MONTH FROM CURRENT_DATE)
         AND EXTRACT(DAY   FROM data_nascimento) = EXTRACT(DAY   FROM CURRENT_DATE)`,
      [req.user.tenant_id]
    );
    res.json(r.rows.map(e => ({ ...e, id: Number(e.id) })));
  } catch (err) {
    console.error('[ROBOTS] birthday/today:', err);
    res.status(500).json({ error: 'Erro ao buscar aniversariantes.' });
  }
});

/* ============================================================
   ROBÔ DE REATIVAÇÃO
   ============================================================ */

router.get('/reactivation/config', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT enabled, mode, text_message, template_name, template_lang,
              template_vars, period_value, period_unit, freq_unit, freq_hour, atualizado_em
       FROM reactivation_config WHERE tenant_id = $1`,
      [req.user.tenant_id]
    );
    if (!r.rowCount) {
      await db.query(
        `INSERT INTO reactivation_config (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [req.user.tenant_id]
      );
      return res.json({
        enabled: false, mode: 'template', text_message: '', template_name: '',
        template_lang: 'pt_BR', template_vars: '',
        period_value: 30, period_unit: 'dias',
        freq_unit: 'semanal', freq_hour: '09:00',
      });
    }
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ROBOTS] GET reactivation:', err);
    res.status(500).json({ error: 'Erro ao buscar configuração.' });
  }
});

router.put('/reactivation/config',
  requireAdmin,
  [
    body('enabled').isBoolean(),
    body('mode').isIn(['template', 'text']),
    body('text_message').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('template_name').optional({ nullable: true }).isString().isLength({ max: 200 }),
    body('template_lang').optional({ nullable: true }).isString().isLength({ max: 10 }),
    body('template_vars').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('period_value').optional().isInt({ min: 1, max: 365 }).toInt(),
    body('period_unit').optional().isIn(['dias', 'meses']),
    body('freq_unit').optional().isIn(['diario', 'semanal', 'mensal']),
    body('freq_hour').optional({ nullable: true }).matches(/^\d{2}:\d{2}$/),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      await db.query(
        `INSERT INTO reactivation_config
           (tenant_id, enabled, mode, text_message, template_name,
            template_lang, template_vars, period_value, period_unit,
            freq_unit, freq_hour, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW())
         ON CONFLICT (tenant_id) DO UPDATE SET
           enabled       = EXCLUDED.enabled,
           mode          = EXCLUDED.mode,
           text_message  = EXCLUDED.text_message,
           template_name = EXCLUDED.template_name,
           template_lang = EXCLUDED.template_lang,
           template_vars = EXCLUDED.template_vars,
           period_value  = EXCLUDED.period_value,
           period_unit   = EXCLUDED.period_unit,
           freq_unit     = EXCLUDED.freq_unit,
           freq_hour     = EXCLUDED.freq_hour,
           atualizado_em = NOW()`,
        [
          req.user.tenant_id,
          d.enabled,
          d.mode,
          d.text_message || null,
          d.template_name || null,
          d.template_lang || 'pt_BR',
          d.template_vars || null,
          d.period_value  || 30,
          d.period_unit   || 'dias',
          d.freq_unit     || 'semanal',
          d.freq_hour     || '09:00',
        ]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[ROBOTS] PUT reactivation:', err);
      res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
  }
);

module.exports = router;
