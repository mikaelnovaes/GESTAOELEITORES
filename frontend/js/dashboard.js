/**
 * frontend/js/dashboard.js (v3 — seletor de gráfico + análises avançadas)
 * Permite escolher TIPO de gráfico (pizza/barras/linhas) e MÉTRICA
 *
 * REQUER no index.html:
 *   <script src="https://unpkg.com/chart.js@4.4.0/dist/chart.umd.js"></script>
 */

'use strict';

(function () {

  let filtros = { bairro: '', cidade: '', lideranca_id: '' };
  let dadosCache = null;
  let graficos = {}; // referências aos Chart.js instances

  // CONFIGURAÇÃO DAS MÉTRICAS DISPONÍVEIS
  const METRICAS = {
    'eleitores_bairro': {
      label: 'Eleitores por Bairro',
      icone: '📍',
      tipoPadrao: 'bar-h',
      getData: (d) => ({
        labels: d.top_bairros.map(b => b.bairro),
        values: d.top_bairros.map(b => b.total),
      }),
    },
    'eleitores_cidade': {
      label: 'Eleitores por Cidade',
      icone: '🏙️',
      tipoPadrao: 'bar-v',
      getData: (d) => ({
        labels: d.top_cidades.map(b => b.cidade),
        values: d.top_cidades.map(b => b.total),
      }),
    },
    'faixa_etaria': {
      label: 'Distribuição por Faixa Etária',
      icone: '👥',
      tipoPadrao: 'pie',
      getData: (d) => ({
        labels: d.faixas_etarias.map(f => f.faixa),
        values: d.faixas_etarias.map(f => f.total),
      }),
    },
    'intencao_voto': {
      label: 'Intenção de Voto',
      icone: '🗳️',
      tipoPadrao: 'doughnut',
      getData: (d) => {
        const t = d.totais;
        const sem = (t.total_eleitores || 0) - (t.confirmados || 0) - (t.provaveis || 0) - (t.indecisos || 0) - (t.em_risco || 0);
        return {
          labels: ['✅ Confirmados', '🟢 Prováveis', '🟡 Indecisos', '🟠 Em risco', '⚪ Sem classificação'],
          values: [t.confirmados || 0, t.provaveis || 0, t.indecisos || 0, t.em_risco || 0, Math.max(sem, 0)],
          colors: ['#22c55e', '#84cc16', '#f59e0b', '#f97316', '#9ca3af'],
        };
      },
    },
    'projecao_lideranca': {
      label: 'Projeção por Liderança',
      icone: '⭐',
      tipoPadrao: 'bar-h',
      getData: (d) => ({
        labels: d.projecao_liderancas.slice(0, 15).map(l => l.nome),
        values: d.projecao_liderancas.slice(0, 15).map(l => l.projecao_total),
      }),
    },
    'crescimento': {
      label: 'Crescimento (30 dias)',
      icone: '📈',
      tipoPadrao: 'line',
      getData: (d) => ({
        labels: d.crescimento_diario.map(c => new Date(c.dia).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })),
        values: d.crescimento_diario.map(c => c.novos),
      }),
    },
    'cobertura_bairro': {
      label: 'Cobertura por Bairro (%confirmados)',
      icone: '🎯',
      tipoPadrao: 'bar-h',
      getData: (d) => ({
        labels: d.top_bairros.map(b => b.bairro),
        values: d.top_bairros.map(b => b.total > 0 ? Math.round((b.confirmados / b.total) * 100) : 0),
        suffix: '%',
      }),
    },
  };

  const TIPOS_GRAFICO = {
    'pie':       { label: '🥧 Pizza',           chartType: 'pie' },
    'doughnut':  { label: '🍩 Rosca',           chartType: 'doughnut' },
    'bar-v':     { label: '📊 Barras verticais', chartType: 'bar' },
    'bar-h':     { label: '📊 Barras horizontais', chartType: 'bar' },
    'line':      { label: '📈 Linha',           chartType: 'line' },
    'radar':     { label: '🕸️ Radar',           chartType: 'radar' },
  };

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
      if (filtros.bairro)       qs.set('bairro', filtros.bairro);
      if (filtros.cidade)       qs.set('cidade', filtros.cidade);
      if (filtros.lideranca_id) qs.set('lideranca_id', filtros.lideranca_id);

      dadosCache = await window.API.get('/dashboard/stats' + (qs.toString() ? '?' + qs.toString() : ''));
      container.innerHTML = renderHTML(dadosCache);
      bind();

      // Renderiza os gráficos principais
      renderGraficoPrincipal();
      renderGraficoSecundario();
    } catch (err) {
      container.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${esc(err.message)}</div>`;
    }
  }

  function renderHTML(d) {
    const t = d.totais;
    const projecao = (t.confirmados || 0) + (t.provaveis || 0);
    const pctMeta = d.meta?.meta > 0 ? Math.round(projecao / d.meta.meta * 100) : null;
    const filtroAtivo = filtros.bairro || filtros.cidade || filtros.lideranca_id;

    return `
      <!-- HEADER -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.2rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <div style="font-family:'Fraunces',serif;font-size:1.5rem;font-weight:700;color:var(--navy);">
            Dashboard Analítico
          </div>
          <div style="font-size:0.82rem;color:var(--muted);">
            ${d.meta?.candidato ? `${esc(d.meta.candidato)} · ${esc(d.meta.cargo || '')}` : 'Visão geral'}
            ${filtroAtivo ? ' · <strong style="color:var(--gold);">Filtro ativo</strong>' : ''}
          </div>
        </div>
        <button class="btn btn-secondary" id="btn-dash-refresh" style="font-size:0.82rem;">🔄 Atualizar</button>
      </div>

      <!-- FILTROS -->
      <div class="panel" style="padding:0.9rem 1.1rem;margin-bottom:1rem;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.6rem;align-items:end;">
          <div>
            <label style="display:block;font-size:0.72rem;color:var(--muted);margin-bottom:0.2rem;">Bairro</label>
            <select id="filtro-dash-bairro" style="width:100%;">
              <option value="">— Todos —</option>
              ${(d.filtros_disponiveis?.bairros || []).map(b => `<option value="${esc(b)}" ${filtros.bairro === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.72rem;color:var(--muted);margin-bottom:0.2rem;">Cidade</label>
            <select id="filtro-dash-cidade" style="width:100%;">
              <option value="">— Todas —</option>
              ${(d.filtros_disponiveis?.cidades || []).map(c => `<option value="${esc(c)}" ${filtros.cidade === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.72rem;color:var(--muted);margin-bottom:0.2rem;">Liderança</label>
            <select id="filtro-dash-lideranca" style="width:100%;">
              <option value="">— Todas —</option>
              ${(d.filtros_disponiveis?.liderancas || []).map(l => `<option value="${l.id}" ${String(filtros.lideranca_id) === String(l.id) ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}
            </select>
          </div>
          <button class="btn btn-secondary" id="btn-dash-clear-filters" style="font-size:0.78rem;">Limpar filtros</button>
        </div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.7rem;margin-bottom:1.1rem;">
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
        <div class="panel" style="margin-bottom:1.1rem;padding:1rem 1.2rem;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.4rem;">
            <div style="font-weight:600;color:var(--navy);">Meta Global de Votos</div>
            <div style="font-size:0.82rem;color:var(--muted);">${projecao.toLocaleString('pt-BR')} de ${d.meta.meta.toLocaleString('pt-BR')}</div>
          </div>
          <div style="background:var(--line);border-radius:99px;height:12px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#22c55e,#84cc16,var(--gold));height:12px;width:${Math.min(pctMeta||0,100)}%;transition:width 0.6s;border-radius:99px;"></div>
          </div>
          <div style="text-align:right;font-family:'Fraunces',serif;font-size:1.3rem;font-weight:700;color:var(--gold);margin-top:0.3rem;">${pctMeta}%</div>
        </div>` : ''}

      <!-- GRÁFICO PRINCIPAL (com seletor) -->
      <div class="panel" style="padding:1.1rem 1.2rem;margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
          <div>
            <div style="font-weight:600;color:var(--navy);">Gráfico Personalizado</div>
            <div style="font-size:0.75rem;color:var(--muted);">Escolha o que ver e como ver</div>
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            <select id="dash-metrica" style="font-size:0.82rem;">
              ${Object.entries(METRICAS).map(([k, m]) => `<option value="${k}">${m.icone} ${m.label}</option>`).join('')}
            </select>
            <select id="dash-tipo-grafico" style="font-size:0.82rem;">
              ${Object.entries(TIPOS_GRAFICO).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="position:relative;height:380px;">
          <canvas id="dash-grafico-principal"></canvas>
        </div>
      </div>

      <!-- GRÁFICO SECUNDÁRIO (intenção sempre em pizza) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <div class="panel" style="padding:1.1rem 1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Intenção de Voto</div>
          <div style="position:relative;height:240px;">
            <canvas id="dash-grafico-intencao"></canvas>
          </div>
        </div>
        <div class="panel" style="padding:1.1rem 1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Insights Automáticos</div>
          <div id="dash-insights">${renderInsights(d)}</div>
        </div>
      </div>

      <!-- TABELA: Performance de Lideranças -->
      <div class="panel" style="padding:1.1rem 1.2rem;">
        <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Performance por Liderança</div>
        <div style="overflow-x:auto;">
          <table>
            <thead><tr>
              <th>Liderança</th>
              <th>Partido</th>
              <th style="text-align:center;">Cadastrados</th>
              <th style="text-align:center;">Meta</th>
              <th style="text-align:center;">✅</th>
              <th style="text-align:center;">🟢</th>
              <th style="text-align:center;">🟠</th>
              <th style="text-align:center;">Projeção</th>
              <th>% Meta</th>
            </tr></thead>
            <tbody>
              ${(d.projecao_liderancas || []).map(l => `
                <tr>
                  <td>${esc(l.nome)}</td>
                  <td style="font-size:0.82rem;color:var(--muted);">${esc(l.partido || '—')}</td>
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
                        <span style="font-size:0.74rem;color:var(--muted);white-space:nowrap;">${l.pct_meta_projecao}%</span>
                      </div>` : '<span style="color:var(--muted);font-size:0.74rem;">—</span>'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    function kpi(label, value, icon, cor) {
      return `
        <div class="panel" style="padding:0.85rem;border-left:3px solid ${cor};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;">${label}</div>
            <div style="font-size:1rem;opacity:0.5;">${icon}</div>
          </div>
          <div style="font-family:'Fraunces',serif;font-size:1.5rem;font-weight:700;color:var(--navy);margin-top:0.25rem;">
            ${(value || 0).toLocaleString('pt-BR')}
          </div>
        </div>`;
    }
  }

  /* ════════════════════════════════════════════════
     INSIGHTS AUTOMÁTICOS — análise sênior dos dados
  ════════════════════════════════════════════════ */
  function renderInsights(d) {
    const t = d.totais;
    const insights = [];

    // 1. Cobertura
    const taxaConfirmacao = t.total_eleitores > 0
      ? Math.round((t.confirmados / t.total_eleitores) * 100) : 0;
    if (taxaConfirmacao < 20) {
      insights.push({ icon: '⚠️', cor: '#f59e0b', txt: `Taxa de confirmados baixa (${taxaConfirmacao}%). Sugestão: campanha de validação das intenções.` });
    } else if (taxaConfirmacao > 60) {
      insights.push({ icon: '✅', cor: '#22c55e', txt: `Taxa de confirmados sólida (${taxaConfirmacao}%). Base bem qualificada!` });
    }

    // 2. Ritmo de cadastro
    if (t.novos_semana > 0) {
      const projecaoMes = Math.round(t.novos_semana * 4.3);
      insights.push({ icon: '📈', cor: '#3b82f6', txt: `Cadastrando ${t.novos_semana}/semana. Projeção: ${projecaoMes} novos em 30 dias.` });
    } else if (t.novos_mes === 0 && t.total_eleitores > 0) {
      insights.push({ icon: '🐢', cor: '#9ca3af', txt: 'Nenhum cadastro novo nos últimos 30 dias.' });
    }

    // 3. Concentração geográfica
    if (d.top_bairros?.length) {
      const topBairro = d.top_bairros[0];
      const pctTop = t.total_eleitores > 0 ? Math.round((topBairro.total / t.total_eleitores) * 100) : 0;
      if (pctTop > 30) {
        insights.push({ icon: '📍', cor: '#8b5cf6', txt: `${pctTop}% da base está em <strong>${esc(topBairro.bairro)}</strong>. Considere expandir para outros bairros.` });
      } else if (d.top_bairros.length > 5) {
        insights.push({ icon: '🌍', cor: '#06b6d4', txt: `Base distribuída em ${t.total_bairros} bairros. Boa cobertura geográfica.` });
      }
    }

    // 4. Lideranças performando
    if (d.projecao_liderancas?.length) {
      const semCadastros = d.projecao_liderancas.filter(l => l.cadastrados === 0);
      if (semCadastros.length > 0) {
        insights.push({ icon: '🚨', cor: '#dc2626', txt: `${semCadastros.length} liderança${semCadastros.length > 1 ? 's' : ''} sem cadastros. Reunião sugerida.` });
      }
      const acimaMeta = d.projecao_liderancas.filter(l => l.meta > 0 && l.pct_meta_projecao >= 100);
      if (acimaMeta.length > 0) {
        insights.push({ icon: '🏆', cor: '#22c55e', txt: `${acimaMeta.length} liderança${acimaMeta.length > 1 ? 's' : ''} já atingi${acimaMeta.length > 1 ? 'ram' : 'u'} a meta!` });
      }
    }

    // 5. Risco
    if (t.em_risco > 0 && t.total_eleitores > 0) {
      const pctRisco = Math.round((t.em_risco / t.total_eleitores) * 100);
      if (pctRisco > 10) {
        insights.push({ icon: '🟠', cor: '#f97316', txt: `${pctRisco}% da base está em risco. Priorize contato com esses eleitores.` });
      }
    }

    if (!insights.length) {
      return '<div style="padding:1rem;color:var(--muted);font-size:0.85rem;text-align:center;">Cadastre mais eleitores para gerar insights.</div>';
    }

    return insights.slice(0, 5).map(i => `
      <div style="display:flex;gap:0.6rem;padding:0.7rem 0.8rem;background:var(--cream);border-radius:5px;margin-bottom:0.4rem;border-left:3px solid ${i.cor};">
        <div style="font-size:1.1rem;line-height:1;">${i.icon}</div>
        <div style="font-size:0.82rem;line-height:1.4;color:#374151;">${i.txt}</div>
      </div>`).join('');
  }

  /* ════════════════════════════════════════════════
     RENDERIZAÇÃO DOS GRÁFICOS (Chart.js)
  ════════════════════════════════════════════════ */
  function renderGraficoPrincipal() {
    const metricaKey = document.getElementById('dash-metrica')?.value || 'eleitores_bairro';
    const tipoKey = document.getElementById('dash-tipo-grafico')?.value || METRICAS[metricaKey].tipoPadrao;
    const metrica = METRICAS[metricaKey];
    if (!metrica || !dadosCache) return;

    const dados = metrica.getData(dadosCache);
    const canvas = document.getElementById('dash-grafico-principal');
    if (!canvas) return;

    // Destrói o gráfico anterior
    if (graficos.principal) { graficos.principal.destroy(); graficos.principal = null; }
    if (!window.Chart) {
      canvas.parentElement.innerHTML = '<div style="padding:2rem;color:var(--danger);text-align:center;">Chart.js não carregou. Recarregue a página.</div>';
      return;
    }

    const tipo = TIPOS_GRAFICO[tipoKey];
    const cores = dados.colors || gerarCores(dados.labels.length);
    const isHorizontal = tipoKey === 'bar-h';
    const isSlice = tipoKey === 'pie' || tipoKey === 'doughnut';

    graficos.principal = new Chart(canvas.getContext('2d'), {
      type: tipo.chartType,
      data: {
        labels: dados.labels,
        datasets: [{
          label: metrica.label,
          data: dados.values,
          backgroundColor: isSlice ? cores : cores[0] || '#c9a961',
          borderColor: isSlice ? '#fff' : (cores[0] || '#c9a961'),
          borderWidth: isSlice ? 2 : 1,
          tension: 0.3,
          fill: tipo.chartType === 'line',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: isHorizontal ? 'y' : 'x',
        plugins: {
          legend: {
            display: isSlice,
            position: 'right',
            labels: { font: { size: 12 } }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed[isHorizontal ? 'x' : (isSlice ? null : 'y')] ?? ctx.parsed;
                return `${ctx.label}: ${v}${dados.suffix || ''}`;
              }
            }
          }
        },
        scales: isSlice ? {} : {
          x: { ticks: { font: { size: 11 } } },
          y: { ticks: { font: { size: 11 } }, beginAtZero: true },
        },
      },
    });
  }

  function renderGraficoSecundario() {
    const canvas = document.getElementById('dash-grafico-intencao');
    if (!canvas || !dadosCache) return;
    if (graficos.intencao) { graficos.intencao.destroy(); graficos.intencao = null; }
    if (!window.Chart) return;

    const dados = METRICAS.intencao_voto.getData(dadosCache);
    graficos.intencao = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: dados.labels,
        datasets: [{
          data: dados.values,
          backgroundColor: dados.colors,
          borderColor: '#fff',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: { font: { size: 11 }, padding: 8 }
          }
        }
      }
    });
  }

  function gerarCores(n) {
    const paleta = ['#c9a961','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#84cc16','#6366f1','#ef4444','#14b8a6','#a855f7','#eab308','#10b981'];
    const result = [];
    for (let i = 0; i < n; i++) result.push(paleta[i % paleta.length]);
    return result;
  }

  /* ════════════════════════════════════════════════
     BINDS
  ════════════════════════════════════════════════ */
  function bind() {
    document.getElementById('btn-dash-refresh')?.addEventListener('click', render);
    document.getElementById('btn-dash-clear-filters')?.addEventListener('click', () => {
      filtros = { bairro: '', cidade: '', lideranca_id: '' };
      render();
    });
    document.getElementById('filtro-dash-bairro')?.addEventListener('change', (ev) => {
      filtros.bairro = ev.target.value; render();
    });
    document.getElementById('filtro-dash-cidade')?.addEventListener('change', (ev) => {
      filtros.cidade = ev.target.value; render();
    });
    document.getElementById('filtro-dash-lideranca')?.addEventListener('change', (ev) => {
      filtros.lideranca_id = ev.target.value; render();
    });
    document.getElementById('dash-metrica')?.addEventListener('change', () => {
      // Ao mudar a métrica, ajusta o tipo de gráfico para o padrão
      const metricaKey = document.getElementById('dash-metrica').value;
      const tipoSelect = document.getElementById('dash-tipo-grafico');
      if (tipoSelect && METRICAS[metricaKey]) {
        tipoSelect.value = METRICAS[metricaKey].tipoPadrao;
      }
      renderGraficoPrincipal();
    });
    document.getElementById('dash-tipo-grafico')?.addEventListener('change', renderGraficoPrincipal);
  }

  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
  }

  window.GEDashboard = { openDashboard };

})();
