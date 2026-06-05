/**
 * frontend/js/liderancas.js
 * Cadastro de Lideranças — lista, formulário, detalhes, relatório
 *
 * Expõe:
 *   - window.GELiderancas.openList()
 *   - window.GELiderancas.openReport()
 *   - window.GELiderancas.openForm(idOrNull)
 *   - window.GELiderancas.fetchAll()  (usado pelo dropdown do form de eleitor)
 *   - window.GELiderancas.getAll()    (cache em memória)
 */

(function() {
  'use strict';

  // Cache em memória (não persiste em localStorage para evitar vazamento entre tenants)
  let liderancasCache = [];
  let listenersBound = false;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function fmtDate(s) {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('pt-BR'); } catch (e) { return '—'; }
  }

  /* ============================================================
     API helpers
     ============================================================ */
  async function fetchAll() {
    if (!window.API) return [];
    try {
      const r = await window.API.get('/liderancas?pageSize=1000');
      liderancasCache = Array.isArray(r.data) ? r.data : [];
      return liderancasCache;
    } catch (err) {
      console.warn('[Liderancas] fetchAll falhou:', err.message);
      return [];
    }
  }
  function getAll() { return liderancasCache; }

  async function apiGet(id)   { return window.API.get('/liderancas/' + id); }
  async function apiCreate(d) { return window.API.post('/liderancas', d); }
  async function apiUpdate(id, d) { return window.API.put('/liderancas/' + id, d); }
  async function apiDelete(id) { return window.API.delete('/liderancas/' + id); }

  /* ============================================================
     LISTA
     ============================================================ */
  async function openList() {
    bindListListeners();
    await renderList();
  }

  function bindListListeners() {
    if (listenersBound) return;
    listenersBound = true;
    document.getElementById('btn-new-lideranca')?.addEventListener('click', () => openForm(null));
    document.getElementById('lid-filter-nome')?.addEventListener('input', renderList);
    document.getElementById('lid-filter-bairro')?.addEventListener('change', renderList);
    document.getElementById('lid-filter-cidade')?.addEventListener('change', renderList);
    document.getElementById('lid-filter-partido')?.addEventListener('change', renderList);
    document.getElementById('lid-btn-clear-filters')?.addEventListener('click', () => {
      ['lid-filter-nome','lid-filter-bairro','lid-filter-cidade','lid-filter-partido'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      renderList();
    });
    document.getElementById('btn-cancel-lideranca-form')?.addEventListener('click', () => window.switchView('liderancas'));
    document.getElementById('btn-save-lideranca')?.addEventListener('click', () => {
      document.getElementById('lideranca-form')?.dispatchEvent(new Event('submit'));
    });
    document.getElementById('lideranca-form')?.addEventListener('submit', onFormSubmit);
    // Relatório
    document.getElementById('lid-report-filter-bairro')?.addEventListener('change', renderReport);
    document.getElementById('lid-report-filter-cidade')?.addEventListener('change', renderReport);
    document.getElementById('lid-report-filter-partido')?.addEventListener('change', renderReport);
    document.getElementById('lid-report-sort')?.addEventListener('change', renderReport);
    document.getElementById('lid-report-filter-nome')?.addEventListener('input', renderReport);
    document.getElementById('lid-btn-clear-report-filters')?.addEventListener('click', () => {
      ['lid-report-filter-nome','lid-report-filter-bairro','lid-report-filter-cidade','lid-report-filter-partido'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const sortEl = document.getElementById('lid-report-sort');
      if (sortEl) sortEl.value = 'nome';
      renderReport();
    });
    document.getElementById('lid-btn-print-report')?.addEventListener('click', () => window.print());
  }

  async function renderList() {
    await fetchAll();
    populateFilterDropdowns();
    const container = document.getElementById('liderancas-list-container');
    if (!container) return;

    const nome    = document.getElementById('lid-filter-nome')?.value.toLowerCase() || '';
    const bairro  = document.getElementById('lid-filter-bairro')?.value || '';
    const cidade  = document.getElementById('lid-filter-cidade')?.value || '';
    const partido = document.getElementById('lid-filter-partido')?.value || '';

    const filtered = liderancasCache.filter(l =>
      (!nome   || (l.nome   || '').toLowerCase().includes(nome)) &&
      (!bairro || (l.bairro  || '') === bairro) &&
      (!cidade || (l.cidade  || '') === cidade) &&
      (!partido|| (l.partido || '') === partido)
    );

    const statEl = document.getElementById('lid-stat-total');
    if (statEl) statEl.textContent = liderancasCache.length;

    if (!filtered.length) {
      container.innerHTML = `
        <div class="empty">
          <h3>${liderancasCache.length === 0 ? 'Nenhuma liderança cadastrada' : 'Nenhum resultado'}</h3>
          <p>${liderancasCache.length === 0 ? 'Comece cadastrando uma liderança nova.' : 'Ajuste os filtros.'}</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Cargo / Partido</th>
            <th>Telefone</th>
            <th>Bairro / Cidade</th>
            <th>Cobertura</th>
            <th style="text-align:right">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(l => {
            const vinc = l.vinculados_count || 0;
            const naoVinc = l.expectativa_nao_vinculados || 0;
            const cobertura = vinc + naoVinc;
            const meta = l.expectativa_total || 0;
            const pct = meta > 0 ? Math.round((cobertura / meta) * 100) : null;
            const pctColor = pct == null ? 'var(--muted)' : pct >= 100 ? 'var(--success)' : pct >= 70 ? 'var(--gold)' : 'var(--warning)';
            return `
              <tr>
                <td><div class="row-name">${esc(l.nome)}</div>${l.area_atuacao ? `<div class="row-meta">${esc(l.area_atuacao)}</div>` : ''}</td>
                <td>${esc(l.cargo || '—')}${l.partido ? ` <span class="lid-badge">${esc(l.partido)}</span>` : ''}</td>
                <td>${esc(l.telefone || '—')}</td>
                <td>${esc([l.bairro, l.cidade].filter(Boolean).join(' / ') || '—')}</td>
                <td>
                  ${meta > 0 ? `
                    <div style="font-weight:600;">${cobertura} / ${meta}</div>
                    <div style="font-size:0.78rem;color:${pctColor};">${pct}% atingido</div>
                  ` : `<div style="color:var(--muted);font-size:0.85rem;">— (sem meta)</div>`}
                  <div style="font-size:0.72rem;color:var(--muted);">${vinc} vinculado(s) + ${naoVinc} promet.</div>
                </td>
                <td>
                  <div class="actions-cell">
                    <button class="icon-btn" data-act="view"   data-id="${l.id}">Ver</button>
                    <button class="icon-btn" data-act="edit"   data-id="${l.id}">Editar</button>
                    <button class="icon-btn danger" data-act="delete" data-id="${l.id}">Excluir</button>
                  </div>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    container.querySelectorAll('[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = Number(btn.dataset.id);
        const act = btn.dataset.act;
        if (act === 'view')   openDetail(id);
        if (act === 'edit')   openForm(id);
        if (act === 'delete') deleteLideranca(id);
      });
    });
  }

  function populateFilterDropdowns() {
    const bairros  = [...new Set(liderancasCache.map(l => l.bairro).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    const cidades  = [...new Set(liderancasCache.map(l => l.cidade).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    const partidos = [...new Set(liderancasCache.map(l => l.partido).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    fillSelect('lid-filter-bairro',         bairros,  'Todos os bairros');
    fillSelect('lid-filter-cidade',         cidades,  'Todas as cidades');
    fillSelect('lid-filter-partido',        partidos, 'Todos os partidos');
    fillSelect('lid-report-filter-bairro',  bairros,  'Todos os bairros');
    fillSelect('lid-report-filter-cidade',  cidades,  'Todas as cidades');
    fillSelect('lid-report-filter-partido', partidos, 'Todos os partidos');
  }
  function fillSelect(id, items, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }

  /* ============================================================
     FORMULÁRIO
     ============================================================ */
  async function openForm(id) {
    bindListListeners();
    const f = document.getElementById('lideranca-form');
    const titleEl = document.getElementById('lideranca-form-title');
    if (!f || !titleEl) return;

    if (id) {
      titleEl.textContent = 'Editar Liderança';
      try {
        const l = await apiGet(id);
        fillForm(l);
      } catch (err) {
        if (window.showToast) window.showToast(err.message || 'Erro ao carregar.', 'error');
        return;
      }
    } else {
      titleEl.textContent = 'Nova Liderança';
      f.reset();
      document.getElementById('lid-id').value = '';
    }
    window.switchView('liderancas-form');
    setTimeout(() => document.getElementById('lid-nome')?.focus(), 100);
  }

  function fillForm(l) {
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.value = val == null ? '' : val; };
    set('lid-id', l.id);
    set('lid-nome', l.nome);
    set('lid-nascimento', l.data_nascimento ? String(l.data_nascimento).substring(0, 10) : '');
    set('lid-telefone', l.telefone);
    set('lid-email', l.email);
    set('lid-endereco', l.endereco);
    set('lid-numero', l.numero);
    set('lid-bairro', l.bairro);
    set('lid-cidade', l.cidade);
    set('lid-titulo', l.titulo_eleitor);
    set('lid-secao', l.secao);
    set('lid-escola', l.escola_votacao);
    set('lid-cargo', l.cargo);
    set('lid-partido', l.partido);
    set('lid-area-atuacao', l.area_atuacao);
    set('lid-exp-total', l.expectativa_total || '');
    set('lid-exp-nao-vinc', l.expectativa_nao_vinculados || '');
    set('lid-observacoes', l.observacoes);
  }

  async function onFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('lid-id')?.value;
    const nome = document.getElementById('lid-nome')?.value.trim();
    if (!nome) { if (window.showToast) window.showToast('Nome é obrigatório.', 'error'); return; }
    const data = {
      nome,
      data_nascimento: document.getElementById('lid-nascimento')?.value || null,
      telefone:        document.getElementById('lid-telefone')?.value   || null,
      email:           document.getElementById('lid-email')?.value      || null,
      endereco:        document.getElementById('lid-endereco')?.value   || null,
      numero:          document.getElementById('lid-numero')?.value     || null,
      bairro:          document.getElementById('lid-bairro')?.value     || null,
      cidade:          document.getElementById('lid-cidade')?.value     || null,
      titulo_eleitor:  document.getElementById('lid-titulo')?.value     || null,
      secao:           document.getElementById('lid-secao')?.value      || null,
      escola_votacao:  document.getElementById('lid-escola')?.value     || null,
      cargo:           document.getElementById('lid-cargo')?.value      || null,
      partido:         document.getElementById('lid-partido')?.value    || null,
      area_atuacao:    document.getElementById('lid-area-atuacao')?.value || null,
      expectativa_total:          +document.getElementById('lid-exp-total')?.value    || 0,
      expectativa_nao_vinculados: +document.getElementById('lid-exp-nao-vinc')?.value || 0,
      observacoes:     document.getElementById('lid-observacoes')?.value || null,
    };
    try {
      if (id) {
        await apiUpdate(id, data);
        if (window.showToast) window.showToast('✓ Liderança atualizada.', 'success');
      } else {
        await apiCreate(data);
        if (window.showToast) window.showToast('✓ Liderança cadastrada.', 'success');
      }
      await fetchAll();
      window.switchView('liderancas');
    } catch (err) {
      if (window.showToast) window.showToast(err.message || 'Erro ao salvar.', 'error');
    }
  }

  /* ============================================================
     DETALHES (modal)
     ============================================================ */
  async function openDetail(id) {
    try {
      const l = await apiGet(id);
      const modal = document.getElementById('lid-detail-modal');
      const body  = document.getElementById('lid-detail-body');
      if (!modal || !body) return;

      const vinc = l.vinculados_count || 0;
      const naoVinc = l.expectativa_nao_vinculados || 0;
      const meta = l.expectativa_total || 0;
      const cob = vinc + naoVinc;
      const pct = meta > 0 ? Math.round((cob / meta) * 100) : null;

const eleitoresHTML = (l.eleitores_vinculados && l.eleitores_vinculados.length)
        ? `<table style="margin-top:0.5rem;width:100%;font-size:0.83rem;border-collapse:collapse;">
             <thead>
               <tr style="background:var(--cream);">
                 <th style="padding:6px 10px;text-align:left;">Nome</th>
                 <th style="padding:6px 10px;text-align:left;">Telefone</th>
                 <th style="padding:6px 10px;text-align:left;">Bairro / Cidade</th>
                 <th style="padding:6px 10px;text-align:left;">Intenção</th>
               </tr>
             </thead>
             <tbody>${l.eleitores_vinculados.map(e => `
               <tr style="border-bottom:1px solid var(--line);">
                 <td style="padding:6px 10px;font-weight:500;">${esc(e.nome)}</td>
                 <td style="padding:6px 10px;color:var(--muted);">${esc(e.telefone || '—')}</td>
                 <td style="padding:6px 10px;color:var(--muted);">${esc([e.bairro, e.cidade].filter(Boolean).join(' / ') || '—')}</td>
                 <td style="padding:6px 10px;">${window.GEIntencao?.renderBadge(e.intencao_voto, e.id) || '<span style="color:var(--muted);font-size:0.78rem;">—</span>'}</td>
               </tr>`).join('')}</tbody>
           </table>`
        : `<div class="empty" style="padding:1rem;font-size:0.88rem;color:var(--muted);">Nenhum eleitor vinculado a esta liderança ainda.</div>`;

      body.innerHTML = `
        <div class="lid-detail-grid">
          <div class="lid-detail-field"><strong>Nome:</strong> ${esc(l.nome)}</div>
          <div class="lid-detail-field"><strong>Cargo:</strong> ${esc(l.cargo || '—')}</div>
          <div class="lid-detail-field"><strong>Partido:</strong> ${esc(l.partido || '—')}</div>
          <div class="lid-detail-field"><strong>Telefone:</strong> ${esc(l.telefone || '—')}</div>
          <div class="lid-detail-field"><strong>E-mail:</strong> ${esc(l.email || '—')}</div>
          <div class="lid-detail-field"><strong>Endereço:</strong> ${esc([[l.endereco, l.numero].filter(Boolean).join(', '), l.bairro, l.cidade].filter(Boolean).join(' — ') || '—')}</div>
          <div class="lid-detail-field"><strong>Área de atuação:</strong> ${esc(l.area_atuacao || '—')}</div>
          <div class="lid-detail-field"><strong>Nascimento:</strong> ${fmtDate(l.data_nascimento)}</div>
          <div class="lid-detail-field"><strong>Título:</strong> ${esc(l.titulo_eleitor || '—')} · Seção ${esc(l.secao || '—')}</div>
          <div class="lid-detail-field"><strong>Escola:</strong> ${esc(l.escola_votacao || '—')}</div>
        </div>

        <div class="lid-detail-section">
          <h4>Expectativa de votos</h4>
          <div class="lid-metrics">
            <div class="lid-metric"><div class="lid-metric-label">Meta declarada</div><div class="lid-metric-value">${meta || '—'}</div></div>
            <div class="lid-metric"><div class="lid-metric-label">Vinculados no sistema</div><div class="lid-metric-value">${vinc}</div></div>
            <div class="lid-metric"><div class="lid-metric-label">Prometidos sem cadastro</div><div class="lid-metric-value">${naoVinc}</div></div>
            <div class="lid-metric"><div class="lid-metric-label">Cobertura total</div><div class="lid-metric-value">${cob}${meta > 0 ? ` <span style="font-size:0.7rem;font-weight:normal;color:${pct >= 100 ? 'var(--success)' : 'var(--muted)'}">(${pct}%)</span>` : ''}</div></div>
          </div>
        </div>

        ${l.observacoes ? `<div class="lid-detail-section"><h4>Observações</h4><p style="white-space:pre-wrap;">${esc(l.observacoes)}</p></div>` : ''}

        <div class="lid-detail-section">
          <h4>Eleitores vinculados (${vinc})</h4>
          ${eleitoresHTML}
        </div>
      `;

      modal.classList.add('show');
    } catch (err) {
      if (window.showToast) window.showToast(err.message || 'Erro ao carregar.', 'error');
    }
  }

  async function deleteLideranca(id) {
    const l = liderancasCache.find(x => x.id === id);
    const nome = l?.nome || 'esta liderança';
    if (!confirm(`Excluir liderança "${nome}"?\n\nOs eleitores vinculados a ela perderão o vínculo (mas não serão excluídos).`)) return;
    try {
      await apiDelete(id);
      if (window.showToast) window.showToast('✓ Liderança excluída.', 'success');
      await renderList();
    } catch (err) {
      if (window.showToast) window.showToast(err.message || 'Erro ao excluir.', 'error');
    }
  }

  /* ============================================================
     RELATÓRIO
     ============================================================ */
  async function openReport() {
    bindListListeners();
    await fetchAll();
    populateFilterDropdowns();
    renderReport();
  }

  function renderReport() {
    const container = document.getElementById('lid-report-container');
    if (!container) return;

    const nome    = document.getElementById('lid-report-filter-nome')?.value.toLowerCase() || '';
    const bairro  = document.getElementById('lid-report-filter-bairro')?.value || '';
    const cidade  = document.getElementById('lid-report-filter-cidade')?.value || '';
    const partido = document.getElementById('lid-report-filter-partido')?.value || '';
    const sortKey = document.getElementById('lid-report-sort')?.value || 'nome';

    let filtered = liderancasCache.filter(l =>
      (!nome   || (l.nome    || '').toLowerCase().includes(nome)) &&
      (!bairro || (l.bairro  || '') === bairro) &&
      (!cidade || (l.cidade  || '') === cidade) &&
      (!partido|| (l.partido || '') === partido)
    );

    filtered.sort((a, b) => {
      if (sortKey === 'cobertura') {
        const ca = (a.vinculados_count || 0) + (a.expectativa_nao_vinculados || 0);
        const cb = (b.vinculados_count || 0) + (b.expectativa_nao_vinculados || 0);
        return cb - ca;
      }
      if (sortKey === 'meta') return (b.expectativa_total || 0) - (a.expectativa_total || 0);
      return (a[sortKey] || '').localeCompare(b[sortKey] || '', 'pt-BR');
    });

    // Totalizadores
    const totalMeta = filtered.reduce((s, l) => s + (l.expectativa_total || 0), 0);
    const totalVinc = filtered.reduce((s, l) => s + (l.vinculados_count || 0), 0);
    const totalNaoVinc = filtered.reduce((s, l) => s + (l.expectativa_nao_vinculados || 0), 0);
    const totalCob = totalVinc + totalNaoVinc;
    const pctGeral = totalMeta > 0 ? Math.round((totalCob / totalMeta) * 100) : null;

    const countEl = document.getElementById('lid-report-count');
    if (countEl) countEl.textContent = filtered.length + (filtered.length === 1 ? ' liderança' : ' lideranças');

    if (!filtered.length) {
      container.innerHTML = `<div class="empty"><h3>Nenhum resultado</h3></div>`;
      return;
    }

    container.innerHTML = `
      <div class="lid-report-summary">
        <div class="lid-metric"><div class="lid-metric-label">Lideranças</div><div class="lid-metric-value">${filtered.length}</div></div>
        <div class="lid-metric"><div class="lid-metric-label">Meta total</div><div class="lid-metric-value">${totalMeta.toLocaleString('pt-BR')}</div></div>
        <div class="lid-metric"><div class="lid-metric-label">Vinculados</div><div class="lid-metric-value">${totalVinc.toLocaleString('pt-BR')}</div></div>
        <div class="lid-metric"><div class="lid-metric-label">Prometidos s/ cadastro</div><div class="lid-metric-value">${totalNaoVinc.toLocaleString('pt-BR')}</div></div>
        <div class="lid-metric"><div class="lid-metric-label">Cobertura</div><div class="lid-metric-value">${totalCob.toLocaleString('pt-BR')}${pctGeral != null ? ` <span style="font-size:0.7rem;color:var(--muted)">(${pctGeral}%)</span>` : ''}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Nome</th>
          <th>Cargo / Partido</th>
          <th>Telefone</th>
          <th>Bairro / Cidade</th>
          <th style="text-align:right">Meta</th>
          <th style="text-align:right">Vinc.</th>
          <th style="text-align:right">Promet.</th>
          <th style="text-align:right">Cobertura</th>
          <th style="text-align:right">%</th>
        </tr></thead>
        <tbody>${filtered.map(l => {
          const vinc = l.vinculados_count || 0;
          const naoV = l.expectativa_nao_vinculados || 0;
          const cob  = vinc + naoV;
          const meta = l.expectativa_total || 0;
          const pct  = meta > 0 ? Math.round((cob / meta) * 100) : null;
          const cColor = pct == null ? 'var(--muted)' : pct >= 100 ? 'var(--success)' : pct >= 70 ? 'var(--gold)' : 'var(--warning)';
          return `<tr>
            <td><strong>${esc(l.nome)}</strong></td>
            <td>${esc(l.cargo || '—')}${l.partido ? ` (${esc(l.partido)})` : ''}</td>
            <td>${esc(l.telefone || '—')}</td>
            <td>${esc([l.bairro, l.cidade].filter(Boolean).join(' / ') || '—')}</td>
            <td style="text-align:right">${meta > 0 ? meta.toLocaleString('pt-BR') : '—'}</td>
            <td style="text-align:right">${vinc}</td>
            <td style="text-align:right">${naoV}</td>
            <td style="text-align:right">${cob}</td>
            <td style="text-align:right;color:${cColor};font-weight:600;">${pct != null ? pct + '%' : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    `;
  }

  // Expor
  window.GELiderancas = { openList, openReport, openForm, fetchAll, getAll };

  // Listener pra fechar modal de detalhes
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-close="lid-detail-modal"]').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('lid-detail-modal')?.classList.remove('show');
      });
    });
  });

})();
