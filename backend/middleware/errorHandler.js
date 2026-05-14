/**
 * backend/middleware/errorHandler.js
 * Error handler global do Express
 */

'use strict';

function errorHandler(err, req, res, next) {
  // CORS error específico
  if (err && err.message?.startsWith('CORS:')) {
    console.warn('[CORS]', err.message, '| origin:', req.headers.origin);
    return res.status(403).json({ error: 'Origem não permitida.' });
  }

  // Body parser: JSON malformado
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
  }

  // Body parser: payload muito grande
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload excede o limite permitido.' });
  }

  // Erros de validação do express-validator passam pelas rotas, mas garantia:
  if (err.array && typeof err.array === 'function') {
    return res.status(400).json({ errors: err.array() });
  }

  // Log e resposta genérica
  console.error('[ERR]', req.method, req.path, '-', err.message || err);
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Erro interno do servidor.'
      : err.message || 'Erro interno do servidor.',
  });
}

module.exports = { errorHandler };
