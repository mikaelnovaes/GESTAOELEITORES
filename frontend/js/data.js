/**
 * GESTAO DE ELEITORES - data.js
 * Repositórios de dados - localStorage + aliases globais
 * Versão: 2.1.0 - sem optional chaining, sem 'use strict', compatível
 */

var STORAGE_KEYS = {
  ELEITORES:    'gestao_eleitores_v3',
  USUARIOS:     'gestao_usuarios_v2',
  WA_CONFIG:    'gestao_wa_config_v1',
  WA_TEMPLATES: 'gestao_wa_templates_v1',
  WA_LOG:       'gestao_wa_log_v1',
};

function generateId() {
  if (window.crypto && window.crypto.randomUUID) {
    var uuid = window.crypto.randomUUID().replace(/-/g, '').substring(0, 14);
    var n = parseInt(uuid, 16);
    return n || (Date.now() + Math.floor(Math.random() * 1000000));
  }
  return Date.now() + Math.floor(Math.random() * 1000000);
}

function sanitizeStr(v, max) {
  if (v === null || v === undefined) return null;
  var s = String(v).replace(/<[^>]*>/g, '').replace(/javascript:/gi, '').trim();
  if (max && s.length > max) s = s.substring(0, max);
  return s || null;
}

function sanitizeEleitor(d) {
  var email = d.email ? sanitizeStr(d.email, 200) : null;
  return {
    nome:           sanitizeStr(d.nome, 200) || '',
    data_nascimento:sanitizeStr(d.data_nascimento, 10),
    telefone:       sanitizeStr(d.telefone, 20),
    email:          email ? email.toLowerCase() : null,
    endereco:       sanitizeStr(d.endereco, 300),
    numero:         sanitizeStr(d.numero, 20),
    bairro:         sanitizeStr(d.bairro, 100),
    cidade:         sanitizeStr(d.cidade, 100),
    titulo_eleitor: sanitizeStr(d.titulo_eleitor, 20),
    secao:          sanitizeStr(d.secao, 10),
    escola_votacao: sanitizeStr(d.escola_votacao, 200),
    foto:           d.foto || null,
  };
}

/* ---- ELEITORES ---- */
var Eleitores = {
  load: function() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.ELEITORES)) || []; } catch(e) { return []; }
  },
  save: function(data) {
    try { localStorage.setItem(STORAGE_KEYS.ELEITORES, JSON.stringify(data)); }
    catch(e) { if (e.name === 'QuotaExceededError') throw new Error('Armazenamento cheio.'); throw e; }
  },
  all: function() { return this.load(); },
  find: function(id) {
    var list = this.load();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  },
  insert: function(rawData) {
    var r = sanitizeEleitor(rawData);
    if (!r.nome || !r.nome.trim()) throw new Error('Nome é obrigatório.');
    var data = this.load();
    r.id = generateId();
    r.criado_em = new Date().toISOString();
    r.atualizado_em = r.criado_em;
    data.push(r);
    this.save(data);
    return r;
  },
  insertMany: function(records) {
    var data = this.load();
    var now = new Date().toISOString();
    var count = 0;
    for (var i = 0; i < records.length; i++) {
      var r = sanitizeEleitor(records[i]);
      if (!r.nome || !r.nome.trim()) continue;
      r.id = generateId();
      r.criado_em = now;
      r.atualizado_em = now;
      data.push(r);
      count++;
    }
    this.save(data);
    return count;
  },
  update: function(id, rawData) {
    var data = this.load();
    var idx = -1;
    for (var i = 0; i < data.length; i++) { if (data[i].id === id) { idx = i; break; } }
    if (idx === -1) return null;
    var r = sanitizeEleitor(rawData);
    r.id = id;
    r.criado_em = data[idx].criado_em;
    r.atualizado_em = new Date().toISOString();
    data[idx] = r;
    this.save(data);
    return r;
  },
  delete: function(id) {
    this.save(this.load().filter(function(e) { return e.id !== id; }));
  },
  search: function(term) {
    if (!term) return this.all();
    var lower = term.toLowerCase();
    return this.load().filter(function(e) {
      return (e.nome||'').toLowerCase().indexOf(lower) >= 0 ||
             (e.bairro||'').toLowerCase().indexOf(lower) >= 0 ||
             (e.cidade||'').toLowerCase().indexOf(lower) >= 0 ||
             (e.telefone||'').indexOf(term) >= 0 ||
             (e.email||'').toLowerCase().indexOf(lower) >= 0;
    });
  },
  filter: function(opts) {
    var nome   = opts && opts.nome   ? opts.nome   : null;
    var bairro = opts && opts.bairro ? opts.bairro : null;
    var cidade = opts && opts.cidade ? opts.cidade : null;
    return this.load().filter(function(e) {
      var mN = !nome   || (e.nome  ||'').toLowerCase().indexOf(nome.toLowerCase())   >= 0;
      var mB = !bairro || (e.bairro||'').toLowerCase().indexOf(bairro.toLowerCase()) >= 0;
      var mC = !cidade || (e.cidade||'').toLowerCase().indexOf(cidade.toLowerCase()) >= 0;
      return mN && mB && mC;
    });
  },
  getStats: function() {
    var all = this.load();
    var cidades = {}, bairros = {}, comTel = 0, comEmail = 0;
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.cidade) cidades[e.cidade] = 1;
      if (e.bairro) bairros[e.bairro] = 1;
      if (e.telefone) comTel++;
      if (e.email) comEmail++;
    }
    return { total: all.length, cidades: Object.keys(cidades).length, bairros: Object.keys(bairros).length, comTelefone: comTel, comEmail: comEmail };
  }
};

/* ---- USUARIOS ---- */
var Usuarios = {
  load: function() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.USUARIOS)) || []; } catch(e) { return []; }
  },
  save: function(data) { localStorage.setItem(STORAGE_KEYS.USUARIOS, JSON.stringify(data)); },
  all: function()  { return this.load(); },
  find: function(id) {
    var list = this.load();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  },
  findByLogin: function(login) {
    var lower = login.toLowerCase();
    var list = this.load();
    for (var i = 0; i < list.length; i++) { if (list[i].login.toLowerCase() === lower) return list[i]; }
    return null;
  },
  insert: function(r) {
    var self = this;
    return window.hashSenha(r.senha).then(function(hash) {
      if (self.findByLogin(r.login)) throw new Error('Login já em uso.');
      var data = self.load();
      var rec = { id: generateId(), nome: r.nome, login: r.login.toLowerCase(), senha_hash: hash, tipo: r.tipo || 'comum', criado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() };
      data.push(rec);
      self.save(data);
      return rec;
    });
  },
  update: function(id, r) {
    var self = this;
    var data = self.load();
    var idx = -1;
    for (var i = 0; i < data.length; i++) { if (data[i].id === id) { idx = i; break; } }
    if (idx === -1) return Promise.resolve(null);
    var doUpdate = function(hash) {
      var existing = self.findByLogin(r.login);
      if (existing && existing.id !== id) throw new Error('Login já em uso.');
      data[idx] = { id: id, nome: r.nome, login: r.login.toLowerCase(), senha_hash: hash || data[idx].senha_hash, tipo: r.tipo || data[idx].tipo, criado_em: data[idx].criado_em, atualizado_em: new Date().toISOString() };
      self.save(data);
      return data[idx];
    };
    if (r.senha && r.senha.length > 0) {
      return window.hashSenha(r.senha).then(function(hash) { return doUpdate(hash); });
    }
    return Promise.resolve(doUpdate(null));
  },
  delete: function(id) {
    this.save(this.load().filter(function(u) { return u.id !== id; }));
  },
  authenticate: function(login, senha) {
    var u = this.findByLogin(login);
    return window.hashSenha(senha).then(function(hash) {
      if (!u || u.senha_hash !== hash) return null;
      return u;
    });
  }
};

/* ---- WA CONFIG ---- */
var WAConfig = {
  load: function() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_CONFIG)) || {}; } catch(e) { return {}; } },
  save: function(cfg) { localStorage.setItem(STORAGE_KEYS.WA_CONFIG, JSON.stringify(cfg)); },
  isConfigured: function() { var c = this.load(); return !!(c.phoneId && c.token); }
};

/* ---- WA TEMPLATES ---- */
var WATemplates = {
  load: function() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_TEMPLATES)) || []; } catch(e) { return []; } },
  save: function(d) { localStorage.setItem(STORAGE_KEYS.WA_TEMPLATES, JSON.stringify(d)); },
  all:  function()  { return this.load(); },
  add:  function(nome, idioma) {
    nome = sanitizeStr(nome, 100);
    if (!nome) throw new Error('Nome inválido.');
    var data = this.load();
    for (var i = 0; i < data.length; i++) { if (data[i].nome === nome) throw new Error('Template já cadastrado.'); }
    data.push({ id: generateId(), nome: nome, idioma: idioma || 'pt_BR' });
    this.save(data);
  },
  remove: function(id) { this.save(this.load().filter(function(t) { return t.id !== id; })); }
};

/* ---- WA LOG ---- */
var WALog = {
  _MAX: 1000,
  load: function() { try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_LOG)) || []; } catch(e) { return []; } },
  save: function(d) { localStorage.setItem(STORAGE_KEYS.WA_LOG, JSON.stringify(d)); },
  all:  function()  { return this.load(); },
  add:  function(entry) {
    var data = this.load();
    entry.id = generateId();
    entry.data_envio = new Date().toISOString();
    data.unshift(entry);
    if (data.length > this._MAX) data.length = this._MAX;
    this.save(data);
    return entry;
  },
  clear: function() {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('gestao_wa_lote_img_') === 0) keys.push(k);
    }
    for (var j = 0; j < keys.length; j++) localStorage.removeItem(keys[j]);
    this.save([]);
  }
};

/* ---- EXPORTAÇÕES GLOBAIS ---- */
window.GEData      = { STORAGE_KEYS: STORAGE_KEYS, Eleitores: Eleitores, Usuarios: Usuarios, WAConfig: WAConfig, WATemplates: WATemplates, WALog: WALog, generateId: generateId };
window.Eleitores   = Eleitores;
window.Usuarios    = Usuarios;
window.WAConfig    = WAConfig;
window.WATemplates = WATemplates;
window.WALog       = WALog;
