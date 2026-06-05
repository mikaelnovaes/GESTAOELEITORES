/**
 * frontend/js/app.js v3.1
 * - Suporte a perfil MASTER (redireciona pra /master após login) 
 * - Suporte a modo ACTING (master personificando tenant)
 * - Header X-Acting-Tenant enviado quando master está em modo acting
 * - Banner amarelo no topo quando em modo acting
 * - Mantém TODAS as correções da v3.0
 */

'use strict';

/* ============================================================
   MONKEY PATCH GLOBAL DO FETCH
   Garante que qualquer chamada para /api/* leve o header
   X-Acting-Tenant quando o master estiver personificando.
   Resolve o bug onde whatsapp.js e import.js usavam fetch direto
   sem passar pelo helper API e iam para o tenant errado.
   ============================================================ */
(function patchGlobalFetch() {
  const _originalFetch = window.fetch.bind(window);
  window.fetch = function(input, init) {
    init = init || {};
    let url = '';
    if (typeof input === 'string') url = input;
    else if (input && input.url)   url = input.url;

    // Só intercepta chamadas para o backend deste app
    const isOurApi = url.startsWith('/api/') || url.startsWith(window.location.origin + '/api/');
    if (isOurApi) {
      const acting = sessionStorage.getItem('ge_acting_tenant');
      if (acting) {
        const newHeaders = new Headers(init.headers || {});
        if (!newHeaders.has('X-Acting-Tenant')) {
          newHeaders.set('X-Acting-Tenant', acting);
        }
        init = { ...init, headers: newHeaders };
      }
    }
    return _originalFetch(input, init);
  };
})();

/* ============================================================
   ACTING MODE (master personificando tenant)
   ============================================================ */
(function initActingFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const acting = params.get('acting');
if (acting && /^\d+$/.test(acting)) {
    sessionStorage.setItem('ge_acting_tenant', acting);
    // Ao entrar via URL (ex.: nova aba), forçamos limpeza de cache de outro tenant
    try {
      localStorage.removeItem('gestao_eleitores_v3');
      localStorage.removeItem('gestao_eleitores_tenant_v3');
      localStorage.removeItem('gestao_wa_log_v1');
      localStorage.removeItem('gestao_bday_log_v1');
      localStorage.removeItem('gestao_bday_last_run_v1');
      localStorage.removeItem('gestao_react_log_v1');
      localStorage.removeItem('gestao_react_last_run_v1');
    } catch(e) {}
    const url = new URL(window.location);
    url.searchParams.delete('acting');
    window.history.replaceState({}, '', url.pathname + (url.search || ''));
  }
})();

function getActingTenant()     { return sessionStorage.getItem('ge_acting_tenant') || null; }
function getActingTenantName() { return sessionStorage.getItem('ge_acting_tenant_nome') || ''; }
function clearActing() {
  sessionStorage.removeItem('ge_acting_tenant');
  sessionStorage.removeItem('ge_acting_tenant_nome');
}

// Tenant ativo no momento (master em modo acting OU usuário normal).
// Usado pelo cache local (data.js) para detectar vazamento entre tenants.


/*

************** getCurrentTenantId definida em data.js (carregado antes)*************
window.getCurrentTenantId = function getCurrentTenantId() {
  try {
    // 1) Master atuando como tenant
    var acting = sessionStorage.getItem('ge_acting_tenant');
    if (acting) return acting;
    // 2) Usuário regular: ler do JWT armazenado
    var token = sessionStorage.getItem('ge_jwt_token');
    if (!token) return null;
    var parts = token.split('.');
    if (parts.length < 2) return null;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.tenant_id != null ? String(payload.tenant_id) : null;
  } catch(e) {
    return null;
  }
};

************** getCurrentTenantId definida em data.js (carregado antes)*************

*/


/* ============================================================
   API CLIENT — envia X-Acting-Tenant quando aplicável
   ============================================================ */
const API = {
  _token() { return sessionStorage.getItem('ge_jwt_token'); },

  async fetch(path, options = {}) {
    const token  = this._token();
    const acting = getActingTenant();

    const headers = {
      'Content-Type': 'application/json',
      ...(token  ? { 'Authorization':   `Bearer ${token}` } : {}),
      ...(acting ? { 'X-Acting-Tenant': acting }            : {}),
      ...(options.headers || {}),
    };

    const res = await fetch('/api' + path, { ...options, headers });

    if (res.status === 401 && token) {
      clearSession();
      showLogin();
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
   
  get:    (path)       => API.fetch(path),
  post:   (path, body) => API.fetch(path, { method: 'POST',   body: JSON.stringify(body || {}) }),
  put:    (path, body) => API.fetch(path, { method: 'PUT',    body: JSON.stringify(body || {}) }),
  delete: (path)       => API.fetch(path, { method: 'DELETE' }),
};
window.API = API;

/* ============================================================
   SESSÃO JWT
   ============================================================ */
let currentUser = null;
window.currentUser = currentUser; // exposto para a sidebar

function saveSession(token, user) {
  sessionStorage.setItem('ge_jwt_token', token);
  sessionStorage.setItem('ge_user', JSON.stringify({
    id: Number(user.id), tipo: user.tipo, nome: user.nome,
    tenant_id: user.tenant_id, login: user.login,
  }));
  // Se for master, também salva nas chaves do painel master
  // para que ao redirecionar para /master, a sessão já esteja válida
  if (user.tipo === 'master') {
    sessionStorage.setItem('ge_master_token', token);
    sessionStorage.setItem('ge_master_user', JSON.stringify({
      id: Number(user.id), tipo: user.tipo, nome: user.nome,
      tenant_id: user.tenant_id, login: user.login,
    }));
  }
}

function loadSession() {
  const token = sessionStorage.getItem('ge_jwt_token');
  const raw   = sessionStorage.getItem('ge_user');
  if (!token || !raw) return null;
  try {
    const u = JSON.parse(raw);
    if (u && u.id != null) u.id = Number(u.id);
    return u;
  } catch { return null; }
}

function clearSession() {
  sessionStorage.removeItem('ge_jwt_token');
  sessionStorage.removeItem('ge_user');
  // limpa também sessão master (caso tenha sido salva)
  sessionStorage.removeItem('ge_master_token');
  sessionStorage.removeItem('ge_master_user');
  clearActing();
  currentUser = null;
  // Limpa TODO o cache de dados (eleitores + logs de robôs)
  clearAllLocalCache();
}

// Limpa todos os caches de dados locais (eleitores, logs de WhatsApp, logs de robôs).
// Crítico para isolamento entre usuários/tenants no mesmo navegador.
function clearAllLocalCache() {
  try {
    if (window.Eleitores?.clear) window.Eleitores.clear();
    if (window.WALog?.clear)     window.WALog.clear();
    // Garantia extra: limpa as chaves diretamente caso os helpers não estejam disponíveis
    localStorage.removeItem('gestao_eleitores_v3');
    localStorage.removeItem('gestao_eleitores_tenant_v3');
    localStorage.removeItem('gestao_wa_log_v1');
    // Logs locais dos robôs
    localStorage.removeItem('gestao_bday_log_v1');
    localStorage.removeItem('gestao_bday_last_run_v1');
    localStorage.removeItem('gestao_react_log_v1');
    localStorage.removeItem('gestao_react_last_run_v1');
  } catch (e) {
    console.warn('[cache] erro ao limpar:', e.message);
  }
}
window.clearAllLocalCache = clearAllLocalCache;

/* ============================================================
   LOGIN
   ============================================================ */
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('show');
  document.getElementById('acting-banner')?.remove();
  setTimeout(() => document.getElementById('login-user')?.focus(), 100);
}

function showApp(user) {
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('show');

  // Sidebar nova: avisa que o usuário mudou (ela atualiza nome/role/avatar sozinha)
  window.currentUser = currentUser;
  window.dispatchEvent(new CustomEvent('ge:user-changed'));

  const isPrivileged = user.tipo === 'admin' || user.tipo === 'master';
  document.body.classList.toggle('is-admin', isPrivileged);
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isPrivileged ? '' : 'none';
  });

renderActingBanner();
switchView('dashboard');
}

function renderActingBanner() {
  let banner = document.getElementById('acting-banner');
  const isMaster = currentUser?.tipo === 'master';
  const acting   = getActingTenant();
  let actingNome = getActingTenantName();

  if (!isMaster || !acting) { banner?.remove(); return; }

  // Se não tem o nome em sessionStorage, busca pela API (caso de nova aba)
  if (!actingNome) {
    API.get('/auth/me').then(me => {
      if (me?.acting_tenant_nome) {
        sessionStorage.setItem('ge_acting_tenant_nome', me.acting_tenant_nome);
        renderActingBanner(); // re-render com o nome
      }
    }).catch(() => {});
  }

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'acting-banner';
    banner.style.cssText = `
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
      border-bottom: 2px solid #f59e0b;
      padding: 0.7rem 1.5rem;
      display: flex; align-items: center; justify-content: space-between;
      font-size: 0.88rem; color: #78350f; font-weight: 500;
      position: sticky; top: 0; z-index: 50;
    `;
    document.body.insertBefore(banner, document.getElementById('app'));
  }

  banner.innerHTML = `
    <div>
      <strong>👑 MODO MASTER</strong> — Operando no ambiente: <strong>${escapeHtml(actingNome || ('ID ' + acting))}</strong>
    </div>
    <div style="display:flex;gap:0.5rem;">
      <a href="/master" style="color:#78350f;font-weight:600;text-decoration:underline;font-size:0.82rem;">Voltar ao Painel</a>
      <button id="btn-stop-acting" style="background:#78350f;color:#fef3c7;border:none;padding:5px 12px;border-radius:3px;font-size:0.78rem;cursor:pointer;font-weight:600;">Sair do modo</button>
    </div>
  `;
  document.getElementById('btn-stop-acting')?.addEventListener('click', () => {
    clearActing();
    clearAllLocalCache(); // evita levar dados do tenant antigo para outro contexto
    window.location.href = '/master';
  });
}

document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const loginVal = document.getElementById('login-user').value.trim();
  const senhaVal = document.getElementById('login-pass').value;
  const errEl    = document.getElementById('login-error');
  const btnEl    = e.submitter || document.querySelector('#login-form button[type="submit"]');

  if (!loginVal || !senhaVal) {
    errEl.textContent = 'Preencha usuário e senha.';
    errEl.classList.add('show');
    return;
  }
  if (btnEl) btnEl.disabled = true;
  errEl.classList.remove('show');

  try {
    const data = await API.post('/auth/login', { login: loginVal, senha: senhaVal });
    saveSession(data.token, data.user);
    document.getElementById('login-form').reset();

    // ⭐ MASTER → painel master
    if (data.user.tipo === 'master') {
      window.location.href = '/master';
      return;
    }

    showApp(data.user);
    syncFromAPI().catch(() => {});
  } catch (err) {
    errEl.textContent = err.message || 'Usuário ou senha incorretos.';
    errEl.classList.add('show');
    document.getElementById('login-pass').value = '';
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
});

// Logout via nova sidebar (chamado pelo botão "Sair" da sidebar)
window.logout = async function() {
  if (!confirm('Deseja realmente sair?')) return;
  await API.post('/auth/logout', {}).catch(() => {});
  clearSession();
  showLogin();
};



/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
const navBtns = document.querySelectorAll('.nav-btn');
const views   = document.querySelectorAll('.view');

let _switchingView = false;
function switchView(viewName) {
  // Guarda contra recursão (os módulos novos chamam switchView dentro de open*())
  if (_switchingView) return;
  _switchingView = true;
  try {
  // Master+admin acessam tudo
  const isPrivileged = currentUser?.tipo === 'admin' || currentUser?.tipo === 'master';
  if (viewName === 'users' && !isPrivileged) {
    showToast('Acesso restrito a administradores.', 'error'); return;
  }
  if (viewName === 'whatsapp-config' && !isPrivileged) {
    showToast('Acesso restrito a administradores.', 'error'); return;
  }
  if (viewName === 'elections-calc' && !isPrivileged) {
    showToast('Acesso restrito a administradores.', 'error'); return;
  }

  views.forEach(v => v.classList.toggle('active', v.id === `view-${viewName}`));
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === viewName));
  document.getElementById('main-content')?.scrollTo(0, 0);

const handlers = {
    list:              () => { syncFromAPI().then(renderList); },
    reports:           () => { syncFromAPI().then(renderReport); },
    liderancas:        () => window.GELiderancas?.openList(),
    'liderancas-report': () => window.GELiderancas?.openReport(),
    mapa:              () => window.GEMapa?.openMap(),
   'verificar-cidades': () => window.GECidades?.openModal(),
    'verificar-bairros': () => window.GEBairros?.openModal?.() || window.showToast?.('Use o botão "🔍 Verificar Bairros" na lista.', 'info'),
    'dashboard':              () => window.GEDashboard?.openDashboard(),
    'etiquetas-gerar':        () => {/* só mostra a tela; o botão abre o modal */},
    'etiquetas-historico':    () => window.GEEtiquetas?.openHistorico(),
    'projecao':       () => window.GEProjecao?.openProjecao(),
    'agenda':         () => window.GEAgenda?.openAgenda(),
    'disparo':        () => window.GEDisparo?.openDisparo(),
    new:               () => populateLiderancaDropdown(),
    'whatsapp-send':   () => window.GEWhatsApp?.openWhatsAppSend(),
    'whatsapp-config': () => window.GEWhatsApp?.openWhatsAppConfig(),
    'whatsapp-log':    () => window.GEWhatsApp?.renderWhatsAppLog(),
    robots:            () => window.GERobots?.openRobots(),
    birthday:          () => window.GERobots?.openBirthday(),
    reactivation:      () => window.GERobots?.openReactivation(),
    users:             renderUsers,
   'elections-calc':  () => window.GEElections?.openCalculator(),
  };
  if (handlers[viewName]) handlers[viewName]();
  } finally {
    _switchingView = false;
  }
}
window.switchView = switchView;

navBtns.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

/* ============================================================
   SINCRONIZAÇÃO COM API
   ============================================================ */
async function syncFromAPI() {
  try {
    const pageSize = 200;
    const first    = await API.get(`/eleitores?page=1&pageSize=${pageSize}`);
    let allRows    = Array.isArray(first.data) ? first.data : [];
    const totalPages = Number(first.pages || 1);
    for (let p = 2; p <= totalPages; p++) {
      const more = await API.get(`/eleitores?page=${p}&pageSize=${pageSize}`);
      if (Array.isArray(more.data)) allRows = allRows.concat(more.data);
    }
    Eleitores.save(allRows);
    return allRows;
  } catch (err) {
    console.warn('[sync] falhou:', err.message);
    return Eleitores.all();
  }
}
window.syncFromAPI = syncFromAPI;

/* ============================================================
   LISTA DE ELEITORES
   ============================================================ */
const listContainer = document.getElementById('list-container');
const filterNome    = document.getElementById('filter-nome');
const filterBairro  = document.getElementById('filter-bairro');
const filterCidade  = document.getElementById('filter-cidade');

function populateListDropdowns() {
  const all     = Eleitores.all();
  const bairros = [...new Set(all.map(e => e.bairro).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const cidades = [...new Set(all.map(e => e.cidade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  const bAtual  = filterBairro?.value || '';
  const cAtual  = filterCidade?.value || '';
  if (filterBairro) filterBairro.innerHTML = '<option value="">Todos os bairros</option>' + bairros.map(b => `<option value="${escapeHtml(b)}" ${b === bAtual ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
  if (filterCidade) filterCidade.innerHTML = '<option value="">Todas as cidades</option>' + cidades.map(c => `<option value="${escapeHtml(c)}" ${c === cAtual ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function applyFilters(data, nome, bairro, cidade) {
  return data.filter(e => {
    const mN = !nome   || (e.nome   || '').toLowerCase().includes(nome.toLowerCase());
    const mB = !bairro || (e.bairro || '').toLowerCase().includes(bairro.toLowerCase());
    const mC = !cidade || (e.cidade || '').toLowerCase().includes(cidade.toLowerCase());
    return mN && mB && mC;
  });
}

function renderList() {
  populateListDropdowns();
  const all    = Eleitores.all();
  const statEl = document.getElementById('stat-total');
  if (statEl) statEl.textContent = all.length;

  const filtered = applyFilters(all, filterNome?.value, filterBairro?.value, filterCidade?.value);
  const sorted   = [...filtered].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

  if (!filtered.length) {
    listContainer.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:52px;height:52px;color:var(--line);margin-bottom:1.2rem;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <h3>${all.length === 0 ? 'Nenhum eleitor cadastrado' : 'Nenhum resultado encontrado'}</h3>
        <p>${all.length === 0 ? 'Comece criando o primeiro cadastro ou importando de Excel.' : 'Ajuste os filtros para encontrar registros.'}</p>
      </div>`;
    return;
  }

  listContainer.innerHTML = `
  <table>
    <thead>
      <tr>
        <th style="width:60px"></th>
        <th>Nome Completo</th>
        <th>Endereço, Nº — Bairro</th>
        <th>Cidade</th>
        <th>Intenção</th>
        <th>Telefone</th>
        <th style="text-align:right">Ações</th>
      </tr>
    </thead>
    <tbody>
      ${sorted.map(e => {
        const endereco = [[e.endereco, e.numero].filter(Boolean).join(', '), e.bairro].filter(Boolean).join(' — ') || '—';
        const cidade = e.cidade && e.cidade.trim()
          ? escapeHtml(e.cidade)
          : '<span style="color:var(--warning);font-size:0.78rem;">⚠ Sem cidade</span>';
        return `
          <tr>
            <td>${e.foto_url ? `<img class="row-photo" src="${escapeHtml(e.foto_url)}" alt="">` : `<div class="row-photo-placeholder">${escapeHtml((e.nome[0] || '?').toUpperCase())}</div>`}</td>
            <td><div class="row-name">${escapeHtml(e.nome)}</div><div class="row-meta">${escapeHtml(e.cidade || '—')}</div></td>
            <td>${escapeHtml(endereco)}</td>
            <td>${cidade}</td>
            <td>${window.GEIntencao?.renderBadge(e.intencao_voto, e.id) || '—'}</td>
            <td>${escapeHtml(e.telefone || '—')}</td>
            <td><div class="actions-cell">
              <button class="icon-btn" data-act="view"   data-id="${e.id}">Ver</button>
              <button class="icon-btn" data-act="edit"   data-id="${e.id}">Editar</button>
              <button class="icon-btn danger" data-act="delete" data-id="${e.id}">Excluir</button>
            </div></td>
          </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  listContainer.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = Number(btn.dataset.id);
      const act = btn.dataset.act;
      const e   = Eleitores.find(id);
      if (!e) {
        showToast('Registro não encontrado no cache. Recarregando...', 'error');
        syncFromAPI().then(renderList);
        return;
      }
      if (act === 'view')   openDetailModal(e);
      if (act === 'edit')   openEleitorForm(e);
      if (act === 'delete') deleteEleitor(id);
    });
  });
}
window.renderList = renderList;

[filterNome, filterBairro, filterCidade].forEach(el => {
  el?.addEventListener('input',  renderList);
  el?.addEventListener('change', renderList);
});

document.getElementById('btn-clear-filters')?.addEventListener('click', () => {
  if (filterNome)   filterNome.value   = '';
  if (filterBairro) filterBairro.value = '';
  if (filterCidade) filterCidade.value = '';
  renderList();
});

/* ============================================================
   FORM ELEITOR + DETALHES + EXCLUSÃO (mantido da v3.0)
   ============================================================ */
document.getElementById('btn-new-eleitor')?.addEventListener('click', () => openEleitorForm(null));
document.getElementById('btn-novo-user')?.addEventListener('click', () => openUserModal(null));
document.getElementById('btn-cancel-form')?.addEventListener('click', () => switchView('list'));
document.getElementById('btn-save-eleitor')?.addEventListener('click', () => {
  document.getElementById('eleitor-form')?.dispatchEvent(new Event('submit'));
});

document.getElementById('eleitor-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id   = document.getElementById('eleitor-id')?.value;
  const nome = document.getElementById('f-nome')?.value.trim();
  if (!nome) { showToast('Nome é obrigatório.', 'error'); return; }
  const email = document.getElementById('f-email')?.value.trim();
  if (email && window.GESecurity && !window.GESecurity.Sanitizer.validateEmail(email)) {
    showToast('E-mail inválido.', 'error'); return;
  }
 const lidVal = document.getElementById('f-lideranca')?.value;
  const data = {
    nome,
    data_nascimento: document.getElementById('f-nascimento')?.value || null,
    telefone:        document.getElementById('f-telefone')?.value   || null,
    email:           email || null,
    endereco:        document.getElementById('f-endereco')?.value   || null,
    numero:          document.getElementById('f-numero')?.value     || null,
    bairro:          document.getElementById('f-bairro')?.value     || null,
    cidade:          document.getElementById('f-cidade')?.value     || null,
    titulo_eleitor:  document.getElementById('f-titulo')?.value     || null,
    secao:           document.getElementById('f-secao')?.value      || null,
    escola_votacao:  document.getElementById('f-escola')?.value     || null,
  lideranca_id:    lidVal ? Number(lidVal) : null,
    intencao_voto:   document.getElementById('f-intencao')?.value || null,
  };
  try {
    if (id) { await API.put(`/eleitores/${id}`, data); showToast('Eleitor atualizado!', 'success'); }
    else    { await API.post('/eleitores', data);       showToast('Eleitor cadastrado!', 'success'); }
    await syncFromAPI();
    document.getElementById('eleitor-form').reset();
    document.getElementById('eleitor-id').value = '';
    switchView('list');
  } catch (err) { showToast(err.message || 'Erro ao salvar.', 'error'); }
});

async function openEleitorForm(eleitor) {
  document.getElementById('form-title').textContent = eleitor ? 'Editar Eleitor' : 'Novo Eleitor';
  document.getElementById('eleitor-id').value     = eleitor?.id   || '';
  document.getElementById('f-nome').value         = eleitor?.nome || '';
  document.getElementById('f-nascimento').value   = (eleitor?.data_nascimento || '').substring(0,10);
  document.getElementById('f-telefone').value     = eleitor?.telefone || '';
  document.getElementById('f-email').value        = eleitor?.email || '';
  document.getElementById('f-endereco').value     = eleitor?.endereco || '';
  document.getElementById('f-numero').value       = eleitor?.numero || '';
  document.getElementById('f-bairro').value       = eleitor?.bairro || '';
  document.getElementById('f-cidade').value       = eleitor?.cidade || '';
  document.getElementById('f-titulo').value       = eleitor?.titulo_eleitor || '';
  document.getElementById('f-secao').value        = eleitor?.secao || '';
  document.getElementById('f-escola').value       = eleitor?.escola_votacao || '';
   const fLid = document.getElementById('f-lideranca');
  if (fLid) {
    if (eleitor && eleitor.lideranca_id) {
      document.getElementById('eleitor-id').dataset.lidId = String(eleitor.lideranca_id);
    } else {
      delete document.getElementById('eleitor-id').dataset.lidId;
    }
  }
 document.getElementById('f-intencao').value = eleitor?.intencao_voto || '';

  await populateLiderancaDropdown();
  switchView('new');
  setTimeout(() => document.getElementById('f-nome')?.focus(), 100);
}

async function deleteEleitor(id) {
  if (!confirm('Excluir este eleitor?')) return;
  try {
    await API.delete(`/eleitores/${id}`);
    showToast('Eleitor excluído.', 'success');
    await syncFromAPI();
    renderList();
  } catch (err) { showToast(err.message || 'Erro ao excluir.', 'error'); }
}
window.deleteEleitor = deleteEleitor;

function openDetailModal(e) {
  const body = document.getElementById('modal-body');
  if (!body) return;
  body.innerHTML = `
    <div style="display:flex;gap:1.4rem;align-items:flex-start;flex-wrap:wrap;">
      ${e.foto_url ? `<img src="${escapeHtml(e.foto_url)}" style="width:120px;height:120px;border-radius:8px;object-fit:cover">` : `<div style="width:120px;height:120px;border-radius:8px;background:var(--cream);display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-size:3rem;color:var(--navy);">${escapeHtml((e.nome[0] || '?').toUpperCase())}</div>`}
      <div style="flex:1;">
        <div style="font-family:'Fraunces',serif;font-size:1.4rem;color:var(--navy);font-weight:600;">${escapeHtml(e.nome)}</div>
        ${e.data_nascimento ? `<div style="color:var(--muted);font-size:0.88rem;margin-top:0.2rem;">Nascimento: ${formatDate(e.data_nascimento)} (${calculateAge(e.data_nascimento)} anos)</div>` : ''}
      </div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-top:1.4rem;">
  ${(() => {
      const INTENCAO_LABELS = {
        confirmado: '✅ Confirmado',
        provavel:   '🟢 Provável',
        indeciso:   '🟡 Indeciso',
        risco:      '🔴 Em Risco',
      };
      const intencaoTexto = INTENCAO_LABELS[e.intencao_voto] || '⬜ Indefinido';
      return [
        ['Telefone', e.telefone],
        ['E-mail', e.email],
        ['Liderança', e.lideranca_nome || null],
        ['Intenção de Voto', intencaoTexto],
        ['Endereço', [e.endereco, e.numero].filter(Boolean).join(', ')],
        ['Bairro', e.bairro],
        ['Cidade', e.cidade],
        ['Título', e.titulo_eleitor],
        ['Seção', e.secao],
        ['Local', e.escola_votacao],
      ].filter(([,v]) => v).map(([label,value]) => `
        <div style="background:var(--cream);padding:0.6rem 0.8rem;border-radius:4px;">
          <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:0.2rem;">${escapeHtml(label)}</div>
          <div style="font-size:0.9rem;color:var(--ink);">${escapeHtml(value)}</div>
        </div>`).join('');
    })()}
    </div>`;
  document.getElementById('btn-modal-edit')?.setAttribute('data-edit-id', e.id);
  document.getElementById('btn-modal-delete')?.setAttribute('data-delete-id', e.id);
  document.getElementById('detail-modal').classList.add('show');
}

document.getElementById('btn-modal-edit')?.addEventListener('click', (ev) => {
  const id = Number(ev.target.dataset.editId);
  const eleitor = Eleitores.find(id);
  if (eleitor) { document.getElementById('detail-modal').classList.remove('show'); openEleitorForm(eleitor); }
});
document.getElementById('btn-modal-delete')?.addEventListener('click', async (ev) => {
  const id = Number(ev.target.dataset.deleteId);
  document.getElementById('detail-modal').classList.remove('show');
  await deleteEleitor(id);
});

document.getElementById('btn-abrir-modal-etiquetas')?.addEventListener('click', () => {
  window.GEEtiquetas?.abrirGerar?.();
});

/* =============================================================
   RELATÓRIO (mantido da v3.0)
   ============================================================ */
function renderReport() {
  const nomeEl    = document.getElementById('report-filter-nome');
  const bairroEl  = document.getElementById('report-filter-bairro');
  const cidadeEl  = document.getElementById('report-filter-cidade');
  const sortEl    = document.getElementById('report-sort');
  const container = document.getElementById('report-container');
  if (!container) return;

  const all     = Eleitores.all();
  const bairros = [...new Set(all.map(e => e.bairro).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  const cidades = [...new Set(all.map(e => e.cidade).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  const bairroVal = bairroEl ? bairroEl.value : '';
  const cidadeVal = cidadeEl ? cidadeEl.value : '';

  if (bairroEl) bairroEl.innerHTML = '<option value="">Todos os bairros</option>' + bairros.map(b => `<option value="${escapeHtml(b)}" ${b === bairroVal ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
  if (cidadeEl) cidadeEl.innerHTML = '<option value="">Todas as cidades</option>' + cidades.map(c => `<option value="${escapeHtml(c)}" ${c === cidadeVal ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');

  const nomeVal  = nomeEl?.value || '';
  const filtered = applyFilters(all, nomeVal, bairroEl?.value, cidadeEl?.value);
  const sortKey  = sortEl?.value || 'nome';
  const sorted   = [...filtered].sort((a, b) => (a[sortKey] || '').localeCompare(b[sortKey] || '', 'pt-BR'));

  const countEl = document.getElementById('report-count');
  if (countEl) countEl.textContent = sorted.length + (sorted.length === 1 ? ' registro' : ' registros');

  if (!sorted.length) {
    container.innerHTML = `<div class="empty"><h3>Nenhum resultado</h3></div>`;
    return;
  }
  container.innerHTML = `<table>
    <thead><tr><th>Nome</th><th>Endereço</th><th>Nº</th><th>Bairro</th><th>Cidade</th><th>Telefone</th><th>Título</th><th>Seção</th></tr></thead>
    <tbody>${sorted.map(e => `<tr>
      <td><strong>${escapeHtml(e.nome)}</strong></td>
      <td>${escapeHtml(e.endereco || '—')}</td>
      <td>${escapeHtml(e.numero   || '—')}</td>
      <td>${escapeHtml(e.bairro   || '—')}</td>
      <td>${escapeHtml(e.cidade   || '—')}</td>
      <td>${escapeHtml(e.telefone || '—')}</td>
      <td>${escapeHtml(e.titulo_eleitor || '—')}</td>
      <td>${escapeHtml(e.secao    || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}
window.renderReport = renderReport;



[document.getElementById('report-filter-bairro'),
 document.getElementById('report-filter-cidade'),
 document.getElementById('report-sort')].forEach(el => el?.addEventListener('change', renderReport));

// Busca por nome em tempo real
document.getElementById('report-filter-nome')?.addEventListener('input', renderReport);

// Botão Limpar filtros
document.getElementById('btn-clear-report-filters')?.addEventListener('click', () => {
  const nomeEl   = document.getElementById('report-filter-nome');
  const bairroEl = document.getElementById('report-filter-bairro');
  const cidadeEl = document.getElementById('report-filter-cidade');
  const sortEl   = document.getElementById('report-sort');
  if (nomeEl)   nomeEl.value   = '';
  if (bairroEl) bairroEl.value = '';
  if (cidadeEl) cidadeEl.value = '';
  if (sortEl)   sortEl.value   = 'nome';
  renderReport();
});

document.getElementById('btn-print-report')?.addEventListener('click', () => window.print());

async function populateLiderancaDropdown() {
  const sel = document.getElementById('f-lideranca');
  if (!sel || !window.GELiderancas) return;
  const currentValue = sel.value || document.getElementById('eleitor-id')?.dataset.lidId || '';
  const list = await window.GELiderancas.fetchAll();
  const sorted = [...list].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  sel.innerHTML = '<option value="">— Nenhuma —</option>' +
    sorted.map(l => {
      const label = l.nome + (l.cargo ? ` (${l.cargo})` : '');
      return `<option value="${l.id}" ${String(l.id) === String(currentValue) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}
window.populateLiderancaDropdown = populateLiderancaDropdown;

/* ============================================================
   EXPORTAÇÃO CSV
   ============================================================ */
document.getElementById('btn-export-csv')?.addEventListener('click', () => {
  const all  = Eleitores.all();
  const cols = ['nome','data_nascimento','telefone','email','endereco','numero','bairro','cidade','titulo_eleitor','secao','escola_votacao'];
  const labels = { nome:'Nome', data_nascimento:'Nascimento', telefone:'Telefone', email:'Email', endereco:'Endereço', numero:'Número', bairro:'Bairro', cidade:'Cidade', titulo_eleitor:'Título', secao:'Seção', escola_votacao:'Local' };
  const esc = (s) => { const v = String(s ?? ''); return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const csv = [cols.map(c => labels[c]), ...all.map(e => cols.map(c => esc(c === 'data_nascimento' && e[c] ? formatDate(e[c]) : e[c] || '')))].map(r => r.join(';')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `eleitores_${new Date().toISOString().slice(0,10)}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`${all.length} eleitor(es) exportado(s).`, 'success');
});

/* ============================================================
   EXCLUSÃO EM MASSA — 3 confirmações + senha
   ============================================================ */
document.getElementById('btn-purge-all')?.addEventListener('click', () => {
  // Reseta o modal a cada abertura
  const modal = document.getElementById('purge-modal');
  if (!modal) return;
  document.getElementById('purge-confirm-input').value = '';
  document.getElementById('purge-password-input').value = '';
  document.getElementById('purge-error').style.display = 'none';
  document.getElementById('btn-purge-confirm').disabled = true;
  modal.classList.add('show');
  setTimeout(() => document.getElementById('purge-confirm-input').focus(), 100);
});

// Habilita o botão "Excluir" apenas quando o usuário digita EXCLUIR-TUDO E coloca senha
function checkPurgeReady() {
  const conf  = document.getElementById('purge-confirm-input')?.value.trim();
  const senha = document.getElementById('purge-password-input')?.value;
  const btn   = document.getElementById('btn-purge-confirm');
  if (btn) btn.disabled = !(conf === 'EXCLUIR-TUDO' && senha && senha.length > 0);
}
document.getElementById('purge-confirm-input')?.addEventListener('input', checkPurgeReady);
document.getElementById('purge-password-input')?.addEventListener('input', checkPurgeReady);

document.getElementById('btn-purge-confirm')?.addEventListener('click', async () => {
  const conf  = document.getElementById('purge-confirm-input').value.trim();
  const senha = document.getElementById('purge-password-input').value;
  const errEl = document.getElementById('purge-error');
  const btn   = document.getElementById('btn-purge-confirm');

  if (conf !== 'EXCLUIR-TUDO') {
    errEl.textContent = 'Você precisa digitar EXCLUIR-TUDO exatamente como mostrado.';
    errEl.style.display = 'block';
    return;
  }
  if (!senha) {
    errEl.textContent = 'Informe sua senha.';
    errEl.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Excluindo...';
  errEl.style.display = 'none';

  try {
    const r = await API.post('/eleitores/admin/purge', { senha, confirmacao: 'EXCLUIR-TUDO' });
    document.getElementById('purge-modal').classList.remove('show');
    showToast(`✓ ${r.excluidos} eleitor(es) excluído(s).`, 'success');
    await syncFromAPI();
    renderList();
  } catch (err) {
    errEl.textContent = err.message || 'Erro na exclusão.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Excluir Todos Definitivamente';
  }
});

/* ============================================================
   USUÁRIOS DO AMBIENTE (visão local)
   ============================================================ */
async function renderUsers() {
  const container = document.getElementById('users-container');
  if (!container) return;
  try {
    const users = await API.get('/usuarios');
    if (!users.length) { container.innerHTML = '<div class="empty"><h3>Nenhum usuário</h3></div>'; return; }
    container.innerHTML = `<table>
      <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Último Login</th><th style="text-align:right">Ações</th></tr></thead>
      <tbody>${users.map(u => `<tr>
        <td><strong style="color:var(--navy)">${escapeHtml(u.nome)}</strong>${Number(u.id) === Number(currentUser?.id) ? ' <span class="badge badge-success" style="margin-left:0.4rem">você</span>' : ''}</td>
        <td><code style="font-family:monospace;background:var(--cream);padding:2px 6px;">${escapeHtml(u.login)}</code></td>
        <td>${u.tipo === 'admin' ? '<span class="badge badge-admin">Administrador</span>' : '<span class="badge badge-comum">Usuário</span>'}</td>
        <td style="font-size:0.82rem;color:var(--muted);">${u.ultimo_login ? formatDateTime(u.ultimo_login) : '—'}</td>
        <td><div class="actions-cell">
          <button class="icon-btn" data-uact="edit" data-uid="${u.id}">Editar</button>
          <button class="icon-btn danger" data-uact="delete" data-uid="${u.id}" ${Number(u.id) === Number(currentUser?.id) ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>Excluir</button>
        </div></td>
      </tr>`).join('')}</tbody></table>`;
    container.querySelectorAll('[data-uact]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = Number(btn.dataset.uid);
        const act = btn.dataset.uact;
        if (act === 'edit') {
          const u = users.find(u => Number(u.id) === uid);
          if (u) openUserModal(u);
        }
        if (act === 'delete') {
          if (uid === Number(currentUser?.id)) { showToast('Não pode excluir seu próprio usuário.', 'error'); return; }
          if (!confirm('Excluir este usuário?')) return;
          try { await API.delete(`/usuarios/${uid}`); showToast('Usuário excluído.', 'success'); renderUsers(); }
          catch (err) { showToast(err.message, 'error'); }
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty"><h3>Erro</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function openUserModal(user) {
  document.getElementById('user-id').value    = user?.id    || '';
  document.getElementById('user-nome').value  = user?.nome  || '';
  document.getElementById('user-login').value = user?.login || '';
  document.getElementById('user-senha').value = '';
  document.getElementById('user-tipo').value  = user?.tipo  || 'comum';
  document.getElementById('user-modal-title').textContent = user ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('user-pass-hint').textContent   = user ? '(deixe em branco para manter)' : '(mínimo 8 caracteres)';
  document.getElementById('user-senha').required = !user;
  document.getElementById('user-modal').classList.add('show');
  setTimeout(() => document.getElementById('user-nome')?.focus(), 100);
}

document.getElementById('btn-save-user')?.addEventListener('click', () => {
  document.getElementById('user-form')?.dispatchEvent(new Event('submit'));
});

document.getElementById('user-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('user-id')?.value;
  const data = {
    nome:  document.getElementById('user-nome').value.trim(),
    login: document.getElementById('user-login').value.trim().toLowerCase(),
    tipo:  document.getElementById('user-tipo').value,
  };
  const senha = document.getElementById('user-senha').value;
  if (senha) data.senha = senha;
  if (!id && !senha) { showToast('Senha obrigatória para novos usuários.', 'error'); return; }
  if (senha && senha.length < 8) { showToast('Senha deve ter ao menos 8 caracteres.', 'error'); return; }
  try {
    if (id) { await API.put(`/usuarios/${id}`, data); showToast('Usuário atualizado.', 'success'); }
    else    { await API.post('/usuarios', data);       showToast('Usuário criado.', 'success'); }
    document.getElementById('user-modal').classList.remove('show');
    renderUsers();
  } catch (err) { showToast(err.message || 'Erro ao salvar.', 'error'); }
});

/* ============================================================
   MODAIS - FECHAR
   ============================================================ */
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => document.getElementById(btn.dataset.close)?.classList.remove('show'));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('show'); });
});

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).substring(0,10).split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}
function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function calculateAge(iso) {
  if (!iso) return '';
  const today = new Date();
  const birth = new Date(iso);
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() - birth.getMonth() < 0 || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
  return age;
}

const toastEl = document.getElementById('toast');
let toastTimer;
function showToast(msg, type = '') {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.className   = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.className = '', 3500);
}
window.showToast = showToast;
// window.escapeHtml removido — definido em security.js
window.formatDate = formatDate;
window.formatDateTime = formatDateTime;
window.calculateAge = calculateAge;

/* ============================================================
   VARREDURA DE DUPLICATAS (mantido da v3.0)
   ============================================================ */
function normalizeStr(s) {
  if (!s) return '';
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
}
function normalizePhone(s) { if (!s) return ''; return String(s).replace(/\D/g, ''); }
function nameSimilarity(a, b) {
  a = normalizeStr(a); b = normalizeStr(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 5) return 0;
  const dp = Array.from({length: la + 1}, (_, i) => [i]);
  for (let j = 1; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++) for (let j = 1; j <= lb; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  const maxLen = Math.max(la, lb);
  return maxLen === 0 ? 1 : 1 - dp[la][lb] / maxLen;
}
function detectDuplicates(eleitores) {
  const groups = [];
  const visited = new Set();
  for (let i = 0; i < eleitores.length; i++) {
    if (visited.has(i)) continue;
    const group = [eleitores[i]];
    for (let j = i + 1; j < eleitores.length; j++) {
      if (visited.has(j)) continue;
      const a = eleitores[i], b = eleitores[j];
      let isDup = false, motivo = '';
      const telA = normalizePhone(a.telefone), telB = normalizePhone(b.telefone);
      if (telA.length >= 8 && telA === telB) { isDup = true; motivo = 'Mesmo telefone'; }
      if (!isDup) {
        const sim = nameSimilarity(a.nome, b.nome);
        if (sim >= 0.85) {
          const cA = normalizeStr(a.cidade), cB = normalizeStr(b.cidade);
          const bA = normalizeStr(a.bairro), bB = normalizeStr(b.bairro);
          if ((cA && cA === cB) || (bA && bA === bB)) { isDup = true; motivo = `Nome similar (${Math.round(sim*100)}%) + mesma localidade`; }
          if (!isDup && sim === 1) { isDup = true; motivo = 'Nome idêntico'; }
        }
      }
      if (isDup) { group.push({ ...b, _motivo: motivo }); visited.add(j); }
    }
    if (group.length > 1) { visited.add(i); groups.push(group); }
  }
  return groups;
}
function chooseBest(group) {
  return group.reduce((best, curr) => {
    const sB = [best.telefone, best.email, best.endereco, best.titulo_eleitor, best.bairro, best.cidade].filter(Boolean).length;
    const sC = [curr.telefone, curr.email, curr.endereco, curr.titulo_eleitor, curr.bairro, curr.cidade].filter(Boolean).length;
    return sC > sB ? curr : best;
  });
}

document.getElementById('btn-check-duplicates')?.addEventListener('click', async () => {
  const modal = document.getElementById('dup-modal');
  if (!modal) return;
  document.getElementById('dup-modal-body').innerHTML = '<div class="empty" style="padding:3rem;"><p>Sincronizando…</p></div>';
  modal.classList.add('show');
  await syncFromAPI();
  const groups = detectDuplicates(Eleitores.all());
  renderDuplicatesModal(groups);
});

/* ============================================================
   BOTÕES: Verificar Bairros + Verificar Cidades
   ============================================================ */
document.getElementById('btn-check-bairros')?.addEventListener('click', () => {
  if (window.GEBairros?.abrirVerificacao) {
    window.GEBairros.abrirVerificacao();
  } else {
    showToast('Módulo de bairros não carregado.', 'error');
  }
});

document.getElementById('btn-check-cidades')?.addEventListener('click', () => {
  if (window.GECidades?.openModal) {
    window.GECidades.openModal();
  } else {
    showToast('Módulo de cidades não carregado.', 'error');
  }
});

document.getElementById('btn-check-enderecos')?.addEventListener('click', () => {
  if (window.GEEnderecos?.openModal) {
    window.GEEnderecos.openModal();
  } else {
    showToast('Módulo de endereços não carregado.', 'error');
  }
});

function renderDuplicatesModal(groups) {
function renderDuplicatesModal(groups) {
  const body   = document.getElementById('dup-modal-body');
  const footer = document.getElementById('dup-modal-footer');
  if (!body) return;
  if (!groups.length) {
    body.innerHTML = `<div class="empty" style="padding:3rem;"><h3 style="color:var(--success)">Nenhuma duplicata!</h3></div>`;
    footer.innerHTML = '<button class="btn btn-secondary" data-close="dup-modal">Fechar</button>';
    return;
  }
  const totalToRemove = groups.reduce((t, g) => t + g.length - 1, 0);
  let html = `<div style="padding:1rem 2rem;border-bottom:1px solid var(--line);background:var(--danger-soft);">
    <strong style="color:var(--danger);">${groups.length} grupo(s)</strong>
    <span style="color:var(--muted);font-size:0.82rem;margin-left:0.8rem;">${totalToRemove} registro(s) serão removidos</span>
  </div>`;
  groups.forEach((group, gi) => {
    const best = chooseBest(group);
    html += `<div class="dup-item"><div class="dup-group-header"><span class="dup-group-label">Grupo ${gi+1} — ${group[1]._motivo || 'duplicata'}</span></div>`;
    html += '<table class="dup-table"><thead><tr><th></th><th>Nome</th><th>Telefone</th><th>Endereço</th><th>Bairro/Cidade</th></tr></thead><tbody>';
    group.forEach(e => {
      const isKeep = e.id === best.id;
      html += `<tr class="${isKeep ? 'dup-keep' : 'dup-remove'}">
        <td>${isKeep ? '<span class="badge badge-success">✓ manter</span>' : '<span class="badge" style="background:var(--danger-soft);color:var(--danger);">✗ remover</span>'}</td>
        <td><strong>${escapeHtml(e.nome || '—')}</strong></td>
        <td>${escapeHtml(e.telefone || '—')}</td>
        <td>${escapeHtml([e.endereco, e.numero].filter(Boolean).join(', ') || '—')}</td>
        <td>${escapeHtml([e.bairro, e.cidade].filter(Boolean).join(' / ') || '—')}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  });
  body.innerHTML = html;
  footer.innerHTML = `<button class="btn btn-secondary" data-close="dup-modal">Cancelar</button><button class="btn btn-danger" id="btn-confirm-remove-dup">Remover ${totalToRemove} Duplicata(s)</button>`;
  document.getElementById('btn-confirm-remove-dup').addEventListener('click', async function() {
    if (!confirm(`Remover ${totalToRemove} duplicata(s)?`)) return;
    this.disabled = true; this.textContent = 'Removendo...';
    let removed = 0;
    for (const group of groups) {
      const best = chooseBest(group);
      for (const e of group) {
        if (e.id === best.id) continue;
        try { await API.delete(`/eleitores/${e.id}`); removed++; } catch {}
      }
    }
    document.getElementById('dup-modal').classList.remove('show');
    showToast(`${removed} duplicata(s) removida(s)!`, 'success');
    await syncFromAPI();
    renderList();
  });
}

document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-close]');
  if (btn) document.getElementById(btn.dataset.close)?.classList.remove('show');
});

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
window.addEventListener('load', async () => {
  try { if (window.GESecurity?.RateLimiter) window.GESecurity.RateLimiter.reset('login'); } catch(e) {}

  const user = loadSession();
  if (user) {
    // Master sem acting → painel master
    if (user.tipo === 'master' && !getActingTenant()) {
      window.location.href = '/master';
      return;
    }
    try {
      showApp(user);
      await syncFromAPI();
      renderList();
    } catch (err) {
      console.error('[LOAD]', err);
      clearSession();
      showLogin();
    }
  } else {
    showLogin();
  }

  if (window.GEImport?.initImport) window.GEImport.initImport();
  if (window.GEWhatsApp?.initWhatsApp) window.GEWhatsApp.initWhatsApp();
  if (window.GERobots?.startBirthdayWatcher) window.GERobots.startBirthdayWatcher();
  if (window.GERobots?.startReactivationWatcher) window.GERobots.startReactivationWatcher();
});
