/**
 * frontend/js/etiquetas.js (v5 — fix HTTP 400 no Gerar PDF)
 *
 * MUDANÇA vs v4:
 *  - prepararPreview() agora PAGINA em chunks de 200 (era pageSize=500 que estourava)
 *  - Backend rejeita pageSize > 200 → loop com page=1,2,3,...
 *  - Mostra progresso "Carregando 200/1738..." pro usuário
 */

'use strict';

(function () {

  const TAMANHOS = {
    'carta': {
      nome: 'Carta (33,9 × 99,0 mm)',
      desc: '14 etiquetas por folha A4 — Pimaco 6080',
      larguraMM: 99, alturaMM: 33.9,
      colunas: 2, linhas: 7,
      margemTopoMM: 13, margemEsqMM: 4.7,
      espacoHMM: 2.5, espacoVMM: 0,
      fonte: 9,
    },
    'media': {
      nome: 'Média (50,8 × 101,6 mm)',
      desc: '10 etiquetas por folha A4 — Pimaco 6082',
      larguraMM: 101.6, alturaMM: 50.8,
      colunas: 2, linhas: 5,
      margemTopoMM: 13, margemEsqMM: 4.7,
      espacoHMM: 2.5, espacoVMM: 0,
      fonte: 11,
    },
    'pequena': {
      nome: 'Pequena (100 × 25 mm)',
      desc: '22 etiquetas por folha A4',
      larguraMM: 100, alturaMM: 25,
      colunas: 2, linhas: 11,
      margemTopoMM: 10, margemEsqMM: 5,
      espacoHMM: 0, espacoVMM: 0,
      fonte: 8,
    },
  };

  let estadoAtual = {
    eleitores: [],
    cfg: null,
    tamanho: null,
    escopo: 'todos',
    filtroBairro: '',
    filtroCidade: '',
  };

  /* ════════════════════════════════════════════════
     1) ABRIR MODAL DE GERAR
  ════════════════════════════════════════════════ */
  function abrirGerar() {
    const modal = document.getElementById('modal-etiquetas');
    if (!modal) {
      console.error('[ETIQUETAS] Modal #modal-etiquetas ausente.');
      window.showToast?.('Erro: modal não encontrado.', 'error');
      return;
    }
    modal.classList.add('show');

    const sel = document.getElementById('etq-tamanho');
    const descEl = document.getElementById('etq-tamanho-desc');
    if (sel) {
      function atualizarDesc() {
        const cfg = TAMANHOS[sel.value];
        if (cfg && descEl) descEl.textContent = cfg.desc + ` · ${cfg.colunas * cfg.linhas} por folha`;
      }
      sel.removeEventListener('change', atualizarDesc);
      sel.addEventListener('change', atualizarDesc);
      atualizarDesc();
    }
  }

  /* ════════════════════════════════════════════════
     2) PRÉ-VISUALIZAR — PAGINA em chunks de 200
        (Fix do erro HTTP 400: backend rejeita pageSize > 200)
  ════════════════════════════════════════════════ */
  async function prepararPreview() {
    const tamanho = document.getElementById('etq-tamanho')?.value;
    const escopo = document.querySelector('input[name="etq-escopo"]:checked')?.value || 'todos';
    const filtroBairro = document.getElementById('etq-filtro-bairro')?.value.trim() || '';
    const filtroCidade = document.getElementById('etq-filtro-cidade')?.value.trim() || '';
    const cfg = TAMANHOS[tamanho];
    if (!cfg) { window.showToast?.('Tamanho inválido.', 'error'); return; }

    const btnGerar = document.getElementById('btn-etq-gerar');
    const textoOriginalBtn = btnGerar?.textContent;

    try {
      // Pagina em chunks de 200 (limite do backend)
      const eleitores = [];
      const PAGE_SIZE = 200;
      let page = 1;
      let totalEsperado = 0;

      while (true) {
        const qs = new URLSearchParams();
        if (escopo === 'filtrados') {
          if (filtroBairro) qs.set('bairro', filtroBairro);
          if (filtroCidade) qs.set('cidade', filtroCidade);
        }
        qs.set('pageSize', String(PAGE_SIZE));
        qs.set('page', String(page));

        const resp = await window.API.get('/eleitores?' + qs.toString());
        const lote = Array.isArray(resp.data) ? resp.data : (Array.isArray(resp) ? resp : []);

        if (page === 1 && resp.total) {
          totalEsperado = resp.total;
        }

        eleitores.push(...lote);

        // Feedback visual durante carregamento
        if (btnGerar) {
          btnGerar.disabled = true;
          btnGerar.textContent = `⏳ Carregando ${eleitores.length}${totalEsperado ? '/' + totalEsperado : ''}...`;
        }

        // Para se já trouxe tudo ou se o backend retornou menos que o pageSize
        if (lote.length < PAGE_SIZE) break;
        // Segurança: nunca passa de 50 páginas (= 10000 eleitores)
        if (page >= 50) break;
        page++;
      }

      if (btnGerar) {
        btnGerar.disabled = false;
        btnGerar.textContent = textoOriginalBtn || '📄 Gerar PDF';
      }

      if (!eleitores.length) {
        window.showToast?.('Nenhum eleitor encontrado.', 'error');
        return;
      }

      estadoAtual = { eleitores, cfg, tamanho, escopo, filtroBairro, filtroCidade };

      document.getElementById('modal-etiquetas')?.classList.remove('show');
      renderPreviewCompleta();
    } catch (err) {
      if (btnGerar) {
        btnGerar.disabled = false;
        btnGerar.textContent = textoOriginalBtn || '📄 Gerar PDF';
      }
      window.showToast?.('Erro: ' + err.message, 'error');
    }
  }

  function renderPreviewCompleta() {
    const modal = document.getElementById('modal-etq-preview-full');
    if (!modal) {
      console.error('[ETIQUETAS] Modal #modal-etq-preview-full ausente.');
      window.showToast?.('Modal de preview não encontrado no HTML.', 'error');
      return;
    }
    const { eleitores, cfg } = estadoAtual;
    const itemsPorFolha = cfg.colunas * cfg.linhas;
    const totalFolhas = Math.ceil(eleitores.length / itemsPorFolha);

    const infoEl = document.getElementById('etq-preview-info');
    if (infoEl) infoEl.innerHTML = `
      <strong>${eleitores.length}</strong> etiquetas · tamanho <strong>${cfg.nome}</strong>
      · <strong>${totalFolhas}</strong> ${totalFolhas === 1 ? 'folha' : 'folhas'} A4
    `;

    const container = document.getElementById('etq-preview-grid');
    if (!container) return;
    container.innerHTML = '';

    for (let f = 0; f < totalFolhas; f++) {
      const grupo = eleitores.slice(f * itemsPorFolha, (f + 1) * itemsPorFolha);
      const folha = document.createElement('div');
      folha.style.cssText = `
        display: grid;
        grid-template-columns: repeat(${cfg.colunas}, 1fr);
        gap: 4px;
        margin-bottom: 1rem;
        padding: 0.5rem;
        background: #fff;
        border: 1px solid #d1d5db;
        border-radius: 4px;
      `;

      const lbl = document.createElement('div');
      lbl.style.cssText = 'grid-column: 1 / -1; font-size:0.7rem; color:#9ca3af; margin-bottom:0.2rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;';
      lbl.textContent = `Folha ${f + 1} de ${totalFolhas}`;
      folha.appendChild(lbl);

      grupo.forEach(e => {
        const endLinha = [e.endereco, e.numero].filter(Boolean).join(', ');
        const bairroCidade = [e.bairro, e.cidade].filter(Boolean).join(' - ');
        const cepUF = [e.cep, e.uf].filter(Boolean).join('  ');
        const et = document.createElement('div');
        et.style.cssText = `
          border: 1px dashed #d1d5db;
          padding: 6px 8px;
          border-radius: 3px;
          font-size: 0.72rem;
          line-height: 1.25;
          background: #fafafa;
          overflow: hidden;
          min-height: 50px;
        `;
        et.innerHTML = `
          <div style="font-weight:700;color:#1f2937;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(e.nome || '')}</div>
          ${endLinha ? `<div style="color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(endLinha)}</div>` : ''}
          ${bairroCidade ? `<div style="color:#4b5563;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(bairroCidade)}</div>` : ''}
          ${cepUF ? `<div style="color:#6b7280;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(cepUF)}</div>` : ''}
        `;
        folha.appendChild(et);
      });

      container.appendChild(folha);

      if (f >= 2 && totalFolhas > 3) {
        const aviso = document.createElement('div');
        aviso.style.cssText = 'text-align:center;padding:1rem;color:#9ca3af;font-size:0.82rem;background:#fff;border:1px dashed #d1d5db;border-radius:4px;';
        aviso.textContent = `+ ${totalFolhas - 3} folhas adicionais (total: ${totalFolhas} folhas, ${eleitores.length} etiquetas)`;
        container.appendChild(aviso);
        break;
      }
    }

    modal.classList.add('show');
  }

  /* ════════════════════════════════════════════════
     3) CONFIRMAR E IMPRIMIR
  ════════════════════════════════════════════════ */
  async function confirmarImpressao() {
    const { eleitores, cfg, tamanho, escopo, filtroBairro, filtroCidade } = estadoAtual;
    if (!eleitores.length) return;

    const html = construirHTMLImpressao(eleitores, cfg);
    const w = window.open('', '_blank');
    if (!w) { window.showToast?.('Permita pop-ups.', 'error'); return; }
    w.document.write(html);
    w.document.close();
    w.onload = () => setTimeout(() => w.print(), 300);

    try {
      const folhas = Math.ceil(eleitores.length / (cfg.colunas * cfg.linhas));
      await window.API.post('/etiquetas/log', {
        tamanho,
        quantidade: eleitores.length,
        folhas,
        escopo,
        filtro_bairro: filtroBairro || null,
        filtro_cidade: filtroCidade || null,
        ids: eleitores.map(e => Number(e.id)),
      });
    } catch (e) { /* não bloqueia */ }

    document.getElementById('modal-etq-preview-full')?.classList.remove('show');
    window.showToast?.('Etiquetas enviadas para impressão.', 'success');
  }

  function voltarEditar() {
    document.getElementById('modal-etq-preview-full')?.classList.remove('show');
    document.getElementById('modal-etiquetas')?.classList.add('show');
  }

  /* ════════════════════════════════════════════════
     4) HTML DE IMPRESSÃO
  ════════════════════════════════════════════════ */
  function construirHTMLImpressao(eleitores, cfg) {
    const itemsPorFolha = cfg.colunas * cfg.linhas;
    const folhas = [];
    for (let i = 0; i < eleitores.length; i += itemsPorFolha) {
      folhas.push(eleitores.slice(i, i + itemsPorFolha));
    }

    const renderEt = (e) => {
      const endLinha = [e.endereco, e.numero].filter(Boolean).join(', ');
      const bairroCidade = [e.bairro, e.cidade].filter(Boolean).join(' - ');
      const cepUF = [e.cep, e.uf].filter(Boolean).join('  ');
      return `
        <div class="etiqueta">
          <div class="nome">${esc(e.nome || '')}</div>
          ${endLinha ? `<div class="end">${esc(endLinha)}</div>` : ''}
          ${bairroCidade ? `<div class="bc">${esc(bairroCidade)}</div>` : ''}
          ${cepUF ? `<div class="cep">${esc(cepUF)}</div>` : ''}
        </div>`;
    };

    const renderFolha = (eList) => {
      const cels = [];
      for (let i = 0; i < itemsPorFolha; i++) {
        cels.push(eList[i] ? renderEt(eList[i]) : '<div class="etiqueta vazia"></div>');
      }
      return `<div class="folha">${cels.join('')}</div>`;
    };

    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>Etiquetas — ${cfg.nome}</title>
<style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, sans-serif; background: #fff; color: #000; }
.folha {
  width: 210mm; height: 297mm;
  padding: ${cfg.margemTopoMM}mm 0 0 ${cfg.margemEsqMM}mm;
  page-break-after: always;
  display: grid;
  grid-template-columns: repeat(${cfg.colunas}, ${cfg.larguraMM}mm);
  grid-template-rows: repeat(${cfg.linhas}, ${cfg.alturaMM}mm);
  column-gap: ${cfg.espacoHMM}mm; row-gap: ${cfg.espacoVMM}mm;
}
.folha:last-child { page-break-after: auto; }
.etiqueta {
  width: ${cfg.larguraMM}mm; height: ${cfg.alturaMM}mm;
  padding: 2mm 3mm; overflow: hidden;
  font-size: ${cfg.fonte}px; line-height: 1.25;
  display: flex; flex-direction: column; justify-content: center;
}
.etiqueta.vazia { visibility: hidden; }
.etiqueta .nome { font-weight: 700; font-size: ${cfg.fonte + 1}px; margin-bottom: 1mm;
                  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.etiqueta .end, .etiqueta .bc, .etiqueta .cep {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.etiqueta .cep { font-weight: 600; margin-top: 0.5mm; }
@media screen {
  body { background: #e5e7eb; padding: 20px; }
  .folha { background: #fff; box-shadow: 0 4px 20px rgba(0,0,0,0.1); margin: 0 auto 20px; }
  .etiqueta { border: 1px dashed #d1d5db; }
}
@media print {
  body { background: #fff; padding: 0; }
  .folha { box-shadow: none; margin: 0; }
  .etiqueta { border: none; }
}
</style></head><body>
${folhas.map(renderFolha).join('')}
</body></html>`;
  }

  /* ════════════════════════════════════════════════
     5) HISTÓRICO + REIMPRESSÃO COMO PDF
  ════════════════════════════════════════════════ */
  async function openHistorico() {
    await renderHistorico();
  }

  async function renderHistorico() {
    const container = document.getElementById('etiquetas-historico-content');
    if (!container) {
      console.error('[ETIQUETAS] Container #etiquetas-historico-content ausente.');
      return;
    }
    container.innerHTML = '<div style="padding:2rem;color:var(--muted);">Carregando…</div>';

    try {
      const rows = await window.API.get('/etiquetas/historico?limit=100');
      if (!Array.isArray(rows) || !rows.length) {
        container.innerHTML = `
          <div class="empty" style="padding:3rem;text-align:center;">
            <div style="font-size:2.5rem;">🏷️</div>
            <h3>Nenhuma etiqueta gerada ainda</h3>
            <p>Use <strong>Etiquetas → Gerar Etiquetas</strong> para criar a primeira.</p>
          </div>`;
        return;
      }

      const TAM = { carta: '33,9×99', media: '50,8×101,6', pequena: '100×25' };
      container.innerHTML = `
        <div style="margin-bottom:1rem;">
          <div style="font-family:'Fraunces',serif;font-size:1.5rem;font-weight:700;color:var(--navy);">
            Histórico de Etiquetas
          </div>
          <div style="font-size:0.85rem;color:var(--muted);">
            ${rows.length} ${rows.length === 1 ? 'geração' : 'gerações'} registradas
          </div>
        </div>
        <div class="panel" style="padding:0;overflow:hidden;">
          <table style="width:100%;">
            <thead>
              <tr>
                <th>Data / Hora</th>
                <th>Usuário</th>
                <th>Tamanho</th>
                <th style="text-align:center;">Etiquetas</th>
                <th style="text-align:center;">Folhas</th>
                <th>Filtro</th>
                <th style="text-align:right;">Ações</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td>${new Date(r.criado_em).toLocaleString('pt-BR')}</td>
                  <td>${esc(r.gerado_por_nome || '—')}</td>
                  <td><code style="background:var(--cream);padding:2px 6px;border-radius:3px;font-size:0.78rem;">${TAM[r.tamanho] || r.tamanho}</code></td>
                  <td style="text-align:center;font-weight:600;">${r.quantidade}</td>
                  <td style="text-align:center;">${r.folhas}</td>
                  <td style="font-size:0.82rem;color:var(--muted);">
                    ${r.escopo === 'todos' ? 'Todos' :
                      [r.filtro_bairro && 'Bairro: ' + r.filtro_bairro,
                       r.filtro_cidade && 'Cidade: ' + r.filtro_cidade].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td style="text-align:right;">
                    <button class="btn btn-secondary" data-etq-pdf="${r.id}" style="font-size:0.75rem;padding:4px 8px;">
                      📄 Visualizar PDF
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      container.querySelectorAll('[data-etq-pdf]').forEach(btn => {
        btn.addEventListener('click', () => visualizarComoPDF(Number(btn.dataset.etqPdf)));
      });
    } catch (err) {
      container.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${esc(err.message)}</div>`;
    }
  }

  async function visualizarComoPDF(id) {
    try {
      window.showToast?.('Gerando visualização…', 'info');
      const det = await window.API.get(`/etiquetas/${id}`);
      const cfg = TAMANHOS[det.tamanho];
      if (!cfg) { window.showToast?.('Tamanho desconhecido.', 'error'); return; }
      if (!det.eleitores?.length) {
        window.showToast?.('Eleitores desta geração não estão mais disponíveis.', 'error');
        return;
      }

      const html = construirHTMLImpressao(det.eleitores, cfg)
        .replace('w.print()', '/* manual */');

      const dataHora = new Date(det.criado_em).toLocaleString('pt-BR');
      const titulo = `Etiquetas geradas em ${dataHora}`;

      const htmlComHeader = html.replace('<body>', `<body>
        <div class="info-bar" style="background:#1e2a4a;color:#fff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;z-index:100;">
          <div style="font-family:Arial;">
            <div style="font-size:14px;font-weight:bold;">${esc(titulo)}</div>
            <div style="font-size:12px;opacity:0.8;">${det.eleitores.length} etiquetas · ${det.folhas} folhas · ${esc(cfg.nome)} · Gerado por ${esc(det.gerado_por_nome || '—')}</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="window.print()" style="background:#c9a961;color:#1e2a4a;border:none;padding:8px 16px;border-radius:4px;font-weight:600;cursor:pointer;font-family:Arial;font-size:13px;">🖨️ Imprimir</button>
            <button onclick="window.close()" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);padding:8px 16px;border-radius:4px;cursor:pointer;font-family:Arial;font-size:13px;">Fechar</button>
          </div>
        </div>
        <style>@media print { .info-bar { display: none !important; } }</style>`);

      const w = window.open('', '_blank');
      if (!w) { window.showToast?.('Permita pop-ups.', 'error'); return; }
      w.document.write(htmlComHeader);
      w.document.close();
      w.document.title = titulo;
    } catch (err) {
      window.showToast?.('Erro: ' + err.message, 'error');
    }
  }

  /* ════════════════════════════════════════════════
     UTILS + INIT
  ════════════════════════════════════════════════ */
  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function init() {
    const btnAbrirGerador = document.getElementById('btn-abrir-modal-etiquetas');
    if (btnAbrirGerador) {
      btnAbrirGerador.addEventListener('click', abrirGerar);
    }

    document.getElementById('btn-etq-gerar')?.addEventListener('click', prepararPreview);
    document.querySelectorAll('[data-close="modal-etiquetas"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etiquetas')?.classList.remove('show'))
    );

    document.getElementById('btn-etq-preview-confirmar')?.addEventListener('click', confirmarImpressao);
    document.getElementById('btn-etq-preview-voltar')?.addEventListener('click', voltarEditar);
    document.querySelectorAll('[data-close="modal-etq-preview-full"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etq-preview-full')?.classList.remove('show'))
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GEEtiquetas = {
    abrirGerar,
    openHistorico,
    visualizarComoPDF
  };

  console.log('[ETIQUETAS v5] Módulo carregado. Métodos:', Object.keys(window.GEEtiquetas));

})();
