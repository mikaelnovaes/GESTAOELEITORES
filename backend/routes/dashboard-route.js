/**
 * backend/routes/dashboard-route.js  (v2 — com filtros)
 * Dashboard Analítico — KPIs, gráficos e projeções com filtros
 */

'use strict';

const express = require('express');
const { query, validationResult } = require('express-validator');
const db = require('../config/database');

const router = express.Router();

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/**
 * Monta cláusulas WHERE comuns para os filtros opcionais.
 * Retorna { where, params } onde "where" começa com 'tenant_id = $1 AND ativo = TRUE'.
 */
function buildEleitoresFilter(req) {
  const conds = ['e.tenant_id = $1', 'e.ativo = TRUE'];
  const params = [req.user.tenant_id];
  let p = 2;
  if (req.query.bairro)        { conds.push(`e.bairro ILIKE $${p++}`);   params.push(`%${req.query.bairro}%`); }
  if (req.query.cidade)        { conds.push(`e.cidade ILIKE $${p++}`);   params.push(`%${req.query.cidade}%`); }
  if (req.query.lideranca_id)  { conds.push(`e.lideranca_id = $${p++}`); params.push(req.query.lideranca_id); }
  return { where: conds.join(' AND '), params };
}

/* ══════════════════════════════════════════════════════
   GET /api/dashboard/stats — KPIs e gráficos
   Query params opcionais: bairro, cidade, lideranca_id
══════════════════════════════════════════════════════ */
router.get('/stats',
  [
    query('bairro').optional().isString().isLength({ max: 100 }),
    query('cidade').optional().isString().isLength({ max: 100 }),
    query('lideranca_id').optional().isInt({ min: 1 }).toInt(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const tid = req.user.tenant_id;
    const { where, params } = buildEleitoresFilter(req);

    try {
      // ── 1. KPIs gerais ────────────────────────────────────
      const totaisR = await db.query(`
        SELECT
          COUNT(*)::INT                                                          AS total_eleitores,
          COUNT(*) FILTER (WHERE e.intencao_voto = 'confirmado')::INT            AS confirmados,
          COUNT(*) FILTER (WHERE e.intencao_voto = 'provavel')::INT              AS provaveis,
          COUNT(*) FILTER (WHERE e.intencao_voto = 'indeciso')::INT              AS indecisos,
          COUNT(*) FILTER (WHERE e.intencao_voto = 'risco')::INT                 AS em_risco,
          COUNT(*) FILTER (WHERE e.criado_em >= NOW() - INTERVAL '7 days')::INT  AS novos_semana,
          COUNT(*) FILTER (WHERE e.criado_em >= NOW() - INTERVAL '30 days')::INT AS novos_mes,
          COUNT(*) FILTER (WHERE e.telefone IS NOT NULL)::INT                    AS com_telefone,
          COUNT(DISTINCT COALESCE(e.bairro,''))::INT
            - CASE WHEN COUNT(*) FILTER (WHERE e.bairro IS NULL) > 0 THEN 1 ELSE 0 END AS total_bairros,
          COUNT(DISTINCT COALESCE(e.cidade,''))::INT
            - CASE WHEN COUNT(*) FILTER (WHERE e.cidade IS NULL) > 0 THEN 1 ELSE 0 END AS total_cidades
        FROM eleitores e
        WHERE ${where}
      `, params);

      // ── 2. Total de lideranças (do tenant, não filtra) ────
      const lidTotalR = await db.query(`
        SELECT COUNT(*)::INT AS total_liderancas
        FROM liderancas WHERE tenant_id = $1 AND ativo = TRUE
      `, [tid]);

      // ── 3. Crescimento diário (últimos 30 dias) ──────────
      const crescimentoR = await db.query(`
        SELECT
          DATE(e.criado_em AT TIME ZONE 'America/Sao_Paulo') AS dia,
          COUNT(*)::INT AS novos
        FROM eleitores e
        WHERE ${where} AND e.criado_em >= NOW() - INTERVAL '30 days'
        GROUP BY dia
        ORDER BY dia ASC
      `, params);

      // ── 4. Distribuição por faixa etária ─────────────────
      const etariaR = await db.query(`
        SELECT
          CASE
            WHEN e.data_nascimento IS NULL                                     THEN 'Não informado'
            WHEN DATE_PART('year', AGE(e.data_nascimento)) < 18                THEN 'Menos de 18'
            WHEN DATE_PART('year', AGE(e.data_nascimento)) BETWEEN 18 AND 24   THEN '18–24'
            WHEN DATE_PART('year', AGE(e.data_nascimento)) BETWEEN 25 AND 34   THEN '25–34'
            WHEN DATE_PART('year', AGE(e.data_nascimento)) BETWEEN 35 AND 44   THEN '35–44'
            WHEN DATE_PART('year', AGE(e.data_nascimento)) BETWEEN 45 AND 59   THEN '45–59'
            WHEN DATE_PART('year', AGE(e.data_nascimento)) >= 60               THEN '60+'
          END AS faixa,
          COUNT(*)::INT AS total
        FROM eleitores e
        WHERE ${where}
        GROUP BY faixa
        ORDER BY MIN(COALESCE(DATE_PART('year', AGE(e.data_nascimento)), 999))
      `, params);

      // ── 5. Top bairros (15) ──────────────────────────────
      const bairrosR = await db.query(`
        SELECT
          COALESCE(e.bairro, '— Sem bairro') AS bairro,
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (WHERE e.intencao_voto = 'confirmado')::INT AS confirmados,
          COUNT(*) FILTER (WHERE e.intencao_voto = 'provavel')::INT   AS provaveis
        FROM eleitores e
        WHERE ${where}
        GROUP BY bairro
        ORDER BY total DESC
        LIMIT 15
      `, params);

      // ── 6. Top cidades (10) ──────────────────────────────
      const cidadesR = await db.query(`
        SELECT
          COALESCE(e.cidade, '— Sem cidade') AS cidade,
          COUNT(*)::INT AS total
        FROM eleitores e
        WHERE ${where}
        GROUP BY cidade
        ORDER BY total DESC
        LIMIT 10
      `, params);

      // ── 7. Projeção por liderança (independente do filtro de liderança) ──
      const projecaoLidR = await db.query(`
        SELECT
          l.id, l.nome, l.partido, l.expectativa_total AS meta,
          COUNT(e.id)::INT AS cadastrados,
          COUNT(e.id) FILTER (WHERE e.intencao_voto = 'confirmado')::INT AS confirmados,
          COUNT(e.id) FILTER (WHERE e.intencao_voto = 'provavel')::INT   AS provaveis,
          COUNT(e.id) FILTER (WHERE e.intencao_voto = 'risco')::INT      AS em_risco,
          (COUNT(e.id) FILTER (WHERE e.intencao_voto = 'confirmado') +
           COUNT(e.id) FILTER (WHERE e.intencao_voto = 'provavel'))::INT AS projecao_total,
          ROUND(
            CASE WHEN l.expectativa_total > 0
              THEN (COUNT(e.id) FILTER (WHERE e.intencao_voto = 'confirmado') +
                    COUNT(e.id) FILTER (WHERE e.intencao_voto = 'provavel'))::NUMERIC / l.expectativa_total * 100
              ELSE 0
            END
          )::INT AS pct_meta_projecao
        FROM liderancas l
        LEFT JOIN eleitores e ON e.lideranca_id = l.id AND e.tenant_id = l.tenant_id AND e.ativo = TRUE
        WHERE l.tenant_id = $1 AND l.ativo = TRUE
        GROUP BY l.id, l.nome, l.partido, l.expectativa_total
        ORDER BY projecao_total DESC, cadastrados DESC
        LIMIT 20
      `, [tid]);

      // ── 8. Meta global de votos ──────────────────────────
      const metaR = await db.query(
        `SELECT meta, candidato, cargo FROM meta_votos WHERE tenant_id = $1`,
        [tid]
      );

      // ── 9. Listas para filtros (bairros, cidades, lideranças) ──
      const bairrosListaR = await db.query(`
        SELECT DISTINCT bairro FROM eleitores
        WHERE tenant_id = $1 AND ativo = TRUE AND bairro IS NOT NULL AND bairro <> ''
        ORDER BY bairro
      `, [tid]);
      const cidadesListaR = await db.query(`
        SELECT DISTINCT cidade FROM eleitores
        WHERE tenant_id = $1 AND ativo = TRUE AND cidade IS NOT NULL AND cidade <> ''
        ORDER BY cidade
      `, [tid]);
      const liderancasListaR = await db.query(`
        SELECT id, nome FROM liderancas
        WHERE tenant_id = $1 AND ativo = TRUE
        ORDER BY nome
      `, [tid]);

      res.json({
        totais: { ...totaisR.rows[0], total_liderancas: lidTotalR.rows[0].total_liderancas },
        meta: metaR.rows[0] || { meta: 0, candidato: null, cargo: null },
        crescimento_diario: crescimentoR.rows,
        faixas_etarias: etariaR.rows,
        top_bairros: bairrosR.rows,
        top_cidades: cidadesR.rows,
        projecao_liderancas: projecaoLidR.rows.map(r => ({ ...r, id: Number(r.id) })),
        filtros_disponiveis: {
          bairros: bairrosListaR.rows.map(r => r.bairro),
          cidades: cidadesListaR.rows.map(r => r.cidade),
          liderancas: liderancasListaR.rows.map(r => ({ id: Number(r.id), nome: r.nome })),
        },
      });
    } catch (err) {
      console.error('[DASHBOARD] GET /stats:', err);
      res.status(500).json({ error: 'Erro ao calcular dashboard.' });
    }
  }
);

module.exports = router;
