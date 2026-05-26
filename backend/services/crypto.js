/**
 * backend/services/crypto.js
 * Criptografia simétrica AES-256-GCM para tokens sensíveis
 */

'use strict';

const crypto = require('crypto');

const KEY_HEX = process.env.WA_TOKEN_KEY;
const ALGO    = 'aes-256-gcm';

function getKey() {
  if (!KEY_HEX || KEY_HEX.length < 64) {
    throw new Error('[CRYPTO] WA_TOKEN_KEY inválida ou ausente. Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(KEY_HEX, 'hex');
}

/**
 * Criptografa um texto.
 * Retorna string no formato: iv:authTag:ciphertext (todos em hex)
 */
function encrypt(text) {
  if (!text) return null;
  const key = getKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Descriptografa um texto criptografado por encrypt().
 * Retorna o texto original ou null em caso de erro.
 */
function decrypt(encoded) {
  if (!encoded) return null;
  try {
    const [ivHex, tagHex, dataHex] = encoded.split(':');
    if (!ivHex || !tagHex || !dataHex) return null;
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
