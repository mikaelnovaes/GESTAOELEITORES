/**
 * backend/routes/whatsapp.js
 * Proxy seguro para Meta WhatsApp Cloud API
 *
 * O token da Meta NUNCA vai ao frontend.
 * O frontend envia apenas { eleitorId, mode, payload } autenticado com JWT.
 * O backend busca o token no banco e faz a chamada à Meta.
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

/* ── GET /api/whatsapp/config ────────────────────────────── */
router.get('/config', requireAdmin, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT phone_id, waba_id, proxy_url, country_code,
              (access_token IS NOT NULL AND access_token != '') AS configurado
       FROM whatsapp_config WHERE id = 1`
    );
    // Nunca retornar o access_token para o frontend
    res.json(r.rows[0] || {});
  } catch {
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
      await db.query(
        `UPDATE whatsapp_config SET
           phone_id     = COALESCE($1, phone_id),
           access_token = COALESCE($2, access_token),
           waba_id      = COALESCE($3, waba_id),
           country_code = COALESCE($4, country_code),
           atualizado_em = NOW(),
           atualizado_por = $5
         WHERE id = 1`,
        [phone_id, access_token, waba_id, country_code || '55', req.user.id]
      );
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erro ao salvar configuração.' });
    }
  }
);

/* ── GET /api/whatsapp/templates ─────────────────────────── */
router.get('/templates', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, nome, idioma FROM whatsapp_templates WHERE ativo = TRUE ORDER BY nome`
    );
    res.json(r.rows);
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
  `INSERT INTO whatsapp_templates (nome, idioma)
   VALUES ($1, $2)
   RETURNING id`,
  [nome, req.body.idioma || 'pt_BR']
);    
      /*

- CORREÇÃO DE ACORDO COM CHATGPT PLUS - CLAUDE FAVOR VERIFICAR SE PROCEDE.
O banco criou whatsapp_templates.nome como UNIQUE, mas a exclusão faz apenas ativo = FALSE. 
Resultado: o template some da tela, mas o nome continua bloqueado no banco.
Com isso, template excluído não bloqueia novo template com mesmo nome.

      const r = await db.query(
        `INSERT INTO whatsapp_templates (nome, idioma) VALUES ($1, $2) RETURNING id`,
        [req.body.nome, req.body.idioma || 'pt_BR']
      );*/

      
      res.status(201).json(r.rows[0]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Template já cadastrado.' });
      res.status(500).json({ error: 'Erro ao criar template.' });
    }
  }
);

/* ── DELETE /api/whatsapp/templates/:id ──────────────────── */
router.delete('/templates/:id', requireAdmin, async (req, res) => {
  try {
    await db.query(
      `UPDATE whatsapp_templates SET ativo = FALSE WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch {
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
      // Buscar eleitor
      const eR = await db.query(
        `SELECT id, nome, telefone, bairro, cidade, endereco
         FROM eleitores WHERE id = $1 AND ativo = TRUE`,
        [eleitorId]
      );
      if (!eR.rowCount) return res.status(404).json({ error: 'Eleitor não encontrado.' });

      const eleitor = eR.rows[0];
      if (!eleitor.telefone) return res.status(400).json({ error: 'Eleitor sem telefone.' });

      // Buscar configuração (token fica aqui no backend)
      const cfgR = await db.query(
        `SELECT phone_id, access_token, country_code FROM whatsapp_config WHERE id = 1`
      );
      const cfg = cfgR.rows[0];
      if (!cfg?.phone_id || !cfg?.access_token) {
        return res.status(400).json({ error: 'API WhatsApp não configurada.' });
      }

      const phone = formatPhone(eleitor.telefone, cfg.country_code || '55');

      // Montar corpo para a Meta API
      const body = buildMessageBody(phone, mode, payload, eleitor);

      // Chamar Meta API
      const metaUrl = `https://graph.facebook.com/v19.0/${cfg.phone_id}/messages`;
      const metaRes = await fetch(metaUrl, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${cfg.access_token}`,
        },
        body: JSON.stringify(body),
      });

      const metaData = await metaRes.json();
      const success  = metaRes.ok;
      const msgId    = metaData.messages?.[0]?.id || null;

      // Registrar no log
      await db.query(
        `INSERT INTO whatsapp_log
           (eleitor_id, eleitor_nome, telefone, tipo, conteudo, status, mensagem_erro, message_id, enviado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          eleitor.id,
          eleitor.nome,
          phone,
          mode,
          payload.templateName || payload.message || '',
          success ? 'sent' : 'failed',
          success ? null : JSON.stringify(metaData.error || metaData),
          msgId,
          req.user.id,
        ]
      );

      if (success) {
        res.json({ success: true, messageId: msgId });
      } else {
        res.status(502).json({ error: 'Erro ao enviar via Meta API.', details: metaData });
      }

    } catch (err) {
      console.error('[WHATSAPP] send:', err);
      res.status(500).json({ error: 'Erro interno ao enviar mensagem.' });
    }
  }
);

/* ── GET /api/whatsapp/log ───────────────────────────────── */
router.get('/log', async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, data_envio, eleitor_nome, telefone, tipo, status, mensagem_erro, lote_id, message_id
       FROM whatsapp_log ORDER BY data_envio DESC LIMIT 500`
    );
    res.json(r.rows);
  } catch {
    res.status(500).json({ error: 'Erro ao buscar histórico.' });
  }
});

/* ── DELETE /api/whatsapp/log (só admin) ─────────────────── */
router.delete('/log', requireAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM whatsapp_log');
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
    return {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: replaceVars(payload.message, eleitor) },
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



