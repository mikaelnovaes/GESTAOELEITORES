/**
 * frontend/js/projecao.js
 * Projeção de Votos — intenção por eleitor + painel de projeção
 * Expõe: window.GEProjecao.openProjecao()
 */

'use strict';

(function () {

  const INTENCAO_CONFIG = {
    confirmado: { label: 'Confirmado',  cor: '#22c55e', icon: '✅' },
    provavel:   { label: 'Provável',    cor: '#84cc16', icon: '🟢' },
    indeciso:   { label: 'Indeciso',    cor: '#f59e0b', icon: '🟡' },
    risco:      { label: 'Em risco',    cor: '#f97316', icon: '🟠' },
    contra:     { label: 'Contra',      cor: '#ef4444', icon: '🔴' },
    null:       { label: 'Não definido', cor: '#6b7280', icon: '⚪' },
  };

  /* ══════════════════════════════════════════════════════
     ABRIR PAINEL
  ══════════════════════════════════════════════════════ */
  async function openProjecao() {
    window.switchView('projecao');
    await renderProjecao();
  }

  async function renderProjecao() {
    const container = document.getElementById('projecao-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:2rem;color:var(--muted);">Carregando projeção…</div>';

    try {
      const [resumo, porBairro, porLideranca] = await Promise.all([
        window.API.get('/projecao/resumo'),
        window.API.get('/projecao/por-bairro'),
        window.API.get('/projecao/por-lideranca'),
      ]);
      container.innerHTML = renderHTML(resumo, porBairro, porLideranca);
      bindProjecaoEvents(resumo);
      renderGraficoBairros(porBairro);
    } catch (err) {
      container.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro ao carregar: ${window.escapeHtml(err.message)}</div>`;
    }
  }

  function renderHTML(r, bairros, liderancas) {
 const metaPct = r.pct_meta_otimista != null
  ? (r.pct_meta_otimista === 0 && r.projecao_otimista > 0 ? '<1' : r.pct_meta_otimista)
  : '—';
    const metaBar = r.pct_meta_otimista != null
      ? `<div style="background:var(--line);border-radius:99px;height:10px;margin-top:0.5rem;">
           <div style="background:var(--gold);height:10px;border-radius:99px;width:${Math.min(r.pct_meta_otimista,100)}%;transition:width 0.6s;"></div>
         </div>` : '';

    const cardIntencao = Object.entries(INTENCAO_CONFIG).map(([k, v]) => {
      const MAP = {
  confirmado: 'confirmados',
  provavel:   'provaveis',
  indeciso:   'indecisos',
  risco:      'em_risco',
  contra:     'contra',
};
const count = k === 'null' ? r.sem_classificacao : (r[MAP[k]] ?? 0);
      const pct = r.total > 0 ? Math.round(count / r.total * 100) : 0;
      return `
        <div class="proj-card" data-intencao="${k}" style="cursor:pointer;border-left:3px solid ${v.cor};">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.85rem;color:var(--muted);">${v.icon} ${v.label}</span>
            <span style="font-size:1.5rem;font-weight:700;color:var(--navy);">${count.toLocaleString('pt-BR')}</span>
          </div>
          <div style="background:var(--line);border-radius:99px;height:6px;margin-top:0.5rem;">
            <div style="background:${v.cor};height:6px;border-radius:99px;width:${pct}%;"></div>
          </div>
          <div style="font-size:0.75rem;color:var(--muted);margin-top:0.3rem;">${pct}% da base</div>
        </div>`;
    }).join('');

    const lidRows = liderancas.slice(0, 10).map(l => {
      const pct = l.meta_lideranca > 0 ? Math.min(l.pct_meta ?? 0, 100) : null;
      return `
        <tr>
          <td>${window.escapeHtml(l.lideranca)}</td>
        <td style="text-align:center;">${l.total}</td>
          <td style="text-align:center;color:#22c55e;font-weight:600;">${l.confirmados}</td>
          <td style="text-align:center;color:#84cc16;">${l.provaveis}</td>
          <td style="text-align:center;color:#f97316;">${l.em_risco}</td>
          <td style="text-align:center;">
            ${pct != null
              ? `<div style="display:flex;align-items:center;gap:0.4rem;">
                   <div style="flex:1;background:var(--line);border-radius:99px;height:6px;">
                     <div style="background:var(--gold);height:6px;border-radius:99px;width:${pct}%;"></div>
                   </div>
                   <span style="font-size:0.78rem;color:var(--muted);white-space:nowrap;">${pct}%</span>
                 </div>`
              : '<span style="color:var(--muted);font-size:0.78rem;">sem meta</span>'}
          </td>
        </tr>`;
    }).join('');

    return `
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem;flex-wrap:wrap;gap:1rem;">
        <div>
          <div style="font-family:'Fraunces',serif;font-size:1.5rem;font-weight:700;color:var(--navy);">
            Projeção de Votos
          </div>
          <div style="font-size:0.85rem;color:var(--muted);">
            Base total: <strong>${r.total.toLocaleString('pt-BR')}</strong> eleitores
            ${r.candidato ? ` · Candidato: <strong>${window.escapeHtml(r.candidato)}</strong>` : ''}
          </div>
        </div>
        <button class="btn btn-secondary" id="btn-proj-config-meta" style="font-size:0.85rem;">
          ⚙️ Configurar meta
        </button>
      </div>

      <!-- Projeção geral -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
        <div class="panel" style="padding:1.2rem;">
          <div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:0.5rem;">Projeção Otimista</div>
          <div style="font-family:'Fraunces',serif;font-size:2.5rem;font-weight:700;color:#22c55e;">
            ${r.projecao_otimista.toLocaleString('pt-BR')}
          </div>
          <div style="font-size:0.8rem;color:var(--muted);">confirmados + prováveis</div>
          ${r.meta > 0 ? `
            <div style="margin-top:0.8rem;font-size:0.82rem;color:var(--muted);">
              Meta: ${r.meta.toLocaleString('pt-BR')} votos
            </div>
            ${metaBar}
            <div style="font-size:0.78rem;color:var(--gold);font-weight:600;margin-top:0.3rem;">
              ${metaPct}% da meta atingida
            </div>` : ''}
        </div>
        <div class="panel" style="padding:1.2rem;">
          <div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin-bottom:0.5rem;">Projeção Conservadora</div>
          <div style="font-family:'Fraunces',serif;font-size:2.5rem;font-weight:700;color:#84cc16;">
            ${r.projecao_pessimista.toLocaleString('pt-BR')}
          </div>
          <div style="font-size:0.8rem;color:var(--muted);">somente confirmados</div>
          <div style="margin-top:0.8rem;font-size:0.82rem;color:var(--muted);">
            🔄 Sem contato há 30+ dias: <strong style="color:var(--danger);">${r.sem_contato_30d}</strong>
          </div>
          <div style="font-size:0.82rem;color:var(--muted);margin-top:0.3rem;">
            📞 Contactados esta semana: <strong>${r.contatados_semana}</strong>
          </div>
        </div>
      </div>

      <!-- Cards por intenção -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.8rem;margin-bottom:1.5rem;">
        ${cardIntencao}
      </div>

      <!-- Gráfico por bairro -->
      <div class="panel" style="margin-bottom:1.5rem;">
        <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Projeção por Bairro</div>
        <canvas id="grafico-bairros" height="200"></canvas>
      </div>

      <!-- Tabela por liderança -->
      <div class="panel" style="margin-bottom:1.5rem;">
        <div style="font-weight:600;color:var(--navy);margin-bottom:1rem;">Desempenho por Liderança</div>
        <div style="overflow-x:auto;">
          <table>
            <thead>
              <tr>
                <th>Liderança</th>
                <th style="text-align:center;">Cadastrados</th>
                <th style="text-align:center;">✅ Confirm.</th>
                <th style="text-align:center;">🟢 Prováveis</th>
                <th style="text-align:center;">🟠 Risco</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>${lidRows}</tbody>
          </table>
        </div>
      </div>

      <!-- Lista de eleitores sem classificação -->
      <div class="panel" id="proj-lista-container" style="display:none;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <div style="font-weight:600;color:var(--navy);" id="proj-lista-titulo">Eleitores</div>
          <button class="btn btn-secondary" id="btn-proj-fechar-lista" style="font-size:0.82rem;">✕ Fechar</button>
        </div>
        <div id="proj-lista-eleitores"></div>
      </div>

      <!-- Modal Meta -->
      <div class="modal-overlay" id="modal-proj-meta">
        <div class="modal" style="max-width:420px;">
          <div class="modal-header">
            <div class="modal-title">Configurar Meta de Votos</div>
            <button class="modal-close" data-close="modal-proj-meta">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Nome do Candidato</label>
              <input type="text" id="proj-candidato" placeholder="Ex: João Silva" value="${window.escapeHtml(r.candidato || '')}">
            </div>
            <div class="form-group">
              <label>Cargo</label>
              <input type="text" id="proj-cargo" placeholder="Ex: Vereador" value="${window.escapeHtml(r.cargo || '')}">
            </div>
            <div class="form-group">
              <label>Meta de votos</label>
              <input type="number" id="proj-meta" min="0" value="${r.meta || 0}" placeholder="0">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-close="modal-proj-meta">Cancelar</button>
            <button class="btn btn-primary" id="btn-proj-salvar-meta">Salvar meta</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindProjecaoEvents(resumo) {
    // Clique nos cards de intenção → filtra lista
    document.querySelectorAll('.proj-card').forEach(card => {
      card.addEventListener('click', async () => {
        const intencao = card.dataset.intencao;
        await mostrarListaIntencao(intencao);
      });
    });

    // Fechar lista
    document.getElementById('btn-proj-fechar-lista')?.addEventListener('click', () => {
      document.getElementById('proj-lista-container').style.display = 'none';
    });

    // Modal meta
    document.getElementById('btn-proj-config-meta')?.addEventListener('click', () => {
      document.getElementById('modal-proj-meta').classList.add('show');
    });

    document.querySelectorAll('[data-close="modal-proj-meta"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-proj-meta').classList.remove('show'))
    );

    document.getElementById('btn-proj-salvar-meta')?.addEventListener('click', async () => {
      try {
        await window.API.put('/projecao/meta', {
          meta: Number(document.getElementById('proj-meta').value) || 0,
          candidato: document.getElementById('proj-candidato').value.trim() || null,
          cargo: document.getElementById('proj-cargo').value.trim() || null,
        });
        window.showToast('Meta salva!', 'success');
        document.getElementById('modal-proj-meta').classList.remove('show');
        await renderProjecao();
      } catch (err) {
        window.showToast(err.message, 'error');
      }
    });
  }

  async function mostrarListaIntencao(intencao) {
    const container = document.getElementById('proj-lista-container');
    const listaEl   = document.getElementById('proj-lista-eleitores');
    const titulo    = document.getElementById('proj-lista-titulo');
    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    listaEl.innerHTML = '<div style="color:var(--muted);padding:1rem;">Carregando…</div>';

    const cfg = INTENCAO_CONFIG[intencao] || INTENCAO_CONFIG.null;
    titulo.textContent = `${cfg.icon} ${cfg.label}`;

    const qs = intencao === 'null' ? '?intencao=sem_class' : `?intencao=${intencao}`;
    const rows = await window.API.get('/projecao/eleitores' + qs);

    if (!rows.length) {
      listaEl.innerHTML = '<div style="color:var(--muted);padding:1rem;">Nenhum eleitor nessa categoria.</div>';
      return;
    }

    listaEl.innerHTML = `
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr><th>Nome</th><th>Telefone</th><th>Bairro</th><th>Liderança</th><th>Intenção</th><th>Últ. Contato</th></tr>
          </thead>
          <tbody>
            ${rows.map(e => `
              <tr>
                <td>${window.escapeHtml(e.nome)}</td>
                <td>${window.escapeHtml(e.telefone || '—')}</td>
                <td>${window.escapeHtml(e.bairro || '—')}</td>
                <td>${window.escapeHtml(e.lideranca_nome || '—')}</td>
                <td>
                  <select class="sel-intencao" data-id="${e.id}" style="font-size:0.82rem;padding:2px 4px;">
                    <option value="">— definir —</option>
                    ${Object.entries(INTENCAO_CONFIG).filter(([k])=>k!=='null').map(([k,v]) =>
                      `<option value="${k}" ${e.intencao_voto === k ? 'selected' : ''}>${v.icon} ${v.label}</option>`
                    ).join('')}
                  </select>
                </td>
                <td style="font-size:0.8rem;color:var(--muted);">${e.ultimo_contato ? window.formatDate(e.ultimo_contato) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;

    // Salvar intenção inline
    listaEl.querySelectorAll('.sel-intencao').forEach(sel => {
      sel.addEventListener('change', async () => {
        try {
         await window.API.fetch(`/projecao/eleitor/${sel.dataset.id}`, {
  method: 'PATCH',
  body: JSON.stringify({
    intencao_voto: sel.value,
    ultimo_contato: new Date().toISOString(),
  }),
});
          window.showToast('Intenção atualizada.', 'success');
        } catch (err) {
          window.showToast(err.message, 'error');
        }
      });
    });
  }

 function renderGraficoBairros(bairros) {
  requestAnimationFrame(() => {
    const canvas = document.getElementById('grafico-bairros');
    if (!canvas || !bairros.length) return;
    _desenharGrafico(canvas, bairros);
  });
}

function _desenharGrafico(canvas, bairros) {
    const labels = bairros.slice(0, 10).map(b => b.bairro);
    const confirmados = bairros.slice(0, 10).map(b => b.confirmados);
    const provaveis   = bairros.slice(0, 10).map(b => b.provaveis);
    const emRisco     = bairros.slice(0, 10).map(b => b.em_risco);

    const ctx = canvas.getContext('2d');
    canvas._chartInstance?.destroy();

    // Gráfico de barras empilhadas simples (sem Chart.js — pure canvas)
    const BAR_H = 28;
    const GAP = 8;
    const LABEL_W = 150;
    const maxVal = Math.max(...bairros.slice(0,10).map(b => b.total), 1);
    const W = canvas.offsetWidth || 600;
    const chartW = W - LABEL_W - 20;

    canvas.height = labels.length * (BAR_H + GAP) + 20;
    canvas.width  = W;
    ctx.clearRect(0, 0, W, canvas.height);

    labels.forEach((label, i) => {
      const y = i * (BAR_H + GAP) + 10;
      const total = bairros[i].total;

      // Label
      ctx.fillStyle = '#4b5563';
      ctx.font = '12px "Inter Tight", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.length > 20 ? label.substring(0, 20) + '…' : label, 0, y + BAR_H / 2);

      // Barra fundo
      ctx.fillStyle = '#f3f4f6';
      ctx.beginPath();
      ctx.roundRect(LABEL_W, y, chartW, BAR_H, 4);
      ctx.fill();

      let x = LABEL_W;
      const segmentos = [
        { val: confirmados[i], cor: '#22c55e' },
        { val: provaveis[i],   cor: '#84cc16' },
        { val: emRisco[i],     cor: '#f97316' },
      ];
      segmentos.forEach(seg => {
        const w = (seg.val / maxVal) * chartW;
        if (w < 1) return;
        ctx.fillStyle = seg.cor;
        ctx.fillRect(x, y, w, BAR_H);
        x += w;
      });

      // Contador
      ctx.fillStyle = '#6b7280';
      ctx.fillText(total, LABEL_W + chartW + 6, y + BAR_H / 2);
    });

    // Legenda
    const legend = [
      { cor: '#22c55e', label: 'Confirmados' },
      { cor: '#84cc16', label: 'Prováveis' },
      { cor: '#f97316', label: 'Em risco' },
    ];
    canvas.height += 30;
    const ly = canvas.height - 20;
    legend.forEach((l, i) => {
      const lx = LABEL_W + i * 130;
      ctx.fillStyle = l.cor;
      ctx.fillRect(lx, ly, 12, 12);
      ctx.fillStyle = '#6b7280';
      ctx.fillText(l.label, lx + 16, ly + 6);
    });
  }

  window.GEProjecao = { openProjecao };

})();
