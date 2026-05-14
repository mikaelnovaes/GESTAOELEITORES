/**
 * backend/config/migrate.js
 * Cria todas as tabelas + cria usuário MASTER automaticamente.
 *
 * Para BANCOS EXISTENTES, rode também: correcoes/1_MIGRACAO_BANCO.sql
 * Para adicionar o MASTER em banco existente: correcoes/3_MIGRACAO_MASTER.sql
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
-- TABELA: tenants
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id            BIGSERIAL    PRIMARY KEY,
  nome          VARCHAR(200) NOT NULL,
  slug          VARCHAR(50)  NOT NULL UNIQUE,
  descricao     VARCHAR(500) NULL,
  ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_por    BIGINT       NULL,
  criado_em     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO tenants (nome, slug) VALUES ('Tenant Padrão', 'default')
  ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- TABELA: usuarios (com perfil 'master')
-- ============================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id               BIGSERIAL    PRIMARY KEY,
  tenant_id        BIGINT       NULL REFERENCES tenants(id) ON DELETE SET NULL,
  nome             VARCHAR(200) NOT NULL,
  login            VARCHAR(100) NOT NULL UNIQUE,
  senha_hash       VARCHAR(255) NOT NULL,
  tipo             VARCHAR(20)  NOT NULL DEFAULT 'comum'
                     CHECK (tipo IN ('master','admin','comum')),
  ativo            BOOLEAN      NOT NULL DEFAULT TRUE,
  ultimo_login     TIMESTAMPTZ  NULL,
  tentativas_login INT          NOT NULL DEFAULT 0,
  bloqueado_ate    TIMESTAMPTZ  NULL,
  criado_em        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  atualizado_em    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Garantir que a constraint inclua master mesmo em bancos existentes
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_tipo_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_tipo_check
  CHECK (tipo IN ('master','admin','comum'));

-- FK criado_por dos tenants
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_criado_por_fkey;
ALTER TABLE tenants ADD CONSTRAINT tenants_criado_por_fkey
  FOREIGN KEY (criado_por) REFERENCES usuarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_usuarios_login  ON usuarios (login);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo  ON usuarios (ativo);
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios (tenant_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_tipo   ON usuarios (tipo);

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

CREATE OR REPLACE VIEW v_eleitores_numerados AS
SELECT
  ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY criado_em ASC, id ASC) AS numero_cadastro,
  e.*
FROM eleitores e
WHERE ativo = TRUE;

-- ============================================================
-- Demais tabelas (whatsapp_config, templates, log, robôs)
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
INSERT INTO whatsapp_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS whatsapp_templates (
  id        BIGSERIAL    PRIMARY KEY,
  tenant_id BIGINT       NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome      VARCHAR(200) NOT NULL,
  idioma    VARCHAR(10)  NOT NULL DEFAULT 'pt_BR',
  ativo     BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE whatsapp_templates DROP CONSTRAINT IF EXISTS whatsapp_templates_nome_key;
DROP INDEX IF EXISTS uniq_wa_templates_nome_ativos;
CREATE UNIQUE INDEX uniq_wa_templates_nome_ativos
  ON whatsapp_templates (tenant_id, nome) WHERE ativo = TRUE;

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
CREATE INDEX IF NOT EXISTS idx_audit_tenant  ON audit_log (tenant_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS birthday_config (
  tenant_id     BIGINT       PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  mode          VARCHAR(20)  NOT NULL DEFAULT 'template' CHECK (mode IN ('template','text')),
  text_message  TEXT         NULL,
  template_name VARCHAR(200) NULL,
  template_lang VARCHAR(10)  NOT NULL DEFAULT 'pt_BR',
  template_vars TEXT         NULL,
  send_time     VARCHAR(5)   NOT NULL DEFAULT '09:00',
  atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reactivation_config (
  tenant_id     BIGINT       PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  mode          VARCHAR(20)  NOT NULL DEFAULT 'template' CHECK (mode IN ('template','text')),
  text_message  TEXT         NULL,
  template_name VARCHAR(200) NULL,
  template_lang VARCHAR(10)  NOT NULL DEFAULT 'pt_BR',
  template_vars TEXT         NULL,
  period_value  INT          NOT NULL DEFAULT 30,
  period_unit   VARCHAR(10)  NOT NULL DEFAULT 'dias' CHECK (period_unit IN ('dias','meses')),
  freq_unit     VARCHAR(20)  NOT NULL DEFAULT 'semanal' CHECK (freq_unit IN ('diario','semanal','mensal')),
  freq_hour     VARCHAR(5)   NOT NULL DEFAULT '09:00',
  atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

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

-- Garantir uma linha de config para cada tenant existente
INSERT INTO birthday_config (tenant_id)
SELECT id FROM tenants WHERE id NOT IN (SELECT tenant_id FROM birthday_config);

INSERT INTO reactivation_config (tenant_id)
SELECT id FROM tenants WHERE id NOT IN (SELECT tenant_id FROM reactivation_config);
`;

async function runMigration() {
  console.log('🔄 Iniciando migração do banco de dados...');
  const bcrypt = require('bcrypt');

  try {
    // Migração schema dentro de uma transação para atomicidade
    await db.transaction(async (client) => {
      await client.query(MIGRATION);
    });
    console.log('✅ Schema migrado com sucesso.');

    // -------- Criar usuário MASTER se não existir --------
    const masterExists = await db.query(
      "SELECT id FROM usuarios WHERE login = 'master' LIMIT 1"
    );

    if (masterExists.rowCount === 0) {
      const masterPwd = process.env.MASTER_INITIAL_PASSWORD || ('Master_' + Date.now() + '!');
      const masterHash = await bcrypt.hash(masterPwd, 12);
      await db.query(
        `INSERT INTO usuarios (tenant_id, nome, login, senha_hash, tipo, ativo)
         VALUES (NULL, 'Master do Sistema', 'master', $1, 'master', TRUE)`,
        [masterHash]
      );
      console.log('═══════════════════════════════════════════════════');
      console.log('👑 USUÁRIO MASTER CRIADO!');
      console.log(`   Login: master`);
      console.log(`   Senha: ${masterPwd}`);
      console.log('═══════════════════════════════════════════════════');
      console.log('⚠️  GUARDE ESTA SENHA E TROQUE NO PRIMEIRO LOGIN!');
      console.log('⚠️  Defina MASTER_INITIAL_PASSWORD no env para senha fixa.');
    } else {
      console.log('👑 Master já existe.');
    }

    // -------- Admin tradicional (compatibilidade) --------
    const adminExists = await db.query(
      "SELECT id FROM usuarios WHERE login = 'admin' LIMIT 1"
    );
    if (adminExists.rowCount === 0) {
      const adminPwd = process.env.DEFAULT_ADMIN_PASSWORD || ('Admin_' + Date.now() + '!');
      const adminHash = await bcrypt.hash(adminPwd, 12);
      const tenant = await db.query("SELECT id FROM tenants WHERE slug='default'");
      if (!tenant.rowCount) {
        console.warn('⚠️ Tenant default ausente — admin tradicional NÃO criado. Crie um tenant pelo painel master.');
      } else {
        await db.query(
          `INSERT INTO usuarios (tenant_id, nome, login, senha_hash, tipo)
           VALUES ($1, 'Administrador', 'admin', $2, 'admin')`,
          [tenant.rows[0].id, adminHash]
        );
        console.log(`👤 Admin tradicional criado. Senha: ${adminPwd}`);
      }
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
