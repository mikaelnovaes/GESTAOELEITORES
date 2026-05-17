/**
 * backend/routes/auth.js
 * Login / logout / sessão
 * Suporta o perfil master: retorna tipo='master' para o frontend redirecionar
 */

'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

const MAX_TENTATIVAS    = 5;
const TEMPO_BLOQUEIO_MS = 15 * 60 * 1000;

router.post('/login',
  [
    body('login').trim().isLength({ min: 1, max: 100 }),
    body('senha').isString().isLength({ min: 1, max: 200 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Dados inválidos.' });

    const loginInput = String(req.body.login).toLowerCase().trim();
    const senha      = req.body.senha;
    const ip         = req.ip || null;
    const ua         = (req.get('user-agent') || '').substring(0, 300);

    try {
      const r = await db.query(
        `SELECT id, nome, login, senha_hash, tipo, ativo, tenant_id,
                tentativas_login, bloqueado_ate
         FROM usuarios WHERE login = $1 LIMIT 1`,
        [loginInput]
      );

      if (!r.rowCount) {
        await db.query(
          `INSERT INTO session_log (usuario_id, login, evento, ip_address, user_agent)
           VALUES (NULL, $1, 'LOGIN_FAIL_NOT_FOUND', $2, $3)`,
          [loginInput, ip, ua]
        );
        return res.status(401).json({ error: 'Login não encontrado. Verifique o nome de usuário.' });
      }

      const u = r.rows[0];

      if (!u.ativo) {
        return res.status(401).json({ error: 'Usuário desativado. Contate o administrador.' });
      }

      if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) {
        const restMin = Math.ceil((new Date(u.bloqueado_ate) - new Date()) / 60000);
        return res.status(423).json({ error: `Conta bloqueada. Tente novamente em ${restMin} min.` });
      }

      const senhaOk = await bcrypt.compare(senha, u.senha_hash);

      if (!senhaOk) {
        const novasTentativas = u.tentativas_login + 1;
        const bloquear        = novasTentativas >= MAX_TENTATIVAS;
        await db.query(
          `UPDATE usuarios
             SET tentativas_login = $1,
                 bloqueado_ate    = $2,
                 atualizado_em    = NOW()
           WHERE id = $3`,
          [novasTentativas, bloquear ? new Date(Date.now() + TEMPO_BLOQUEIO_MS) : null, u.id]
        );
        await db.query(
          `INSERT INTO session_log (usuario_id, login, evento, ip_address, user_agent)
           VALUES ($1, $2, $3, $4, $5)`,
          [u.id, loginInput, bloquear ? 'LOGIN_BLOCKED' : 'LOGIN_FAIL_BAD_PASS', ip, ua]
        );
        return res.status(401).json({
          error: bloquear
            ? `Senha incorreta. Conta bloqueada por 15 minutos.`
            : `Senha incorreta. ${MAX_TENTATIVAS - novasTentativas} tentativa(s) restante(s).`,
        });
      }

      // Sucesso
      await db.query(
        `UPDATE usuarios
           SET tentativas_login = 0,
               bloqueado_ate    = NULL,
               ultimo_login     = NOW(),
               atualizado_em    = NOW()
         WHERE id = $1`,
        [u.id]
      );
      await db.query(
        `INSERT INTO session_log (usuario_id, login, evento, ip_address, user_agent)
         VALUES ($1, $2, 'LOGIN_SUCCESS', $3, $4)`,
        [u.id, loginInput, ip, ua]
      );

      const token = generateToken({
        id: Number(u.id), nome: u.nome, tipo: u.tipo,
        tenant_id: u.tenant_id ? Number(u.tenant_id) : null,
      });

      res.json({
        token,
        user: {
          id:        Number(u.id),
          nome:      u.nome,
          login:     u.login,
          tipo:      u.tipo,             // 'master' | 'admin' | 'comum'
          tenant_id: u.tenant_id ? Number(u.tenant_id) : null,
        },
      });

    } catch (err) {
      console.error('[AUTH] login:', err);
      res.status(500).json({ error: 'Erro interno.' });
    }
  }
);

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await db.query(
      `INSERT INTO session_log (usuario_id, login, evento, ip_address, user_agent)
       VALUES ($1, $2, 'LOGOUT', $3, $4)`,
      [req.user.id, req.user.nome, req.ip, (req.get('user-agent') || '').substring(0, 300)]
    );
  } catch (e) {}
  res.json({ success: true });
});

// GET /api/auth/me — devolve o usuário atual (útil para revalidar sessão no F5)
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.nome, u.login, u.tipo, u.tenant_id, t.nome AS tenant_nome
       FROM usuarios u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1 AND u.ativo = TRUE`,
      [req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const u = r.rows[0];
    res.json({
      id: Number(u.id),
      nome: u.nome,
      login: u.login,
      tipo: u.tipo,
      tenant_id: u.tenant_id ? Number(u.tenant_id) : null,
      tenant_nome: u.tenant_nome,
      acting_as: req.user.acting_as ? Number(req.user.acting_as) : null,
      acting_tenant_nome: req.user.acting_tenant_nome || null,
    });
  } catch (err) {
    console.error('[AUTH] me:', err);
    res.status(500).json({ error: 'Erro ao buscar usuário.' });
  }
});

module.exports = router;
