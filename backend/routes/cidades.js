/**
 * backend/routes/cidades.js
 *
 * Verifica e padroniza nomes de cidades dos eleitores.
 *
 * Endpoints:
 *   GET  /api/cidades/distintos               — todas as cidades distintas com contagem
 *   GET  /api/cidades/duplicadas              — grupos de cidades com escrita similar
 *   GET  /api/cidades/sem-cidade              — eleitores sem cidade preenchida
 *   GET  /api/cidades/sugestoes-por-bairro    — sugere cidade baseada em quem tem o mesmo bairro
 *   POST /api/cidades/unificar                — renomeia em massa { de: [...], para: 'X' }
 *   POST /api/cidades/preencher-em-massa      — preenche cidade nos eleitores de um bairro
 *   POST /api/cidades/preencher-ids           — preenche cidade num conjunto de ids
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
   NORMALIZAÇÃO — chave para agrupar cidades similares
   ════════════════════════════════════════════════════════════ */
/**
 * Gera uma chave de comparação para um nome de cidade.
 * - Lowercase, sem acento, sem pontuação
 * - Expande abreviações comuns ("S." → "sao", "Sto." → "santo", etc)
 *
 * Exemplos:
 *   "São Paulo"  → "sao paulo"
 *   "Sao Paulo"  → "sao paulo"
 *   "S. Paulo"   → "sao paulo"
 *   "SAO PAULO"  → "sao paulo"  (mesmo grupo)
 */
function normalizar(nome) {
  if (!nome) return '';
  return String(nome)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // remove acentos
    // Expande abreviações comuns de nomes de cidades
    .replace(/\bs\.?\b/g, 'sao')
    .replace(/\bsto\.?\b/g, 'santo')
    .replace(/\bsta\.?\b/g, 'santa')
    .replace(/\bn\.?\b/g, 'nossa')
    .replace(/\bsra\.?\b/g, 'senhora')
    // Remove pontuação
    .replace(/[.,;:!?'"\-_/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sugere a forma "canônica" preferida entre as variantes.
 * Critérios:
 *   1. Sem abreviações ("São Paulo" vence "S. Paulo")
 *   2. Com acentos ("São Paulo" vence "Sao Paulo")
 *   3. Mais usada (maior total)
 */
function sugerirCanonico(variantes) {
  const ordenado = [...variantes].sort((a, b) => {
    const aTemAbrev = /\b(s|sto|sta|n|sra)\.\b/i.test(a.nome) ? 1 : 0;
    const bTemAbrev = /\b(s|sto|sta|n|sra)\.\b/i.test(b.nome) ? 1 : 0;
    if (aTemAbrev !== bTemAbrev) return aTemAbrev - bTemAbrev;

    const aTemAcento = /[áéíóúâêîôûãõàèìòùç]/i.test(a.nome) ? 0 : 1;
    const bTemAcento = /[áéíóúâêîôûãõàèìòùç]/i.test(b.nome) ? 0 : 1;
    if (aTemAcento !== bTemAcento) return aTemAcento - bTemAcento;

    return b.total - a.total;
  });
  return ordenado[0].nome;
}

/* ════════════════════════════════════════════════════════════
   GET /api/cidades/distintos
   ════════════════════════════════════════════════════════════ */
router.get('/distintos', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT cidade, COUNT(*)::INT AS total
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE AND cidade IS NOT NULL AND cidade <> ''
      GROUP BY cidade
      ORDER BY total DESC, cidade ASC
    `, [req.user.tenant_id]);
    res.json({ total: r.rows.length, cidades: r.rows });
  } catch (err) {
    console.error('[CIDADES] GET /distintos:', err);
    res.status(500).json({ error: 'Erro ao listar cidades.' });
  }
});

/* ════════════════════════════════════════════════════════════
   GET /api/cidades/duplicadas
   ════════════════════════════════════════════════════════════ */
router.get('/duplicadas', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT cidade, COUNT(*)::INT AS total
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE AND cidade IS NOT NULL AND cidade <> ''
      GROUP BY cidade
      ORDER BY total DESC
    `, [req.user.tenant_id]);

    const todasCidades = r.rows;

    // Agrupa por chave normalizada
    const grupos = {};
    todasCidades.forEach(c => {
      const chave = normalizar(c.cidade);
      if (!chave) return;
      if (!grupos[chave]) grupos[chave] = [];
      grupos[chave].push({ nome: c.cidade, total: c.total });
    });

    // Só grupos com 2+ variantes
    const duplicados = Object.entries(grupos)
      .filter(([k, v]) => v.length >= 2)
      .map(([chave, variantes]) => {
        const totalAfetado = variantes.reduce((s, v) => s + v.total, 0);
        const sugestao = sugerirCanonico(variantes);
        const variantesOrdenadas = variantes
          .sort((a, b) => b.total - a.total)
          .map(v => ({
            nome: v.nome,
            qtd: v.total,
            similaridade: 100,    // já normalizadas pra mesma chave
            sugerida: v.nome === sugestao,
          }));
        return {
          chave_normalizada: chave,
          sugerida: sugestao,
          total_eleitores_afetados: totalAfetado,
          variantes: variantesOrdenadas,
        };
      })
      .sort((a, b) => b.total_eleitores_afetados - a.total_eleitores_afetados);

    res.json({
      total_cidades_distintas: todasCidades.length,
      total_grupos: duplicados.length,
      total_a_unificar: duplicados.reduce((sum, g) =>
        sum + g.variantes.filter(v => !v.sugerida).reduce((s, v) => s + v.qtd, 0)
      , 0),
      grupos: duplicados,
    });
  } catch (err) {
    console.error('[CIDADES] GET /duplicadas:', err);
    res.status(500).json({ error: 'Erro ao analisar cidades duplicadas.' });
  }
});

/* ════════════════════════════════════════════════════════════
   GET /api/cidades/sem-cidade
   ════════════════════════════════════════════════════════════ */
router.get('/sem-cidade', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT id, nome, endereco, numero, bairro
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
        AND (cidade IS NULL OR TRIM(cidade) = '')
      ORDER BY bairro NULLS LAST, nome ASC
    `, [req.user.tenant_id]);
    res.json({ total: r.rows.length, eleitores: r.rows });
  } catch (err) {
    console.error('[CIDADES] GET /sem-cidade:', err);
    res.status(500).json({ error: 'Erro ao listar eleitores sem cidade.' });
  }
});

/* ════════════════════════════════════════════════════════════
   GET /api/cidades/sugestoes-por-bairro
   - Para cada bairro com eleitores sem cidade, sugere
     a cidade mais comum dos eleitores que TÊM o mesmo bairro.
   ════════════════════════════════════════════════════════════ */
router.get('/sugestoes-por-bairro', async (req, res) => {
  try {
    const tid = req.user.tenant_id;

    // 1) Bairros com eleitores sem cidade
    const r1 = await db.query(`
      SELECT bairro, COUNT(*)::INT AS qtd_sem_cidade
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
        AND (cidade IS NULL OR TRIM(cidade) = '')
        AND bairro IS NOT NULL AND TRIM(bairro) <> ''
      GROUP BY bairro
      ORDER BY qtd_sem_cidade DESC, bairro ASC
    `, [tid]);

    // 2) Pra cada bairro, busca cidade mais comum entre quem TEM cidade
    const sugestoes = [];
    for (const b of r1.rows) {
      const r2 = await db.query(`
        SELECT cidade, COUNT(*)::INT AS qtd
        FROM eleitores
        WHERE tenant_id = $1 AND ativo = TRUE
          AND bairro = $2
          AND cidade IS NOT NULL AND TRIM(cidade) <> ''
        GROUP BY cidade
        ORDER BY qtd DESC
        LIMIT 1
      `, [tid, b.bairro]);

      sugestoes.push({
        bairro: b.bairro,
        qtd_sem_cidade: b.qtd_sem_cidade,
        cidade_sugerida: r2.rows[0]?.cidade || null,
        baseado_em: r2.rows[0]?.qtd || 0,
        confianca: r2.rows[0] ? 'alta' : 'nenhuma',
      });
    }

    const comSugestao = sugestoes.filter(s => s.cidade_sugerida);
    const semSugestao = sugestoes.filter(s => !s.cidade_sugerida);

    res.json({
      total_bairros: sugestoes.length,
      com_sugestao: comSugestao.length,
      sem_sugestao: semSugestao.length,
      sugestoes,
    });
  } catch (err) {
    console.error('[CIDADES] GET /sugestoes-por-bairro:', err);
    res.status(500).json({ error: 'Erro ao gerar sugestões.' });
  }
});

/* ════════════════════════════════════════════════════════════
   POST /api/cidades/unificar
   Body: { de: ['Sao Paulo', 'SAO PAULO'], para: 'São Paulo' }
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
        SET cidade = $1, atualizado_em = NOW()
        WHERE tenant_id = $2 AND ativo = TRUE AND cidade = ANY($3::text[])
        RETURNING id
      `, [para.trim(), tid, de]);

      try {
        await db.query(`
          INSERT INTO audit_log (tenant_id, user_id, action, detalhes, criado_em)
          VALUES ($1, $2, $3, $4, NOW())
        `, [
          tid, req.user.id, 'cidades.unificar',
          JSON.stringify({ de, para, eleitores_alterados: result.rowCount })
        ]);
      } catch { /* audit opcional */ }

      res.json({
        success: true,
        atualizados: result.rowCount,
        eleitores_atualizados: result.rowCount,
        para: para.trim(),
        de: de,
      });
    } catch (err) {
      console.error('[CIDADES] POST /unificar:', err);
      res.status(500).json({ error: 'Erro ao unificar cidades.' });
    }
  }
);

/* ════════════════════════════════════════════════════════════
   POST /api/cidades/preencher-em-massa
   Body: { bairro: 'Centro', cidade: 'Guarulhos' }
   Preenche a cidade para todos os eleitores desse bairro que
   estão sem cidade preenchida.
   ════════════════════════════════════════════════════════════ */
router.post('/preencher-em-massa',
  requireAdmin,
  [
    body('bairro').isString().trim().notEmpty().isLength({ max: 100 }),
    body('cidade').isString().trim().notEmpty().isLength({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { bairro, cidade } = req.body;
    const tid = req.user.tenant_id;

    try {
      const result = await db.query(`
        UPDATE eleitores
        SET cidade = $1, atualizado_em = NOW()
        WHERE tenant_id = $2 AND ativo = TRUE
          AND bairro = $3
          AND (cidade IS NULL OR TRIM(cidade) = '')
        RETURNING id
      `, [cidade.trim(), tid, bairro]);

      try {
        await db.query(`
          INSERT INTO audit_log (tenant_id, user_id, action, detalhes, criado_em)
          VALUES ($1, $2, $3, $4, NOW())
        `, [
          tid, req.user.id, 'cidades.preencher-em-massa',
          JSON.stringify({ bairro, cidade, atualizados: result.rowCount })
        ]);
      } catch { /* audit opcional */ }

      res.json({
        success: true,
        atualizados: result.rowCount,
        bairro,
        cidade: cidade.trim(),
      });
    } catch (err) {
      console.error('[CIDADES] POST /preencher-em-massa:', err);
      res.status(500).json({ error: 'Erro ao preencher cidades.' });
    }
  }
);

/* ════════════════════════════════════════════════════════════
   POST /api/cidades/preencher-ids
   Body: { ids: [1,2,3], cidade: 'Guarulhos' }
   ════════════════════════════════════════════════════════════ */
router.post('/preencher-ids',
  requireAdmin,
  [
    body('ids').isArray({ min: 1 }).withMessage('ids deve ser array com 1+ números'),
    body('ids.*').isInt({ min: 1 }),
    body('cidade').isString().trim().notEmpty().isLength({ min: 1, max: 100 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { ids, cidade } = req.body;
    const tid = req.user.tenant_id;

    try {
      const result = await db.query(`
        UPDATE eleitores
        SET cidade = $1, atualizado_em = NOW()
        WHERE tenant_id = $2 AND ativo = TRUE
          AND id = ANY($3::int[])
        RETURNING id
      `, [cidade.trim(), tid, ids]);

      res.json({
        success: true,
        atualizados: result.rowCount,
        cidade: cidade.trim(),
      });
    } catch (err) {
      console.error('[CIDADES] POST /preencher-ids:', err);
      res.status(500).json({ error: 'Erro ao preencher cidades.' });
    }
  }
);

module.exports = router;
