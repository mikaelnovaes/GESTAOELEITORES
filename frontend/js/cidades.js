/**
 * frontend/js/cidades.js v1
 * Módulo de Verificação e Padronização de Cidades.
 *
 * Funcionalidades:
 *  1. Detectar cidades similares/com erro ortográfico (fuzzy)
 *  2. Unificar cidades duplicadas em uma versão canônica
 *  3. Listar eleitores sem cidade preenchida
 *  4. Sugerir cidade automaticamente baseado no bairro
 *  5. Preencher cidades em massa (por bairro) ou individualmente
 *
 * Expõe: window.GECidades = { openModal, refreshBadge }
 */

'use strict';

(function () {

  /* ════════════════════════════════════════════════
     1) MODAL PRINCIPAL — abre direto na aba mais útil
  ════════════════════════════════════════════════ */
  async function openModal(abaInicial) {
    let modal = document.getElementById('modal-cidades');
    if (!modal) modal = construirModal();
    modal.classList.add('show');

    // Decide aba inicial automaticamente
    if (!abaInicial) {
      const stats = await carregarStats();
      if (stats.sem_cidade > 0) {
        abaInicial = 'sem-cidade';
      } else if (stats.total_grupos > 0) {
        abaInicial = 'duplicadas';
      } else {
        abaInicial = 'duplicadas';
      }
    }
    trocarAba(abaInicial);
  }

  async function carregarStats() {
    try {
      const [dup, sem] = await Promise.all([
        window.API.get('/cidades/duplicadas'),
        window.API.get('/cidades/sem-cidade'),
      ]);
      return {
        total_grupos: dup.total_grupos || 0,
        total_a_unificar: dup.total_a_unificar || 0,
        sem_cidade: sem.total || 0,
      };
    } catch (err) {
      return { total_grupos: 0, total_a_unificar: 0, sem_cidade: 0 };
    }
  }

  /* ════════════════════════════════════════════════
     2) CONSTRUÇÃO DO MODAL (HTML dinâmico)
  ════════════════════════════════════════════════ */
  function construirModal() {
    const overlay = document.createElement('div');
    overlay.id = 'modal-cidades';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:920px;width:95vw;max-height:90vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <h2 class="modal-title">🏙️ Verificar Cidades</h2>
          <button class="modal-close" data-close="modal-cidades">×</button>
        </div>

        <div style="border-bottom:1px solid var(--line);display:flex;gap:0;padding:0 1.5rem;">
          <button class="cid-tab cid-tab-active" data-aba="sem-cidade" style="padding:0.7rem 1.2rem;background:none;border:none;border-bottom:2px solid var(--gold);font-weight:600;color:var(--navy);cursor:pointer;font-family:inherit;">
            📍 Sem Cidade <span id="cid-tab-sem-count" class="badge badge-comum" style="margin-left:0.4rem;">0</span>
          </button>
          <button class="cid-tab" data-aba="duplicadas" style="padding:0.7rem 1.2rem;background:none;border:none;border-bottom:2px solid transparent;font-weight:500;color:var(--muted);cursor:pointer;font-family:inherit;">
            🔀 Cidades Similares <span id="cid-tab-dup-count" class="badge badge-comum" style="margin-left:0.4rem;">0</span>
          </button>
        </div>

        <div id="modal-cidades-body" class="modal-body" style="flex:1;overflow-y:auto;padding:1.5rem;">
          <div class="empty" style="padding:2rem;text-align:center;color:var(--muted);">Carregando…</div>
        </div>

        <div class="modal-footer" id="modal-cidades-footer">
          <button class="btn btn-secondary" data-close="modal-cidades">Fechar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Handlers
    overlay.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => overlay.classList.remove('show'));
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
    overlay.querySelectorAll('.cid-tab').forEach(btn => {
      btn.addEventListener('click', () => trocarAba(btn.dataset.aba));
    });

    return overlay;
  }

  function trocarAba(aba) {
    document.querySelectorAll('.cid-tab').forEach(b => {
      const ativa = b.dataset.aba === aba;
      b.classList.toggle('cid-tab-active', ativa);
      b.style.borderBottomColor = ativa ? 'var(--gold)' : 'transparent';
      b.style.fontWeight = ativa ? '600' : '500';
      b.style.color = ativa ? 'var(--navy)' : 'var(--muted)';
    });
    if (aba === 'sem-cidade') renderAbaSemCidade();
    else if (aba === 'duplicadas') renderAbaDuplicadas();
  }

  /* ════════════════════════════════════════════════
     3) ABA "SEM CIDADE" — preenchimento baseado em bairro
  ════════════════════════════════════════════════ */
  async function renderAbaSemCidade() {
    const body = document.getElementById('modal-cidades-body');
    body.innerHTML = '<div class="empty" style="padding:2rem;text-align:center;color:var(--muted);">Analisando bairros…</div>';

    try {
      const dados = await window.API.get('/cidades/sugestoes-por-bairro');
      const semCidade = await window.API.get('/cidades/sem-cidade');

      // Atualiza badge do título da aba
      document.getElementById('cid-tab-sem-count').textContent = semCidade.total;

      if (!dados.sugestoes.length) {
        body.innerHTML = `
          <div class="empty" style="padding:3rem;text-align:center;">
            <div style="font-size:3rem;">✅</div>
            <h3 style="color:var(--success);margin-top:0.6rem;">Todos os eleitores têm cidade!</h3>
            <p style="color:var(--muted);">Nenhum eleitor está com a cidade em branco.</p>
          </div>`;
        return;
      }

      // Resumo no topo
      let html = `
        <div style="background:var(--cream);padding:1rem 1.2rem;border-radius:6px;margin-bottom:1.2rem;border-left:3px solid var(--gold);">
          <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;font-size:0.88rem;">
            <div><strong style="font-size:1.4rem;color:var(--navy);">${semCidade.total}</strong> <span style="color:var(--muted);">eleitores sem cidade</span></div>
            <div><strong style="font-size:1.4rem;color:var(--success);">${dados.com_sugestao}</strong> <span style="color:var(--muted);">bairros com sugestão automática</span></div>
            ${dados.sem_sugestao > 0 ? `<div><strong style="font-size:1.4rem;color:var(--warning);">${dados.sem_sugestao}</strong> <span style="color:var(--muted);">bairros precisam preenchimento manual</span></div>` : ''}
          </div>
        </div>

        <div style="font-size:0.9rem;color:var(--ink);margin-bottom:1rem;">
          ${dados.com_sugestao > 0
            ? '💡 Para cada bairro, sugerimos a cidade mais comum dos eleitores que já têm o mesmo bairro preenchido. Confirme ou ajuste antes de aplicar.'
            : '✏️ Como nenhum eleitor tem cidade preenchida, você precisa informar a cidade de cada bairro manualmente.'}
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:0.86rem;">
          <thead>
            <tr style="background:var(--cream);">
              <th style="padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);">Bairro</th>
              <th style="padding:8px 12px;text-align:center;border-bottom:1px solid var(--line);">Eleitores</th>
              <th style="padding:8px 12px;text-align:left;border-bottom:1px solid var(--line);">Cidade</th>
              <th style="padding:8px 12px;text-align:right;border-bottom:1px solid var(--line);">Ação</th>
            </tr>
          </thead>
          <tbody>
      `;

      dados.sugestoes.forEach((s, idx) => {
        const idRow = `cid-row-${idx}`;
        const sugerida = s.cidade_sugerida || '';
        const corBorda = s.cidade_sugerida ? 'var(--success)' : 'var(--warning)';
        const labelConf = s.cidade_sugerida
          ? `<span style="color:var(--success);font-size:0.74rem;">💡 Sugerido (baseado em ${s.baseado_em} eleitor${s.baseado_em > 1 ? 'es' : ''})</span>`
          : '<span style="color:var(--warning);font-size:0.74rem;">⚠️ Preencha manualmente</span>';

        html += `
          <tr id="${idRow}" data-bairro="${escapeHtml(s.bairro)}" style="border-bottom:1px solid var(--line);">
            <td style="padding:10px 12px;font-weight:600;color:var(--navy);">${escapeHtml(s.bairro)}</td>
            <td style="padding:10px 12px;text-align:center;font-weight:600;">${s.qtd_sem_cidade}</td>
            <td style="padding:10px 12px;">
              <input type="text" class="cid-input" data-bairro="${escapeHtml(s.bairro)}"
                value="${escapeHtml(sugerida)}"
                placeholder="Digite a cidade"
                style="width:100%;padding:6px 10px;border:1px solid ${corBorda};border-radius:4px;font-family:inherit;font-size:0.86rem;">
              <div style="margin-top:0.2rem;">${labelConf}</div>
            </td>
            <td style="padding:10px 12px;text-align:right;">
              <button class="btn btn-primary cid-aplicar" data-bairro="${escapeHtml(s.bairro)}" style="font-size:0.78rem;padding:5px 10px;">
                ✓ Aplicar
              </button>
            </td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
      `;
      body.innerHTML = html;

      // Atualiza footer com botão "Aplicar TODAS as sugestões"
      const sugeridosCount = dados.sugestoes.filter(s => s.cidade_sugerida).length;
      const footer = document.getElementById('modal-cidades-footer');
      footer.innerHTML = `
        <button class="btn btn-secondary" data-close="modal-cidades">Fechar</button>
        ${sugeridosCount > 0 ? `
          <button class="btn btn-primary" id="cid-aplicar-todas-sugestoes">
            ✓ Aplicar TODAS as ${sugeridosCount} sugestões automáticas
          </button>` : ''}
      `;
      footer.querySelectorAll('[data-close]').forEach(btn =>
        btn.addEventListener('click', () => document.getElementById('modal-cidades').classList.remove('show'))
      );

      // Handlers individuais
      body.querySelectorAll('.cid-aplicar').forEach(btn => {
        btn.addEventListener('click', () => aplicarUmBairro(btn.dataset.bairro));
      });

      // Handler "aplicar todas"
      document.getElementById('cid-aplicar-todas-sugestoes')?.addEventListener('click', () => aplicarTodasSugestoes(dados.sugestoes));

    } catch (err) {
      body.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function aplicarUmBairro(bairro) {
    const input = document.querySelector(`.cid-input[data-bairro="${cssEscape(bairro)}"]`);
    if (!input) return;
    const cidade = input.value.trim();
    if (!cidade) {
      window.showToast?.('Digite uma cidade antes de aplicar.', 'error');
      input.focus();
      return;
    }
    const row = document.getElementById(`cid-row-${[...document.querySelectorAll('.cid-input')].indexOf(input)}`);
    const qtd = row?.querySelector('td:nth-child(2)')?.textContent || '?';

    if (!confirm(`Aplicar "${cidade}" como cidade para os ${qtd} eleitores do bairro "${bairro}"?`)) return;

    try {
      const r = await window.API.post('/cidades/preencher-em-massa', { bairro, cidade });
      window.showToast?.(`✓ ${r.atualizados} eleitor(es) atualizado(s) com "${cidade}".`, 'success');
      // Remove a linha
      row?.remove();
      // Atualiza badges
      refreshBadge();
      // Sincroniza cache local
      if (window.syncFromAPI) await window.syncFromAPI();
      if (window.renderList) window.renderList();
    } catch (err) {
      window.showToast?.('Erro: ' + err.message, 'error');
    }
  }

  async function aplicarTodasSugestoes(sugestoes) {
    const comSugestao = sugestoes.filter(s => s.cidade_sugerida);
    if (!comSugestao.length) return;

    // Pega o valor ATUAL dos inputs (usuário pode ter ajustado)
    const atualizacoes = [];
    document.querySelectorAll('.cid-input').forEach(inp => {
      const v = inp.value.trim();
      if (v) atualizacoes.push({ bairro: inp.dataset.bairro, cidade: v });
    });
    const validas = atualizacoes.filter(a => sugestoes.find(s => s.bairro === a.bairro && s.cidade_sugerida));

    if (!validas.length) return;

    if (!confirm(`Aplicar ${validas.length} sugestões automáticas?\n\nIsso vai preencher a cidade de todos os eleitores nesses bairros que estão sem cidade.`)) return;

    let totalAtualizados = 0;
    let erros = 0;
    for (const a of validas) {
      try {
        const r = await window.API.post('/cidades/preencher-em-massa', a);
        totalAtualizados += r.atualizados || 0;
      } catch (e) {
        erros++;
      }
    }

    window.showToast?.(`✓ ${totalAtualizados} eleitor(es) atualizado(s)${erros ? ` (${erros} erro${erros > 1 ? 's' : ''})` : ''}.`, 'success');

    // Recarrega
    if (window.syncFromAPI) await window.syncFromAPI();
    if (window.renderList) window.renderList();
    refreshBadge();
    renderAbaSemCidade();
  }

  /* ════════════════════════════════════════════════
     4) ABA "DUPLICADAS" — cidades similares
  ════════════════════════════════════════════════ */
  async function renderAbaDuplicadas() {
    const body = document.getElementById('modal-cidades-body');
    body.innerHTML = '<div class="empty" style="padding:2rem;text-align:center;color:var(--muted);">Analisando cidades…</div>';

    try {
      const dados = await window.API.get('/cidades/duplicadas');
      document.getElementById('cid-tab-dup-count').textContent = dados.total_grupos;

      if (!dados.grupos.length) {
        body.innerHTML = `
          <div class="empty" style="padding:3rem;text-align:center;">
            <div style="font-size:3rem;">✅</div>
            <h3 style="color:var(--success);margin-top:0.6rem;">Nenhuma cidade duplicada!</h3>
            <p style="color:var(--muted);">
              ${dados.total_cidades_distintas === 0
                ? 'Ainda não há cidades preenchidas no sistema.'
                : `As ${dados.total_cidades_distintas} cidades cadastradas estão padronizadas.`}
            </p>
          </div>`;
        // Footer simples
        const footer = document.getElementById('modal-cidades-footer');
        footer.innerHTML = `<button class="btn btn-secondary" data-close="modal-cidades">Fechar</button>`;
        footer.querySelector('[data-close]').addEventListener('click', () => document.getElementById('modal-cidades').classList.remove('show'));
        return;
      }

      let html = `
        <div style="background:var(--cream);padding:1rem 1.2rem;border-radius:6px;margin-bottom:1.2rem;border-left:3px solid var(--warning);">
          <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;font-size:0.88rem;">
            <div><strong style="font-size:1.4rem;color:var(--navy);">${dados.total_grupos}</strong> <span style="color:var(--muted);">grupos de cidades similares</span></div>
            <div><strong style="font-size:1.4rem;color:var(--warning);">${dados.total_a_unificar}</strong> <span style="color:var(--muted);">eleitores serão atualizados</span></div>
          </div>
        </div>

        <div style="font-size:0.9rem;color:var(--ink);margin-bottom:1rem;">
          💡 Cidades com escrita similar foram agrupadas. Confirme a versão correta e clique em "Unificar".
        </div>
      `;

      dados.grupos.forEach((g, gi) => {
        html += `
          <div class="cid-grupo" data-grupo="${gi}" style="border:1px solid var(--line);border-radius:6px;margin-bottom:1rem;overflow:hidden;">
            <div style="background:var(--cream);padding:0.8rem 1.2rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);">
              <div>
                <strong style="color:var(--navy);">Grupo ${gi + 1}</strong>
                <span style="color:var(--muted);font-size:0.82rem;margin-left:0.6rem;">${g.variantes.length} variantes</span>
              </div>
              <button class="btn btn-primary cid-unificar-grupo" data-grupo="${gi}" style="font-size:0.78rem;padding:5px 12px;">
                ✓ Unificar Grupo
              </button>
            </div>
            <div style="padding:0.6rem 1.2rem;">
              <div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.4rem;">
                Selecione a versão correta (radio) — todas as outras serão substituídas:
              </div>
              ${g.variantes.map((v, vi) => `
                <label style="display:flex;align-items:center;gap:0.6rem;padding:0.4rem 0;cursor:pointer;font-size:0.88rem;">
                  <input type="radio" name="cid-grupo-${gi}" value="${escapeHtml(v.nome)}" ${v.sugerida ? 'checked' : ''}>
                  <strong style="color:var(--navy);min-width:200px;">${escapeHtml(v.nome)}</strong>
                  <span style="color:var(--muted);font-size:0.82rem;">${v.qtd} eleitor${v.qtd > 1 ? 'es' : ''}</span>
                  <span style="color:var(--muted);font-size:0.78rem;">· similaridade ${v.similaridade}%</span>
                  ${v.sugerida ? '<span class="badge badge-success" style="font-size:0.7rem;">recomendado</span>' : ''}
                </label>
              `).join('')}
            </div>
          </div>
        `;
      });

      body.innerHTML = html;

      // Footer "unificar todos"
      const footer = document.getElementById('modal-cidades-footer');
      footer.innerHTML = `
        <button class="btn btn-secondary" data-close="modal-cidades">Fechar</button>
        <button class="btn btn-primary" id="cid-unificar-todos">
          ✓ Unificar TODOS os grupos (sugestão recomendada)
        </button>
      `;
      footer.querySelector('[data-close]').addEventListener('click', () => document.getElementById('modal-cidades').classList.remove('show'));

      body.querySelectorAll('.cid-unificar-grupo').forEach(btn => {
        btn.addEventListener('click', () => unificarUmGrupo(Number(btn.dataset.grupo), dados.grupos[Number(btn.dataset.grupo)]));
      });
      document.getElementById('cid-unificar-todos').addEventListener('click', () => unificarTodosGrupos(dados.grupos));

    } catch (err) {
      body.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function unificarUmGrupo(gi, grupo) {
    const selecionado = document.querySelector(`input[name="cid-grupo-${gi}"]:checked`)?.value;
    if (!selecionado) {
      window.showToast?.('Selecione a versão correta.', 'error');
      return;
    }
    const outras = grupo.variantes.filter(v => v.nome !== selecionado).map(v => v.nome);
    if (!outras.length) return;
    if (!confirm(`Unificar para "${selecionado}"?\n\nVai substituir: ${outras.map(o => `"${o}"`).join(', ')}.`)) return;

    try {
      const r = await window.API.post('/cidades/unificar', { de: outras, para: selecionado });
      window.showToast?.(`✓ ${r.atualizados} eleitor(es) atualizado(s).`, 'success');
      document.querySelector(`.cid-grupo[data-grupo="${gi}"]`)?.remove();
      if (window.syncFromAPI) await window.syncFromAPI();
      if (window.renderList) window.renderList();
      refreshBadge();
    } catch (err) {
      window.showToast?.('Erro: ' + err.message, 'error');
    }
  }

  async function unificarTodosGrupos(grupos) {
    if (!confirm(`Unificar TODOS os ${grupos.length} grupos?\n\nVai usar a sugestão recomendada (versão com mais eleitores) de cada grupo.`)) return;

    let total = 0;
    let erros = 0;
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      const selecionado = document.querySelector(`input[name="cid-grupo-${gi}"]:checked`)?.value
                       || g.variantes.find(v => v.sugerida)?.nome;
      if (!selecionado) continue;
      const outras = g.variantes.filter(v => v.nome !== selecionado).map(v => v.nome);
      if (!outras.length) continue;
      try {
        const r = await window.API.post('/cidades/unificar', { de: outras, para: selecionado });
        total += r.atualizados || 0;
      } catch (e) {
        erros++;
      }
    }
    window.showToast?.(`✓ ${total} eleitor(es) atualizado(s)${erros ? ` (${erros} erro${erros > 1 ? 's' : ''})` : ''}.`, 'success');
    if (window.syncFromAPI) await window.syncFromAPI();
    if (window.renderList) window.renderList();
    refreshBadge();
    renderAbaDuplicadas();
  }

  /* ════════════════════════════════════════════════
     5) BADGE da sidebar
  ════════════════════════════════════════════════ */
  async function refreshBadge() {
    try {
      const stats = await carregarStats();
      const total = stats.sem_cidade + stats.total_grupos;
      const badges = document.querySelectorAll('[data-badge="cidades_pendentes"]');
      badges.forEach(b => {
        if (total > 0) {
          b.textContent = total > 99 ? '99+' : total;
          b.style.display = '';
        } else {
          b.style.display = 'none';
        }
      });
    } catch (e) { /* silencioso */ }
  }

  /* ════════════════════════════════════════════════
     UTILS
  ════════════════════════════════════════════════ */
  function escapeHtml(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function cssEscape(s) {
    return String(s).replace(/(["\\\\])/g, '\\$1');
  }

  /* ════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════ */
  function init() {
    document.getElementById('btn-check-cidades')?.addEventListener('click', () => openModal());

    // Refresh badge periódico
    setTimeout(refreshBadge, 2500);
    window.addEventListener('ge:user-changed', () => setTimeout(refreshBadge, 1500));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GECidades = { openModal, refreshBadge };
  console.log('[CIDADES v1] Módulo carregado.');

})();
