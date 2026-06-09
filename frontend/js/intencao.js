/**
 * frontend/js/intencao.js v1
 *
 * Gerencia o campo "Intenção de Voto" dos eleitores.
 * Permite registrar/alterar direto na lista de eleitores
 * (sem precisar abrir o modal de edição completo).
 *
 * Expõe: window.GEIntencao = { renderBadge, openQuickEdit, refreshDashboard }
 */

'use strict';

(function () {

  const OPCOES = [
    { valor: 'confirmado', label: 'Confirmado', emoji: '✅', cor: '#16a34a', bg: '#dcfce7' },
    { valor: 'provavel',   label: 'Provável',   emoji: '🟢', cor: '#15803d', bg: '#f0fdf4' },
    { valor: 'indeciso',   label: 'Indeciso',   emoji: '🟡', cor: '#ca8a04', bg: '#fefce8' },
    { valor: 'risco',      label: 'Em Risco',   emoji: '🔴', cor: '#dc2626', bg: '#fef2f2' },
  ];

  /* ════════════════════════════════════════════════
     1) BADGE INLINE — renderiza na lista de eleitores
  ════════════════════════════════════════════════ */
  function renderBadge(intencaoVoto, eleitorId) {
    const op = OPCOES.find(o => o.valor === intencaoVoto);
    if (op) {
      return `
        <button
          class="intencao-badge"
          data-eleitor-id="${eleitorId}"
          data-intencao="${op.valor}"
          title="Clique para alterar: ${op.label}"
          style="
            background:${op.bg};
            color:${op.cor};
            border:1px solid ${op.cor}40;
            padding:2px 8px;
            border-radius:99px;
            font-size:0.72rem;
            font-weight:600;
            cursor:pointer;
            white-space:nowrap;
            font-family:inherit;
          ">
          ${op.emoji} ${op.label}
        </button>`;
    }
    // Sem intenção registrada
    return `
      <button
        class="intencao-badge intencao-vazia"
        data-eleitor-id="${eleitorId}"
        data-intencao=""
        title="Clique para registrar intenção de voto"
        style="
          background:#f3f4f6;
          color:#9ca3af;
          border:1px dashed #d1d5db;
          padding:2px 8px;
          border-radius:99px;
          font-size:0.72rem;
          cursor:pointer;
          white-space:nowrap;
          font-family:inherit;
        ">
        ⬜ Registrar
      </button>`;
  }

  /* ════════════════════════════════════════════════
     2) QUICK EDIT — popup inline ao clicar no badge
  ════════════════════════════════════════════════ */
  function openQuickEdit(eleitorId, intencaoAtual, btnElement) {
    // Remove popup anterior se existir
    document.getElementById('intencao-popup')?.remove();

    const popup = document.createElement('div');
    popup.id = 'intencao-popup';
    popup.style.cssText = `
      position: fixed;
      background: #fff;
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      z-index: 9999;
      padding: 0.5rem;
      min-width: 180px;
      font-family: 'Geist', sans-serif;
    `;

    // Posiciona próximo ao botão clicado
    const rect = btnElement.getBoundingClientRect();
    popup.style.top = (rect.bottom + 4) + 'px';
    popup.style.left = Math.max(4, rect.left - 20) + 'px';

    const titulo = document.createElement('div');
    titulo.style.cssText = 'font-size:0.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;padding:0.3rem 0.5rem 0.5rem;border-bottom:1px solid var(--line);margin-bottom:0.3rem;';
    titulo.textContent = 'Intenção de Voto';
    popup.appendChild(titulo);

    // Opção "Limpar"
    const limpar = criarOpcaoPopup('', '⬜', 'Sem registro', '#6b7280', '#f9fafb', intencaoAtual === null || intencaoAtual === '');
    limpar.addEventListener('click', () => salvarIntencao(eleitorId, null, btnElement));
    popup.appendChild(limpar);

    OPCOES.forEach(op => {
      const el = criarOpcaoPopup(op.valor, op.emoji, op.label, op.cor, op.bg, intencaoAtual === op.valor);
      el.addEventListener('click', () => salvarIntencao(eleitorId, op.valor, btnElement));
      popup.appendChild(el);
    });

    document.body.appendChild(popup);

    // Fecha ao clicar fora
    setTimeout(() => {
      document.addEventListener('click', function fechar(e) {
        if (!popup.contains(e.target)) {
          popup.remove();
          document.removeEventListener('click', fechar);
        }
      });
    }, 100);
  }

  function criarOpcaoPopup(valor, emoji, label, cor, bg, selecionado) {
    const el = document.createElement('button');
    el.dataset.valor = valor;
    el.style.cssText = `
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      background: ${selecionado ? bg : 'transparent'};
      border: none;
      border-radius: 5px;
      padding: 0.4rem 0.6rem;
      cursor: pointer;
      font-size: 0.84rem;
      font-weight: ${selecionado ? '600' : '400'};
      color: ${selecionado ? cor : 'var(--ink)'};
      text-align: left;
      font-family: inherit;
    `;
    el.innerHTML = `<span>${emoji}</span><span>${label}</span>${selecionado ? '<span style="margin-left:auto;font-size:0.7rem;">✓</span>' : ''}`;
    el.addEventListener('mouseover', () => { el.style.background = bg; el.style.color = cor; });
    el.addEventListener('mouseout', () => {
      el.style.background = selecionado ? bg : 'transparent';
      el.style.color = selecionado ? cor : 'var(--ink)';
    });
    return el;
  }

  /* ════════════════════════════════════════════════
     3) SALVAR — via API PUT /eleitores/:id
  ════════════════════════════════════════════════ */
  async function salvarIntencao(eleitorId, novaIntencao, btnElement) {
    document.getElementById('intencao-popup')?.remove();

  try {
      await window.API.fetch(`/projecao/eleitor/${eleitorId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          intencao_voto: novaIntencao || '',
          ultimo_contato: new Date().toISOString(),
        }),
      });

      // Atualiza o badge sem recarregar a lista toda
      if (btnElement) {
        btnElement.outerHTML = renderBadge(novaIntencao, eleitorId);
        // Reanexar listener ao novo badge
        setTimeout(() => {
          const novoBadge = document.querySelector(`.intencao-badge[data-eleitor-id="${eleitorId}"]`);
          if (novoBadge) {
            novoBadge.addEventListener('click', (e) => {
              openQuickEdit(eleitorId, novaIntencao, e.currentTarget);
            });
          }
        }, 50);
      }

      // Atualiza o cache local do eleitor
      if (window.Eleitores) {
        const e = window.Eleitores.find(eleitorId);
        if (e) e.intencao_voto = novaIntencao;
      }

      // Toast
      const op = OPCOES.find(o => o.valor === novaIntencao);
      window.showToast?.(
        novaIntencao
          ? `✓ Intenção registrada: ${op?.label}`
          : '✓ Intenção removida',
        'success'
      );

      // Atualiza dashboard se estiver visível
      setTimeout(() => refreshDashboard(), 500);

    } catch (err) {
      window.showToast?.('Erro ao salvar intenção: ' + err.message, 'error');
    }
  }

  /* ════════════════════════════════════════════════
     4) REFRESH DO DASHBOARD
  ════════════════════════════════════════════════ */
  async function refreshDashboard() {
    try {
      const dados = await window.API.get('/eleitores/intencoes');
      // Atualiza os cards do dashboard se estiverem visíveis
      const ids = {
        confirmados: ['stat-confirmados', 'dash-confirmados'],
        provaveis:   ['stat-provaveis',   'dash-provaveis'],
        indecisos:   ['stat-indecisos',   'dash-indecisos'],
        em_risco:    ['stat-em-risco',    'dash-em-risco', 'stat-risco'],
      };
      Object.entries(ids).forEach(([campo, seletores]) => {
        seletores.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.textContent = dados[campo] ?? 0;
        });
      });
    } catch (e) { /* silencioso */ }
  }

  /* ════════════════════════════════════════════════
     5) DELEGAÇÃO DE EVENTOS — um listener pra toda a lista
  ════════════════════════════════════════════════ */
  function init() {
    // Delegação no container da lista (funciona mesmo quando a lista é re-renderizada)
    document.addEventListener('click', (e) => {
      const badge = e.target.closest('.intencao-badge');
      if (!badge) return;
      e.stopPropagation();
      const eleitorId = Number(badge.dataset.eleitorId);
      const intencaoAtual = badge.dataset.intencao || null;
      openQuickEdit(eleitorId, intencaoAtual, badge);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GEIntencao = { renderBadge, openQuickEdit, refreshDashboard };
  console.log('[INTENCAO v1] Módulo carregado.');

})();
