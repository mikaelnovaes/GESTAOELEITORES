/**
 * GESTÃO DE ELEITORES — data.js
 * Camada de dados — localStorage (offline) + preparado para API REST
 * Versão: 2.0.0
 *
 * ARQUITETURA:
 * - Modo offline: dados em localStorage (estado atual)
 * - Modo online:  chamadas para API REST → backend Node.js → SQL Server
 *
 * Para migrar para SQL Server, apenas trocar os métodos _fetch* nos repositórios
 * para chamadas fetch() para o backend, mantendo a mesma interface pública.
 */

'use strict';

/* ============================================================
   CHAVES DE ARMAZENAMENTO
   ============================================================ */
const STORAGE_KEYS = {
  ELEITORES:    'gestao_eleitores_v3',
  USUARIOS:     'gestao_usuarios_v2',   // v2 com hashing melhorado
  WA_CONFIG:    'gestao_wa_config_v1',
  WA_TEMPLATES: 'gestao_wa_templates_v1',
  WA_LOG:       'gestao_wa_log_v1',
  BDAY_CONFIG:  'gestao_bday_config_v1',
  REACT_CONFIG: 'gestao_react_config_v1',
  REACT_LOG:    'gestao_react_log_v1',
  REACT_LAST_RUN:'gestao_react_last_run_v1',
};

/* ============================================================
   UTILITÁRIO: GERAÇÃO DE IDs
   ============================================================ */
function generateId() {
  // Usa crypto.randomUUID quando disponível (mais seguro)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return parseInt(crypto.randomUUID().replace(/-/g, '').substring(0, 15), 16);
  }
  return Date.now() + Math.floor(Math.random() * 1000000);
}

/* ============================================================
   REPOSITÓRIO: ELEITORES
   ============================================================ */
const Eleitores = {
  /** @returns {Array} */
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.ELEITORES)) || [];
    } catch {
      return [];
    }
  },

  save(data) {
    try {
      localStorage.setItem(STORAGE_KEYS.ELEITORES, JSON.stringify(data));
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        throw new Error('Armazenamento cheio. Exporte e limpe registros antigos.');
      }
      throw e;
    }
  },

  all() { return this.load(); },

  find(id) {
    return this.load().find(e => e.id === id);
  },

  insert(rawData) {
    // Sanitizar antes de salvar
    const r = window.GESecurity
      ? window.GESecurity.Sanitizer.sanitizeEleitor(rawData)
      : rawData;

    if (!r.nome || !r.nome.trim()) {
      throw new Error('Nome é obrigatório.');
    }

    const data = this.load();
    r.id = generateId();
    r.criado_em    = new Date().toISOString();
    r.atualizado_em = r.criado_em;
    data.push(r);
    this.save(data);
    return r;
  },

  insertMany(records) {
    const sanitize = window.GESecurity
      ? window.GESecurity.Sanitizer.sanitizeEleitor.bind(window.GESecurity.Sanitizer)
      : (r) => r;

    const data = this.load();
    const now = new Date().toISOString();
    let count = 0;

    records.forEach(raw => {
      const r = sanitize(raw);
      if (!r.nome || !r.nome.trim()) return; // Pular sem nome

      r.id = generateId();
      r.criado_em    = now;
      r.atualizado_em = now;
      data.push(r);
      count++;
    });

    this.save(data);
    return count;
  },

  update(id, rawData) {
    const sanitize = window.GESecurity
      ? window.GESecurity.Sanitizer.sanitizeEleitor.bind(window.GESecurity.Sanitizer)
      : (r) => r;

    const data = this.load();
    const idx = data.findIndex(e => e.id === id);
    if (idx === -1) return null;

    const r = sanitize(rawData);
    r.id          = id;
    r.criado_em   = data[idx].criado_em;
    r.atualizado_em = new Date().toISOString();
    data[idx] = r;
    this.save(data);
    return r;
  },

  delete(id) {
    this.save(this.load().filter(e => e.id !== id));
  },

  /** Busca por termo em múltiplos campos */
  search(term) {
    if (!term) return this.all();
    const lower = term.toLowerCase();
    return this.load().filter(e =>
      (e.nome      || '').toLowerCase().includes(lower) ||
      (e.bairro    || '').toLowerCase().includes(lower) ||
      (e.cidade    || '').toLowerCase().includes(lower) ||
      (e.telefone  || '').includes(term) ||
      (e.email     || '').toLowerCase().includes(lower)
    );
  },

  /** Filtra por critérios */
  filter({ nome, bairro, cidade } = {}) {
    return this.load().filter(e => {
      const matchN = !nome   || (e.nome   || '').toLowerCase().includes(nome.toLowerCase());
      const matchB = !bairro || (e.bairro || '').toLowerCase().includes(bairro.toLowerCase());
      const matchC = !cidade || (e.cidade || '').toLowerCase().includes(cidade.toLowerCase());
      return matchN && matchB && matchC;
    });
  },

  /** Retorna eleitores com aniversário hoje ou nos próximos N dias */
  getByBirthday(daysAhead = 0) {
    const today = new Date();
    return this.load().filter(e => {
      if (!e.data_nascimento) return false;
      try {
        const bday = new Date(e.data_nascimento);
        const thisYear = new Date(
          today.getFullYear(),
          bday.getMonth(),
          bday.getDate()
        );
        const diff = Math.floor((thisYear - today) / (1000 * 60 * 60 * 24));
        return diff >= 0 && diff <= daysAhead;
      } catch {
        return false;
      }
    });
  },

  /** Retorna eleitores sem envio de WA nos últimos N dias */
  getInactive(days, waLog) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const recentIds = new Set(
      waLog
        .filter(l => new Date(l.data_envio).getTime() >= cutoff && l.status === 'sent')
        .map(l => l.eleitor_id)
    );
    return this.load().filter(e => e.telefone && !recentIds.has(e.id));
  },

  /** Estatísticas */
  getStats() {
    const all = this.load();
    const cidades = [...new Set(all.map(e => e.cidade).filter(Boolean))].length;
    const bairros = [...new Set(all.map(e => e.bairro).filter(Boolean))].length;
    const comTelefone = all.filter(e => e.telefone).length;
    const comEmail    = all.filter(e => e.email).length;
    return { total: all.length, cidades, bairros, comTelefone, comEmail };
  }
};

/* ============================================================
   REPOSITÓRIO: USUÁRIOS
   ============================================================ */
const Usuarios = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.USUARIOS)) || [];
    } catch {
      return [];
    }
  },

  save(data) {
    localStorage.setItem(STORAGE_KEYS.USUARIOS, JSON.stringify(data));
  },

  all()      { return this.load(); },
  find(id)   { return this.load().find(u => u.id === id); },

  findByLogin(login) {
    return this.load().find(
      u => u.login.toLowerCase() === login.toLowerCase()
    );
  },

  async insert(r) {
    const data = this.load();

    if (this.findByLogin(r.login)) {
      throw new Error('Este login já está em uso.');
    }

    // Validar comprimento mínimo da senha
    if (!r.senha || r.senha.length < window.GESecurity?.SECURITY?.PASSWORD_MIN_LENGTH || 0) {
      throw new Error(`Senha deve ter no mínimo ${window.GESecurity?.SECURITY?.PASSWORD_MIN_LENGTH || 6} caracteres.`);
    }

    r.id = generateId();
    r.login = window.GESecurity
      ? window.GESecurity.Sanitizer.cleanInput(r.login, 50).toLowerCase()
      : r.login.toLowerCase();
    r.nome = window.GESecurity
      ? window.GESecurity.Sanitizer.cleanInput(r.nome, 100)
      : r.nome;
    r.senha_hash = await hashSenha(r.senha);
    delete r.senha; // NUNCA armazenar senha em texto puro
    r.criado_em    = new Date().toISOString();
    r.atualizado_em = r.criado_em;
    data.push(r);
    this.save(data);
    return r;
  },

  async update(id, r) {
    const data = this.load();
    const idx = data.findIndex(u => u.id === id);
    if (idx === -1) return null;

    const existing = this.findByLogin(r.login);
    if (existing && existing.id !== id) {
      throw new Error('Este login já está em uso.');
    }

    r.id = id;
    r.login = r.login.toLowerCase();

    if (r.senha && r.senha.length > 0) {
      if (r.senha.length < (window.GESecurity?.SECURITY?.PASSWORD_MIN_LENGTH || 6)) {
        throw new Error('Senha muito curta.');
      }
      r.senha_hash = await hashSenha(r.senha);
    } else {
      r.senha_hash = data[idx].senha_hash;
    }

    delete r.senha; // NUNCA armazenar senha
    r.criado_em    = data[idx].criado_em;
    r.atualizado_em = new Date().toISOString();
    data[idx] = r;
    this.save(data);
    return r;
  },

  delete(id) {
    this.save(this.load().filter(u => u.id !== id));
  },

  async authenticate(login, senha) {
    // Verificar rate limiting
    const rl = window.GESecurity?.RateLimiter;
    if (rl && rl.isBlocked('login')) {
      throw new Error('Muitas tentativas. Aguarde 15 minutos.');
    }

    const u = this.findByLogin(login);

    // Mesmo delay para usuários não encontrados (prevenir user enumeration)
    await new Promise(r => setTimeout(r, 100));

    if (!u) {
      if (rl) rl.record('login');
      window.GESecurity?.SecurityLog?.log('LOGIN_FAILED', { login });
      return null;
    }

    const hash = await hashSenha(senha);

    if (u.senha_hash !== hash) {
      if (rl) {
        const result = rl.record('login');
        if (result.blocked) {
          window.GESecurity?.SecurityLog?.log('ACCOUNT_LOCKED', { login });
        }
      }
      window.GESecurity?.SecurityLog?.log('LOGIN_FAILED', { login });
      return null;
    }

    // Login bem-sucedido — resetar rate limiter
    if (rl) rl.reset('login');
    window.GESecurity?.SecurityLog?.log('LOGIN_SUCCESS', { login, userId: u.id });
    return u;
  }
};

/* ============================================================
   REPOSITÓRIO: WHATSAPP CONFIG
   ============================================================ */
const WAConfig = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_CONFIG)) || {};
    } catch {
      return {};
    }
  },

  save(cfg) {
    // Não salvar o token completo se possível; em produção, usar backend
    localStorage.setItem(STORAGE_KEYS.WA_CONFIG, JSON.stringify(cfg));
  },

  isConfigured() {
    const c = this.load();
    return !!(c.phoneId && c.token);
  }
};

/* ============================================================
   REPOSITÓRIO: WA TEMPLATES
   ============================================================ */
const WATemplates = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_TEMPLATES)) || [];
    } catch {
      return [];
    }
  },

  save(d) {
    localStorage.setItem(STORAGE_KEYS.WA_TEMPLATES, JSON.stringify(d));
  },

  all()  { return this.load(); },

  add(nome, idioma) {
    const sanitize = window.GESecurity?.Sanitizer?.cleanInput || ((v) => v);
    nome = sanitize(nome, 100);
    if (!nome) throw new Error('Nome do template inválido.');

    const data = this.load();
    if (data.some(t => t.nome === nome)) throw new Error('Template já cadastrado.');
    data.push({ id: generateId(), nome, idioma: idioma || 'pt_BR' });
    this.save(data);
  },

  remove(id) {
    this.save(this.load().filter(t => t.id !== id));
  }
};

/* ============================================================
   REPOSITÓRIO: WA LOG
   ============================================================ */
const WALog = {
  _MAX_ENTRIES: 1000,

  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.WA_LOG)) || [];
    } catch {
      return [];
    }
  },

  save(d) {
    localStorage.setItem(STORAGE_KEYS.WA_LOG, JSON.stringify(d));
  },

  all() { return this.load(); },

  add(entry) {
    const data = this.load();
    entry.id = generateId();
    entry.data_envio = new Date().toISOString();
    data.unshift(entry);
    if (data.length > this._MAX_ENTRIES) data.length = this._MAX_ENTRIES;
    this.save(data);
    return entry;
  },

  clear() {
    // Limpar também imagens de lotes
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('gestao_wa_lote_img_')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    this.save([]);
  }
};

/* ============================================================
   INICIALIZAÇÃO: ADMIN PADRÃO
   ============================================================ */
async function initDefaultAdmin() {
  if (Usuarios.all().length === 0) {
    await Usuarios.insert({
      nome:  'Administrador',
      login: 'admin',
      senha: 'Admin@2024!', // Senha mais forte que o original 'admin'
      tipo:  'admin'
    });
    console.warn(
      '[GESTÃO] ⚠️ Admin padrão criado. ' +
      'ALTERE A SENHA EM: Menu → Usuários → Editar admin'
    );
  }
}

/* ============================================================
   EXPORTAÇÕES GLOBAIS
   ============================================================ */
window.GEData = {
  STORAGE_KEYS,
  Eleitores,
  Usuarios,
  WAConfig,
  WATemplates,
  WALog,
  generateId,
  initDefaultAdmin,
};

// Aliases globais para compatibilidade com o código legado
window.Eleitores    = Eleitores;
window.Usuarios     = Usuarios;
window.WAConfig     = WAConfig;
window.WATemplates  = WATemplates;
window.WALog        = WALog;
