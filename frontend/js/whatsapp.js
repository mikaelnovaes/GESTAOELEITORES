/**
 * frontend/js/whatsapp.js v3.1
 * Módulo WhatsApp — usa window.API (que respeita X-Acting-Tenant)
 * Em vez de fetch direto, todas as chamadas passam pelo helper.
 */

'use strict';

let waSelectedIds  = new Set();
let waCurrentMode  = 'template';
let waCurrentImage = null;

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
function formatPhoneForWA(raw, defaultCountry = '55') {
  if (!raw) return '';
  let p = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (!p) return '';
  if (p.length >= 12) return p;
  if (p.length === 10 || p.length === 11) return defaultCountry + p;
  return p;
}

function replaceVars(template, eleitor) {
  if (!template) return '';
  const primeiroNome = (eleitor.nome || '').split(' ')[0];
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, eleitor.nome || '')
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiroNome)
    .replace(/\{\{\s*bairro\s*\}\}/gi, eleitor.bairro || '')
    .replace(/\{\{\s*cidade\s*\}\}/gi, eleitor.cidade || '')
    .replace(/\{\{\s*endereco\s*\}\}/gi, eleitor.endereco || '');
}

/* ============================================================
   ENVIO INDIVIDUAL
   ============================================================ */
async function sendWhatsAppMessage(eleitor, mode, payload) {
  const result = await window.API.post('/whatsapp/send', {
    eleitorId: Number(eleitor.id),
    mode,
    payload,
  });
  return { messageId: result.messageId };
}

/* ============================================================
   ENVIO EM LOTE
   ============================================================ */
async function sendWhatsAppBatch(recipients, mode, payload) {
  const total  = recipients.length;
  const loteId = Date.now();
  let success  = 0, failed = 0;

  const progressModal = document.getElementById('wa-progress-modal');
  if (progressModal) {
    progressModal.classList.add('show');
    setText('wa-progress-title', 'Enviando mensagens...');
    setStyle('wa-progress-close', 'display', 'none');
    setStyle('wa-progress-result', 'display', 'none');
    setText('wa-progress-total', total);
    setText('wa-progress-current', '0');
    setText('wa-progress-success', '0');
    setText('wa-progress-failed', '0');
    setStyle('wa-progress-bar', 'width', '0%');
  }

  for (let i = 0; i < total; i++) {
    const e = recipients[i];
    setText('wa-progress-current-name', `Enviando para ${e.nome}...`);

    const conteudo = mode === 'text'
      ? replaceVars(payload.message || payload.text || '', e)
      : (mode === 'image' ? (payload.caption || '(imagem)') : `Template: ${payload.templateName}`);

    try {
      const r = await sendWhatsAppMessage(e, mode, payload);
      success++;
      window.WALog?.add({
        eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone,
        tipo: mode, conteudo, status: 'sent', message_id: r.messageId, lote_id: loteId,
      });
    } catch (err) {
      failed++;
      window.WALog?.add({
        eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone,
        tipo: mode, conteudo, status: 'failed', mensagem_erro: err.message, lote_id: loteId,
      });
    }

    setText('wa-progress-current', i + 1);
    setText('wa-progress-success', success);
    setText('wa-progress-failed', failed);
    setStyle('wa-progress-bar', 'width', `${((i + 1) / total) * 100}%`);

    if (i < total - 1) await new Promise(r => setTimeout(r, 300));
  }

  if (progressModal) {
    setText('wa-progress-current-name', '');
    setText('wa-progress-title', 'Envio concluído');
    setStyle('wa-progress-close', 'display', 'block');
    const resultEl = document.getElementById('wa-progress-result');
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.borderLeftColor = failed === 0 ? 'var(--success)' : (success === 0 ? 'var(--danger)' : 'var(--gold)');
      resultEl.innerHTML = `<strong>${success}</strong> enviadas · <strong>${failed}</strong> falharam.`;
    }
  }
}

function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function setStyle(id, k, v) { const el = document.getElementById(id); if (el) el.style[k] = v; }

/* ============================================================
   VIEW: ENVIAR
   ============================================================ */
async function openWhatsAppSend() {
  const warn = document.getElementById('wa-config-warning');
  if (warn) {
    try {
      const cfg = await window.API.get('/whatsapp/config');
      warn.style.display = cfg.configurado ? 'none' : 'block';
    } catch { warn.style.display = 'block'; }
  }
  renderWARecipients();
  setupWAModeTabs();
  setupWASend();
}

function renderWARecipients() {
  const container = document.getElementById('wa-recipients-list');
  if (!container) return;
  const eleitores = (window.Eleitores?.all() || []).filter(e => e.telefone);
  if (!eleitores.length) {
    container.innerHTML = '<div class="empty"><p>Nenhum eleitor com telefone cadastrado.</p></div>';
    return;
  }
  container.innerHTML = `
    <div style="display:flex;gap:0.5rem;margin-bottom:0.8rem;align-items:center;">
      <input type="search" id="wa-search" placeholder="Buscar..." style="flex:1;padding:6px 10px;border:1px solid var(--line);border-radius:3px;">
      <button class="btn btn-secondary" id="wa-select-all" style="padding:6px 12px;">Selecionar todos</button>
      <span style="font-size:0.82rem;color:var(--muted);">
        <span id="wa-selected-count">0</span> selecionado(s)
      </span>
    </div>
    <div id="wa-list-items" style="max-height:340px;overflow-y:auto;border:1px solid var(--line);border-radius:3px;"></div>
  `;
  drawList(eleitores);
  document.getElementById('wa-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    drawList(eleitores.filter(el => (el.nome || '').toLowerCase().includes(q)));
  });
  document.getElementById('wa-select-all')?.addEventListener('click', () => {
    const visible = container.querySelectorAll('[data-wa-id]');
    const allSel = [...visible].every(c => waSelectedIds.has(Number(c.dataset.waId)));
    visible.forEach(c => {
      const id = Number(c.dataset.waId);
      if (allSel) waSelectedIds.delete(id); else waSelectedIds.add(id);
    });
    drawList(eleitores);
  });
}

function drawList(items) {
  const wrap = document.getElementById('wa-list-items');
  if (!wrap) return;
  wrap.innerHTML = items.map(e => `
    <label data-wa-id="${e.id}" style="display:flex;gap:0.6rem;align-items:center;padding:8px 10px;border-bottom:1px solid var(--line);cursor:pointer;${waSelectedIds.has(Number(e.id)) ? 'background:rgba(201,169,97,0.08);' : ''}">
      <input type="checkbox" data-wa-check="${e.id}" ${waSelectedIds.has(Number(e.id)) ? 'checked' : ''}>
      <div style="flex:1;">
        <div style="font-weight:500;font-size:0.88rem;">${escapeHtml(e.nome)}</div>
        <div style="font-size:0.78rem;color:var(--muted);">${escapeHtml(e.telefone || '')} ${e.bairro ? '· ' + escapeHtml(e.bairro) : ''}</div>
      </div>
    </label>
  `).join('');
  wrap.querySelectorAll('[data-wa-check]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.waCheck);
      if (cb.checked) waSelectedIds.add(id); else waSelectedIds.delete(id);
      const el = document.getElementById('wa-selected-count');
      if (el) el.textContent = waSelectedIds.size;
      const parent = cb.closest('[data-wa-id]');
      if (parent) parent.style.background = cb.checked ? 'rgba(201,169,97,0.08)' : '';
    });
  });
  const cnt = document.getElementById('wa-selected-count');
  if (cnt) cnt.textContent = waSelectedIds.size;
}

function setupWAModeTabs() {
  document.querySelectorAll('[data-wa-mode]').forEach(tab => {
    tab.addEventListener('click', () => {
      waCurrentMode = tab.dataset.waMode;
      document.querySelectorAll('[data-wa-mode]').forEach(t => t.classList.toggle('active', t === tab));
      ['wa-mode-template', 'wa-mode-text', 'wa-mode-image'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = id === `wa-mode-${waCurrentMode}` ? 'block' : 'none';
      });
    });
  });
  // Carregar templates no select
  window.API.get('/whatsapp/templates').then(templates => {
    const sel = document.getElementById('wa-template-name');
    if (sel) {
      sel.innerHTML = '<option value="">— escolha —</option>' +
        templates.map(t => `<option value="${escapeHtml(t.nome)}" data-lang="${escapeHtml(t.idioma)}">${escapeHtml(t.nome)}</option>`).join('');
    }
  }).catch(() => {});
}

function setupWASend() {
  document.getElementById('wa-send-btn')?.addEventListener('click', async () => {
    const recipients = (window.Eleitores?.all() || []).filter(e => waSelectedIds.has(Number(e.id)));
    if (!recipients.length) { showToast('Selecione ao menos um destinatário.', 'error'); return; }

    let payload;
    if (waCurrentMode === 'text') {
      const text = document.getElementById('wa-text-message')?.value.trim();
      if (!text) { showToast('Digite uma mensagem.', 'error'); return; }
      payload = { message: text };
    } else if (waCurrentMode === 'template') {
      const templateName = document.getElementById('wa-template-name')?.value;
      const language = document.getElementById('wa-template-lang')?.value || 'pt_BR';
      if (!templateName) { showToast('Selecione um template.', 'error'); return; }
      const variables = (document.getElementById('wa-template-vars')?.value || '').split('\n').filter(l => l.trim());
      payload = { templateName, language, variables };
    } else {
      const imageUrl = document.getElementById('wa-image-url')?.value.trim();
      const caption = document.getElementById('wa-image-caption')?.value.trim() || '';
      if (!imageUrl) { showToast('Informe a URL da imagem.', 'error'); return; }
      payload = { imageUrl, caption };
    }

    if (!confirm(`Enviar para ${recipients.length} destinatário(s)?`)) return;
    await sendWhatsAppBatch(recipients, waCurrentMode, payload);
  });

  document.getElementById('wa-progress-close')?.addEventListener('click', () => {
    document.getElementById('wa-progress-modal')?.classList.remove('show');
  });
}

/* ============================================================
   VIEW: CONFIGURAÇÃO
   ============================================================ */
async function openWhatsAppConfig() {
  try {
    const cfg = await window.API.get('/whatsapp/config');
    const statusEl = document.getElementById('wa-config-status');
    const statusTextEl = document.getElementById('wa-config-status-text');
    if (statusEl && statusTextEl) {
      if (cfg.configurado) {
        statusEl.className = 'wa-config-status ok';
        statusTextEl.innerHTML = '<strong>✓ API configurada.</strong>';
      } else {
        statusEl.className = 'wa-config-status err';
        statusTextEl.innerHTML = '<strong>⚠ Não configurado.</strong> Preencha o Phone ID e Token abaixo.';
      }
    }
    const fields = { phone_id: 'wa-cfg-phoneId', waba_id: 'wa-cfg-wabaId', country_code: 'wa-cfg-country' };
    Object.entries(fields).forEach(([key, id]) => {
      const el = document.getElementById(id);
      if (el) el.value = cfg[key] || (key === 'country_code' ? '55' : '');
    });
    await renderWATemplatesConfig();
  } catch (err) {
    console.error('[WA] config:', err);
  }
}

async function renderWATemplatesConfig() {
  const container = document.getElementById('wa-templates-list');
  if (!container) return;
  try {
    const templates = await window.API.get('/whatsapp/templates');
    if (!templates.length) {
      container.innerHTML = '<div style="color:var(--muted);font-size:0.85rem;padding:0.5rem 0;">Nenhum template.</div>';
      return;
    }
    container.innerHTML = templates.map(t => `
      <div style="display:flex;align-items:center;gap:0.6rem;padding:0.5rem 0;border-bottom:1px solid var(--line);">
        <span style="font-size:0.88rem;font-weight:500;flex:1;">${escapeHtml(t.nome)}</span>
        <span class="badge badge-comum">${escapeHtml(t.idioma)}</span>
        <button class="icon-btn danger" data-tpl-del="${t.id}">Remover</button>
      </div>
    `).join('');
    container.querySelectorAll('[data-tpl-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remover template?')) return;
        try {
          await window.API.delete(`/whatsapp/templates/${btn.dataset.tplDel}`);
          showToast('Template removido.', 'success');
          renderWATemplatesConfig();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  } catch (err) { console.error(err); }
}

/* ============================================================
   VIEW: LOG
   ============================================================ */
async function renderWhatsAppLog() {
  const container = document.getElementById('wa-log-container');
  if (!container) return;
  try {
    const logs = await window.API.get('/whatsapp/log');
    if (!logs.length) {
      container.innerHTML = '<div class="empty"><h3>Sem envios</h3></div>';
      return;
    }
    container.innerHTML = `
      <table>
        <thead><tr><th>Data</th><th>Eleitor</th><th>Telefone</th><th>Tipo</th><th>Status</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td style="font-size:0.82rem;">${formatDateTime(l.data_envio)}</td>
          <td><strong>${escapeHtml(l.eleitor_nome)}</strong></td>
          <td>${escapeHtml(l.telefone)}</td>
          <td>${escapeHtml(l.tipo)}</td>
          <td>${l.status === 'sent' ? '<span class="badge badge-success">✓ Enviado</span>' : '<span class="badge" style="background:var(--danger-soft);color:var(--danger);">✗ Falha</span>'}</td>
        </tr>`).join('')}</tbody>
      </table>`;
  } catch (err) {
    container.innerHTML = `<div class="empty"><p>${escapeHtml(err.message)}</p></div>`;
  }
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
function initWhatsApp() {
  // Salvar config
  document.getElementById('wa-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {
      phone_id: document.getElementById('wa-cfg-phoneId')?.value.trim(),
      access_token: document.getElementById('wa-cfg-token')?.value.trim(),
      waba_id: document.getElementById('wa-cfg-wabaId')?.value.trim(),
      country_code: document.getElementById('wa-cfg-country')?.value.trim() || '55',
    };
    try {
      await window.API.put('/whatsapp/config', body);
      showToast('Configuração salva.', 'success');
      openWhatsAppConfig();
    } catch (err) { showToast(err.message || 'Erro.', 'error'); }
  });

  // Adicionar template
  document.getElementById('wa-template-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = document.getElementById('wa-tpl-name')?.value.trim();
    const idioma = document.getElementById('wa-tpl-lang')?.value.trim() || 'pt_BR';
    if (!nome) { showToast('Informe o nome do template.', 'error'); return; }
    try {
      await window.API.post('/whatsapp/templates', { nome, idioma });
      showToast('Template adicionado.', 'success');
      document.getElementById('wa-tpl-name').value = '';
      renderWATemplatesConfig();
    } catch (err) { showToast(err.message || 'Erro.', 'error'); }
  });

  // Limpar histórico
  document.getElementById('btn-wa-clear-log')?.addEventListener('click', async () => {
    if (!confirm('Limpar histórico de envios deste ambiente?')) return;
    try {
      await window.API.delete('/whatsapp/log');
      showToast('Histórico limpo.', 'success');
      renderWhatsAppLog();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

window.GEWhatsApp = {
  initWhatsApp, openWhatsAppSend, openWhatsAppConfig,
  renderWhatsAppLog, sendWhatsAppMessage,
};
