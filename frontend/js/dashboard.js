/**
 * frontend/js/dashboard.js  (v2 — com filtros)
 * Dashboard com filtros por bairro, cidade e liderança 
 * Expõe: window.GEDashboard.openDashboard()
 */

'use strict';

(function () {

  let filtros = { bairro: '', cidade: '', lideranca_id: '' };

  async function openDashboard() {
    if (typeof window.switchView === 'function') window.switchView('dashboard');
    await render();
  }

  async function render() {
    const container = document.getElementById('dashboard-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:2rem;color:var(--muted);">Carregando dashboard…</div>';

    try {
      const qs = new URLSearchParams();
      if (filtros.bairro)        qs.set('bairro', filtros.bairro);
      if (filtros.cidade)        qs.set('cidade', filtros.cidade);
      if (filtros.lideranca_id)  qs.set('lideranca_id', filtros.lideranca_id);

      const data = await window.API.get('/dashboard/stats' + (qs.toString() ? '?' + qs.toString() : ''));
      container.innerHTML = renderHTML(data);
      bind(data);

      // Renderizar gráficos
      renderGraficoCrescimento(data.crescimento_diario);
      renderGraficoFaixaEtaria(data.faixas_etarias);
      renderGraficoBairros(data.top_bairros);
      renderGraficoCidades(data.top_cidades);
    } catch (err) {
      container.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${window.escapeHtml(err.message)}</div>`;
    }
  }

  function renderHTML(d) {
    const t = d.totais;
    const projecao = (t.confirmados || 0) + (t.provaveis || 0);
    const pctMeta = d.meta?.meta > 0 ? Math.round(projecao / d.meta.meta * 100) : null;

    const filtroAtivo = filtros.bairro || filtros.cidade || filtros.lideranca_id;

    return `
      <!-- HEADER -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <div style="font-family:'Fraunces',serif;font-size:1.6rem;font-weight:700;color:var(--navy);">
            Dashboard Analítico
          </div>
          <div style="font-size:0.85rem;color:var(--muted);">
            ${d.meta?.candidato ? `${window.escapeHtml(d.meta.candidato)} · ${window.escapeHtml(d.meta.cargo || '')}` : 'Visão geral da campanha'}
            ${filtroAtivo ? ' · <strong style="color:var(--gold);">Filtro ativo</strong>' : ''}
          </div>
        </div>
        <button class="btn btn-secondary" id="btn-dash-refresh" style="font-size:0.85rem;">🔄 Atualizar</button>
      </div>

      <!-- BARRA DE FILTROS -->
      <div class="panel" style="padding:1rem 1.2rem;margin-bottom:1.2rem;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:0.6rem;align-items:end;">
          <div>
            <label style="display:block;font-size:0.78rem;color:var(--muted);margin-bottom:0.2rem;">Bairro</label>
            <select id="filtro-dash-bairro" style="width:100%;">
              <option value="">— Todos os bairros —</option>
              ${d.filtros_disponiveis.bairros.map(b =>
                `<option value="${window.escapeHtml(b)}" ${filtros.bairro === b ? 'selected' : ''}>${window.escapeHtml(b)}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.78rem;color:var(--muted);margin-bottom:0.2rem;">Cidade</label>
            <select id="filtro-dash-cidade" style="width:100%;">
              <option value="">— Todas as cidades —</option>
              ${d.filtros_disponiveis.cidades.map(c =>
                `<option value="${window.escapeHtml(c)}" ${filtros.cidade === c ? 'selected' : ''}>${window.escapeHtml(c)}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.78rem;color:var(--muted);margin-bottom:0.2rem;">Liderança</label>
            <select id="filtro-dash-lideranca" style="width:100%;">
              <option value="">— Todas as lideranças —</option>
              ${d.filtros_disponiveis.liderancas.map(l =>
                `<option value="${l.id}" ${String(filtros.lideranca_id) === String(l.id) ? 'selected' : ''}>${window.escapeHtml(l.nome)}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <button class="btn btn-secondary" id="btn-dash-clear-filters" style="width:100%;font-size:0.82rem;">
              Limpar filtros
            </button>
          </div>
        </div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0.8rem;margin-bottom:1.2rem;">
        ${kpi('Eleitores', t.total_eleitores, '👥', 'var(--gold)')}
        ${kpi('Lideranças', t.total_liderancas, '⭐', '#8b5cf6')}
        ${kpi('Confirmados', t.confirmados, '✅', '#22c55e')}
        ${kpi('Prováveis', t.provaveis, '🟢', '#84cc16')}
        ${kpi('Indecisos', t.indecisos, '🟡', '#f59e0b')}
        ${kpi('Em risco', t.em_risco, '🟠', '#f97316')}
        ${kpi('Novos (7d)', t.novos_semana, '⚡', '#3b82f6')}
        ${kpi('Novos (30d)', t.novos_mes, '📈', '#06b6d4')}
        ${kpi('Bairros', t.total_bairros, '📍', '#ec4899')}
        ${kpi('Cidades', t.total_cidades, '🏙', '#10b981')}
      </div>

      ${d.meta?.meta > 0 ? `
        <div class="panel" style="margin-bottom:1.2rem;padding:1.2rem;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">
            <div style="font-weight:600;color:var(--navy);">Meta Global de Votos</div>
            <div style="font-size:0.85rem;color:var(--muted);">
              ${projecao.toLocaleString('pt-BR')} de ${d.meta.meta.toLocaleString('pt-BR')}
            </div>
          </div>
          <div style="background:var(--line);border-radius:99px;height:14px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#22c55e,#84cc16,var(--gold));height:14px;width:${Math.min(pctMeta||0,100)}%;transition:width 0.8s;border-radius:99px;"></div>
          </div>
          <div style="text-align:right;font-family:'Fraunces',serif;font-size:1.4rem;font-weight:700;color:var(--gold);margin-top:0.5rem;">
            ${pctMeta}%
          </div>
        </div>` : ''}

      <!-- Gráficos pequenos -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:1rem;margin-bottom:1.2rem;">
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Crescimento da Base (30 dias)</div>
          <canvas id="g-crescimento" height="180"></canvas>
        </div>
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Distribuição por Idade</div>
          <canvas id="g-faixas" height="180"></canvas>
        </div>
      </div>

      <!-- Top bairros + cidades -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:1rem;margin-bottom:1.2rem;">
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Top 15 Bairros</div>
          <canvas id="g-bairros" height="320"></canvas>
        </div>
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Top 10 Cidades</div>
          <canvas id="g-cidades" height="320"></canvas>
        </div>
      </div>

      <!-- Projeção por Liderança -->
      <div class="panel" style="padding:1.2rem;">
        <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Projeção de Votos por Liderança</div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Liderança</th>
                <th>Partido</th>
                <th style="text-align:center;">Cadastrados</th>
                <th style="text-align:center;">Meta</th>
                <th style="text-align:center;">✅</th>
                <th style="text-align:center;">🟢</th>
                <th style="text-align:center;">🟠</th>
                <th style="text-align:center;">Projeção</th>
                <th>% Meta</th>
              </tr>
            </thead>
            <tbody>
              ${d.projecao_liderancas.map(l => `
                <tr>
                  <td>${window.escapeHtml(l.nome)}</td>
                  <td style="font-size:0.82rem;color:var(--muted);">${window.escapeHtml(l.partido || '—')}</td>
                  <td style="text-align:center;font-weight:600;">${l.cadastrados}</td>
                  <td style="text-align:center;color:var(--muted);">${l.meta || '—'}</td>
                  <td style="text-align:center;color:#22c55e;">${l.confirmados}</td>
                  <td style="text-align:center;color:#84cc16;">${l.provaveis}</td>
                  <td style="text-align:center;color:#f97316;">${l.em_risco}</td>
                  <td style="text-align:center;font-weight:700;color:var(--navy);">${l.projecao_total}</td>
                  <td>
                    ${l.meta > 0 ? `
                      <div style="display:flex;align-items:center;gap:0.4rem;">
                        <div style="flex:1;background:var(--line);border-radius:99px;height:6px;min-width:80px;">
                          <div style="background:var(--gold);height:6px;border-radius:99px;width:${Math.min(l.pct_meta_projecao,100)}%;"></div>
                        </div>
                        <span style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">${l.pct_meta_projecao}%</span>
                      </div>` : '<span style="color:var(--muted);font-size:0.78rem;">sem meta</span>'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    function kpi(label, value, icon, cor) {
      return `
        <div class="panel" style="padding:1rem;border-left:3px solid ${cor};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:0.72rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
            <div style="font-size:1.1rem;opacity:0.5;">${icon}</div>
          </div>
          <div style="font-family:'Fraunces',serif;font-size:1.6rem;font-weight:700;color:var(--navy);margin-top:0.3rem;">
            ${(value || 0).toLocaleString('pt-BR')}
          </div>
        </div>`;
    }
  }

  function bind(d) {
    document.getElementById('btn-dash-refresh')?.addEventListener('click', () => render());
    document.getElementById('btn-dash-clear-filters')?.addEventListener('click', () => {
      filtros = { bairro: '', cidade: '', lideranca_id: '' };
      render();
    });
    document.getElementById('filtro-dash-bairro')?.addEventListener('change', (ev) => {
      filtros.bairro = ev.target.value;
      render();
    });
    document.getElementById('filtro-dash-cidade')?.addEventListener('change', (ev) => {
      filtros.cidade = ev.target.value;
      render();
    });
    document.getElementById('filtro-dash-lideranca')?.addEventListener('change', (ev) => {
      filtros.lideranca_id = ev.target.value;
      render();
    });
  }

  /* ══════════════════════════════════════════════════════
     GRÁFICOS — canvas puro
  ══════════════════════════════════════════════════════ */
  function renderGraficoCrescimento(dados) {
    const canvas = document.getElementById('g-crescimento');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = 180;
    canvas.width = W; canvas.height = H;
    if (!dados.length) {
      ctx.fillStyle = '#9ca3af'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Sem dados', W/2, H/2); return;
    }
    if (dados.length < 2) {
      ctx.fillStyle = '#9ca3af'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Dados insuficientes', W/2, H/2); return;
    }

    const maxVal = Math.max(...dados.map(d => d.novos), 1);
    const pad = { top: 15, right: 20, bottom: 25, left: 30 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;

    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    ctx.fillStyle = '#9ca3af'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + cH * (i / 4);
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cW, y); ctx.stroke();
      ctx.fillText(val, pad.left - 4, y + 3);
    }

    ctx.strokeStyle = '#c9a961'; ctx.lineWidth = 2.5; ctx.beginPath();
    dados.forEach((d, i) => {
      const x = pad.left + (i / (dados.length - 1)) * cW;
      const y = pad.top + cH * (1 - d.novos / maxVal);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.lineTo(pad.left + cW, pad.top + cH); ctx.lineTo(pad.left, pad.top + cH); ctx.closePath();
    const g = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    g.addColorStop(0, 'rgba(201,169,97,0.3)'); g.addColorStop(1, 'rgba(201,169,97,0.02)');
    ctx.fillStyle = g; ctx.fill();

    ctx.fillStyle = '#c9a961';
    dados.forEach((d, i) => {
      const x = pad.left + (i / (dados.length - 1)) * cW;
      const y = pad.top + cH * (1 - d.novos / maxVal);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    });

    ctx.fillStyle = '#6b7280'; ctx.textAlign = 'center';
    [0, Math.floor(dados.length / 2), dados.length - 1].forEach(i => {
      const d = dados[i];
      const x = pad.left + (i / (dados.length - 1)) * cW;
      const dt = new Date(d.dia);
      ctx.fillText(dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }), x, pad.top + cH + 15);
    });
  }

  function renderGraficoFaixaEtaria(dados) {
    const canvas = document.getElementById('g-faixas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = 180;
    canvas.width = W; canvas.height = H;

    const total = dados.reduce((s, d) => s + d.total, 0);
    if (total === 0) {
      ctx.fillStyle = '#9ca3af'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Sem dados', W/2, H/2); return;
    }

    const cores = ['#c9a961', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280'];
    const cx = W / 2 - 60, cy = H / 2, raio = Math.min(cx, cy) - 10;

    let acc = -Math.PI / 2;
    dados.forEach((d, i) => {
      const angle = (d.total / total) * Math.PI * 2;
      ctx.fillStyle = cores[i % cores.length];
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, raio, acc, acc + angle); ctx.closePath(); ctx.fill();
      acc += angle;
    });
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, raio * 0.55, 0, Math.PI * 2); ctx.fill();

    ctx.font = '11px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    dados.forEach((d, i) => {
      const y = 15 + i * 18;
      ctx.fillStyle = cores[i % cores.length];
      ctx.fillRect(W - 130, y - 5, 10, 10);
      ctx.fillStyle = '#374151';
      const pct = Math.round(d.total / total * 100);
      ctx.fillText(`${d.faixa} (${pct}%)`, W - 115, y);
    });
  }

  function renderGraficoBairros(dados) {
    renderBarrasHorizontais('g-bairros', dados.map(d => ({
      label: d.bairro, total: d.total, destaque: d.confirmados
    })));
  }

  function renderGraficoCidades(dados) {
    renderBarrasHorizontais('g-cidades', dados.map(d => ({ label: d.cidade, total: d.total })));
  }

  function renderBarrasHorizontais(canvasId, dados) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = Math.max(220, dados.length * 24 + 20);
    canvas.width = W; canvas.height = H;

    if (!dados.length) {
      ctx.fillStyle = '#9ca3af'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Sem dados', W/2, H/2); return;
    }

    const maxVal = Math.max(...dados.map(d => d.total), 1);
    const pad = { top: 8, right: 50, bottom: 8, left: 150 };
    const barH = (H - pad.top - pad.bottom) / dados.length - 4;

    dados.forEach((d, i) => {
      const y = pad.top + i * (barH + 4);
      const w = ((W - pad.left - pad.right) * d.total / maxVal);

      ctx.fillStyle = '#374151';
      ctx.font = '11px sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const label = d.label.length > 18 ? d.label.substring(0, 18) + '…' : d.label;
      ctx.fillText(label, pad.left - 8, y + barH / 2);

      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(pad.left, y, W - pad.left - pad.right, barH);

      const grad = ctx.createLinearGradient(pad.left, 0, pad.left + w, 0);
      grad.addColorStop(0, '#c9a961'); grad.addColorStop(1, '#e6c277');
      ctx.fillStyle = grad;
      ctx.fillRect(pad.left, y, w, barH);

      if (d.destaque > 0) {
        const wc = ((W - pad.left - pad.right) * d.destaque / maxVal);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(pad.left, y, wc, barH);
      }

      ctx.fillStyle = '#374151'; ctx.textAlign = 'left';
      ctx.fillText(d.total, pad.left + w + 6, y + barH / 2);
    });
  }

  window.GEDashboard = { openDashboard };

})();
