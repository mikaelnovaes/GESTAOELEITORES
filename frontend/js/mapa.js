/**
 * frontend/js/mapa.js (v6 — heatmap + pins + polling + análise por bairro)
 * Expõe: window.GEMapa.openMap()
 *
 * REQUER no index.html:
 *   <script src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"></script>
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

  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
  }

  /* ═══════════════════════════════════════════════
     INICIALIZAÇÃO DO MAPA
  ═══════════════════════════════════════════════ */
  function ensureMap() {
    if (map) return map;
    const container = document.getElementById('mapa-container');
    if (!container) return null;
    if (typeof L === 'undefined') {
      container.innerHTML = '<div style="padding:2rem;color:var(--danger);text-align:center;">Leaflet não carregou. Recarregue a página.</div>';
      return null;
    }

    map = L.map('mapa-container', {
      center: [-23.5505, -46.6333], // SP default
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

  /* ═══════════════════════════════════════════════
     ÍCONES E POPUPS
  ═══════════════════════════════════════════════ */
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

  /* ═══════════════════════════════════════════════
     CARREGAR PONTOS
  ═══════════════════════════════════════════════ */
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
      window.showToast('Erro ao carregar mapa: ' + err.message, 'error');
    }
  }

  /* ═══════════════════════════════════════════════
     RENDERIZAR PONTOS (heatmap + pins)
  ═══════════════════════════════════════════════ */
  function renderPoints() {
    if (!map) return;

    // Limpa camadas anteriores
    if (clusterGroup) clusterGroup.clearLayers();
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

    if (!pontos.length) {
      document.getElementById('map-status').textContent = 'Nenhum ponto neste filtro';
      return;
    }

    // ── HEATMAP ──
    if (mostrarHeatmap && typeof L.heatLayer === 'function') {
      const heatData = pontos.map(p => {
        // Lideranças pesam mais (peso 3x), eleitores peso 1
        const peso = p.tipo === 'lideranca' ? 3 : 1;
        return [p.latitude, p.longitude, peso];
      });
      heatLayer = L.heatLayer(heatData, {
        radius: 35,
        blur: 25,
        maxZoom: 17,
        minOpacity: 0.4,
        gradient: {
          0.0: '#3b82f6',  // azul (frio)
          0.3: '#22c55e',  // verde
          0.5: '#eab308',  // amarelo
          0.7: '#f97316',  // laranja
          1.0: '#dc2626'   // vermelho (quente)
        }
      });
      map.addLayer(heatLayer);
    }

    // ── PINS ──
    if (mostrarPins && clusterGroup) {
      pontos.forEach(p => {
        if (!p.latitude || !p.longitude) return;
        const m = L.marker([p.latitude, p.longitude], { icon: makeIcon(p.tipo) });
        m.bindPopup(buildPopup(p));
        clusterGroup.addLayer(m);
      });
    }

    // Ajusta zoom para todos os pontos
    if (pontos.length) {
      const bounds = L.latLngBounds(pontos.map(p => [p.latitude, p.longitude]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    }

    document.getElementById('map-status').textContent = `${pontos.length} ponto${pontos.length !== 1 ? 's' : ''} no mapa`;
  }

  /* ═══════════════════════════════════════════════
     ANÁLISE POR BAIRRO (termômetro lateral)
  ═══════════════════════════════════════════════ */
  function atualizarAnaliseBairros() {
    const container = document.getElementById('mapa-analise-bairros');
    if (!container) return;

    // Agrupa pontos por bairro
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
      ${ordenados.map((b, i) => {
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

  /* ═══════════════════════════════════════════════
     FILTROS
  ═══════════════════════════════════════════════ */
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

  /* ═══════════════════════════════════════════════
     STATS
  ═══════════════════════════════════════════════ */
  async function loadStats() {
    try {
      const stats = await window.API.get('/mapa/stats');
      const setStat = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
      setStat('map-stat-e-total', stats.eleitores_total);
      setStat('map-stat-e-geocoded', stats.eleitores_geocoded);
      setStat('map-stat-e-pending', stats.eleitores_pending);
      setStat('map-stat-e-failed', stats.eleitores_failed);
      setStat('map-stat-l-total', stats.liderancas_total);
      setStat('map-stat-l-geocoded', stats.liderancas_geocoded);
      setStat('map-stat-l-pending', stats.liderancas_pending);
      setStat('map-stat-l-failed', stats.liderancas_failed);
    } catch {}
  }

  /* ═══════════════════════════════════════════════
     GEOCODIFICAR PENDENTES
  ═══════════════════════════════════════════════ */
  async function geocodePendentes() {
    if (!confirm('Geocodificar endereços pendentes e falhas?\nIsso pode demorar alguns minutos.')) return;
    try {
      const r = await window.API.post('/mapa/geocode-pendentes', {});
      window.showToast(`Processados: ${r.total || 0}. Recarregando…`, 'success');
      setTimeout(async () => {
        await loadStats();
        await loadPoints();
      }, 2000);
    } catch (err) {
      window.showToast('Erro: ' + err.message, 'error');
    }
  }

  /* ═══════════════════════════════════════════════
     POLLING AUTOMÁTICO (30 segundos)
  ═══════════════════════════════════════════════ */
  function iniciarPolling() {
    pararPolling();
    pollingInterval = setInterval(async () => {
      // Só atualiza se a view do mapa estiver visível
      const view = document.getElementById('view-mapa');
      if (!view || getComputedStyle(view).display === 'none') return;
      await loadStats();
      await loadPoints();
    }, 30000);
  }
  function pararPolling() {
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  }

  /* ═══════════════════════════════════════════════
     LISTENERS
  ═══════════════════════════════════════════════ */
  function bindListeners() {
    document.getElementById('btn-map-refresh')?.addEventListener('click', async () => {
      await loadStats(); await loadPoints();
    });
    document.getElementById('btn-map-geocode-pendentes')?.addEventListener('click', geocodePendentes);
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

    // Toggles
    document.getElementById('map-toggle-heatmap')?.addEventListener('change', (ev) => {
      mostrarHeatmap = ev.target.checked;
      renderPoints();
    });
    document.getElementById('map-toggle-pins')?.addEventListener('change', (ev) => {
      mostrarPins = ev.target.checked;
      renderPoints();
    });
  }

  /* ═══════════════════════════════════════════════
     OPEN
  ═══════════════════════════════════════════════ */
  async function openMap() {
    if (typeof window.switchView === 'function') window.switchView('mapa');
    setTimeout(async () => {
      ensureMap();
      if (map) map.invalidateSize();
      await loadStats();
      await loadPoints();
      populateFilterDropdowns();
      await populateLiderancasDropdown();
      bindListeners();
      iniciarPolling();
    }, 200);
  }

  window.GEMapa = { openMap, loadPoints, loadStats, pararPolling };

})();
