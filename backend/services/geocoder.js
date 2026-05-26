/**
 * backend/services/geocoder.js
 * Serviço de geocodificação via Nominatim (OpenStreetMap)
 *
 * REGRAS:
 * - Rate limit: 1 requisição por segundo (política de uso público do Nominatim)
 * - User-Agent obrigatório (Nominatim recusa requisições sem ele)
 * - Singleton para a fila compartilhada
 *
 * Uso:
 *   const geocoder = require('./services/geocoder');
 *   const result = await geocoder.geocodeAddress({ endereco, numero, bairro, cidade });
 *   // result: { lat, lng } | null
 */

'use strict';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT     = 'GestaoEleitores/1.0 (https://gestao-eleitores-n6l8.onrender.com)';
const MIN_INTERVAL_MS = 1100; // 1.1s para garantir margem ao limite de 1 req/s

let lastCallAt = 0;
let queue = Promise.resolve();

function buildQuery(parts) {
  return parts
    .filter(p => p && String(p).trim())
    .map(p => String(p).trim())
    .join(', ');
}

/**
 * Geocodifica um endereço usando Nominatim.
 * Retorna { lat, lng } ou null se não encontrar.
 *
 * @param {Object} addr { endereco, numero, bairro, cidade }
 * @returns {Promise<{lat: number, lng: number}|null>}
 */
async function geocodeAddress(addr) {
  const { endereco, numero, bairro, cidade } = addr || {};

  // Sem endereço minimamente útil, não tenta
  if (!cidade && !bairro && !endereco) return null;

  const fullQuery = buildQuery([
    endereco && numero ? `${endereco}, ${numero}` : endereco,
    bairro,
    cidade,
    'Brasil',
  ]);
  if (!fullQuery) return null;

  // Enfileira para respeitar rate limit (mesmo em chamadas concorrentes)
  queue = queue.then(async () => {
    const since = Date.now() - lastCallAt;
    if (since < MIN_INTERVAL_MS) {
      await new Promise(r => setTimeout(r, MIN_INTERVAL_MS - since));
    }
    lastCallAt = Date.now();

    const url = `${NOMINATIM_BASE}?format=json&limit=1&q=${encodeURIComponent(fullQuery)}&countrycodes=br`;
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      });
      if (!resp.ok) {
        console.warn('[Geocoder] HTTP', resp.status, 'para', fullQuery);
        return null;
      }
      const json = await resp.json();
      if (Array.isArray(json) && json.length > 0) {
        const lat = parseFloat(json[0].lat);
        const lng = parseFloat(json[0].lon);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng };
        }
      }
      return null;
    } catch (err) {
      console.warn('[Geocoder] Erro:', err.message);
      return null;
    }
  });

  return queue;
}

/**
 * Atualiza um registro no banco com o resultado da geocodificação.
 * Tabela: 'eleitores' ou 'liderancas'.
 */
async function geocodeAndUpdate(db, table, id, tenantId) {
  if (!['eleitores', 'liderancas'].includes(table)) {
    throw new Error('Tabela inválida: ' + table);
  }

  const r = await db.query(
    `SELECT endereco, numero, bairro, cidade, geocoded_attempt
     FROM ${table} WHERE id = $1 AND tenant_id = $2 AND ativo = TRUE`,
    [id, tenantId]
  );
  if (!r.rowCount) return { ok: false, reason: 'not_found' };

  const row = r.rows[0];

  // Sem endereço mínimo: marca como no_address e nem tenta
  if (!row.cidade && !row.bairro && !row.endereco) {
    await db.query(
      `UPDATE ${table}
       SET geocoded_status='no_address', geocoded_at=NOW(),
           geocoded_attempt = geocoded_attempt + 1
       WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId]
    );
    return { ok: false, reason: 'no_address' };
  }

  const result = await geocodeAddress({
    endereco: row.endereco,
    numero: row.numero,
    bairro: row.bairro,
    cidade: row.cidade,
  });

  if (!result) {
    await db.query(
      `UPDATE ${table}
       SET geocoded_status='failed', geocoded_at=NOW(),
           geocoded_attempt = geocoded_attempt + 1
       WHERE id=$1 AND tenant_id=$2`,
      [id, tenantId]
    );
    return { ok: false, reason: 'not_found_in_provider' };
  }

  await db.query(
    `UPDATE ${table}
     SET latitude=$1, longitude=$2,
         geocoded_status='done', geocoded_at=NOW(),
         geocoded_attempt = geocoded_attempt + 1
     WHERE id=$3 AND tenant_id=$4`,
    [result.lat, result.lng, id, tenantId]
  );
  return { ok: true, lat: result.lat, lng: result.lng };
}

/**
 * Dispara geocodificação em background (não bloqueia a resposta HTTP).
 * Loga falhas no console mas não propaga erro.
 */
function geocodeInBackground(db, table, id, tenantId) {
  geocodeAndUpdate(db, table, id, tenantId).catch(err => {
    console.error(`[Geocoder] background ${table}#${id}:`, err.message);
  });
}

module.exports = {
  geocodeAddress,
  geocodeAndUpdate,
  geocodeInBackground,
};
