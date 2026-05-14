/**
 * backend/routes/master.js
 * Painel do MASTER — gestão de tenants (ambientes) e usuários
 *
 * REGRAS:
 *  - Apenas o usuário tipo='master' acessa estas rotas.
 *  - Master cria, edita, ativa/desativa tenants (ambientes).
 *  - Master cria usuários e vincula a tenants.
 *  - Master NÃO acessa eleitores, WhatsApp, robôs (separação de funções).
 *  - Toda ação é logada em audit_log.
 */

'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const { body, param, validationResult } = require('express-validator');
const db      = require('../config/database');
const { requireMaster } = require('../middleware/auth');

const router = express.Router();

// Todas as rotas exigem master
router.use(requireMaster);

function hasErrors(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return true; }
  return false;
}

async function logMasterAction(req, acao, detalhes) {
  try {
    await db.query(
      `INSERT INTO audit_log (usuario_id, tenant_id, acao, detalhes, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, detalhes?.tenant_id || null, acao, JSON.stringify(detalhes || {}), req.ip || null]
    );
  } catch (e) {
    console.error('[MASTER AUDIT] Falha ao gravar:', e.message);
  }
}

// Normaliza slug (texto-com-hifens-minúsculas)
function slugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .substring(0, 50);
}

/* ============================================================
   GET /api/master/dashboard
   Resumo geral para o painel inicial
   ============================================================ */
router.get('/dashboard', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        (SELECT COUNT(*)::INT FROM tenants WHERE ativo = TRUE)                       AS tenants_ativos,
        (SELECT COUNT(*)::INT FROM tenants)                                          AS tenants_total,
        (SELECT COUNT(*)::INT FROM usuarios WHERE ativo = TRUE AND tipo != 'master') AS usuarios_ativos,
        (SELECT COUNT(*)::INT FROM eleitores WHERE ativo = TRUE)                     AS eleitores_total,
        (SELECT COUNT(*)::INT FROM whatsapp_log WHERE data_envio > NOW() - INTERVAL '30 days') AS envios_30d
    `);
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[MASTER] dashboard:', err);
    res.status(500).json({ error: 'Erro ao carregar painel.' });
  }
});

/* ============================================================
   TENANTS (Ambientes)
   ============================================================ */

// GET /api/master/tenants — lista todos com contagem de usuários e eleitores
router.get('/tenants', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        t.id, t.nome, t.slug, t.descricao, t.ativo, t.criado_em,
        (SELECT COUNT(*)::INT FROM usuarios u WHERE u.tenant_id = t.id AND u.ativo = TRUE) AS usuarios,
        (SELECT COUNT(*)::INT FROM eleitores e WHERE e.tenant_id = t.id AND e.ativo = TRUE) AS eleitores
      FROM tenants t
      ORDER BY t.criado_em DESC
    `);
    res.json(r.rows.map(t => ({ ...t, id: Number(t.id) })));
  } catch (err) {
    console.error('[MASTER] GET tenants:', err);
    res.status(500).json({ error: 'Erro ao listar ambientes.' });
  }
});

// POST /api/master/tenants — criar ambiente
router.post('/tenants',
  [
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('slug').optional({ nullable: true, checkFalsy: true }).matches(/^[a-z0-9-]+$/i).isLength({ max: 50 }),
    body('descricao').optional({ nullable: true }).isLength({ max: 500 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, descricao } = req.body;
    let slug = req.body.slug ? slugify(req.body.slug) : slugify(nome);
    if (!slug) slug = 'tenant-' + Date.now();

    try {
      const r = await db.query(
        `INSERT INTO tenants (nome, slug, descricao, criado_por)
         VALUES ($1, $2, $3, $4) RETURNING id, slug, criado_em`,
        [nome.trim(), slug, descricao || null, req.user.id]
      );
      const t = r.rows[0];

      // Cria automaticamente as configs dos robôs para o tenant novo
      await db.transaction(async (client) => {
        await client.query(
          `INSERT INTO birthday_config (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
          [t.id]
        );
        await client.query(
          `INSERT INTO reactivation_config (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
          [t.id]
        );
      });

      await logMasterAction(req, 'TENANT_CREATE', { tenant_id: Number(t.id), nome, slug });
      res.status(201).json({ id: Number(t.id), slug: t.slug, criado_em: t.criado_em });

    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Slug já em uso. Escolha outro.' });
      console.error('[MASTER] POST tenants:', err);
      res.status(500).json({ error: 'Erro ao criar ambiente.' });
    }
  }
);

// PUT /api/master/tenants/:id — editar ambiente
router.put('/tenants/:id',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('descricao').optional({ nullable: true }).isLength({ max: 500 }),
    body('ativo').isBoolean(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, descricao, ativo } = req.body;
    try {
      const r = await db.query(
        `UPDATE tenants
         SET nome = $1, descricao = $2, ativo = $3, atualizado_em = NOW()
         WHERE id = $4 RETURNING id`,
        [nome.trim(), descricao || null, ativo, req.params.id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Ambiente não encontrado.' });

      await logMasterAction(req, 'TENANT_UPDATE', { tenant_id: req.params.id, ativo });
      res.json({ success: true });
    } catch (err) {
      console.error('[MASTER] PUT tenants:', err);
      res.status(500).json({ error: 'Erro ao atualizar ambiente.' });
    }
  }
);

// DELETE /api/master/tenants/:id — excluir ambiente (com confirmação por senha)
router.delete('/tenants/:id',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('senha').isString().isLength({ min: 1 }),
    body('confirmacao').equals('EXCLUIR-AMBIENTE'),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      // Reautenticação
      const u = await db.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.user.id]);
      const ok = await bcrypt.compare(req.body.senha, u.rows[0].senha_hash);
      if (!ok) {
        await logMasterAction(req, 'TENANT_DELETE_DENIED_BAD_PASSWORD', { tenant_id: req.params.id });
        return res.status(401).json({ error: 'Senha incorreta.' });
      }

      // Conta antes (para auditoria)
      const cR = await db.query(
        `SELECT
          (SELECT COUNT(*)::INT FROM eleitores WHERE tenant_id = $1) AS eleitores,
          (SELECT COUNT(*)::INT FROM usuarios  WHERE tenant_id = $1) AS usuarios`,
        [req.params.id]
      );
      const counts = cR.rows[0];

      const r = await db.query(
        `DELETE FROM tenants WHERE id = $1 RETURNING nome, slug`,
        [req.params.id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Ambiente não encontrado.' });

      await logMasterAction(req, 'TENANT_DELETE', {
        tenant_id: req.params.id,
        nome: r.rows[0].nome,
        slug: r.rows[0].slug,
        eleitores_excluidos: counts.eleitores,
        usuarios_excluidos: counts.usuarios,
      });
      res.json({ success: true, ...counts });

    } catch (err) {
      console.error('[MASTER] DELETE tenants:', err);
      res.status(500).json({ error: 'Erro ao excluir ambiente.' });
    }
  }
);

/* ============================================================
   USUÁRIOS — visão GLOBAL do master
   ============================================================ */

// GET /api/master/usuarios — todos os usuários do sistema (exceto outros masters)
router.get('/usuarios', async (req, res) => {
  try {
    const r = await db.query(`
      SELECT
        u.id, u.nome, u.login, u.tipo, u.ativo, u.ultimo_login, u.criado_em,
        u.tenant_id, t.nome AS tenant_nome, t.slug AS tenant_slug
      FROM usuarios u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tipo != 'master'
      ORDER BY u.criado_em DESC
    `);
    res.json(r.rows.map(u => ({
      ...u,
      id: Number(u.id),
      tenant_id: u.tenant_id ? Number(u.tenant_id) : null,
    })));
  } catch (err) {
    console.error('[MASTER] GET usuarios:', err);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// POST /api/master/usuarios — criar usuário (com opção de criar tenant junto)
router.post('/usuarios',
  [
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('login').trim().notEmpty().isLength({ min: 3, max: 100 }).matches(/^[a-z0-9._-]+$/i),
    body('senha').notEmpty().isLength({ min: 8, max: 200 }),
    body('tipo').isIn(['admin', 'comum']),  // master não cria outro master por esta rota
    body('tenant_id').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    body('novo_tenant_nome').optional({ nullable: true }).isLength({ max: 200 }),
    body('novo_tenant_slug').optional({ nullable: true }).matches(/^[a-z0-9-]*$/i).isLength({ max: 50 }),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, login, senha, tipo, tenant_id, novo_tenant_nome, novo_tenant_slug } = req.body;

    // Precisa de tenant_id existente OU de novo_tenant_nome para criar
    if (!tenant_id && !novo_tenant_nome) {
      return res.status(400).json({ error: 'Informe tenant_id existente ou novo_tenant_nome para criar.' });
    }

    try {
      const hash = await bcrypt.hash(senha, 12);
      let finalTenantId = tenant_id;

      const result = await db.transaction(async (client) => {
        // Cria tenant novo se foi pedido
        if (!finalTenantId) {
          let slug = novo_tenant_slug ? slugify(novo_tenant_slug) : slugify(novo_tenant_nome);
          if (!slug) slug = 'tenant-' + Date.now();
          const tR = await client.query(
            `INSERT INTO tenants (nome, slug, criado_por) VALUES ($1, $2, $3) RETURNING id`,
            [novo_tenant_nome.trim(), slug, req.user.id]
          );
          finalTenantId = Number(tR.rows[0].id);

          // Configs dos robôs para o tenant novo
          await client.query(
            `INSERT INTO birthday_config (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [finalTenantId]
          );
          await client.query(
            `INSERT INTO reactivation_config (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
            [finalTenantId]
          );
        }

        // Cria usuário
        const uR = await client.query(
          `INSERT INTO usuarios (tenant_id, nome, login, senha_hash, tipo)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, criado_em`,
          [finalTenantId, nome.trim(), login.toLowerCase(), hash, tipo]
        );

        return { id: Number(uR.rows[0].id), tenant_id: finalTenantId };
      });

      await logMasterAction(req, 'USER_CREATE', {
        user_id: result.id, tenant_id: result.tenant_id, login, tipo,
      });
      res.status(201).json(result);

    } catch (err) {
      if (err.code === '23505') {
        if (err.constraint?.includes('login')) return res.status(409).json({ error: 'Login já em uso.' });
        if (err.constraint?.includes('slug'))  return res.status(409).json({ error: 'Slug do ambiente já em uso.' });
      }
      console.error('[MASTER] POST usuarios:', err);
      res.status(500).json({ error: 'Erro ao criar usuário.' });
    }
  }
);

// PUT /api/master/usuarios/:id — editar usuário (inclui MUDANÇA DE TENANT)
router.put('/usuarios/:id',
  [
    param('id').isInt({ min: 1 }).toInt(),
    body('nome').trim().notEmpty().isLength({ max: 200 }),
    body('login').trim().notEmpty().isLength({ min: 3, max: 100 }).matches(/^[a-z0-9._-]+$/i),
    body('senha').optional({ nullable: true, checkFalsy: true }).isLength({ min: 8, max: 200 }),
    body('tipo').isIn(['admin', 'comum']),
    body('tenant_id').isInt({ min: 1 }).toInt(),
    body('ativo').isBoolean(),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    const { nome, login, senha, tipo, tenant_id, ativo } = req.body;
    const id = req.params.id;

    try {
      // Não permitir alterar um master via esta rota
      const check = await db.query('SELECT tipo FROM usuarios WHERE id = $1', [id]);
      if (!check.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (check.rows[0].tipo === 'master') {
        return res.status(403).json({ error: 'Não é possível editar outro master por esta rota.' });
      }

      let query, qParams;
      if (senha) {
        const hash = await bcrypt.hash(senha, 12);
        query = `UPDATE usuarios
                 SET nome=$1, login=$2, senha_hash=$3, tipo=$4, tenant_id=$5, ativo=$6, atualizado_em=NOW()
                 WHERE id=$7 RETURNING id`;
        qParams = [nome.trim(), login.toLowerCase(), hash, tipo, tenant_id, ativo, id];
      } else {
        query = `UPDATE usuarios
                 SET nome=$1, login=$2, tipo=$3, tenant_id=$4, ativo=$5, atualizado_em=NOW()
                 WHERE id=$6 RETURNING id`;
        qParams = [nome.trim(), login.toLowerCase(), tipo, tenant_id, ativo, id];
      }

      const r = await db.query(query, qParams);
      if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });

      await logMasterAction(req, 'USER_UPDATE', { user_id: id, tenant_id, tipo, ativo, senha_alterada: !!senha });
      res.json({ success: true });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Login já em uso.' });
      console.error('[MASTER] PUT usuarios:', err);
      res.status(500).json({ error: 'Erro ao atualizar usuário.' });
    }
  }
);

// DELETE /api/master/usuarios/:id — soft delete
router.delete('/usuarios/:id',
  [param('id').isInt({ min: 1 }).toInt()],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const check = await db.query('SELECT tipo FROM usuarios WHERE id = $1', [req.params.id]);
      if (!check.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (check.rows[0].tipo === 'master') {
        return res.status(403).json({ error: 'Não é possível excluir outro master.' });
      }

      const r = await db.query(
        `UPDATE usuarios SET ativo = FALSE, atualizado_em = NOW()
         WHERE id = $1 AND tipo != 'master' RETURNING id`,
        [req.params.id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });

      await logMasterAction(req, 'USER_DELETE', { user_id: req.params.id });
      res.json({ success: true });
    } catch (err) {
      console.error('[MASTER] DELETE usuarios:', err);
      res.status(500).json({ error: 'Erro ao excluir usuário.' });
    }
  }
);

/* ============================================================
   PRÓPRIO MASTER — trocar senha
   ============================================================ */
router.put('/me/senha',
  [
    body('senha_atual').isString().isLength({ min: 1 }),
    body('nova_senha').isLength({ min: 12, max: 200 })
      .withMessage('A nova senha do master deve ter ao menos 12 caracteres.'),
  ],
  async (req, res) => {
    if (hasErrors(req, res)) return;
    try {
      const u = await db.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.user.id]);
      const ok = await bcrypt.compare(req.body.senha_atual, u.rows[0].senha_hash);
      if (!ok) return res.status(401).json({ error: 'Senha atual incorreta.' });

      const hash = await bcrypt.hash(req.body.nova_senha, 12);
      await db.query(
        'UPDATE usuarios SET senha_hash = $1, atualizado_em = NOW() WHERE id = $2',
        [hash, req.user.id]
      );
      await logMasterAction(req, 'MASTER_PASSWORD_CHANGED', {});
      res.json({ success: true });
    } catch (err) {
      console.error('[MASTER] me/senha:', err);
      res.status(500).json({ error: 'Erro ao trocar senha.' });
    }
  }
);

/* ============================================================
   AUDIT LOG — master vê todas as ações dele
   ============================================================ */
router.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const r = await db.query(`
      SELECT a.id, a.acao, a.detalhes, a.ip_address, a.criado_em,
             u.login AS usuario_login, t.nome AS tenant_nome
      FROM audit_log a
      LEFT JOIN usuarios u ON u.id = a.usuario_id
      LEFT JOIN tenants  t ON t.id = a.tenant_id
      ORDER BY a.criado_em DESC
      LIMIT $1
    `, [limit]);
    res.json(r.rows.map(a => ({ ...a, id: Number(a.id) })));
  } catch (err) {
    console.error('[MASTER] audit:', err);
    res.status(500).json({ error: 'Erro ao carregar auditoria.' });
  }
});

module.exports = router;
