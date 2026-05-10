/**
 * frontend/js/app.js
 * Módulo principal — inicialização, navegação, formulários, sessão JWT
 *
 * Conecta ao backend Railway/Render via fetch() com JWT.
 * Dados de exibição ainda usam localStorage como cache local.
 */

'use strict';

/* ============================================================
   REFERÊNCIAS AOS MÓDULOS GLOBAIS (definidos em data.js)
   ============================================================ */


/* ============================================================
   API CLIENT — todas as chamadas ao backend passam por aqui
   ============================================================ */
const API = {
  _token() { return sessionStorage.getItem('ge_jwt_token'); },

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
      throw new Error('Sessão expirada. Faça login novamente.');
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  get:    (path)         => API.fetch(path),
  post:   (path, body)   => API.fetch(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (path, body)   => API.fetch(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: (path)         => API.fetch(path, { method: 'DELETE' }),
};

/* ============================================================
   SESSÃO JWT
   ============================================================ */
let currentUser = null;

function saveSession(token, user) {
  sessionStorage.setItem('ge_jwt_token', token);
  sessionStorage.setItem('ge_user', JSON.stringify({ id: user.id, tipo: user.tipo, nome: user.nome }));
}

function loadSession() {
  const token = sessionStorage.getItem('ge_jwt_token');
  const raw   = sessionStorage.getItem('ge_user');
  if (!token || !raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function clearSession() {
  sessionStorage.removeItem('ge_jwt_token');
  sessionStorage.removeItem('ge_user');
  currentUser = null;
}

/* ============================================================
   TELA DE LOGIN
   ============================================================ */
function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app').classList.remove('show');
  setTimeout(() => document.getElementById('login-user')?.focus(), 100);
}

function showApp(user) {
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').classList.add('show');
  document.getElementById('footer-user-name').textContent = user.nome;
  document.getElementById('footer-user-role').textContent = user.tipo === 'admin' ? 'Administrador' : 'Usuário';
  document.body.classList.toggle('is-admin', user.tipo === 'admin');

  // Mostrar itens de admin
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = user.tipo === 'admin' ? '' : 'none';
  });

  switchView('list');
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

  // Desabilitar botão durante o login
  if (btnEl) btnEl.disabled = true;
  errEl.classList.remove('show');

  try {
    const data = await API.post('/auth/login', { login: loginVal, senha: senhaVal });

    // Salvar sessão
    saveSession(data.token, data.user);
    document.getElementById('login-form').reset();

    // Mostrar app (com proteção contra erros)
    try {
      showApp(data.user);
    } catch (appErr) {
      console.error('[APP] Erro ao inicializar tela:', appErr);
      // Recarregar — sessão já foi salva, vai funcionar no reload
      window.location.reload();
    }

  } catch (err) {
    console.error('[LOGIN] Erro:', err);
    errEl.textContent = err.message || 'Usuário ou senha incorretos.';
    errEl.classList.add('show');
    document.getElementById('login-pass').value = '';
  } finally {
    if (btnEl) btnEl.disabled = false;
  }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  if (!confirm('Deseja realmente sair?')) return;
  await API.post('/auth/logout', {}).catch(() => {});
  clearSession();
  showLogin();
});

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
const navBtns = document.querySelectorAll('.nav-btn');
const views   = document.querySelectorAll('.view');

function switchView(viewName) {
  if (viewName === 'users' && currentUser?.tipo !== 'admin') {
    showToast('Acesso restrito a administradores.', 'error'); return;
  }
  if (viewName === 'whatsapp-config' && currentUser?.tipo !== 'admin') {
    showToast('Acesso restrito a administradores.', 'error'); return;
  }

  views.forEach(v => v.classList.toggle('active', v.id === `view-${viewName}`));
  navBtns.forEach(b => b.classList.toggle('active', b.dataset.view === viewName));

  document.getElementById('main-content')?.scrollTo(0, 0);

  const handlers = {
    list:             renderList,
    reports:          renderReport,
    'whatsapp-send':  () => window.GEWhatsApp?.openWhatsAppSend(),
    'whatsapp-config':() => window.GEWhatsApp?.openWhatsAppConfig(),
    'whatsapp-log':   () => window.GEWhatsApp?.renderWhatsAppLog(),
    robots:           () => window.GERobots?.openRobots(),
    birthday:         openBirthday,
    reactivation:     openReactivation,
    users:            renderUsers,
  };

  if (handlers[viewName]) handlers[viewName]();
}

navBtns.forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

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

  if (filterBairro) {
    filterBairro.innerHTML = '<option value="">Todos os bairros</option>' +
      bairros.map(b => `<option value="${escapeHtml(b)}" ${b === bAtual ? 'selected' : ''}>${escapeHtml(b)}</option>`).join('');
  }
  if (filterCidade) {
    filterCidade.innerHTML = '<option value="">Todas as cidades</option>' +
      cidades.map(c => `<option value="${escapeHtml(c)}" ${c === cAtual ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
  }
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
  const all      = Eleitores.all();
  const statEl   = document.getElementById('stat-total');
  if (statEl) statEl.textContent = all.length;

  const filtered = applyFilters(all, filterNome?.value, filterBairro?.value, filterCidade?.value);
  const sorted   = [...filtered].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

  if (!filtered.length) {
    listContainer.innerHTML = `
      <div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="width:52px;height:52px;color:var(--line);margin-bottom:1.2rem;">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
        <h3>${all.length === 0 ? 'Nenhum eleitor cadastrado' : 'Nenhum resultado encontrado'}</h3>
        <p>${all.length === 0 ? 'Comece criando o primeiro cadastro ou importando de Excel.' : 'Ajuste os filtros para encontrar registros.'}</p>
      </div>
    `;
    return;
  }

  listContainer.innerHTML = `
    <table>
      <thead>
        <tr>
          <th style="width:60px"></th>
          <th>Nome Completo</th>
          <th>Endereço, Nº — Bairro</th>
          <th>Telefone</th>
          <th style="text-align:right">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${sorted.map(e => {
          const endereco = [[e.endereco, e.numero].filter(Boolean).join(', '), e.bairro].filter(Boolean).join(' — ') || '—';
          return `
            <tr>
              <td>${e.foto_url
                ? `<img class="row-photo" src="${escapeHtml(e.foto_url)}" alt="">`
                : `<div class="row-photo-placeholder">${escapeHtml((e.nome[0] || '?').toUpperCase())}</div>`
              }</td>
              <td>
                <div class="row-name">${escapeHtml(e.nome)}</div>
                <div class="row-meta">${escapeHtml(e.cidade || '—')}</div>
              </td>
              <td>${escapeHtml(endereco)}</td>
              <td>${escapeHtml(e.telefone || '—')}</td>
              <td>
                <div class="actions-cell">
                  <button class="icon-btn" data-act="view"   data-id="${e.id}">Ver</button>
                  <button class="icon-btn" data-act="edit"   data-id="${e.id}">Editar</button>
                  <button class="icon-btn danger" data-act="delete" data-id="${e.id}">Excluir</button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  listContainer.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id  = parseInt(btn.dataset.id);
      const act = btn.dataset.act;
      const e   = Eleitores.find(id);
      if (!e) return;
      if (act === 'view')   openDetailModal(e);
      if (act === 'edit')   openEleitorForm(e);
      if (act === 'delete') deleteEleitor(id);
    });
  });
}

// Filtros
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
   FORMULÁRIO DE ELEITOR
   ============================================================ */
document.getElementById('btn-new-eleitor')?.addEventListener('click', () => { openEleitorForm(null); switchView('new'); });
document.getElementById('btn-novo-user')?.addEventListener('click',    () => openUserModal(null));
document.getElementById('btn-cancel-form')?.addEventListener('click',  () => switchView('list'));

document.getElementById('btn-save-eleitor')?.addEventListener('click', () => {
  document.getElementById('eleitor-form')?.dispatchEvent(new Event('submit'));
});

document.getElementById('eleitor-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id   = document.getElementById('eleitor-id')?.value;
  const nome = document.getElementById('f-nome')?.value.trim();

  if (!nome) { showToast('Nome é obrigatório.', 'error'); return; }

  // Validação de e-mail
  const email = document.getElementById('f-email')?.value.trim();
  if (email && window.GESecurity && !window.GESecurity.Sanitizer.validateEmail(email)) {
    showToast('E-mail inválido.', 'error'); return;
  }

  const data = {
    nome,
    data_nascimento:  document.getElementById('f-nascimento')?.value  || null,
    telefone:         document.getElementById('f-telefone')?.value    || null,
    email:            email || null,
    endereco:         document.getElementById('f-endereco')?.value    || null,
    numero:           document.getElementById('f-numero')?.value      || null,
    bairro:           document.getElementById('f-bairro')?.value      || null,
    cidade:           document.getElementById('f-cidade')?.value      || null,
    titulo_eleitor:   document.getElementById('f-titulo')?.value      || null,
    secao:            document.getElementById('f-secao')?.value       || null,
    escola_votacao:   document.getElementById('f-escola')?.value      || null,
  };

  try {
    if (id) {
      // Atualizar via API e também no localStorage (cache)
      await API.put(`/eleitores/${id}`, data);
      Eleitores.update(parseInt(id), data);
      showToast('Eleitor atualizado com sucesso.', 'success');
    } else {
      // Criar via API
      const created = await API.post('/eleitores', data);
      Eleitores.insert({ ...data, id: created.id });
      showToast('Eleitor cadastrado com sucesso.', 'success');
    }

    document.getElementById('eleitor-form').reset();
    document.getElementById('eleitor-id').value = '';
    switchView('list');
  } catch (err) {
    showToast(err.message || 'Erro ao salvar eleitor.', 'error');
  }
});

function openEleitorForm(eleitor) {
  const titleEl = document.getElementById('form-title');
  if (titleEl) titleEl.textContent = eleitor ? 'Editar Eleitor' : 'Novo Eleitor';

  document.getElementById('eleitor-id').value          = eleitor?.id    || '';
  document.getElementById('f-nome').value              = eleitor?.nome  || '';
  document.getElementById('f-nascimento').value        = eleitor?.data_nascimento || '';
  document.getElementById('f-telefone').value          = eleitor?.telefone || '';
  document.getElementById('f-email').value             = eleitor?.email || '';
  document.getElementById('f-endereco').value          = eleitor?.endereco || '';
  document.getElementById('f-numero').value            = eleitor?.numero || '';
  document.getElementById('f-bairro').value            = eleitor?.bairro || '';
  document.getElementById('f-cidade').value            = eleitor?.cidade || '';
  document.getElementById('f-titulo').value            = eleitor?.titulo_eleitor || '';
  document.getElementById('f-secao').value             = eleitor?.secao || '';
  document.getElementById('f-escola').value            = eleitor?.escola_votacao || '';

  switchView('new');
  setTimeout(() => document.getElementById('f-nome')?.focus(), 100);
}

async function deleteEleitor(id) {
  if (!confirm('Excluir este eleitor? Esta ação não pode ser desfeita.')) return;
  try {
    await API.delete(`/eleitores/${id}`);
    Eleitores.delete(id);
    showToast('Eleitor excluído.', 'success');
    renderList();
  } catch (err) {
    showToast(err.message || 'Erro ao excluir.', 'error');
  }
}

/* ============================================================
   MODAL DE DETALHES
   ============================================================ */
function openDetailModal(e) {
  const body = document.getElementById('modal-body');
  if (!body) return;

  body.innerHTML = `
    <div style="display:flex; gap:1.4rem; align-items:flex-start; flex-wrap:wrap;">
      ${e.foto_url
        ? `<img src="${escapeHtml(e.foto_url)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--line);" alt="">`
        : `<div style="width:80px;height:80px;border-radius:50%;background:var(--navy);color:var(--gold);display:flex;align-items:center;justify-content:center;font-family:'Fraunces',serif;font-size:2rem;font-weight:700;">${escapeHtml((e.nome[0] || '?').toUpperCase())}</div>`
      }
      <div style="flex:1;">
        <div style="font-family:'Fraunces',serif;font-size:1.4rem;color:var(--navy);font-weight:600;">${escapeHtml(e.nome)}</div>
        ${e.data_nascimento ? `<div style="color:var(--muted);font-size:0.88rem;margin-top:0.2rem;">Nascimento: ${formatDate(e.data_nascimento)} (${calculateAge(e.data_nascimento)} anos)</div>` : ''}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.8rem;margin-top:1.4rem;">
      ${[
        ['Telefone', e.telefone], ['E-mail', e.email],
        ['Endereço', [e.endereco, e.numero].filter(Boolean).join(', ')],
        ['Bairro', e.bairro], ['Cidade', e.cidade],
        ['Título de Eleitor', e.titulo_eleitor], ['Seção', e.secao],
        ['Local de Votação', e.escola_votacao],
      ].filter(([, v]) => v).map(([label, value]) => `
        <div style="background:var(--cream);padding:0.6rem 0.8rem;border-radius:4px;">
          <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:0.2rem;">${escapeHtml(label)}</div>
          <div style="font-size:0.9rem;color:var(--ink);">${escapeHtml(value)}</div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('btn-modal-edit')?.setAttribute('data-edit-id', e.id);
  document.getElementById('btn-modal-delete')?.setAttribute('data-delete-id', e.id);
  document.getElementById('detail-modal').classList.add('show');
}

document.getElementById('btn-modal-edit')?.addEventListener('click', (e) => {
  const id    = parseInt(e.target.dataset.editId);
  const eleitor = Eleitores.find(id);
  if (eleitor) {
    document.getElementById('detail-modal').classList.remove('show');
    openEleitorForm(eleitor);
  }
});

document.getElementById('btn-modal-delete')?.addEventListener('click', async (e) => {
  const id = parseInt(e.target.dataset.deleteId);
  document.getElementById('detail-modal').classList.remove('show');
  await deleteEleitor(id);
});

/* ============================================================
   RELATÓRIO
   ============================================================ */
function renderReport() {
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

  const filtered = applyFilters(all, '', bairroEl?.value, cidadeEl?.value);
  const sortKey  = sortEl?.value || 'nome';
  const sorted   = [...filtered].sort((a, b) => (a[sortKey] || '').localeCompare(b[sortKey] || '', 'pt-BR'));

  // Atualizar contador
  const countEl = document.getElementById('report-count');
  if (countEl) countEl.textContent = sorted.length + (sorted.length === 1 ? ' registro' : ' registros');

  if (!sorted.length) {
    container.innerHTML = `<div class="empty"><h3>Nenhum resultado</h3><p>${all.length === 0 ? 'Cadastre eleitores para gerar relatórios.' : 'Ajuste os filtros.'}</p></div>`;
    return;
  }

  container.innerHTML = `
    <table>
      <thead><tr><th>Nome</th><th>Endereço</th><th>Nº</th><th>Bairro</th><th>Cidade</th><th>Telefone</th><th>Título</th><th>Seção</th></tr></thead>
      <tbody>
        ${sorted.map(e => `
          <tr>
            <td><strong>${escapeHtml(e.nome)}</strong></td>
            <td>${escapeHtml(e.endereco || '—')}</td>
            <td>${escapeHtml(e.numero   || '—')}</td>
            <td>${escapeHtml(e.bairro   || '—')}</td>
            <td>${escapeHtml(e.cidade   || '—')}</td>
            <td>${escapeHtml(e.telefone || '—')}</td>
            <td>${escapeHtml(e.titulo_eleitor || '—')}</td>
            <td>${escapeHtml(e.secao    || '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

[document.getElementById('report-filter-bairro'), document.getElementById('report-filter-cidade'), document.getElementById('report-sort')]
  .forEach(el => el?.addEventListener('change', renderReport));

document.getElementById('btn-print-report')?.addEventListener('click', () => window.print());

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
   USUÁRIOS
   ============================================================ */
async function renderUsers() {
  const container = document.getElementById('users-container');
  if (!container) return;
  try {
    const users = await API.get('/usuarios');
    if (!users.length) {
      container.innerHTML = '<div class="empty"><h3>Nenhum usuário cadastrado</h3></div>';
      return;
    }
    container.innerHTML = `
      <table>
        <thead><tr><th>Nome</th><th>Login</th><th>Perfil</th><th>Último Login</th><th style="text-align:right">Ações</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td><strong style="color:var(--navy)">${escapeHtml(u.nome)}</strong>${u.id === currentUser?.id ? ' <span class="badge badge-success" style="margin-left:0.4rem">você</span>' : ''}</td>
              <td><code style="font-family:monospace;background:var(--cream);padding:2px 6px;">${escapeHtml(u.login)}</code></td>
              <td>${u.tipo === 'admin' ? '<span class="badge badge-admin">Administrador</span>' : '<span class="badge badge-comum">Usuário</span>'}</td>
              <td style="font-size:0.82rem;color:var(--muted);">${u.ultimo_login ? formatDateTime(u.ultimo_login) : '—'}</td>
              <td>
                <div class="actions-cell">
                  <button class="icon-btn" data-uact="edit" data-uid="${u.id}">Editar</button>
                  <button class="icon-btn danger" data-uact="delete" data-uid="${u.id}" ${u.id === currentUser?.id ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>Excluir</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    container.querySelectorAll('[data-uact]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = parseInt(btn.dataset.uid);
        const act = btn.dataset.uact;
        if (act === 'edit') {
          const u = users.find(u => u.id === uid);
          if (u) openUserModal(u);
        }
        if (act === 'delete') {
          if (uid === currentUser?.id) { showToast('Não pode excluir seu próprio usuário.', 'error'); return; }
          if (!confirm('Excluir este usuário?')) return;
          try {
            await API.delete(`/usuarios/${uid}`);
            showToast('Usuário excluído.', 'success');
            renderUsers();
          } catch (err) { showToast(err.message, 'error'); }
        }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="empty"><h3>Erro ao carregar usuários</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function openUserModal(user) {
  document.getElementById('user-id').value    = user?.id    || '';
  document.getElementById('user-nome').value  = user?.nome  || '';
  document.getElementById('user-login').value = user?.login || '';
  document.getElementById('user-senha').value = '';
  document.getElementById('user-tipo').value  = user?.tipo  || 'comum';
  document.getElementById('user-modal-title').textContent = user ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('user-pass-hint').textContent   = user ? '(deixe em branco para manter)' : '(obrigatório)';
  document.getElementById('user-senha').required = !user;
  document.getElementById('user-modal').classList.add('show');
  setTimeout(() => document.getElementById('user-nome')?.focus(), 100);
}

document.getElementById('btn-save-user')?.addEventListener('click', () => {
  document.getElementById('user-form')?.dispatchEvent(new Event('submit'));
});

document.getElementById('user-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id   = document.getElementById('user-id')?.value;
  const data = {
    nome:  document.getElementById('user-nome').value.trim(),
    login: document.getElementById('user-login').value.trim().toLowerCase(),
    senha: document.getElementById('user-senha').value || undefined,
    tipo:  document.getElementById('user-tipo').value,
  };
  if (!id && !data.senha) { showToast('Senha é obrigatória para novos usuários.', 'error'); return; }
  try {
    if (id) {
      await API.put(`/usuarios/${id}`, data);
      showToast('Usuário atualizado.', 'success');
    } else {
      await API.post('/usuarios', data);
      showToast('Usuário criado.', 'success');
    }
    document.getElementById('user-modal').classList.remove('show');
    renderUsers();
  } catch (err) {
    showToast(err.message || 'Erro ao salvar usuário.', 'error');
  }
});

/* ============================================================
   ROBÔS — telas específicas
   ============================================================ */
function openBirthday() {
  window.GERobots?.updateBirthdayStatus();
  window.GERobots?.renderBirthdayToday();
  window.GERobots?.renderBirthdayLog();
}

function openReactivation() {
  // Delegar ao módulo de robôs
  const container = document.getElementById('reactivation-content');
  if (container && !container.innerHTML.trim()) {
    container.innerHTML = `<p style="color:var(--muted);font-size:0.9rem;">Configure o robô de reativação nas opções abaixo.</p>`;
  }
}

/* ============================================================
   MODAIS — fechar
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
   UTILITÁRIOS GLOBAIS
   ============================================================ */
function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
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
  toastEl.textContent = msg;
  toastEl.className   = `show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.className = '', 3500);
}
window.showToast     = showToast;
window.escapeHtml    = (s) => window.GESecurity?.Sanitizer?.escapeHtml(s) ?? String(s ?? '');
window.switchView    = switchView;
window.formatDate    = formatDate;
window.formatDateTime = formatDateTime;

/* ============================================================
   SINCRONIZAÇÃO COM API — carrega dados do servidor no start
   ============================================================ */
async function syncFromAPI() {
  try {
    const data = await API.get('/eleitores?pageSize=200');
    if (data.data?.length) {
      // Substituir cache local pelos dados do servidor
      localStorage.setItem('gestao_eleitores_v3', JSON.stringify(data.data));
    }
    // Se há mais páginas, carregar
    if (data.pages > 1) {
      for (let p = 2; p <= Math.min(data.pages, 5); p++) {
        const more = await API.get(`/eleitores?page=${p}&pageSize=200`);
        const current = Eleitores.all();
        const ids = new Set(current.map(e => e.id));
        more.data.filter(e => !ids.has(e.id)).forEach(e => current.push(e));
        Eleitores.save(current);
      }
    }
    renderList();
  } catch (err) {
    console.warn('Sync com API falhou — usando dados locais:', err.message);
  }
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
window.addEventListener('load', async () => {
  // Limpar rate limiter do frontend (o backend já controla isso)
  try {
    if (window.GESecurity && window.GESecurity.RateLimiter) {
      window.GESecurity.RateLimiter.reset('login');
    }
  } catch(e) {}

  const user = loadSession();
  if (user) {
    try {
      showApp(user);
      syncFromAPI().catch(() => {});
    } catch (err) {
      console.error('[LOAD] Sessão inválida, redirecionando para login:', err);
      clearSession();
      showLogin();
    }
  } else {
    showLogin();
  }

  // Inicializar módulos
  if (window.GEImport && window.GEImport.initImport) window.GEImport.initImport();
  if (window.GEWhatsApp && window.GEWhatsApp.initWhatsApp) window.GEWhatsApp.initWhatsApp();
  if (window.GERobots) {
    if (window.GERobots.startBirthdayWatcher) window.GERobots.startBirthdayWatcher();
    if (window.GERobots.startReactivationWatcher) window.GERobots.startReactivationWatcher();
  }
});

/* ============================================================
   BOTÕES DOS ROBÔS
   ============================================================ */
document.addEventListener('click', function(e) {
  if (e.target && e.target.id === 'btn-birthday-check') {
    if (window.GERobots && window.GERobots.robotCheck) {
      window.GERobots.robotCheck(true);
    }
  }
  if (e.target && e.target.id === 'btn-react-check') {
    if (window.GERobots && window.GERobots.reactivationRun) {
      window.GERobots.reactivationRun(true);
    }
  }
});

/* ============================================================
   VERIFICAÇÃO E REMOÇÃO DE DUPLICATAS
   ============================================================ */

/**
 * Normaliza string para comparação (remove acentos, espaços extras, minúsculas)
 */
function normalizeStr(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Normaliza telefone para comparação (só dígitos)
 */
function normalizePhone(s) {
  if (!s) return '';
  return String(s).replace(/\D/g, '');
}

/**
 * Calcula similaridade entre dois nomes (0–1)
 * Considera duplicata se >= 0.85
 */
function nameSimilarity(a, b) {
  a = normalizeStr(a);
  b = normalizeStr(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Verifica se um contém o outro
  if (a.includes(b) || b.includes(a)) return 0.9;
  // Levenshtein simplificado
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 5) return 0;
  var dp = Array.from({length: la + 1}, (_, i) => [i]);
  for (var j = 1; j <= lb; j++) dp[0][j] = j;
  for (var i = 1; i <= la; i++) {
    for (var j = 1; j <= lb; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  var dist = dp[la][lb];
  var maxLen = Math.max(la, lb);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

/**
 * Detecta grupos de duplicatas entre os eleitores
 * Critérios (qualquer um suficiente):
 *   - Nome muito similar (>= 85%) E mesma cidade/bairro
 *   - Mesmo telefone (sem dígitos iguais)
 *   - Nome idêntico + mesmo endereço
 */
function detectDuplicates(eleitores) {
  var groups = [];
  var visited = new Set();

  for (var i = 0; i < eleitores.length; i++) {
    if (visited.has(i)) continue;
    var group = [eleitores[i]];
    var groupIdx = [i];

    for (var j = i + 1; j < eleitores.length; j++) {
      if (visited.has(j)) continue;
      var a = eleitores[i], b = eleitores[j];

      var isDup = false;
      var motivo = '';

      // 1. Mesmo telefone (com mínimo de 8 dígitos)
      var telA = normalizePhone(a.telefone);
      var telB = normalizePhone(b.telefone);
      if (telA.length >= 8 && telA === telB) {
        isDup = true;
        motivo = 'Mesmo telefone';
      }

      // 2. Nome muito similar + mesma localidade
      if (!isDup) {
        var sim = nameSimilarity(a.nome, b.nome);
        if (sim >= 0.85) {
          var cidadeA = normalizeStr(a.cidade), cidadeB = normalizeStr(b.cidade);
          var bairroA = normalizeStr(a.bairro), bairroB = normalizeStr(b.bairro);
          if ((cidadeA && cidadeA === cidadeB) || (bairroA && bairroA === bairroB)) {
            isDup = true;
            motivo = 'Nome similar (' + Math.round(sim * 100) + '%) + mesma localidade';
          }
          // Nome idêntico sem localidade
          if (!isDup && sim === 1) {
            isDup = true;
            motivo = 'Nome idêntico';
          }
        }
      }

      // 3. Mesmo endereço + nome similar
      if (!isDup) {
        var endA = normalizeStr((a.endereco || '') + (a.numero || '') + (a.cidade || ''));
        var endB = normalizeStr((b.endereco || '') + (b.numero || '') + (b.cidade || ''));
        if (endA.length > 5 && endA === endB && nameSimilarity(a.nome, b.nome) >= 0.7) {
          isDup = true;
          motivo = 'Mesmo endereço + nome similar';
        }
      }

      if (isDup) {
        group.push({ ...b, _motivo: motivo });
        groupIdx.push(j);
        visited.add(j);
      }
    }

    if (group.length > 1) {
      visited.add(i);
      groups.push(group);
    }
  }

  return groups;
}

/**
 * Escolhe qual registro manter (o mais completo)
 */
function chooseBest(group) {
  return group.reduce(function(best, curr) {
    var scoreA = [best.telefone, best.email, best.endereco, best.titulo_eleitor, best.bairro, best.cidade]
      .filter(Boolean).length;
    var scoreB = [curr.telefone, curr.email, curr.endereco, curr.titulo_eleitor, curr.bairro, curr.cidade]
      .filter(Boolean).length;
    return scoreB > scoreA ? curr : best;
  });
}

/**
 * Renderiza o modal de duplicatas
 */
function renderDuplicatesModal(groups) {
  var body   = document.getElementById('dup-modal-body');
  var footer = document.getElementById('dup-modal-footer');

  if (!body) return;

  if (!groups.length) {
    body.innerHTML = [
      '<div class="empty" style="padding:3rem;">',
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:48px;height:48px;color:var(--success);margin-bottom:1rem;">',
      '<polyline points="20 6 9 17 4 12"/></svg>',
      '<h3 style="color:var(--success)">Nenhuma duplicata encontrada!</h3>',
      '<p>Todos os cadastros parecem únicos.</p>',
      '</div>'
    ].join('');
    footer.innerHTML = '<button class="btn btn-secondary" data-close="dup-modal">Fechar</button>';
    return;
  }

  var totalToRemove = groups.reduce(function(t, g) { return t + g.length - 1; }, 0);

  var html = [
    '<div style="padding:1rem 2rem; border-bottom:1px solid var(--line); background:var(--danger-soft); display:flex; align-items:center; justify-content:space-between;">',
    '<div>',
    '<strong style="color:var(--danger);">' + groups.length + ' grupo(s) de duplicatas</strong>',
    '<span style="color:var(--muted); font-size:0.82rem; margin-left:0.8rem;">' + totalToRemove + ' registro(s) serão removidos — o mais completo de cada grupo será mantido</span>',
    '</div>',
    '</div>'
  ].join('');

  groups.forEach(function(group, gi) {
    var best = chooseBest(group);
    html += '<div class="dup-item">';
    html += '<div class="dup-group-header">';
    html += '<span class="dup-group-label">Grupo ' + (gi+1) + ' — ' + (group[1]._motivo || 'duplicata') + '</span>';
    html += '<span style="font-size:0.78rem; color:var(--muted);">' + group.length + ' registros</span>';
    html += '</div>';
    html += '<table class="dup-table"><thead><tr>';
    html += '<th></th><th>Nome</th><th>Telefone</th><th>Endereço</th><th>Bairro/Cidade</th><th>Dados</th>';
    html += '</tr></thead><tbody>';

    group.forEach(function(e) {
      var isKeep   = e.id === best.id;
      var rowClass = isKeep ? 'dup-keep' : 'dup-remove';
      var score    = [e.telefone, e.email, e.endereco, e.titulo_eleitor].filter(Boolean).length;
      var end      = [e.endereco, e.numero].filter(Boolean).join(', ') || '—';
      var loc      = [e.bairro, e.cidade].filter(Boolean).join(' / ') || '—';
      html += '<tr class="' + rowClass + '">';
      html += '<td>' + (isKeep
        ? '<span class="badge badge-success" style="white-space:nowrap">✓ manter</span>'
        : '<span class="badge" style="background:var(--danger-soft);color:var(--danger);white-space:nowrap">✗ remover</span>') + '</td>';
      html += '<td><strong>' + window.escapeHtml(e.nome || '—') + '</strong></td>';
      html += '<td>' + window.escapeHtml(e.telefone || '—') + '</td>';
      html += '<td>' + window.escapeHtml(end) + '</td>';
      html += '<td>' + window.escapeHtml(loc) + '</td>';
      html += '<td style="font-size:0.78rem; color:var(--muted);">' + score + '/4 campos</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';
  });

  body.innerHTML = html;

  // Footer com botão de remover
  footer.innerHTML = [
    '<span style="font-size:0.82rem; color:var(--muted); margin-right:auto;">' + totalToRemove + ' registro(s) serão excluídos permanentemente</span>',
    '<button class="btn btn-secondary" data-close="dup-modal">Cancelar</button>',
    '<button class="btn btn-danger" id="btn-confirm-remove-dup">',
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:15px;height:15px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    'Remover ' + totalToRemove + ' Duplicata(s)',
    '</button>'
  ].join('');

  // Listener do botão de confirmar remoção
  document.getElementById('btn-confirm-remove-dup').addEventListener('click', async function() {
    if (!confirm('Remover ' + totalToRemove + ' registro(s) duplicado(s)? Esta ação não pode ser desfeita.')) return;
    
    var btn = this;
    btn.disabled = true;
    btn.textContent = 'Removendo...';

    var removed = 0;
    var errors  = 0;

    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      var best  = chooseBest(group);

      for (var ei = 0; ei < group.length; ei++) {
        var e = group[ei];
        if (e.id === best.id) continue;

        try {
          // Tentar remover via API
          var token = sessionStorage.getItem('ge_jwt_token');
          if (token) {
            var res = await fetch('/api/eleitores/' + e.id, {
              method: 'DELETE',
              headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!res.ok) throw new Error('API error');
          }
          // Remover do localStorage também
          window.Eleitores.delete(e.id);
          removed++;
        } catch (err) {
          // Se API falhar, só remove localmente
          window.Eleitores.delete(e.id);
          removed++;
        }
      }
    }

    document.getElementById('dup-modal').classList.remove('show');
    window.showToast && window.showToast(removed + ' duplicata(s) removida(s) com sucesso!', 'success');
    renderList();
  });
}

// Listener do botão de verificar duplicatas
document.getElementById('btn-check-duplicates') && document.getElementById('btn-check-duplicates').addEventListener('click', function() {
  var modal = document.getElementById('dup-modal');
  if (!modal) return;

  // Mostrar modal com loading
  document.getElementById('dup-modal-body').innerHTML = [
    '<div class="empty" style="padding:3rem;">',
    '<div class="spinner" style="width:32px;height:32px;margin:0 auto 1rem;"></div>',
    '<p style="color:var(--muted);">Analisando ' + (window.Eleitores ? window.Eleitores.all().length : 0) + ' registros...</p>',
    '</div>'
  ].join('');
  document.getElementById('dup-modal-footer').innerHTML = '<button class="btn btn-secondary" data-close="dup-modal">Fechar</button>';
  modal.classList.add('show');

  // Detectar duplicatas de forma assíncrona (não trava a UI)
  setTimeout(function() {
    var eleitores = window.Eleitores ? window.Eleitores.all() : [];
    var groups    = detectDuplicates(eleitores);
    renderDuplicatesModal(groups);
  }, 100);
});
