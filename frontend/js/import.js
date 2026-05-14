/**
 * frontend/js/import.js v3.1
 * Importação de Excel/CSV com mapeamento automático.
 * Usa window.API (que respeita X-Acting-Tenant).
 */

'use strict';

const FIELD_DEFS = [
  { key: 'nome', label: 'Nome Completo', aliases: ['nome', 'nome completo', 'nomecompleto', 'name', 'eleitor', 'pessoa'] },
  { key: 'data_nascimento', label: 'Data Nascimento', aliases: ['data de nascimento', 'data nascimento', 'datanascimento', 'nascimento', 'dn', 'birthdate'] },
  { key: 'telefone', label: 'Telefone', aliases: ['telefone', 'tel', 'celular', 'fone', 'whatsapp', 'whats', 'contato', 'phone'] },
  { key: 'email', label: 'E-mail', aliases: ['email', 'e-mail', 'mail'] },
  { key: 'endereco', label: 'Endereço', aliases: ['endereco', 'endereço', 'rua', 'logradouro', 'avenida', 'address'] },
  { key: 'numero', label: 'Número', aliases: ['numero', 'número', 'num', 'nº', 'n°'] },
  { key: 'bairro', label: 'Bairro', aliases: ['bairro', 'distrito'] },
  { key: 'cidade', label: 'Cidade', aliases: ['cidade', 'municipio', 'município', 'city'] },
  { key: 'titulo_eleitor', label: 'Título', aliases: ['titulo', 'título', 'titulo eleitor', 'tituloeleitor'] },
  { key: 'secao', label: 'Seção', aliases: ['secao', 'seção', 'sessao'] },
  { key: 'escola_votacao', label: 'Local', aliases: ['escola', 'local de votacao', 'localvotacao'] },
];

let importState = { fileName: '', rows: [], headers: [], mapping: {} };

function initImport() {
  const dropzone = document.getElementById('dropzone');
  const input = document.getElementById('excel-input');
  if (!dropzone || !input) return;

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); }));
  dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  document.getElementById('btn-import-cancel')?.addEventListener('click', resetImport);
  document.getElementById('btn-import-confirm')?.addEventListener('click', confirmImport);
}

function normalize(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

function autoMatch(headerNorm) {
  for (const def of FIELD_DEFS) {
    for (const alias of def.aliases) {
      if (headerNorm === normalize(alias)) return def.key;
    }
  }
  for (const def of FIELD_DEFS) {
    for (const alias of def.aliases) {
      const an = normalize(alias);
      if (headerNorm.includes(an) || an.includes(headerNorm)) return def.key;
    }
  }
  return '';
}

function handleFile(file) {
  if (file.size > 5 * 1024 * 1024) {
    showToast('Arquivo muito grande (máx 5MB).', 'error');
    return;
  }
  const ext = file.name.toLowerCase();
  if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
    showToast('Use .xlsx, .xls ou .csv.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      if (!json.length) { showToast('Planilha vazia.', 'error'); return; }

      const headers = json[0].map(h => String(h || '').trim());
      const rows = json.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
      if (!headers.length || !rows.length) {
        showToast('Sem dados válidos.', 'error');
        return;
      }
      importState = { fileName: file.name, headers, rows, mapping: {} };
      headers.forEach((h, idx) => {
        const m = autoMatch(normalize(h));
        if (m && !Object.values(importState.mapping).includes(m)) {
          importState.mapping[idx] = m;
        }
      });
      renderMapping();
      renderPreview();
      document.getElementById('step-mapping').style.display = 'block';
      document.getElementById('step-preview').style.display = 'block';
      const info = document.getElementById('file-info');
      if (info) info.innerHTML = `<strong>${escapeHtml(file.name)}</strong> — ${headers.length} colunas, ${rows.length} registros`;
    } catch (err) {
      console.error(err);
      showToast('Erro ao ler o arquivo.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderMapping() {
  const grid = document.getElementById('mapping-grid');
  if (!grid) return;
  let html = `<div class="head">Coluna do Excel</div><div class="head"></div><div class="head">Campo no Sistema</div>`;
  importState.headers.forEach((h, idx) => {
    const matched = importState.mapping[idx] || '';
    html += `
      <div>
        <div class="mapping-target">${escapeHtml(h || `(coluna ${idx + 1})`)}</div>
        <small>${matched ? '<span class="badge badge-success">Detectado</span>' : '<span class="badge badge-warn">—</span>'}</small>
      </div>
      <div class="mapping-arrow">→</div>
      <div>
        <select data-idx="${idx}" class="mapping-select">
          <option value="">— ignorar —</option>
          ${FIELD_DEFS.map(def => `<option value="${def.key}" ${matched === def.key ? 'selected' : ''}>${escapeHtml(def.label)}</option>`).join('')}
        </select>
      </div>`;
  });
  grid.innerHTML = html;
  grid.querySelectorAll('.mapping-select').forEach(s => {
    s.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx);
      const val = e.target.value;
      // Remover atribuição anterior se existir
      Object.keys(importState.mapping).forEach(k => {
        if (importState.mapping[k] === val) delete importState.mapping[k];
      });
      if (val) importState.mapping[idx] = val;
      else delete importState.mapping[idx];
      renderPreview();
    });
  });
}

function rowToRecord(row) {
  const r = {};
  Object.entries(importState.mapping).forEach(([idx, key]) => {
    r[key] = String(row[parseInt(idx)] || '').trim();
  });
  // Normalizar data dd/mm/aaaa ou aaaa-mm-dd
  if (r.data_nascimento) {
    const m = r.data_nascimento.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) r.data_nascimento = `${m[3]}-${m[2]}-${m[1]}`;
  }
  return r;
}

function renderPreview() {
  const records = importState.rows.slice(0, 50).map(rowToRecord).filter(r => r.nome?.trim());
  const previewInfo = document.getElementById('preview-info');
  if (previewInfo) previewInfo.innerHTML = `<strong>${records.length}</strong> de ${importState.rows.length} registros válidos`;
  const cols = ['nome', 'data_nascimento', 'telefone', 'email', 'bairro', 'cidade'];
  const used = new Set(Object.values(importState.mapping));
  const visible = cols.filter(c => used.has(c));
  if (!visible.length) {
    document.getElementById('preview-table').innerHTML = '<div style="padding:1rem;color:var(--muted);">Mapeie pelo menos a coluna Nome.</div>';
    return;
  }
  let html = '<table><thead><tr>' + visible.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
  records.slice(0, 10).forEach(r => {
    html += '<tr>' + visible.map(c => `<td>${escapeHtml(r[c] || '')}</td>`).join('') + '</tr>';
  });
  html += '</tbody></table>';
  document.getElementById('preview-table').innerHTML = html;
}

async function confirmImport() {
  if (!Object.values(importState.mapping).includes('nome')) {
    showToast('Mapeie a coluna "Nome".', 'error');
    return;
  }
  const records = importState.rows.map(rowToRecord).filter(r => r.nome?.trim());
  if (!records.length) { showToast('Nenhum registro válido.', 'error'); return; }
  if (!confirm(`Importar ${records.length} eleitor(es)?`)) return;

  try {
    const result = await window.API.post('/eleitores/importar', { records });
    showToast(`${result.imported} importado(s). ${result.failed} falha(s).`, 'success');
    resetImport();
    if (window.syncFromAPI) await window.syncFromAPI();
    if (typeof switchView === 'function') switchView('list');
  } catch (err) {
    showToast('Erro: ' + err.message, 'error');
  }
}

function resetImport() {
  importState = { fileName: '', rows: [], headers: [], mapping: {} };
  const input = document.getElementById('excel-input');
  if (input) input.value = '';
  ['step-mapping', 'step-preview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  ['mapping-grid', 'preview-table', 'file-info', 'preview-info'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

window.GEImport = { initImport, resetImport };
