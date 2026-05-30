/**
 * frontend/js/disparo.js
 * Disparo Segmentado por Perfil
 * Expõe: window.GEDisparo.openDisparo()
 */

'use strict';

(function () {

  let liderancasCache = [];

  async function openDisparo() {
    window.switchView('disparo');
    await renderUI();
  }

  async function renderUI() {
    const container = document.getElementById('disparo-content');
    if (!container) return;

    // Carrega lideranças
    if (window.GELiderancas) {
      try { liderancasCache = await window.GELiderancas.fetchAll(); }
      catch { liderancasCache = []; }
    }

    container.innerHTML = `
      <div style="margin-bottom:1.5rem;">
        <div style="font-family:'Fraunces',serif;font-size:1.5rem;font-weight:700;color:var(--navy);">
          Disparo Segmentado
        </div>
        <div style="font-size:0.85rem;color:var(--muted);">
          Envie mensagens apenas para grupos específicos de eleitores
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;">
        <!-- COLUNA ESQUERDA: FILTROS -->
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">🎯 Filtros</div>

          <div class="form-group">
            <label>Bairro</label>
            <input type="text" id="disp-bairro" placeholder="Ex: Centro">
          </div>

          <div class="form-group">
            <label>Cidade</label>
            <input type="text" id="disp-cidade" placeholder="Ex: São Paulo">
          </div>

          <div class="form-group">
            <label>Liderança</label>
            <select id="disp-lideranca">
              <option value="">— Todas —</option>
              ${liderancasCache.map(l => `<option value="${l.id}">${window.escapeHtml(l.nome)}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label>Intenção de voto</label>
            <select id="disp-intencao">
              <option value="">— Todas —</option>
              <option value="confirmado">✅ Confirmado</option>
              <option value="provavel">🟢 Provável</option>
              <option value="indeciso">🟡 Indeciso</option>
              <option value="risco">🟠 Em risco</option>
              <option value="contra">🔴 Contra</option>
            </select>
          </div>

          <div class="form-group">
            <label>Faixa etária</label>
            <div style="display:flex;gap:0.5rem;align-items:center;">
              <input type="number" id="disp-idade-de" placeholder="De" min="0" max="120" style="flex:1;">
              <span style="color:var(--muted);">até</span>
              <input type="number" id="disp-idade-ate" placeholder="Até" min="0" max="120" style="flex:1;">
              <span style="color:var(--muted);font-size:0.85rem;">anos</span>
            </div>
          </div>

          <div class="form-group">
            <label>Sem contato há</label>
            <div style="display:flex;gap:0.5rem;align-items:center;">
              <input type="number" id="disp-sem-contato" placeholder="Ex: 30" min="1" max="365" style="flex:1;">
              <span style="color:var(--muted);font-size:0.85rem;">dias ou mais</span>
            </div>
          </div>

          <button class="btn btn-secondary" id="btn-disp-preview" style="width:100%;margin-top:0.5rem;">
            👁 Calcular destinatários
          </button>
        </div>

        <!-- COLUNA DIREITA: MENSAGEM + ENVIO -->
        <div class="panel" style="padding:1.2rem;">
          <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">💬 Mensagem</div>

          <div class="form-group">
            <label>Texto da mensagem</label>
            <textarea id="disp-mensagem" rows="8" placeholder="Olá! Tudo bem? Gostaria de convidar..."
                      maxlength="4096" style="width:100%;resize:vertical;"></textarea>
            <div style="font-size:0.78rem;color:var(--muted);text-align:right;margin-top:0.3rem;">
              <span id="disp-msg-count">0</span> / 4096
            </div>
          </div>

          <div id="disp-preview-area" style="background:var(--cream);border-radius:6px;padding:1rem;margin-bottom:1rem;display:none;">
            <div style="font-size:0.85rem;color:var(--muted);margin-bottom:0.5rem;">📊 Pré-visualização</div>
            <div id="disp-preview-total" style="font-family:'Fraunces',serif;font-size:2rem;font-weight:700;color:var(--gold);"></div>
            <div style="font-size:0.85rem;color:var(--muted);margin-bottom:0.6rem;">eleitores serão notificados</div>
            <div id="disp-preview-amostra"></div>
          </div>

          <button class="btn btn-primary" id="btn-disp-enviar" style="width:100%;">
            📤 Disparar agora
          </button>

          <div style="font-size:0.78rem;color:var(--muted);margin-top:0.8rem;">
            ⚠️ O disparo é enviado em background com pausa de 120ms entre mensagens.
            Confirme os filtros antes — não há como cancelar após iniciado.
          </div>
        </div>
      </div>`;

    bind();
  }

  function getFiltros() {
    const f = {
      bairro:           document.getElementById('disp-bairro').value.trim() || null,
      cidade:           document.getElementById('disp-cidade').value.trim() || null,
      lideranca_id:     Number(document.getElementById('disp-lideranca').value) || null,
      intencao_voto:    document.getElementById('disp-intencao').value || null,
      faixa_etaria_de:  Number(document.getElementById('disp-idade-de').value) || null,
      faixa_etaria_ate: Number(document.getElementById('disp-idade-ate').value) || null,
      sem_contato_dias: Number(document.getElementById('disp-sem-contato').value) || null,
    };
    // Remove nulos
    Object.keys(f).forEach(k => { if (f[k] == null || f[k] === '') delete f[k]; });
    return f;
  }

  function bind() {
    const msgEl = document.getElementById('disp-mensagem');
    msgEl?.addEventListener('input', () => {
      document.getElementById('disp-msg-count').textContent = msgEl.value.length;
    });

    document.getElementById('btn-disp-preview')?.addEventListener('click', async () => {
      const filtros = getFiltros();
      try {
        const r = await window.API.post('/disparo/preview', { filtros });
        const area = document.getElementById('disp-preview-area');
        document.getElementById('disp-preview-total').textContent = r.total.toLocaleString('pt-BR');
        document.getElementById('disp-preview-amostra').innerHTML = r.amostra.length
          ? '<div style="font-size:0.82rem;color:var(--muted);margin-top:0.5rem;">Amostra:</div>' +
            r.amostra.map(e =>
              `<div style="font-size:0.85rem;padding:0.3rem 0;border-bottom:1px solid var(--line);">
                ${window.escapeHtml(e.nome)} <span style="color:var(--muted);">— ${window.escapeHtml(e.telefone || 'sem telefone')}</span>
              </div>`
            ).join('') +
            (r.total > 10 ? `<div style="font-size:0.78rem;color:var(--muted);text-align:center;margin-top:0.5rem;">+ ${r.total - 10} eleitores</div>` : '')
          : '';
        area.style.display = 'block';
      } catch (err) {
        window.showToast(err.message, 'error');
      }
    });

    document.getElementById('btn-disp-enviar')?.addEventListener('click', async () => {
      const filtros = getFiltros();
      const mensagem = document.getElementById('disp-mensagem').value.trim();

      if (!mensagem) { window.showToast('Digite a mensagem.', 'error'); return; }
      if (!Object.keys(filtros).length) {
        if (!confirm('Você não selecionou filtros — vai disparar para TODOS os eleitores com telefone. Continuar?')) return;
      }

      // Confirma com preview
      try {
        const prev = await window.API.post('/disparo/preview', { filtros });
        if (!confirm(`Disparar para ${prev.total.toLocaleString('pt-BR')} eleitores? Esta ação não pode ser cancelada.`)) return;

        const r = await window.API.post('/disparo/enviar', { filtros, mensagem });
        window.showToast(`Disparo iniciado para ${r.total} eleitores. Lote: ${r.lote_id}`, 'success');
        document.getElementById('disp-mensagem').value = '';
        document.getElementById('disp-msg-count').textContent = '0';
        document.getElementById('disp-preview-area').style.display = 'none';
      } catch (err) {
        window.showToast(err.message, 'error');
      }
    });
  }

  window.GEDisparo = { openDisparo };

})();
