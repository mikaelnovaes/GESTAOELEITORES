/**
 * backend/middleware/auth.js
 * JWT + perfis (master / admin / comum) + multi-tenancy
 *
 * MASTER:
 *  - Acessa /api/master/* (rotas exclusivas)
 *  - Acessa qualquer rota normal "personificando" um tenant via header `X-Acting-Tenant: <id>`
 *  - Sem o header, opera no tenant default (fallback)
 */

'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../config/database');

const JWT_SECRET  = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    '[SECURITY] JWT_SECRET inválido ou muito curto.\n' +
    'Gere com: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
  );
}

function generateToken(user) {
  return jwt.sign(
    {
      id:        user.id,
      tipo:      user.tipo,
      nome:      user.nome,
      tenant_id: user.tenant_id || null,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES, issuer: 'gestao-eleitores' }
  );
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido.', code: 'AUTH_MISSING' });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET, { issuer: 'gestao-eleitores' });
    if (req.user.id) req.user.id = Number(req.user.id);
    if (req.user.tenant_id) req.user.tenant_id = Number(req.user.tenant_id);
    req.user.is_master = (req.user.tipo === 'master');

    // ── MASTER ──
    if (req.user.is_master) {
      const actingHeader = req.headers['x-acting-tenant'];

      if (actingHeader) {
        const actingId = Number(actingHeader);
        if (!Number.isInteger(actingId) || actingId < 1) {
          return res.status(400).json({ error: 'Header X-Acting-Tenant inválido.' });
        }
        const t = await db.query(
          'SELECT id, nome FROM tenants WHERE id = $1 AND ativo = TRUE',
          [actingId]
        );
        if (!t.rowCount) {
          return res.status(404).json({ error: 'Tenant alvo não encontrado ou inativo.' });
        }
        req.user.tenant_id          = actingId;
        req.user.acting_as          = actingId;
        req.user.acting_tenant_nome = t.rows[0].nome;
      } else {
        if (!req.user.tenant_id) {
          const d = await db.query("SELECT id FROM tenants WHERE slug = 'default' LIMIT 1");
          req.user.tenant_id = d.rowCount ? Number(d.rows[0].id) : null;
        }
      }
      return next();
    }

    // ── USUÁRIOS NORMAIS ──
    if (!req.user.tenant_id) {
      return res.status(401).json({
        error: 'Sessão antiga. Faça login novamente.',
        code:  'AUTH_NO_TENANT',
      });
    }
    next();

  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Sessão expirada. Faça login novamente.' : 'Token inválido.',
      code:  expired ? 'AUTH_EXPIRED' : 'AUTH_INVALID',
    });
  }
}

function requireMaster(req, res, next) {
  if (req.user?.tipo !== 'master') {
    return res.status(403).json({ error: 'Acesso restrito ao Master.', code: 'AUTH_NOT_MASTER' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.tipo !== 'admin' && req.user?.tipo !== 'master') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.', code: 'AUTH_FORBIDDEN' });
  }
  next();
}

module.exports = {
  authMiddleware,
  requireAdmin,
  requireMaster,
  generateToken,
};
