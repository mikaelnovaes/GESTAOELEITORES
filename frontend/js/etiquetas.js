/**
 * frontend/js/etiquetas.js  (v3 — com pré-visualização interna)
 * Fluxo: configura → PRÉ-VISUALIZA dentro do sistema → confirma → imprime
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

  // Estado da geração atual (compartilhado entre os modais)
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
    if (!modal) return console.error('Modal #modal-etiquetas ausente.');
    modal.classList.add('show');

    const sel = document.getElementById('etq-tamanho');
    const descEl = document.getElementById('etq-tamanho-desc');
    function atualizarDesc() {
      const cfg = TAMANHOS[sel.value];
      if (cfg) descEl.textContent = cfg.desc + ` · ${cfg.colunas * cfg.linhas} por folha`;
    }
    sel.removeEventListener('change', atualizarDesc);
    sel.addEventListener('change', atualizarDesc);
    atualizarDesc();
  }

  /* ════════════════════════════════════════════════
     2) PRÉ-VISUALIZAR (botão "Gerar PDF" agora chama isso)
  ════════════════════════════════════════════════ */
  async function prepararPreview() {
    const tamanho = document.getElementById('etq-tamanho').value;
    const escopo = document.querySelector('input[name="etq-escopo"]:checked')?.value || 'todos';
    const filtroBairro = document.getElementById('etq-filtro-bairro')?.value.trim();
    const filtroCidade = document.getElementById('etq-filtro-cidade')?.value.trim();
    const cfg = TAMANHOS[tamanho];
    if (!cfg) { window.showToast('Tamanho inválido.', 'error'); return; }

    try {
      const qs = new URLSearchParams();
      if (escopo === 'filtrados') {
        if (filtroBairro) qs.set('bairro', filtroBairro);
        if (filtroCidade) qs.set('cidade', filtroCidade);
      }
      qs.set('pageSize', '500');

      const resp = await window.API.get('/eleitores?' + qs.toString());
      const eleitores = resp.data || [];
      if (!eleitores.length) {
        window.showToast('Nenhum eleitor encontrado.', 'error');
        return;
      }

      estadoAtual = { eleitores, cfg, tamanho, escopo, filtroBairro, filtroCidade };

      // Fecha modal de config, abre modal de preview
      document.getElementById('modal-etiquetas').classList.remove('show');
      renderPreviewCompleta();
    } catch (err) {
      window.showToast('Erro: ' + err.message, 'error');
    }
  }

  function renderPreviewCompleta() {
    const modal = document.getElementById('modal-etq-preview-full');
    if (!modal) {
      console.error('Modal #modal-etq-preview-full ausente.');
      return;
    }
    const { eleitores, cfg } = estadoAtual;
    const itemsPorFolha = cfg.colunas * cfg.linhas;
    const totalFolhas = Math.ceil(eleitores.length / itemsPorFolha);

    document.getElementById('etq-preview-info').innerHTML = `
      <strong>${eleitores.length}</strong> etiquetas · tamanho <strong>${cfg.nome}</strong>
      · <strong>${totalFolhas}</strong> ${totalFolhas === 1 ? 'folha' : 'folhas'} A4
    `;

    // Mostra TODAS as etiquetas em mini-grid escalonado
    const container = document.getElementById('etq-preview-grid');
    container.innerHTML = '';

    // Renderiza folha por folha
    for (let f = 0; f < totalFolhas; f++) {
      const grupo = eleitores.slice(f * itemsPorFolha, (f + 1) * itemsPorFolha);
      const folha = document.createElement('div');
      folha.className = 'etq-folha-preview';
      folha.style.cssText = `
        display: grid;
        grid-template-columns: repeat(${cfg.colunas}, 1fr);
        gap: 4px;
        margin-bottom: 1rem;
        padding: 0.5rem;
        background: #fff;
        border: 1px solid #d1d5db;
        border-radius: 4px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      `;

      // Label da folha
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

      // Limita preview a 3 folhas (pra não travar)
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
    if (!w) { window.showToast('Permita pop-ups.', 'error'); return; }
    w.document.write(html);
    w.document.close();
    w.onload = () => setTimeout(() => w.print(), 300);

    // Registra no histórico
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

    document.getElementById('modal-etq-preview-full').classList.remove('show');
    window.showToast('Etiquetas enviadas para impressão.', 'success');
  }

  function voltarEditar() {
    document.getElementById('modal-etq-preview-full').classList.remove('show');
    document.getElementById('modal-etiquetas').classList.add('show');
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
     5) HISTÓRICO
  ════════════════════════════════════════════════ */
  async function openHistorico() {
    if (typeof window.switchView === 'function') window.switchView('etiquetas-historico');
    await renderHistorico();
  }

  async function renderHistorico() {
    const container = document.getElementById('etiquetas-historico-content');
    if (!container) return;
    container.innerHTML = '<div style="padding:2rem;color:var(--muted);">Carregando…</div>';

    try {
      const rows = await window.API.get('/etiquetas/historico?limit=100');
      if (!rows.length) {
        container.innerHTML = `
          <div class="empty">
            <div style="font-size:2.5rem;">🏷️</div>
            <h3>Nenhuma etiqueta gerada ainda</h3>
            <p>Use <strong>Etiquetas → Gerar Etiquetas</strong> para criar a primeira.</p>
          </div>`;
        return;
      }

      const TAM = { carta:'33,9×99', media:'50,8×101,6', pequena:'100×25' };
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
          <table>
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
                  <td>${window.formatDateTime ? window.formatDateTime(r.criado_em) : new Date(r.criado_em).toLocaleString('pt-BR')}</td>
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
                    <button class="btn btn-secondary" data-etq-preview="${r.id}" style="font-size:0.75rem;padding:4px 8px;">
                      👁️ Pré-visualizar
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      container.querySelectorAll('[data-etq-preview]').forEach(btn => {
        btn.addEventListener('click', () => abrirPreviewHistorico(Number(btn.dataset.etqPreview)));
      });
    } catch (err) {
      container.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${esc(err.message)}</div>`;
    }
  }

  /* ════════════════════════════════════════════════
     6) PREVIEW DE ITEM DO HISTÓRICO
  ════════════════════════════════════════════════ */
  async function abrirPreviewHistorico(id) {
    const modal = document.getElementById('modal-etq-preview');
    if (!modal) return;
    modal.classList.add('show');
    const body = document.getElementById('etq-preview-body');
    body.innerHTML = '<div style="padding:2rem;color:var(--muted);text-align:center;">Carregando…</div>';

    try {
      const det = await window.API.get(`/etiquetas/${id}`);
      const cfg = TAMANHOS[det.tamanho];
      if (!cfg) { body.innerHTML = 'Tamanho desconhecido.'; return; }
      if (!det.eleitores.length) {
        body.innerHTML = '<div style="padding:2rem;color:var(--muted);text-align:center;">⚠️ Eleitores desta geração não estão mais disponíveis<br><small>(podem ter sido excluídos)</small></div>';
        document.getElementById('btn-etq-preview-reimprimir').style.display = 'none';
        return;
      }

      modal.dataset.previewEleitores = JSON.stringify(det.eleitores);
      modal.dataset.previewTamanho = det.tamanho;
      document.getElementById('btn-etq-preview-reimprimir').style.display = '';

      const amostra = det.eleitores.slice(0, 6);
      body.innerHTML = `
        <div style="margin-bottom:1rem;padding:0.8rem 1rem;background:var(--cream);border-radius:6px;font-size:0.85rem;">
          <strong>${det.quantidade} etiquetas</strong> · ${cfg.nome} · <strong>${det.folhas} folhas</strong><br>
          <span style="color:var(--muted);">Gerado por ${esc(det.gerado_por_nome || '—')} em ${new Date(det.criado_em).toLocaleString('pt-BR')}</span>
        </div>
        <div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.5rem;">Amostra (${amostra.length} de ${det.eleitores.length}):</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.6rem;">
          ${amostra.map(e => {
            const end = [e.endereco, e.numero].filter(Boolean).join(', ');
            const bc = [e.bairro, e.cidade].filter(Boolean).join(' - ');
            return `
              <div style="border:1px dashed #d1d5db;padding:8px 10px;border-radius:4px;font-size:0.8rem;line-height:1.3;background:#fff;">
                <div style="font-weight:700;color:var(--navy);margin-bottom:2px;">${esc(e.nome || '')}</div>
                ${end ? `<div>${esc(end)}</div>` : ''}
                ${bc ? `<div>${esc(bc)}</div>` : ''}
              </div>`;
          }).join('')}
        </div>`;
    } catch (err) {
      body.innerHTML = `<div style="padding:1.5rem;color:var(--danger);">${esc(err.message)}</div>`;
    }
  }

  /* ════════════════════════════════════════════════
     UTILS + INIT
  ════════════════════════════════════════════════ */
  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function init() {
    // Modal "Gerar" → botão agora chama prepararPreview (não imprime direto)
    document.getElementById('btn-etq-gerar')?.addEventListener('click', prepararPreview);
    document.querySelectorAll('[data-close="modal-etiquetas"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etiquetas')?.classList.remove('show'))
    );

    // Modal "Preview completa" (novo)
    document.getElementById('btn-etq-preview-confirmar')?.addEventListener('click', confirmarImpressao);
    document.getElementById('btn-etq-preview-voltar')?.addEventListener('click', voltarEditar);
    document.querySelectorAll('[data-close="modal-etq-preview-full"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etq-preview-full')?.classList.remove('show'))
    );

    // Modal "Preview histórico"
    document.querySelectorAll('[data-close="modal-etq-preview"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etq-preview')?.classList.remove('show'))
    );
    document.getElementById('btn-etq-preview-reimprimir')?.addEventListener('click', () => {
      const modal = document.getElementById('modal-etq-preview');
      const eleitores = JSON.parse(modal.dataset.previewEleitores || '[]');
      const tamanho = modal.dataset.previewTamanho;
      const cfg = TAMANHOS[tamanho];
      if (!eleitores.length || !cfg) return;
      const html = construirHTMLImpressao(eleitores, cfg);
      const w = window.open('', '_blank');
      if (!w) { window.showToast('Permita pop-ups.', 'error'); return; }
      w.document.write(html); w.document.close();
      w.onload = () => setTimeout(() => w.print(), 300);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GEEtiquetas = { abrirGerar, openHistorico, abrirModal: abrirGerar };

})();
