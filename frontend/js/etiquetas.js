/**
 * frontend/js/etiquetas.js  (v2 — com histórico e preview)
 * Expõe:
 *   - window.GEEtiquetas.abrirGerar()      → abre o modal de gerar
 *   - window.GEEtiquetas.openHistorico()   → abre a view de histórico 
 */

'use strict';

(function () {

  const TAMANHOS = {
    'media': {
      nome: 'Média (50,8 × 101,6 mm)',
      desc: '10 etiquetas por folha A4 — Pimaco 6082 / Avery 5163',
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
    'carta': {
      nome: 'Carta (33,9 × 99,0 mm)',
      desc: '14 etiquetas por folha A4 — Pimaco 6080 / Avery 5160',
      larguraMM: 99, alturaMM: 33.9,
      colunas: 2, linhas: 7,
      margemTopoMM: 13, margemEsqMM: 4.7,
      espacoHMM: 2.5, espacoVMM: 0,
      fonte: 9,
    },
  };

  /* ══════════════════════════════════════════════════════
     1) GERAR ETIQUETAS — modal
  ══════════════════════════════════════════════════════ */
  function abrirGerar() {
    const modal = document.getElementById('modal-etiquetas');
    if (!modal) return console.error('Modal #modal-etiquetas não encontrado.');
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

  async function gerarPDF() {
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

      const folhas = Math.ceil(eleitores.length / (cfg.colunas * cfg.linhas));
      if (!confirm(`Gerar PDF com ${eleitores.length} etiquetas (${folhas} folhas)?`)) return;

      const html = construirHTMLImpressao(eleitores, cfg);
      const w = window.open('', '_blank');
      if (!w) { window.showToast('Permita pop-ups.', 'error'); return; }
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => w.print(), 300);

      // Registra no histórico
      try {
        await window.API.post('/etiquetas/log', {
          tamanho,
          quantidade: eleitores.length,
          folhas,
          escopo,
          filtro_bairro: filtroBairro || null,
          filtro_cidade: filtroCidade || null,
          ids: eleitores.map(e => Number(e.id)),
        });
      } catch (e) { /* não bloqueia o fluxo */ }

      document.getElementById('modal-etiquetas').classList.remove('show');
    } catch (err) {
      window.showToast('Erro: ' + err.message, 'error');
    }
  }

  function construirHTMLImpressao(eleitores, cfg) {
    const itemsPorFolha = cfg.colunas * cfg.linhas;
    const folhas = [];
    for (let i = 0; i < eleitores.length; i += itemsPorFolha) {
      folhas.push(eleitores.slice(i, i + itemsPorFolha));
    }

    const esc = (s) => String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));

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

  /* ══════════════════════════════════════════════════════
     2) HISTÓRICO (Visualizar Etiquetas)
  ══════════════════════════════════════════════════════ */
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
            <p>Use o menu <strong>Etiquetas → Gerar Etiquetas</strong> para criar a primeira.</p>
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
                  <td>${window.escapeHtml(r.gerado_por_nome || '—')}</td>
                  <td><code style="background:var(--cream);padding:2px 6px;border-radius:3px;font-size:0.78rem;">${TAM[r.tamanho] || r.tamanho}</code></td>
                  <td style="text-align:center;font-weight:600;">${r.quantidade}</td>
                  <td style="text-align:center;">${r.folhas}</td>
                  <td style="font-size:0.82rem;color:var(--muted);">
                    ${r.escopo === 'todos' ? 'Todos eleitores' :
                      [r.filtro_bairro && 'Bairro: ' + r.filtro_bairro,
                       r.filtro_cidade && 'Cidade: ' + r.filtro_cidade]
                       .filter(Boolean).join(' · ') || '—'}
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

      // Bind preview
      container.querySelectorAll('[data-etq-preview]').forEach(btn => {
        btn.addEventListener('click', () => abrirPreview(Number(btn.dataset.etqPreview)));
      });
    } catch (err) {
      container.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${window.escapeHtml(err.message)}</div>`;
    }
  }

  /* ══════════════════════════════════════════════════════
     3) PREVIEW dentro do modal
  ══════════════════════════════════════════════════════ */
  async function abrirPreview(id) {
    const modal = document.getElementById('modal-etq-preview');
    if (!modal) { console.error('Modal #modal-etq-preview ausente'); return; }
    modal.classList.add('show');
    const body = document.getElementById('etq-preview-body');
    body.innerHTML = '<div style="padding:2rem;color:var(--muted);text-align:center;">Carregando…</div>';

    try {
      const det = await window.API.get(`/etiquetas/${id}`);
      const cfg = TAMANHOS[det.tamanho];
      if (!cfg) { body.innerHTML = 'Tamanho desconhecido.'; return; }

      if (!det.eleitores.length) {
        body.innerHTML = `
          <div style="padding:2rem;color:var(--muted);text-align:center;">
            ⚠️ Os eleitores desta geração não estão mais disponíveis<br>
            <small>(podem ter sido excluídos ou alterados)</small>
          </div>`;
        document.getElementById('btn-etq-preview-reimprimir').style.display = 'none';
        return;
      }

      // Guarda os dados para o botão "Reimprimir"
      modal.dataset.previewEleitores = JSON.stringify(det.eleitores);
      modal.dataset.previewTamanho = det.tamanho;
      document.getElementById('btn-etq-preview-reimprimir').style.display = '';

      // Mini-preview com até 4 etiquetas
      const amostra = det.eleitores.slice(0, 4);
      const esc = window.escapeHtml;
      body.innerHTML = `
        <div style="margin-bottom:1rem;padding:0.8rem 1rem;background:var(--cream);border-radius:6px;font-size:0.85rem;">
          <strong>${det.quantidade} etiquetas</strong> · tamanho <strong>${cfg.nome}</strong> · <strong>${det.folhas} folhas</strong><br>
          <span style="color:var(--muted);">Gerado por ${esc(det.gerado_por_nome || '—')} em ${new Date(det.criado_em).toLocaleString('pt-BR')}</span>
        </div>

        <div style="font-size:0.82rem;color:var(--muted);margin-bottom:0.5rem;">
          Amostra (${amostra.length} de ${det.eleitores.length}):
        </div>

        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:0.6rem;">
          ${amostra.map(e => {
            const end = [e.endereco, e.numero].filter(Boolean).join(', ');
            const bc = [e.bairro, e.cidade].filter(Boolean).join(' - ');
            return `
              <div style="border:1px dashed #d1d5db;padding:8px 10px;border-radius:4px;
                          font-size:0.8rem;line-height:1.3;background:#fff;">
                <div style="font-weight:700;color:var(--navy);margin-bottom:2px;">${esc(e.nome || '')}</div>
                ${end ? `<div>${esc(end)}</div>` : ''}
                ${bc ? `<div>${esc(bc)}</div>` : ''}
              </div>`;
          }).join('')}
        </div>`;
    } catch (err) {
      body.innerHTML = `<div style="padding:1.5rem;color:var(--danger);">${window.escapeHtml(err.message)}</div>`;
    }
  }

  /* ══════════════════════════════════════════════════════
     4) INIT
  ══════════════════════════════════════════════════════ */
  function init() {
    // Botão de "Gerar Etiquetas" (no modal)
    document.getElementById('btn-etq-gerar')?.addEventListener('click', gerarPDF);
    document.querySelectorAll('[data-close="modal-etiquetas"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etiquetas')?.classList.remove('show'))
    );

    // Modal de preview
    document.querySelectorAll('[data-close="modal-etq-preview"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etq-preview')?.classList.remove('show'))
    );

    // Reimprimir a partir do preview
    document.getElementById('btn-etq-preview-reimprimir')?.addEventListener('click', () => {
      const modal = document.getElementById('modal-etq-preview');
      const eleitores = JSON.parse(modal.dataset.previewEleitores || '[]');
      const tamanho = modal.dataset.previewTamanho;
      const cfg = TAMANHOS[tamanho];
      if (!eleitores.length || !cfg) return;

      const html = construirHTMLImpressao(eleitores, cfg);
      const w = window.open('', '_blank');
      if (!w) { window.showToast('Permita pop-ups.', 'error'); return; }
      w.document.write(html);
      w.document.close();
      w.onload = () => setTimeout(() => w.print(), 300);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GEEtiquetas = { abrirGerar, openHistorico, abrirModal: abrirGerar /* alias */ };

})();
