/**
 * frontend/js/robots.js
 * Robôs de IA — Aniversários e Reativação de Contatos
 */

'use strict';

/* Referências aos módulos globais */
const escapeHtml    = (s) => window.escapeHtml(s);
const showToast     = (m, t) => window.showToast(m, t);
const formatDate    = (d) => window.formatDate?.(d) ?? d;
const formatDateTime= (d) => window.formatDateTime?.(d) ?? d;
const Eleitores = window.Eleitores;
const WALog     = window.WALog;


/* ============================================================
   ROBÔ DE ANIVERSÁRIOS
   ============================================================ */
const BDAY_CONFIG_KEY   = 'gestao_bday_config_v1';
const BDAY_LOG_KEY      = 'gestao_bday_log_v1';
const BDAY_LAST_RUN_KEY = 'gestao_bday_last_run_v1';

const BDayConfig = {
  load()     { try { return JSON.parse(localStorage.getItem(BDAY_CONFIG_KEY)) || {}; } catch { return {}; } },
  save(cfg)  { localStorage.setItem(BDAY_CONFIG_KEY, JSON.stringify(cfg)); },
  getDefault() {
    return {
      enabled: false, mode: 'template',
      text_message: 'Olá {{primeiro_nome}}! 🎉\n\nHoje é o seu dia! Desejamos um feliz aniversário cheio de saúde e realizações!\n\nUm grande abraço!',
      template_name: '', template_lang: 'pt_BR', template_vars: '', send_hour: '09:00'
    };
  }
};

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
    return this.load().some(l => l.eleitor_id === eleitorId && l.data_aniversario === dateKey && l.status === 'sent');
  }
};

function todayKey() {
  return new Date().toISOString().substring(0, 10);
}

function getAniversariantesHoje() {
  const today = new Date();
  const mm = today.getMonth() + 1;
  const dd = today.getDate();
  return Eleitores.all().filter(e => {
    if (!e.data_nascimento) return false;
    try {
      const [, m, d] = e.data_nascimento.split('-').map(Number);
      return m === mm && d === dd;
    } catch { return false; }
  });
}

/* ── Núcleo do robô de aniversários ── */
async function robotCheck(force = false) {
  const cfg = BDayConfig.load();
  if (!force && !cfg.enabled) return;

  const today    = todayKey();
  const aniv     = getAniversariantesHoje().filter(e => e.telefone);
  const pendentes = aniv.filter(e => !BDayLog.alreadySent(e.id, today));

  if (!pendentes.length) {
    localStorage.setItem(BDAY_LAST_RUN_KEY, today);
    if (force) showToast('Todos os aniversariantes de hoje já foram processados.', 'success');
    return;
  }

  console.log(`[Robô Aniversário] Processando ${pendentes.length} aniversariante(s)...`);

  for (const e of pendentes) {
    try {
      let payload, mode;
      if (cfg.mode === 'text') {
        mode = 'text'; payload = { text: cfg.text_message };
      } else {
        mode = 'template';
        payload = {
          templateName: cfg.template_name,
          language:     cfg.template_lang || 'pt_BR',
          variables:    (cfg.template_vars || '').split('\n').filter(l => l.trim()),
        };
      }

      const result = await window.GEWhatsApp.sendWhatsAppMessage(e, mode, payload);
      const conteudo = mode === 'text'
        ? cfg.text_message.replace(/\{\{primeiro_nome\}\}/gi, e.nome.split(' ')[0])
        : `Template: ${cfg.template_name}`;

      BDayLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, data_aniversario: today, status: 'sent', conteudo, message_id: result.messageId });
      WALog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, tipo: mode, conteudo: '🎂 [Robô Aniversário] ' + conteudo, status: 'sent', message_id: result.messageId, lote_id: 'bday_' + today });

    } catch (err) {
      BDayLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, data_aniversario: today, status: 'failed', mensagem_erro: err.message });
      WALog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, tipo: cfg.mode, conteudo: '🎂 [Robô Aniversário] (falhou)', status: 'failed', mensagem_erro: err.message, lote_id: 'bday_' + today });
    }

    await new Promise(r => setTimeout(r, 400));
  }

  localStorage.setItem(BDAY_LAST_RUN_KEY, today);
  if (typeof renderBirthdayToday === 'function') renderBirthdayToday();
  showToast(`🎂 Robô Aniversário: ${pendentes.length} mensagem(s) processada(s).`, 'success');
}

function checkAndRunBirthday() {
  const cfg = BDayConfig.load();
  if (!cfg.enabled) return;

  const today  = todayKey();
  const lastRun = localStorage.getItem(BDAY_LAST_RUN_KEY);
  const aniv   = getAniversariantesHoje().filter(e => e.telefone);
  const pendentes = aniv.filter(e => !BDayLog.alreadySent(e.id, today));
  if (!pendentes.length) { if (lastRun !== today) localStorage.setItem(BDAY_LAST_RUN_KEY, today); return; }

  const now = new Date();
  const [hh, mm] = (cfg.send_hour || '09:00').split(':').map(Number);
  const passou = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
  if (lastRun !== today && passou) robotCheck(false);
}

function startBirthdayWatcher() {
  setTimeout(() => { const cfg = BDayConfig.load(); if (cfg.enabled) checkAndRunBirthday(); }, 3000);
  setInterval(() => { const cfg = BDayConfig.load(); if (cfg.enabled) checkAndRunBirthday(); }, 60 * 1000);
}

/* ── UI do robô de aniversários ── */
function updateBirthdayStatus() {
  const cfg     = BDayConfig.load();
  const enabled = !!cfg.enabled;
  const toggle  = document.getElementById('robot-toggle');
  const dot     = document.getElementById('robot-dot');
  const text    = document.getElementById('robot-state-text');
  const meta    = document.getElementById('robot-meta');

  if (toggle) toggle.classList.toggle('on', enabled);
  if (dot)    dot.classList.toggle('active', enabled);
  if (text)   text.textContent = enabled ? 'Ativo' : 'Desligado';

  if (meta) {
    if (enabled) {
      const lastRun  = localStorage.getItem(BDAY_LAST_RUN_KEY) || '—';
      const pendentes = getAniversariantesHoje().filter(e => e.telefone && !BDayLog.alreadySent(e.id, todayKey())).length;
      meta.innerHTML = `Verificando às <strong>${cfg.send_hour || '09:00'}</strong>. ${pendentes > 0 ? `<strong>${pendentes}</strong> aniversariante(s) pendente(s) hoje.` : 'Todos processados hoje.'}`;
    } else {
      meta.textContent = 'Configure e ative o robô para envios automáticos.';
    }
  }
}

function renderBirthdayToday() {
  const container = document.getElementById('birthday-today-container');
  if (!container) return;
  const aniv = getAniversariantesHoje();
  const today = todayKey();

  if (!aniv.length) {
    container.innerHTML = '<div style="color:var(--muted); font-size:0.88rem; padding:0.5rem 0;">Nenhum aniversariante hoje.</div>';
    return;
  }

  container.innerHTML = `
    <table><thead><tr><th>Nome</th><th>Telefone</th><th>Cidade</th><th>Status</th></tr></thead>
    <tbody>
      ${aniv.map(e => `
        <tr>
          <td><strong>${escapeHtml(e.nome)}</strong></td>
          <td>${escapeHtml(e.telefone || '—')}</td>
          <td>${escapeHtml(e.cidade || '—')}</td>
          <td>${BDayLog.alreadySent(e.id, today)
            ? '<span class="badge badge-success">✓ Enviado</span>'
            : (e.telefone ? '<span class="badge badge-warn">Pendente</span>' : '<span class="badge">Sem tel.</span>')
          }</td>
        </tr>
      `).join('')}
    </tbody></table>
  `;
}

function renderBirthdayLog() {
  const container = document.getElementById('birthday-log-container');
  if (!container) return;
  const log = BDayLog.all().slice(0, 50);

  if (!log.length) {
    container.innerHTML = '<div style="color:var(--muted); font-size:0.88rem; padding:0.5rem 0;">Nenhum envio registrado.</div>';
    return;
  }

  container.innerHTML = `
    <table><thead><tr><th>Data</th><th>Eleitor</th><th>Status</th><th>Erro</th></tr></thead>
    <tbody>
      ${log.map(l => `
        <tr>
          <td style="font-size:0.8rem; white-space:nowrap;">${formatDateTime(l.data_envio)}</td>
          <td>${escapeHtml(l.eleitor_nome)}</td>
          <td>${l.status === 'sent' ? '<span class="badge badge-success">✓</span>' : '<span class="badge" style="background:var(--danger-soft);color:var(--danger);">✗</span>'}</td>
          <td style="font-size:0.78rem; color:var(--danger);">${escapeHtml(l.mensagem_erro || '—')}</td>
        </tr>
      `).join('')}
    </tbody></table>
  `;
}

/* ============================================================
   ROBÔ DE REATIVAÇÃO
   ============================================================ */
const REACT_CONFIG_KEY    = 'gestao_react_config_v1';
const REACT_LOG_KEY       = 'gestao_react_log_v1';
const REACT_LAST_RUN_KEY  = 'gestao_react_last_run_v1';
const REACT_BATCH_LIMIT   = 50;

const ReactivationConfig = {
  load()    { try { return JSON.parse(localStorage.getItem(REACT_CONFIG_KEY)) || {}; } catch { return {}; } },
  save(cfg) { localStorage.setItem(REACT_CONFIG_KEY, JSON.stringify(cfg)); },
  getDefault() {
    return {
      enabled: false, mode: 'template',
      text_message: 'Olá {{primeiro_nome}}! 👋\n\nFaz um tempo que não conversamos. Como você está? Queremos manter contato com você.\n\nUm grande abraço!',
      template_name: '', template_lang: 'pt_BR', template_vars: '',
      period_value: 30, period_unit: 'dias',
      freq_unit: 'semanal', freq_hour: '09:00'
    };
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

function getInactiveEleitores(periodValue, periodUnit) {
  const log  = WALog.all();
  const days = periodUnit === 'meses' ? periodValue * 30 : periodValue;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const recentIds = new Set(
    log.filter(l => new Date(l.data_envio).getTime() >= cutoff && l.status === 'sent').map(l => l.eleitor_id)
  );

  return Eleitores.all()
    .filter(e => e.telefone && !recentIds.has(e.id))
    .map(e => {
      const lastEntry = log.filter(l => l.eleitor_id === e.id && l.status === 'sent').sort((a, b) => new Date(b.data_envio) - new Date(a.data_envio))[0];
      const diasInativo = lastEntry
        ? Math.floor((Date.now() - new Date(lastEntry.data_envio).getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return { ...e, diasInativo };
    });
}

async function reactivationRun(force = false) {
  const cfg = ReactivationConfig.load();
  if (!force && !cfg.enabled) return;

  const inativos = getInactiveEleitores(cfg.period_value || 30, cfg.period_unit || 'dias');
  if (!inativos.length) {
    if (force) showToast('Nenhum eleitor inativo no período configurado.', '');
    return;
  }

  const sorted = [...inativos].sort((a, b) => (b.diasInativo || 9999) - (a.diasInativo || 9999));
  const lote   = sorted.slice(0, REACT_BATCH_LIMIT);
  const loteId = 'react_' + Date.now();
  let success  = 0, failed = 0;
  const mode   = cfg.mode || 'template';

  console.log(`[Robô Reativação] Processando ${lote.length} eleitor(es)...`);

  for (let i = 0; i < lote.length; i++) {
    const item = lote[i];
    const e    = item;

    try {
      let payload;
      if (mode === 'text') {
        payload = { text: cfg.text_message };
      } else {
        payload = {
          templateName: cfg.template_name,
          language:     cfg.template_lang || 'pt_BR',
          variables:    (cfg.template_vars || '').split('\n').filter(l => l.trim()),
        };
      }

      const result = await window.GEWhatsApp.sendWhatsAppMessage(e, mode, payload);
      success++;
      const conteudo = mode === 'text' ? cfg.text_message : `Template: ${cfg.template_name}`;
      ReactivationLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, dias_inativo: item.diasInativo, status: 'sent', conteudo });
      WALog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, tipo: mode, conteudo: '🔄 [Reativação] ' + conteudo, status: 'sent', message_id: result.messageId, lote_id: loteId });

    } catch (err) {
      failed++;
      const conteudo = mode === 'text' ? cfg.text_message : `Template: ${cfg.template_name}`;
      ReactivationLog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, dias_inativo: item.diasInativo, status: 'failed', conteudo, mensagem_erro: err.message });
      WALog.add({ eleitor_id: e.id, eleitor_nome: e.nome, telefone: e.telefone, tipo: mode, conteudo: '🔄 [Reativação] (falhou)', status: 'failed', mensagem_erro: err.message, lote_id: loteId });
    }

    await new Promise(r => setTimeout(r, 400));
  }

  localStorage.setItem(REACT_LAST_RUN_KEY, new Date().toISOString());
  showToast(`🔄 Reativação: ${success} enviados, ${failed} falhas.`, success > 0 ? 'success' : 'error');
}

function checkAndRunReactivation() {
  const cfg = ReactivationConfig.load();
  if (!cfg.enabled) return;

  const lastRunISO = localStorage.getItem(REACT_LAST_RUN_KEY);
  const lastRun    = lastRunISO ? new Date(lastRunISO) : null;
  const now        = new Date();

  let minIntervalMs;
  if (cfg.freq_unit === 'diario')  minIntervalMs = 24 * 60 * 60 * 1000;
  else if (cfg.freq_unit === 'mensal') minIntervalMs = 30 * 24 * 60 * 60 * 1000;
  else                             minIntervalMs = 7 * 24 * 60 * 60 * 1000;

  if (lastRun && (now - lastRun) < minIntervalMs) return;

  const [hh, mm] = (cfg.freq_hour || '10:00').split(':').map(Number);
  const passou   = now.getHours() > hh || (now.getHours() === hh && now.getMinutes() >= mm);
  if (passou) reactivationRun(false);
}

function startReactivationWatcher() {
  setTimeout(() => { const cfg = ReactivationConfig.load(); if (cfg.enabled) checkAndRunReactivation(); }, 5000);
  setInterval(() => { const cfg = ReactivationConfig.load(); if (cfg.enabled) checkAndRunReactivation(); }, 5 * 60 * 1000);
}

/* ── Central de Robôs ── */
function openRobots() {
  const grid = document.getElementById('robots-grid');
  if (!grid) return;

  const robots = [
    {
      id: 'birthday', title: 'Aniversários', view: 'birthday',
      icon: '🎂',
      description: 'Envia mensagens de feliz aniversário automaticamente no dia certo.',
      isActive: () => !!BDayConfig.load().enabled,
      actionsCount: () => BDayLog.all().filter(l => l.status === 'sent').length,
    },
    {
      id: 'reactivation', title: 'Reativação de Contatos', view: 'reactivation',
      icon: '🔄',
      description: 'Identifica eleitores sem contato há muito tempo e retoma o relacionamento.',
      isActive: () => !!ReactivationConfig.load().enabled,
      actionsCount: () => ReactivationLog.all().filter(l => l.status === 'sent').length,
    },
  ];

  grid.innerHTML = robots.map(robot => {
    const active  = robot.isActive();
    const actions = robot.actionsCount();
    return `
      <div class="robot-card ${active ? 'active' : ''}" style="border:1px solid var(--line); border-radius:4px; padding:1.4rem; display:flex; flex-direction:column; gap:0.8rem; background:var(--paper);">
        <div style="font-size:2rem;">${robot.icon}</div>
        <div style="font-family:'Fraunces',serif; font-size:1.05rem; color:var(--navy); font-weight:600;">${escapeHtml(robot.title)}</div>
        <div style="font-size:0.84rem; color:var(--muted); line-height:1.5;">${escapeHtml(robot.description)}</div>
        <div style="display:flex; align-items:center; gap:0.5rem; font-size:0.82rem;">
          <span style="width:8px; height:8px; border-radius:50%; background:${active ? 'var(--success)' : 'var(--line)'}; display:inline-block;"></span>
          <span style="color:${active ? 'var(--success)' : 'var(--muted)'}; font-weight:600;">${active ? 'Ativo' : 'Inativo'}</span>
          ${actions > 0 ? `<span style="margin-left:auto; color:var(--muted)">${actions} envio(s)</span>` : ''}
        </div>
        <button class="btn btn-primary" data-robot-open="${robot.view}" style="margin-top:auto;">
          ${active ? 'Gerenciar' : 'Configurar'}
        </button>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('[data-robot-open]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (typeof switchView === 'function') switchView(btn.dataset.robotOpen);
    });
  });
}

// Expõe para app.js
window.GERobots = {
  startBirthdayWatcher,
  startReactivationWatcher,
  openRobots,
  updateBirthdayStatus,
  renderBirthdayToday,
  renderBirthdayLog,
  robotCheck,
  reactivationRun,
  BDayConfig,
  BDayLog,
  ReactivationConfig,
  ReactivationLog,
};
