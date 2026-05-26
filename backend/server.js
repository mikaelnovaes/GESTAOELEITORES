/***
 * backend/server.js
 * Servidor Express — Render — versão MASTER
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
const whatsappRoutes  = require('./routes/whatsapp-route');
const usuariosRoutes  = require('./routes/usuarios');
const robotsRoutes    = require('./routes/robots');
const masterRoutes    = require('./routes/master');
const electionsRoutes = require('./routes/elections-route');
const liderancasRoutes = require('./routes/liderancas-route');
const mapaRoutes       = require('./routes/mapa-route');
const { requireMaster } = require('./middleware/auth');


const { authMiddleware } = require('./middleware/auth');
const { errorHandler }   = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);

/* ============================================================
   SEGURANÇA — HEADERS HTTP
   ============================================================ */
app.use(helmet({
  contentSecurityPolicy: {
   directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com', 'https://unpkg.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc:      ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://unpkg.com'],
      connectSrc:  ["'self'", 'https://graph.facebook.com', 'https://nominatim.openstreetmap.org'],
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

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (!allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origem não permitida'));
  },
  credentials: true,
  exposedHeaders: ['X-Acting-Tenant'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Acting-Tenant'],
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
});

const purgeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { error: 'Operações destrutivas limitadas. Aguarde 1 hora.' },
});

/* ============================================================
   MIDDLEWARES
   ============================================================ */
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '5mb' }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', { skip: (req) => req.path === '/health' }));
}

/* FRONTEND ESTÁTICO */
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

/* HEALTH */
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
// Rate limit APENAS no /login — logout e /me não devem consumir o limite
app.use('/api/auth/login', authLimiter);
app.use('/api/auth', authRoutes);

// MASTER (rotas exclusivas)
app.use('/api/master', authMiddleware, requireMaster, masterRoutes);

// Rotas normais (master também acessa, personificando tenant)
app.use('/api/eleitores/admin/purge', purgeLimiter);
app.use('/api/eleitores', authMiddleware, eleitoresRoutes);
app.use('/api/whatsapp',  authMiddleware, waLimiter, whatsappRoutes);
app.use('/api/usuarios',  authMiddleware, usuariosRoutes);
app.use('/api/robots',    authMiddleware, robotsRoutes);
app.use('/api/elections', authMiddleware, electionsRoutes);
app.use('/api/liderancas', authMiddleware, liderancasRoutes);
app.use('/api/mapa',       authMiddleware, mapaRoutes);

/* SPA FALLBACK */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }
  // /master serve uma página dedicada do painel master
  if (req.path === '/master' || req.path.startsWith('/master/')) {
    return res.sendFile(path.join(__dirname, '..', 'frontend', 'master.html'));
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
