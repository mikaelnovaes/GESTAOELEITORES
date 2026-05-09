// data.js - Gestao de Eleitores v2.2
// SEM strict mode, SEM optional chaining, SEM arrow functions problematicas

var STORAGE_KEYS = {
  ELEITORES: 'gestao_eleitores_v3',
  USUARIOS: 'gestao_usuarios_v2',
  WA_CONFIG: 'gestao_wa_config_v1',
  WA_TEMPLATES: 'gestao_wa_templates_v1',
  WA_LOG: 'gestao_wa_log_v1'
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

function limparEleitor(d) {
  return {
    nome: limparTexto(d.nome, 200) || '',
    data_nascimento: limparTexto(d.data_nascimento, 10),
    telefone: limparTexto(d.telefone, 20),
    email: d.email ? limparTexto(d.email, 200).toLowerCase() : null,
    endereco: limparTexto(d.endereco, 300),
    numero: limparTexto(d.numero, 20),
    bairro: limparTexto(d.bairro, 100),
    cidade: limparTexto(d.cidade, 100),
    titulo_eleitor: limparTexto(d.titulo_eleitor, 20),
    secao: limparTexto(d.secao, 10),
    escola_votacao: limparTexto(d.escola_votacao, 200),
    foto: d.foto || null
  };
}

var Eleitores = {
  load: function() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.ELEITORES)) || []; }
    catch(e) { return []; }
  },
  save: function(data) {
    localStorage.setItem(STORAGE_KEYS.ELEITORES, JSON.stringify(data));
  },
  all: function() { return this.load(); },
  find: function(id) {
    var list = this.load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  },
  insert: function(rawData) {
    var r = limparEleitor(rawData);
    if (!r.nome || !r.nome.trim()) throw new Error('Nome e obrigatorio.');
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
      var r = limparEleitor(records[i]);
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
    for (var i = 0; i < data.length; i++) {
      if (data[i].id === id) { idx = i; break; }
    }
    if (idx === -1) return null;
    var r = limparEleitor(rawData);
    r.id = id;
    r.criado_em = data[idx].criado_em;
    r.atualizado_em = new Date().toISOString();
    data[idx] = r;
    this.save(data);
    return r;
  },
  delete: function(id) {
    var data = this.load().filter(function(e) { return e.id !== id; });
    this.save(data);
  },
  search: function(term) {
    if (!term) return this.all();
    var lower = term.toLowerCase();
    return this.load().filter(function(e) {
      return (e.nome||'').toLowerCase().indexOf(lower) >= 0
        || (e.bairro||'').toLowerCase().indexOf(lower) >= 0
        || (e.cidade||'').toLowerCase().indexOf(lower) >= 0
        || (e.telefone||'').indexOf(term) >= 0;
    });
  },
  filter: function(opts) {
    var nome = opts && opts.nome ? opts.nome.toLowerCase() : null;
    var bairro = opts && opts.bairro ? opts.bairro.toLowerCase() : null;
    var cidade = opts && opts.cidade ? opts.cidade.toLowerCase() : null;
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
      if (all[i].cidade) cidades[all[i].cidade] = 1;
      if (all[i].bairro) bairros[all[i].bairro] = 1;
      if (all[i].telefone) tel++;
      if (all[i].email) email++;
    }
    return { total: all.length, cidades: Object.keys(cidades).length, bairros: Object.keys(bairros).length, comTelefone: tel, comEmail: email };
  }
};

var Usuarios = {
  load: function() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.USUARIOS)) || []; }
    catch(e) { return []; }
  },
  save: function(data) { localStorage.setItem(STORAGE_KEYS.USUARIOS, JSON.stringify(data)); },
  all: function() { return this.load(); },
  find: function(id) {
    var list = this.load();
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) return list[i]; }
    return null;
  },
  findByLogin: function(login) {
    var lower = login.toLowerCase();
    var list = this.load();
    for (var i = 0; i < list.length; i++) {
      if (list[i].login.toLowerCase() === lower) return list[i];
    }
    return null;
  },
  insert: function(r) {
    var self = this;
    return window.hashSenha(r.senha).then(function(hash) {
      if (self.findByLogin(r.login)) throw new Error('Login ja em uso.');
      var data = self.load();
      var rec = {
        id: generateId(),
        nome: r.nome,
        login: r.login.toLowerCase(),
        senha_hash: hash,
        tipo: r.tipo || 'comum',
        criado_em: new Date().toISOString(),
        atualizado_em: new Date().toISOString()
      };
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
    if (r.senha && r.senha.length > 0) {
      return window.hashSenha(r.senha).then(function(hash) {
        data[idx] = { id: id, nome: r.nome, login: r.login.toLowerCase(), senha_hash: hash, tipo: r.tipo || data[idx].tipo, criado_em: data[idx].criado_em, atualizado_em: new Date().toISOString() };
        self.save(data);
        return data[idx];
      });
    }
    data[idx] = { id: id, nome: r.nome, login: r.login.toLowerCase(), senha_hash: data[idx].senha_hash, tipo: r.tipo || data[idx].tipo, criado_em: data[idx].criado_em, atualizado_em: new Date().toISOString() };
    self.save(data);
    return Promise.resolve(data[idx]);
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

var WAConfig = {
  load: function() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_CONFIG)) || {}; }
    catch(e) { return {}; }
  },
  save: function(cfg) { localStorage.setItem(STORAGE_KEYS.WA_CONFIG, JSON.stringify(cfg)); },
  isConfigured: function() { var c = this.load(); return !!(c.phoneId && c.token); }
};

var WATemplates = {
  load: function() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_TEMPLATES)) || []; }
    catch(e) { return []; }
  },
  save: function(d) { localStorage.setItem(STORAGE_KEYS.WA_TEMPLATES, JSON.stringify(d)); },
  all: function() { return this.load(); },
  add: function(nome, idioma) {
    nome = limparTexto(nome, 100);
    if (!nome) throw new Error('Nome invalido.');
    var data = this.load();
    for (var i = 0; i < data.length; i++) {
      if (data[i].nome === nome) throw new Error('Template ja cadastrado.');
    }
    data.push({ id: generateId(), nome: nome, idioma: idioma || 'pt_BR' });
    this.save(data);
  },
  remove: function(id) {
    this.save(this.load().filter(function(t) { return t.id !== id; }));
  }
};

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

// Exportar para window
window.GEData = { STORAGE_KEYS: STORAGE_KEYS, Eleitores: Eleitores, Usuarios: Usuarios, WAConfig: WAConfig, WATemplates: WATemplates, WALog: WALog, generateId: generateId };
window.Eleitores = Eleitores;
window.Usuarios = Usuarios;
window.WAConfig = WAConfig;
window.WATemplates = WATemplates;
window.WALog = WALog;

console.log('[data.js] Carregado. Eleitores:', typeof window.Eleitores);
