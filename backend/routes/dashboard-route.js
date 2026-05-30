/**
 * backend/routes/dashboard-route.js
 * Dashboard Analítico — métricas e gráficos da campanha
 */

'use strict';

const express = require('express');
const db = require('../config/database');

const router = express.Router();

/* ── GET /api/dashboard/stats ────────────────────────────────
   Dados completos para o dashboard analítico                 */
router.get('/stats', async (req, res) => {
  try {
    const tid = req.user.tenant_id;

    // ── 1. Crescimento diário (últimos 30 dias) ──
    const crescimentoR = await db.query(`
      SELECT
        DATE(criado_em AT TIME ZONE 'America/Sao_Paulo') AS dia,
        COUNT(*)::INT AS novos
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
        AND criado_em >= NOW() - INTERVAL '30 days'
      GROUP BY dia
      ORDER BY dia ASC
    `, [tid]);

    // ── 2. Distribuição por faixa etária ──
    const etariaR = await db.query(`
      SELECT
        CASE
          WHEN data_nascimento IS NULL                                     THEN 'Não informado'
          WHEN DATE_PART('year', AGE(data_nascimento)) < 18                THEN 'Menos de 18'
          WHEN DATE_PART('year', AGE(data_nascimento)) BETWEEN 18 AND 24   THEN '18–24'
          WHEN DATE_PART('year', AGE(data_nascimento)) BETWEEN 25 AND 34   THEN '25–34'
          WHEN DATE_PART('year', AGE(data_nascimento)) BETWEEN 35 AND 44   THEN '35–44'
          WHEN DATE_PART('year', AGE(data_nascimento)) BETWEEN 45 AND 59   THEN '45–59'
          WHEN DATE_PART('year', AGE(data_nascimento)) >= 60               THEN '60+'
        END AS faixa,
        COUNT(*)::INT AS total
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
      GROUP BY faixa
      ORDER BY MIN(COALESCE(DATE_PART('year', AGE(data_nascimento)), 999)) ASC
    `, [tid]);

    // ── 3. Top 10 bairros ──
    const bairrosR = await db.query(`
      SELECT
        COALESCE(bairro, '— Sem bairro') AS bairro,
        COUNT(*)::INT AS total,
        COUNT(*) FILTER (WHERE intencao_voto = 'confirmado')::INT AS confirmados
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
      GROUP BY bairro
      ORDER BY total DESC
      LIMIT 10
    `, [tid]);

    // ── 4. Meta vs realizado por liderança ──
    const liderancasR = await db.query(`
      SELECT
        l.nome,
        l.expectativa_total AS meta,
        COUNT(e.id)::INT AS cadastrados,
        COUNT(e.id) FILTER (WHERE e.intencao_voto = 'confirmado')::INT AS confirmados,
        COUNT(e.id) FILTER (WHERE e.intencao_voto = 'provavel')::INT   AS provaveis,
        ROUND(
          CASE WHEN l.expectativa_total > 0
            THEN COUNT(e.id)::NUMERIC / l.expectativa_total * 100
            ELSE 0
          END
        )::INT AS pct_cadastro
      FROM liderancas l
      LEFT JOIN eleitores e ON e.lideranca_id = l.id AND e.tenant_id = l.tenant_id AND e.ativo = TRUE
      WHERE l.tenant_id = $1 AND l.ativo = TRUE
      GROUP BY l.id, l.nome, l.expectativa_total
      ORDER BY cadastrados DESC
      LIMIT 15
    `, [tid]);

    // ── 5. Totais gerais ──
    const totaisR = await db.query(`
      SELECT
        COUNT(*)::INT                                                    AS total_eleitores,
        COUNT(*) FILTER (WHERE intencao_voto = 'confirmado')::INT        AS confirmados,
        COUNT(*) FILTER (WHERE intencao_voto = 'provavel')::INT          AS provaveis,
        COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days')::INT AS novos_semana,
        COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '30 days')::INT AS novos_mes,
        COUNT(*) FILTER (WHERE telefone IS NOT NULL)::INT                AS com_telefone,
        COUNT(DISTINCT COALESCE(bairro,''))::INT - 1                    AS total_bairros,
        COUNT(DISTINCT COALESCE(cidade,''))::INT - 1                    AS total_cidades
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
    `, [tid]);

    // ── 6. Ritmo de cadastro (média diária) ──
    const ritmoR = await db.query(`
      SELECT
        ROUND(COUNT(*)::NUMERIC / GREATEST(
          DATE_PART('day', NOW() - MIN(criado_em))::INT, 1
        ), 1)::FLOAT AS media_diaria
      FROM eleitores
      WHERE tenant_id = $1 AND ativo = TRUE
    `, [tid]);

    // ── 7. Meta de votos ──
    const metaR = await db.query(
      `SELECT meta, candidato, cargo FROM meta_votos WHERE tenant_id = $1`,
      [tid]
    );
    const meta = metaR.rows[0] || { meta: 0, candidato: null, cargo: null };

    res.json({
      totais: {
        ...totaisR.rows[0],
        media_diaria: ritmoR.rows[0]?.media_diaria || 0,
      },
      meta,
      crescimento_diario: crescimentoR.rows,
      faixas_etarias: etariaR.rows,
      top_bairros: bairrosR.rows,
      liderancas: liderancasR.rows,
    });
  } catch (err) {
    console.error('[DASHBOARD] GET /stats:', err);
    res.status(500).json({ error: 'Erro ao calcular dashboard.' });
  }
});

module.exports = router;
