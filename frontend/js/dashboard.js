/**
 * frontend/js/dashboard.js (v4 — com data labels nos gráficos)
 *
 * MUDANÇAS vs v3:
 *  - Adiciona plugin chartjs-plugin-datalabels para mostrar quantidade DENTRO do gráfico
 *  - Mostra "Parque Paraíso: 265" tanto na legenda quanto sobre as barras/fatias
 *  - Layout mais compacto (cabe em 1366×768 sem zoom)
 *
 * REQUER no index.html (DEPOIS do Chart.js):
 *   <script src="https://unpkg.com/chart.js@4.4.0/dist/chart.umd.js"></script>
 *   <script src="https://unpkg.com/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>
 */

'use strict';

(function () {

  let filtros = { bairro: '', cidade: '', lideranca_id: '' };
  let dadosCache = null;
  let graficos = {};

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
    'pie':       { label: '🥧 Pizza',             chartType: 'pie' },
    'doughnut':  { label: '🍩 Rosca',             chartType: 'doughnut' },
    'bar-v':     { label: '📊 Barras verticais',  chartType: 'bar' },
    'bar-h':     { label: '📊 Barras horizontais', chartType: 'bar' },
    'line':      { label: '📈 Linha',             chartType: 'line' },
    'radar':     { label: '🕸️ Radar',             chartType: 'radar' },
  };

  async function openDashboard() {
    await render();
  }

  async function render() {
    const container = document.getElementById('dashboard-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:2rem;color:var(--muted);text-align:center;">Carregando dashboard…</div>';

    try {
      const qs = new URLSearchParams();
      if (filtros.bairro)       qs.set('bairro', filtros.bairro);
      if (filtros.cidade)       qs.set('cidade', filtros.cidade);
      if (filtros.lideranca_id) qs.set('lideranca_id', filtros.lideranca_id);

      dadosCache = await window.API.get('/dashboard/stats' + (qs.toString() ? '?' + qs.toString() : ''));
      container.innerHTML = renderHTML(dadosCache);
      bind();

      // Aguarda DOM montar antes de renderizar gráficos
      requestAnimationFrame(() => {
        renderGraficoPrincipal();
        renderGraficoSecundario();
      });
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
      <!-- HEADER compacto -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.8rem;flex-wrap:wrap;gap:0.6rem;">
        <div>
          <div style="font-family:'Fraunces',serif;font-size:1.3rem;font-weight:700;color:var(--navy);line-height:1.1;">
            Dashboard Analítico
          </div>
          <div style="font-size:0.76rem;color:var(--muted);">
            ${d.meta?.candidato ? `${esc(d.meta.candidato)} · ${esc(d.meta.cargo || '')}` : 'Visão geral'}
            ${filtroAtivo ? ' · <strong style="color:var(--gold);">Filtro ativo</strong>' : ''}
          </div>
        </div>
        <button class="btn btn-secondary" id="btn-dash-refresh" style="font-size:0.78rem;padding:0.35rem 0.7rem;">🔄 Atualizar</button>
      </div>
<!-- FILTROS — padrão do sistema -->
      <div class="filters" style="margin-bottom:0.7rem;">
        <select id="filtro-dash-bairro">
          <option value="">Todos os bairros</option>
          ${(d.filtros_disponiveis?.bairros || []).map(b => `<option value="${esc(b)}" ${filtros.bairro === b ? 'selected' : ''}>${esc(b)}</option>`).join('')}
        </select>
        <select id="filtro-dash-cidade">
          <option value="">Todas as cidades</option>
          ${(d.filtros_disponiveis?.cidades || []).map(c => `<option value="${esc(c)}" ${filtros.cidade === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
        <select id="filtro-dash-lideranca">
          <option value="">Todas as lideranças</option>
          ${(d.filtros_disponiveis?.liderancas || []).map(l => `<option value="${l.id}" ${String(filtros.lideranca_id) === String(l.id) ? 'selected' : ''}>${esc(l.nome)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" id="btn-dash-clear-filters">Limpar filtros</button>
      </div>

      <!-- KPIs compactos -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:0.5rem;margin-bottom:0.7rem;">
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
        <div class="panel" style="margin-bottom:0.7rem;padding:0.7rem 0.9rem;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:0.3rem;">
            <div style="font-weight:600;color:var(--navy);font-size:0.85rem;">Meta Global de Votos</div>
            <div style="font-size:0.76rem;color:var(--muted);">${projecao.toLocaleString('pt-BR')} de ${d.meta.meta.toLocaleString('pt-BR')}</div>
          </div>
          <div style="background:var(--line);border-radius:99px;height:10px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#22c55e,#84cc16,var(--gold));height:10px;width:${Math.min(pctMeta||0,100)}%;transition:width 0.6s;border-radius:99px;"></div>
          </div>
          <div style="text-align:right;font-family:'Fraunces',serif;font-size:1.1rem;font-weight:700;color:var(--gold);margin-top:0.2rem;">${pctMeta}%</div>
        </div>` : ''}

      <!-- GRÁFICO PRINCIPAL (compacto, com data labels) -->
      <div class="panel" style="padding:0.8rem 0.9rem;margin-bottom:0.7rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.7rem;flex-wrap:wrap;margin-bottom:0.6rem;">
          <div>
            <div style="font-weight:600;color:var(--navy);font-size:0.9rem;">Gráfico Personalizado</div>
            <div style="font-size:0.7rem;color:var(--muted);">Escolha o que ver e como ver</div>
          </div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            <select id="dash-metrica" style="font-size:0.78rem;padding:0.25rem 0.5rem;">
              ${Object.entries(METRICAS).map(([k, m]) => `<option value="${k}">${m.icone} ${m.label}</option>`).join('')}
            </select>
            <select id="dash-tipo-grafico" style="font-size:0.78rem;padding:0.25rem 0.5rem;">
              ${Object.entries(TIPOS_GRAFICO).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div style="position:relative;height:300px;">
          <canvas id="dash-grafico-principal"></canvas>
        </div>
      </div>

      <!-- GRÁFICO SECUNDÁRIO + INSIGHTS lado a lado -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;margin-bottom:0.7rem;">
        <div class="panel" style="padding:0.8rem 0.9rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:0.5rem;font-size:0.88rem;">Intenção de Voto</div>
          <div style="position:relative;height:200px;">
            <canvas id="dash-grafico-intencao"></canvas>
          </div>
        </div>
        <div class="panel" style="padding:0.8rem 0.9rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:0.5rem;font-size:0.88rem;">Insights Automáticos</div>
          <div id="dash-insights" style="max-height:200px;overflow-y:auto;">${renderInsights(d)}</div>
        </div>
      </div>

      <!-- TABELA: Performance de Lideranças -->
      <div class="panel" style="padding:0.8rem 0.9rem;">
        <div style="font-weight:600;color:var(--navy);margin-bottom:0.6rem;font-size:0.88rem;">Performance por Liderança</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;font-size:0.8rem;">
            <thead><tr>
              <th>Liderança</th>
              <th>Partido</th>
              <th style="text-align:center;">Cadast.</th>
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
                  <td style="font-size:0.76rem;color:var(--muted);">${esc(l.partido || '—')}</td>
                  <td style="text-align:center;font-weight:600;">${l.cadastrados}</td>
                  <td style="text-align:center;color:var(--muted);">${l.meta || '—'}</td>
                  <td style="text-align:center;color:#22c55e;">${l.confirmados}</td>
                  <td style="text-align:center;color:#84cc16;">${l.provaveis}</td>
                  <td style="text-align:center;color:#f97316;">${l.em_risco}</td>
                  <td style="text-align:center;font-weight:700;color:var(--navy);">${l.projecao_total}</td>
                  <td>
                    ${l.meta > 0 ? `
                      <div style="display:flex;align-items:center;gap:0.4rem;">
                        <div style="flex:1;background:var(--line);border-radius:99px;height:5px;min-width:60px;">
                          <div style="background:var(--gold);height:5px;border-radius:99px;width:${Math.min(l.pct_meta_projecao,100)}%;"></div>
                        </div>
                        <span style="font-size:0.7rem;color:var(--muted);white-space:nowrap;">${l.pct_meta_projecao}%</span>
                      </div>` : '<span style="color:var(--muted);font-size:0.7rem;">—</span>'}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;

    function kpi(label, value, icon, cor) {
      return `
        <div class="panel" style="padding:0.55rem 0.7rem;border-left:3px solid ${cor};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-size:0.62rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">${label}</div>
            <div style="font-size:0.85rem;opacity:0.5;">${icon}</div>
          </div>
          <div style="font-family:'Fraunces',serif;font-size:1.2rem;font-weight:700;color:var(--navy);margin-top:0.15rem;line-height:1.1;">
            ${(value || 0).toLocaleString('pt-BR')}
          </div>
        </div>`;
    }
  }

  function renderInsights(d) {
    const t = d.totais;
    const insights = [];

    const taxaConfirmacao = t.total_eleitores > 0
      ? Math.round((t.confirmados / t.total_eleitores) * 100) : 0;
    if (taxaConfirmacao < 20) {
      insights.push({ icon: '⚠️', cor: '#f59e0b', txt: `Taxa de confirmados baixa (${taxaConfirmacao}%). Sugestão: campanha de validação.` });
    } else if (taxaConfirmacao > 60) {
      insights.push({ icon: '✅', cor: '#22c55e', txt: `Taxa de confirmados sólida (${taxaConfirmacao}%). Base bem qualificada!` });
    }

    if (t.novos_semana > 0) {
      const projecaoMes = Math.round(t.novos_semana * 4.3);
      insights.push({ icon: '📈', cor: '#3b82f6', txt: `Cadastrando ${t.novos_semana}/semana. Projeção: ${projecaoMes} novos em 30 dias.` });
    } else if (t.novos_mes === 0 && t.total_eleitores > 0) {
      insights.push({ icon: '🐢', cor: '#9ca3af', txt: 'Nenhum cadastro novo nos últimos 30 dias.' });
    }

    if (d.top_bairros?.length) {
      const topBairro = d.top_bairros[0];
      const pctTop = t.total_eleitores > 0 ? Math.round((topBairro.total / t.total_eleitores) * 100) : 0;
      if (pctTop > 30) {
        insights.push({ icon: '📍', cor: '#8b5cf6', txt: `${pctTop}% da base em <strong>${esc(topBairro.bairro)}</strong>. Considere expandir.` });
      }
    }

    if (d.projecao_liderancas?.length) {
      const semCadastros = d.projecao_liderancas.filter(l => l.cadastrados === 0);
      if (semCadastros.length > 0) {
        insights.push({ icon: '🚨', cor: '#dc2626', txt: `${semCadastros.length} liderança${semCadastros.length > 1 ? 's' : ''} sem cadastros.` });
      }
    }

    if (t.em_risco > 0 && t.total_eleitores > 0) {
      const pctRisco = Math.round((t.em_risco / t.total_eleitores) * 100);
      if (pctRisco > 10) {
        insights.push({ icon: '🟠', cor: '#f97316', txt: `${pctRisco}% da base em risco. Priorize contato.` });
      }
    }

    if (!insights.length) {
      return '<div style="padding:1rem;color:var(--muted);font-size:0.8rem;text-align:center;">Cadastre mais eleitores para gerar insights.</div>';
    }

    return insights.slice(0, 5).map(i => `
      <div style="display:flex;gap:0.5rem;padding:0.5rem 0.6rem;background:var(--cream);border-radius:4px;margin-bottom:0.3rem;border-left:3px solid ${i.cor};">
        <div style="font-size:0.95rem;line-height:1;">${i.icon}</div>
        <div style="font-size:0.76rem;line-height:1.35;color:#374151;">${i.txt}</div>
      </div>`).join('');
  }

  /* ════════════════════════════════════════════════
     GRÁFICO PRINCIPAL — com data labels!
  ════════════════════════════════════════════════ */
  function renderGraficoPrincipal() {
    const metricaKey = document.getElementById('dash-metrica')?.value || 'eleitores_bairro';
    const tipoKey = document.getElementById('dash-tipo-grafico')?.value || METRICAS[metricaKey].tipoPadrao;
    const metrica = METRICAS[metricaKey];
    if (!metrica || !dadosCache) return;

    const dados = metrica.getData(dadosCache);
    const canvas = document.getElementById('dash-grafico-principal');
    if (!canvas) return;

    if (graficos.principal) { graficos.principal.destroy(); graficos.principal = null; }
    if (!window.Chart) {
      canvas.parentElement.innerHTML = '<div style="padding:1.5rem;color:var(--danger);text-align:center;">Chart.js não carregou. Recarregue a página.</div>';
      return;
    }

    // Registra o plugin de datalabels se disponível
    const hasDataLabels = typeof window.ChartDataLabels !== 'undefined';
    if (hasDataLabels) {
      try { Chart.register(window.ChartDataLabels); } catch {}
    }

    const tipo = TIPOS_GRAFICO[tipoKey];
    const cores = dados.colors || gerarCores(dados.labels.length);
    const isHorizontal = tipoKey === 'bar-h';
    const isSlice = tipoKey === 'pie' || tipoKey === 'doughnut';
    const suffix = dados.suffix || '';

    // Configuração do plugin de data labels
    const datalabels = hasDataLabels ? {
      color: isSlice ? '#fff' : '#1e2a4a',
      font: {
        weight: 'bold',
        size: 11,
      },
      anchor: isSlice ? 'center' : (isHorizontal ? 'end' : 'end'),
      align: isSlice ? 'center' : (isHorizontal ? 'right' : 'top'),
      offset: isSlice ? 0 : 4,
      formatter: (value, ctx) => {
        if (isSlice) {
          // Em pizzas, mostra "Label: Valor"
          const label = ctx.chart.data.labels[ctx.dataIndex];
          // Em fatias muito pequenas (<3%), oculta para não poluir
          const total = ctx.dataset.data.reduce((a,b) => a+b, 0);
          if (value / total < 0.03) return '';
          return `${label}\n${value}${suffix}`;
        }
        // Em barras/linhas, mostra só o valor
        return `${value}${suffix}`;
      },
      textShadowBlur: isSlice ? 4 : 0,
      textShadowColor: isSlice ? 'rgba(0,0,0,0.5)' : 'transparent',
      // Em barras horizontais, posiciona DENTRO da barra se valor grande
      backgroundColor: isHorizontal ? function(ctx) {
        return ctx.dataset.backgroundColor;
      } : null,
      borderRadius: isHorizontal ? 4 : 0,
      padding: isHorizontal ? { left: 4, right: 4, top: 1, bottom: 1 } : 0,
    } : { display: false };

    graficos.principal = new Chart(canvas.getContext('2d'), {
      type: tipo.chartType,
      data: {
        labels: dados.labels,
        datasets: [{
          label: metrica.label,
          data: dados.values,
          backgroundColor: isSlice ? cores : (isHorizontal ? cores : (cores[0] || '#c9a961')),
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
        layout: { padding: { top: 10, right: 30, bottom: 5, left: 5 } },
        plugins: {
          legend: {
            display: isSlice,
            position: 'right',
            labels: {
              font: { size: 11 },
              generateLabels: isSlice ? function(chart) {
                const data = chart.data;
                if (data.labels.length && data.datasets.length) {
                  const ds = data.datasets[0];
                  return data.labels.map((label, i) => ({
                    text: `${label}: ${ds.data[i]}${suffix}`,
                    fillStyle: Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor,
                    strokeStyle: '#fff',
                    lineWidth: 1,
                    hidden: false,
                    index: i,
                  }));
                }
                return [];
              } : undefined,
            }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const v = ctx.parsed[isHorizontal ? 'x' : (isSlice ? null : 'y')] ?? ctx.parsed;
                return `${ctx.label}: ${v}${suffix}`;
              }
            }
          },
          datalabels: datalabels,
        },
        scales: isSlice ? {} : {
          x: {
            ticks: { font: { size: 10 } },
            beginAtZero: isHorizontal,
          },
          y: {
            ticks: {
              font: { size: 10 },
              autoSkip: false,
              // Em horizontal, formata o label "Bairro (N)"
              callback: isHorizontal ? function(value, index) {
                const label = this.getLabelForValue(value);
                const v = dados.values[index];
                return `${label} (${v})`;
              } : undefined,
            },
            beginAtZero: !isHorizontal,
          },
        },
      },
    });
  }

  function renderGraficoSecundario() {
    const canvas = document.getElementById('dash-grafico-intencao');
    if (!canvas || !dadosCache) return;
    if (graficos.intencao) { graficos.intencao.destroy(); graficos.intencao = null; }
    if (!window.Chart) return;

    const hasDataLabels = typeof window.ChartDataLabels !== 'undefined';

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
            labels: {
              font: { size: 10 },
              padding: 6,
              generateLabels: function(chart) {
                const data = chart.data;
                if (data.labels.length && data.datasets.length) {
                  const ds = data.datasets[0];
                  return data.labels.map((label, i) => ({
                    text: `${label}: ${ds.data[i]}`,
                    fillStyle: Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor,
                    strokeStyle: '#fff',
                    lineWidth: 1,
                    hidden: false,
                    index: i,
                  }));
                }
                return [];
              },
            }
          },
          datalabels: hasDataLabels ? {
            color: '#fff',
            font: { weight: 'bold', size: 11 },
            formatter: (value, ctx) => {
              const total = ctx.dataset.data.reduce((a,b) => a+b, 0);
              if (total === 0 || value / total < 0.05) return '';
              return value;
            },
            textShadowBlur: 4,
            textShadowColor: 'rgba(0,0,0,0.5)',
          } : { display: false },
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
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.GEDashboard = { openDashboard };

  console.log('[DASHBOARD v4] Módulo carregado.');

})();
