/**
 * frontend/js/mapa.js
 * Mapa Eleitoral — Leaflet + cluster
 *
 * Expõe: window.GEMapa.openMap()
 *
 * Requer no HTML:
 *   <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
 *   <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css">
 *   <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css">
 *   <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
 *   <script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
 */

(function() {
  'use strict';

  let map = null;
  let clusterGroup = null;
  let listenersBound = false;
  let lastPontos = [];

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  /* ============================================================
     INICIALIZAÇÃO DO MAPA
     ============================================================ */
  function ensureMap() {
    if (map) return map;
    if (typeof L === 'undefined') {
      console.error('[Mapa] Leaflet não carregado.');
      return null;
    }

    // Centro Brasil por default
    map = L.map('mapa-container', {
      center: [-15.78, -47.93],
      zoom: 4,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    if (typeof L.markerClusterGroup === 'function') {
      clusterGroup = L.markerClusterGroup({
        chunkedLoading: true,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        maxClusterRadius: 50,
      });
      map.addLayer(clusterGroup);
    } else {
      console.warn('[Mapa] markercluster não disponível, usando layer simples');
      clusterGroup = L.layerGroup().addTo(map);
    }

    return map;
  }

  /* ============================================================
     ÍCONES customizados
     ============================================================ */
  function makeIcon(tipo) {
    const color = tipo === 'lideranca' ? '#c9a961' : '#0e2b5c';
    const ring  = tipo === 'lideranca' ? '#8a6d10' : '#06173a';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="40" viewBox="0 0 28 40">
        <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.27 21.73 0 14 0z" fill="${color}" stroke="${ring}" stroke-width="1.5"/>
        <circle cx="14" cy="14" r="5" fill="#fff"/>
      </svg>`;
    return L.divIcon({
      html: svg,
      className: 'ge-mapa-marker',
      iconSize: [28, 40],
      iconAnchor: [14, 40],
      popupAnchor: [0, -36],
    });
  }

  /* ============================================================
     POPUP de cada ponto
     ============================================================ */
  function buildPopup(p) {
    const tipoLabel = p.tipo === 'lideranca' ? '★ Liderança' : '● Eleitor';
    const tipoColor = p.tipo === 'lideranca' ? 'var(--gold)' : 'var(--navy-deep)';
    const endereco = [
      [p.endereco, p.numero].filter(Boolean).join(', '),
      p.bairro, p.cidade
    ].filter(Boolean).join(' — ');
    const cargoPartido = p.tipo === 'lideranca'
      ? [p.cargo, p.partido].filter(Boolean).join(' · ')
      : '';

    return `
      <div class="ge-popup">
        <div class="ge-popup-tipo" style="color:${tipoColor};">${tipoLabel}</div>
        <div class="ge-popup-nome">${esc(p.nome)}</div>
        ${cargoPartido ? `<div class="ge-popup-meta">${esc(cargoPartido)}</div>` : ''}
        ${p.telefone ? `<div class="ge-popup-line"><strong>Tel:</strong> ${esc(p.telefone)}</div>` : ''}
        ${endereco ? `<div class="ge-popup-line"><strong>End:</strong> ${esc(endereco)}</div>` : ''}
      </div>`;
  }

  /* ============================================================
     CARREGAR PONTOS DO SERVIDOR
     ============================================================ */
  async function loadPoints() {
    if (!window.API) return;
    const tipo    = document.getElementById('map-filter-tipo')?.value || 'ambos';
    const bairro  = document.getElementById('map-filter-bairro')?.value || '';
    const cidade  = document.getElementById('map-filter-cidade')?.value || '';
    const lidId   = document.getElementById('map-filter-lideranca')?.value || '';

    const params = new URLSearchParams();
    if (tipo && tipo !== 'ambos') params.set('tipo', tipo);
    if (bairro) params.set('bairro', bairro);
    if (cidade) params.set('cidade', cidade);
    if (lidId)  params.set('lideranca_id', lidId);

    const statusEl = document.getElementById('map-status');
    if (statusEl) statusEl.textContent = 'Carregando...';

    try {
      const pontos = await window.API.get('/mapa/pontos' + (params.toString() ? '?' + params.toString() : ''));
      lastPontos = Array.isArray(pontos) ? pontos : [];
      renderPoints();
      if (statusEl) {
        const cntE = lastPontos.filter(p => p.tipo === 'eleitor').length;
        const cntL = lastPontos.filter(p => p.tipo === 'lideranca').length;
        statusEl.textContent = `${cntE} eleitor(es), ${cntL} liderança(s) no mapa`;
      }
      populateFilterDropdowns();
    } catch (err) {
      if (statusEl) statusEl.textContent = 'Erro ao carregar pontos.';
      console.error('[Mapa] loadPoints:', err);
    }
  }

  /* ============================================================
     RENDERIZAR PONTOS NO MAPA
     ============================================================ */
  function renderPoints() {
    if (!clusterGroup) return;
    clusterGroup.clearLayers();

    const markers = lastPontos.map(p => {
      const m = L.marker([p.latitude, p.longitude], { icon: makeIcon(p.tipo) });
      m.bindPopup(buildPopup(p));
      return m;
    });

    if (clusterGroup.addLayers) {
      clusterGroup.addLayers(markers);
    } else {
      markers.forEach(m => clusterGroup.addLayer(m));
    }

    // Ajusta o zoom para mostrar todos
    if (markers.length > 0 && map) {
      const group = L.featureGroup(markers);
      try {
        map.fitBounds(group.getBounds(), { padding: [40, 40], maxZoom: 16 });
      } catch (e) { /* ignore */ }
    }
  }

  /* ============================================================
     FILTROS — popula dropdowns com bairros/cidades/lideranças
     ============================================================ */
  function populateFilterDropdowns() {
    // Bairros e cidades vêm dos próprios pontos
    const bairros = [...new Set(lastPontos.map(p => p.bairro).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
    const cidades = [...new Set(lastPontos.map(p => p.cidade).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));

    fillSelect('map-filter-bairro', bairros, 'Todos os bairros');
    fillSelect('map-filter-cidade', cidades, 'Todas as cidades');
    populateLiderancasDropdown();
  }
  function fillSelect(id, items, placeholder) {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>` +
      items.map(v => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }
  async function populateLiderancasDropdown() {
    const el = document.getElementById('map-filter-lideranca');
    if (!el || !window.GELiderancas) return;
    const cur = el.value;
    const list = window.GELiderancas.getAll();
    let lids = list && list.length ? list : (await window.GELiderancas.fetchAll());
    lids = [...lids].sort((a,b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    el.innerHTML = `<option value="">Todas as lideranças</option>` +
      lids.map(l => `<option value="${l.id}" ${String(l.id) === String(cur) ? 'selected' : ''}>${esc(l.nome)}</option>`).join('');
  }

  /* ============================================================
     ESTATÍSTICAS
     ============================================================ */
  async function loadStats() {
    try {
      const s = await window.API.get('/mapa/stats');
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v == null ? '—' : v; };
      set('map-stat-e-total',     s.eleitores_total);
      set('map-stat-e-geocoded',  s.eleitores_geocoded);
      set('map-stat-e-pending',   s.eleitores_pending);
      set('map-stat-e-failed',    s.eleitores_failed);
      set('map-stat-l-total',     s.liderancas_total);
      set('map-stat-l-geocoded',  s.liderancas_geocoded);
      set('map-stat-l-pending',   s.liderancas_pending);
      set('map-stat-l-failed',    s.liderancas_failed);

      const totalPend = (s.eleitores_pending || 0) + (s.liderancas_pending || 0);
      const btn = document.getElementById('btn-map-geocode-pendentes');
      if (btn) {
        btn.textContent = totalPend > 0
          ? `Geocodificar ${totalPend} pendente(s)`
          : 'Sem pendentes';
        btn.disabled = totalPend === 0;
      }
    } catch (err) {
      console.warn('[Mapa] stats:', err.message);
    }
  }

  /* ============================================================
     AÇÃO: Geocodificar pendentes
     ============================================================ */
  async function geocodePendentes() {
    const btn = document.getElementById('btn-map-geocode-pendentes');
    if (!btn) return;
    if (!confirm('Iniciar geocodificação dos pendentes em segundo plano?\n\nIsso pode levar alguns minutos. Você pode continuar usando o sistema.')) return;
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'Iniciando...';
    try {
      const r = await window.API.post('/mapa/geocode-pendentes', {});
      if (window.showToast) window.showToast(r.message || `${r.scheduled} processando...`, 'success');
      // Recarrega stats periodicamente
      let iter = 0;
      const interval = setInterval(async () => {
        iter++;
        await loadStats();
        if (iter >= 30) clearInterval(interval); // 30 ciclos × 10s = 5 min
      }, 10000);
    } catch (err) {
      if (window.showToast) window.showToast(err.message || 'Erro.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }

  /* ============================================================
     LISTENERS
     ============================================================ */
  function bindListeners() {
    if (listenersBound) return;
    listenersBound = true;

    ['map-filter-tipo', 'map-filter-bairro', 'map-filter-cidade', 'map-filter-lideranca'].forEach(id => {
      document.getElementById(id)?.addEventListener('change', loadPoints);
    });

    document.getElementById('btn-map-refresh')?.addEventListener('click', async () => {
      await loadPoints();
      await loadStats();
    });

    document.getElementById('btn-map-geocode-pendentes')?.addEventListener('click', geocodePendentes);

    document.getElementById('btn-map-clear-filters')?.addEventListener('click', () => {
      ['map-filter-tipo', 'map-filter-bairro', 'map-filter-cidade', 'map-filter-lideranca'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      const tipoEl = document.getElementById('map-filter-tipo');
      if (tipoEl) tipoEl.value = 'ambos';
      loadPoints();
    });
  }

  /* ============================================================
     ABRIR MAPA
     ============================================================ */
  async function openMap() {
    bindListeners();
    // Aguarda o DOM da view estar visível para Leaflet medir corretamente
    setTimeout(() => {
      ensureMap();
      if (map) map.invalidateSize();
      loadPoints();
      loadStats();
    }, 80);
  }

  window.GEMapa = { openMap, loadPoints, loadStats };

})();
