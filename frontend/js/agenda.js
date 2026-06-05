/**
 * frontend/js/agenda.js
 * Agenda do Candidato — calendário, eventos, notificações
 * Expõe: window.GEAgenda.openAgenda()
 */

'use strict';

(function () {

  const TIPO_CONFIG = {
    evento:      { label: 'Evento',      cor: '#c9a961', icon: '🎯' },
    reuniao:     { label: 'Reunião',     cor: '#3b82f6', icon: '🤝' },
    visita:      { label: 'Visita',      cor: '#8b5cf6', icon: '🚗' },
    comicio:     { label: 'Comício',     cor: '#ef4444', icon: '📢' },
    entrevista:  { label: 'Entrevista',  cor: '#06b6d4', icon: '🎙️' },
    outro:       { label: 'Outro',       cor: '#6b7280', icon: '📌' },
  };

  let mesAtual = new Date();
  mesAtual.setDate(1);
  let eventosCache = [];

  /* ══════════════════════════════════════════════════════
     ABRIR
  ══════════════════════════════════════════════════════ */
async function openAgenda

  async function carregarEventos() {
    try {
      const inicio = new Date(mesAtual);
      inicio.setDate(1);
      const fim = new Date(mesAtual);
      fim.setMonth(fim.getMonth() + 1);
      fim.setDate(0);

      eventosCache = await window.API.get(
        `/agenda?de=${inicio.toISOString()}&ate=${fim.toISOString()}`
      );
    } catch (err) {
      window.showToast('Erro ao carregar agenda: ' + err.message, 'error');
      eventosCache = [];
    }
  }

  /* ══════════════════════════════════════════════════════
     CALENDÁRIO
  ══════════════════════════════════════════════════════ */
  function renderCalendario() {
    const container = document.getElementById('agenda-calendario');
    if (!container) return;

    const ano = mesAtual.getFullYear();
    const mes = mesAtual.getMonth();
    const nomeMes = mesAtual.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

    const primeirodia = new Date(ano, mes, 1).getDay();
    const ultimoDia   = new Date(ano, mes + 1, 0).getDate();
    const hoje = new Date();

    // Mapeia dia → eventos
    const eventosPorDia = {};
    eventosCache.forEach(ev => {
      const d = new Date(ev.data_inicio).getDate();
      if (!eventosPorDia[d]) eventosPorDia[d] = [];
      eventosPorDia[d].push(ev);
    });

    let cells = '';
    let dow = primeirodia;
    // Dias vazios no início
    for (let i = 0; i < dow; i++) {
      cells += '<div class="agenda-cell vazio"></div>';
    }
    for (let d = 1; d <= ultimoDia; d++) {
      const evs = eventosPorDia[d] || [];
      const ehHoje = hoje.getFullYear() === ano && hoje.getMonth() === mes && hoje.getDate() === d;
      const pontinhos = evs.slice(0, 3).map(ev => {
        const cfg = TIPO_CONFIG[ev.tipo] || TIPO_CONFIG.outro;
        return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${cfg.cor};margin:1px;"></span>`;
      }).join('');

      cells += `
        <div class="agenda-cell ${ehHoje ? 'hoje' : ''} ${evs.length ? 'tem-evento' : ''}"
             data-dia="${d}" style="cursor:${evs.length ? 'pointer' : 'default'}">
          <div class="agenda-dia-num">${d}</div>
          <div class="agenda-pontinhos">${pontinhos}</div>
          ${evs.length > 3 ? `<div style="font-size:0.65rem;color:var(--muted);">+${evs.length - 3}</div>` : ''}
        </div>`;
      dow = (dow + 1) % 7;
    }

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <button class="btn btn-secondary" id="btn-agenda-prev" style="padding:0.3rem 0.8rem;">‹</button>
        <div style="font-family:'Fraunces',serif;font-size:1.1rem;font-weight:600;text-transform:capitalize;color:var(--navy);">
          ${nomeMes}
        </div>
        <button class="btn btn-secondary" id="btn-agenda-next" style="padding:0.3rem 0.8rem;">›</button>
      </div>
      <div class="agenda-grid">
        <div class="agenda-dow">Dom</div><div class="agenda-dow">Seg</div>
        <div class="agenda-dow">Ter</div><div class="agenda-dow">Qua</div>
        <div class="agenda-dow">Qui</div><div class="agenda-dow">Sex</div>
        <div class="agenda-dow">Sáb</div>
        ${cells}
      </div>`;

    document.getElementById('btn-agenda-prev')?.addEventListener('click', async () => {
      mesAtual.setMonth(mesAtual.getMonth() - 1);
      await carregarEventos();
      renderCalendario();
      renderListaEventos();
    });
    document.getElementById('btn-agenda-next')?.addEventListener('click', async () => {
      mesAtual.setMonth(mesAtual.getMonth() + 1);
      await carregarEventos();
      renderCalendario();
      renderListaEventos();
    });

    // Clique no dia
    container.querySelectorAll('.agenda-cell.tem-evento').forEach(cell => {
      cell.addEventListener('click', () => {
        const dia = Number(cell.dataset.dia);
        const evs = eventosCache.filter(ev => new Date(ev.data_inicio).getDate() === dia);
        mostrarEventosDia(dia, evs);
      });
    });
  }

  function mostrarEventosDia(dia, evs) {
    const lista = document.getElementById('agenda-lista-eventos');
    if (!lista) return;
    lista.scrollIntoView({ behavior: 'smooth' });
    renderEventos(evs);
  }

  /* ══════════════════════════════════════════════════════
     LISTA DE EVENTOS
  ══════════════════════════════════════════════════════ */
  function renderListaEventos() {
    renderEventos(eventosCache);
  }

  function renderEventos(evs) {
    const container = document.getElementById('agenda-lista-eventos');
    if (!container) return;

    if (!evs.length) {
      container.innerHTML = `
        <div class="empty">
          <div style="font-size:2rem;margin-bottom:0.5rem;">📅</div>
          <h3>Nenhum evento neste mês</h3>
          <p>Clique em "+ Novo Evento" para criar.</p>
        </div>`;
      return;
    }

    const grouped = {};
    evs.forEach(ev => {
      const d = new Date(ev.data_inicio);
      const key = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(ev);
    });

    container.innerHTML = Object.entries(grouped).map(([dia, evList]) => `
      <div style="margin-bottom:1.2rem;">
        <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
                    color:var(--gold);margin-bottom:0.6rem;padding-bottom:0.3rem;
                    border-bottom:1px solid var(--line);">${dia}</div>
        ${evList.map(ev => renderEventoCard(ev)).join('')}
      </div>`
    ).join('');

    // Bind buttons
    container.querySelectorAll('[data-agenda-edit]').forEach(btn => {
      btn.addEventListener('click', () => abrirFormEvento(Number(btn.dataset.agendaEdit)));
    });
    container.querySelectorAll('[data-agenda-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Excluir este evento?')) return;
        try {
          await window.API.delete(`/agenda/${btn.dataset.agendaDelete}`);
          window.showToast('Evento excluído.', 'success');
          await carregarEventos();
          renderCalendario();
          renderListaEventos();
        } catch (err) { window.showToast(err.message, 'error'); }
      });
    });
    container.querySelectorAll('[data-agenda-notif]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Enviar WhatsApp para eleitores do bairro deste evento?')) return;
        try {
          const r = await window.API.fetch(`/agenda/${btn.dataset.agendaNotif}/notificar`, { method: 'POST' });
          window.showToast(`Disparando para ${r.total} eleitores em background.`, 'success');
        } catch (err) { window.showToast(err.message, 'error'); }
      });
    });
    container.querySelectorAll('[data-agenda-link]').forEach(btn => {
      btn.addEventListener('click', () => {
        const link = btn.dataset.agendaLink;
        navigator.clipboard?.writeText(link);
        window.showToast('Link copiado!', 'success');
      });
    });
  }

  function renderEventoCard(ev) {
    const cfg = TIPO_CONFIG[ev.tipo] || TIPO_CONFIG.outro;
    const hora = new Date(ev.data_inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
   const linkPublico = window._agendaLinkPublico
  ? `${window.location.origin}/agenda-publica.html?token=${window._agendaLinkPublico}`
  : null;

    return `
      <div style="background:var(--cream);border-radius:6px;padding:0.9rem 1rem;margin-bottom:0.5rem;
                  border-left:3px solid ${cfg.cor};display:flex;gap:0.8rem;align-items:flex-start;">
        <div style="font-size:1.4rem;flex-shrink:0;">${cfg.icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.5rem;flex-wrap:wrap;">
            <div>
              <div style="font-weight:600;color:var(--navy);">${window.escapeHtml(ev.titulo)}</div>
              <div style="font-size:0.8rem;color:var(--muted);">
                🕐 ${hora}
                ${ev.local_nome ? ` · 📍 ${window.escapeHtml(ev.local_nome)}` : ''}
                ${ev.bairro ? ` · ${window.escapeHtml(ev.bairro)}` : ''}
                ${ev.lideranca_nome ? ` · 👤 ${window.escapeHtml(ev.lideranca_nome)}` : ''}
              </div>
              ${ev.descricao ? `<div style="font-size:0.82rem;color:var(--muted);margin-top:0.3rem;">${window.escapeHtml(ev.descricao.substring(0,100))}${ev.descricao.length>100?'…':''}</div>` : ''}
            </div>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
              <button class="icon-btn" data-agenda-edit="${ev.id}" style="font-size:0.75rem;">Editar</button>
              ${ev.bairro || ev.lideranca_id ? `<button class="icon-btn" data-agenda-notif="${ev.id}" style="font-size:0.75rem;">📱 Notif.</button>` : ''}
              <button class="icon-btn" data-agenda-link="${linkPublico}" style="font-size:0.75rem;">🔗 Link</button>
              <button class="icon-btn danger" data-agenda-delete="${ev.id}" style="font-size:0.75rem;">Excluir</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /* ══════════════════════════════════════════════════════
     FORMULÁRIO
  ══════════════════════════════════════════════════════ */
  async function abrirFormEvento(id = null) {
    const modal = document.getElementById('modal-agenda-form');
    if (!modal) return;

    let ev = null;
    if (id) {
      ev = eventosCache.find(e => e.id === id);
    }

    document.getElementById('agenda-form-titulo-modal').textContent = ev ? 'Editar Evento' : 'Novo Evento';
    document.getElementById('ag-id').value = ev?.id || '';
    document.getElementById('ag-titulo').value = ev?.titulo || '';
    document.getElementById('ag-tipo').value = ev?.tipo || 'evento';
    document.getElementById('ag-data-inicio').value = ev ? new Date(ev.data_inicio).toISOString().slice(0,16) : '';
    document.getElementById('ag-data-fim').value = ev?.data_fim ? new Date(ev.data_fim).toISOString().slice(0,16) : '';
    document.getElementById('ag-descricao').value = ev?.descricao || '';
    document.getElementById('ag-local-nome').value = ev?.local_nome || '';
    document.getElementById('ag-local-endereco').value = ev?.local_endereco || '';
    document.getElementById('ag-bairro').value = ev?.bairro || '';
    document.getElementById('ag-cidade').value = ev?.cidade || '';
    document.getElementById('ag-notificar').checked = ev?.notificar_eleitores || false;

    // Preenche lideranças
    const sel = document.getElementById('ag-lideranca');
    if (sel && window.GELiderancas) {
      const lids = await window.GELiderancas.fetchAll();
      sel.innerHTML = '<option value="">— Nenhuma —</option>' +
        lids.map(l => `<option value="${l.id}" ${ev?.lideranca_id === l.id ? 'selected' : ''}>${window.escapeHtml(l.nome)}</option>`).join('');
    }

    modal.classList.add('show');
  }

  function renderBotaoLinkMes() {
  const actionsEl = document.getElementById('agenda-header-actions');
  if (!actionsEl || !window._agendaLinkPublico) return;

  const mes  = mesAtual.getMonth() + 1;
  const ano  = mesAtual.getFullYear();
  const link = `${window.location.origin}/agenda-publica.html?token=${window._agendaLinkPublico}&mes=${mes}&ano=${ano}`;
  const nomeMes = mesAtual.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });

  actionsEl.innerHTML = `
    <button class="btn btn-secondary" id="btn-novo-evento" style="font-size:0.82rem;">+ Novo Evento</button>
    <button class="btn btn-secondary" id="btn-copiar-link-mes" style="font-size:0.82rem;" data-link="${link}">
      🔗 Compartilhar ${nomeMes}
    </button>
  `;

  document.getElementById('btn-novo-evento')?.addEventListener('click', () => abrirFormEvento());
  document.getElementById('btn-copiar-link-mes')?.addEventListener('click', (e) => {
    const l = e.currentTarget.dataset.link;
    navigator.clipboard?.writeText(l).then(() => {
      window.showToast('✅ Link copiado! Envie para suas lideranças.', 'success');
    });
  });
}

  
  window.GEAgenda = { openAgenda, abrirFormEvento };

  /* ══════════════════════════════════════════════════════
     INIT — bind do formulário de evento
  ══════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-novo-evento')?.addEventListener('click', () => abrirFormEvento());

    document.querySelectorAll('[data-close="modal-agenda-form"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-agenda-form')?.classList.remove('show'))
    );

    document.getElementById('btn-agenda-salvar')?.addEventListener('click', async () => {
      const id = document.getElementById('ag-id').value;
      const data = {
        titulo:              document.getElementById('ag-titulo').value.trim(),
        tipo:                document.getElementById('ag-tipo').value,
        data_inicio:         document.getElementById('ag-data-inicio').value,
        data_fim:            document.getElementById('ag-data-fim').value || null,
        descricao:           document.getElementById('ag-descricao').value.trim() || null,
        local_nome:          document.getElementById('ag-local-nome').value.trim() || null,
        local_endereco:      document.getElementById('ag-local-endereco').value.trim() || null,
        bairro:              document.getElementById('ag-bairro').value.trim() || null,
        cidade:              document.getElementById('ag-cidade').value.trim() || null,
        lideranca_id:        Number(document.getElementById('ag-lideranca').value) || null,
        notificar_eleitores: document.getElementById('ag-notificar').checked,
      };

      if (!data.titulo) { window.showToast('Título obrigatório.', 'error'); return; }
      if (!data.data_inicio) { window.showToast('Data de início obrigatória.', 'error'); return; }

      try {
        if (id) {
          await window.API.put(`/agenda/${id}`, data);
          window.showToast('Evento atualizado!', 'success');
        } else {
          await window.API.post('/agenda', data);
          window.showToast('Evento criado!', 'success');
        }
        document.getElementById('modal-agenda-form').classList.remove('show');
        await carregarEventos();
        renderCalendario();
        renderListaEventos();
      } catch (err) {
        window.showToast(err.message, 'error');
      }
    });
  });

})();
