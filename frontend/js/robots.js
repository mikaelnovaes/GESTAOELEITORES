/**
 * frontend/js/robots.js v3.0
 * Robôs de Aniversário e Reativação — configuração persistida no backend
 */

'use strict';

const BDAY_LAST_RUN_KEY  = 'gestao_bday_last_run_v1';
const BDAY_LOG_KEY       = 'gestao_bday_log_v1';
const REACT_LAST_RUN_KEY = 'gestao_react_last_run_v1';
const REACT_LOG_KEY      = 'gestao_react_log_v1';

/* ============================================================
   CONFIG (vinda da API)
   ============================================================ */
const BDayConfig = {
  _cache: null,
  async load(force = false) {
    if (!force && this._cache) return this._cache;
    try {
      this._cache = await window.API.get('/robots/birthday/config');
    } catch (e) {
      console.warn('[bday] load:', e.message);
      this._cache = { enabled: false, mode: 'template', send_time: '09:00' };
    }
    return this._cache;
  },
  async save(cfg) {
    await window.API.put('/robots/birthday/config', cfg);
    this._cache = cfg;
  }
};

const ReactivationConfig = {
  _cache: null,
  async load(force = false) {
    if (!force && this._cache) return this._cache;
    try {
      this._cache = await window.API.get('/robots/reactivation/config');
    } catch (e) {
      console.warn('[react] load:', e.message);
      this._cache = { enabled: false, mode: 'template', period_value: 30, period_unit: 'dias', freq_unit: 'semanal', freq_hour: '09:00' };
    }
    return this._cache;
  },
  async save(cfg) {
    await window.API.put('/robots/reactivation/config', cfg);
    this._cache = cfg;
  }
};

/* ============================================================
   LOGS (locais, informativos)
   ============================================================ */
const BDayLog = {
  load()    { try { return JSON.parse(localStorage.getItem(BDAY_LOG_KEY)) || []; } catch { return []; } },
  save(d)   { localStorage.setItem(BDAY_LOG_KEY, JSON.stringify(d)); },
  all()     { return this.load(); },
  add(entry) {
    const data = this.load();
    entry.id = Date.now() + Math.floor(Math.random() * 10000);
    entry.data_envio = new Date().toISOString();
    data.unshift(entry);
    if (data.length > 500) data.length = 500;
    this.save(data);
    return entry;
  },
  alreadySent(eleitorId, dateKey) {
    return this.load().some(l => Number(l.eleitor_id) === Number(eleitorId) && l.data_aniversario === dateKey && l.status === 'sent');
  }
};

const ReactivationLog = {
  load()     { try { return JSON.parse(localStorage.getItem(REACT_LOG_KEY)) || []; } catch { return []; } },
  save(d)    { localStorage.setItem(REACT_LOG_KEY, JSON.stringify(d)); },
  all()      { return this.load(); },
  add(entry) {
    const data = this.load();
    entry.id = Date.now() + Math.floor(Math.random() * 10000);
    entry.data_envio = new Date().toISOString();
    data.unshift(entry);
    if (data.length > 500) data.length = 500;
    this.save(data);
    return entry;
  }
};

function todayKey() { return new Date().toISOString().substring(0, 10); }

/* ============================================================
   ROBÔ ANIVERSÁRIO
   ============================================================ */
async function getAniversariantesHoje() {
  try {
    return await window.API.get('/robots/birthday/today');
  } catch {
    // Fallback: usa cache local
    const today = new Date();
    const mm = today.getMonth() + 1, dd = today.getDate();
    return window.Eleitores.all().filter(e => {
      if (!e.data_nascimento) return false;
      const [, m, d] = String(e.data_nascimento).substring(0,10).split('-').map(Number);
      return m === mm && d === dd;
    });
  }
}

async function robotCheck(force = false) {
  const cfg = await BDayConfig.load(true);
  if (!force && !cfg.enabled) return;

  // FORÇA sincronização antes (ponto 7 — "eleitor não encontrado")
  if (window.syncFromAPI) await window.syncFromAPI();

  const today      = todayKey();
  const aniv       = (await getAniversariantesHoje()).filter(e => e.telefone);
  const pendentes  = aniv.filter(e => !BDayLog.alreadySent(e.id, today));

  if (!pendentes.length) {
    localStorage.setItem(BDAY_LAST_RUN_KEY, today);
    if (force) window.showToast?.('Todos os aniversariantes de hoje já foram processados.', 'success');
    return;
  }

  for (const e of pendentes) {
    try {
      let payload, mode;
      if (cfg.mode === 'text') {
        mode = 'text';
        payload = { message: cfg.text_message || 'Feliz aniversário, {{primeiro_nome}}!' };
      } else {
        mode = 'template';
        payload = {
          templateName: cfg.template_name,
          language:     cfg.template_lang || 'pt_BR',
          variables:    (cfg.template_vars || '').split('\n').filter(l => l.trim()),
        };
      }
      const result = await window.GEWhatsApp.sendWhatsAppMessage(e, mode, payload);
      BDayLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone,
                    data_aniversario: today, status: 'sent', message_id: result.messageId });
    } catch (err) {
      BDayLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone,
                    data_aniversario: today, status: 'failed', mensagem_erro: err.message });
    }
    await new Promise(r => setTimeout(r, 400));
  }

  localStorage.setItem(BDAY_LAST_RUN_KEY, today);
  if (typeof renderBirthdayToday === 'function') renderBirthdayToday();
  window.showToast?.(`🎂 Robô Aniversário: ${pendentes.length} processado(s).`, 'success');
}

function checkAndRunBirthday() {
  BDayConfig.load().then(cfg => {
    if (!cfg.enabled) return;
    const now = new Date();
    const [hh, mm] = (cfg.send_time || '09:00').split(':').map(Number);
    const passou = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
    const lastRun = localStorage.getItem(BDAY_LAST_RUN_KEY);
    if (passou && lastRun !== todayKey()) robotCheck(false);
  });
}

function startBirthdayWatcher() {
  // Aguarda 15s para garantir que syncFromAPI já rodou e o cache está populado
  setTimeout(checkAndRunBirthday, 15000);
  setInterval(checkAndRunBirthday, 5 * 60 * 1000);
}

/* ============================================================
   UI ROBÔ ANIVERSÁRIO
   ============================================================ */
async function openBirthday() {
  const container = document.getElementById('birthday-content');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);padding:1rem;">Carregando configuração...</p>';

  const [cfg, aniversariantes] = await Promise.all([
    BDayConfig.load(true),
    getAniversariantesHoje(),
  ]);

  container.innerHTML = renderBirthdayUI(cfg, aniversariantes);
  bindBirthdayEvents();
}

function renderBirthdayUI(cfg, aniversariantes) {
  const today = todayKey();
  return `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;padding:1rem 1.2rem;background:var(--cream);border:1px solid var(--line);border-radius:4px;">
      <div style="flex:1;">
        <div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.3rem;">Status do Robô</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span id="bday-dot" style="width:10px;height:10px;border-radius:50%;background:${cfg.enabled ? 'var(--success)' : 'var(--line)'};"></span>
          <strong id="bday-state-text">${cfg.enabled ? 'Ativo' : 'Desligado'}</strong>
        </div>
      </div>
      <label class="toggle-switch" style="display:inline-block;">
        <input type="checkbox" id="bday-toggle" ${cfg.enabled ? 'checked' : ''}>
        <span style="display:inline-block;width:48px;height:26px;background:${cfg.enabled?'var(--success)':'var(--line)'};border-radius:13px;cursor:pointer;position:relative;">
          <span style="position:absolute;top:3px;left:${cfg.enabled?'25px':'3px'};width:20px;height:20px;background:white;border-radius:50%;transition:left 0.2s;"></span>
        </span>
      </label>
    </div>

    <h3 style="margin-bottom:0.8rem;">⚙️ Configuração</h3>
    <form id="bday-config-form" style="display:grid;gap:1rem;margin-bottom:2rem;">
      <div class="field">
        <label>Modo de envio</label>
        <select id="bday-mode">
          <option value="template" ${cfg.mode==='template'?'selected':''}>Template (Meta aprovado)</option>
          <option value="text"     ${cfg.mode==='text'?'selected':''}>Texto livre</option>
        </select>
      </div>

      <div id="bday-template-fields" style="display:${cfg.mode==='template'?'grid':'none'};gap:1rem;">
        <div class="field">
          <label>Nome do template</label>
          <input type="text" id="bday-tpl-name" value="${escapeHtml(cfg.template_name||'')}" placeholder="ex: feliz_aniversario">
        </div>
        <div class="field">
          <label>Idioma</label>
          <input type="text" id="bday-tpl-lang" value="${escapeHtml(cfg.template_lang||'pt_BR')}">
        </div>
        <div class="field">
          <label>Variáveis (uma por linha) — ex.: {{primeiro_nome}}</label>
          <textarea id="bday-tpl-vars" rows="3">${escapeHtml(cfg.template_vars||'')}</textarea>
        </div>
      </div>

      <div id="bday-text-fields" style="display:${cfg.mode==='text'?'block':'none'};">
        <div class="field">
          <label>Mensagem (pode usar {{primeiro_nome}}, {{nome}}, {{bairro}}, {{cidade}})</label>
          <textarea id="bday-text-msg" rows="5">${escapeHtml(cfg.text_message||'')}</textarea>
        </div>
      </div>

      <div class="field" style="max-width:200px;">
        <label>Horário de envio</label>
        <input type="time" id="bday-send-time" value="${escapeHtml(cfg.send_time||'09:00')}">
      </div>

      <div style="display:flex;gap:0.6rem;justify-content:flex-end;">
        <button type="submit" class="btn btn-primary">Salvar Configuração</button>
      </div>
    </form>

    <h3 style="margin-bottom:0.8rem;">🎂 Aniversariantes de hoje</h3>
    <div id="birthday-today-container">${renderAnivList(aniversariantes, today)}</div>

    <div style="margin-top:1.5rem;display:flex;gap:0.6rem;justify-content:flex-end;">
      <button class="btn btn-secondary" id="btn-birthday-check">Verificar Agora</button>
    </div>
  `;
}

function renderAnivList(aniv, today) {
  if (!aniv.length) return '<div style="color:var(--muted);font-size:0.88rem;padding:0.5rem 0;">Nenhum aniversariante hoje.</div>';
  return `<table><thead><tr><th>Nome</th><th>Telefone</th><th>Cidade</th><th>Status</th></tr></thead><tbody>
    ${aniv.map(e => `<tr>
      <td><strong>${escapeHtml(e.nome)}</strong></td>
      <td>${escapeHtml(e.telefone || '—')}</td>
      <td>${escapeHtml(e.cidade || '—')}</td>
      <td>${BDayLog.alreadySent(e.id, today) ? '<span class="badge badge-success">✓ Enviado</span>' : (e.telefone ? '<span class="badge badge-warn">Pendente</span>' : '<span class="badge">Sem tel.</span>')}</td>
    </tr>`).join('')}
  </tbody></table>`;
}

function bindBirthdayEvents() {
  // Toggle mode
  document.getElementById('bday-mode')?.addEventListener('change', (e) => {
    const isTpl = e.target.value === 'template';
    document.getElementById('bday-template-fields').style.display = isTpl ? 'grid' : 'none';
    document.getElementById('bday-text-fields').style.display     = isTpl ? 'none' : 'block';
  });

  // Toggle on/off
  document.getElementById('bday-toggle')?.addEventListener('change', async (ev) => {
    const cfg = await BDayConfig.load();
    cfg.enabled = ev.target.checked;
    try {
      await BDayConfig.save(cfg);
      window.showToast?.(cfg.enabled ? 'Robô ativado!' : 'Robô desligado.', 'success');
      openBirthday();
    } catch (e) {
      window.showToast?.('Erro ao salvar.', 'error');
    }
  });

  // Salvar config
  document.getElementById('bday-config-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cfg = {
      enabled:       document.getElementById('bday-toggle')?.checked || false,
      mode:          document.getElementById('bday-mode').value,
      template_name: document.getElementById('bday-tpl-name')?.value.trim() || null,
      template_lang: document.getElementById('bday-tpl-lang')?.value.trim() || 'pt_BR',
      template_vars: document.getElementById('bday-tpl-vars')?.value || null,
      text_message:  document.getElementById('bday-text-msg')?.value || null,
      send_time:     document.getElementById('bday-send-time').value || '09:00',
    };
    try {
      await BDayConfig.save(cfg);
      window.showToast?.('Configuração salva!', 'success');
    } catch (e) {
      window.showToast?.(e.message || 'Erro ao salvar.', 'error');
    }
  });

  // Verificar agora
  document.getElementById('btn-birthday-check')?.addEventListener('click', () => robotCheck(true));
}

function renderBirthdayToday() {
  // chamado por robotCheck após envios
  if (document.getElementById('view-birthday')?.classList.contains('active')) openBirthday();
}

/* ============================================================
   ROBÔ REATIVAÇÃO
   ============================================================ */
function getInactiveEleitores(periodValue, periodUnit) {
  const days = periodUnit === 'meses' ? periodValue * 30 : periodValue;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const log = window.WALog.all();
  const recentIds = new Set(log.filter(l => new Date(l.data_envio).getTime() >= cutoff && l.status === 'sent').map(l => Number(l.eleitor_id)));
  return window.Eleitores.all()
    .filter(e => e.telefone && !recentIds.has(Number(e.id)));
}

async function reactivationRun(force = false) {
  const cfg = await ReactivationConfig.load(true);
  if (!force && !cfg.enabled) return;

  if (window.syncFromAPI) await window.syncFromAPI();

  const inativos = getInactiveEleitores(cfg.period_value || 30, cfg.period_unit || 'dias');
  if (!inativos.length) {
    if (force) window.showToast?.('Nenhum eleitor inativo no período configurado.', 'success');
    localStorage.setItem(REACT_LAST_RUN_KEY, new Date().toISOString());
    return;
  }

  const batch = inativos.slice(0, 50);
  for (const e of batch) {
    try {
      let payload, mode;
      if (cfg.mode === 'text') {
        mode = 'text';
        payload = { message: cfg.text_message || 'Olá {{primeiro_nome}}, sentimos sua falta!' };
      } else {
        mode = 'template';
        payload = {
          templateName: cfg.template_name,
          language:     cfg.template_lang || 'pt_BR',
          variables:    (cfg.template_vars || '').split('\n').filter(l => l.trim()),
        };
      }
      const r = await window.GEWhatsApp.sendWhatsAppMessage(e, mode, payload);
      ReactivationLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, status: 'sent', message_id: r.messageId });
    } catch (err) {
      ReactivationLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, status: 'failed', mensagem_erro: err.message });
    }
    await new Promise(r => setTimeout(r, 400));
  }

  localStorage.setItem(REACT_LAST_RUN_KEY, new Date().toISOString());
  window.showToast?.(`🔄 Robô Reativação: ${batch.length} processado(s).`, 'success');
}

function checkAndRunReactivation() {
  ReactivationConfig.load().then(cfg => {
    if (!cfg.enabled) return;
    const lastRunISO = localStorage.getItem(REACT_LAST_RUN_KEY);
    const lastRun    = lastRunISO ? new Date(lastRunISO) : null;
    const now        = new Date();
    let minMs;
    if (cfg.freq_unit === 'diario')      minMs = 24 * 60 * 60 * 1000;
    else if (cfg.freq_unit === 'mensal') minMs = 30 * 24 * 60 * 60 * 1000;
    else                                 minMs = 7 * 24 * 60 * 60 * 1000;
    if (lastRun && (now - lastRun) < minMs) return;
    const [hh, mm] = (cfg.freq_hour || '09:00').split(':').map(Number);
    const passou = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
    if (passou) reactivationRun(false);
  });
}

function startReactivationWatcher() {
  setTimeout(checkAndRunReactivation, 15000);
  setInterval(checkAndRunReactivation, 5 * 60 * 1000);
}

/* ============================================================
   UI ROBÔ REATIVAÇÃO
   ============================================================ */
async function openReactivation() {
  const container = document.getElementById('reactivation-content');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--muted);padding:1rem;">Carregando configuração...</p>';

  const cfg = await ReactivationConfig.load(true);
  const inativos = getInactiveEleitores(cfg.period_value || 30, cfg.period_unit || 'dias');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1.5rem;padding:1rem 1.2rem;background:var(--cream);border:1px solid var(--line);border-radius:4px;">
      <div style="flex:1;">
        <div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.3rem;">Status do Robô</div>
        <div style="display:flex;align-items:center;gap:0.5rem;">
          <span style="width:10px;height:10px;border-radius:50%;background:${cfg.enabled ? 'var(--success)' : 'var(--line)'};"></span>
          <strong>${cfg.enabled ? 'Ativo' : 'Desligado'}</strong>
        </div>
        <div style="font-size:0.82rem;color:var(--muted);margin-top:0.3rem;">
          ${inativos.length} eleitor(es) inativo(s) no período configurado.
        </div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="react-toggle" ${cfg.enabled ? 'checked' : ''}>
        <span style="display:inline-block;width:48px;height:26px;background:${cfg.enabled?'var(--success)':'var(--line)'};border-radius:13px;cursor:pointer;position:relative;">
          <span style="position:absolute;top:3px;left:${cfg.enabled?'25px':'3px'};width:20px;height:20px;background:white;border-radius:50%;transition:left 0.2s;"></span>
        </span>
      </label>
    </div>

    <h3 style="margin-bottom:0.8rem;">⚙️ Configuração</h3>
    <form id="react-config-form" style="display:grid;gap:1rem;margin-bottom:2rem;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div class="field">
          <label>Considerar inativo após</label>
          <input type="number" id="react-period-value" min="1" max="365" value="${cfg.period_value||30}">
        </div>
        <div class="field">
          <label>Unidade</label>
          <select id="react-period-unit">
            <option value="dias" ${cfg.period_unit==='dias'?'selected':''}>Dias</option>
            <option value="meses" ${cfg.period_unit==='meses'?'selected':''}>Meses</option>
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div class="field">
          <label>Frequência</label>
          <select id="react-freq-unit">
            <option value="diario"  ${cfg.freq_unit==='diario'?'selected':''}>Diária</option>
            <option value="semanal" ${cfg.freq_unit==='semanal'?'selected':''}>Semanal</option>
            <option value="mensal"  ${cfg.freq_unit==='mensal'?'selected':''}>Mensal</option>
          </select>
        </div>
        <div class="field">
          <label>Horário</label>
          <input type="time" id="react-freq-hour" value="${cfg.freq_hour||'09:00'}">
        </div>
      </div>

      <div class="field">
        <label>Modo</label>
        <select id="react-mode">
          <option value="template" ${cfg.mode==='template'?'selected':''}>Template</option>
          <option value="text"     ${cfg.mode==='text'?'selected':''}>Texto livre</option>
        </select>
      </div>

      <div id="react-template-fields" style="display:${cfg.mode==='template'?'grid':'none'};gap:1rem;">
        <div class="field"><label>Nome do template</label>
          <input type="text" id="react-tpl-name" value="${escapeHtml(cfg.template_name||'')}"></div>
        <div class="field"><label>Idioma</label>
          <input type="text" id="react-tpl-lang" value="${escapeHtml(cfg.template_lang||'pt_BR')}"></div>
        <div class="field"><label>Variáveis (uma por linha)</label>
          <textarea id="react-tpl-vars" rows="3">${escapeHtml(cfg.template_vars||'')}</textarea></div>
      </div>

      <div id="react-text-fields" style="display:${cfg.mode==='text'?'block':'none'};">
        <div class="field"><label>Mensagem</label>
          <textarea id="react-text-msg" rows="5">${escapeHtml(cfg.text_message||'')}</textarea></div>
      </div>

      <div style="display:flex;gap:0.6rem;justify-content:flex-end;">
        <button type="submit" class="btn btn-primary">Salvar Configuração</button>
      </div>
    </form>

    <div style="display:flex;gap:0.6rem;justify-content:flex-end;">
      <button class="btn btn-secondary" id="btn-react-check">Verificar e Enviar Agora</button>
    </div>
  `;

  document.getElementById('react-mode')?.addEventListener('change', (e) => {
    const isTpl = e.target.value === 'template';
    document.getElementById('react-template-fields').style.display = isTpl ? 'grid' : 'none';
    document.getElementById('react-text-fields').style.display     = isTpl ? 'none' : 'block';
  });

  document.getElementById('react-toggle')?.addEventListener('change', async (ev) => {
    const c = await ReactivationConfig.load();
    c.enabled = ev.target.checked;
    try {
      await ReactivationConfig.save(c);
      window.showToast?.(c.enabled ? 'Robô ativado!' : 'Robô desligado.', 'success');
      openReactivation();
    } catch (e) {
      window.showToast?.('Erro ao salvar.', 'error');
    }
  });

  document.getElementById('react-config-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const c = {
      enabled:       document.getElementById('react-toggle')?.checked || false,
      mode:          document.getElementById('react-mode').value,
      period_value:  parseInt(document.getElementById('react-period-value').value) || 30,
      period_unit:   document.getElementById('react-period-unit').value,
      freq_unit:     document.getElementById('react-freq-unit').value,
      freq_hour:     document.getElementById('react-freq-hour').value || '09:00',
      template_name: document.getElementById('react-tpl-name')?.value.trim() || null,
      template_lang: document.getElementById('react-tpl-lang')?.value.trim() || 'pt_BR',
      template_vars: document.getElementById('react-tpl-vars')?.value || null,
      text_message:  document.getElementById('react-text-msg')?.value || null,
    };
    try {
      await ReactivationConfig.save(c);
      window.showToast?.('Configuração salva!', 'success');
    } catch (e) {
      window.showToast?.(e.message || 'Erro ao salvar.', 'error');
    }
  });

  document.getElementById('btn-react-check')?.addEventListener('click', () => reactivationRun(true));
}

/* ============================================================
   CENTRAL DE ROBÔS
   ============================================================ */
async function openRobots() {
  const grid = document.getElementById('robots-grid');
  if (!grid) return;
  const [bday, react] = await Promise.all([BDayConfig.load(true), ReactivationConfig.load(true)]);

  const robots = [
    { id: 'birthday', title: 'Aniversários', view: 'birthday', icon: '🎂',
      description: 'Envia mensagens de feliz aniversário automaticamente no dia certo.',
      active: bday.enabled, count: BDayLog.all().filter(l => l.status === 'sent').length },
    { id: 'reactivation', title: 'Reativação de Contatos', view: 'reactivation', icon: '🔄',
      description: 'Identifica eleitores sem contato há muito tempo e retoma o relacionamento.',
      active: react.enabled, count: ReactivationLog.all().filter(l => l.status === 'sent').length },
  ];

  grid.innerHTML = robots.map(r => `
    <div class="robot-card ${r.active ? 'active' : ''}" data-view="${r.view}" style="border:1px solid var(--line);border-radius:4px;padding:1.4rem;background:var(--paper);cursor:pointer;">
      <div style="font-size:2rem;">${r.icon}</div>
      <div style="font-family:'Fraunces',serif;font-size:1.05rem;color:var(--navy);font-weight:600;">${escapeHtml(r.title)}</div>
      <div style="font-size:0.84rem;color:var(--muted);line-height:1.5;margin:0.5rem 0;">${escapeHtml(r.description)}</div>
      <div style="display:flex;align-items:center;gap:0.5rem;font-size:0.82rem;">
        <span style="width:8px;height:8px;border-radius:50%;background:${r.active ? 'var(--success)' : 'var(--line)'};"></span>
        <span style="color:${r.active ? 'var(--success)' : 'var(--muted)'};font-weight:600;">${r.active ? 'Ativo' : 'Inativo'}</span>
        ${r.count ? `<span style="color:var(--muted);margin-left:auto;">${r.count} envios</span>` : ''}
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-view]').forEach(card => {
    card.addEventListener('click', () => window.switchView(card.dataset.view));
  });
}

/* ============================================================
   EXPORTAÇÃO
   ============================================================ */
window.GERobots = {
  BDayConfig, ReactivationConfig, BDayLog, ReactivationLog,
  robotCheck, reactivationRun,
  startBirthdayWatcher, startReactivationWatcher,
  openRobots, openBirthday, openReactivation,
};
