/**
 * backend/config/migrate.js
 * Cria todas as tabelas no PostgreSQL (Railway / Render)
 *
 * Executar manualmente (uma vez):
 *   npm run db:migrate
 *
 * Ou automaticamente ao iniciar o servidor (ver server.js)
 */

'use strict';

require('dotenv').config();
const db = require('./database');

const MIGRATION = /* sql */ `

-- ============================================================
-- EXTENSÕES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABELA: usuarios
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id            BIGSERIAL     PRIMARY KEY,
  nome          VARCHAR(200)  NOT NULL,
  login         VARCHAR(100)  NOT NULL UNIQUE,
  senha_hash    VARCHAR(255)  NOT NULL,
  tipo          VARCHAR(20)   NOT NULL DEFAULT 'comum'
                  CHECK (tipo IN ('admin', 'comum')),
  ativo         BOOLEAN       NOT NULL DEFAULT TRUE,
  ultimo_login  TIMESTAMPTZ   NULL,
  tentativas_login INT        NOT NULL DEFAULT 0,
  bloqueado_ate TIMESTAMPTZ   NULL,
  criado_em     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_login ON usuarios (login);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo  ON usuarios (ativo);

-- ============================================================
-- TABELA: eleitores
-- ============================================================
CREATE TABLE IF NOT EXISTS eleitores (
  id              BIGSERIAL     PRIMARY KEY,
  nome            VARCHAR(200)  NOT NULL,
  data_nascimento DATE          NULL,
  telefone        VARCHAR(20)   NULL,
  email           VARCHAR(200)  NULL,
  endereco        VARCHAR(300)  NULL,
  numero          VARCHAR(20)   NULL,
  bairro          VARCHAR(100)  NULL,
  cidade          VARCHAR(100)  NULL,
  titulo_eleitor  VARCHAR(20)   NULL,
  secao           VARCHAR(10)   NULL,
  escola_votacao  VARCHAR(200)  NULL,
  foto_url        VARCHAR(500)  NULL,
  ativo           BOOLEAN       NOT NULL DEFAULT TRUE,
  criado_por      BIGINT        NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eleitores_nome       ON eleitores (nome);
CREATE INDEX IF NOT EXISTS idx_eleitores_bairro     ON eleitores (bairro);
CREATE INDEX IF NOT EXISTS idx_eleitores_cidade     ON eleitores (cidade);
CREATE INDEX IF NOT EXISTS idx_eleitores_telefone   ON eleitores (telefone);
CREATE INDEX IF NOT EXISTS idx_eleitores_nascimento ON eleitores (data_nascimento);
CREATE INDEX IF NOT EXISTS idx_eleitores_ativo      ON eleitores (ativo);

-- ============================================================
-- TABELA: whatsapp_config (singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id              INT           PRIMARY KEY DEFAULT 1,
  phone_id        VARCHAR(50)   NULL,
  access_token    TEXT          NULL,
  waba_id         VARCHAR(50)   NULL,
  proxy_url       VARCHAR(500)  NULL,
  country_code    VARCHAR(5)    NOT NULL DEFAULT '55',
  atualizado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  atualizado_por  BIGINT        NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  CHECK (id = 1)
);

INSERT INTO whatsapp_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TABELA: whatsapp_templates
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id          BIGSERIAL     PRIMARY KEY,
  nome        VARCHAR(200)  NOT NULL UNIQUE,
  idioma      VARCHAR(10)   NOT NULL DEFAULT 'pt_BR',
  ativo       BOOLEAN       NOT NULL DEFAULT TRUE,
  criado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABELA: whatsapp_log
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_log (
  id            BIGSERIAL     PRIMARY KEY,
  data_envio    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  eleitor_id    BIGINT        NULL REFERENCES eleitores(id) ON DELETE SET NULL,
  eleitor_nome  VARCHAR(200)  NOT NULL,
  telefone      VARCHAR(20)   NOT NULL,
  tipo          VARCHAR(20)   NOT NULL CHECK (tipo IN ('template','text','image')),
  conteudo      TEXT          NULL,
  status        VARCHAR(20)   NOT NULL CHECK (status IN ('sent','failed','pending')),
  mensagem_erro VARCHAR(500)  NULL,
  lote_id       VARCHAR(50)   NULL,
  message_id    VARCHAR(100)  NULL,
  enviado_por   BIGINT        NULL REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_log_data_envio ON whatsapp_log (data_envio DESC);
CREATE INDEX IF NOT EXISTS idx_wa_log_eleitor_id ON whatsapp_log (eleitor_id);
CREATE INDEX IF NOT EXISTS idx_wa_log_lote_id    ON whatsapp_log (lote_id);

-- ============================================================
-- TABELA: session_log (auditoria de acessos)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_log (
  id          BIGSERIAL     PRIMARY KEY,
  usuario_id  BIGINT        NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  login       VARCHAR(100)  NOT NULL,
  evento      VARCHAR(50)   NOT NULL,
  ip_address  VARCHAR(45)   NULL,
  user_agent  VARCHAR(300)  NULL,
  criado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_log_usuario ON session_log (usuario_id);
CREATE INDEX IF NOT EXISTS idx_session_log_evento  ON session_log (evento, criado_em DESC);

-- ============================================================
-- TABELA: birthday_config (singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS birthday_config (
  id              INT           PRIMARY KEY DEFAULT 1,
  enabled         BOOLEAN       NOT NULL DEFAULT FALSE,
  mode            VARCHAR(20)   NOT NULL DEFAULT 'template',
  text_message    TEXT          NULL,
  template_name   VARCHAR(200)  NULL,
  template_lang   VARCHAR(10)   NOT NULL DEFAULT 'pt_BR',
  template_vars   TEXT          NULL,
  send_time       VARCHAR(5)    NOT NULL DEFAULT '09:00',
  atualizado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

INSERT INTO birthday_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TABELA: reactivation_config (singleton)
-- ============================================================
CREATE TABLE IF NOT EXISTS reactivation_config (
  id              INT           PRIMARY KEY DEFAULT 1,
  enabled         BOOLEAN       NOT NULL DEFAULT FALSE,
  mode            VARCHAR(20)   NOT NULL DEFAULT 'template',
  text_message    TEXT          NULL,
  template_name   VARCHAR(200)  NULL,
  template_lang   VARCHAR(10)   NOT NULL DEFAULT 'pt_BR',
  template_vars   TEXT          NULL,
  period_value    INT           NOT NULL DEFAULT 30,
  period_unit     VARCHAR(10)   NOT NULL DEFAULT 'dias',
  freq_unit       VARCHAR(20)   NOT NULL DEFAULT 'semanal',
  freq_hour       VARCHAR(5)    NOT NULL DEFAULT '09:00',
  atualizado_em   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

INSERT INTO reactivation_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TABELA: reactivation_log
-- ============================================================
CREATE TABLE IF NOT EXISTS reactivation_log (
  id            BIGSERIAL     PRIMARY KEY,
  eleitor_id    BIGINT        NULL REFERENCES eleitores(id) ON DELETE SET NULL,
  eleitor_nome  VARCHAR(200)  NOT NULL,
  telefone      VARCHAR(20)   NOT NULL,
  data_envio    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  dias_inativo  INT           NULL,
  status        VARCHAR(20)   NOT NULL,
  conteudo      TEXT          NULL,
  mensagem_erro VARCHAR(500)  NULL
);

`;

async function runMigration() {
  console.log('🔄 Iniciando migração do banco de dados...');
  try {
    await db.query(MIGRATION);
    console.log('✅ Migração concluída com sucesso!');

    // Criar admin padrão se não existir
    const bcrypt = require('bcrypt');
    const existing = await db.query(
      "SELECT id FROM usuarios WHERE login = 'admin' LIMIT 1"
    );

    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash('Admin@2024!', 12);
      await db.query(
        `INSERT INTO usuarios (nome, login, senha_hash, tipo)
         VALUES ($1, $2, $3, $4)`,
        ['Administrador', 'admin', hash, 'admin']
      );
      console.log('👤 Admin padrão criado. Login: admin | Senha: Admin@2024!');
      console.log('⚠️  TROQUE A SENHA no primeiro acesso!');
    } else {
      console.log('👤 Admin já existe — nenhum usuário criado.');
    }

  } catch (err) {
    console.error('❌ Falha na migração:', err.message);
    throw err;
  }
  // NOTA: NÃO fechar o pool aqui — o servidor continua usando após a migração
}

// Executar diretamente se chamado via CLI: node migrate.js
// Neste caso sim, fecha o pool e encerra o processo
if (require.main === module) {
  runMigration()
    .then(async () => { await db.end(); process.exit(0); })
    .catch(async () => { await db.end(); process.exit(1); });
}

module.exports = { runMigration, MIGRATION };
