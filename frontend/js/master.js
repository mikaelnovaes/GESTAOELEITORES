/**
 * frontend/js/master.js
 * Lógica do Painel Master
 */

'use strict';

/* ============================================================
   API CLIENT
   ============================================================ */
const API = {
  _token() { return sessionStorage.getItem('ge_master_token'); },

  async fetch(path, options = {}) {
    const token = this._token();
    const res = await fetch('/api' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      clearSession();
      showLogin();
      throw new Error('Sessão expirada.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  get:    (p)    => API.fetch(p),
  post:   (p, b) => API.fetch(p, { method: 'POST',   body: JSON.stringify(b || {}) }),
  put:    (p, b) => API.fetch(p, { method: 'PUT',    body: JSON.stringify(b || {}) }),
  delete: (p, b) => API.fetch(p, {
    method: 'DELETE',
    body: b ? JSON.stringify(b) : undefined,
  }),
};

/* ============================================================
   ESTADO
   ============================================================ */
let currentUser = null;
let tenantsCache = [];

/* ============================================================
   SESSÃO
   ============================================================ */
function saveSession(token, user) {
  sessionStorage.setItem('ge_master_token', token);
  sessionStorage.setItem('ge_master_user', JSON.stringify(user));
  // Compartilha o mesmo token com o sistema normal (para "Acessar como")
  sessionStorage.setItem('ge_jwt_token', token);
  sessionStorage.setItem('ge_user', JSON.stringify(user));
}

function loadSession() {
  const t = sessionStorage.getItem('ge_master_token');
  const u = sessionStorage.getItem('ge_master_user');
  if (!t || !u) return null;
  try { return JSON.parse(u); } catch { return null; }
}

function clearSession() {
  sessionStorage.removeItem('ge_master_token');
  sessionStorage.removeItem('ge_master_user');
  sessionStorage.removeItem('ge_jwt_token');
  sessionStorage.removeItem('ge_user');
  sessionStorage.removeItem('ge_acting_tenant');
  currentUser = null;
}

/* ============================================================
   UI HELPERS
   ============================================================ */
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  setTimeout(() => document.getElementById('login-user')?.focus(), 100);
}

function showApp(user) {
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-name').textContent = user.nome || user.login;
  switchTab('dashboard');
}

function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${type}`;
  setTimeout(() => el.className = '', 3500);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit',
  });
}

/* ============================================================
   LOGIN
   ============================================================ */
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = document.getElementById('login-user').value.trim();
  const senha = document.getElementById('login-pass').value;
  const errEl = document.getElementById('login-error');
  const btn   = e.submitter || document.querySelector('#login-form button[type="submit"]');

  errEl.style.display = 'none';
  btn.disabled = true;

  try {
    const data = await API.post('/auth/login', { login, senha });
    if (data.user.tipo !== 'master') {
      errEl.textContent = 'Acesso negado. Esta tela é exclusiva do Master.';
      errEl.style.display = 'block';
      btn.disabled = false;
      return;
    }
    saveSession(data.token, data.user);
    document.getElementById('login-form').reset();
    showApp(data.user);
  } catch (err) {
    errEl.textContent = err.message || 'Usuário ou senha incorretos.';
    errEl.style.display = 'block';
    document.getElementById('login-pass').value = '';
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btn-logout')?.addEventListener('click', () => {
  if (!confirm('Deseja sair?')) return;
  API.post('/auth/logout', {}).catch(() => {});
  clearSession();
  showLogin();
});

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${tabName}`));

  const handlers = {
    dashboard: loadDashboard,
    tenants:   loadTenants,
    users:     loadUsers,
    audit:     loadAudit,
    acting:    loadActing,
  };
  if (handlers[tabName]) handlers[tabName]();
}
window.switchTab = switchTab;

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* ============================================================
   DASHBOARD
   ============================================================ */
async function loadDashboard() {
  const grid = document.getElementById('stats-grid');
  grid.innerHTML = '<div class="empty"><p>Carregando…</p></div>';
  try {
    const stats = await API.get('/master/dashboard');
    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Ambientes Ativos</div>
        <div class="stat-value">${stats.tenants_ativos}</div>
        <div class="stat-sub">de ${stats.tenants_total} cadastrados</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Usuários</div>
        <div class="stat-value">${stats.usuarios_ativos}</div>
        <div class="stat-sub">ativos no sistema</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Eleitores</div>
        <div class="stat-value">${stats.eleitores_total.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">soma de todos os ambientes</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Envios WhatsApp</div>
        <div class="stat-value">${stats.envios_30d.toLocaleString('pt-BR')}</div>
        <div class="stat-sub">últimos 30 dias</div>
      </div>
    `;
  } catch (err) {
    grid.innerHTML = `<div class="empty"><h3>Erro</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}
document.getElementById('btn-refresh-dashboard')?.addEventListener('click', loadDashboard);

/* ============================================================
   TENANTS
   ============================================================ */
async function loadTenants() {
  const c = document.getElementById('tenants-container');
  c.innerHTML = '<div class="empty"><p>Carregando…</p></div>';
  try {
    const tenants = await API.get('/master/tenants');
    tenantsCache = tenants;

    if (!tenants.length) {
      c.innerHTML = `<div class="empty"><h3>Nenhum ambiente</h3><p>Crie o primeiro ambiente para começar.</p></div>`;
      return;
    }

    c.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nome</th><th>Slug</th><th>Usuários</th><th>Eleitores</th>
            <th>Status</th><th>Criado</th><th style="text-align:right">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${tenants.map(t => `
            <tr>
              <td>
                <div class="tenant-name">${escapeHtml(t.nome)}</div>
                ${t.descricao ? `<div style="font-size:0.78rem;color:var(--text-3);margin-top:2px;">${escapeHtml(t.descricao)}</div>` : ''}
              </td>
              <td><span class="tenant-slug">${escapeHtml(t.slug)}</span></td>
              <td>${t.usuarios}</td>
              <td>${Number(t.eleitores).toLocaleString('pt-BR')}</td>
              <td>${t.ativo ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-danger">Inativo</span>'}</td>
              <td style="color:var(--text-3);font-size:0.82rem;">${formatDateTime(t.criado_em)}</td>
              <td>
                <div class="action-buttons">
                  <button class="icon-btn success" data-act="enter" data-id="${t.id}" data-nome="${escapeHtml(t.nome)}">Acessar</button>
                  <button class="icon-btn" data-act="edit" data-id="${t.id}">Editar</button>
                  <button class="icon-btn danger" data-act="delete" data-id="${t.id}" data-nome="${escapeHtml(t.nome)}">Excluir</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    c.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => handleTenantAction(btn));
    });
  } catch (err) {
    c.innerHTML = `<div class="empty"><h3>Erro</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function handleTenantAction(btn) {
  const id = Number(btn.dataset.id);
  const act = btn.dataset.act;
  const t = tenantsCache.find(x => Number(x.id) === id);

  if (act === 'enter') {
    enterTenant(id, btn.dataset.nome);
  }
  if (act === 'edit') {
    openTenantModal(t);
  }
  if (act === 'delete') {
    deleteTenant(id, btn.dataset.nome);
  }
}

function openTenantModal(tenant) {
  document.getElementById('tenant-id').value         = tenant?.id || '';
  document.getElementById('tenant-nome').value       = tenant?.nome || '';
  document.getElementById('tenant-slug').value       = tenant?.slug || '';
  document.getElementById('tenant-descricao').value  = tenant?.descricao || '';
  document.getElementById('tenant-modal-title').textContent = tenant ? 'Editar Ambiente' : 'Novo Ambiente';
  document.getElementById('tenant-slug').readOnly = !!tenant;

  // Mostra o toggle "ativo" apenas na edição
  const ativoField = document.getElementById('tenant-ativo-field');
  ativoField.style.display = tenant ? 'block' : 'none';
  if (tenant) document.getElementById('tenant-ativo').checked = !!tenant.ativo;

  document.getElementById('tenant-modal').classList.add('show');
  setTimeout(() => document.getElementById('tenant-nome').focus(), 100);
}

document.getElementById('btn-new-tenant')?.addEventListener('click', () => openTenantModal(null));

document.getElementById('tenant-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('tenant-id').value;
  const body = {
    nome:      document.getElementById('tenant-nome').value.trim(),
    descricao: document.getElementById('tenant-descricao').value.trim() || null,
  };
  if (!id) {
    body.slug = document.getElementById('tenant-slug').value.trim() || null;
  } else {
    body.ativo = document.getElementById('tenant-ativo').checked;
  }

  try {
    if (id) {
      await API.put(`/master/tenants/${id}`, body);
      showToast('Ambiente atualizado!', 'success');
    } else {
      await API.post('/master/tenants', body);
      showToast('Ambiente criado com sucesso!', 'success');
    }
    document.getElementById('tenant-modal').classList.remove('show');
    loadTenants();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar.', 'error');
  }
});

async function deleteTenant(id, nome) {
  if (!confirm(`⚠️ ATENÇÃO\n\nExcluir o ambiente "${nome}" vai APAGAR PERMANENTEMENTE todos os eleitores, usuários, templates e logs deste ambiente.\n\nEsta ação é IRREVERSÍVEL. Continuar?`)) return;

  const conf = prompt('Para confirmar, digite exatamente: EXCLUIR-AMBIENTE');
  if (conf !== 'EXCLUIR-AMBIENTE') {
    showToast('Confirmação inválida.', 'error');
    return;
  }

  const senha = prompt('Digite sua senha de Master:');
  if (!senha) return;

  try {
    const r = await API.delete(`/master/tenants/${id}`, { senha, confirmacao: 'EXCLUIR-AMBIENTE' });
    showToast(`✓ Ambiente excluído. ${r.eleitores} eleitor(es) e ${r.usuarios} usuário(s) removidos.`, 'success');
    loadTenants();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir.', 'error');
  }
}

function enterTenant(tenantId, nomeAmbiente) {
  if (!confirm(`Entrar no ambiente "${nomeAmbiente}" como Master?\n\nVocê verá os dados deste ambiente no sistema principal.`)) return;
  sessionStorage.setItem('ge_acting_tenant', String(tenantId));
  sessionStorage.setItem('ge_acting_tenant_nome', nomeAmbiente);
  // O token de master já está em ge_jwt_token (copiado no saveSession)
  window.location.href = '/?acting=' + tenantId;
}

/* ============================================================
   USERS
   ============================================================ */
async function loadUsers() {
  const c = document.getElementById('users-container');
  c.innerHTML = '<div class="empty"><p>Carregando…</p></div>';
  try {
    const [users, tenants] = await Promise.all([
      API.get('/master/usuarios'),
      API.get('/master/tenants'),
    ]);
    tenantsCache = tenants;

    if (!users.length) {
      c.innerHTML = `<div class="empty"><h3>Nenhum usuário</h3><p>Crie o primeiro usuário do sistema.</p></div>`;
      return;
    }

    c.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nome</th><th>Login</th><th>Tipo</th><th>Ambiente</th>
            <th>Status</th><th>Último login</th><th style="text-align:right">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td><strong>${escapeHtml(u.nome)}</strong></td>
              <td><code style="font-family:'JetBrains Mono',monospace;color:var(--text-2);">${escapeHtml(u.login)}</code></td>
              <td>${u.tipo === 'admin' ? '<span class="badge badge-admin">Admin</span>' : '<span class="badge badge-comum">Comum</span>'}</td>
              <td>${u.tenant_nome ? `<div>${escapeHtml(u.tenant_nome)}</div><div style="font-size:0.74rem;"><span class="tenant-slug">${escapeHtml(u.tenant_slug)}</span></div>` : '<span style="color:var(--text-3);">—</span>'}</td>
              <td>${u.ativo ? '<span class="badge badge-success">Ativo</span>' : '<span class="badge badge-danger">Inativo</span>'}</td>
              <td style="color:var(--text-3);font-size:0.82rem;">${u.ultimo_login ? formatDateTime(u.ultimo_login) : 'Nunca'}</td>
              <td>
                <div class="action-buttons">
                  <button class="icon-btn" data-uact="edit" data-uid="${u.id}">Editar</button>
                  <button class="icon-btn danger" data-uact="delete" data-uid="${u.id}">Excluir</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    c.querySelectorAll('[data-uact]').forEach(btn => {
      btn.addEventListener('click', () => handleUserAction(btn, users));
    });
  } catch (err) {
    c.innerHTML = `<div class="empty"><h3>Erro</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function handleUserAction(btn, users) {
  const uid = Number(btn.dataset.uid);
  const act = btn.dataset.uact;
  if (act === 'edit') {
    const u = users.find(x => Number(x.id) === uid);
    if (u) openUserModal(u);
  }
  if (act === 'delete') {
    if (!confirm('Desativar este usuário?\n\nEle não poderá mais fazer login, mas seus dados são preservados.')) return;
    API.delete(`/master/usuarios/${uid}`)
      .then(() => { showToast('Usuário desativado.', 'success'); loadUsers(); })
      .catch(err => showToast(err.message, 'error'));
  }
}

function openUserModal(user) {
  document.getElementById('user-id').value      = user?.id    || '';
  document.getElementById('user-nome').value    = user?.nome  || '';
  document.getElementById('user-login').value   = user?.login || '';
  document.getElementById('user-senha').value   = '';
  document.getElementById('user-tipo').value    = user?.tipo  || 'admin';
  document.getElementById('user-modal-title').textContent = user ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('user-senha-hint').textContent  = user ? '(deixe em branco para manter atual)' : '(mín. 8 caracteres)';
  document.getElementById('user-senha').required = !user;

  // Popula select de tenants
  const sel = document.getElementById('user-tenant');
  sel.innerHTML = '<option value="__new__">+ Criar novo ambiente…</option>' +
    tenantsCache
      .filter(t => t.ativo)
      .map(t => `<option value="${t.id}" ${user && Number(user.tenant_id) === Number(t.id) ? 'selected' : ''}>${escapeHtml(t.nome)} (${escapeHtml(t.slug)})</option>`)
      .join('');

  // Toggle "ativo" só na edição
  const ativoField = document.getElementById('user-ativo-field');
  ativoField.style.display = user ? 'block' : 'none';
  if (user) document.getElementById('user-ativo').checked = !!user.ativo;

  // Esconde fields de novo tenant inicialmente
  document.getElementById('user-new-tenant-fields').style.display = 'none';

  document.getElementById('user-modal').classList.add('show');
  setTimeout(() => document.getElementById('user-nome').focus(), 100);
}

document.getElementById('btn-new-user')?.addEventListener('click', () => openUserModal(null));

// Toggle para criar tenant junto
document.getElementById('user-tenant')?.addEventListener('change', (e) => {
  const isNew = e.target.value === '__new__';
  document.getElementById('user-new-tenant-fields').style.display = isNew ? 'block' : 'none';
  document.getElementById('user-new-tenant-nome').required = isNew;
});

document.getElementById('user-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('user-id').value;
  const senha = document.getElementById('user-senha').value;
  const tenantVal = document.getElementById('user-tenant').value;

  const body = {
    nome:  document.getElementById('user-nome').value.trim(),
    login: document.getElementById('user-login').value.trim().toLowerCase(),
    tipo:  document.getElementById('user-tipo').value,
  };

  if (senha) body.senha = senha;

  // Tenant: existente ou criar novo junto
  if (tenantVal === '__new__') {
    const novoNome = document.getElementById('user-new-tenant-nome').value.trim();
    if (!novoNome) { showToast('Informe o nome do novo ambiente.', 'error'); return; }
    body.novo_tenant_nome = novoNome;
    body.novo_tenant_slug = document.getElementById('user-new-tenant-slug').value.trim() || null;
  } else {
    body.tenant_id = Number(tenantVal);
  }

  if (id) {
    body.ativo = document.getElementById('user-ativo').checked;
    // PUT exige tenant_id explícito
    if (!body.tenant_id) {
      showToast('Selecione um ambiente existente ao editar usuário.', 'error');
      return;
    }
  } else {
    if (!senha) { showToast('Senha obrigatória para novo usuário.', 'error'); return; }
  }

  try {
    if (id) {
      await API.put(`/master/usuarios/${id}`, body);
      showToast('Usuário atualizado!', 'success');
    } else {
      await API.post('/master/usuarios', body);
      showToast('Usuário criado!', 'success');
    }
    document.getElementById('user-modal').classList.remove('show');
    loadUsers();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar.', 'error');
  }
});

/* ============================================================
   AUDIT
   ============================================================ */
async function loadAudit() {
  const c = document.getElementById('audit-container');
  c.innerHTML = '<div class="empty"><p>Carregando…</p></div>';
  try {
    const logs = await API.get('/master/audit?limit=100');
    if (!logs.length) {
      c.innerHTML = '<div class="empty"><h3>Sem registros</h3><p>Ainda não há ações administrativas registradas.</p></div>';
      return;
    }
    c.innerHTML = logs.map(l => `
      <div class="audit-item">
        <div style="flex:1;">
          <div style="margin-bottom:4px;">
            <span class="audit-action">${escapeHtml(l.acao)}</span>
            ${l.usuario_login ? `<span style="margin-left:0.5rem;color:var(--text-2);font-size:0.82rem;">por ${escapeHtml(l.usuario_login)}</span>` : ''}
            ${l.tenant_nome ? `<span style="margin-left:0.5rem;color:var(--text-3);font-size:0.78rem;">→ ${escapeHtml(l.tenant_nome)}</span>` : ''}
          </div>
          ${l.detalhes && Object.keys(l.detalhes).length ? `<div style="font-size:0.78rem;color:var(--text-3);font-family:'JetBrains Mono',monospace;">${escapeHtml(JSON.stringify(l.detalhes))}</div>` : ''}
        </div>
        <div class="audit-time">${formatDateTime(l.criado_em)}</div>
      </div>
    `).join('');
  } catch (err) {
    c.innerHTML = `<div class="empty"><h3>Erro</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}
document.getElementById('btn-refresh-audit')?.addEventListener('click', loadAudit);

/* ============================================================
   ACTING (entrar no sistema como um ambiente)
   ============================================================ */
async function loadActing() {
  const c = document.getElementById('acting-container');
  c.innerHTML = '<div class="empty"><p>Carregando…</p></div>';
  try {
    const tenants = (await API.get('/master/tenants')).filter(t => t.ativo);
    if (!tenants.length) {
      c.innerHTML = '<div class="empty"><h3>Nenhum ambiente ativo</h3></div>';
      return;
    }
    c.innerHTML = `
      <table>
        <thead><tr><th>Ambiente</th><th>Slug</th><th>Eleitores</th><th>Usuários</th><th style="text-align:right">Ação</th></tr></thead>
        <tbody>
          ${tenants.map(t => `
            <tr>
              <td><strong>${escapeHtml(t.nome)}</strong>${t.descricao ? `<div style="font-size:0.78rem;color:var(--text-3);">${escapeHtml(t.descricao)}</div>` : ''}</td>
              <td><span class="tenant-slug">${escapeHtml(t.slug)}</span></td>
              <td>${Number(t.eleitores).toLocaleString('pt-BR')}</td>
              <td>${t.usuarios}</td>
              <td><button class="btn btn-master" data-enter="${t.id}" data-nome="${escapeHtml(t.nome)}">Entrar como Master</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    c.querySelectorAll('[data-enter]').forEach(btn => {
      btn.addEventListener('click', () => enterTenant(Number(btn.dataset.enter), btn.dataset.nome));
    });
  } catch (err) {
    c.innerHTML = `<div class="empty"><h3>Erro</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

/* ============================================================
   TROCAR SENHA DO MASTER
   ============================================================ */
document.getElementById('btn-change-password')?.addEventListener('click', () => {
  document.getElementById('password-form').reset();
  document.getElementById('password-modal').classList.add('show');
  setTimeout(() => document.getElementById('pwd-current').focus(), 100);
});

document.getElementById('password-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cur  = document.getElementById('pwd-current').value;
  const nova = document.getElementById('pwd-new').value;
  const conf = document.getElementById('pwd-confirm').value;

  if (nova !== conf) { showToast('As senhas não conferem.', 'error'); return; }
  if (nova.length < 12) { showToast('Mínimo 12 caracteres.', 'error'); return; }

  try {
    await API.put('/master/me/senha', { senha_atual: cur, nova_senha: nova });
    document.getElementById('password-modal').classList.remove('show');
    showToast('✓ Senha alterada com sucesso!', 'success');
  } catch (err) {
    showToast(err.message || 'Erro ao alterar senha.', 'error');
  }
});

/* ============================================================
   MODAIS - fechar
   ============================================================ */
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.close)?.classList.remove('show');
  });
});

document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
window.addEventListener('load', async () => {
  const user = loadSession();
  if (user && user.tipo === 'master') {
    try {
      // Valida que a sessão ainda é válida
      await API.get('/master/dashboard');
      showApp(user);
    } catch {
      clearSession();
      showLogin();
    }
  } else {
    showLogin();
  }
});
