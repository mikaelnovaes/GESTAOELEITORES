/***
 * frontend/js/elections.js
 * Menu Eleições — Calculadora de Coeficiente Eleitoral
 * Base: Código Eleitoral arts. 106-109 (lei 9.504/97 + reformas até 2024)
 *
 * v2 — Persistência via API (banco de dados), compartilhada por tenant
 *      Migração automática do localStorage antigo na primeira abertura
 *
 * Expõe: window.GEElections.openCalculator()
 */

(function() {
  'use strict';

  const LEGACY_KEY = 'ge_elections_simulations';
  const MIGRATION_DONE_KEY = 'ge_elections_migrated_v2';

  const COLORS = ['#0e2b5c','#c9a961','#5b8dee','#2ecc8a','#e85c5c','#b06bee','#f08030','#30c0f0','#e87090','#80c050'];

  let partidos = [];
  let pid = 0;
  let currentSimId = null;
  let simulationsCache = [];

  /* ============================================================
     API HELPERS
     ============================================================ */
  async function apiList() {
    if (!window.API) return [];
    try {
      const data = await window.API.get('/elections/simulations');
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.warn('[Elections] Falha ao listar:', e.message);
      return [];
    }
  }
  async function apiCreate(payload) { return window.API.post('/elections/simulations', payload); }
  async function apiUpdate(id, payload) { return window.API.put('/elections/simulations/' + id, payload); }
  async function apiDelete(id) { return window.API.delete('/elections/simulations/' + id); }

  /* ============================================================
     MIGRAÇÃO DO localStorage ANTIGO → API
     ============================================================ */
  async function migrateLegacyData() {
    if (localStorage.getItem(MIGRATION_DONE_KEY) === '1') return;
    try {
      const raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) { localStorage.setItem(MIGRATION_DONE_KEY, '1'); return; }
      const legacy = JSON.parse(raw);
      if (!Array.isArray(legacy) || legacy.length === 0) {
        localStorage.setItem(MIGRATION_DONE_KEY, '1');
        return;
      }
      let migrated = 0, failed = 0;
      for (const sim of legacy) {
        try {
          await apiCreate({
            nome: sim.nome || ('Migrada ' + new Date().toLocaleDateString('pt-BR')),
            municipio: sim.municipio || '',
            cadeiras: sim.cadeiras || 15,
            votos_validos: sim.votos_validos || 0,
            votos_brancos: sim.votos_brancos || 0,
            votos_nulos: sim.votos_nulos || 0,
            partidos: sim.partidos || [],
          });
          migrated++;
        } catch (e) {
          failed++;
          console.warn('[Elections] Falha ao migrar:', sim.nome, e.message);
        }
      }
      localStorage.setItem(MIGRATION_DONE_KEY, '1');
      localStorage.removeItem(LEGACY_KEY);
      if (window.showToast && migrated > 0) {
        const msg = failed > 0
          ? `${migrated} simulação(ões) migrada(s) para a nuvem. ${failed} falharam.`
          : `${migrated} simulação(ões) migrada(s) para a nuvem.`;
        window.showToast('✓ ' + msg, failed > 0 ? 'warning' : 'success');
      }
    } catch (e) {
      console.warn('[Elections] Falha na migração:', e.message);
      localStorage.setItem(MIGRATION_DONE_KEY, '1');
    }
  }

  /* ============================================================
     HELPERS
     ============================================================ */
  function fmt(n) { return Math.round(n).toLocaleString('pt-BR'); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ============================================================
     PARTIDOS / CANDIDATOS
     ============================================================ */
  function addPartido() {
    const id = pid++;
    partidos.push({ id, nome: '', legenda: 0, candidatos: [], cor: COLORS[partidos.length % COLORS.length] });
    renderPartidos();
  }
  function removePartido(id) { partidos = partidos.filter(p => p.id !== id); renderPartidos(); }
  function addCandidato(partidoId) {
    const p = partidos.find(x => x.id === partidoId);
    if (p) { p.candidatos.push({ nome: '', votos: 0 }); renderPartidos(); }
  }
  function removeCandidato(partidoId, ci) {
    const p = partidos.find(x => x.id === partidoId);
    if (p) { p.candidatos.splice(ci, 1); renderPartidos(); }
  }
  function updateNome(id, v) { const p = partidos.find(x => x.id === id); if (p) p.nome = v; updateCount(); }
  function updateLegenda(id, v) { const p = partidos.find(x => x.id === id); if (p) p.legenda = +v || 0; atualizarValidacao(); }
  function updateCandNome(partidoId, ci, v) { const p = partidos.find(x => x.id === partidoId); if (p && p.candidatos[ci]) p.candidatos[ci].nome = v; }
  function updateCandVotos(partidoId, ci, v) { const p = partidos.find(x => x.id === partidoId); if (p && p.candidatos[ci]) { p.candidatos[ci].votos = +v || 0; atualizarValidacao(); } }
  function updateCount() {
    const el = document.getElementById('elec-total-partidos');
    if (el) el.textContent = partidos.length + ' partido' + (partidos.length !== 1 ? 's' : '');
  }

  // Expostas globalmente p/ inline handlers
  window.GEElec_addPartido = addPartido;
  window.GEElec_removePartido = removePartido;
  window.GEElec_addCandidato = addCandidato;
  window.GEElec_removeCandidato = removeCandidato;
  window.GEElec_updateNome = updateNome;
  window.GEElec_updateLegenda = updateLegenda;
  window.GEElec_updateCandNome = updateCandNome;
  window.GEElec_updateCandVotos = updateCandVotos;
  window.GEElec_calcular = () => calcular();
  window.GEElec_loadSim = (id) => loadSim(id);
  window.GEElec_deleteSim = (id) => deleteSim(id);

  function renderPartidos() {
    updateCount();
    const c = document.getElementById('elec-partidos-container');
    if (!c) return;
    c.innerHTML = '';
    partidos.forEach((p) => {
      const div = document.createElement('div');
      div.className = 'elec-party-card';
      let candsHtml = p.candidatos.map((cand, i) => `
        <div class="elec-cand-row">
          <input type="text" placeholder="Nome do candidato ${i+1}" value="${esc(cand.nome)}" oninput="GEElec_updateCandNome(${p.id},${i},this.value)">
          <input type="number" placeholder="Votos" min="0" value="${cand.votos || ''}" oninput="GEElec_updateCandVotos(${p.id},${i},this.value)">
          <button class="elec-btn-del" onclick="GEElec_removeCandidato(${p.id},${i})" title="Remover">✕</button>
        </div>`).join('');
      div.innerHTML = `
        <div class="elec-party-head">
          <div class="elec-color-dot" style="background:${p.cor}"></div>
          <input type="text" placeholder="Nome do partido (ex: PSD)" value="${esc(p.nome)}" oninput="GEElec_updateNome(${p.id},this.value)">
          <button class="elec-btn-del" onclick="GEElec_removePartido(${p.id})" title="Remover partido">✕</button>
        </div>
         <div class="elec-party-body">
          <div class="elec-legenda-row">
            <label>Total de votos geral (legenda + candidatos)</label>
            <input type="number" placeholder="0" min="0" value="${p.legenda || ''}" oninput="GEElec_updateLegenda(${p.id},this.value)">
          </div>
          <div class="elec-legenda-hint">Se preencher o total geral, não precisa preencher candidato por candidato.</div>
          <div class="elec-cand-list">${candsHtml}</div>
          <button class="btn btn-secondary elec-btn-add-cand" onclick="GEElec_addCandidato(${p.id})" type="button">+ candidato</button>
        </div>`;
      c.appendChild(div);
    });
    atualizarValidacao();
  }

  function atualizarValidacao() {
    const validos = +document.getElementById('elec-votos-validos')?.value || 0;
    const brancos = +document.getElementById('elec-votos-brancos')?.value || 0;
    const nulos   = +document.getElementById('elec-votos-nulos')?.value || 0;
    const total = validos + brancos + nulos;
    const displayEl = document.getElementById('elec-total-urna-display');
    if (displayEl) displayEl.textContent = total > 0 ? total.toLocaleString('pt-BR') : '—';
  }
  window.GEElec_atualizarValidacao = atualizarValidacao;

  /* ============================================================
     PERSISTÊNCIA — usa API
     ============================================================ */
  function collectPayload(nome) {
    return {
      nome: nome,
      municipio: document.getElementById('elec-municipio')?.value || '',
      cadeiras: +document.getElementById('elec-cadeiras')?.value || 15,
      votos_validos: +document.getElementById('elec-votos-validos')?.value || 0,
      votos_brancos: +document.getElementById('elec-votos-brancos')?.value || 0,
      votos_nulos:   +document.getElementById('elec-votos-nulos')?.value || 0,
      partidos: JSON.parse(JSON.stringify(partidos)),
    };
  }

  async function saveSim() {
    let nome, isNew;
    if (currentSimId) {
      const updateChoice = confirm(
        'Já existe uma simulação carregada.\n\n' +
        'OK = Atualizar a simulação atual\n' +
        'Cancelar = Salvar como NOVA simulação'
      );
      if (updateChoice) {
        const sim = simulationsCache.find(s => s.id === currentSimId);
        nome = sim?.nome || '';
        if (!nome) { nome = prompt('Nome da simulação:', '') || ''; if (!nome) return; }
        isNew = false;
      } else {
        nome = prompt('Nome para a NOVA simulação:', '');
        if (!nome) return;
        isNew = true;
      }
    } else {
      nome = prompt('Nome para esta simulação:', document.getElementById('elec-municipio')?.value || '');
      if (!nome) return;
      isNew = true;
    }

    const payload = collectPayload(nome);
    try {
      if (isNew) {
        const res = await apiCreate(payload);
        currentSimId = Number(res.id);
        if (window.showToast) window.showToast('✓ Simulação criada.', 'success');
      } else {
        await apiUpdate(currentSimId, payload);
        if (window.showToast) window.showToast('✓ Simulação atualizada.', 'success');
      }
      await renderSimList();
    } catch (err) {
      const msg = err.message || 'Erro ao salvar.';
      if (window.showToast) window.showToast(msg, 'error');
      else alert(msg);
    }
  }

  async function loadSim(id) {
    try {
      const sim = await window.API.get('/elections/simulations/' + id);
      currentSimId = Number(sim.id);
      document.getElementById('elec-municipio').value = sim.municipio || '';
      document.getElementById('elec-cadeiras').value = sim.cadeiras || 15;
      document.getElementById('elec-votos-validos').value = sim.votos_validos || '';
      document.getElementById('elec-votos-brancos').value = sim.votos_brancos || '';
      document.getElementById('elec-votos-nulos').value = sim.votos_nulos || '';

      partidos = Array.isArray(sim.partidos) ? sim.partidos.map((p, idx) => ({
        id: idx,
        nome: p.nome || '',
        legenda: +p.legenda || 0,
        cor: p.cor || COLORS[idx % COLORS.length],
        candidatos: Array.isArray(p.candidatos)
          ? p.candidatos.map(c => ({ nome: c.nome || '', votos: +c.votos || 0 }))
          : []
      })) : [];
      pid = partidos.length;

      renderPartidos();
      atualizarValidacao();
      await renderSimList();
      document.getElementById('elec-resultado').innerHTML = emptyResultHTML();
      document.getElementById('elec-result-status').textContent = 'aguardando cálculo';

      if (window.showToast) window.showToast('✓ Simulação carregada.', 'success');
    } catch (err) {
      if (window.showToast) window.showToast(err.message || 'Erro ao carregar.', 'error');
    }
  }

  async function deleteSim(id) {
    const sim = simulationsCache.find(s => s.id === id);
    const nome = sim?.nome || 'esta simulação';
    if (!confirm(`Excluir simulação "${nome}"?\n\nEsta ação não pode ser desfeita.`)) return;
    try {
      await apiDelete(id);
      if (currentSimId === id) {
        currentSimId = null;
        novaSim(true);
      }
      await renderSimList();
      if (window.showToast) window.showToast('✓ Simulação excluída.', 'success');
    } catch (err) {
      if (window.showToast) window.showToast(err.message || 'Erro ao excluir.', 'error');
    }
  }

  function novaSim(forceClean) {
    if (!forceClean && (
        partidos.some(p => p.nome || p.legenda || p.candidatos.length) ||
        document.getElementById('elec-municipio')?.value ||
        document.getElementById('elec-votos-validos')?.value
      )) {
      if (!confirm('Descartar dados atuais e começar uma nova simulação?')) return;
    }
    currentSimId = null;
    document.getElementById('elec-municipio').value = '';
    document.getElementById('elec-cadeiras').value = 15;
    document.getElementById('elec-votos-validos').value = '';
    document.getElementById('elec-votos-brancos').value = '';
    document.getElementById('elec-votos-nulos').value = '';
    partidos = [];
    pid = 0;
    addPartido(); addPartido();
    document.getElementById('elec-resultado').innerHTML = emptyResultHTML();
    document.getElementById('elec-result-status').textContent = 'aguardando cálculo';
    renderSimList();
  }

  /* ============================================================
     CÁLCULO — Código Eleitoral arts. 106-109
     ============================================================ */
  function arredondarQE(v) {
    const frac = v - Math.floor(v);
    return frac <= 0.5 ? Math.floor(v) : Math.ceil(v);
  }

  function calcular() {
    const municipio = document.getElementById('elec-municipio').value.trim() || 'Município';
    const cadeiras  = parseInt(document.getElementById('elec-cadeiras').value) || 15;
    const rdiv      = document.getElementById('elec-resultado');
    const status    = document.getElementById('elec-result-status');

    const votosValidos = +document.getElementById('elec-votos-validos').value || 0;
    const votosBrancos = +document.getElementById('elec-votos-brancos').value || 0;
    const votosNulos   = +document.getElementById('elec-votos-nulos').value || 0;
    const totalUrna    = votosValidos + votosBrancos + votosNulos;

    if (partidos.length === 0) {
      rdiv.innerHTML = '<div class="elec-alert elec-alert-red">Adicione ao menos um partido antes de calcular.</div>';
      return;
    }

let totalVotos = 0;
    const data = partidos.map(p => {
      const votosNominais = p.candidatos.reduce((s, c) => s + (+c.votos || 0), 0);
      const totalGeral = +p.legenda || 0;
      // Nova semântica: se o "total geral" do partido foi informado e é >= soma dos candidatos,
      // usa ele direto (o nominal vira a soma dos candidatos, e o resto é "votos de legenda implícitos")
      // Se total geral for 0 ou menor que a soma dos candidatos, usa só a soma dos candidatos.
      const total = totalGeral > votosNominais ? totalGeral : votosNominais;
      totalVotos += total;
      return { ...p, candidatos: p.candidatos.map(c => ({ ...c, votos: +c.votos || 0 })), votosNominais, total };
    });
    if (totalVotos === 0) {
      rdiv.innerHTML = '<div class="elec-alert elec-alert-red">Informe os votos de ao menos um candidato ou partido.</div>';
      return;
    }

    const QE    = arredondarQE(totalVotos / cadeiras);
    const min10 = QE * 0.1;
    const min80 = QE * 0.8;
    const min20 = QE * 0.2;

    // FASE 1: Quociente Partidário
    let vagasDistribuidas = 0;
    data.forEach(p => {
      p.QP = p.total >= QE ? Math.floor(p.total / QE) : 0;
      p.vagasQP = p.QP;
      p.sobraObtidas = 0;
      vagasDistribuidas += p.vagasQP;

      const sorted = [...p.candidatos].sort((a, b) => b.votos - a.votos);
      p.eleitos = [];
      p.naoEleitos = [];
      let vagasUsadas = 0;
      sorted.forEach(c => {
        if (vagasUsadas < p.vagasQP && c.votos >= min10) {
          p.eleitos.push({ ...c, motivo: 'qp' });
          vagasUsadas++;
        } else if (c.votos < min10 && vagasUsadas < p.vagasQP) {
          p.naoEleitos.push({ ...c, motivo: 'min10' });
        } else {
          p.naoEleitos.push({ ...c, motivo: 'sem_vaga' });
        }
      });
    });

    // FASE 2: Sobras
    let sobras = cadeiras - vagasDistribuidas;
    const sobrasLog = [];
    let iteracoes = 0;
    while (sobras > 0 && iteracoes < 200) {
      iteracoes++;
      data.forEach(p => {
        p.media = p.total >= min80 ? p.total / (p.vagasQP + p.sobraObtidas + 1) : 0;
      });
      const maxMedia = Math.max(...data.map(p => p.media));
      if (maxMedia <= 0) break;
      const vencedor = data.find(p => p.media === maxMedia);
      if (!vencedor) break;
      const candDisp = vencedor.naoEleitos.filter(c => c.votos >= min20 && c.motivo !== 'min10');
      let preencheu = false;
      let candEscolhido = null;
      if (candDisp.length > 0) {
        candEscolhido = candDisp[0];
        candEscolhido.motivo = 'sobra';
        vencedor.eleitos.push(candEscolhido);
        vencedor.naoEleitos = vencedor.naoEleitos.filter(c => c !== candEscolhido);
        preencheu = true;
      }
      sobrasLog.push({
        partido: vencedor.nome || 'Partido', cor: vencedor.cor,
        media: maxMedia, candidato: candEscolhido ? (candEscolhido.nome || 'Candidato') : '—', preencheu
      });
      vencedor.sobraObtidas++;
      sobras--;
    }

    const totalCadeirasPreenchidas = data.reduce((s, p) => s + p.eleitos.length, 0);
    const diffPartidos = totalVotos - votosValidos;
    status.textContent = `${totalCadeirasPreenchidas}/${cadeiras} cadeiras`;
    rdiv.innerHTML = buildResultHTML({
      municipio, cadeiras, totalUrna, votosValidos, votosBrancos, votosNulos,
      totalVotos, QE, min10, min80, data, sobrasLog, totalCadeirasPreenchidas, diffPartidos
    });

    // Feedback visual após cálculo: rola até o resultado e mostra toast
    setTimeout(() => {
      rdiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
    if (window.showToast) {
      window.showToast(`✓ Cálculo concluído. ${totalCadeirasPreenchidas}/${cadeiras} cadeiras preenchidas.`, 'success');
    }
  

  /* ============================================================
     RENDERIZAÇÃO DO RESULTADO
     ============================================================ */
  function buildResultHTML(ctx) {
    const { municipio, cadeiras, totalUrna, votosValidos, votosBrancos, votosNulos,
            totalVotos, QE, min10, min80, data, sobrasLog, totalCadeirasPreenchidas, diffPartidos } = ctx;

    let html = `
      <div class="elec-result-header">
        <div class="elec-result-municipio">${esc(municipio)}</div>
        <div class="elec-result-sub">Eleição proporcional — Código Eleitoral arts. 106-109</div>
      </div>`;

    if (totalUrna > 0 || votosValidos > 0 || votosBrancos > 0 || votosNulos > 0) {
      html += `
        <div class="elec-totals-box">
          <div class="elec-totals-label">Totais da urna</div>
          <div class="elec-totals-grid">
            ${totalUrna > 0 ? `<div class="elec-total-cell"><div class="elec-total-cap">Total urna</div><div class="elec-total-val">${fmt(totalUrna)}</div></div>` : ''}
            ${votosValidos > 0 ? `<div class="elec-total-cell"><div class="elec-total-cap">Válidos</div><div class="elec-total-val elec-text-green">${fmt(votosValidos)}</div></div>` : ''}
            ${votosBrancos > 0 ? `<div class="elec-total-cell"><div class="elec-total-cap">Brancos</div><div class="elec-total-val">${fmt(votosBrancos)}</div></div>` : ''}
            ${votosNulos > 0 ? `<div class="elec-total-cell"><div class="elec-total-cap">Nulos</div><div class="elec-total-val">${fmt(votosNulos)}</div></div>` : ''}
          </div>
          <div class="elec-alert elec-alert-green">
            ✓ Total da urna: ${fmt(votosValidos)} válidos + ${fmt(votosBrancos)} brancos + ${fmt(votosNulos)} nulos = ${fmt(totalUrna)}
          </div>`;
      if (votosValidos > 0) {
        if (diffPartidos === 0) {
          html += `<div class="elec-alert elec-alert-green" style="margin-top:6px">
            ✓ Soma dos votos dos partidos (${fmt(totalVotos)}) bate com os votos válidos
          </div>`;
        } else {
          const grave = Math.abs(diffPartidos) >= votosValidos * 0.01;
          html += `<div class="elec-alert ${grave ? 'elec-alert-red' : 'elec-alert-yellow'}" style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">
            <span>${diffPartidos > 0 ? '✕ Votos dos partidos excedem os votos válidos' : '✕ Faltam votos nos partidos para fechar os votos válidos'} (partidos: ${fmt(totalVotos)} / válidos: ${fmt(votosValidos)})</span>
            <span style="font-weight:700">${diffPartidos > 0 ? '+' : ''}${fmt(diffPartidos)}</span>
          </div>`;
        }
      }
      html += `</div>`;
    }

    html += `
      <div class="elec-metrics-grid">
        <div class="elec-metric-card">
          <div class="elec-metric-label">Votos válidos</div>
          <div class="elec-metric-value">${fmt(totalVotos)}</div>
          <div class="elec-metric-sub">nominais + legenda</div>
        </div>
        <div class="elec-metric-card">
          <div class="elec-metric-label">Quociente eleitoral</div>
          <div class="elec-metric-value">${fmt(QE)}</div>
          <div class="elec-metric-sub">votos ÷ ${cadeiras} cadeiras</div>
        </div>
        <div class="elec-metric-card">
          <div class="elec-metric-label">Mínimo individual</div>
          <div class="elec-metric-value">${fmt(Math.ceil(min10))}</div>
          <div class="elec-metric-sub">10% do QE</div>
        </div>
        <div class="elec-metric-card">
          <div class="elec-metric-label">Cadeiras preenchidas</div>
          <div class="elec-metric-value" style="color:${totalCadeirasPreenchidas === cadeiras ? 'var(--success)' : 'var(--warning)'}">${totalCadeirasPreenchidas}/${cadeiras}</div>
          <div class="elec-progress-wrap"><div class="elec-progress-bar" style="width:${(totalCadeirasPreenchidas / cadeiras * 100).toFixed(1)}%"></div></div>
        </div>
      </div>`;

    html += `
      <div class="elec-section-divider">
        <span class="elec-step-badge">1</span>
        <span class="elec-section-label">Distribuição por quociente partidário</span>
      </div>
      <table class="elec-table">
        <thead><tr><th>Partido</th><th style="text-align:right">Votos</th><th style="text-align:right">QP</th><th style="text-align:right">Vagas</th></tr></thead>
        <tbody>`;
    data.forEach(p => {
      const pct = totalVotos > 0 ? (p.total / totalVotos * 100).toFixed(1) : '0.0';
      html += `<tr>
        <td><div class="elec-row-party"><div class="elec-color-dot-sm" style="background:${p.cor}"></div><span>${esc(p.nome) || '—'}</span></div></td>
        <td style="text-align:right">${fmt(p.total)} <span class="elec-muted">(${pct}%)</span></td>
        <td style="text-align:right;font-weight:700;color:var(--gold)">${p.QP}</td>
        <td style="text-align:right">${p.vagasQP > 0 ? `<span class="elec-badge elec-badge-green">${p.vagasQP} vaga${p.vagasQP > 1 ? 's' : ''}</span>` : `<span class="elec-badge elec-badge-gray">0</span>`}</td>
      </tr>`;
    });
    html += `</tbody></table>`;

    if (sobrasLog.length > 0) {
      html += `
        <div class="elec-section-divider">
          <span class="elec-step-badge">2</span>
          <span class="elec-section-label">Distribuição de sobras por média</span>
        </div>
        <table class="elec-table">
          <thead><tr><th>Sobra</th><th>Partido</th><th style="text-align:right">Média</th><th>Candidato</th><th>Resultado</th></tr></thead>
          <tbody>`;
      sobrasLog.forEach((s, i) => {
        html += `<tr>
          <td class="elec-muted">${i + 1}ª</td>
          <td><div class="elec-row-party"><div class="elec-color-dot-sm" style="background:${s.cor}"></div>${esc(s.partido)}</div></td>
          <td style="text-align:right;font-weight:700;color:var(--gold)">${fmt(s.media)}</td>
          <td>${esc(s.candidato)}</td>
          <td>${s.preencheu ? `<span class="elec-pill elec-pill-sobra">eleito p/ sobra</span>` : `<span class="elec-pill elec-pill-out">sem candidato elegível</span>`}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    }

    html += `
      <div class="elec-section-divider">
        <span class="elec-step-badge">3</span>
        <span class="elec-section-label">Candidatos eleitos por partido</span>
      </div>`;

    data.forEach(p => {
      const totalVagas = p.vagasQP + p.sobraObtidas;
      const todos = [...p.eleitos, ...p.naoEleitos].sort((a, b) => b.votos - a.votos);
      html += `
        <div class="elec-party-result">
          <div class="elec-party-result-head">
            <div class="elec-color-dot-sm" style="background:${p.cor}"></div>
            <div class="elec-party-result-name">${esc(p.nome) || '—'}</div>
            <div class="elec-party-result-votes">${fmt(p.total)} votos</div>
            ${totalVagas > 0
              ? `<span class="elec-badge ${p.sobraObtidas > 0 ? 'elec-badge-yellow' : 'elec-badge-green'}">${totalVagas} vaga${totalVagas > 1 ? 's' : ''}${p.sobraObtidas > 0 ? ` (+${p.sobraObtidas} sobra)` : ''}</span>`
              : `<span class="elec-badge elec-badge-gray">sem vagas</span>`}
          </div>
          <div class="elec-party-result-body">`;
      if (p.total < QE) {
        html += `<div class="elec-alert elec-alert-red" style="font-size:11px;margin-bottom:8px">Não atingiu o quociente eleitoral (${fmt(QE)} votos). Participa apenas das sobras (mín. 80% QE = ${fmt(Math.ceil(min80))}).</div>`;
      }
      if (todos.length === 0) {
        html += `<div class="elec-muted" style="padding:8px 0">Nenhum candidato cadastrado.</div>`;
      } else {
        todos.forEach((c, i) => {
          const isElected = p.eleitos.includes(c);
          let pill = '';
          if (c.motivo === 'qp') pill = '<span class="elec-pill elec-pill-elected">eleito — QP</span>';
          else if (c.motivo === 'sobra') pill = '<span class="elec-pill elec-pill-sobra">eleito — sobra</span>';
          else if (c.motivo === 'min10') pill = '<span class="elec-pill elec-pill-out">não eleito — abaixo 10% QE</span>';
          else pill = '<span class="elec-pill elec-pill-out">não eleito</span>';
          html += `
            <div class="elec-cand-result-item">
              <span class="elec-cand-pos">${i + 1}.</span>
              <span class="elec-cand-result-name ${isElected ? 'elec-elected' : ''}">${esc(c.nome) || 'Candidato'}</span>
              <span class="elec-cand-result-votes">${fmt(c.votos)}</span>
              ${pill}
            </div>`;
        });
      }
      html += `</div></div>`;
    });

    return html;
  }

  function emptyResultHTML() {
    return `<div class="elec-empty">
      <div class="elec-empty-icon">🗳</div>
      <div class="elec-empty-title">Nenhum resultado ainda</div>
      <div class="elec-empty-sub">Adicione os partidos e candidatos ao lado<br>e clique em <b>Calcular resultado</b></div>
    </div>`;
  }

  /* ============================================================
     LISTA DE SIMULAÇÕES (vinda do servidor)
     ============================================================ */
  async function renderSimList() {
    const wrap = document.getElementById('elec-sim-list');
    if (!wrap) return;
    wrap.innerHTML = '<div class="elec-muted" style="padding:0.6rem 0;font-size:0.82rem">Carregando...</div>';
    simulationsCache = await apiList();
    if (!simulationsCache.length) {
      wrap.innerHTML = '<div class="elec-muted" style="padding:0.6rem 0;font-size:0.82rem">Nenhuma simulação salva.</div>';
      return;
    }
    wrap.innerHTML = simulationsCache.map(s => {
      const data = s.atualizado_em ? new Date(s.atualizado_em).toLocaleDateString('pt-BR') : '';
      const autor = s.criado_por_nome ? ' · ' + esc(s.criado_por_nome) : '';
      return `
        <div class="elec-sim-item ${s.id === currentSimId ? 'active' : ''}">
          <div class="elec-sim-info" onclick="GEElec_loadSim(${s.id})">
            <div class="elec-sim-name">${esc(s.nome)}</div>
            <div class="elec-sim-meta">${esc(s.municipio || '—')} · ${s.cadeiras || '?'} cadeiras · ${data}${autor}</div>
          </div>
          <button class="elec-btn-del" title="Excluir simulação" onclick="GEElec_deleteSim(${s.id})">✕</button>
        </div>`;
    }).join('');
  }

  /* ============================================================
     INICIALIZAÇÃO
     ============================================================ */
  let initialized = false;
  async function openCalculator() {
    if (!initialized) {
      initialized = true;
      ['elec-votos-validos','elec-votos-brancos','elec-votos-nulos'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', atualizarValidacao);
      });
      document.getElementById('btn-elec-salvar')?.addEventListener('click', saveSim);
      document.getElementById('btn-elec-novo')?.addEventListener('click', () => novaSim(false));
      addPartido(); addPartido();
      await migrateLegacyData();
    }
    await renderSimList();
  }

  window.GEElections = { openCalculator, renderSimList };

})();
