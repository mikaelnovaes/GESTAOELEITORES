/**
 * frontend/js/bairros.js
 *
 * Funcionalidade "Verificar endereços / Padronizar bairros"
 *
 * Fluxo:
 *  1. Usuário clica "🔍 Verificar bairros" na tela de Eleitores
 *  2. Sistema detecta grupos de bairros parecidos (ex: "Parque Paraíso" + "Pq. Paraiso")
 *  3. Modal mostra cada grupo com:
 *     - As variantes encontradas e contagem
 *     - Sugestão automática do nome canônico (a forma mais correta)
 *     - Input editável para escolher a forma final
 *     - Botão "Unificar este grupo"
 *  4. Tem também botão "Unificar todos com a sugestão" para resolver em massa
 */

'use strict';

(function () {

  let dadosCache = null;

  /* ════════════════════════════════════════════════════════════
     ABRIR MODAL
     ════════════════════════════════════════════════════════════ */
  async function abrirVerificacao() {
    let modal = document.getElementById('modal-bairros');
    if (!modal) modal = criarModal();
    modal.classList.add('show');

    const body = document.getElementById('bairros-body');
    body.innerHTML = '<div style="padding:2.5rem;text-align:center;color:var(--muted);">🔍 Analisando bairros…</div>';

    try {
      dadosCache = await window.API.get('/bairros/duplicados');
      renderConteudo();
    } catch (err) {
      body.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${esc(err.message)}</div>`;
    }
  }

  /* ════════════════════════════════════════════════════════════
     CRIAR MODAL (uma vez)
     ════════════════════════════════════════════════════════════ */
  function criarModal() {
    const modal = document.createElement('div');
    modal.id = 'modal-bairros';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:900px;max-height:92vh;">
        <div class="modal-header">
          <div class="modal-title">🔍 Padronizar Bairros</div>
          <button class="modal-close" data-close-bairros>×</button>
        </div>
        <div class="modal-body" id="bairros-body" style="overflow-y:auto;max-height:70vh;padding:1rem 1.2rem;"></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-close-bairros>Fechar</button>
          <button class="btn btn-primary" id="btn-bairros-unificar-todos" style="display:none;">
            ⚡ Unificar TODOS com as sugestões
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelectorAll('[data-close-bairros]').forEach(b =>
      b.addEventListener('click', () => modal.classList.remove('show'))
    );
    document.getElementById('btn-bairros-unificar-todos')?.addEventListener('click', unificarTodos);

    return modal;
  }

  /* ════════════════════════════════════════════════════════════
     RENDERIZAR CONTEÚDO
     ════════════════════════════════════════════════════════════ */
  function renderConteudo() {
    const body = document.getElementById('bairros-body');
    const btnTodos = document.getElementById('btn-bairros-unificar-todos');

    if (!dadosCache.grupos.length) {
      body.innerHTML = `
        <div style="padding:2.5rem;text-align:center;">
          <div style="font-size:3rem;margin-bottom:0.6rem;">✅</div>
          <h3 style="font-family:'Fraunces',serif;color:var(--navy);margin:0 0 0.4rem 0;">Tudo organizado!</h3>
          <p style="color:var(--muted);margin:0;">Não encontramos bairros com escrita similar que possam ser unificados.</p>
        </div>`;
      btnTodos.style.display = 'none';
      return;
    }

    btnTodos.style.display = '';

    body.innerHTML = `
      <div style="padding:0.8rem 1rem;background:var(--cream);border-radius:6px;margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.6rem;">
          <div>
            <strong style="color:var(--navy);">${dadosCache.total_grupos} grupos</strong> de bairros com variantes detectados
          </div>
          <div style="font-size:0.85rem;color:var(--muted);">
            <strong>${dadosCache.total_eleitores_afetados}</strong> eleitores afetados
          </div>
        </div>
        <div style="font-size:0.78rem;color:var(--muted);margin-top:0.4rem;">
          💡 O sistema analisou todos os bairros e agrupou aqueles com escrita parecida (acentos, abreviações como "Jd." vs "Jardim", etc).
          Edite o nome final se quiser e clique em <strong>Unificar</strong>.
        </div>
      </div>

      <div id="bairros-grupos">
        ${dadosCache.grupos.map((g, idx) => renderGrupo(g, idx)).join('')}
      </div>
    `;

    // Bind dos botões individuais
    dadosCache.grupos.forEach((g, idx) => {
      const btn = document.getElementById(`btn-unificar-${idx}`);
      btn?.addEventListener('click', () => unificarGrupo(idx));
    });
  }

  function renderGrupo(grupo, idx) {
    const variantesHTML = grupo.variantes.map(v => `
      <div style="display:inline-flex;align-items:center;gap:0.35rem;padding:0.28rem 0.6rem;background:#f3f4f6;border-radius:4px;font-size:0.82rem;border:1px solid #e5e7eb;">
        <span style="color:#374151;">${esc(v.nome)}</span>
        <span style="background:var(--gold);color:#fff;padding:0 0.45rem;border-radius:99px;font-size:0.7rem;font-weight:700;">${v.total}</span>
      </div>
    `).join('');

    return `
      <div class="grupo-bairro" data-idx="${idx}" style="border:1px solid #e5e7eb;border-radius:6px;padding:0.9rem 1rem;margin-bottom:0.8rem;background:#fff;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.55rem;flex-wrap:wrap;gap:0.5rem;">
          <div style="font-weight:600;color:var(--navy);font-size:0.92rem;">
            Grupo ${idx + 1}
            <span style="font-size:0.74rem;color:var(--muted);font-weight:400;margin-left:0.4rem;">
              ${grupo.total_eleitores_afetados} eleitores
            </span>
          </div>
        </div>

        <div style="margin-bottom:0.7rem;">
          <div style="font-size:0.74rem;color:var(--muted);margin-bottom:0.35rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">
            Variantes encontradas:
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:0.4rem;">
            ${variantesHTML}
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;padding-top:0.6rem;border-top:1px solid #f3f4f6;">
          <label style="font-size:0.78rem;color:var(--muted);font-weight:600;">Padronizar para:</label>
          <input
            type="text"
            id="canonico-${idx}"
            value="${esc(grupo.sugestao_canonica)}"
            style="flex:1;min-width:200px;padding:0.45rem 0.7rem;border:1px solid #d1d5db;border-radius:4px;font-size:0.88rem;font-weight:500;color:var(--navy);"
            placeholder="Nome final do bairro"
          >
          <button
            id="btn-unificar-${idx}"
            class="btn btn-primary"
            style="font-size:0.82rem;padding:0.45rem 0.9rem;"
          >
            ✓ Unificar este grupo
          </button>
        </div>
      </div>
    `;
  }

  /* ════════════════════════════════════════════════════════════
     UNIFICAR 1 GRUPO
     ════════════════════════════════════════════════════════════ */
  async function unificarGrupo(idx) {
    const grupo = dadosCache.grupos[idx];
    const input = document.getElementById(`canonico-${idx}`);
    const para = input.value.trim();

    if (!para) {
      window.showToast?.('Informe o nome final do bairro.', 'error');
      input.focus();
      return;
    }

    // De: todas as variantes que NÃO são iguais ao nome final
    const de = grupo.variantes.map(v => v.nome).filter(n => n !== para);
    if (!de.length) {
      window.showToast?.('Nenhuma variante diferente do nome final.', 'info');
      return;
    }

    const totalAfetar = grupo.variantes
      .filter(v => v.nome !== para)
      .reduce((s, v) => s + v.total, 0);

    if (!confirm(`Unificar ${de.length} variante${de.length > 1 ? 's' : ''} → "${para}"?\n\n${totalAfetar} eleitor${totalAfetar > 1 ? 'es' : ''} ser${totalAfetar > 1 ? 'ão' : 'á'} atualizado${totalAfetar > 1 ? 's' : ''}.`)) return;

    try {
      const btn = document.getElementById(`btn-unificar-${idx}`);
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Aplicando…'; }

      const r = await window.API.post('/bairros/unificar', { de, para });

      window.showToast?.(`✅ ${r.eleitores_atualizados} eleitores atualizados em "${para}"`, 'success');

      // Marca o grupo como concluído visualmente
      const card = document.querySelector(`.grupo-bairro[data-idx="${idx}"]`);
      if (card) {
        card.style.opacity = '0.5';
        card.style.background = '#dcfce7';
        card.innerHTML = `
          <div style="text-align:center;padding:1rem;color:#16a34a;font-weight:600;">
            ✅ Unificado: <strong>${esc(para)}</strong> (${r.eleitores_atualizados} eleitores)
          </div>`;
      }

      // Limpa o cache do frontend de eleitores (vai recarregar na próxima)
      try {
        if (window.GEData?.clearEleitoresCache) window.GEData.clearEleitoresCache();
        sessionStorage.removeItem('ge_eleitores_cache');
      } catch {}
    } catch (err) {
      window.showToast?.('Erro: ' + err.message, 'error');
      const btn = document.getElementById(`btn-unificar-${idx}`);
      if (btn) { btn.disabled = false; btn.innerHTML = '✓ Unificar este grupo'; }
    }
  }

  /* ════════════════════════════════════════════════════════════
     UNIFICAR TODOS com as sugestões
     ════════════════════════════════════════════════════════════ */
  async function unificarTodos() {
    const totalGrupos = dadosCache.grupos.length;
    const totalAfetar = dadosCache.total_eleitores_afetados;

    if (!confirm(`Aplicar a sugestão automática para TODOS os ${totalGrupos} grupos?\n\n${totalAfetar} eleitores serão atualizados.\n\n💡 Esta ação NÃO pode ser desfeita facilmente. Recomendamos revisar os nomes manualmente primeiro.`)) return;

    const btn = document.getElementById('btn-bairros-unificar-todos');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Processando…'; }

    let sucessos = 0;
    let falhas = 0;
    let atualizadosTotal = 0;

    for (let idx = 0; idx < dadosCache.grupos.length; idx++) {
      const grupo = dadosCache.grupos[idx];
      const input = document.getElementById(`canonico-${idx}`);
      const para = input ? input.value.trim() : grupo.sugestao_canonica;
      const de = grupo.variantes.map(v => v.nome).filter(n => n !== para);
      if (!de.length) continue;

      try {
        const r = await window.API.post('/bairros/unificar', { de, para });
        atualizadosTotal += r.eleitores_atualizados;
        sucessos++;

        // Marca como concluído
        const card = document.querySelector(`.grupo-bairro[data-idx="${idx}"]`);
        if (card) {
          card.style.opacity = '0.5';
          card.style.background = '#dcfce7';
          card.innerHTML = `<div style="text-align:center;padding:1rem;color:#16a34a;font-weight:600;">✅ Unificado: <strong>${esc(para)}</strong> (${r.eleitores_atualizados})</div>`;
        }
      } catch {
        falhas++;
      }
    }

    if (btn) {
      btn.disabled = false;
      btn.style.display = 'none';
    }
    window.showToast?.(`✅ Concluído! ${sucessos}/${totalGrupos} grupos unificados (${atualizadosTotal} eleitores)${falhas > 0 ? `. ${falhas} falhas.` : '.'}`, 'success');

    try {
      if (window.GEData?.clearEleitoresCache) window.GEData.clearEleitoresCache();
      sessionStorage.removeItem('ge_eleitores_cache');
    } catch {}
  }

  /* ════════════════════════════════════════════════════════════
     UTILS + INIT
     ════════════════════════════════════════════════════════════ */
  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function init() {
    document.getElementById('btn-verificar-bairros')?.addEventListener('click', abrirVerificacao);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GEBairros = { abrirVerificacao };

  console.log('[BAIRROS] Módulo carregado.');

})();
