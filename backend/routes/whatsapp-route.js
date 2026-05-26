/**
 * backend/routes/whatsapp.js
 * Proxy seguro para Meta WhatsApp Cloud API
 *
 * v2 — CONFIG ISOLADA POR TENANT
 * Cada ambiente (tenant) tem sua própria configuração de API.
 * Templates, logs e config já eram por tenant.
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

/* ── Helper: garante que existe uma linha de config para o tenant ── */
async function ensureConfigRow(tenantId) {
  await db.query(
    `INSERT INTO whatsapp_config (tenant_id) VALUES ($1)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );
}

/* ── GET /api/whatsapp/config ────────────────────────────── */
router.get('/config', requireAdmin, async (req, res) => {
  try {
    await ensureConfigRow(req.user.tenant_id);
    const r = await db.query(
      `SELECT phone_id, waba_id, proxy_url, country_code,
              (access_token IS NOT NULL AND access_token != '') AS configurado
       FROM whatsapp_config WHERE tenant_id = $1`,
      [req.user.tenant_id]
    );
    res.json(r.rows[0] || {});
  } catch (err) {
    console.error('[WA] GET /config:', err);
    res.status(500).json({ error: 'Erro ao buscar configuração.' });
  }
});

/* ── PUT /api/whatsapp/config ────────────────────────────── */
router.put('/config',
  requireAdmin,
  [
    body('phone_id').optional({ nullable: true }).isString().isLength({ max: 50 }),
    body('access_token').optional({ nullable: true }).isString().isLength({ max: 500 }),
    body('waba_id').optional({ nullable: true }).isString().isLength({ max: 50 }),
    body('country_code').optional({ nullable: true }).isString().isLength({ max: 5 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { phone_id, access_token, waba_id, country_code } = req.body;
    try {
      await ensureConfigRow(req.user.tenant_id);
      await db.query(
        `UPDATE whatsapp_config SET
           phone_id      = COALESCE(NULLIF($1,''), phone_id),
           access_token  = COALESCE(NULLIF($2,''), access_token),
           waba_id       = COALESCE(NULLIF($3,''), waba_id),
           country_code  = COALESCE(NULLIF($4,''), country_code),
           atualizado_em = NOW(),
           atualizado_por = $5
         WHERE tenant_id = $6`,
        [phone_id, access_token, waba_id, country_code || '55', req.user.id, req.user.tenant_id]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[WA] PUT /config:', err);
      res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
  }
);

/* ── GET /api/whatsapp/templates (do tenant) ─────────────── */
router.get('/templates', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, nome, idioma FROM whatsapp_templates
       WHERE tenant_id = $1 AND ativo = TRUE
       ORDER BY nome`,
      [req.user.tenant_id]
    );
    res.json(r.rows.map(t => ({ ...t, id: Number(t.id) })));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar templates.' });
  }
});

/* ── POST /api/whatsapp/templates ────────────────────────── */
router.post('/templates',
  requireAdmin,
  [
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('idioma').optional().isString().isLength({ max: 10 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const nome = String(req.body.nome || '').trim();
      const r = await db.query(
        `INSERT INTO whatsapp_templates (tenant_id, nome, idioma)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [req.user.tenant_id, nome, req.body.idioma || 'pt_BR']
      );
      res.status(201).json({ id: Number(r.rows[0].id) });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Template ativo com este nome já existe.' });
      console.error('[WA] POST /templates:', err);
      res.status(500).json({ error: 'Erro ao criar template.' });
    }
  }
);

/* ── DELETE /api/whatsapp/templates/:id ──────────────────── */
router.delete('/templates/:id', requireAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `DELETE FROM whatsapp_templates
       WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.user.tenant_id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Template não encontrado.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[WA] DELETE /templates/:id:', err);
    res.status(500).json({ error: 'Erro ao remover template.' });
  }
});

/* ── POST /api/whatsapp/send ─────────────────────────────── */
router.post('/send',
  [
    body('eleitorId').isInt({ min: 1 }),
    body('mode').isIn(['template', 'text', 'image']),
    body('payload').isObject(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { eleitorId, mode, payload } = req.body;

    try {
      // Buscar eleitor DENTRO DO TENANT
      const eR = await db.query(
        `SELECT id, nome, telefone, bairro, cidade, endereco
         FROM eleitores
         WHERE id = $1 AND tenant_id = $2 AND ativo = TRUE`,
        [eleitorId, req.user.tenant_id]
      );
      if (!eR.rowCount) return res.status(404).json({ error: 'Eleitor não encontrado.' });

      const eleitor = eR.rows[0];
      if (!eleitor.telefone) return res.status(400).json({ error: 'Eleitor sem telefone.' });

      // Buscar config DESTE TENANT
      const cR = await db.query(
        `SELECT phone_id, access_token, country_code, proxy_url
         FROM whatsapp_config WHERE tenant_id = $1`,
        [req.user.tenant_id]
      );
      const cfg = cR.rows[0];
      if (!cfg?.phone_id || !cfg?.access_token) {
        return res.status(400).json({ error: 'WhatsApp não configurado para este ambiente. Configure em "Configurar API".' });
      }

      const phone = formatPhone(eleitor.telefone, cfg.country_code || '55');
      const body  = buildMessageBody(phone, mode, payload, eleitor);

      let messageId = null;
      let status    = 'failed';
      let errMsg    = null;

      try {
        const url = cfg.proxy_url || `https://graph.facebook.com/v20.0/${cfg.phone_id}/messages`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfg.access_token}`,
            'Content-Type':  'application/json',
          },
          body: JSON.stringify(body),
        });
        const json = await resp.json();
        if (resp.ok && json.messages?.[0]?.id) {
          messageId = json.messages[0].id;
          status    = 'sent';
        } else {
          errMsg = json.error?.message || `HTTP ${resp.status}`;
        }
      } catch (httpErr) {
        errMsg = httpErr.message;
      }

      // Log
      const conteudo = mode === 'text'
        ? replaceVars(payload.message || payload.text || '', eleitor)
        : (mode === 'image' ? (payload.caption || '(imagem)') : `Template: ${payload.templateName}`);

      await db.query(
        `INSERT INTO whatsapp_log
           (tenant_id, eleitor_id, eleitor_nome, telefone, tipo, conteudo,
            status, mensagem_erro, message_id, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.user.tenant_id, eleitor.id, eleitor.nome, phone, mode, conteudo,
         status, errMsg, messageId, req.user.id]
      );

      if (status === 'sent') return res.json({ success: true, messageId });
      return res.status(502).json({ error: errMsg || 'Falha no envio.' });

    } catch (err) {
      console.error('[WA] send:', err);
      res.status(500).json({ error: 'Erro interno ao enviar.' });
    }
  }
);

/* ── GET /api/whatsapp/log (do tenant) ───────────────────── */
router.get('/log', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, data_envio, eleitor_nome, telefone, tipo, conteudo,
              status, mensagem_erro, lote_id, message_id
       FROM whatsapp_log
       WHERE tenant_id = $1
       ORDER BY data_envio DESC
       LIMIT 500`,
      [req.user.tenant_id]
    );
    res.json(r.rows.map(l => ({ ...l, id: Number(l.id) })));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar histórico.' });
  }
});

/* ── DELETE /api/whatsapp/log (só admin, só do tenant) ──── */
router.delete('/log', requireAdmin, async (req, res) => {
  try {
    await db.query(
      `DELETE FROM whatsapp_log WHERE tenant_id = $1`,
      [req.user.tenant_id]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Erro ao limpar histórico.' });
  }
});

/* ── HELPERS ─────────────────────────────────────────────── */
function formatPhone(raw, country = '55') {
  let p = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (p.length >= 12) return p;
  if (p.length === 10 || p.length === 11) return country + p;
  return p;
}

function replaceVars(template, eleitor) {
  const primeiro = (eleitor.nome || '').split(' ')[0];
  return (template || '')
    .replace(/\{\{\s*nome\s*\}\}/gi, eleitor.nome || '')
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*bairro\s*\}\}/gi, eleitor.bairro || '')
    .replace(/\{\{\s*cidade\s*\}\}/gi, eleitor.cidade || '')
    .replace(/\{\{\s*endereco\s*\}\}/gi, eleitor.endereco || '');
}

function buildMessageBody(phone, mode, payload, eleitor) {
  if (mode === 'template') {
    const body = {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: payload.templateName,
        language: { code: payload.language || 'pt_BR' },
      },
    };
    if (payload.variables?.length) {
      body.template.components = [{
        type: 'body',
        parameters: payload.variables.map(v => ({
          type: 'text',
          text: replaceVars(v, eleitor),
        })),
      }];
    }
    return body;
  }
  if (mode === 'text') {
    const texto = payload.message || payload.text || '';
    return {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: replaceVars(texto, eleitor) },
    };
  }
  if (mode === 'image') {
    return {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'image',
      image: {
        link:    payload.imageUrl,
        caption: replaceVars(payload.caption || '', eleitor),
      },
    };
  }
  throw new Error(`Modo inválido: ${mode}`);
}

module.exports = router;
