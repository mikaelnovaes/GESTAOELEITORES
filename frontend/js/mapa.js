/**
 * frontend/js/mapa.js (v7 — auto-geocode + análise de falhas)
 *
 * MUDANÇAS vs v6:
 *  - Auto-geocodifica pendentes ao abrir a tela (uma vez por sessão de view)
 *  - Botão "🔍 Ver falhas" abre modal com lista detalhada + motivo da falha
 *  - Stats agora separa "no_address" de "failed"
 *  - Mostra resumo de motivos das falhas no painel lateral
 */

'use strict';

(function () {

  let map = null;
  let clusterGroup = null;
  let heatLayer = null;
  let pontos = [];
  let pollingInterval = null;
  let mostrarHeatmap = true;
  let mostrarPins = true;
  let autoGeocodeJaFeito = false;
  let statsCache = null;

  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function ensureMap() {
    if (map) return map;
    const container = document.getElementById('mapa-container');
    if (!container) return null;
    if (typeof L === 'undefined') {
      container.innerHTML = '<div style="padding:2rem;color:var(--danger);text-align:center;">Leaflet não carregou. Recarregue a página.</div>';
      return null;
    }

    map = L.map('mapa-container', {
      center: [-23.5505, -46.6333],
      zoom: 11,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    if (typeof L.markerClusterGroup === 'function') {
      clusterGroup = L.markerClusterGroup({
        showCoverageOnHover: false,
        spiderfyOnMaxZoom: true,
        maxClusterRadius: 50,
      });
      map.addLayer(clusterGroup);
    }
    return map;
  }

  function makeIcon(tipo) {
    const cor = tipo === 'lideranca' ? '#8b5cf6' : '#c9a961';
    const icone = tipo === 'lideranca' ? '⭐' : '👤';
    return L.divIcon({
      html: `<div style="background:${cor};width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);">${icone}</div>`,
      className: 'ge-marker-icon',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  function buildPopup(p) {
    const titulo = esc(p.nome || '—');
    const tipoLabel = p.tipo === 'lideranca' ? '⭐ Liderança' : '👤 Eleitor';
    const endLinha = [p.endereco, p.numero].filter(Boolean).join(', ');
    return `
      <div style="min-width:200px;font-family:'Inter Tight',sans-serif;">
        <div style="font-weight:700;font-size:1rem;color:#1e2a4a;margin-bottom:0.3rem;">${titulo}</div>
        <div style="font-size:0.78rem;color:#6b7280;margin-bottom:0.5rem;">${tipoLabel}</div>
        ${endLinha ? `<div style="font-size:0.85rem;margin-bottom:0.2rem;">${esc(endLinha)}</div>` : ''}
        ${p.bairro || p.cidade ? `<div style="font-size:0.85rem;color:#4b5563;">${esc([p.bairro, p.cidade].filter(Boolean).join(' — '))}</div>` : ''}
        ${p.telefone ? `<div style="font-size:0.85rem;color:#4b5563;margin-top:0.4rem;">📞 ${esc(p.telefone)}</div>` : ''}
        ${p.cargo ? `<div style="font-size:0.78rem;color:#8b5cf6;margin-top:0.3rem;">🎯 ${esc(p.cargo)}</div>` : ''}
      </div>`;
  }

  async function loadPoints() {
    try {
      const tipo = document.getElementById('map-filter-tipo')?.value || 'ambos';
      const bairro = document.getElementById('map-filter-bairro')?.value || '';
      const cidade = document.getElementById('map-filter-cidade')?.value || '';
      const lideranca = document.getElementById('map-filter-lideranca')?.value || '';

      const qs = new URLSearchParams();
      if (tipo !== 'ambos') qs.set('tipo', tipo);
      if (bairro) qs.set('bairro', bairro);
      if (cidade) qs.set('cidade', cidade);
      if (lideranca) qs.set('lideranca_id', lideranca);

      const url = '/mapa/pontos' + (qs.toString() ? '?' + qs.toString() : '');
      const r = await window.API.get(url);
      pontos = Array.isArray(r) ? r : (r.pontos || r.data || []);
      renderPoints();
      atualizarAnaliseBairros();
    } catch (err) {
      window.showToast?.('Erro ao carregar mapa: ' + err.message, 'error');
    }
  }

  function renderPoints() {
    if (!map) return;
    if (clusterGroup) clusterGroup.clearLayers();
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

    if (!pontos.length) {
      const el = document.getElementById('map-status');
      if (el) el.textContent = 'Nenhum ponto neste filtro';
      return;
    }

    if (mostrarHeatmap && typeof L.heatLayer === 'function') {
      const heatData = pontos.map(p => {
        const peso = p.tipo === 'lideranca' ? 3 : 1;
        return [p.latitude, p.longitude, peso];
      });
      heatLayer = L.heatLayer(heatData, {
        radius: 35,
        blur: 25,
        maxZoom: 17,
        minOpacity: 0.4,
        gradient: { 0.0:'#3b82f6', 0.3:'#22c55e', 0.5:'#eab308', 0.7:'#f97316', 1.0:'#dc2626' }
      });
      map.addLayer(heatLayer);
    }

    if (mostrarPins && clusterGroup) {
      pontos.forEach(p => {
        if (!p.latitude || !p.longitude) return;
        const m = L.marker([p.latitude, p.longitude], { icon: makeIcon(p.tipo) });
        m.bindPopup(buildPopup(p));
        clusterGroup.addLayer(m);
      });
    }

    if (pontos.length) {
      const bounds = L.latLngBounds(pontos.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    const el = document.getElementById('map-status');
    if (el) el.textContent = `${pontos.length} ponto${pontos.length !== 1 ? 's' : ''} no mapa`;
  }

  function atualizarAnaliseBairros() {
    const container = document.getElementById('mapa-analise-bairros');
    if (!container) return;

    const porBairro = {};
    pontos.forEach(p => {
      const b = p.bairro || '— Sem bairro';
      if (!porBairro[b]) porBairro[b] = { eleitores: 0, liderancas: 0, total: 0 };
      if (p.tipo === 'lideranca') porBairro[b].liderancas++;
      else porBairro[b].eleitores++;
      porBairro[b].total++;
    });

    const ordenados = Object.entries(porBairro)
      .map(([nome, v]) => ({ nome, ...v }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    if (!ordenados.length) {
      container.innerHTML = '<div style="padding:1rem;color:var(--muted);font-size:0.85rem;">Sem dados</div>';
      return;
    }

    const maxTotal = ordenados[0].total;

    container.innerHTML = `
      <div style="font-weight:600;color:var(--navy);margin-bottom:0.8rem;font-size:0.9rem;">
        🌡️ Termômetro por Bairro
      </div>
      <div style="font-size:0.7rem;color:var(--muted);margin-bottom:0.6rem;">
        Top ${ordenados.length} concentrações
      </div>
      ${ordenados.map((b) => {
        const pct = (b.total / maxTotal) * 100;
        const corBarra = pct >= 80 ? '#dc2626' :
                         pct >= 60 ? '#f97316' :
                         pct >= 40 ? '#eab308' :
                         pct >= 20 ? '#22c55e' : '#3b82f6';
        return `
          <div style="margin-bottom:0.5rem;">
            <div style="display:flex;justify-content:space-between;font-size:0.74rem;margin-bottom:0.15rem;">
              <span style="color:var(--navy);font-weight:500;" title="${esc(b.nome)}">${esc(b.nome.length > 22 ? b.nome.substring(0, 22) + '…' : b.nome)}</span>
              <span style="color:var(--muted);">${b.total}</span>
            </div>
            <div style="background:#f3f4f6;border-radius:99px;height:6px;overflow:hidden;">
              <div style="background:${corBarra};height:6px;border-radius:99px;width:${pct}%;transition:width 0.3s;"></div>
            </div>
            <div style="font-size:0.65rem;color:var(--muted);margin-top:0.1rem;">
              👤 ${b.eleitores} · ⭐ ${b.liderancas}
            </div>
          </div>`;
      }).join('')}
    `;
  }

  function populateFilterDropdowns() {
    const bairros = [...new Set(pontos.map(p => p.bairro).filter(Boolean))].sort();
    const cidades = [...new Set(pontos.map(p => p.cidade).filter(Boolean))].sort();
    fillSelect('map-filter-bairro', bairros, 'Todos os bairros');
    fillSelect('map-filter-cidade', cidades, 'Todas as cidades');
  }
  function fillSelect(id, items, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const valorAtual = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(it => `<option value="${esc(it)}" ${valorAtual === it ? 'selected' : ''}>${esc(it)}</option>`).join('');
  }

  async function populateLiderancasDropdown() {
    if (!window.GELiderancas) return;
    try {
      const lids = await window.GELiderancas.fetchAll();
      const sel = document.getElementById('map-filter-lideranca');
      if (!sel) return;
      const atual = sel.value;
      sel.innerHTML = '<option value="">Todas as lideranças</option>' +
        lids.map(l => `<option value="${l.id}" ${atual === String(l.id) ? 'selected' : ''}>${esc(l.nome)}</option>`).join('');
    } catch {}
  }

  async function loadStats() {
    try {
      const stats = await window.API.get('/mapa/stats');
      statsCache = stats;
      const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v ?? '—').toLocaleString('pt-BR'); };
      setStat('map-stat-e-total', stats.eleitores_total);
      setStat('map-stat-e-geocoded', stats.eleitores_geocoded);
      setStat('map-stat-e-pending', stats.eleitores_pending);
      // Falhas = failed + no_address (mostra TOTAL com tooltip)
      const totFalhasE = (stats.eleitores_failed || 0) + (stats.eleitores_no_address || 0);
      setStat('map-stat-e-failed', totFalhasE);
      const failedEl = document.getElementById('map-stat-e-failed');
      if (failedEl) {
        failedEl.title = `${stats.eleitores_failed || 0} não encontrados + ${stats.eleitores_no_address || 0} sem endereço completo`;
        failedEl.style.cursor = 'pointer';
        failedEl.style.textDecoration = 'underline';
        failedEl.style.color = '#dc2626';
      }
      setStat('map-stat-l-total', stats.liderancas_total);
      setStat('map-stat-l-geocoded', stats.liderancas_geocoded);
      setStat('map-stat-l-pending', stats.liderancas_pending);
      setStat('map-stat-l-failed', (stats.liderancas_failed || 0) + (stats.liderancas_no_address || 0));
    } catch (err) {
      console.error('[MAPA] loadStats:', err);
    }
  }

  /* ═══════════════════════════════════════════════
     AUTO-GEOCODE AO ABRIR (apenas se tem pendentes)
  ═══════════════════════════════════════════════ */
  async function autoGeocode() {
    if (autoGeocodeJaFeito) return;
    autoGeocodeJaFeito = true;
    try {
      const pendentes = (statsCache?.eleitores_pending || 0) + (statsCache?.liderancas_pending || 0);
      if (pendentes === 0) return;

      console.log(`[MAPA] Auto-geocodificando ${pendentes} pendentes...`);
      window.showToast?.(`Geocodificando ${pendentes} endereços em segundo plano…`, 'info');

      const r = await window.API.post('/mapa/geocode-pendentes', {});
      if (r.scheduled > 0) {
        // Recarrega stats periodicamente
        const intervalo = setInterval(async () => {
          await loadStats();
          await loadPoints();
          const aindaPendente = (statsCache?.eleitores_pending || 0) + (statsCache?.liderancas_pending || 0);
          if (aindaPendente === 0) {
            clearInterval(intervalo);
            window.showToast?.('Geocodificação concluída!', 'success');
          }
        }, 15000);
        // Para o intervalo se sair da view
        setTimeout(() => clearInterval(intervalo), 5 * 60 * 1000); // 5 min máx
      }
    } catch (err) {
      console.error('[MAPA] autoGeocode:', err);
    }
  }

  /* ═══════════════════════════════════════════════
     MODAL DE FALHAS — mostra o motivo de cada falha
  ═══════════════════════════════════════════════ */
  async function abrirModalFalhas() {
    let modal = document.getElementById('modal-mapa-falhas');
    if (!modal) {
      // Cria modal dinamicamente se não existir
      modal = document.createElement('div');
      modal.id = 'modal-mapa-falhas';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal" style="max-width:760px;max-height:88vh;">
          <div class="modal-header">
            <div class="modal-title">⚠️ Endereços com Falha de Geocodificação</div>
            <button class="modal-close" data-close-falhas>×</button>
          </div>
          <div class="modal-body" style="overflow-y:auto;max-height:65vh;">
            <div id="modal-mapa-falhas-body" style="padding:0.5rem;">Carregando…</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-close-falhas>Fechar</button>
            <button class="btn btn-primary" id="btn-retry-falhas">🔄 Tentar geocodificar novamente</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelectorAll('[data-close-falhas]').forEach(b =>
        b.addEventListener('click', () => modal.classList.remove('show'))
      );
      document.getElementById('btn-retry-falhas')?.addEventListener('click', async () => {
        try {
          window.showToast?.('Retentando geocodificação…', 'info');
          await window.API.post('/mapa/geocode-pendentes', {});
          modal.classList.remove('show');
          setTimeout(async () => { await loadStats(); await loadPoints(); }, 3000);
        } catch (err) {
          window.showToast?.('Erro: ' + err.message, 'error');
        }
      });
    }
    modal.classList.add('show');

    const body = document.getElementById('modal-mapa-falhas-body');
    body.innerHTML = '<div style="padding:2rem;color:var(--muted);text-align:center;">Carregando…</div>';

    try {
      const r = await window.API.get('/mapa/falhas?limit=200');
      if (!r.registros?.length) {
        body.innerHTML = '<div style="padding:2rem;color:var(--muted);text-align:center;">🎉 Nenhuma falha! Todos os endereços foram geocodificados.</div>';
        return;
      }

      const labelsMotivo = {
        'no_city': '🏙️ Cidade não preenchida',
        'no_address': '📍 Endereço incompleto',
        'not_found': '❓ Endereço não encontrado',
      };

      body.innerHTML = `
        <div style="margin-bottom:1rem;padding:0.8rem 1rem;background:var(--cream);border-radius:5px;font-size:0.85rem;">
          <strong>Total de falhas: ${r.total}</strong>
          <div style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.6rem;">
            ${Object.entries(r.resumo).map(([k, v]) => `
              <div style="background:#fff;padding:0.4rem 0.7rem;border-radius:4px;border-left:3px solid #f97316;">
                <div style="font-size:0.75rem;color:var(--muted);">${labelsMotivo[k] || k}</div>
                <div style="font-weight:700;color:var(--navy);">${v}</div>
              </div>`).join('')}
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;font-size:0.8rem;">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Nome</th>
                <th>Endereço cadastrado</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              ${r.registros.slice(0, 100).map(reg => `
                <tr>
                  <td style="font-size:0.72rem;">${reg.tipo === 'eleitor' ? '👤' : '⭐'}</td>
                  <td><strong>${esc(reg.nome)}</strong></td>
                  <td style="font-size:0.78rem;color:#4b5563;">${esc(reg.endereco_completo || '(vazio)')}</td>
                  <td>
                    <div style="font-size:0.78rem;font-weight:600;color:#dc2626;">${esc(reg.motivo_label)}</div>
                    <div style="font-size:0.72rem;color:var(--muted);margin-top:0.2rem;">💡 ${esc(reg.sugestao)}</div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
          ${r.registros.length > 100 ? `<div style="padding:1rem;text-align:center;color:var(--muted);font-size:0.85rem;">+ ${r.registros.length - 100} registros adicionais não mostrados</div>` : ''}
        </div>
      `;
    } catch (err) {
      body.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${esc(err.message)}</div>`;
    }
  }

  async function geocodePendentes() {
    try {
      const r = await window.API.post('/mapa/geocode-pendentes', {});
      window.showToast?.(r.message || `Processando ${r.scheduled} registros…`, 'success');
      setTimeout(async () => { await loadStats(); await loadPoints(); }, 2000);
    } catch (err) {
      window.showToast?.('Erro: ' + err.message, 'error');
    }
  }

  function iniciarPolling() {
    pararPolling();
    pollingInterval = setInterval(async () => {
      const view = document.getElementById('view-mapa');
      if (!view || getComputedStyle(view).display === 'none') return;
      await loadStats();
      await loadPoints();
    }, 30000);
  }
  function pararPolling() {
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  }

  function bindListeners() {
    document.getElementById('btn-map-refresh')?.addEventListener('click', async () => {
      await loadStats(); await loadPoints();
    });
    document.getElementById('btn-map-geocode-pendentes')?.addEventListener('click', geocodePendentes);

    // Clique no número de falhas abre o modal
    document.getElementById('map-stat-e-failed')?.addEventListener('click', abrirModalFalhas);
    document.getElementById('map-stat-l-failed')?.addEventListener('click', abrirModalFalhas);

    // Botão dedicado "Ver falhas" (se existir)
    document.getElementById('btn-map-ver-falhas')?.addEventListener('click', abrirModalFalhas);

    document.getElementById('map-filter-tipo')?.addEventListener('change', loadPoints);
    document.getElementById('map-filter-bairro')?.addEventListener('change', loadPoints);
    document.getElementById('map-filter-cidade')?.addEventListener('change', loadPoints);
    document.getElementById('map-filter-lideranca')?.addEventListener('change', loadPoints);
    document.getElementById('btn-map-clear-filters')?.addEventListener('click', () => {
      ['map-filter-tipo','map-filter-bairro','map-filter-cidade','map-filter-lideranca'].forEach(id => {
        const sel = document.getElementById(id);
        if (sel) sel.value = '';
      });
      const tipo = document.getElementById('map-filter-tipo');
      if (tipo) tipo.value = 'ambos';
      loadPoints();
    });

    document.getElementById('map-toggle-heatmap')?.addEventListener('change', (ev) => {
      mostrarHeatmap = ev.target.checked;
      renderPoints();
    });
    document.getElementById('map-toggle-pins')?.addEventListener('change', (ev) => {
      mostrarPins = ev.target.checked;
      renderPoints();
    });
  }

  async function openMap() {
    setTimeout(async () => {
      ensureMap();
      if (map) map.invalidateSize();
      await loadStats();
      await loadPoints();
      populateFilterDropdowns();
      await populateLiderancasDropdown();
      bindListeners();
      iniciarPolling();
      // Auto-geocodifica em segundo plano se houver pendentes
      autoGeocode();
    }, 200);
  }

  window.GEMapa = { openMap, loadPoints, loadStats, pararPolling, abrirModalFalhas };

  console.log('[MAPA v7] Módulo carregado.');

})();
