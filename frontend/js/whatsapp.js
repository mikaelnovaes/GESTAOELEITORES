/**
 * frontend/js/whatsapp.js
 * Módulo WhatsApp — envio via backend (token protegido no servidor)
 *
 * Na versão Railway/Render, o frontend não armazena nem envia
 * o token da Meta. Todas as chamadas passam pela API do backend
 * autenticadas com JWT.
 */

'use strict';

/* ============================================================
   ESTADO LOCAL
   ============================================================ */
let waSelectedIds  = new Set();
let waCurrentMode  = 'template';
let waSearchTerm   = '';
let waCurrentImage = null;  // { dataUrl, name, mime, size }
let waLogView      = 'batches';

/* ============================================================
   UTILITÁRIOS
   ============================================================ */
function formatPhoneForWA(raw, defaultCountry = '55') {
  if (!raw) return '';
  let phone = String(raw).replace(/\D/g, '').replace(/^0+/, '');
  if (!phone) return '';
  if (phone.length >= 12) return phone;
  if (phone.length === 10 || phone.length === 11) return defaultCountry + phone;
  return phone;
}

function replaceVars(template, eleitor) {
  if (!template) return '';
  const primeiroNome = (eleitor.nome || '').split(' ')[0];
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi,          eleitor.nome     || '')
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi,  primeiroNome)
    .replace(/\{\{\s*bairro\s*\}\}/gi,         eleitor.bairro   || '')
    .replace(/\{\{\s*cidade\s*\}\}/gi,         eleitor.cidade   || '')
    .replace(/\{\{\s*endereco\s*\}\}/gi,       eleitor.endereco || '');
}

/* ============================================================
   ENVIO — chama o backend (token protegido no servidor)
   ============================================================ */
async function sendWhatsAppMessage(eleitor, mode, payload) {
  const token = sessionStorage.getItem('ge_jwt_token');
  if (!token) throw new Error('Sessão expirada. Faça login novamente.');

  const response = await fetch('/api/whatsapp/send', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ eleitorId: eleitor.id, mode, payload }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Erro ${response.status}`);
  }

  return { messageId: data.messageId };
}

/* ============================================================
   ENVIO EM LOTE
   ============================================================ */
async function sendWhatsAppBatch(recipients, mode, payload) {
  const total  = recipients.length;
  const loteId = Date.now();
  let success  = 0, failed = 0;

  let conteudoResumo;
  if (mode === 'text')       conteudoResumo = payload.text;
  else if (mode === 'image') conteudoResumo = payload.caption || '(imagem sem legenda)';
  else                       conteudoResumo = `Template: ${payload.templateName}`;

  // Abrir modal de progresso
  const progressModal = document.getElementById('wa-progress-modal');
  if (progressModal) {
    progressModal.classList.add('show');
    document.getElementById('wa-progress-title').textContent     = 'Enviando mensagens...';
    document.getElementById('wa-progress-close').style.display   = 'none';
    document.getElementById('wa-progress-result').style.display  = 'none';
    document.getElementById('wa-progress-total').textContent     = total;
    document.getElementById('wa-progress-current').textContent   = '0';
    document.getElementById('wa-progress-success').textContent   = '0';
    document.getElementById('wa-progress-failed').textContent    = '0';
    document.getElementById('wa-progress-bar').style.width       = '0%';
  }

  for (let i = 0; i < total; i++) {
    const e = recipients[i];
    const nameEl = document.getElementById('wa-progress-current-name');
    if (nameEl) nameEl.textContent = `Enviando para ${e.nome}...`;

    const conteudoIndividual = mode === 'text'
      ? replaceVars(payload.text, e)
      : (mode === 'image' ? replaceVars(payload.caption || '', e) : conteudoResumo);

    try {
      const result = await sendWhatsAppMessage(e, mode, payload);
      success++;
      WALog.add({
        eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone,
        tipo: mode, conteudo: conteudoIndividual,
        status: 'sent', message_id: result.messageId, lote_id: loteId
      });
    } catch (err) {
      failed++;
      WALog.add({
        eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone,
        tipo: mode, conteudo: conteudoIndividual,
        status: 'failed', mensagem_erro: err.message || 'Erro desconhecido', lote_id: loteId
      });
    }

    // Atualizar progresso
    if (progressModal) {
      document.getElementById('wa-progress-current').textContent  = i + 1;
      document.getElementById('wa-progress-success').textContent  = success;
      document.getElementById('wa-progress-failed').textContent   = failed;
      document.getElementById('wa-progress-bar').style.width      = `${((i + 1) / total) * 100}%`;
    }

    // Delay entre envios (evitar rate limit da Meta)
    if (i < total - 1) await new Promise(r => setTimeout(r, 300));
  }

  // Finalizar modal
  if (progressModal) {
    if (document.getElementById('wa-progress-current-name'))
      document.getElementById('wa-progress-current-name').textContent = '';
    document.getElementById('wa-progress-title').textContent    = 'Envio concluído';
    document.getElementById('wa-progress-close').style.display  = 'block';

    const resultEl = document.getElementById('wa-progress-result');
    if (resultEl) {
      resultEl.style.display         = 'block';
      resultEl.style.borderLeftColor = failed === 0
        ? 'var(--success)'
        : (success === 0 ? 'var(--danger)' : 'var(--gold)');
      resultEl.innerHTML = `
        <strong>${success}</strong> enviadas com sucesso · <strong>${failed}</strong> falharam.<br>
        <span style="font-size:0.82rem; color:var(--muted)">Veja detalhes na tela de Histórico.</span>
      `;
    }
  }
}

/* ============================================================
   VIEW: ENVIAR — inicialização
   ============================================================ */
function openWhatsAppSend() {
  const configWarning = document.getElementById('wa-config-warning');
  if (configWarning) {
    // Verificar config via API
    const token = sessionStorage.getItem('ge_jwt_token');
    fetch('/api/whatsapp/config', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(cfg => {
      if (configWarning) configWarning.style.display = cfg.configurado ? 'none' : 'block';
    })
    .catch(() => {});
  }

  // Carregar templates via API
  loadWATemplates().then(() => {
    renderWAVariableButtons();
    renderWARecipients();
    updateWAPreview();
    updateWAButtons();
  });
}

async function loadWATemplates() {
  try {
    const token = sessionStorage.getItem('ge_jwt_token');
    const r = await fetch('/api/whatsapp/templates', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const templates = await r.json();

    const tplSelect = document.getElementById('wa-template-name');
    if (tplSelect) {
      tplSelect.innerHTML = '<option value="">— Selecione um template —</option>' +
        templates.map(t =>
          `<option value="${escapeHtml(t.nome)}" data-lang="${escapeHtml(t.idioma)}">${escapeHtml(t.nome)} (${escapeHtml(t.idioma)})</option>`
        ).join('');
    }
  } catch (err) {
    console.error('Erro ao carregar templates:', err);
  }
}

function renderWAVariableButtons() {
  const vars = ['{{nome}}', '{{primeiro_nome}}', '{{bairro}}', '{{cidade}}', '{{endereco}}'];
  const html = '<span style="font-size:0.74rem; color:var(--muted); margin-right:0.4rem; align-self:center">Inserir:</span>' +
    vars.map(v => `<button type="button" class="wa-var-btn" data-var="${v}">${v}</button>`).join('');

  ['wa-text-vars-buttons', 'wa-template-vars-buttons', 'wa-image-vars-buttons'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  });

  document.querySelectorAll('.wa-var-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.dataset.var;
      let target;
      if (waCurrentMode === 'text')        target = document.getElementById('wa-text-message');
      else if (waCurrentMode === 'image')  target = document.getElementById('wa-image-caption');
      else                                 target = document.getElementById('wa-template-vars');
      if (!target) return;
      const start = target.selectionStart, end = target.selectionEnd;
      target.value = target.value.substring(0, start) + v + target.value.substring(end);
      target.focus();
      target.selectionStart = target.selectionEnd = start + v.length;
      updateWAPreview();
    });
  });
}

function renderWARecipients() {
  const all      = Eleitores.all().sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  const term     = waSearchTerm.toLowerCase();
  const filtered = term
    ? all.filter(e => (e.nome || '').toLowerCase().includes(term) || (e.telefone || '').includes(term))
    : all;

  const container = document.getElementById('wa-recipient-list');
  if (!container) return;

  if (!filtered.length) {
    container.innerHTML = `<div style="padding:1.5rem; text-align:center; color:var(--muted); font-size:0.85rem;">${term ? 'Nenhum resultado.' : 'Nenhum eleitor cadastrado.'}</div>`;
    updateWAButtons();
    return;
  }

  container.innerHTML = filtered.map(e => `
    <div class="recipient-item ${waSelectedIds.has(e.id) ? 'selected' : ''} ${!e.telefone ? 'disabled' : ''}"
         data-id="${e.id}" ${!e.telefone ? 'title="Sem telefone cadastrado"' : ''}>
      <div class="recipient-check">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      <div style="flex:1; min-width:0;">
        <div class="recipient-name">${escapeHtml(e.nome)}</div>
        <div class="recipient-phone">${e.telefone ? escapeHtml(e.telefone) : '<em style="color:var(--danger)">sem telefone</em>'}</div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.recipient-item:not(.disabled)').forEach(item => {
    item.addEventListener('click', () => {
      const id = parseInt(item.dataset.id);
      if (waSelectedIds.has(id)) waSelectedIds.delete(id);
      else waSelectedIds.add(id);
      item.classList.toggle('selected', waSelectedIds.has(id));
      updateWAButtons();
    });
  });

  updateWAButtons();
}

function updateWAButtons() {
  const btn     = document.getElementById('btn-wa-send');
  const counter = document.getElementById('wa-selected-count');
  const count   = waSelectedIds.size;
  if (btn)     btn.disabled = count === 0;
  if (counter) counter.textContent = count > 0 ? `${count} selecionado(s)` : '';
}

function updateWAPreview() {
  const previewEl = document.getElementById('wa-preview-bubble');
  if (!previewEl) return;

  let text = '';
  if (waCurrentMode === 'text') {
    text = document.getElementById('wa-text-message')?.value || '';
  } else if (waCurrentMode === 'template') {
    const name = document.getElementById('wa-template-name')?.value || '';
    const vars = document.getElementById('wa-template-vars')?.value || '';
    text = name ? `[Template: ${name}]\n${vars}` : '(nenhum template selecionado)';
  } else if (waCurrentMode === 'image') {
    text = document.getElementById('wa-image-caption')?.value || '(imagem sem legenda)';
  }

  // Substituir vars com dados do primeiro selecionado (prévia)
  const firstId = [...waSelectedIds][0];
  const sample  = firstId ? Eleitores.find(firstId) : { nome: 'Nome do eleitor', bairro: 'Bairro', cidade: 'Cidade' };
  previewEl.textContent = replaceVars(text, sample || {});
}

/* ============================================================
   VIEW: CONFIGURAÇÃO
   ============================================================ */
async function openWhatsAppConfig() {
  try {
    const token = sessionStorage.getItem('ge_jwt_token');
    const r = await fetch('/api/whatsapp/config', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const cfg = await r.json();

    const statusEl     = document.getElementById('wa-config-status');
    const statusTextEl = document.getElementById('wa-config-status-text');
    if (statusEl && statusTextEl) {
      if (cfg.configurado) {
        statusEl.className = 'wa-config-status ok';
        statusTextEl.innerHTML = '<strong>✓ API configurada.</strong> Phone ID cadastrado.';
      } else {
        statusEl.className = 'wa-config-status err';
        statusTextEl.innerHTML = '<strong>⚠ Não configurado.</strong> Preencha o Phone ID e Token.';
      }
    }

    const phoneIdEl = document.getElementById('wa-cfg-phoneId');
    const wabaIdEl  = document.getElementById('wa-cfg-wabaId');
    const countryEl = document.getElementById('wa-cfg-country');
    if (phoneIdEl) phoneIdEl.value  = cfg.phone_id   || '';
    if (wabaIdEl)  wabaIdEl.value   = cfg.waba_id    || '';
    if (countryEl) countryEl.value  = cfg.country_code || '55';

    await renderWATemplatesConfig();
  } catch (err) {
    console.error('Erro ao carregar config WA:', err);
  }
}

async function renderWATemplatesConfig() {
  const container = document.getElementById('wa-templates-list');
  if (!container) return;

  try {
    const token = sessionStorage.getItem('ge_jwt_token');
    const r = await fetch('/api/whatsapp/templates', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const templates = await r.json();

    if (!templates.length) {
      container.innerHTML = '<div style="color:var(--muted); font-size:0.85rem; padding:0.5rem 0;">Nenhum template cadastrado.</div>';
      return;
    }

    container.innerHTML = templates.map(t => `
      <div style="display:flex; align-items:center; gap:0.6rem; padding:0.5rem 0; border-bottom:1px solid var(--line);">
        <span style="font-size:0.88rem; font-weight:500; flex:1;">${escapeHtml(t.nome)}</span>
        <span class="badge badge-comum">${escapeHtml(t.idioma)}</span>
        <button class="icon-btn danger" data-tpl-del="${t.id}">Remover</button>
      </div>
    `).join('');

    container.querySelectorAll('[data-tpl-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remover template?')) return;
        const token = sessionStorage.getItem('ge_jwt_token');
        await fetch(`/api/whatsapp/templates/${btn.dataset.tplDel}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        renderWATemplatesConfig();
      });
    });
  } catch (err) {
    container.innerHTML = '<div style="color:var(--danger);">Erro ao carregar templates.</div>';
  }
}

/* ============================================================
   VIEW: HISTÓRICO
   ============================================================ */
async function renderWhatsAppLog() {
  const log     = WALog.all();
  const success = log.filter(l => l.status === 'sent').length;
  const failed  = log.filter(l => l.status === 'failed').length;
  const lotes   = new Set(log.map(l => l.lote_id)).size;

  const statEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  statEl('wa-stat-total',   log.length);
  statEl('wa-stat-success', success);
  statEl('wa-stat-failed',  failed);
  statEl('wa-stat-batches', lotes);

  const container = document.getElementById('wa-log-container');
  if (!container) return;

  if (!log.length) {
    container.innerHTML = '<div class="empty"><h3>Nenhum envio realizado</h3><p>O histórico aparecerá aqui após o primeiro envio.</p></div>';
    return;
  }

  if (waLogView === 'batches') renderWhatsAppLogByBatches(log, container);
  else renderWhatsAppLogFlat(log, container);
}

function renderWhatsAppLogFlat(log, container) {
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Data/Hora</th><th>Destinatário</th><th>Tipo</th><th>Status</th><th>Erro</th>
        </tr>
      </thead>
      <tbody>
        ${log.map(l => `
          <tr>
            <td style="font-size:0.8rem; white-space:nowrap;">${formatDateTime(l.data_envio)}</td>
            <td><strong>${escapeHtml(l.eleitor_nome)}</strong><br><small style="color:var(--muted)">${escapeHtml(l.telefone || '')}</small></td>
            <td><span class="badge badge-comum">${escapeHtml(l.tipo)}</span></td>
            <td>${l.status === 'sent'
              ? '<span class="badge badge-success">✓ Enviado</span>'
              : '<span class="badge" style="background:var(--danger-soft);color:var(--danger)">✗ Falhou</span>'
            }</td>
            <td style="font-size:0.78rem; color:var(--danger);">${escapeHtml(l.mensagem_erro || '—')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderWhatsAppLogByBatches(log, container) {
  const groups = new Map();
  log.forEach(l => {
    const key = l.lote_id || l.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  });

  const batches = [...groups.entries()]
    .map(([loteId, items]) => ({
      loteId, items,
      data:   items[0].data_envio,
      tipo:   items[0].tipo,
      total:  items.length,
      sent:   items.filter(i => i.status === 'sent').length,
      failed: items.filter(i => i.status === 'failed').length,
    }))
    .sort((a, b) => b.loteId - a.loteId);

  container.innerHTML = batches.map((b, idx) => `
    <div style="border-bottom:1px solid var(--line); padding:1rem 2rem;">
      <div style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;" data-batch-toggle="${idx}">
        <div>
          <div style="font-weight:600; color:var(--navy); font-size:0.9rem;">
            ${b.total > 1 ? '👥 Envio Coletivo' : '👤 Envio Individual'}
            <span class="badge badge-comum" style="margin-left:0.4rem;">${escapeHtml(b.tipo)}</span>
          </div>
          <div style="font-size:0.8rem; color:var(--muted); margin-top:0.2rem;">
            ${formatDateTime(b.data)} · ${b.total} destinatário(s)
          </div>
        </div>
        <div style="display:flex; gap:0.4rem; align-items:center;">
          ${b.sent   > 0 ? `<span class="badge badge-success">✓ ${b.sent}</span>`   : ''}
          ${b.failed > 0 ? `<span class="badge" style="background:var(--danger-soft);color:var(--danger);">✗ ${b.failed}</span>` : ''}
          <span style="color:var(--muted); font-size:1.2rem; margin-left:0.4rem;" id="wa-batch-arrow-${idx}">›</span>
        </div>
      </div>
      <div id="wa-batch-body-${idx}" style="display:none; margin-top:1rem;">
        <table style="font-size:0.83rem;">
          <thead><tr><th>Destinatário</th><th>Telefone</th><th>Status</th></tr></thead>
          <tbody>
            ${b.items.map(it => `
              <tr>
                <td><strong>${escapeHtml(it.eleitor_nome)}</strong></td>
                <td style="font-family:monospace;">${escapeHtml(it.telefone || '—')}</td>
                <td>${it.status === 'sent'
                  ? '<span class="badge badge-success">✓ Enviado</span>'
                  : `<span class="badge" style="background:var(--danger-soft);color:var(--danger);" title="${escapeHtml(it.mensagem_erro||'')}">✗ Falhou</span>`
                }</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `).join('');

  // Acordeão
  container.querySelectorAll('[data-batch-toggle]').forEach(el => {
    el.addEventListener('click', () => {
      const idx    = el.dataset.batchToggle;
      const body   = document.getElementById(`wa-batch-body-${idx}`);
      const arrow  = document.getElementById(`wa-batch-arrow-${idx}`);
      const isOpen = body.style.display !== 'none';
      body.style.display  = isOpen ? 'none' : 'block';
      if (arrow) arrow.textContent = isOpen ? '›' : '⌄';
    });
  });
}

/* ============================================================
   INICIALIZAÇÃO DE EVENTOS
   ============================================================ */
function initWhatsApp() {
  // Tabs de modo (template / texto / imagem)
  document.querySelectorAll('.wa-mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      waCurrentMode = tab.dataset.mode;
      document.querySelectorAll('.wa-mode-tab').forEach(t => t.classList.toggle('active', t === tab));
      ['wa-template-fields','wa-text-fields','wa-image-fields'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      ['wa-template-info','wa-text-info','wa-image-info'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      const fieldId = `wa-${waCurrentMode}-fields`;
      const infoId  = `wa-mode-${waCurrentMode}-info`;
      const fieldEl = document.getElementById(fieldId);
      const infoEl  = document.getElementById(infoId);
      if (fieldEl) fieldEl.style.display = 'block';
      if (infoEl)  infoEl.style.display  = 'block';
      updateWAPreview();
    });
  });

  // Busca de destinatários
  const searchInput = document.getElementById('wa-recipient-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      waSearchTerm = e.target.value;
      renderWARecipients();
    });
  }

  // Selecionar/Desmarcar todos
  document.getElementById('btn-wa-select-all')?.addEventListener('click', () => {
    const all = Eleitores.all().filter(e => e.telefone);
    all.forEach(e => waSelectedIds.add(e.id));
    renderWARecipients();
  });

  document.getElementById('btn-wa-deselect-all')?.addEventListener('click', () => {
    waSelectedIds.clear();
    renderWARecipients();
  });

  // Enviar
  document.getElementById('btn-wa-send')?.addEventListener('click', async () => {
    if (!waSelectedIds.size) return;

    const recipients = [...waSelectedIds]
      .map(id => Eleitores.find(id))
      .filter(e => e?.telefone);

    if (!recipients.length) { showToast('Nenhum destinatário com telefone.', 'error'); return; }

    let payload;
    if (waCurrentMode === 'text') {
      const text = document.getElementById('wa-text-message')?.value.trim();
      if (!text) { showToast('Digite uma mensagem.', 'error'); return; }
      payload = { text };
    } else if (waCurrentMode === 'template') {
      const templateName = document.getElementById('wa-template-name')?.value;
      const language     = document.getElementById('wa-template-lang')?.value || 'pt_BR';
      if (!templateName) { showToast('Selecione um template.', 'error'); return; }
      const variables = (document.getElementById('wa-template-vars')?.value || '').split('\n').filter(l => l.trim());
      payload = { templateName, language, variables };
    } else if (waCurrentMode === 'image') {
      const imageUrl = document.getElementById('wa-image-url')?.value.trim();
      const caption  = document.getElementById('wa-image-caption')?.value.trim() || '';
      if (!imageUrl) { showToast('Informe a URL da imagem.', 'error'); return; }
      payload = { imageUrl, caption };
    }

    if (!confirm(`Enviar mensagem para ${recipients.length} destinatário(s)?\n\nIsso pode gerar custos conforme tarifa da Meta.`)) return;

    await sendWhatsAppBatch(recipients, waCurrentMode, payload);
  });

  // Fechar modal de progresso
  document.getElementById('wa-progress-close')?.addEventListener('click', () => {
    document.getElementById('wa-progress-modal')?.classList.remove('show');
  });

  // Salvar config WA
  document.getElementById('wa-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = sessionStorage.getItem('ge_jwt_token');
    const body  = {
      phone_id:     document.getElementById('wa-cfg-phoneId')?.value.trim(),
      access_token: document.getElementById('wa-cfg-token')?.value.trim(),
      waba_id:      document.getElementById('wa-cfg-wabaId')?.value.trim(),
      country_code: document.getElementById('wa-cfg-country')?.value.trim() || '55',
    };

    try {
      const r = await fetch('/api/whatsapp/config', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify(body),
      });
      if (r.ok) {
        showToast('Configuração salva com sucesso.', 'success');
        openWhatsAppConfig();
      } else {
        const data = await r.json();
        showToast(data.error || 'Erro ao salvar.', 'error');
      }
    } catch {
      showToast('Erro ao salvar configuração.', 'error');
    }
  });

  // Adicionar template
  document.getElementById('wa-template-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome   = document.getElementById('wa-tpl-name')?.value.trim();
    const idioma = document.getElementById('wa-tpl-lang')?.value.trim() || 'pt_BR';
    if (!nome) { showToast('Informe o nome do template.', 'error'); return; }

    const token = sessionStorage.getItem('ge_jwt_token');
    try {
      const r = await fetch('/api/whatsapp/templates', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ nome, idioma }),
      });
      if (r.ok) {
        showToast('Template adicionado.', 'success');
        document.getElementById('wa-tpl-name').value = '';
        renderWATemplatesConfig();
      } else {
        const data = await r.json();
        showToast(data.error || 'Erro ao adicionar.', 'error');
      }
    } catch {
      showToast('Erro ao adicionar template.', 'error');
    }
  });

  // Tabs do histórico
  document.querySelectorAll('.wa-log-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      waLogView = tab.dataset.logView;
      document.querySelectorAll('.wa-log-tab').forEach(t => t.classList.toggle('active', t === tab));
      renderWhatsAppLog();
    });
  });

  // Limpar histórico
  document.getElementById('btn-wa-clear-log')?.addEventListener('click', () => {
    if (!confirm('Limpar todo o histórico de envios?')) return;
    WALog.clear();
    renderWhatsAppLog();
    showToast('Histórico limpo.', 'success');
  });
}

// Expõe funções para app.js
window.GEWhatsApp = {
  initWhatsApp,
  openWhatsAppSend,
  openWhatsAppConfig,
  renderWhatsAppLog,
  sendWhatsAppMessage,
};
