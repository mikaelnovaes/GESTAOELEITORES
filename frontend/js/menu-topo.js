/**
 * frontend/js/menu-topo.js
 * Controla o menu horizontal:
 *   - Abre/fecha dropdowns ao clicar
 *   - Fecha ao clicar fora ou em um item
 *   - Marca item ativo
 *   - Toggle mobile
 *   - Sincroniza com switchView e com o footer de usuário (que sumiu)
 */

'use strict';

(function () {

  function init() {
    const navbar = document.getElementById('navbar-top');
    if (!navbar) return;

    // ── ABRE/FECHA DROPDOWN ao clicar no link com data-dropdown ──
    navbar.querySelectorAll('[data-dropdown] > .navbar-link').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const item = btn.parentElement;
        const jaAberto = item.classList.contains('open');
        // Fecha todos os outros
        navbar.querySelectorAll('.navbar-item.open').forEach(i => i.classList.remove('open'));
        if (!jaAberto) item.classList.add('open');
      });
    });

    // ── CLIQUE NUM ITEM DO DROPDOWN ou link direto ──
    navbar.addEventListener('click', (ev) => {
      const target = ev.target.closest('[data-view]');
      if (!target) return;
      const view = target.dataset.view;
      if (view && typeof window.switchView === 'function') {
        window.switchView(view);
      }
      // Marca ativo
      navbar.querySelectorAll('.navbar-link.active, .navbar-dropdown-item.active')
        .forEach(el => el.classList.remove('active'));
      target.classList.add('active');
      // Se for item de dropdown, marca o parent link também
      const parentItem = target.closest('.navbar-item[data-dropdown]');
      if (parentItem) parentItem.querySelector('.navbar-link')?.classList.add('active');
      // Fecha todos os dropdowns abertos
      navbar.querySelectorAll('.navbar-item.open').forEach(i => i.classList.remove('open'));
      // Fecha menu mobile
      navbar.classList.remove('mobile-open');
    });

    // ── FECHAR DROPDOWNS ao clicar fora ──
    document.addEventListener('click', (ev) => {
      if (!navbar.contains(ev.target)) {
        navbar.querySelectorAll('.navbar-item.open').forEach(i => i.classList.remove('open'));
      }
    });

    // ── ESC fecha dropdowns ──
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        navbar.querySelectorAll('.navbar-item.open').forEach(i => i.classList.remove('open'));
        navbar.classList.remove('mobile-open');
      }
    });

    // ── MOBILE TOGGLE ──
    document.getElementById('navbar-toggle')?.addEventListener('click', (ev) => {
      ev.stopPropagation();
      navbar.classList.toggle('mobile-open');
    });

    // ── LOGOUT — redireciona para o botão antigo do sidebar ──
    document.getElementById('navbar-logout-btn')?.addEventListener('click', () => {
      const oldBtn = document.getElementById('logout-btn');
      if (oldBtn) oldBtn.click();
    });

    // ── SINCRONIZAR USUÁRIO no header da navbar ──
    syncUserInfo();
    // Observa mudanças no footer antigo (caso ainda exista no DOM)
    setInterval(syncUserInfo, 2000);
  }

  function syncUserInfo() {
    const oldName = document.getElementById('footer-user-name')?.textContent;
    const oldRole = document.getElementById('footer-user-role')?.textContent;
    if (oldName) {
      const newName = document.getElementById('navbar-user-name');
      if (newName && newName.textContent !== oldName) newName.textContent = oldName;
    }
    if (oldRole) {
      const newRole = document.getElementById('navbar-user-role');
      if (newRole && newRole.textContent !== oldRole) newRole.textContent = oldRole;
    }
  }

  // Espera DOM carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
