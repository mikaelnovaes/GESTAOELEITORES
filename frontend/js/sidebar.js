/**
 * frontend/js/sidebar.js
 *
 * Sidebar retrátil com:
 *  - Toggle expandido/recolhido (Ctrl+B / Cmd+B)
 *  - Tooltips inteligentes no estado recolhido
 *  - Submenus inline (expandido) ou flutuantes (recolhido)
 *  - Busca rápida (⌘K / Ctrl+K)
 *  - Badges contadores dinâmicos
 *  - Modo mobile (drawer)
 *  - Preferência salva em localStorage
 */

'use strict';

(function () {

  const STORAGE_KEY = 'ge_sidebar_expanded';
  let sidebarEl = null;
  let tooltipEl = null;
  let isMobile = false;

  /* ════════════════════════════════════════════════════════════
     ESTRUTURA DE MENUS (refletindo o sistema atual)
     ════════════════════════════════════════════════════════════ */
  const MENU = [
    { section: 'PRINCIPAL' },
    {
      view: 'dashboard',
      icon: '📊',
      label: 'Dashboard',
      tip: 'Visão geral analítica',
    },
    {
      icon: '👥',
      label: 'Eleitores',
      tip: 'Cadastros e padronização',
      badgeKey: 'bairros_pendentes', // dinâmico
      subitems: [
        { view: 'list', label: 'Todos os Eleitores', badgeKey: 'total_eleitores' },
        { view: 'new', label: '+ Novo Cadastro' },
        { view: 'import', label: 'Importar Excel' },
        { view: 'verificar-bairros', label: '🔍 Verificar Bairros', badgeKey: 'bairros_pendentes' },
        { divider: true },
        { view: 'reports', label: 'Relatórios' },
      ],
    },
    {
      icon: '⭐',
      label: 'Lideranças',
      tip: 'Gerenciamento de lideranças',
      subitems: [
        { view: 'liderancas', label: 'Lista de Lideranças' },
        { view: 'liderancas-report', label: 'Relatório' },
      ],
    },
    {
      view: 'mapa',
      icon: '🗺️',
      label: 'Mapa Eleitoral',
      tip: 'Heatmap geográfico',
    },
    {
      view: 'agenda',
      icon: '📅',
      label: 'Agenda',
      tip: 'Eventos e compromissos',
      badgeKey: 'eventos_proximos',
      badgeMuted: true,
    },

    { section: 'COMUNICAÇÃO' },
    {
      icon: '💬',
      label: 'WhatsApp',
      tip: 'Envios e disparos',
      subitems: [
        { view: 'whatsapp-send', label: 'Enviar Mensagem' },
        { view: 'disparo', label: 'Disparo Segmentado' },
        { view: 'whatsapp-log', label: 'Histórico' },
        { divider: true, adminOnly: true },
        { view: 'whatsapp-config', label: 'Configurar API', adminOnly: true },
      ],
    },
    {
      icon: '🎯',
      label: 'Estratégia',
      tip: 'Projeções e simulações',
      subitems: [
        { view: 'projecao', label: 'Projeção de Votos' },
        { view: 'elections-calc', label: 'Calculadora Eleitoral', adminOnly: true },
      ],
    },
    {
      icon: '🏷️',
      label: 'Etiquetas',
      tip: 'Gerar e visualizar',
      subitems: [
        { view: 'etiquetas-gerar', label: 'Gerar Etiquetas' },
        { view: 'etiquetas-historico', label: 'Visualizar Etiquetas' },
      ],
    },

    { section: 'AUTOMAÇÃO' },
    {
      icon: '🤖',
      label: 'Robôs',
      tip: 'Automações de WhatsApp',
      subitems: [
        { view: 'robots', label: 'Central de Robôs' },
        { view: 'birthday', label: 'Aniversários' },
        { view: 'reactivation', label: 'Reativação' },
      ],
    },
    {
      icon: '⚙️',
      label: 'Admin',
      tip: 'Configurações',
      adminOnly: true,
      subitems: [
        { view: 'users', label: 'Usuários' },
      ],
    },
  ];

  /* ════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════ */
  function buildSidebar() {
    const sidebar = document.createElement('aside');
    sidebar.className = 'app-sidebar';
    sidebar.id = 'app-sidebar';

    sidebar.innerHTML = `
      <div class="sb-header">
        <div class="sb-logo">
          <div class="sb-logo-mark">G</div>
          <div class="sb-logo-text">Gestão de<br>Eleitores</div>
        </div>
        <button class="sb-toggle" id="sb-toggle" title="Recolher / Expandir (Ctrl+B)" aria-label="Alternar sidebar">»</button>
      </div>

      <div class="sb-search">
        <input type="text" id="sb-search-input" placeholder="🔍 Buscar menu... (Ctrl+K)" autocomplete="off">
      </div>

      <nav class="sb-nav" id="sb-nav"></nav>

      <div class="sb-footer">
        <div class="sb-avatar" id="sb-avatar">A</div>
        <div class="sb-user-info">
          <div class="sb-user-name" id="sb-user-name">Carregando...</div>
          <div class="sb-user-role" id="sb-user-role">—</div>
        </div>
        <button class="sb-logout" id="sb-logout">Sair</button>
      </div>
    `;

    // Botão hamburger e overlay para mobile
    const mobileToggle = document.createElement('button');
    mobileToggle.className = 'sb-mobile-toggle';
    mobileToggle.id = 'sb-mobile-toggle';
    mobileToggle.innerHTML = '☰';
    mobileToggle.setAttribute('aria-label', 'Abrir menu');

    const overlay = document.createElement('div');
    overlay.className = 'sb-overlay';
    overlay.id = 'sb-overlay';

    return { sidebar, mobileToggle, overlay };
  }

  function renderMenuItems() {
    const nav = document.getElementById('sb-nav');
    if (!nav) return;

    const isAdmin = window.currentUser?.tipo === 'admin' || window.currentUser?.tipo === 'master';
    let html = '';

    MENU.forEach((item, idx) => {
      if (item.section) {
        html += `<div class="sb-section-label">${item.section}</div>`;
        return;
      }
      if (item.adminOnly && !isAdmin) return;

      const hasSubmenu = item.subitems && item.subitems.length > 0;
      const badgeHtml = item.badgeKey
        ? `<span class="sb-badge ${item.badgeMuted ? 'muted' : ''}" data-badge="${item.badgeKey}" style="display:none">0</span>`
        : '';

      html += `
        <div class="sb-item" data-idx="${idx}" ${item.tip ? `data-tip="${esc(item.tip)}"` : ''}>
          <button class="sb-item-link" ${item.view ? `data-view="${item.view}"` : ''}>
            <span class="sb-item-icon">${item.icon}</span>
            <span class="sb-item-text">${esc(item.label)}</span>
            ${badgeHtml}
            ${hasSubmenu ? '<span class="sb-item-chevron">▼</span>' : ''}
          </button>
          ${hasSubmenu ? `<ul class="sb-submenu">
            ${item.subitems.filter(s => !s.adminOnly || isAdmin).map(s => {
              if (s.divider) return '<div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 8px;"></div>';
              const sbadge = s.badgeKey ? `<span class="sb-badge muted" data-badge="${s.badgeKey}" style="display:none;">0</span>` : '';
              return `<li><button class="sb-subitem" data-view="${s.view}">
                <span>${esc(s.label)}</span>
                ${sbadge}
              </button></li>`;
            }).join('')}
          </ul>` : ''}
        </div>
      `;
    });

    nav.innerHTML = html;
    bindItems();
  }

  /* ════════════════════════════════════════════════════════════
     BINDS
     ════════════════════════════════════════════════════════════ */
  function bindItems() {
    // Clique em item com submenu → expande/colapsa
    document.querySelectorAll('.sb-item').forEach(item => {
      const link = item.querySelector('.sb-item-link');
      const view = link?.dataset.view;
      const hasSubmenu = item.querySelector('.sb-submenu');

      link?.addEventListener('click', (e) => {
        e.preventDefault();
        if (hasSubmenu) {
          // Fecha outros
          document.querySelectorAll('.sb-item.open').forEach(o => {
            if (o !== item) o.classList.remove('open');
          });
          item.classList.toggle('open');
        } else if (view && window.switchView) {
          window.switchView(view);
          setActive(view);
          if (isMobile) closeSidebarMobile();
        }
      });

      // Tooltip no hover (só quando recolhido)
      link?.addEventListener('mouseenter', (e) => {
        if (sidebarEl?.classList.contains('expanded') || isMobile) return;
        const tip = item.dataset.tip || link.querySelector('.sb-item-text')?.textContent;
        showTooltip(link, tip);
      });
      link?.addEventListener('mouseleave', hideTooltip);

      // Posicionar submenu flutuante (quando recolhido)
      if (hasSubmenu) {
        link?.addEventListener('mouseenter', () => {
          if (!sidebarEl.classList.contains('expanded') && !isMobile) {
            const submenu = item.querySelector('.sb-submenu');
            const rect = item.getBoundingClientRect();
            submenu.style.top = rect.top + 'px';
          }
        });
      }
    });

    // Subitens
    document.querySelectorAll('.sb-subitem').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const view = btn.dataset.view;
        if (view === 'verificar-bairros') {
          // Caso especial: abre o modal de bairros
          window.GEBairros?.abrirVerificacao();
          // Mantém na view de eleitores
          if (window.switchView) window.switchView('list');
          setActive('list');
        } else if (view && window.switchView) {
          window.switchView(view);
          setActive(view);
        }
        // Fecha o submenu pai
        btn.closest('.sb-item')?.classList.remove('open');
        if (isMobile) closeSidebarMobile();
      });
    });

    // Botão toggle
    document.getElementById('sb-toggle')?.addEventListener('click', toggleSidebar);

    // Botão mobile
    document.getElementById('sb-mobile-toggle')?.addEventListener('click', openSidebarMobile);
    document.getElementById('sb-overlay')?.addEventListener('click', closeSidebarMobile);

    // Logout
    document.getElementById('sb-logout')?.addEventListener('click', () => {
      if (typeof window.logout === 'function') window.logout();
      else {
        sessionStorage.clear();
        location.reload();
      }
    });

    // Busca rápida
    const search = document.getElementById('sb-search-input');
    search?.addEventListener('input', handleSearch);
    search?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const first = document.querySelector('.sb-item:not([style*="display: none"]) .sb-item-link[data-view]');
        if (first) first.click();
      }
      if (e.key === 'Escape') {
        search.value = '';
        handleSearch({ target: search });
        search.blur();
      }
    });
  }

  /* ════════════════════════════════════════════════════════════
     TOOLTIP
     ════════════════════════════════════════════════════════════ */
  function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'sb-tooltip';
    tooltipEl.id = 'sb-tooltip';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showTooltip(anchor, text) {
    if (!text) return;
    const t = ensureTooltip();
    const rect = anchor.getBoundingClientRect();

    // Pega badge dinâmico se existir
    const item = anchor.closest('.sb-item');
    const badge = item?.querySelector('.sb-badge[data-badge]');
    const badgeVisible = badge && badge.style.display !== 'none';
    const badgeText = badgeVisible ? badge.textContent : null;

    let html = esc(text);
    if (badgeText) {
      html += `<div class="sb-tooltip-sub">${badgeText} pendência${parseInt(badgeText) !== 1 ? 's' : ''}</div>`;
    }
    t.innerHTML = html;
    t.style.left = (rect.right + 8) + 'px';
    t.style.top = (rect.top + rect.height / 2) + 'px';
    t.classList.add('show');
  }

  function hideTooltip() {
    tooltipEl?.classList.remove('show');
  }

  /* ════════════════════════════════════════════════════════════
     BUSCA
     ════════════════════════════════════════════════════════════ */
  function handleSearch(ev) {
    const q = (ev.target.value || '').toLowerCase().trim();
    document.querySelectorAll('.sb-item').forEach(item => {
      if (item.querySelector('.sb-section-label')) return;
      const txt = item.querySelector('.sb-item-text')?.textContent.toLowerCase() || '';
      const subTexts = [...item.querySelectorAll('.sb-subitem')].map(s => s.textContent.toLowerCase()).join(' ');
      const match = !q || txt.includes(q) || subTexts.includes(q);
      item.style.display = match ? '' : 'none';
      if (match && q && subTexts.includes(q)) {
        item.classList.add('open');
      }
    });
    document.querySelectorAll('.sb-section-label').forEach(label => {
      // esconde labels de seção se todos os items estiverem ocultos
      let next = label.nextElementSibling;
      let anyVisible = false;
      while (next && !next.classList.contains('sb-section-label')) {
        if (next.style.display !== 'none') anyVisible = true;
        next = next.nextElementSibling;
      }
      label.style.display = anyVisible || !q ? '' : 'none';
    });
  }

  /* ════════════════════════════════════════════════════════════
     TOGGLE EXPANDIDO / RECOLHIDO
     ════════════════════════════════════════════════════════════ */
  function toggleSidebar() {
    if (isMobile) {
      sidebarEl.classList.contains('expanded') ? closeSidebarMobile() : openSidebarMobile();
      return;
    }
    const wasExpanded = sidebarEl.classList.contains('expanded');
    sidebarEl.classList.toggle('expanded');
    document.getElementById('sb-toggle').textContent = wasExpanded ? '»' : '«';
    localStorage.setItem(STORAGE_KEY, !wasExpanded ? '1' : '0');

    // Fecha submenus abertos
    if (wasExpanded) {
      document.querySelectorAll('.sb-item.open').forEach(o => o.classList.remove('open'));
    }
    hideTooltip();
  }

  function openSidebarMobile() {
    sidebarEl.classList.add('expanded');
    document.getElementById('sb-overlay').style.display = 'block';
  }
  function closeSidebarMobile() {
    sidebarEl.classList.remove('expanded');
    const ov = document.getElementById('sb-overlay');
    if (ov) ov.style.display = 'none';
  }

  function restorePreference() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === '1' && !isMobile) {
      sidebarEl.classList.add('expanded');
      document.getElementById('sb-toggle').textContent = '«';
    } else {
      document.getElementById('sb-toggle').textContent = '»';
    }
  }

  /* ════════════════════════════════════════════════════════════
     ACTIVE STATE — sincroniza com a view atual
     ════════════════════════════════════════════════════════════ */
  function setActive(viewName) {
    document.querySelectorAll('.sb-item, .sb-subitem').forEach(el => el.classList.remove('active'));
    // Procura no nível principal
    const direto = document.querySelector(`.sb-item-link[data-view="${viewName}"]`);
    if (direto) {
      direto.closest('.sb-item').classList.add('active');
      return;
    }
    // Procura nos subitems
    const sub = document.querySelector(`.sb-subitem[data-view="${viewName}"]`);
    if (sub) {
      sub.classList.add('active');
      sub.closest('.sb-item')?.classList.add('active');
    }
  }

  /* ════════════════════════════════════════════════════════════
     BADGES DINÂMICOS — carrega do backend
     ════════════════════════════════════════════════════════════ */
  async function loadBadges() {
    try {
      // 1. Bairros pendentes (variantes para padronizar)
      try {
        const r = await window.API?.get('/bairros/duplicados');
        const total = r?.total_grupos || 0;
        if (total > 0) setBadge('bairros_pendentes', total);
      } catch {}

      // 2. Total de eleitores
      try {
        const r = await window.API?.get('/eleitores?pageSize=1');
        const total = r?.total || 0;
        if (total > 0) setBadge('total_eleitores', total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total);
      } catch {}

      // 3. Eventos próximos
      try {
        const r = await window.API?.get('/agenda/proximos');
        const total = Array.isArray(r) ? r.length : 0;
        if (total > 0) setBadge('eventos_proximos', total);
      } catch {}
    } catch (err) {
      console.warn('[SIDEBAR] loadBadges:', err);
    }
  }

  function setBadge(key, value) {
    document.querySelectorAll(`.sb-badge[data-badge="${key}"]`).forEach(el => {
      el.textContent = value;
      el.style.display = '';
    });
  }

  /* ════════════════════════════════════════════════════════════
     USUÁRIO
     ════════════════════════════════════════════════════════════ */
  function updateUser() {
    const u = window.currentUser;
    if (!u) return;
    const nameEl = document.getElementById('sb-user-name');
    const roleEl = document.getElementById('sb-user-role');
    const avatarEl = document.getElementById('sb-avatar');

    if (nameEl) nameEl.textContent = u.nome || u.login || 'Usuário';
    if (roleEl) {
      const tipo = (u.tipo || '').toUpperCase();
      const acting = sessionStorage.getItem('ge_acting_tenant_nome');
      roleEl.textContent = acting ? `${tipo} · ${acting}` : tipo;
    }
    if (avatarEl) {
      const inicial = (u.nome || u.login || '?')[0].toUpperCase();
      avatarEl.textContent = inicial;
    }
  }

  /* ════════════════════════════════════════════════════════════
     ATALHOS DE TECLADO
     ════════════════════════════════════════════════════════════ */
  function bindShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+B / Cmd+B → toggle
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
      // Ctrl+K / Cmd+K → foca na busca
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (!sidebarEl.classList.contains('expanded') && !isMobile) toggleSidebar();
        document.getElementById('sb-search-input')?.focus();
      }
    });
  }

  /* ════════════════════════════════════════════════════════════
     RESPONSIVE
     ════════════════════════════════════════════════════════════ */
  function checkMobile() {
    isMobile = window.innerWidth <= 900;
  }

  /* ════════════════════════════════════════════════════════════
     UTILS + INIT
     ════════════════════════════════════════════════════════════ */
  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function init() {
    // Injeta a sidebar no app-wrapper
    const wrapper = document.getElementById('app');
    if (!wrapper) {
      console.error('[SIDEBAR] #app não encontrado');
      return;
    }

    const { sidebar, mobileToggle, overlay } = buildSidebar();

    // Insere sidebar como PRIMEIRO filho do app-wrapper
    wrapper.insertBefore(sidebar, wrapper.firstChild);
    document.body.appendChild(mobileToggle);
    document.body.appendChild(overlay);

    sidebarEl = sidebar;

    checkMobile();
    renderMenuItems();
    restorePreference();
    bindShortcuts();
    updateUser();

    // Carrega badges após pequeno delay (espera tudo montar)
    setTimeout(loadBadges, 1500);

    // Re-renderiza se o user mudar (login)
    window.addEventListener('ge:user-changed', () => {
      renderMenuItems();
      updateUser();
      loadBadges();
    });

    // Recarrega badges quando voltar pra view de eleitores ou dashboard
    const origSwitch = window.switchView;
    if (typeof origSwitch === 'function') {
      window.switchView = function(view) {
        const r = origSwitch.apply(this, arguments);
        setActive(view);
        // Recarrega badges em mudanças relevantes
        if (['dashboard', 'list', 'agenda'].includes(view)) {
          setTimeout(loadBadges, 500);
        }
        return r;
      };
    }

    window.addEventListener('resize', () => {
      const wasMobile = isMobile;
      checkMobile();
      if (wasMobile !== isMobile) {
        // Reset estado ao mudar de modo
        sidebarEl.classList.remove('expanded');
        const ov = document.getElementById('sb-overlay');
        if (ov) ov.style.display = 'none';
        restorePreference();
      }
    });

    console.log('[SIDEBAR] Carregada com fonte Geist 🚀');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GESidebar = {
    setActive,
    loadBadges,
    toggle: toggleSidebar,
  };

})();
