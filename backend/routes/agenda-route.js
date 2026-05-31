/**
 * backend/routes/agenda-route.js (v2)
 * Agenda do Candidato — eventos + link mestre por tenant
 *
 * MULTI-TENANT: TODAS as rotas autenticadas filtram por req.user.tenant_id.
 * O link público é POR TENANT (não por evento) — token mestre único.
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
function clean(v, max = 300) {
  if (!v) return null;
  return String(v).replace(/<[^>]*>/g, '').trim().substring(0, max) || null;
}

/* ──────────────────────────────────────────────────────────
   AUTENTICADAS — TODAS filtram por tenant
─────────────────────────────────────────────────────────── */

// GET /api/agenda — lista eventos do tenant
router.get('/',
  [
    query('de').optional().isISO8601(),
    query('ate').optional().isISO8601(),
    query('tipo').optional().isIn(['evento','reuniao','visita','comicio','entrevista','outro']),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const conds = ['a.tenant_id = $1', 'a.ativo = TRUE'];
      const params = [req.user.tenant_id];
      let p = 2;
      if (req.query.de)  { conds.push(`a.data_inicio >= $${p++}`); params.push(req.query.de); }
      if (req.query.ate) { conds.push(`a.data_inicio <= $${p++}`); params.push(req.query.ate); }
      if (req.query.tipo){ conds.push(`a.tipo = $${p++}`);          params.push(req.query.tipo); }

      const r = await db.query(`
        SELECT a.id, a.titulo, a.descricao, a.tipo,
               a.data_inicio, a.data_fim,
               a.local_nome, a.local_endereco, a.bairro, a.cidade,
               a.lideranca_id, l.nome AS lideranca_nome,
               a.notificar_eleitores, a.notificados,
               a.criado_em
        FROM agenda_eventos a
        LEFT JOIN liderancas l ON l.id = a.lideranca_id AND l.tenant_id = a.tenant_id
        WHERE ${conds.join(' AND ')}
        ORDER BY a.data_inicio ASC
      `, params);

      res.json(r.rows.map(row => ({ ...row, id: Number(row.id) })));
    } catch (err) {
      console.error('[AGENDA] GET /:', err);
      res.status(500).json({ error: 'Erro ao buscar agenda.' });
    }
  }
);

// GET /api/agenda/proximos
router.get('/proximos', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT id, titulo, tipo, data_inicio, local_nome, bairro
      FROM agenda_eventos
      WHERE tenant_id = $1 AND ativo = TRUE AND data_inicio >= NOW()
      ORDER BY data_inicio ASC LIMIT 5
    `, [req.user.tenant_id]);
    res.json(r.rows.map(row => ({ ...row, id: Number(row.id) })));
  } catch {
    res.status(500).json({ error: 'Erro ao buscar próximos eventos.' });
  }
});

// GET /api/agenda/link-publico — retorna o link mestre do tenant atual
router.get('/link-publico', async (req, res) => {
  try {
    // Garante que existe link para esse tenant
    const r = await db.query(`
      INSERT INTO agenda_links_publicos (tenant_id)
      VALUES ($1)
      ON CONFLICT (tenant_id) DO UPDATE SET atualizado_em = NOW()
      RETURNING token, ativo
    `, [req.user.tenant_id]);
    res.json({
      token: r.rows[0].token,
      ativo: r.rows[0].ativo,
    });
  } catch (err) {
    console.error('[AGENDA] GET /link-publico:', err);
    res.status(500).json({ error: 'Erro ao recuperar link público.' });
  }
});

// POST /api/agenda/link-publico/regenerar — gera um novo token (invalida o anterior)
router.post('/link-publico/regenerar', requireAdmin, async (req, res) => {
  try {
    const r = await db.query(`
      UPDATE agenda_links_publicos
      SET token = encode(gen_random_bytes(32),'hex'), atualizado_em = NOW()
      WHERE tenant_id = $1
      RETURNING token
    `, [req.user.tenant_id]);
    if (!r.rowCount) {
      const ins = await db.query(`
        INSERT INTO agenda_links_publicos (tenant_id) VALUES ($1) RETURNING token
      `, [req.user.tenant_id]);
      return res.json({ token: ins.rows[0].token });
    }
    res.json({ token: r.rows[0].token });
  } catch (err) {
    console.error('[AGENDA] POST /link-publico/regenerar:', err);
    res.status(500).json({ error: 'Erro ao regenerar link.' });
  }
});

// POST /api/agenda
router.post('/',
  requireAdmin,
  [
    body('titulo').trim().notEmpty().isLength({ max: 300 }),
    body('tipo').isIn(['evento','reuniao','visita','comicio','entrevista','outro']),
    body('data_inicio').isISO8601(),
    body('data_fim').optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body('descricao').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('local_nome').optional({ nullable: true }).isString().isLength({ max: 300 }),
    body('local_endereco').optional({ nullable: true }).isString().isLength({ max: 400 }),
    body('bairro').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('cidade').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('lideranca_id').optional({ nullable: true, checkFalsy: true }).toInt().isInt({ min: 1 }),
    body('notificar_eleitores').optional().isBoolean(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(`
        INSERT INTO agenda_eventos
          (tenant_id, titulo, descricao, tipo, data_inicio, data_fim,
           local_nome, local_endereco, bairro, cidade,
           lideranca_id, notificar_eleitores, criado_por)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id, criado_em
      `, [
        req.user.tenant_id, clean(d.titulo, 300), clean(d.descricao, 2000),
        d.tipo, d.data_inicio, d.data_fim || null,
        clean(d.local_nome, 300), clean(d.local_endereco, 400),
        clean(d.bairro, 100), clean(d.cidade, 100),
        d.lideranca_id || null, d.notificar_eleitores || false, req.user.id,
      ]);
      res.status(201).json({ id: Number(r.rows[0].id), criado_em: r.rows[0].criado_em });
    } catch (err) {
      console.error('[AGENDA] POST /:', err);
      res.status(500).json({ error: 'Erro ao criar evento.' });
    }
  }
);

// PUT /api/agenda/:id
router.put('/:id',
  requireAdmin,
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('titulo').trim().notEmpty().isLength({ max: 300 }),
    body('tipo').isIn(['evento','reuniao','visita','comicio','entrevista','outro']),
    body('data_inicio').isISO8601(),
    body('data_fim').optional({ nullable: true, checkFalsy: true }).isISO8601(),
    body('descricao').optional({ nullable: true }).isString().isLength({ max: 2000 }),
    body('local_nome').optional({ nullable: true }).isString().isLength({ max: 300 }),
    body('local_endereco').optional({ nullable: true }).isString().isLength({ max: 400 }),
    body('bairro').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('cidade').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('lideranca_id').optional({ nullable: true, checkFalsy: true }).toInt().isInt({ min: 1 }),
    body('notificar_eleitores').optional().isBoolean(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const d = req.body;
    try {
      const r = await db.query(`
        UPDATE agenda_eventos SET
          titulo = $1, descricao = $2, tipo = $3,
          data_inicio = $4, data_fim = $5,
          local_nome = $6, local_endereco = $7,
          bairro = $8, cidade = $9,
          lideranca_id = $10, notificar_eleitores = $11,
          atualizado_em = NOW()
        WHERE id = $12 AND tenant_id = $13 AND ativo = TRUE
        RETURNING id
      `, [
        clean(d.titulo, 300), clean(d.descricao, 2000), d.tipo,
        d.data_inicio, d.data_fim || null,
        clean(d.local_nome, 300), clean(d.local_endereco, 400),
        clean(d.bairro, 100), clean(d.cidade, 100),
        d.lideranca_id || null, d.notificar_eleitores || false,
        req.params.id, req.user.tenant_id,
      ]);
      if (!r.rowCount) return res.status(404).json({ error: 'Evento não encontrado.' });
      res.json({ success: true });
    } catch (err) {
      console.error('[AGENDA] PUT /:id:', err);
      res.status(500).json({ error: 'Erro ao atualizar evento.' });
    }
  }
);

// DELETE /api/agenda/:id
router.delete('/:id',
  requireAdmin,
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const r = await db.query(
        `UPDATE agenda_eventos SET ativo = FALSE, atualizado_em = NOW()
         WHERE id = $1 AND tenant_id = $2 AND ativo = TRUE RETURNING id`,
        [req.params.id, req.user.tenant_id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Evento não encontrado.' });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Erro ao excluir evento.' });
    }
  }
);

// POST /api/agenda/:id/notificar
router.post('/:id/notificar',
  requireAdmin,
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const tid = req.user.tenant_id;
      const evR = await db.query(
        `SELECT * FROM agenda_eventos WHERE id = $1 AND tenant_id = $2 AND ativo = TRUE`,
        [req.params.id, tid]
      );
      if (!evR.rowCount) return res.status(404).json({ error: 'Evento não encontrado.' });
      const ev = evR.rows[0];

      if (!ev.bairro && !ev.lideranca_id) {
        return res.status(400).json({ error: 'Evento precisa ter bairro ou liderança para notificar.' });
      }

      const cfgR = await db.query(
        `SELECT phone_id, access_token, country_code FROM whatsapp_config WHERE tenant_id = $1`,
        [tid]
      );
      if (!cfgR.rowCount || !cfgR.rows[0].access_token) {
        return res.status(400).json({ error: 'WhatsApp não configurado.' });
      }

      const conds = ['e.tenant_id = $1', 'e.ativo = TRUE', 'e.telefone IS NOT NULL'];
      const params = [tid];
      let p = 2;
      if (ev.bairro) { conds.push(`e.bairro ILIKE $${p++}`); params.push(`%${ev.bairro}%`); }
      if (ev.lideranca_id) { conds.push(`e.lideranca_id = $${p++}`); params.push(ev.lideranca_id); }

      const eleitoresR = await db.query(
        `SELECT id, nome, telefone FROM eleitores e WHERE ${conds.join(' AND ')} LIMIT 1000`, params
      );

      const dataFmt = new Date(ev.data_inicio).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo'
      });
      const mensagem = `📅 *${ev.titulo}*\n\n📍 ${ev.local_nome || 'Local a confirmar'}${ev.local_endereco ? '\n' + ev.local_endereco : ''}\n🗓 ${dataFmt}\n\n${ev.descricao ? ev.descricao.substring(0, 200) + '\n\n' : ''}Contamos com sua presença!`;

      let enviados = 0;
      const { decrypt } = require('../services/crypto');
      const cfg = cfgR.rows[0];
      if (cfg.access_token) cfg.access_token = decrypt(cfg.access_token) || cfg.access_token;

      res.json({ success: true, total: eleitoresR.rows.length, mensagem });

      (async () => {
        for (const e of eleitoresR.rows) {
          try {
            const phone = (cfg.country_code || '55') + e.telefone.replace(/\D/g, '');
            await fetch(`https://graph.facebook.com/v20.0/${cfg.phone_id}/messages`, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: mensagem } }),
            });
            enviados++;
            await new Promise(r => setTimeout(r, 150));
          } catch {}
        }
        await db.query(
          `UPDATE agenda_eventos SET notificados = $1, atualizado_em = NOW() WHERE id = $2`,
          [enviados, ev.id]
        );
      })();
    } catch (err) {
      console.error('[AGENDA] POST /:id/notificar:', err);
      res.status(500).json({ error: 'Erro ao notificar.' });
    }
  }
);

/* ──────────────────────────────────────────────────────────
   PÚBLICA (sem autenticação) — link mestre por tenant
─────────────────────────────────────────────────────────── */

// GET /api/agenda/publico/:token — usa o LINK MESTRE do tenant
router.get('/publico/:token', async (req, res) => {
  try {
    const token = String(req.params.token).replace(/[^a-f0-9]/gi, '');
    if (token.length !== 64) return res.status(400).json({ error: 'Token inválido.' });

    // 1) Procura primeiro nos links mestres
    const lR = await db.query(
      `SELECT tenant_id FROM agenda_links_publicos WHERE token = $1 AND ativo = TRUE`,
      [token]
    );
    let tid = null;
    if (lR.rowCount) tid = lR.rows[0].tenant_id;

    // 2) Fallback: aceita também token de evento (compatibilidade)
    if (!tid) {
      const eR = await db.query(
        `SELECT DISTINCT tenant_id FROM agenda_eventos WHERE token_publico = $1 AND ativo = TRUE`,
        [token]
      );
      if (eR.rowCount) tid = eR.rows[0].tenant_id;
    }

    if (!tid) return res.status(404).json({ error: 'Agenda não encontrada.' });

    const r = await db.query(`
      SELECT a.id, a.titulo, a.descricao, a.tipo,
             a.data_inicio, a.data_fim,
             a.local_nome, a.local_endereco, a.bairro, a.cidade,
             l.nome AS lideranca_nome
      FROM agenda_eventos a
      LEFT JOIN liderancas l ON l.id = a.lideranca_id AND l.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1 AND a.ativo = TRUE AND a.data_inicio >= NOW() - INTERVAL '1 day'
      ORDER BY a.data_inicio ASC LIMIT 100
    `, [tid]);

    const metaR = await db.query(
      `SELECT candidato, cargo FROM meta_votos WHERE tenant_id = $1`,
      [tid]
    );
    const meta = metaR.rows[0] || {};

    res.json({
      candidato: meta.candidato || 'Agenda de Eventos',
      cargo: meta.cargo || '',
      eventos: r.rows.map(row => ({ ...row, id: Number(row.id) })),
    });
  } catch (err) {
    console.error('[AGENDA] GET /publico/:token:', err);
    res.status(500).json({ error: 'Erro ao buscar agenda pública.' });
  }
});

module.exports = router;
