/**
 * backend/routes/disparo-route.js
 * Disparo Segmentado por Perfil — WhatsApp com filtros avançados
 */

'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/* ── POST /api/disparo/preview ───────────────────────────────
   Retorna a lista de eleitores que seriam atingidos
   pelos filtros informados (sem disparar nada)               */
router.post('/preview',
  requireAdmin,
  [
    body('filtros').isObject(),
    body('filtros.bairro').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('filtros.cidade').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('filtros.lideranca_id').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    body('filtros.intencao_voto').optional({ nullable: true })
      .isIn(['confirmado','provavel','indeciso','risco','contra']),
    body('filtros.faixa_etaria_de').optional({ nullable: true }).isInt({ min: 0, max: 120 }),
    body('filtros.faixa_etaria_ate').optional({ nullable: true }).isInt({ min: 0, max: 120 }),
    body('filtros.sem_contato_dias').optional({ nullable: true }).isInt({ min: 1, max: 365 }),
    body('filtros.somente_com_telefone').optional().isBoolean(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const { rows, total } = await buildQuery(req.user.tenant_id, req.body.filtros, true);
      res.json({
        total,
        amostra: rows.slice(0, 10).map(r => ({
          id: Number(r.id), nome: r.nome, telefone: r.telefone,
          bairro: r.bairro, cidade: r.cidade, intencao_voto: r.intencao_voto,
        })),
      });
    } catch (err) {
      console.error('[DISPARO] POST /preview:', err);
      res.status(500).json({ error: 'Erro ao calcular preview.' });
    }
  }
);

/* ── POST /api/disparo/enviar ────────────────────────────────
   Efetua o disparo segmentado                                */
router.post('/enviar',
  requireAdmin,
  [
    body('filtros').isObject(),
    body('mensagem').isString().isLength({ min: 1, max: 4096 }),
    body('filtros.bairro').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('filtros.cidade').optional({ nullable: true }).isString().isLength({ max: 100 }),
    body('filtros.lideranca_id').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    body('filtros.intencao_voto').optional({ nullable: true })
      .isIn(['confirmado','provavel','indeciso','risco','contra']),
    body('filtros.faixa_etaria_de').optional({ nullable: true }).isInt({ min: 0, max: 120 }),
    body('filtros.faixa_etaria_ate').optional({ nullable: true }).isInt({ min: 0, max: 120 }),
    body('filtros.sem_contato_dias').optional({ nullable: true }).isInt({ min: 1, max: 365 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;

    const tid = req.user.tenant_id;
    const mensagem = String(req.body.mensagem).trim();

    try {
      // Config do WhatsApp
      const cfgR = await db.query(
        `SELECT phone_id, access_token, country_code FROM whatsapp_config WHERE tenant_id = $1`,
        [tid]
      );
      if (!cfgR.rowCount || !cfgR.rows[0].phone_id) {
        return res.status(400).json({ error: 'WhatsApp não configurado.' });
      }
      const cfg = cfgR.rows[0];
      const { decrypt } = require('../services/crypto');
      if (cfg.access_token) cfg.access_token = decrypt(cfg.access_token) || cfg.access_token;
      if (!cfg.access_token) return res.status(400).json({ error: 'Token do WhatsApp inválido.' });

      // Busca destinatários
      const { rows } = await buildQuery(tid, req.body.filtros, false);

      if (!rows.length) {
        return res.status(400).json({ error: 'Nenhum eleitor encontrado com esses filtros.' });
      }

      const loteId = `seg_${Date.now()}`;
      res.json({ success: true, total: rows.length, lote_id: loteId });

      // Disparo em background
      (async () => {
        let enviados = 0, falhas = 0;
        for (const e of rows) {
          try {
            const phone = (cfg.country_code || '55') + e.telefone.replace(/\D/g, '');
            const resp = await fetch(`https://graph.facebook.com/v20.0/${cfg.phone_id}/messages`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${cfg.access_token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: phone,
                type: 'text',
                text: { body: mensagem },
              }),
            });
            const data = await resp.json();
            const ok = resp.ok && data.messages?.[0]?.id;
            await db.query(`
              INSERT INTO whatsapp_log
                (tenant_id, eleitor_id, eleitor_nome, telefone, tipo, conteudo,
                 status, message_id, lote_id, enviado_por)
              VALUES ($1,$2,$3,$4,'text',$5,$6,$7,$8,$9)
            `, [
              tid, e.id, e.nome, e.telefone, mensagem,
              ok ? 'sent' : 'failed',
              ok ? data.messages[0].id : null,
              loteId, req.user.id,
            ]);
            // Atualiza ultimo_contato
            if (ok) {
              await db.query(
                `UPDATE eleitores SET ultimo_contato = NOW() WHERE id = $1 AND tenant_id = $2`,
                [e.id, tid]
              );
              enviados++;
            } else {
              falhas++;
            }
            await new Promise(r => setTimeout(r, 120));
          } catch { falhas++; }
        }
        console.log(`[DISPARO] Lote ${loteId}: ${enviados} enviados, ${falhas} falhas`);
      })();

    } catch (err) {
      console.error('[DISPARO] POST /enviar:', err);
      res.status(500).json({ error: 'Erro ao iniciar disparo.' });
    }
  }
);

/* ── Função auxiliar: monta a query com os filtros ──────────*/
async function buildQuery(tenantId, filtros = {}, countOnly = false) {
  const conds = ['e.tenant_id = $1', 'e.ativo = TRUE'];
  const params = [tenantId];
  let p = 2;

  // Sempre exige telefone para disparo
  conds.push('e.telefone IS NOT NULL');

  if (filtros.bairro) {
    conds.push(`e.bairro ILIKE $${p++}`);
    params.push(`%${filtros.bairro}%`);
  }
  if (filtros.cidade) {
    conds.push(`e.cidade ILIKE $${p++}`);
    params.push(`%${filtros.cidade}%`);
  }
  if (filtros.lideranca_id) {
    conds.push(`e.lideranca_id = $${p++}`);
    params.push(filtros.lideranca_id);
  }
  if (filtros.intencao_voto) {
    conds.push(`e.intencao_voto = $${p++}`);
    params.push(filtros.intencao_voto);
  }
  if (filtros.faixa_etaria_de != null) {
    conds.push(`DATE_PART('year', AGE(e.data_nascimento)) >= $${p++}`);
    params.push(filtros.faixa_etaria_de);
  }
  if (filtros.faixa_etaria_ate != null) {
    conds.push(`DATE_PART('year', AGE(e.data_nascimento)) <= $${p++}`);
    params.push(filtros.faixa_etaria_ate);
  }
  if (filtros.sem_contato_dias) {
    conds.push(`(e.ultimo_contato < NOW() - ($${p++} || ' days')::INTERVAL OR e.ultimo_contato IS NULL)`);
    params.push(filtros.sem_contato_dias);
  }

  const where = conds.join(' AND ');

  const countR = await db.query(
    `SELECT COUNT(*)::INT AS total FROM eleitores e WHERE ${where}`,
    params
  );
  const total = countR.rows[0].total;

  const rows = await db.query(
    `SELECT e.id, e.nome, e.telefone, e.bairro, e.cidade, e.intencao_voto
     FROM eleitores e
     WHERE ${where}
     ORDER BY e.nome ASC
     LIMIT 5000`,
    params
  );

  return { rows: rows.rows, total };
}

module.exports = router;
