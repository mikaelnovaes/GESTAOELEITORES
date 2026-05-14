/**
 * backend/config/migrate.js
 * Cria todas as tabelas no PostgreSQL (Render)
 *
 * Para BANCOS EXISTENTES com dados antigos, rode também:
 *   correcoes/1_MIGRACAO_BANCO.sql
 *
 * Para BANCO NOVO, basta:
 *   npm run db:migrate
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
-- TABELA: tenants (multi-tenancy)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id        BIGSERIAL    PRIMARY KEY,
  nome      VARCHAR(200) NOT NULL,
  slug      VARCHAR(50)  NOT NULL UNIQUE,
  ativo     BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (nome, slug) VALUES ('Tenant Padrão', 'default')
  ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- TABELA: usuarios
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id               BIGSERIAL    PRIMARY KEY,
  tenant_id        BIGINT       NULL REFERENCES tenants(id) ON DELETE SET NULL,
  nome             VARCHAR(200) NOT NULL,
  login            VARCHAR(100) NOT NULL UNIQUE,
  senha_hash       VARCHAR(255) NOT NULL,
  tipo             VARCHAR(20)  NOT NULL DEFAULT 'comum'
                     CHECK (tipo IN ('admin','comum')),
  ativo            BOOLEAN      NOT NULL DEFAULT TRUE,
  ultimo_login     TIMESTAMPTZ  NULL,
  tentativas_login INT          NOT NULL DEFAULT 0,
  bloqueado_ate    TIMESTAMPTZ  NULL,
  criado_em        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_login  ON usuarios (login);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo  ON usuarios (ativo);
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios (tenant_id);

-- ============================================================
-- TABELA: eleitores
-- ============================================================
CREATE TABLE IF NOT EXISTS eleitores (
  id              BIGSERIAL    PRIMARY KEY,
  tenant_id       BIGINT       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome            VARCHAR(200) NOT NULL,
  data_nascimento DATE         NULL,
  telefone        VARCHAR(20)  NULL,
  email           VARCHAR(200) NULL,
  endereco        VARCHAR(300) NULL,
  numero          VARCHAR(20)  NULL,
  bairro          VARCHAR(100) NULL,
  cidade          VARCHAR(100) NULL,
  titulo_eleitor  VARCHAR(20)  NULL,
  secao           VARCHAR(10)  NULL,
  escola_votacao  VARCHAR(200) NULL,
  foto_url        VARCHAR(500) NULL,
  ativo           BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_por      BIGINT       NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eleitores_tenant     ON eleitores (tenant_id);
CREATE INDEX IF NOT EXISTS idx_eleitores_nome       ON eleitores (nome);
CREATE INDEX IF NOT EXISTS idx_eleitores_bairro     ON eleitores (bairro);
CREATE INDEX IF NOT EXISTS idx_eleitores_cidade     ON eleitores (cidade);
CREATE INDEX IF NOT EXISTS idx_eleitores_telefone   ON eleitores (telefone);
CREATE INDEX IF NOT EXISTS idx_eleitores_nascimento ON eleitores (data_nascimento);
CREATE INDEX IF NOT EXISTS idx_eleitores_ativo      ON eleitores (ativo);

-- View para numeração sequencial visual (relatórios)
CREATE OR REPLACE VIEW v_eleitores_numerados AS
SELECT
  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY criado_em ASC, id ASC) AS numero_cadastro,
  e.*
FROM eleitores e
WHERE ativo = TRUE;

-- ============================================================
-- TABELA: whatsapp_config (singleton GLOBAL — token da Meta)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id              INT          PRIMARY KEY DEFAULT 1,
  phone_id        VARCHAR(50)  NULL,
  access_token    TEXT         NULL,
  waba_id         VARCHAR(50)  NULL,
  proxy_url       VARCHAR(500) NULL,
  country_code    VARCHAR(5)   NOT NULL DEFAULT '55',
  atualizado_em   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_por  BIGINT       NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  CHECK (id = 1)
);

INSERT INTO whatsapp_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TABELA: whatsapp_templates (por tenant, UNIQUE só de ativos)
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id        BIGSERIAL    PRIMARY KEY,
  tenant_id BIGINT       NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome      VARCHAR(200) NOT NULL,
  idioma    VARCHAR(10)  NOT NULL DEFAULT 'pt_BR',
  ativo     BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Remove UNIQUE antigo se existir
ALTER TABLE whatsapp_templates DROP CONSTRAINT IF EXISTS whatsapp_templates_nome_key;

-- Índice parcial: nome único apenas entre templates ATIVOS de um mesmo tenant
DROP INDEX IF EXISTS uniq_wa_templates_nome_ativos;
CREATE UNIQUE INDEX uniq_wa_templates_nome_ativos
  ON whatsapp_templates (tenant_id, nome) WHERE ativo = TRUE;

-- ============================================================
-- TABELA: whatsapp_log
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_log (
  id            BIGSERIAL    PRIMARY KEY,
  tenant_id     BIGINT       NULL REFERENCES tenants(id) ON DELETE CASCADE,
  data_envio    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  eleitor_id    BIGINT       NULL REFERENCES eleitores(id) ON DELETE SET NULL,
  eleitor_nome  VARCHAR(200) NOT NULL,
  telefone      VARCHAR(20)  NOT NULL,
  tipo          VARCHAR(20)  NOT NULL CHECK (tipo IN ('template','text','image')),
  conteudo      TEXT         NULL,
  status        VARCHAR(20)  NOT NULL CHECK (status IN ('sent','failed','pending')),
  mensagem_erro VARCHAR(500) NULL,
  lote_id       VARCHAR(50)  NULL,
  message_id    VARCHAR(100) NULL,
  enviado_por   BIGINT       NULL REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_wa_log_tenant     ON whatsapp_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_log_data_envio ON whatsapp_log (data_envio DESC);
CREATE INDEX IF NOT EXISTS idx_wa_log_eleitor_id ON whatsapp_log (eleitor_id);
CREATE INDEX IF NOT EXISTS idx_wa_log_lote_id    ON whatsapp_log (lote_id);

-- ============================================================
-- TABELA: session_log (auditoria de acessos)
-- ============================================================
CREATE TABLE IF NOT EXISTS session_log (
  id         BIGSERIAL    PRIMARY KEY,
  usuario_id BIGINT       NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  login      VARCHAR(100) NOT NULL,
  evento     VARCHAR(50)  NOT NULL,
  ip_address VARCHAR(45)  NULL,
  user_agent VARCHAR(300) NULL,
  criado_em  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_log_usuario ON session_log (usuario_id);
CREATE INDEX IF NOT EXISTS idx_session_log_evento  ON session_log (evento, criado_em DESC);

-- ============================================================
-- TABELA: audit_log (ações sensíveis: purge, exclusão em massa)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL    PRIMARY KEY,
  usuario_id BIGINT       NULL REFERENCES usuarios(id) ON DELETE SET NULL,
  tenant_id  BIGINT       NULL REFERENCES tenants(id)  ON DELETE SET NULL,
  acao       VARCHAR(50)  NOT NULL,
  detalhes   JSONB        NULL,
  ip_address VARCHAR(45)  NULL,
  criado_em  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_log (usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_audit_acao    ON audit_log (acao, criado_em DESC);

-- ============================================================
-- TABELA: birthday_config (POR TENANT)
-- ============================================================
CREATE TABLE IF NOT EXISTS birthday_config (
  tenant_id     BIGINT       PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  mode          VARCHAR(20)  NOT NULL DEFAULT 'template'
                  CHECK (mode IN ('template','text')),
  text_message  TEXT         NULL,
  template_name VARCHAR(200) NULL,
  template_lang VARCHAR(10)  NOT NULL DEFAULT 'pt_BR',
  template_vars TEXT         NULL,
  send_time     VARCHAR(5)   NOT NULL DEFAULT '09:00',
  atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Garantir uma linha por tenant
INSERT INTO birthday_config (tenant_id)
SELECT id FROM tenants WHERE id NOT IN (SELECT tenant_id FROM birthday_config);

-- ============================================================
-- TABELA: reactivation_config (POR TENANT)
-- ============================================================
CREATE TABLE IF NOT EXISTS reactivation_config (
  tenant_id     BIGINT       PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  mode          VARCHAR(20)  NOT NULL DEFAULT 'template'
                  CHECK (mode IN ('template','text')),
  text_message  TEXT         NULL,
  template_name VARCHAR(200) NULL,
  template_lang VARCHAR(10)  NOT NULL DEFAULT 'pt_BR',
  template_vars TEXT         NULL,
  period_value  INT          NOT NULL DEFAULT 30,
  period_unit   VARCHAR(10)  NOT NULL DEFAULT 'dias'
                  CHECK (period_unit IN ('dias','meses')),
  freq_unit     VARCHAR(20)  NOT NULL DEFAULT 'semanal'
                  CHECK (freq_unit IN ('diario','semanal','mensal')),
  freq_hour     VARCHAR(5)   NOT NULL DEFAULT '09:00',
  atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO reactivation_config (tenant_id)
SELECT id FROM tenants WHERE id NOT IN (SELECT tenant_id FROM reactivation_config);

-- ============================================================
-- TABELA: reactivation_log
-- ============================================================
CREATE TABLE IF NOT EXISTS reactivation_log (
  id            BIGSERIAL    PRIMARY KEY,
  tenant_id     BIGINT       NULL REFERENCES tenants(id) ON DELETE CASCADE,
  eleitor_id    BIGINT       NULL REFERENCES eleitores(id) ON DELETE SET NULL,
  eleitor_nome  VARCHAR(200) NOT NULL,
  telefone      VARCHAR(20)  NOT NULL,
  data_envio    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  dias_inativo  INT          NULL,
  status        VARCHAR(20)  NOT NULL,
  conteudo      TEXT         NULL,
  mensagem_erro VARCHAR(500) NULL
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
      const defaultPwd = process.env.DEFAULT_ADMIN_PASSWORD || 'TROQUE_AGORA_' + Date.now();
      const hash = await bcrypt.hash(defaultPwd, 12);
      const tenant = await db.query("SELECT id FROM tenants WHERE slug='default'");
      await db.query(
        `INSERT INTO usuarios (nome, login, senha_hash, tipo, tenant_id)
         VALUES ($1, $2, $3, $4, $5)`,
        ['Administrador', 'admin', hash, 'admin', tenant.rows[0].id]
      );
      console.log('👤 Admin padrão criado.');
      console.log(`   Login: admin`);
      console.log(`   Senha: ${defaultPwd}`);
      console.log('⚠️  Configure DEFAULT_ADMIN_PASSWORD no Render para evitar senha aleatória.');
      console.log('⚠️  TROQUE A SENHA NO PRIMEIRO LOGIN!');
    } else {
      console.log('👤 Admin já existe — nenhum usuário criado.');
    }

  } catch (err) {
    console.error('❌ Falha na migração:', err.message);
    throw err;
  }
}

if (require.main === module) {
  runMigration()
    .then(async () => { await db.end(); process.exit(0); })
    .catch(async () => { await db.end(); process.exit(1); });
}

module.exports = { runMigration, MIGRATION };
