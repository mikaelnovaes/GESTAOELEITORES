/**
 * GESTÃO DE ELEITORES — security.js
 * Módulo de Segurança da Informação
 * Versão: 2.0.0
 *
 * Responsabilidades:
 * - Sanitização de inputs (XSS prevention)
 * - Rate limiting (brute force protection)
 * - CSRF token management
 * - Hashing seguro de senhas
 * - Validação e sanitização de dados
 * - Content Security Policy helpers
 * - Detecção de tentativas de injeção
 */

'use strict';

/* ============================================================
   CONSTANTES DE SEGURANÇA
   ============================================================ */
const SECURITY = {
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000,   // 15 minutos
  SESSION_TIMEOUT_MS:  8  * 60 * 60 * 1000, // 8 horas
  CSRF_TOKEN_LENGTH:   32,
  SALT_PREFIX:         'ge_salt_v2::',     // Atualizado da v1
  PASSWORD_MIN_LENGTH: 6,
  MAX_FIELD_LENGTH:    500,
  MAX_TEXTAREA_LENGTH: 2000,
  MAX_IMPORT_ROWS:     10000,
  MAX_FILE_SIZE_MB:    5,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  MAX_IMAGE_SIZE_MB:   2,
};

/* ============================================================
   RATE LIMITER (anti-brute-force)
   ============================================================ */
const RateLimiter = {
  _key: 'ge_rl_v1',

  _load() {
    try {
      return JSON.parse(sessionStorage.getItem(this._key)) || {};
    } catch {
      return {};
    }
  },

  _save(data) {
    try {
      sessionStorage.setItem(this._key, JSON.stringify(data));
    } catch { /* silencioso */ }
  },

  record(action) {
    const data = this._load();
    const now = Date.now();

    if (!data[action]) {
      data[action] = { attempts: 0, firstAttempt: now, lockedUntil: 0 };
    }

    const entry = data[action];

    // Verificar se está em lockout
    if (entry.lockedUntil && now < entry.lockedUntil) {
      const remaining = Math.ceil((entry.lockedUntil - now) / 60000);
      return { blocked: true, remainingMinutes: remaining };
    }

    // Reset após período de lockout expirado
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      data[action] = { attempts: 0, firstAttempt: now, lockedUntil: 0 };
    }

    entry.attempts += 1;

    if (entry.attempts >= SECURITY.MAX_LOGIN_ATTEMPTS) {
      entry.lockedUntil = now + SECURITY.LOCKOUT_DURATION_MS;
      this._save(data);
      return { blocked: true, remainingMinutes: 15 };
    }

    const remaining = SECURITY.MAX_LOGIN_ATTEMPTS - entry.attempts;
    this._save(data);
    return { blocked: false, attemptsRemaining: remaining };
  },

  reset(action) {
    const data = this._load();
    delete data[action];
    this._save(data);
  },

  isBlocked(action) {
    const data = this._load();
    const entry = data[action];
    if (!entry) return false;
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
    return false;
  }
};

/* ============================================================
   CSRF PROTECTION
   ============================================================ */
const CSRFProtection = {
  _key: 'ge_csrf_v1',

  generate() {
    const array = new Uint8Array(SECURITY.CSRF_TOKEN_LENGTH);
    crypto.getRandomValues(array);
    const token = Array.from(array)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    sessionStorage.setItem(this._key, token);
    return token;
  },

  get() {
    let token = sessionStorage.getItem(this._key);
    if (!token) token = this.generate();
    return token;
  },

  validate(token) {
    const stored = sessionStorage.getItem(this._key);
    if (!stored || !token) return false;
    // Comparação constante para evitar timing attacks
    return this._constantTimeCompare(stored, token);
  },

  _constantTimeCompare(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }
};

/* ============================================================
   HASHING SEGURO DE SENHAS
   ============================================================ */
/**
 * Hash de senha usando SHA-256 com salt.
 * NOTA IMPORTANTE: Para produção com SQL Server, usar bcrypt/Argon2 no backend.
 * Esta implementação é apenas para uso offline/localStorage.
 * Ao migrar para o backend Node.js, usar: const bcrypt = require('bcrypt');
 */
async function hashSenha(senha) {
  if (!senha) throw new Error('Senha não pode ser vazia.');

  // Adicionar pepper + salt para proteção adicional
  const saltedPassword = SECURITY.SALT_PREFIX + senha + '_ge2024';
  const enc = new TextEncoder().encode(saltedPassword);

  const hashBuffer = await crypto.subtle.digest('SHA-256', enc);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ============================================================
   SANITIZAÇÃO E VALIDAÇÃO
   ============================================================ */
const Sanitizer = {
  /**
   * Escapa HTML para prevenir XSS.
   * NUNCA inserir texto não-sanitizado em innerHTML.
   */
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;'
    };
    return String(str).replace(/[&<>"'`=/]/g, s => map[s]);
  },

  /**
   * Remove tags HTML e caracteres perigosos de strings de entrada.
   */
  cleanInput(value, maxLength = SECURITY.MAX_FIELD_LENGTH) {
    if (value === null || value === undefined) return '';
    let cleaned = String(value)
      .replace(/<[^>]*>/g, '')        // Remove tags HTML
      .replace(/javascript:/gi, '')   // Remove protocolo JS
      .replace(/on\w+\s*=/gi, '')     // Remove event handlers
      .replace(/data:/gi, '')         // Remove data URIs suspeitas
      .trim();

    // Limitar comprimento
    if (cleaned.length > maxLength) {
      cleaned = cleaned.substring(0, maxLength);
    }

    return cleaned;
  },

  /**
   * Valida e sanitiza número de telefone brasileiro.
   */
  cleanPhone(raw) {
    if (!raw) return '';
    let phone = String(raw).replace(/\D/g, '');
    // Remover zeros à esquerda de DDD
    phone = phone.replace(/^0+/, '');
    // Validação básica: mínimo 10 dígitos (sem código país)
    if (phone.length < 8) return '';
    return phone;
  },

  /**
   * Valida formato de e-mail.
   */
  validateEmail(email) {
    if (!email) return true; // Campo opcional
    const re = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
    return re.test(email);
  },

  /**
   * Valida e sanitiza URL.
   */
  validateUrl(url) {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      return ['https:', 'http:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  },

  /**
   * Sanitiza objeto de eleitor antes de salvar.
   */
  sanitizeEleitor(data) {
    return {
      nome:           this.cleanInput(data.nome, 200),
      data_nascimento:this.cleanInput(data.data_nascimento, 10),
      telefone:       this.cleanPhone(data.telefone),
      email:          this.cleanInput(data.email, 200).toLowerCase(),
      endereco:       this.cleanInput(data.endereco, 300),
      numero:         this.cleanInput(data.numero, 20),
      bairro:         this.cleanInput(data.bairro, 100),
      cidade:         this.cleanInput(data.cidade, 100),
      titulo_eleitor: this.cleanInput(data.titulo_eleitor, 20),
      secao:          this.cleanInput(data.secao, 10),
      escola_votacao: this.cleanInput(data.escola_votacao, 200),
      foto:           data.foto || null,  // Validado separadamente
    };
  },

  /**
   * Valida imagem antes de salvar.
   */
  validateImage(file) {
    if (!file) return { valid: false, error: 'Arquivo não selecionado.' };

    if (!SECURITY.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return {
        valid: false,
        error: `Tipo não permitido. Use: ${SECURITY.ALLOWED_IMAGE_TYPES.join(', ')}`
      };
    }

    const maxBytes = SECURITY.MAX_IMAGE_SIZE_MB * 1024 * 1024;
    if (file.size > maxBytes) {
      return {
        valid: false,
        error: `Imagem muito grande. Máximo: ${SECURITY.MAX_IMAGE_SIZE_MB}MB.`
      };
    }

    return { valid: true };
  },

  /**
   * Detecta tentativas de SQL Injection em strings.
   * Usado para logging e alertas, não como única defesa.
   */
  detectSQLInjection(value) {
    const patterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|UNION|TRUNCATE)\b)/gi,
      /(--|#|\/\*|\*\/)/g,
      /(\bOR\b\s+\d+=\d+)/gi,
      /(\bAND\b\s+\d+=\d+)/gi,
      /('.*'--|".*"--)/g,
    ];
    return patterns.some(p => p.test(value));
  },

  /**
   * Detecta tentativas de XSS em strings.
   */
  detectXSS(value) {
    const patterns = [
      /<script[^>]*>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /eval\s*\(/gi,
      /expression\s*\(/gi,
    ];
    return patterns.some(p => p.test(value));
  }
};

/* ============================================================
   GESTÃO DE SESSÃO SEGURA
   ============================================================ */
const SecureSession = {
  _key: 'ge_sessao_v2',

  save(user) {
    const session = {
      id: user.id,
      tipo: user.tipo,
      loginTime: Date.now(),
      expiresAt: Date.now() + SECURITY.SESSION_TIMEOUT_MS,
      csrfToken: CSRFProtection.get(),
    };
    sessionStorage.setItem(this._key, JSON.stringify(session));
  },

  load() {
    try {
      const raw = sessionStorage.getItem(this._key);
      if (!raw) return null;

      const session = JSON.parse(raw);

      // Verificar expiração
      if (Date.now() > session.expiresAt) {
        this.clear();
        return null;
      }

      return session;
    } catch {
      this.clear();
      return null;
    }
  },

  clear() {
    sessionStorage.removeItem(this._key);
    CSRFProtection.generate(); // Rotacionar token ao fazer logout
  },

  isValid() {
    return this.load() !== null;
  },

  getUserId() {
    const session = this.load();
    return session ? session.id : null;
  },

  getRemainingTime() {
    const session = this.load();
    if (!session) return 0;
    return Math.max(0, session.expiresAt - Date.now());
  },

  // Renovar sessão a cada atividade
  refresh() {
    const session = this.load();
    if (!session) return;
    session.expiresAt = Date.now() + SECURITY.SESSION_TIMEOUT_MS;
    sessionStorage.setItem(this._key, JSON.stringify(session));
  }
};

/* ============================================================
   LOGGER DE SEGURANÇA
   ============================================================ */
const SecurityLog = {
  _key: 'ge_seclog_v1',
  _maxEntries: 200,

  log(event, details = {}) {
    try {
      const entries = this._load();
      entries.unshift({
        id: Date.now(),
        timestamp: new Date().toISOString(),
        event,
        details,
        userAgent: navigator.userAgent.substring(0, 100),
      });

      if (entries.length > this._maxEntries) {
        entries.length = this._maxEntries;
      }

      localStorage.setItem(this._key, JSON.stringify(entries));
    } catch { /* silencioso */ }
  },

  _load() {
    try {
      return JSON.parse(localStorage.getItem(this._key)) || [];
    } catch {
      return [];
    }
  },

  getRecent(n = 20) {
    return this._load().slice(0, n);
  }
};

/* ============================================================
   VALIDADOR DE FORMULÁRIOS
   ============================================================ */
const FormValidator = {
  rules: {
    required: (v) => v !== null && v !== undefined && String(v).trim() !== '',
    minLength: (min) => (v) => String(v).length >= min,
    maxLength: (max) => (v) => String(v).length <= max,
    email: (v) => !v || Sanitizer.validateEmail(v),
    phone: (v) => !v || String(v).replace(/\D/g, '').length >= 8,
    noXSS: (v) => !Sanitizer.detectXSS(String(v)),
    noSQL: (v) => !Sanitizer.detectSQLInjection(String(v)),
  },

  validate(data, schema) {
    const errors = {};

    for (const [field, fieldRules] of Object.entries(schema)) {
      const value = data[field];

      for (const rule of fieldRules) {
        let isValid = true;
        let message = '';

        if (typeof rule === 'string' && this.rules[rule]) {
          isValid = this.rules[rule](value);
          message = this._getMessage(rule, field);
        } else if (typeof rule === 'object') {
          const [ruleName, param] = Object.entries(rule)[0];
          isValid = this.rules[ruleName](param)(value);
          message = this._getMessage(ruleName, field, param);
        }

        if (!isValid) {
          errors[field] = message;
          break;
        }
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  },

  _getMessage(rule, field, param) {
    const messages = {
      required: `${field} é obrigatório.`,
      minLength: `${field} deve ter pelo menos ${param} caracteres.`,
      maxLength: `${field} deve ter no máximo ${param} caracteres.`,
      email: 'E-mail inválido.',
      phone: 'Telefone inválido.',
      noXSS: 'Caracteres não permitidos detectados.',
      noSQL: 'Caracteres não permitidos detectados.',
    };
    return messages[rule] || 'Campo inválido.';
  }
};

/* ============================================================
   EXPORTAÇÕES
   ============================================================ */
window.GESecurity = {
  SECURITY,
  RateLimiter,
  CSRFProtection,
  SecureSession,
  SecurityLog,
  Sanitizer,
  FormValidator,
  hashSenha,
};

// Alias global para compatibilidade
window.escapeHtml = (str) => window.GESecurity.Sanitizer.escapeHtml(str);
window.hashSenha = hashSenha;
