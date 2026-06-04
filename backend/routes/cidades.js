/**
 * backend/routes/cidades.js
 * Endpoints para verificação e padronização de cidades.
 *
 * Endpoints:
 *  GET  /api/cidades/duplicadas          — Detecta cidades similares (fuzzy)
 *  GET  /api/cidades/sem-cidade          — Lista eleitores sem cidade preenchida
 *  GET  /api/cidades/sugestoes-por-bairro — Sugere cidade baseado em quem tem o mesmo bairro
 *  POST /api/cidades/unificar            — Renomeia em massa cidade A → cidade B
 *  POST /api/cidades/preencher-em-massa  — Preenche cidade nos eleitores especificados
 */

'use strict';

const express = require('express');
const router = express.Router();

/* ════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════ */

/** Normaliza string: minúsculo, sem acento, sem espaços/símbolos */
function normalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** Distância de Levenshtein (medida de similaridade entre strings) */
function levenshtein(a, b) {
  if (!a || !b) return Math.max(a?.length || 0, b?.length || 0);
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 5) return 99;
  const dp = Array.from({ length: la + 1 }, (_, i) => [i]);
  for (let j = 1; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) {
    for (let j = 1; j <= lb; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[la][lb];
}

/** Similaridade 0..1 (1 = idêntico) */
function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

/* ════════════════════════════════════════════════
   1) DETECTAR CIDADES DUPLICADAS/SIMILARES
════════════════════════════════════════════════ */
router.get('/duplicadas', async (req, res, next) => {
  try {
    const tenantId = req.actingTenant || req.user.tenant_id;
    const { rows } = await req.db.query(
      `SELECT cidade, COUNT(*)::int AS qtd
       FROM eleitores
       WHERE tenant_id = $1
         AND cidade IS NOT NULL
         AND TRIM(cidade) <> ''
       GROUP BY cidade
       ORDER BY cidade ASC`,
      [tenantId]
    );

    // Agrupa cidades similares
    const cidades = rows.map(r => ({ nome: r.cidade, qtd: r.qtd, norm: normalize(r.cidade) }));
    const grupos = [];
    const visited = new Set();

    for (let i = 0; i < cidades.length; i++) {
      if (visited.has(i)) continue;
      const grupo = [cidades[i]];
      visited.add(i);
      for (let j = i + 1; j < cidades.length; j++) {
        if (visited.has(j)) continue;
        const sim = similarity(cidades[i].nome, cidades[j].nome);
        if (sim >= 0.78) {
          grupo.push({ ...cidades[j], similaridade: Math.round(sim * 100) });
          visited.add(j);
        }
      }
      if (grupo.length > 1) {
        // Escolhe a versão "canônica" (a com mais ocorrências OU melhor capitalização)
        const canonica = grupo.reduce((best, curr) => {
          if (curr.qtd > best.qtd) return curr;
          if (curr.qtd === best.qtd && curr.nome.length > best.nome.length) return curr;
          return best;
        });
        grupos.push({
          sugerida: canonica.nome,
          variantes: grupo.map(c => ({
            nome: c.nome,
            qtd: c.qtd,
            similaridade: c.similaridade || 100,
            sugerida: c.nome === canonica.nome,
          })),
        });
      }
    }

    res.json({
      total_cidades_distintas: cidades.length,
      total_grupos: grupos.length,
      total_a_unificar: grupos.reduce((sum, g) => sum + g.variantes.filter(v => !v.sugerida).reduce((s, v) => s + v.qtd, 0), 0),
      grupos,
    });
  } catch (err) {
    next(err);
  }
});

/* ════════════════════════════════════════════════
   2) ELEITORES SEM CIDADE
════════════════════════════════════════════════ */
router.get('/sem-cidade', async (req, res, next) => {
  try {
    const tenantId = req.actingTenant || req.user.tenant_id;
    const { rows } = await req.db.query(
      `SELECT id, nome, endereco, numero, bairro
       FROM eleitores
       WHERE tenant_id = $1
         AND (cidade IS NULL OR TRIM(cidade) = '')
       ORDER BY bairro NULLS LAST, nome ASC`,
      [tenantId]
    );
    res.json({
      total: rows.length,
      eleitores: rows,
    });
  } catch (err) {
    next(err);
  }
});

/* ════════════════════════════════════════════════
   3) SUGESTÕES DE CIDADE POR BAIRRO
   - Para cada bairro distinto entre os eleitores SEM cidade,
     verifica qual é a cidade mais comum entre os eleitores que
     têm esse mesmo bairro E têm cidade preenchida.
════════════════════════════════════════════════ */
router.get('/sugestoes-por-bairro', async (req, res, next) => {
  try {
    const tenantId = req.actingTenant || req.user.tenant_id;

    // 1) Bairros distintos com eleitores SEM cidade
    const { rows: bairrosSemCidade } = await req.db.query(
      `SELECT bairro, COUNT(*)::int AS qtd_sem_cidade
       FROM eleitores
       WHERE tenant_id = $1
         AND (cidade IS NULL OR TRIM(cidade) = '')
         AND bairro IS NOT NULL
         AND TRIM(bairro) <> ''
       GROUP BY bairro
       ORDER BY qtd_sem_cidade DESC, bairro ASC`,
      [tenantId]
    );

    // 2) Para cada bairro, busca a cidade mais frequente
    const sugestoes = [];
    for (const b of bairrosSemCidade) {
      const { rows: topCidade } = await req.db.query(
        `SELECT cidade, COUNT(*)::int AS qtd
         FROM eleitores
         WHERE tenant_id = $1
           AND bairro = $2
           AND cidade IS NOT NULL
           AND TRIM(cidade) <> ''
         GROUP BY cidade
         ORDER BY qtd DESC
         LIMIT 1`,
        [tenantId, b.bairro]
      );
      sugestoes.push({
        bairro: b.bairro,
        qtd_sem_cidade: b.qtd_sem_cidade,
        cidade_sugerida: topCidade[0]?.cidade || null,
        confianca: topCidade[0] ? (topCidade[0].qtd > 0 ? 'alta' : 'media') : 'nenhuma',
        baseado_em: topCidade[0]?.qtd || 0,
      });
    }

    // Bairros sem nenhuma referência (precisam preencher manual)
    const semSugestao = sugestoes.filter(s => !s.cidade_sugerida);

    res.json({
      total_bairros: sugestoes.length,
      com_sugestao: sugestoes.filter(s => s.cidade_sugerida).length,
      sem_sugestao: semSugestao.length,
      sugestoes,
    });
  } catch (err) {
    next(err);
  }
});

/* ════════════════════════════════════════════════
   4) UNIFICAR CIDADES (renomear em massa)
   Body: { de: ["Sao Paulo", "S. Paulo"], para: "São Paulo" }
════════════════════════════════════════════════ */
router.post('/unificar', async (req, res, next) => {
  try {
    if (req.user.tipo === 'comum') {
      return res.status(403).json({ error: 'Apenas administradores podem unificar cidades.' });
    }
    const tenantId = req.actingTenant || req.user.tenant_id;
    const { de, para } = req.body;
    if (!Array.isArray(de) || !de.length || !para || !para.trim()) {
      return res.status(400).json({ error: 'Parâmetros inválidos. Envie { de: [...], para: "..." }.' });
    }
    const { rowCount } = await req.db.query(
      `UPDATE eleitores
       SET cidade = $1, atualizado_em = NOW()
       WHERE tenant_id = $2
         AND cidade = ANY($3)`,
      [para.trim(), tenantId, de]
    );
    res.json({ atualizados: rowCount, de, para: para.trim() });
  } catch (err) {
    next(err);
  }
});

/* ════════════════════════════════════════════════
   5) PREENCHER CIDADE EM MASSA POR BAIRRO
   Body: { bairro: "Centro", cidade: "Guarulhos" }
   Atualiza todos os eleitores desse bairro que estão SEM cidade.
════════════════════════════════════════════════ */
router.post('/preencher-em-massa', async (req, res, next) => {
  try {
    if (req.user.tipo === 'comum') {
      return res.status(403).json({ error: 'Apenas administradores podem preencher em massa.' });
    }
    const tenantId = req.actingTenant || req.user.tenant_id;
    const { bairro, cidade } = req.body;
    if (!bairro || !cidade || !cidade.trim()) {
      return res.status(400).json({ error: 'Envie { bairro: "...", cidade: "..." }.' });
    }
    const { rowCount } = await req.db.query(
      `UPDATE eleitores
       SET cidade = $1, atualizado_em = NOW()
       WHERE tenant_id = $2
         AND bairro = $3
         AND (cidade IS NULL OR TRIM(cidade) = '')`,
      [cidade.trim(), tenantId, bairro]
    );
    res.json({ atualizados: rowCount, bairro, cidade: cidade.trim() });
  } catch (err) {
    next(err);
  }
});

/* ════════════════════════════════════════════════
   6) PREENCHER CIDADE NUM SUBCONJUNTO DE IDS
   Body: { ids: [1, 2, 3], cidade: "Guarulhos" }
   Usado quando o usuário escolhe IDs específicos.
════════════════════════════════════════════════ */
router.post('/preencher-ids', async (req, res, next) => {
  try {
    if (req.user.tipo === 'comum') {
      return res.status(403).json({ error: 'Apenas administradores podem preencher em massa.' });
    }
    const tenantId = req.actingTenant || req.user.tenant_id;
    const { ids, cidade } = req.body;
    if (!Array.isArray(ids) || !ids.length || !cidade || !cidade.trim()) {
      return res.status(400).json({ error: 'Envie { ids: [...], cidade: "..." }.' });
    }
    const idsNumericos = ids.map(Number).filter(n => Number.isFinite(n));
    if (!idsNumericos.length) {
      return res.status(400).json({ error: 'IDs inválidos.' });
    }
    const { rowCount } = await req.db.query(
      `UPDATE eleitores
       SET cidade = $1, atualizado_em = NOW()
       WHERE tenant_id = $2
         AND id = ANY($3::int[])`,
      [cidade.trim(), tenantId, idsNumericos]
    );
    res.json({ atualizados: rowCount, cidade: cidade.trim() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
