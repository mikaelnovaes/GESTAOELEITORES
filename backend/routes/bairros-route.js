/**
 * backend/routes/bairros-route.js
 *
 * Detecta e unifica bairros com escrita similar.
 *
 * Endpoints:
 *   GET  /api/bairros/duplicados   — lista grupos de bairros parecidos com sugestão
 *   POST /api/bairros/unificar     — aplica unificação em massa { de: [...], para: 'X' }
 *   GET  /api/bairros/distintos    — lista todos bairros distintos (para preview)
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

/* ════════════════════════════════════════════════════════════
   NORMALIZAÇÃO — chave para agrupar bairros similares
   ════════════════════════════════════════════════════════════ */
/**
 * Gera uma "chave de comparação" para um nome de bairro.
 * - Lowercase
 * - Remove acentos
 * - Expande abreviações comuns (Jd. → Jardim, Pq. → Parque, V. → Vila, etc)
 * - Remove pontuação e espaços extras
 *
 * Exemplos:
 *   "Parque Paraíso" → "parque paraiso"
 *   "Pq. Paraiso"    → "parque paraiso"   (mesmo grupo)
 *   "Jd. Jacira"     → "jardim jacira"
 *   "Jardim Jacira"  → "jardim jacira"     (mesmo grupo)
 */
function normalizar(nome) {
  if (!nome) return '';
  return String(nome)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    // Expande abreviações comuns brasileiras (\b = início/fim de palavra)
    .replace(/\bjd\.?\b/g, 'jardim')
    .replace(/\bpq\.?\b/g, 'parque')
    .replace(/\bv\.?\b/g, 'vila')
    .replace(/\bres\.?\b/g, 'residencial')
    .replace(/\bcj\.?\b/g, 'conjunto')
    .replace(/\bch\.?\b/g, 'chacara')
    .replace(/\bst\.?\b/g, 'sitio')
    .replace(/\bnsa\.?\b/g, 'nossa')
    .replace(/\bsra\.?\b/g, 'senhora')
    .replace(/\bsto\.?\b/g, 'santo')
    .replace(/\bsta\.?\b/g, 'santa')
    .replace(/\bsao\b/g, 'sao')
    // Remove pontuação
    .replace(/[.,;:!?'"\-_/\\]/g, ' ')
    // Compacta espaços
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sugere a forma "canônica" preferida entre as variantes.
 * Critérios (em ordem):
 *   1. A mais usada (maior count)
 *   2. Sem abreviações
 *   3. Com acentos
 */
function sugerirCanonico(variantes) {
  // variantes = [{nome, total}, ...]
  const ordenado = [...variantes].sort((a, b) => {
    // Penaliza abreviações
    const aTemAbrev = /\b(jd|pq|v|res|cj|ch)\.?\b/i.test(a.nome) ? 1 : 0;
    const bTemAbrev = /\b(jd|pq|v|res|cj|ch)\.?\b/i.test(b.nome) ? 1 : 0;
    if (aTemAbrev !== bTemAbrev) return aTemAbrev - bTemAbrev;

    // Premia quem tem acento (parece mais correto)
    const aTemAcento = /[áéíóúâêîôûãõàèìòùç]/i.test(a.nome) ? 0 : 1;
    const bTemAcento = /[áéíóúâêîôûãõàèìòùç]/i.test(b.nome) ? 0 : 1;
    if (aTemAcento !== bTemAcento) return aTemAcento - bTemAcento;

    // Mais usado primeiro
    return b.total - a.total;
  });
  return ordenado[0].nome;
}

/* ════════════════════════════════════════════════════════════
   GET /api/bairros/distintos
   ════════════════════════════════════════════════════════════ */
router.get('/distintos', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT bairro, COUNT(*)::INT AS total
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE AND bairro IS NOT NULL AND bairro <> ''
      GROUP BY bairro
      ORDER BY total DESC, bairro ASC
    `, [req.user.tenant_id]);
    res.json({ total: r.rows.length, bairros: r.rows });
  } catch (err) {
    console.error('[BAIRROS] GET /distintos:', err);
    res.status(500).json({ error: 'Erro ao listar bairros.' });
  }
});

/* ════════════════════════════════════════════════════════════
   GET /api/bairros/duplicados
   ════════════════════════════════════════════════════════════ */
router.get('/duplicados', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT bairro, COUNT(*)::INT AS total
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE AND bairro IS NOT NULL AND bairro <> ''
      GROUP BY bairro
      ORDER BY total DESC
    `, [req.user.tenant_id]);

    const todosBairros = r.rows;

    // Agrupa por chave normalizada
    const grupos = {};
    todosBairros.forEach(b => {
      const chave = normalizar(b.bairro);
      if (!chave) return;
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push({ nome: b.bairro, total: b.total });
    });

    // Filtra grupos com 2+ variantes (são esses que importam)
    const duplicados = Object.entries(grupos)
      .filter(([k, v]) => v.length >= 2)
      .map(([chave, variantes]) => {
        const totalAfetado = variantes.reduce((s, v) => s + v.total, 0);
        return {
          chave_normalizada: chave,
          sugestao_canonica: sugerirCanonico(variantes),
          total_eleitores_afetados: totalAfetado,
          variantes: variantes.sort((a, b) => b.total - a.total),
        };
      })
      .sort((a, b) => b.total_eleitores_afetados - a.total_eleitores_afetados);

    res.json({
      total_grupos: duplicados.length,
      total_eleitores_afetados: duplicados.reduce((s, g) => s + g.total_eleitores_afetados, 0),
      grupos: duplicados,
    });
  } catch (err) {
    console.error('[BAIRROS] GET /duplicados:', err);
    res.status(500).json({ error: 'Erro ao analisar bairros duplicados.' });
  }
});

/* ════════════════════════════════════════════════════════════
   POST /api/bairros/unificar
   Body: { de: ['Pq. Paraíso', 'Parque Paraiso'], para: 'Parque Paraíso' }
   ════════════════════════════════════════════════════════════ */
router.post('/unificar',
  requireAdmin,
  [
    body('de').isArray({ min: 1 }).withMessage('de deve ser array com 1+ nomes'),
    body('de.*').isString().notEmpty().isLength({ max: 100 }),
    body('para').isString().trim().notEmpty().isLength({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { de, para } = req.body;
    const tid = req.user.tenant_id;

    try {
      const result = await db.query(`
        UPDATE eleitores
        SET bairro = $1, atualizado_em = NOW()
        WHERE tenant_id = $2 AND ativo = TRUE AND bairro = ANY($3::text[])
        RETURNING id
      `, [para.trim(), tid, de]);

      // Audit log
      try {
        await db.query(`
          INSERT INTO audit_log (tenant_id, user_id, action, detalhes, criado_em)
          VALUES ($1, $2, $3, $4, NOW())
        `, [
          tid,
          req.user.id,
          'bairros.unificar',
          JSON.stringify({ de, para, eleitores_alterados: result.rowCount })
        ]);
      } catch { /* audit log opcional */ }

      res.json({
        success: true,
        eleitores_atualizados: result.rowCount,
        para: para.trim(),
        de: de,
      });
    } catch (err) {
      console.error('[BAIRROS] POST /unificar:', err);
      res.status(500).json({ error: 'Erro ao unificar bairros.' });
    }
  }
);

module.exports = router;
