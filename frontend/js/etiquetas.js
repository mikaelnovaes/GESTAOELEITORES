/**
 * frontend/js/etiquetas.js
 * Gerar Etiquetas — modal aberto a partir do menu Eleitores
 * Expõe: window.GEEtiquetas.abrirModal()
 *
 * 3 tamanhos pré-configurados (retangulares):
 *   • 50,8 × 101,6 mm  (Pimaco 6082 / Avery 5163 — 10 por folha)
 *   • 100,0 × 25,0 mm  (3 colunas × 11 linhas A4)
 *   • 33,9 × 99,0 mm   (Pimaco 6080 / Avery 5160 — 24 por folha, mais usada)
 */

'use strict';

(function () {

  const TAMANHOS = {
    'media': {
      nome: 'Média (50,8 × 101,6 mm)',
      desc: '10 etiquetas por folha A4 — Pimaco 6082 / Avery 5163',
      larguraMM: 101.6,
      alturaMM:  50.8,
      colunas:   2,
      linhas:    5,
      margemTopoMM:    13,
      margemEsqMM:      4.7,
      espacoHMM:        2.5,
      espacoVMM:        0,
      fonte: 11,
    },
    'pequena': {
      nome: 'Pequena (100 × 25 mm)',
      desc: '3 colunas × 11 linhas em folha A4',
      larguraMM: 100,
      alturaMM:  25,
      colunas:   2,
      linhas:    11,
      margemTopoMM:    10,
      margemEsqMM:      5,
      espacoHMM:        0,
      espacoVMM:        0,
      fonte: 8,
    },
    'carta': {
      nome: 'Carta (33,9 × 99,0 mm)',
      desc: '24 etiquetas por folha A4 — Pimaco 6080 / Avery 5160 (mais comum)',
      larguraMM:  99,
      alturaMM:   33.9,
      colunas:    2,
      linhas:     7,
      margemTopoMM:    13,
      margemEsqMM:      4.7,
      espacoHMM:        2.5,
      espacoVMM:        0,
      fonte: 9,
    },
  };

  /* ══════════════════════════════════════════════════════
     ABRIR MODAL
  ══════════════════════════════════════════════════════ */
  function abrirModal() {
    const modal = document.getElementById('modal-etiquetas');
    if (!modal) {
      console.error('Modal #modal-etiquetas não encontrado no HTML.');
      return;
    }
    modal.classList.add('show');

    // Atualiza descrição ao trocar tamanho
    const sel = document.getElementById('etq-tamanho');
    const descEl = document.getElementById('etq-tamanho-desc');
    function atualizarDesc() {
      const cfg = TAMANHOS[sel.value];
      if (cfg) descEl.textContent = cfg.desc + ` · ${cfg.colunas * cfg.linhas} etiquetas por folha`;
    }
    sel.removeEventListener('change', atualizarDesc);
    sel.addEventListener('change', atualizarDesc);
    atualizarDesc();
  }

  /* ══════════════════════════════════════════════════════
     GERAR PDF
  ══════════════════════════════════════════════════════ */
  async function gerarPDF() {
    const tamanho = document.getElementById('etq-tamanho').value;
    const escopo  = document.querySelector('input[name="etq-escopo"]:checked')?.value || 'todos';
    const filtroBairro = document.getElementById('etq-filtro-bairro')?.value.trim();
    const filtroCidade = document.getElementById('etq-filtro-cidade')?.value.trim();

    const cfg = TAMANHOS[tamanho];
    if (!cfg) { window.showToast('Tamanho inválido.', 'error'); return; }

    try {
      // Buscar eleitores
      const qs = new URLSearchParams();
      if (filtroBairro) qs.set('bairro', filtroBairro);
      if (filtroCidade) qs.set('cidade', filtroCidade);
      qs.set('pageSize', '500');

      const resp = await window.API.get('/eleitores?' + qs.toString());
      let eleitores = resp.data || [];

      if (escopo === 'selecionados') {
        const ids = JSON.parse(sessionStorage.getItem('ge_etq_ids') || '[]');
        eleitores = eleitores.filter(e => ids.includes(Number(e.id)));
      }

      if (!eleitores.length) {
        window.showToast('Nenhum eleitor encontrado com esses filtros.', 'error');
        return;
      }

      if (!confirm(`Gerar PDF com ${eleitores.length} etiquetas (${Math.ceil(eleitores.length / (cfg.colunas * cfg.linhas))} folhas)?`)) return;

      // Gera HTML imprimível em nova janela
      const html = construirHTMLImpressao(eleitores, cfg, tamanho);
      const w = window.open('', '_blank');
      if (!w) {
        window.showToast('Permita pop-ups para gerar etiquetas.', 'error');
        return;
      }
      w.document.write(html);
      w.document.close();
      // Auto-print após carregar
      w.onload = () => setTimeout(() => w.print(), 300);

      document.getElementById('modal-etiquetas').classList.remove('show');
    } catch (err) {
      window.showToast('Erro: ' + err.message, 'error');
    }
  }

  function construirHTMLImpressao(eleitores, cfg, tamanhoKey) {
    const itemsPorFolha = cfg.colunas * cfg.linhas;
    const folhas = [];
    for (let i = 0; i < eleitores.length; i += itemsPorFolha) {
      folhas.push(eleitores.slice(i, i + itemsPorFolha));
    }

    const escapeHtml = (s) => String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[c]));

    const renderEtiqueta = (e) => {
      const enderecoLinha = [e.endereco, e.numero].filter(Boolean).join(', ');
      const bairroCidade  = [e.bairro, e.cidade].filter(Boolean).join(' - ');
      const cepUF = [e.cep, e.uf].filter(Boolean).join('  ');

      return `
        <div class="etiqueta">
          <div class="nome">${escapeHtml(e.nome || '')}</div>
          ${enderecoLinha ? `<div class="end">${escapeHtml(enderecoLinha)}</div>` : ''}
          ${bairroCidade  ? `<div class="bc">${escapeHtml(bairroCidade)}</div>` : ''}
          ${cepUF         ? `<div class="cep">${escapeHtml(cepUF)}</div>` : ''}
        </div>`;
    };

    const renderFolha = (eList) => {
      // Preenche com vazias para manter o grid
      const cels = [];
      for (let i = 0; i < itemsPorFolha; i++) {
        cels.push(eList[i] ? renderEtiqueta(eList[i]) : '<div class="etiqueta vazia"></div>');
      }
      return `<div class="folha">${cels.join('')}</div>`;
    };

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>Etiquetas — ${cfg.nome}</title>
<style>
  @page {
    size: A4 portrait;
    margin: 0;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, sans-serif;
    background: #fff;
    color: #000;
  }
  .folha {
    width: 210mm;
    height: 297mm;
    padding: ${cfg.margemTopoMM}mm 0 0 ${cfg.margemEsqMM}mm;
    page-break-after: always;
    display: grid;
    grid-template-columns: repeat(${cfg.colunas}, ${cfg.larguraMM}mm);
    grid-template-rows: repeat(${cfg.linhas}, ${cfg.alturaMM}mm);
    column-gap: ${cfg.espacoHMM}mm;
    row-gap: ${cfg.espacoVMM}mm;
  }
  .folha:last-child { page-break-after: auto; }

  .etiqueta {
    width: ${cfg.larguraMM}mm;
    height: ${cfg.alturaMM}mm;
    padding: 2mm 3mm;
    overflow: hidden;
    font-size: ${cfg.fonte}px;
    line-height: 1.25;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .etiqueta.vazia { visibility: hidden; }
  .etiqueta .nome {
    font-weight: 700;
    font-size: ${cfg.fonte + 1}px;
    margin-bottom: 1mm;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .etiqueta .end,
  .etiqueta .bc,
  .etiqueta .cep {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .etiqueta .cep { font-weight: 600; margin-top: 0.5mm; }

  /* Borda só na visualização web — não imprime */
  @media screen {
    body { background: #e5e7eb; padding: 20px; }
    .folha {
      background: #fff;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      margin: 0 auto 20px;
    }
    .etiqueta {
      border: 1px dashed #d1d5db;
    }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .folha { box-shadow: none; margin: 0; }
    .etiqueta { border: none; }
  }
</style>
</head>
<body>
${folhas.map(renderFolha).join('')}
</body>
</html>`;
  }

  /* ══════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    // Botão na tela de eleitores
    document.getElementById('btn-gerar-etiquetas')?.addEventListener('click', abrirModal);

    // Botão dentro do modal
    document.getElementById('btn-etq-gerar')?.addEventListener('click', gerarPDF);

    // Fechar modal
    document.querySelectorAll('[data-close="modal-etiquetas"]').forEach(btn =>
      btn.addEventListener('click', () => document.getElementById('modal-etiquetas')?.classList.remove('show'))
    );
  });

  window.GEEtiquetas = { abrirModal, gerarPDF };

})();
