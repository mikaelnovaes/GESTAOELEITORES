/**
 * frontend/js/dashboard.js
 * Dashboard Analítico — métricas e gráficos da campanha
 * Expõe: window.GEDashboard.openDashboard()
 */

'use strict';

(function () {

  async function openDashboard() {
    window.switchView('dashboard');
    await render();
  }

  async function render() {
    const container = document.getElementById('dashboard-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:2rem;color:var(--muted);">Carregando dashboard…</div>';

    try {
      const data = await window.API.get('/dashboard/stats');
      container.innerHTML = renderHTML(data);
      renderGraficoCrescimento(data.crescimento_diario);
      renderGraficoFaixaEtaria(data.faixas_etarias);
      renderGraficoBairros(data.top_bairros);
    } catch (err) {
      container.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${window.escapeHtml(err.message)}</div>`;
    }
  }

  function renderHTML(d) {
    const t = d.totais;
    const projecao = (t.confirmados || 0) + (t.provaveis || 0);
    const pctMeta = d.meta?.meta > 0 ? Math.round(projecao / d.meta.meta * 100) : null;

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <div style="font-family:'Fraunces',serif;font-size:1.5rem;font-weight:700;color:var(--navy);">
            Dashboard Analítico
          </div>
          <div style="font-size:0.85rem;color:var(--muted);">
            ${d.meta?.candidato ? `${window.escapeHtml(d.meta.candidato)} · ${window.escapeHtml(d.meta.cargo || '')}` : 'Visão geral da campanha'}
          </div>
        </div>
        <button class="btn btn-secondary" id="btn-dash-refresh" style="font-size:0.85rem;">🔄 Atualizar</button>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem;">
        ${kpiCard('Total Eleitores', t.total_eleitores, '👥', 'var(--gold)')}
        ${kpiCard('Confirmados', t.confirmados, '✅', '#22c55e')}
        ${kpiCard('Prováveis', t.provaveis, '🟢', '#84cc16')}
        ${kpiCard('Novos (7d)', t.novos_semana, '⚡', '#3b82f6')}
        ${kpiCard('Novos (30d)', t.novos_mes, '📈', '#06b6d4')}
        ${kpiCard('Bairros', t.total_bairros, '📍', '#8b5cf6')}
        ${kpiCard('Cidades', t.total_cidades, '🏙', '#f59e0b')}
        ${kpiCard('Média/dia', t.media_diaria, '📊', '#ec4899')}
      </div>

      ${d.meta?.meta > 0 ? `
        <div class="panel" style="margin-bottom:1.5rem;padding:1.2rem;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.5rem;">
            <div style="font-weight:600;color:var(--navy);">Meta de Votos</div>
            <div style="font-size:0.85rem;color:var(--muted);">
              ${projecao.toLocaleString('pt-BR')} de ${d.meta.meta.toLocaleString('pt-BR')}
            </div>
          </div>
          <div style="background:var(--line);border-radius:99px;height:14px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#22c55e,#84cc16,var(--gold));height:14px;width:${Math.min(pctMeta||0,100)}%;transition:width 0.8s ease-out;border-radius:99px;"></div>
          </div>
          <div style="text-align:right;font-family:'Fraunces',serif;font-size:1.4rem;font-weight:700;color:var(--gold);margin-top:0.5rem;">
            ${pctMeta}%
          </div>
        </div>` : ''}

      <!-- Gráficos -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:1rem;margin-bottom:1.5rem;">
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Crescimento da Base (30 dias)</div>
          <canvas id="g-crescimento" height="180"></canvas>
        </div>
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Distribuição por Idade</div>
          <canvas id="g-faixas" height="180"></canvas>
        </div>
      </div>

      <div class="panel" style="margin-bottom:1.5rem;padding:1.2rem;">
        <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Top 10 Bairros</div>
        <canvas id="g-bairros" height="220"></canvas>
      </div>

      <!-- Tabela lideranças -->
      <div class="panel" style="padding:1.2rem;">
        <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Meta vs Realizado por Liderança</div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Liderança</th>
                <th style="text-align:center;">Cadastrados</th>
                <th style="text-align:center;">Meta</th>
                <th style="text-align:center;">✅</th>
                <th style="text-align:center;">🟢</th>
                <th>Progresso</th>
              </tr>
            </thead>
            <tbody>
              ${d.liderancas.map(l => `
                <tr>
                  <td>${window.escapeHtml(l.nome)}</td>
                  <td style="text-align:center;font-weight:600;">${l.cadastrados}</td>
                  <td style="text-align:center;color:var(--muted);">${l.meta || '—'}</td>
                  <td style="text-align:center;color:#22c55e;">${l.confirmados}</td>
                  <td style="text-align:center;color:#84cc16;">${l.provaveis}</td>
                  <td>
                    ${l.meta > 0 ? `
                      <div style="display:flex;align-items:center;gap:0.4rem;">
                        <div style="flex:1;background:var(--line);border-radius:99px;height:6px;">
                          <div style="background:var(--gold);height:6px;border-radius:99px;width:${Math.min(l.pct_cadastro,100)}%;"></div>
                        </div>
                        <span style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">${l.pct_cadastro}%</span>
                      </div>` : '<span style="color:var(--muted);font-size:0.78rem;">sem meta</span>'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    function kpiCard(label, value, icon, cor) {
      return `
        <div class="panel" style="padding:1rem;border-left:3px solid ${cor};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
            <div style="font-size:1.2rem;opacity:0.5;">${icon}</div>
          </div>
          <div style="font-family:'Fraunces',serif;font-size:1.8rem;font-weight:700;color:var(--navy);margin-top:0.3rem;">
            ${(value || 0).toLocaleString('pt-BR')}
          </div>
        </div>`;
    }
  }

  /* ══════════════════════════════════════════════════════
     GRÁFICOS (canvas puro — sem dependências externas)
  ══════════════════════════════════════════════════════ */
  function renderGraficoCrescimento(dados) {
    const canvas = document.getElementById('g-crescimento');
    if (!canvas || !dados.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = 180;
    canvas.width = W; canvas.height = H;

    if (dados.length < 2) {
      ctx.fillStyle = '#9ca3af';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Dados insuficientes', W/2, H/2);
      return;
    }

    const maxVal = Math.max(...dados.map(d => d.novos), 1);
    const padding = { top: 15, right: 20, bottom: 25, left: 30 };
    const chartW = W - padding.left - padding.right;
    const chartH = H - padding.top - padding.bottom;

    // Eixo Y
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#9ca3af';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + chartH * (i / 4);
      const val = Math.round(maxVal * (1 - i / 4));
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
      ctx.fillText(val, padding.left - 4, y + 3);
    }

    // Linha
    ctx.strokeStyle = '#c9a961';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    dados.forEach((d, i) => {
      const x = padding.left + (i / (dados.length - 1)) * chartW;
      const y = padding.top + chartH * (1 - d.novos / maxVal);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Área abaixo
    ctx.lineTo(padding.left + chartW, padding.top + chartH);
    ctx.lineTo(padding.left, padding.top + chartH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
    grad.addColorStop(0, 'rgba(201,169,97,0.3)');
    grad.addColorStop(1, 'rgba(201,169,97,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Pontos
    ctx.fillStyle = '#c9a961';
    dados.forEach((d, i) => {
      const x = padding.left + (i / (dados.length - 1)) * chartW;
      const y = padding.top + chartH * (1 - d.novos / maxVal);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Labels eixo X (primeiro, meio, último)
    ctx.fillStyle = '#6b7280';
    ctx.textAlign = 'center';
    [0, Math.floor(dados.length / 2), dados.length - 1].forEach(i => {
      const d = dados[i];
      const x = padding.left + (i / (dados.length - 1)) * chartW;
      const data = new Date(d.dia);
      ctx.fillText(data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                   x, padding.top + chartH + 15);
    });
  }

  function renderGraficoFaixaEtaria(dados) {
    const canvas = document.getElementById('g-faixas');
    if (!canvas || !dados.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = 180;
    canvas.width = W; canvas.height = H;

    const total = dados.reduce((s, d) => s + d.total, 0);
    if (total === 0) return;

    const cores = ['#c9a961', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#6b7280'];
    const cx = W / 2 - 60, cy = H / 2, raio = Math.min(cx, cy) - 10;

    let acc = -Math.PI / 2;
    dados.forEach((d, i) => {
      const angle = (d.total / total) * Math.PI * 2;
      ctx.fillStyle = cores[i % cores.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, raio, acc, acc + angle);
      ctx.closePath();
      ctx.fill();
      acc += angle;
    });

    // Donut hole
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, raio * 0.55, 0, Math.PI * 2);
    ctx.fill();

    // Legenda
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
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
    const canvas = document.getElementById('g-bairros');
    if (!canvas || !dados.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth, H = 220;
    canvas.width = W; canvas.height = H;

    const maxVal = Math.max(...dados.map(d => d.total), 1);
    const padding = { top: 10, right: 50, bottom: 10, left: 150 };
    const barH = (H - padding.top - padding.bottom) / dados.length - 4;

    dados.forEach((d, i) => {
      const y = padding.top + i * (barH + 4);
      const w = ((W - padding.left - padding.right) * d.total / maxVal);

      // Label
      ctx.fillStyle = '#374151';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const label = d.bairro.length > 18 ? d.bairro.substring(0, 18) + '…' : d.bairro;
      ctx.fillText(label, padding.left - 8, y + barH / 2);

      // Barra base
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(padding.left, y, W - padding.left - padding.right, barH);

      // Barra valor (gradiente)
      const grad = ctx.createLinearGradient(padding.left, 0, padding.left + w, 0);
      grad.addColorStop(0, '#c9a961');
      grad.addColorStop(1, '#e6c277');
      ctx.fillStyle = grad;
      ctx.fillRect(padding.left, y, w, barH);

      // Confirmados (verde)
      if (d.confirmados > 0) {
        const wc = ((W - padding.left - padding.right) * d.confirmados / maxVal);
        ctx.fillStyle = '#22c55e';
        ctx.fillRect(padding.left, y, wc, barH);
      }

      // Total no fim
      ctx.fillStyle = '#374151';
      ctx.textAlign = 'left';
      ctx.fillText(d.total, padding.left + w + 6, y + barH / 2);
    });
  }

  // Bind refresh
  document.addEventListener('click', (ev) => {
    if (ev.target?.id === 'btn-dash-refresh') render();
  });

  window.GEDashboard = { openDashboard };

})();
