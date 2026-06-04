/**
 * backend/routes/mapa-route.js (v3 — fix bug "column tenant_id does not exist")
 *
 * MUDANÇA vs v2:
 *  - Bug: o WHERE externo da query de /pontos filtrava por tenant_id e bairro/cidade,
 *    mas esses campos não estavam SEMPRE disponíveis na subquery `combined` em todos
 *    os SGBDs (depende de como o planner do PostgreSQL resolve). Resultado: erro 500.
 *  - Fix: aplica TODOS os filtros (tenant_id, bairro, cidade, lideranca_id) DENTRO de
 *    cada SELECT do UNION ALL, eliminando o WHERE externo.
 *
 * Endpoints:
 *  GET    /api/mapa/pontos                    — pontos com coords (heatmap + pins)
 *  GET    /api/mapa/stats                     — totais por status
 *  GET    /api/mapa/falhas                    — detalhes dos que falharam
 *  POST   /api/mapa/geocode/:tipo/:id         — geocodifica 1
 *  POST   /api/mapa/geocode-pendentes         — geocodifica todos (lote)
 */

'use strict';

const express = require('express');
const { param, query, validationResult } = require('express-validator');
const db = require('../config/database');
const geocoder = require('../services/geocoder');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

/* ── GET /api/mapa/pontos ────────────────────────────────── */
router.get('/pontos',
  [
    query('tipo').optional().isIn(['eleitor', 'lideranca', 'ambos']),
    query('bairro').optional().isLength({ max: 100 }),
    query('cidade').optional().isLength({ max: 100 }),
    query('lideranca_id').optional().toInt().isInt({ min: 1 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;

    const tipo   = req.query.tipo   || 'ambos';
    const bairro = req.query.bairro || null;
    const cidade = req.query.cidade || null;
    const lidId  = req.query.lideranca_id || null;

    try {
      // Aplica filtros DENTRO de cada SELECT do UNION ALL
      // (Não usamos mais WHERE externo na subquery `combined`)

      const params = [req.user.tenant_id];
      let pIdx = 2;

      // Filtros adicionais que valem pra ambas tabelas
      const filtrosComuns = [];
      if (bairro) { filtrosComuns.push(`bairro ILIKE $${pIdx}`); params.push(`%${bairro}%`); pIdx++; }
      if (cidade) { filtrosComuns.push(`cidade ILIKE $${pIdx}`); params.push(`%${cidade}%`); pIdx++; }

      // Filtro de lideranca_id é diferente entre as 2 tabelas:
      //  - eleitores: WHERE lideranca_id = $X
      //  - liderancas: WHERE id = $X
      let filtroLidEleitor = '';
      let filtroLidLideranca = '';
      if (lidId) {
        filtroLidEleitor = `AND lideranca_id = $${pIdx}`;
        filtroLidLideranca = `AND id = $${pIdx}`;
        params.push(lidId);
        pIdx++;
      }

      const filtrosComunsSQL = filtrosComuns.length ? ' AND ' + filtrosComuns.join(' AND ') : '';

      // Decide quais tabelas incluir
      const incluirEleitores = (tipo === 'ambos' || tipo === 'eleitor');
      const incluirLiderancas = (tipo === 'ambos' || tipo === 'lideranca');

      const partes = [];

      if (incluirEleitores) {
        partes.push(`
          SELECT id, nome, telefone, latitude, longitude,
                 endereco, numero, bairro, cidade,
                 'eleitor'::text AS tipo,
                 NULL::text AS cargo,
                 lideranca_id
          FROM eleitores
          WHERE tenant_id = $1 AND ativo = TRUE
            AND geocoded_status = 'done' AND latitude IS NOT NULL AND longitude IS NOT NULL
            ${filtrosComunsSQL}
            ${filtroLidEleitor}
        `);
      }

      if (incluirLiderancas) {
        partes.push(`
          SELECT id, nome, telefone, latitude, longitude,
                 endereco, numero, bairro, cidade,
                 'lideranca'::text AS tipo,
                 cargo,
                 NULL::bigint AS lideranca_id
          FROM liderancas
          WHERE tenant_id = $1 AND ativo = TRUE
            AND geocoded_status = 'done' AND latitude IS NOT NULL AND longitude IS NOT NULL
            ${filtrosComunsSQL}
            ${filtroLidLideranca}
        `);
      }

      if (!partes.length) {
        return res.json([]);
      }

      const sql = partes.join('\nUNION ALL\n') + '\nLIMIT 5000';

      const r = await db.query(sql, params);

      res.json(r.rows.map(p => ({
        ...p,
        id: Number(p.id),
        latitude: parseFloat(p.latitude),
        longitude: parseFloat(p.longitude),
        lideranca_id: p.lideranca_id ? Number(p.lideranca_id) : null,
      })));
    } catch (err) {
      console.error('[MAPA] GET /pontos:', err);
      res.status(500).json({ error: 'Erro ao buscar pontos.' });
    }
  }
);

/* ── GET /api/mapa/stats ────────────────────────────────── */
router.get('/stats', async (req, res) => {
  try {
    const tid = req.user.tenant_id;

    const eR = await db.query(`
      SELECT
        COUNT(*)::INT AS total,
        COUNT(*) FILTER (WHERE geocoded_status = 'done')::INT AS geocoded,
        COUNT(*) FILTER (WHERE geocoded_status = 'pending' OR geocoded_status IS NULL)::INT AS pending,
        COUNT(*) FILTER (WHERE geocoded_status = 'failed')::INT AS failed,
        COUNT(*) FILTER (WHERE geocoded_status = 'no_address')::INT AS no_address
      FROM eleitores WHERE tenant_id = $1 AND ativo = TRUE
    `, [tid]);

    const lR = await db.query(`
      SELECT
        COUNT(*)::INT AS total,
        COUNT(*) FILTER (WHERE geocoded_status = 'done')::INT AS geocoded,
        COUNT(*) FILTER (WHERE geocoded_status = 'pending' OR geocoded_status IS NULL)::INT AS pending,
        COUNT(*) FILTER (WHERE geocoded_status = 'failed')::INT AS failed,
        COUNT(*) FILTER (WHERE geocoded_status = 'no_address')::INT AS no_address
      FROM liderancas WHERE tenant_id = $1 AND ativo = TRUE
    `, [tid]);

    res.json({
      eleitores_total:      eR.rows[0].total,
      eleitores_geocoded:   eR.rows[0].geocoded,
      eleitores_pending:    eR.rows[0].pending,
      eleitores_failed:     eR.rows[0].failed,
      eleitores_no_address: eR.rows[0].no_address,
      liderancas_total:      lR.rows[0].total,
      liderancas_geocoded:   lR.rows[0].geocoded,
      liderancas_pending:    lR.rows[0].pending,
      liderancas_failed:     lR.rows[0].failed,
      liderancas_no_address: lR.rows[0].no_address,
    });
  } catch (err) {
    console.error('[MAPA] GET /stats:', err);
    res.status(500).json({ error: 'Erro ao buscar estatísticas.' });
  }
});

/* ── GET /api/mapa/falhas ────────────────────────────────── */
router.get('/falhas',
  [query('limit').optional().toInt().isInt({ min: 1, max: 500 })],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const tid = req.user.tenant_id;
      const limit = req.query.limit || 200;

      const sql = `
        SELECT id, nome, endereco, numero, bairro, cidade,
               geocoded_status, geocoded_attempt,
               'eleitor'::text AS tipo
        FROM eleitores
        WHERE tenant_id = $1 AND ativo = TRUE
          AND geocoded_status IN ('failed', 'no_address')
        UNION ALL
        SELECT id, nome, endereco, numero, bairro, cidade,
               geocoded_status, geocoded_attempt,
               'lideranca'::text AS tipo
        FROM liderancas
        WHERE tenant_id = $1 AND ativo = TRUE
          AND geocoded_status IN ('failed', 'no_address')
        ORDER BY geocoded_status ASC, id DESC
        LIMIT $2
      `;
      const r = await db.query(sql, [tid, limit]);

      const rows = r.rows.map(row => {
        let motivo = 'not_found';
        let motivo_label = 'Endereço não encontrado no mapa';
        let sugestao = 'Verifique se o endereço está correto (sem erros de digitação).';

        if (!row.endereco && !row.bairro) {
          motivo = 'no_address';
          motivo_label = 'Sem rua/avenida cadastrada';
          sugestao = 'Adicione o endereço completo do eleitor.';
        } else if (!row.cidade) {
          motivo = 'no_city';
          motivo_label = 'Cidade não preenchida';
          sugestao = 'Adicione a cidade no cadastro do eleitor.';
        } else if (row.geocoded_status === 'failed') {
          motivo = 'not_found';
          motivo_label = 'Endereço não localizado pelo OpenStreetMap';
          sugestao = 'Verifique se há erro de digitação (ex: "Avenida Rduardo" em vez de "Eduardo").';
        }

        return {
          id: Number(row.id),
          tipo: row.tipo,
          nome: row.nome,
          endereco_completo: [
            [row.endereco, row.numero].filter(Boolean).join(', '),
            row.bairro,
            row.cidade
          ].filter(Boolean).join(' — '),
          motivo,
          motivo_label,
          sugestao,
          tentativas: row.geocoded_attempt || 0,
        };
      });

      const resumo = {};
      rows.forEach(r => {
        resumo[r.motivo] = (resumo[r.motivo] || 0) + 1;
      });

      res.json({ resumo, total: rows.length, registros: rows });
    } catch (err) {
      console.error('[MAPA] GET /falhas:', err);
      res.status(500).json({ error: 'Erro ao buscar falhas.' });
    }
  }
);

/* ── POST /api/mapa/geocode/:tipo/:id ─────────────────────── */
router.post('/geocode/:tipo/:id',
  requireAdmin,
  [
    param('tipo').isIn(['eleitor', 'lideranca']),
    param('id').toInt().isInt({ min: 1 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const tabela = req.params.tipo === 'eleitor' ? 'eleitores' : 'liderancas';
      const r = await geocoder.geocodeAndUpdate(db, tabela, req.params.id, req.user.tenant_id);
      res.json(r);
    } catch (err) {
      console.error('[MAPA] POST /geocode/:tipo/:id:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

/* ── POST /api/mapa/geocode-pendentes ────────────────────── */
router.post('/geocode-pendentes',
  requireAdmin,
  async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const eR = await db.query(
        `SELECT id FROM eleitores
         WHERE tenant_id = $1 AND ativo = TRUE
           AND geocoded_status IN ('pending', 'failed')
           AND (geocoded_attempt IS NULL OR geocoded_attempt < 3)
         LIMIT 500`,
        [tid]
      );
      const lR = await db.query(
        `SELECT id FROM liderancas
         WHERE tenant_id = $1 AND ativo = TRUE
           AND geocoded_status IN ('pending', 'failed')
           AND (geocoded_attempt IS NULL OR geocoded_attempt < 3)
         LIMIT 500`,
        [tid]
      );

      const eleitorIds = eR.rows.map(r => Number(r.id));
      const liderancaIds = lR.rows.map(r => Number(r.id));
      const total = eleitorIds.length + liderancaIds.length;

      (async () => {
        let okE = 0, falhaE = 0;
        for (const id of eleitorIds) {
          try {
            const r = await geocoder.geocodeAndUpdate(db, 'eleitores', id, tid);
            if (r.ok) okE++; else falhaE++;
          } catch (e) {
            falhaE++;
            console.warn('[MAPA] bg eleitor', id, e.message);
          }
        }
        let okL = 0, falhaL = 0;
        for (const id of liderancaIds) {
          try {
            const r = await geocoder.geocodeAndUpdate(db, 'liderancas', id, tid);
            if (r.ok) okL++; else falhaL++;
          } catch (e) {
            falhaL++;
            console.warn('[MAPA] bg lideranca', id, e.message);
          }
        }
        console.log(`[MAPA] Geocode em lote tenant ${tid}: ${okE+okL} sucessos, ${falhaE+falhaL} falhas (de ${total})`);
      })();

      res.json({
        scheduled: total,
        eleitores: eleitorIds.length,
        liderancas: liderancaIds.length,
        estimated_seconds: total * 1.2,
        message: total > 0
          ? `${total} registro(s) sendo processado(s). Tempo estimado: ${Math.ceil(total * 1.2 / 60)} min. Recarregue o mapa em alguns minutos.`
          : 'Nenhum registro pendente. Use o botão Falhas para ver porque alguns não foram geocodificados.',
      });
    } catch (err) {
      console.error('[MAPA] geocode-pendentes:', err);
      res.status(500).json({ error: 'Erro ao iniciar geocodificação em lote.' });
    }
  }
);

module.exports = router;
