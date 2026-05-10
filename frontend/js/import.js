/**
 * frontend/js/import.js
 * Importação de planilhas Excel/CSV com mapeamento automático de colunas
 */

'use strict';

/* Referências aos módulos globais */


/* ============================================================
   DEFINIÇÕES DE CAMPOS
   ============================================================ */
const FIELD_DEFS = [
  { key: 'nome',           label: 'Nome Completo',      aliases: ['nome', 'nome completo', 'nomecompleto', 'name', 'eleitor', 'pessoa'] },
  { key: 'data_nascimento',label: 'Data de Nascimento', aliases: ['data de nascimento', 'data nascimento', 'datanascimento', 'nascimento', 'data nasc', 'dt nascimento', 'dn', 'birthdate'] },
  { key: 'telefone',       label: 'Telefone',           aliases: ['telefone', 'tel', 'celular', 'fone', 'whatsapp', 'whats', 'contato', 'phone'] },
  { key: 'email',          label: 'E-mail',             aliases: ['email', 'e-mail', 'mail', 'correio'] },
  { key: 'endereco',       label: 'Endereço',           aliases: ['endereco', 'endereço', 'rua', 'logradouro', 'avenida', 'address'] },
  { key: 'numero',         label: 'Número',             aliases: ['numero', 'número', 'num', 'nº', 'n°', 'nro', 'number'] },
  { key: 'bairro',         label: 'Bairro',             aliases: ['bairro', 'distrito', 'district'] },
  { key: 'cidade',         label: 'Cidade',             aliases: ['cidade', 'municipio', 'município', 'city', 'localidade'] },
  { key: 'titulo_eleitor', label: 'Título de Eleitor',  aliases: ['titulo', 'título', 'titulo eleitor', 'titulo de eleitor', 'tituloeleitor', 'inscricao'] },
  { key: 'secao',          label: 'Seção',              aliases: ['secao', 'seção', 'sessao', 'sessão'] },
  { key: 'escola_votacao', label: 'Escola / Local',     aliases: ['escola', 'local de votacao', 'local de votação', 'localvotacao', 'local votacao'] }
];

let importState = { fileName: '', rows: [], headers: [], mapping: {} };

/* ============================================================
   INICIALIZAÇÃO DOS EVENTOS
   ============================================================ */
function initImport() {
  const dropzone  = document.getElementById('dropzone');
  const excelInput = document.getElementById('excel-input');
  if (!dropzone || !excelInput) return;

  dropzone.addEventListener('click', () => excelInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') excelInput.click(); });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
  ['dragleave', 'drop'].forEach(ev =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); })
  );
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length) handleExcelFile(e.dataTransfer.files[0]);
  });
  excelInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleExcelFile(e.target.files[0]);
  });

  document.getElementById('btn-import-cancel')?.addEventListener('click', resetImport);
  document.getElementById('btn-import-confirm')?.addEventListener('click', confirmImport);
}

/* ============================================================
   PROCESSAMENTO DO ARQUIVO
   ============================================================ */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function handleExcelFile(file) {
  const MAX_SIZE_MB = 5;
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    showToast(`Arquivo muito grande. Máximo: ${MAX_SIZE_MB}MB.`, 'error');
    return;
  }

  const fn = file.name.toLowerCase();
  if (!fn.endsWith('.xlsx') && !fn.endsWith('.xls') && !fn.endsWith('.csv')) {
    showToast('Formato inválido. Use .xlsx, .xls ou .csv.', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data     = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      const sheet    = workbook.Sheets[workbook.SheetNames[0]];
      const json     = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

      if (!json.length) { showToast('Planilha vazia.', 'error'); return; }

      const headers = json[0].map(h => String(h || '').trim());
      const rows    = json.slice(1).filter(r => r.some(c => String(c).trim() !== ''));

      if (!headers.length || !rows.length) {
        showToast('Planilha sem dados válidos.', 'error');
        return;
      }

      importState = { fileName: file.name, headers, rows, mapping: {} };

      headers.forEach((h, idx) => {
        const matched = autoMatch(normalize(h));
        if (matched && !Object.values(importState.mapping).includes(matched)) {
          importState.mapping[idx] = matched;
        }
      });

      renderMapping();
      renderPreview();

      document.getElementById('step-mapping').style.display = 'block';
      document.getElementById('step-preview').style.display  = 'block';
      document.getElementById('file-info').innerHTML =
        `<strong>${escapeHtml(file.name)}</strong> — ${headers.length} colunas, ${rows.length} registros`;

    } catch (err) {
      console.error(err);
      showToast('Erro ao ler o arquivo. Verifique o formato.', 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ============================================================
   MAPEAMENTO DE COLUNAS
   ============================================================ */
function renderMapping() {
  const grid = document.getElementById('mapping-grid');
  let html = `
    <div class="head">Coluna do Excel</div>
    <div class="head"></div>
    <div class="head">Campo no Sistema</div>
  `;

  importState.headers.forEach((h, idx) => {
    const matched = importState.mapping[idx] || '';
    html += `
      <div>
        <div class="mapping-target">${escapeHtml(h || `(coluna ${idx + 1})`)}</div>
        <small>${matched
          ? '<span class="badge badge-success">Detectado</span>'
          : '<span class="badge badge-warn">Não detectado</span>'
        }</small>
      </div>
      <div class="mapping-arrow">→</div>
      <div>
        <select data-idx="${idx}" class="mapping-select">
          <option value="">— ignorar —</option>
          ${FIELD_DEFS.map(def =>
            `<option value="${def.key}" ${matched === def.key ? 'selected' : ''}>${def.label}</option>`
          ).join('')}
        </select>
      </div>
    `;
  });

  grid.innerHTML = html;

  grid.querySelectorAll('.mapping-select').forEach(sel => {
    sel.addEventListener('change', (e) => {
      const idx   = parseInt(e.target.dataset.idx);
      const value = e.target.value;

      // Remover mapeamento duplicado em outra coluna
      Object.keys(importState.mapping).forEach(k => {
        if (parseInt(k) !== idx && importState.mapping[k] === value) {
          delete importState.mapping[k];
        }
      });

      if (value) importState.mapping[idx] = value;
      else delete importState.mapping[idx];

      renderMapping();
      renderPreview();
    });
  });
}

/* ============================================================
   PRÉ-VISUALIZAÇÃO
   ============================================================ */
function splitEnderecoNumero(endereco) {
  if (!endereco) return { rua: '', numero: '' };
  const original = String(endereco).trim();

  const semNumero = original.match(/^(.+?)[,\s]+s\/?n\.?$/i);
  if (semNumero) return { rua: semNumero[1].trim().replace(/[,\-\s]+$/, ''), numero: 'S/N' };

  let match = original.match(/^(.+?)[,\-]\s*(?:n[º°ºo]?\.?\s*|n[uú]mero\s*)?(\d+[A-Za-z]?)\b(.*)$/i);
  if (!match) match = original.match(/^(.+?)\s+(?:n[º°ºo]\.?\s*|n[uú]mero\s+)(\d+[A-Za-z]?)\b(.*)$/i);

  if (!match) {
    const todos = [...original.matchAll(/\s(\d+[A-Za-z]?)\b/g)];
    if (todos.length > 0) {
      const ultimo = todos[todos.length - 1];
      const numero = ultimo[1];
      const idx    = ultimo.index;
      const rua    = original.substring(0, idx).trim();
      const resto  = original.substring(idx + ultimo[0].length).trim();
      match = [original, rua, numero, resto];
    }
  }

  if (match) {
    let rua    = match[1].trim().replace(/[,\-\s]+$/, '').trim();
    let numero = match[2].trim();
    const resto = (match[3] || '').trim().replace(/^[,\s\-]+/, '').trim();
    if (resto) numero = numero + ', ' + resto;
    return { rua: rua || original, numero };
  }

  return { rua: original, numero: '' };
}

function parseDate(v) {
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.substring(0, 10);
  const m = v.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y) > 30 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const date = new Date(v);
  if (!isNaN(date.getTime())) return date.toISOString().substring(0, 10);
  return '';
}

function rowToRecord(row) {
  const rec = {
    nome: '', data_nascimento: '', telefone: '', email: '',
    endereco: '', numero: '', bairro: '', cidade: '',
    titulo_eleitor: '', secao: '', escola_votacao: '', foto: null
  };

  const numeroFoiMapeado = Object.values(importState.mapping).includes('numero');

  Object.keys(importState.mapping).forEach(idx => {
    const fk = importState.mapping[idx];
    let v = row[parseInt(idx)];
    if (v == null) v = '';
    v = String(v).trim();
    if (fk === 'data_nascimento' && v) v = parseDate(v);
    rec[fk] = v;
  });

  if (!numeroFoiMapeado && rec.endereco) {
    const split = splitEnderecoNumero(rec.endereco);
    if (split.numero) { rec.endereco = split.rua; rec.numero = split.numero; }
  }

  return rec;
}

function renderPreview() {
  const records      = importState.rows.slice(0, 5).map(rowToRecord);
  const valid        = importState.rows.map(rowToRecord).filter(r => r.nome && r.nome.trim());
  const invalid      = importState.rows.length - valid.length;
  const endMapeado   = Object.values(importState.mapping).includes('endereco');
  const numMapeado   = Object.values(importState.mapping).includes('numero');
  const separacaoAtiva = endMapeado && !numMapeado;
  const comNumero    = separacaoAtiva ? valid.filter(r => r.numero?.trim()).length : 0;

  let avisoSeparacao = '';
  if (separacaoAtiva) {
    avisoSeparacao = `
      <div style="margin-top:0.6rem; padding:0.6rem 0.9rem; background:rgba(201,169,97,0.15); border-left:3px solid var(--gold); font-size:0.83rem;">
        <strong>🪄 Separação automática:</strong> número será extraído do endereço.
        ${comNumero > 0 ? `<strong>${comNumero}</strong> de ${valid.length} registros tiveram o número separado.` : 'Nenhum número detectado.'}
      </div>
    `;
  }

  document.getElementById('preview-info').innerHTML = `
    <span class="badge badge-success">${valid.length} válidos</span>
    ${invalid > 0 ? `<span class="badge badge-warn" style="margin-left:0.5rem">${invalid} ignorados (sem nome)</span>` : ''}
    <span style="margin-left:1rem; color:var(--muted); font-size:0.85rem">Apenas registros com Nome serão importados.</span>
    ${avisoSeparacao}
  `;

  const cols   = ['nome','data_nascimento','telefone','email','endereco','numero','bairro','cidade','titulo_eleitor','secao','escola_votacao'];
  const labels = { nome:'Nome', data_nascimento:'Nasc.', telefone:'Tel.', email:'E-mail', endereco:'Endereço', numero:'Nº', bairro:'Bairro', cidade:'Cidade', titulo_eleitor:'Título', secao:'Seção', escola_votacao:'Local' };
  const used   = new Set(Object.values(importState.mapping));
  const visibleCols = cols.filter(c => used.has(c) || (c === 'numero' && separacaoAtiva));

  let html = '<table><thead><tr>';
  visibleCols.forEach(c => { html += `<th>${labels[c]}${c === 'numero' && separacaoAtiva ? ' <span style="font-weight:400;opacity:0.7;font-size:0.85em;">(extraído)</span>' : ''}</th>`; });
  html += '</tr></thead><tbody>';

  records.forEach(r => {
    html += '<tr>';
    visibleCols.forEach(c => {
      const v = r[c] || '';
      const dest = c === 'numero' && separacaoAtiva && v;
      html += `<td${dest ? ' style="background:rgba(201,169,97,0.12);font-weight:600;"' : ''}>${escapeHtml(v.length > 40 ? v.substring(0, 37) + '...' : v)}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('preview-table').innerHTML = visibleCols.length
    ? html
    : '<div style="padding:1.5rem;color:var(--muted);text-align:center">Mapeie pelo menos uma coluna para visualizar.</div>';
}

/* ============================================================
   CONFIRMAÇÃO E RESET
   ============================================================ */



async function confirmImport() {
  if (!Object.values(importState.mapping).includes('nome')) {
    showToast('É obrigatório mapear a coluna "Nome".', 'error');
    return;
  }

  const records = importState.rows.map(rowToRecord).filter(r => r.nome?.trim());
  if (!records.length) { showToast('Nenhum registro válido para importar.', 'error'); return; }
  if (!confirm(`Confirmar importação de ${records.length} eleitor(es)?`)) return;

  try {
    const count = Eleitores.insertMany(records);
    showToast(`${count} eleitor(es) importado(s) com sucesso.`, 'success');
    resetImport();
    if (typeof switchView === 'function') switchView('list');
  } catch (e) {
    showToast('Erro ao importar: ' + e.message, 'error');
    console.error(e);
  }
}

function resetImport() {
  importState = { fileName: '', rows: [], headers: [], mapping: {} };
  const excelInput = document.getElementById('excel-input');
  if (excelInput) excelInput.value = '';
  ['step-mapping','step-preview'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  ['mapping-grid','preview-table','file-info','preview-info'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

// Expõe para o app.js
window.GEImport = { initImport, resetImport };

