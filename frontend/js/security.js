/**
 * frontend/js/security.js v3.0
 * Sanitização, validação e helpers de segurança no cliente.
 * Não substitui validação no backend — é defesa em profundidade.
 */

'use strict';

const SECURITY = {
  MAX_FIELD_LENGTH: 500,
  MAX_PHOTO_SIZE: 5 * 1024 * 1024, // 5 MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
};

const Sanitizer = {
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const map = {
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
      "'": '&#x27;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
    };
    return String(str).replace(/[&<>"'`=/]/g, s => map[s]);
  },

  cleanInput(value, maxLength = SECURITY.MAX_FIELD_LENGTH) {
    if (value === null || value === undefined) return '';
    let cleaned = String(value)
      .replace(/<[^>]*>/g, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '')
      .replace(/data:/gi, '')
      .trim();
    if (cleaned.length > maxLength) cleaned = cleaned.substring(0, maxLength);
    return cleaned;
  },

  cleanPhone(raw) {
    if (!raw) return '';
    let phone = String(raw).replace(/\D/g, '').replace(/^0+/, '');
    if (phone.length < 8) return '';
    return phone;
  },

  validateEmail(email) {
    if (!email) return true;
    return /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email);
  },

  validateUrl(url) {
    if (!url) return true;
    try {
      const parsed = new URL(url);
      return ['https:', 'http:'].includes(parsed.protocol);
    } catch { return false; }
  },

  validateImage(file) {
    if (!file) return { valid: false, error: 'Arquivo não selecionado.' };
    if (!SECURITY.ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return { valid: false, error: 'Tipo não permitido. Use JPEG, PNG ou WebP.' };
    }
    if (file.size > SECURITY.MAX_PHOTO_SIZE) {
      return { valid: false, error: 'Imagem muito grande. Máximo 5MB.' };
    }
    return { valid: true };
  },
};

const RateLimiter = {
  _attempts: {},
  check(key, max = 5, windowMs = 60000) {
    const now = Date.now();
    if (!this._attempts[key]) this._attempts[key] = [];
    this._attempts[key] = this._attempts[key].filter(t => now - t < windowMs);
    if (this._attempts[key].length >= max) return false;
    this._attempts[key].push(now);
    return true;
  },
  reset(key) { delete this._attempts[key]; }
};

window.GESecurity = { SECURITY, Sanitizer, RateLimiter };
window.escapeHtml = (s) => Sanitizer.escapeHtml(s);
