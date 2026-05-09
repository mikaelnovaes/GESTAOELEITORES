/**
 * backend/server.js
 * Servidor Express — Railway / Render
 *
 * Deploy automático via GitHub → Railway/Render detecta o start script
 */

'use strict';

require('dotenv').config();

const express        = require('express');
const helmet         = require('helmet');
const cors           = require('cors');
const rateLimit      = require('express-rate-limit');
const morgan         = require('morgan');
const compression    = require('compression');
const path           = require('path');

const db             = require('./config/database');
const { runMigration } = require('./config/migrate');

// Rotas
const authRoutes      = require('./routes/auth');
const eleitoresRoutes = require('./routes/eleitores');
const whatsappRoutes  = require('./routes/whatsapp');
const usuariosRoutes  = require('./routes/usuarios');

// Middleware
const { authMiddleware } = require('./middleware/auth');
const { errorHandler }   = require('./middleware/errorHandler');

const app  = express();
// Railway/Render definem PORT automaticamente
const PORT = process.env.PORT || 3001;

/* ============================================================
   SEGURANÇA — HEADERS HTTP (Helmet)
   ============================================================ */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", 'https://cdnjs.cloudflare.com', 'https://fonts.googleapis.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'", 'https://graph.facebook.com'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

/* ============================================================
   CORS
   ============================================================ */
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin && process.env.NODE_ENV !== 'production') return cb(null, true);
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origem não permitida'));
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}));

/* ============================================================
   RATE LIMITING
   ============================================================ */
// Railway/Render usam proxies — necessário confiar no X-Forwarded-For
app.set('trust proxy', 1);

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
  skip: (req) => req.path === '/health',
}));

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
  maxAge: '1d',
  etag: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

/* ============================================================
   HEALTH CHECK — Railway/Render monitoram esta rota
   ============================================================ */
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
app.use('/api/auth',      authLimiter,  authRoutes);
app.use('/api/eleitores', authMiddleware, eleitoresRoutes);
app.use('/api/whatsapp',  authMiddleware, waLimiter, whatsappRoutes);
app.use('/api/usuarios',  authMiddleware, usuariosRoutes);

/* ============================================================
   SPA FALLBACK
   ============================================================ */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint não encontrado.' });
  }
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

/* ============================================================
   TRATAMENTO DE ERROS
   ============================================================ */
app.use(errorHandler);

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
async function start() {
  try {
    // Testar conexão com PostgreSQL
    const dbTime = await db.ping();
    console.log(`✅ PostgreSQL conectado — ${dbTime}`);

    // Rodar migração automaticamente (cria tabelas se não existirem)
    // Seguro rodar em todo start: usa CREATE TABLE IF NOT EXISTS
    await runMigration().catch(err => {
      console.warn('⚠️ Migração com avisos (pode ser normal):', err.message);
    });

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Servidor na porta ${PORT} | ${process.env.NODE_ENV || 'development'}`);
    });

    // Graceful shutdown
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
