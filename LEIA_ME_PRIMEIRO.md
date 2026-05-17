# 🚀 Gestão de Eleitores — Deploy Completo do Zero

> **Pacote 100% completo.** Substitui TODOS os arquivos do projeto.
> Não precisa aplicar patches em nada. Não precisa rodar SQL manualmente.
> O migrate.js cria todas as tabelas automaticamente.

---

## 📁 O que vem no pacote

```
gestao-eleitores/
├── 📄 LEIA_ME_PRIMEIRO.md      ← Este arquivo
├── 📄 package.json              ← Dependências do Node
├── 📄 .gitignore                ← Para não commitar segredos
├── 📄 .env.example              ← Modelo de variáveis
│
├── backend/                     ← 11 arquivos
│   ├── server.js
│   ├── config/
│   │   ├── database.js
│   │   └── migrate.js
│   ├── middleware/
│   │   ├── auth.js
│   │   └── errorHandler.js
│   └── routes/
│       ├── auth.js              ← Login/logout
│       ├── eleitores.js         ← CRUD eleitores
│       ├── usuarios.js          ← Gerencia usuários do tenant
│       ├── whatsapp.js          ← Templates + envio
│       ├── robots.js            ← Aniversários + reativação
│       └── master.js            ← Painel master
│
└── frontend/                    ← 9 arquivos
    ├── index.html               ← Sistema principal (login + eleitores)
    ├── master.html              ← Painel master (criar tenants/usuários)
    ├── css/
    │   └── styles.css
    └── js/
        ├── security.js          ← Sanitização e validações
        ├── data.js              ← Cache local + helpers
        ├── app.js               ← Lógica principal
        ├── whatsapp.js          ← Módulo WhatsApp
        ├── import.js            ← Importação Excel
        ├── robots.js            ← Robôs de IA
        └── master.js            ← Painel master
```

**Total: 22 arquivos.**

---

# 🎯 Como fazer o deploy do ZERO (recomendado)

> Tempo estimado: **30 minutos**.

## PASSO 1 — Backup do banco atual (se tiver dados que queira preservar)

**Opção A — Você NÃO se importa em perder os dados** (recomendado para um restart limpo):
- Pule este passo.

**Opção B — Você QUER preservar os dados**:
- No Render → seu banco PostgreSQL → aba **Backups** → **"Create Manual Backup"**.
- Aguarde aparecer com data e hora.

---

## PASSO 2 — APAGAR o banco antigo e criar um novo

### Por que apagar?

O esquema mudou bastante: adicionamos `tenants`, `tenant_id` em várias tabelas, perfil `master`, etc. Começar com banco limpo evita 100% dos problemas de migração.

### Como apagar no Render

1. Vá em **Dashboard** → seu banco `gestao_eleitores_db`
2. Role até embaixo na aba **Info**
3. Clique em **"Delete Database"** (botão vermelho)
4. Confirme digitando o nome do banco

### Criar um banco NOVO

1. No Dashboard do Render → **"New +"** → **"PostgreSQL"**
2. **Name**: `gestao_eleitores_db` (mesmo nome ou outro, tanto faz)
3. **Region**: a mesma do seu serviço web
4. **PostgreSQL Version**: 15 ou superior
5. **Plan**: o que você usava (Free ou Starter)
6. Clique em **"Create Database"**
7. Aguarde 1-2 minutos até aparecer "Available"

### Conectar o banco novo ao serviço web

1. Vá no seu serviço web no Render
2. Aba **Environment**
3. Localize a variável `DATABASE_URL`
4. **Se ela estava com "Internal Database URL"** apontando para o banco antigo, edite e coloque a **Internal Database URL do banco NOVO** (você acha em: banco novo → aba Info → "Internal Database URL")
5. Salve

---

## PASSO 3 — Configurar todas as variáveis de ambiente

Ainda no serviço web → **Environment**, configure:

| Variável | Valor | Como obter |
|---|---|---|
| `DATABASE_URL` | Internal Database URL do banco novo | Render → banco → Info |
| `JWT_SECRET` | string hex de 128 caracteres | comando abaixo |
| `JWT_EXPIRES` | `8h` | (já é padrão, opcional) |
| `NODE_ENV` | `production` | literal |
| `ALLOWED_ORIGINS` | `https://gestao-eleitores-n6l8.onrender.com` | sua URL real do Render |
| `MASTER_INITIAL_PASSWORD` | senha forte 12+ chars | você escolhe |
| `DEFAULT_ADMIN_PASSWORD` | senha forte 8+ chars | você escolhe |

### Como gerar o `JWT_SECRET`

No seu terminal local, rode:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Copie a string longa que aparece (~128 caracteres) e cole como valor.

### Senhas sugeridas (TROQUE depois do primeiro login)

```
MASTER_INITIAL_PASSWORD = MasterMikael@2025!Forte
DEFAULT_ADMIN_PASSWORD  = AdminMikael@2025!
```

---

## PASSO 4 — Substituir todo o código no GitHub

### 4.1 No seu computador local, clone o repositório (se ainda não tem):

```bash
git clone https://github.com/mikaelnovaes/GESTAOELEITORES.git
cd GESTAOELEITORES
```

### 4.2 Apague TUDO que está dentro (exceto a pasta `.git`):

```bash
# Linux/Mac
find . -mindepth 1 -not -path './.git*' -delete

# Windows PowerShell
Get-ChildItem -Exclude .git | Remove-Item -Recurse -Force
```

### 4.3 Copie todo o conteúdo do ZIP para dentro da pasta `GESTAOELEITORES/`

Estrutura final dentro do repositório:
```
GESTAOELEITORES/
├── .git/
├── .gitignore
├── .env.example
├── package.json
├── LEIA_ME_PRIMEIRO.md
├── backend/
└── frontend/
```

### 4.4 Commit e push

```bash
git add .
git commit -m "feat: sistema completo v3.1 com painel master e multi-tenancy"
git push origin main
```

> ⚠️ Se o push der erro porque o histórico mudou muito, use:
> `git push origin main --force`
> Esse `--force` é OK porque você está sobrescrevendo seu próprio repositório com a versão final.

---

## PASSO 5 — Acompanhar o deploy

O Render detecta o push e inicia o redeploy automaticamente (3-5 minutos).

Vá em **seu serviço web → aba Logs** e procure por:

```
✅ PostgreSQL conectado — 2025-...
🔄 Iniciando migração do banco de dados...
✅ Schema migrado com sucesso.
═══════════════════════════════════════════════════
👑 USUÁRIO MASTER CRIADO!
   Login: master
   Senha: MasterMikael@2025!Forte
═══════════════════════════════════════════════════
⚠️  GUARDE ESTA SENHA E TROQUE NO PRIMEIRO LOGIN!
👤 Admin tradicional criado. Senha: AdminMikael@2025!
🚀 Servidor na porta 10000 | production
```

> Se aparecer `❌`, **pare e me chame** com a mensagem de erro.

---

## PASSO 6 — Primeiro acesso

### 6.1 Como Master

1. Abra `https://gestao-eleitores-n6l8.onrender.com/` (sua URL)
2. **Importante**: pressione `Ctrl + Shift + R` para limpar cache do navegador
3. Faça login:
   - **Usuário**: `master`
   - **Senha**: a que você definiu em `MASTER_INITIAL_PASSWORD`
4. O sistema redireciona automaticamente para `/master`
5. Você vê o painel escuro com 4 abas: **Painel · Ambientes · Usuários · Auditoria**

### 6.2 Trocar senha do master AGORA

No header → botão **"Trocar senha"** → defina uma senha forte (mín. 12 caracteres).

### 6.3 Criar seu primeiro ambiente

1. Aba **Ambientes** → **+ Novo Ambiente**
2. Nome: `Mikael 2026` (ou o que quiser)
3. Salvar

### 6.4 Criar um usuário para esse ambiente

1. Aba **Usuários** → **+ Novo Usuário**
2. Nome: `Mikael Novaes`
3. Login: `mikael`
4. Senha: alguma forte
5. Tipo: `Admin`
6. Ambiente: selecione `Mikael 2026`
7. Salvar

### 6.5 Testar como admin do tenant

1. No painel master → **Sair**
2. Logue de novo como `mikael` / a senha que você definiu
3. Vai direto pro sistema normal
4. Cadastre um eleitor de teste
5. Faça logout, volte como `master`
6. Use **"Acessar"** no `Mikael 2026` para entrar como master no ambiente
7. **Banner amarelo** aparece no topo
8. Confirme que vê o eleitor que foi criado

---

## ✅ Checklist final

- [ ] Banco antigo apagado
- [ ] Banco novo criado e conectado
- [ ] Variáveis de ambiente configuradas (especialmente `JWT_SECRET`)
- [ ] Código commitado e enviado
- [ ] Deploy concluiu sem ❌ nos logs
- [ ] Master loga e redireciona para `/master`
- [ ] Senha do master trocada
- [ ] Pelo menos 1 ambiente criado
- [ ] Pelo menos 1 usuário admin criado
- [ ] "Acessar como" funciona com banner amarelo

---

# 🆘 Problemas comuns

| Sintoma | Solução |
|---|---|
| **`JWT_SECRET inválido`** no log | Configure a variável no Render → Environment |
| **`relation tenants does not exist`** | Você apagou o banco mas não rodou o boot ainda. Aguarde o deploy. |
| **`Cannot find module './middleware/errorHandler'`** | Algum arquivo não foi copiado. Verifique `backend/middleware/errorHandler.js` |
| **Master loga mas não vai para /master** | Cache do navegador. `Ctrl + Shift + R` |
| **Botões VER/EDITAR/EXCLUIR não funcionam** | Cache do JS antigo. `Ctrl + Shift + R` |
| **Login retorna "sessão expirada" imediatamente** | `JWT_SECRET` muito curto (mín. 32 chars) ou foi alterado depois |
| **Banner amarelo do master não aparece** | Você fez login no master mas não clicou "Acessar" em nenhum ambiente |
| **Erro CORS** | Adicione sua URL completa em `ALLOWED_ORIGINS` |
| **"Tenant alvo não encontrado ou inativo"** | O ambiente que você está acessando foi desativado. Reative no painel master |

---

# 🔐 Segurança — TROQUE TUDO depois de funcionar

1. ✅ **Senha do master** — feito no passo 6.2
2. ✅ **Senha do admin tradicional** — pelo painel de Usuários (logado como admin)
3. ⚠️ **Apague o `admin` tradicional** se não usa — ele foi criado só por compatibilidade
4. 🔄 **Rotacione `JWT_SECRET`** a cada 90 dias
5. 📋 **Configure backups automáticos** no Render → banco → Backups
6. 🔒 **Verifique que `.env` NÃO está commitado** — está no `.gitignore` por padrão

---

# 🎯 Próximos passos sugeridos (futuro)

- 🔐 2FA (autenticação em duas etapas) para o master
- 📧 Convite por email ao criar usuário
- 💼 Limite/plano por tenant (max X eleitores, max Y envios/mês)
- 📊 Dashboard com gráficos de uso por ambiente
- 🔒 Criptografar token Meta WhatsApp em repouso (pgcrypto)
- 📥 Exportar audit log em CSV

---

# 📞 Em caso de erro

1. Copie a mensagem de erro **exata** do log do Render
2. Tira print da tela do navegador (se for erro visual)
3. Me chame e descreva: **"fiz o passo X, deu erro Y"**

---

## 📋 RESUMO DOS BUGS CORRIGIDOS NESTA VERSÃO (v3.1)

Em relação à versão anterior (v3.0):

1. ✅ **CRÍTICO**: Master loga em `/` mas é redirecionado para `/master` sem sessão lá
   → `app.js` agora salva DUAS sessões (normal + master) quando o usuário é master

2. ✅ **CRÍTICO**: localStorage vaza eleitores entre usuários do mesmo navegador
   → `clearSession()` agora limpa TODOS os caches locais

3. ✅ **CRÍTICO**: WhatsApp e Importação não enviavam `X-Acting-Tenant`
   → Monkey patch global do `fetch()` adiciona o header em TODAS as chamadas

4. ✅ **Importante**: "Sair do modo" não limpava cache
   → Agora limpa antes de redirecionar

5. ✅ **Importante**: Criar tenant fora de transação completa
   → Tudo em uma única transação no backend

6. ✅ **Médio**: Nova aba com `?acting=X` não tinha nome do tenant
   → Frontend busca o nome via `/auth/me` se não tiver

7. ✅ **Médio**: Importar grande lote — erro num registro abortava a transação
   → Agora usa SAVEPOINT por registro (rollback individual)

8. ✅ **Médio**: Migrate sem check do tenant default antes de criar admin
   → Adicionado check defensivo

9. ✅ **Baixo**: Logs de robôs no localStorage vazavam entre tenants
   → Resolvido junto com o item 2

E todos os bugs das versões anteriores (v3.0) continuam corrigidos.
