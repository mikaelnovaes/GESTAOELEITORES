/**
 * backend/middleware/errorHandler.js
 * Tratamento centralizado — nunca expõe stack traces em produção
 */

'use strict';

function errorHandler(err, req, res, next) {
  if (err.message?.startsWith('CORS:')) {
    return res.status(403).json({ error: 'Origem não permitida.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Requisição muito grande.' });
  }

  console.error('[ERROR]', {
    message: err.message,
    path: req.path,
    method: req.method,
    user: req.user?.id,
    ip: req.ip,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' && status >= 500
    ? 'Erro interno do servidor.'
    : err.message;

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
