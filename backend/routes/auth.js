/**
 * backend/routes/auth.js
 * Login / logout / perfil — PostgreSQL
 */

'use strict';

const express = require('express');
const bcrypt  = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db      = require('../config/database');
const { generateToken, authMiddleware } = require('../middleware/auth');

const router = express.Router();

/* ── POST /api/auth/login ──────────────────────────────── */
router.post('/login',
  [
    body('login').trim().notEmpty().isLength({ max: 100 }),
    body('senha').notEmpty().isLength({ max: 200 }),
  ],
  async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });

    const { login, senha } = req.body;
    const ip = req.ip || req.socket?.remoteAddress || '';

    try {
      const result = await db.query(
        `SELECT id, nome, login, senha_hash, tipo, ativo, tenant_id,
                tentativas_login, bloqueado_ate
         FROM usuarios WHERE login = $1 LIMIT 1`,
        [login.toLowerCase()]
      );
      const user = result.rows[0];

      // Verificar bloqueio
      if (user?.bloqueado_ate && new Date(user.bloqueado_ate) > new Date()) {
        await logSession(null, login, 'LOGIN_BLOCKED', ip, req);
        return res.status(429).json({ error: 'Conta bloqueada. Aguarde 15 minutos.' });
      }

      // Validar senha com timing-safe compare (bcrypt já faz isso internamente)
      const FAKE_HASH = '$2b$12$invalidhashforstoppingtimingattacks1234567890';
      const hashToCheck = user?.senha_hash || FAKE_HASH;
      const valid = await bcrypt.compare(senha, hashToCheck);

      if (!user || !valid || !user.ativo) {
        if (user) {
          const tentativas = (user.tentativas_login || 0) + 1;
          const bloquear   = tentativas >= 5;
          await db.query(
            `UPDATE usuarios SET
               tentativas_login = $1,
               bloqueado_ate    = ${bloquear ? "NOW() + INTERVAL '15 minutes'" : 'NULL'}
             WHERE id = $2`,
            [tentativas, user.id]
          );
        }
        await logSession(user?.id || null, login, 'LOGIN_FAILED', ip, req);
        return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
      }

      // Sucesso
      await db.query(
        `UPDATE usuarios SET
           tentativas_login = 0,
           bloqueado_ate    = NULL,
           ultimo_login     = NOW()
         WHERE id = $1`,
        [user.id]
      );

      await logSession(user.id, login, 'LOGIN_SUCCESS', ip, req);

      return res.json({
        token: generateToken(user),
        user:  { id: user.id, nome: user.nome, tipo: user.tipo, tenant_id: user.tenant_id },
        expiresIn: process.env.JWT_EXPIRES || '8h',
      });

    } catch (err) {
      console.error('[AUTH] login:', err);
      res.status(500).json({ error: 'Erro interno. Tente novamente.' });
    }
  }
);

/* ── POST /api/auth/logout ─────────────────────────────── */
router.post('/logout', authMiddleware, async (req, res) => {
  await logSession(req.user.id, '', 'LOGOUT', req.ip, req).catch(() => {});
  res.json({ message: 'Logout realizado.' });
});

/* ── GET /api/auth/me ──────────────────────────────────── */
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const r = await db.query(
      'SELECT id, nome, login, tipo FROM usuarios WHERE id = $1 AND ativo = TRUE',
      [req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Usuário não encontrado.' });
    res.json(r.rows[0]);
  } catch {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

/* ── HELPER: log de sessão ─────────────────────────────── */
async function logSession(userId, login, evento, ip, req) {
  try {
    await db.query(
      `INSERT INTO session_log (usuario_id, login, evento, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userId || null,
        (login || '').substring(0, 100),
        evento,
        (ip || '').substring(0, 45),
        (req.headers['user-agent'] || '').substring(0, 300),
      ]
    );
  } catch { /* log não deve travar autenticação */ }
}

module.exports = router;
