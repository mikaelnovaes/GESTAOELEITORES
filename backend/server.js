/**
 * backend/server.js
 * Servidor Express — Render
 */

'use strict';

require('dotenv').config();

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const rateLimit   = require('express-rate-limit');
const morgan      = require('morgan');
const compression = require('compression');
const path        = require('path');

const db                = require('./config/database');
const { runMigration }  = require('./config/migrate');

// Rotas
const authRoutes      = require('./routes/auth');
const eleitoresRoutes = require('./routes/eleitores');
const whatsappRoutes  = require('./routes/whatsapp');
const usuariosRoutes  = require('./routes/usuarios');
const robotsRoutes    = require('./routes/robots');

const { authMiddleware } = require('./middleware/auth');
const { errorHandler }   = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3001;

// Confiar no proxy do Render (1 hop) — necessário para req.ip correto
app.set('trust proxy', 1);

/* ============================================================
   SEGURANÇA — HEADERS HTTP (Helmet)
   ============================================================ */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      // 'unsafe-inline' em script ainda é necessário pelos onclicks legados do index.html.
      // Quando migrarmos esses para listeners, pode remover.
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'", 'https://graph.facebook.com'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
}));

/* CORS */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (!allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origem não permitida'));
  },
  credentials: true,
}));

/* ============================================================
   RATE LIMITS
   ============================================================ */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde 15 minutos.' },
  skip: (req) => req.path === '/health',
});
app.use(globalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
});

const waLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 1000,
  message: { error: 'Limite de envios WhatsApp atingido.' },
});

const purgeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Operações destrutivas limitadas. Aguarde 1 hora.' },
});

/* ============================================================
   MIDDLEWARES GLOBAIS
   ============================================================ */
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { skip: (req) => req.path === '/health' }));
}

/* ============================================================
   FRONTEND ESTÁTICO
   ============================================================ */
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

/* HEALTH CHECK */
app.get('/health', async (req, res) => {
  try {
    const dbTime = await db.ping();
    res.json({ status: 'ok', db: 'connected', dbTime, env: process.env.NODE_ENV });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

/* ============================================================
   ROTAS DA API
   ============================================================ */
app.use('/api/auth',                authLimiter,  authRoutes);
app.use('/api/eleitores/admin/purge', purgeLimiter); // monta o rate limit ANTES da rota
app.use('/api/eleitores',           authMiddleware, eleitoresRoutes);
app.use('/api/whatsapp',            authMiddleware, waLimiter, whatsappRoutes);
app.use('/api/usuarios',            authMiddleware, usuariosRoutes);
app.use('/api/robots',              authMiddleware, robotsRoutes);

/* SPA FALLBACK */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.use(errorHandler);

/* ============================================================
   START
   ============================================================ */
async function start() {
  try {
    const dbTime = await db.ping();
    console.log(`✅ PostgreSQL conectado — ${dbTime}`);

    await runMigration().catch(err => {
      console.warn('⚠️ Migração com avisos:', err.message);
    });

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor na porta ${PORT} | ${process.env.NODE_ENV || 'development'}`);
    });

    const shutdown = async (signal) => {
      console.log(`${signal} recebido. Encerrando...`);
      server.close(async () => {
        await db.end();
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

  } catch (err) {
    console.error('❌ Falha ao iniciar:', err.message);
    process.exit(1);
  }
}

start();
module.exports = app;
