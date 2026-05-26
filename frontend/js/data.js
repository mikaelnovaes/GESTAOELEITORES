// data.js - Gestao de Eleitores v3.0
// REFATORADO: API é a fonte da verdade. localStorage apenas cache de leitura.
// IDs sempre normalizados para Number (resolve botões VER/EDITAR/EXCLUIR).

'use strict';

var STORAGE_KEYS = {
  ELEITORES:        'gestao_eleitores_v3',
  ELEITORES_TENANT: 'gestao_eleitores_tenant_v3',  // marca a qual tenant o cache pertence
  WA_LOG:           'gestao_wa_log_v1'
};

function generateId() {
  return Date.now() + Math.floor(Math.random() * 1000000);
}

function limparTexto(v, max) {
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/<[^>]*>/g, '').trim();
  if (max && s.length > max) s = s.substring(0, max);
  return s || null;
}

// ============================================================
// ELEITORES — cache local apenas para leitura rápida.
// Toda escrita passa por API.
// ============================================================
var Eleitores = {
  load: function() {
    try {
      // ── REDE DE SEGURANÇA: descarta cache se for de outro tenant ──
      var currentTenant = (typeof window.getCurrentTenantId === 'function')
        ? window.getCurrentTenantId() : null;
      var cachedTenant  = localStorage.getItem(STORAGE_KEYS.ELEITORES_TENANT);
      if (currentTenant && cachedTenant && String(currentTenant) !== String(cachedTenant)) {
        // Cache pertence a outro tenant — descarta
        this.clear();
        return [];
      }

      var raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.ELEITORES)) || [];
      return raw.map(function(e) {
        if (e && e.id != null) e.id = Number(e.id);
        return e;
      });
    } catch(e) { return []; }
  },
  save: function(data) {
    var normalized = (data || []).map(function(e) {
      if (e && e.id != null) e.id = Number(e.id);
      return e;
    });
    localStorage.setItem(STORAGE_KEYS.ELEITORES, JSON.stringify(normalized));
    // Marca o cache com o tenant atual
    var currentTenant = (typeof window.getCurrentTenantId === 'function')
      ? window.getCurrentTenantId() : null;
    if (currentTenant) {
      localStorage.setItem(STORAGE_KEYS.ELEITORES_TENANT, String(currentTenant));
    }
  },
  clear: function() {
    localStorage.removeItem(STORAGE_KEYS.ELEITORES);
    localStorage.removeItem(STORAGE_KEYS.ELEITORES_TENANT);
  },
  all: function() { return this.load(); },
  find: function(id) {
    var nid = Number(id);
    var list = this.load();
    for (var i = 0; i < list.length; i++) {
      if (Number(list[i].id) === nid) return list[i];
    }
    return null;
  },
  filter: function(opts) {
    opts = opts || {};
    var nome   = opts.nome   ? opts.nome.toLowerCase()   : null;
    var bairro = opts.bairro ? opts.bairro.toLowerCase() : null;
    var cidade = opts.cidade ? opts.cidade.toLowerCase() : null;
    return this.load().filter(function(e) {
      if (nome   && (e.nome  ||'').toLowerCase().indexOf(nome)   < 0) return false;
      if (bairro && (e.bairro||'').toLowerCase().indexOf(bairro) < 0) return false;
      if (cidade && (e.cidade||'').toLowerCase().indexOf(cidade) < 0) return false;
      return true;
    });
  },
  getStats: function() {
    var all = this.load();
    var cidades = {}, bairros = {}, tel = 0, email = 0;
    for (var i = 0; i < all.length; i++) {
      if (all[i].cidade)   cidades[all[i].cidade] = 1;
      if (all[i].bairro)   bairros[all[i].bairro] = 1;
      if (all[i].telefone) tel++;
      if (all[i].email)    email++;
    }
    return {
      total: all.length,
      cidades: Object.keys(cidades).length,
      bairros: Object.keys(bairros).length,
      comTelefone: tel,
      comEmail: email
    };
  }
};

// ============================================================
// WALog — cache local de envios (informativo apenas; histórico
// oficial fica no backend)
// ============================================================
var WALog = {
  _MAX: 1000,
  load: function() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_LOG)) || []; }
    catch(e) { return []; }
  },
  save: function(d) { localStorage.setItem(STORAGE_KEYS.WA_LOG, JSON.stringify(d)); },
  all: function() { return this.load(); },
  add: function(entry) {
    var data = this.load();
    entry.id = generateId();
    entry.data_envio = new Date().toISOString();
    data.unshift(entry);
    if (data.length > this._MAX) data.length = this._MAX;
    this.save(data);
    return entry;
  },
  clear: function() { this.save([]); }
};
window.getCurrentTenantId = function getCurrentTenantId() {
  try {
    var acting = sessionStorage.getItem('ge_acting_tenant');
    if (acting) return acting;
    var token = sessionStorage.getItem('ge_jwt_token');
    if (!token) return null;
    var parts = token.split('.');
    if (parts.length < 2) return null;
    var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.tenant_id != null ? String(payload.tenant_id) : null;
  } catch(e) {
    return null;
  }
};
// Exportar
window.GEData = {
  STORAGE_KEYS: STORAGE_KEYS,
  Eleitores: Eleitores,
  WALog: WALog,
  generateId: generateId,
  limparTexto: limparTexto
};
window.Eleitores = Eleitores;
window.WALog = WALog;

console.log('[data.js v3.0] Carregado. Eleitores:', typeof window.Eleitores);
