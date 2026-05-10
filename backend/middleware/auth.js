/**
 * backend/middleware/auth.js
 * JWT + autorização por perfil — Railway/Render
 */

'use strict';

const jwt = require('jsonwebtoken');

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
      id: user.id,
      tipo: user.tipo,
      nome: user.nome,
      tenant_id: user.tenant_id
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES, issuer: 'gestao-eleitores' }
  );
}

/* - - CORREÇÃO DE ACORDO COM CHATGPT PLUS - CLAUDE FAVOR VERIFICAR SE PROCEDE.

function generateToken(user) {
  return jwt.sign(
    { id: user.id, tipo: user.tipo, nome: user.nome },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES, issuer: 'gestao-eleitores' }
  );
}

*/

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido.', code: 'AUTH_MISSING' });
  }

  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET, { issuer: 'gestao-eleitores' });
    next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: expired ? 'Sessão expirada. Faça login novamente.' : 'Token inválido.',
      code:  expired ? 'AUTH_EXPIRED' : 'AUTH_INVALID',
    });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.tipo !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito a administradores.', code: 'AUTH_FORBIDDEN' });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin, generateToken };
