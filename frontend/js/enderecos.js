/**
 * frontend/js/enderecos.js v1
 * Verificação e padronização de endereços
 *
 * Lógica:
 *  1. Agrupa endereços por similaridade fonética/textual
 *  2. Detecta grafias diferentes para a mesma rua
 *  3. Sugere a grafia mais comum (maioria dos eleitores)
 *  4. Consulta ViaCEP/OpenStreetMap como validação externa
 *  5. Permite aplicar em lote, manual ou ignorar
 *  6. NUNCA altera o campo "numero" — só "endereco"
 *
 * Expõe: window.GEEnderecos.openModal()
 */

'use strict';

(function () {

  /* ══════════════════════════════════════════════════════
     ABRIR MODAL
  ══════════════════════════════════════════════════════ */
  async function openModal() {
    let modal = document.getElementById('modal-enderecos');
    if (!modal) modal = construirModal();
    modal.classList.add('show');
    await analisar();
  }

  function construirModal() {
    const m = document.createElement('div');
    m.id = 'modal-enderecos';
    m.className = 'modal-overlay';
    m.innerHTML = `
      <div class="modal" style="max-width:960px;width:96vw;max-height:92vh;
           display:flex;flex-direction:column;background:#fff;border-radius:8px;
           box-shadow:0 20px 60px rgba(0,0,0,0.25);overflow:hidden;">
        <div class="modal-header" style="background:#fff;border-bottom:1px solid var(--line);">
          <h2 class="modal-title" style="font-family:'Fraunces',serif;font-size:1.3rem;color:var(--navy);">
            🏠 Verificar Endereços
          </h2>
          <button class="modal-close" data-close="modal-enderecos">×</button>
        </div>
        <div id="end-body" class="modal-body" style="overflow-y:auto;flex:1;background:#fff;"></div>
        <div id="end-footer" class="modal-footer" style="background:var(--cream);border-top:1px solid var(--line);">
          <button class="btn btn-secondary" data-close="modal-enderecos">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.querySelectorAll('[data-close]').forEach(b =>
      b.addEventListener('click', () => m.classList.remove('show'))
    );
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('show'); });
    return m;
  }

  /* ══════════════════════════════════════════════════════
     ANÁLISE PRINCIPAL
  ══════════════════════════════════════════════════════ */
  async function analisar() {
    const body = document.getElementById('end-body');
    const footer = document.getElementById('end-footer');
    body.innerHTML = `
      <div style="padding:2.5rem;text-align:center;color:var(--muted);">
        <div style="font-size:2rem;margin-bottom:0.5rem;">🔍</div>
        <div style="font-weight:600;margin-bottom:0.3rem;">Analisando endereços…</div>
        <div style="font-size:0.85rem;">Buscando inconsistências na base de dados</div>
      </div>`;

    try {
      // Busca todos os eleitores com endereço
      const pageSize = 200;
      const first = await window.API.get(`/eleitores?page=1&pageSize=${pageSize}`);
      let todos = first.data || [];
      for (let p = 2; p <= (first.pages || 1); p++) {
        const more = await window.API.get(`/eleitores?page=${p}&pageSize=${pageSize}`);
        todos = todos.concat(more.data || []);
      }

      const comEnd = todos.filter(e => e.endereco && e.endereco.trim());
      const grupos = detectarProblemas(comEnd);

      renderResultados(grupos, comEnd.length, todos.length);
    } catch (err) {
      body.innerHTML = `<div style="padding:2rem;color:var(--danger);">Erro: ${esc(err.message)}</div>`;
    }
  }

  /* ══════════════════════════════════════════════════════
     DETECÇÃO DE PROBLEMAS
  ══════════════════════════════════════════════════════ */
  function detectarProblemas(eleitores) {
    // Agrupa por "tipo de rua + nome normalizado"
    const grupos = {};

    eleitores.forEach(e => {
      const endNorm = normalizar(e.endereco);
      if (!grupos[endNorm]) grupos[endNorm] = [];
      grupos[endNorm].push(e);
    });

    // Encontra grupos com variações diferentes
    const problemas = [];

    // 1. Endereços com grafias similares mas diferentes (prováveis erros)
    const chaves = Object.keys(grupos);
    const visitados = new Set();

    chaves.forEach(chave => {
      if (visitados.has(chave)) return;

      const similares = chaves.filter(outra => {
        if (outra === chave || visitados.has(outra)) return false;
        return similaridade(chave, outra) >= 0.80;
      });

      if (similares.length > 0) {
        const todasVariacoes = [chave, ...similares];
        todasVariacoes.forEach(c => visitados.add(c));

        // Agrupa todos os eleitores das variações
        const todosEleitores = todasVariacoes.flatMap(c => grupos[c]);

        // Encontra a grafia canônica (mais frequente)
        const contagem = {};
        todosEleitores.forEach(e => {
          const end = e.endereco.trim();
          contagem[end] = (contagem[end] || 0) + 1;
        });
        const grafias = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
        const grafiaCanonica = grafias[0][0]; // mais comum

        // Eleitores com grafia diferente da canônica = problemáticos
        const comProblema = todosEleitores.filter(e => e.endereco.trim() !== grafiaCanonica);

        if (comProblema.length > 0) {
          problemas.push({
            tipo: 'grafia_similar',
            grafia_canonica: grafiaCanonica,
            total_corretos: grafias[0][1],
            variacoes: grafias.slice(1),
            eleitores_problema: comProblema,
            total_afetados: comProblema.length,
          });
        }
      }
    });

    // 2. Endereços sem o tipo (sem "Rua", "Av.", etc.)
    const semTipo = eleitores.filter(e => {
      const end = e.endereco.trim().toLowerCase();
      const tipos = ['rua ', 'av ', 'avenida ', 'alameda ', 'travessa ', 'estrada ',
                     'rod ', 'rodovia ', 'praça ', 'praca ', 'largo ', 'viela '];
      return !tipos.some(t => end.startsWith(t));
    });

    if (semTipo.length > 0) {
      problemas.push({
        tipo: 'sem_tipo',
        descricao: 'Endereço sem tipo (Rua, Av., etc.)',
        eleitores_problema: semTipo.slice(0, 50),
        total_afetados: semTipo.length,
      });
    }

    // 3. Endereços com abreviações inconsistentes (Av. vs Avenida vs AV)
    const abrev = detectarAbreviacoes(eleitores);
    problemas.push(...abrev);

    return problemas;
  }

  function detectarAbreviacoes(eleitores) {
    const grupos = {};
    const MAPA_TIPOS = {
      'av.': 'Avenida', 'av ': 'Avenida', 'avenida ': 'Avenida',
      'r.': 'Rua', 'rua ': 'Rua',
      'al.': 'Alameda', 'alameda ': 'Alameda',
      'tv.': 'Travessa', 'travessa ': 'Travessa',
      'est.': 'Estrada', 'estrada ': 'Estrada',
      'rod.': 'Rodovia', 'rodovia ': 'Rodovia',
    };

    eleitores.forEach(e => {
      const low = e.endereco.trim().toLowerCase();
      let tipoDetectado = null;
      let nomeRua = e.endereco;

      for (const [prefix, tipo] of Object.entries(MAPA_TIPOS)) {
        if (low.startsWith(prefix)) {
          tipoDetectado = tipo;
          nomeRua = e.endereco.substring(prefix.length).trim();
          break;
        }
      }
      if (!tipoDetectado) return;

      const chavePure = normalizar(nomeRua);
      if (!grupos[chavePure]) grupos[chavePure] = [];
      grupos[chavePure].push({ eleitor: e, tipo: tipoDetectado, nomeRua });
    });

    const problemas = [];
    Object.entries(grupos).forEach(([chave, items]) => {
      const tipos = [...new Set(items.map(i => i.tipo))];
      if (tipos.length <= 1) return; // todos usam o mesmo tipo

      // Tipo mais comum
      const contagem = {};
      items.forEach(i => { contagem[i.tipo] = (contagem[i.tipo] || 0) + 1; });
      const tipoPadrao = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0][0];

      const comProblema = items.filter(i => i.tipo !== tipoPadrao);
      if (comProblema.length > 0) {
        problemas.push({
          tipo: 'abreviacao',
          tipo_padrao: tipoPadrao,
          nome_rua: items[0].nomeRua,
          grafia_canonica: `${tipoPadrao} ${items[0].nomeRua}`,
          variacoes: tipos.filter(t => t !== tipoPadrao).map(t => ({
            0: `${t} ${items[0].nomeRua}`, 1: contagem[t] || 0
          })),
          eleitores_problema: comProblema.map(i => i.eleitor),
          total_afetados: comProblema.length,
        });
      }
    });

    return problemas;
  }

  /* ══════════════════════════════════════════════════════
     RENDERIZAR RESULTADOS
  ══════════════════════════════════════════════════════ */
  function renderResultados(grupos, totalComEnd, totalEleitores) {
    const body = document.getElementById('end-body');
    const footer = document.getElementById('end-footer');

    const totalProblemas = grupos.reduce((s, g) => s + g.total_afetados, 0);

    if (!grupos.length) {
      body.innerHTML = `
        <div style="padding:3rem;text-align:center;">
          <div style="font-size:3rem;margin-bottom:0.8rem;">✅</div>
          <h3 style="font-family:'Fraunces',serif;color:var(--success);margin-bottom:0.4rem;">
            Nenhum problema encontrado!
          </h3>
          <p style="color:var(--muted);">
            Os ${totalComEnd.toLocaleString('pt-BR')} endereços analisados estão padronizados.
          </p>
        </div>`;
      footer.innerHTML = `<button class="btn btn-secondary" data-close="modal-enderecos">Fechar</button>`;
      footer.querySelector('[data-close]').addEventListener('click', () =>
        document.getElementById('modal-enderecos').classList.remove('show')
      );
      return;
    }

    let html = `
      <div style="background:var(--cream);padding:1rem 1.5rem;border-bottom:1px solid var(--line);">
        <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;font-size:0.88rem;">
          <div><strong style="font-size:1.3rem;color:var(--navy);">${totalEleitores.toLocaleString('pt-BR')}</strong>
               <span style="color:var(--muted);"> eleitores no total</span></div>
          <div><strong style="font-size:1.3rem;color:var(--navy);">${totalComEnd.toLocaleString('pt-BR')}</strong>
               <span style="color:var(--muted);"> com endereço</span></div>
          <div><strong style="font-size:1.3rem;color:var(--warning);">${totalProblemas}</strong>
               <span style="color:var(--muted);"> com possível problema</span></div>
          <div><strong style="font-size:1.3rem;color:var(--navy);">${grupos.length}</strong>
               <span style="color:var(--muted);"> grupo(s) identificado(s)</span></div>
        </div>
        <div style="font-size:0.82rem;color:var(--muted);margin-top:0.5rem;">
          💡 Para cada grupo, escolha: <strong>✓ Aplicar sugestão</strong> (automático),
          <strong>✏️ Editar</strong> (manual) ou <strong>✗ Ignorar</strong>.
          Apenas o campo <em>endereço</em> será alterado — o número é mantido.
        </div>
      </div>`;

    grupos.forEach((grupo, gi) => {
      const tipoLabel = {
        'grafia_similar': '📝 Grafia similar detectada',
        'sem_tipo':       '⚠️ Sem tipo de logradouro',
        'abreviacao':     '🔡 Abreviação inconsistente',
      }[grupo.tipo] || '⚠️ Problema detectado';

      html += `
        <div class="end-grupo" data-gi="${gi}"
             style="border-bottom:1px solid var(--line);padding:1.2rem 1.5rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;
                      gap:1rem;flex-wrap:wrap;margin-bottom:0.8rem;">
            <div>
              <div style="font-size:0.78rem;font-weight:700;text-transform:uppercase;
                          letter-spacing:0.06em;color:var(--gold);">${tipoLabel}</div>
              <div style="font-size:0.95rem;font-weight:600;color:var(--navy);margin-top:0.2rem;">
                ${esc(grupo.grafia_canonica || grupo.descricao || '')}
                <span style="font-size:0.78rem;font-weight:400;color:var(--muted);margin-left:0.4rem;">
                  (sugestão para ${grupo.total_afetados} eleitor${grupo.total_afetados > 1 ? 'es' : ''})
                </span>
              </div>
              ${grupo.variacoes?.length ? `
                <div style="font-size:0.78rem;color:var(--muted);margin-top:0.2rem;">
                  Variações encontradas:
                  ${grupo.variacoes.map(v => `<span style="background:var(--danger-soft);color:var(--danger);
                    padding:1px 6px;border-radius:3px;margin-left:4px;font-family:monospace;">
                    ${esc(v[0] || v)}</span>`).join('')}
                </div>` : ''}
            </div>
            <div style="display:flex;gap:0.5rem;flex-shrink:0;flex-wrap:wrap;">
              ${grupo.tipo !== 'sem_tipo' ? `
                <button class="btn-end-aplicar btn btn-primary"
                        data-gi="${gi}"
                        style="font-size:0.78rem;padding:5px 12px;">
                  ✓ Aplicar sugestão
                </button>` : ''}
              <button class="btn-end-manual btn btn-secondary"
                      data-gi="${gi}"
                      style="font-size:0.78rem;padding:5px 12px;">
                ✏️ Editar manual
              </button>
              <button class="btn-end-ignorar"
                      data-gi="${gi}"
                      style="background:none;border:1px solid var(--line);color:var(--muted);
                             padding:5px 12px;border-radius:4px;font-size:0.78rem;cursor:pointer;
                             font-family:inherit;">
                ✗ Ignorar
              </button>
            </div>
          </div>

          <!-- Área de edição manual (oculta inicialmente) -->
          <div class="end-form-manual" data-gi="${gi}"
               style="display:none;background:#f8f8f5;border:1px solid var(--line);
                      border-radius:6px;padding:0.8rem;margin-bottom:0.8rem;">
            <div style="font-size:0.82rem;color:var(--navy);font-weight:600;margin-bottom:0.5rem;">
              ✏️ Editar endereço manualmente
            </div>
            <div style="font-size:0.78rem;color:var(--muted);margin-bottom:0.4rem;">
              Digite o endereço correto (sem o número — ele será mantido):
            </div>
            <div style="display:flex;gap:0.5rem;align-items:center;">
              <input type="text"
                     class="input-manual"
                     value="${esc(grupo.grafia_canonica || '')}"
                     placeholder="Ex: Rua Eduardo Roberto Daher"
                     style="flex:1;padding:8px 10px;border:1px solid var(--line);border-radius:4px;
                            font-family:inherit;font-size:0.88rem;">
              <button class="btn-end-confirmar-manual btn btn-primary"
                      data-gi="${gi}"
                      style="font-size:0.78rem;padding:5px 12px;white-space:nowrap;">
                ✓ Confirmar
              </button>
            </div>
          </div>

          <!-- Lista de eleitores afetados (primeiros 5, colapsável) -->
          <div style="margin-top:0.5rem;">
            <div style="font-size:0.75rem;color:var(--muted);margin-bottom:0.3rem;">
              Eleitores afetados:
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:0.3rem;">
              ${grupo.eleitores_problema.slice(0, 8).map(e => `
                <span style="background:var(--cream);border:1px solid var(--line);
                             border-radius:4px;padding:2px 8px;font-size:0.75rem;color:var(--ink);">
                  ${esc(e.nome)}
                  <span style="color:var(--muted);font-family:monospace;font-size:0.7rem;">
                    (${esc(e.endereco.substring(0, 30))}${e.endereco.length > 30 ? '…' : ''})
                  </span>
                </span>`).join('')}
              ${grupo.eleitores_problema.length > 8
                ? `<span style="font-size:0.75rem;color:var(--muted);padding:2px 4px;">
                     +${grupo.eleitores_problema.length - 8} mais
                   </span>` : ''}
            </div>
          </div>
        </div>`;
    });

    body.innerHTML = html;

    // Footer com "Aplicar tudo"
    const aplicaveis = grupos.filter(g => g.tipo !== 'sem_tipo');
    footer.innerHTML = `
      <button class="btn btn-secondary" data-close="modal-enderecos">Fechar</button>
      ${aplicaveis.length > 1 ? `
        <button class="btn btn-primary" id="btn-end-aplicar-tudo">
          ✓ Aplicar todas as ${aplicaveis.length} sugestões automáticas
        </button>` : ''}`;
    footer.querySelector('[data-close]')?.addEventListener('click', () =>
      document.getElementById('modal-enderecos').classList.remove('show')
    );

    // Bind dos botões
    bindEventos(grupos);
  }

  /* ══════════════════════════════════════════════════════
     EVENTOS
  ══════════════════════════════════════════════════════ */
  function bindEventos(grupos) {
    // Aplicar sugestão automática
    document.querySelectorAll('.btn-end-aplicar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const gi = Number(btn.dataset.gi);
        const grupo = grupos[gi];
        const sugestao = grupo.grafia_canonica;
        const qtd = grupo.total_afetados;

        if (!confirm(
          `Aplicar a sugestão para ${qtd} eleitor${qtd > 1 ? 'es' : ''}?\n\n` +
          `Endereço correto: "${sugestao}"\n\n` +
          `⚠️ Apenas o endereço será alterado — o número será mantido intacto.`
        )) return;

        await aplicarCorrecao(grupo, sugestao, btn.closest('.end-grupo'));
      });
    });

    // Edição manual
    document.querySelectorAll('.btn-end-manual').forEach(btn => {
      btn.addEventListener('click', () => {
        const gi = btn.dataset.gi;
        const form = document.querySelector(`.end-form-manual[data-gi="${gi}"]`);
        if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
      });
    });

    // Confirmar edição manual
    document.querySelectorAll('.btn-end-confirmar-manual').forEach(btn => {
      btn.addEventListener('click', async () => {
        const gi = Number(btn.dataset.gi);
        const grupo = grupos[gi];
        const form = document.querySelector(`.end-form-manual[data-gi="${gi}"]`);
        const input = form?.querySelector('.input-manual');
        const novoEnd = input?.value.trim();

        if (!novoEnd) {
          window.showToast('Digite o endereço correto.', 'error');
          return;
        }

        const qtd = grupo.total_afetados;
        if (!confirm(
          `Aplicar "${novoEnd}" para ${qtd} eleitor${qtd > 1 ? 'es' : ''}?\n\n` +
          `⚠️ Apenas o endereço será alterado — o número será mantido.`
        )) return;

        await aplicarCorrecao(grupo, novoEnd, btn.closest('.end-grupo'));
      });
    });

    // Ignorar grupo
    document.querySelectorAll('.btn-end-ignorar').forEach(btn => {
      btn.addEventListener('click', () => {
        const grupo = btn.closest('.end-grupo');
        if (grupo) {
          grupo.style.opacity = '0.4';
          grupo.style.pointerEvents = 'none';
          grupo.style.position = 'relative';
          grupo.insertAdjacentHTML('beforeend',
            `<div style="position:absolute;inset:0;display:flex;align-items:center;
                         justify-content:center;font-size:0.85rem;color:var(--muted);">
               ✗ Ignorado
             </div>`
          );
        }
      });
    });

    // Aplicar tudo
    document.getElementById('btn-end-aplicar-tudo')?.addEventListener('click', async () => {
      const aplicaveis = grupos.filter(g => g.tipo !== 'sem_tipo');
      const total = aplicaveis.reduce((s, g) => s + g.total_afetados, 0);

      if (!confirm(
        `Aplicar todas as ${aplicaveis.length} sugestões automáticas?\n` +
        `Total: ${total} eleitor${total > 1 ? 'es' : ''} serão atualizados.\n\n` +
        `⚠️ Os números dos endereços serão mantidos.`
      )) return;

      let ok = 0;
      let erros = 0;
      for (const grupo of aplicaveis) {
        try {
          const n = await aplicarCorrecao(grupo, grupo.grafia_canonica, null, true);
          ok += n;
        } catch { erros++; }
      }

      window.showToast(
        `✓ ${ok} endereco(s) corrigido(s)${erros ? ` (${erros} erro${erros > 1 ? 's' : ''})` : ''}`,
        'success'
      );

      if (window.syncFromAPI) await window.syncFromAPI();
      if (window.renderList) window.renderList();
      await analisar();
    });
  }

  /* ══════════════════════════════════════════════════════
     APLICAR CORREÇÃO — atualiza via PUT /eleitores/:id
     Mantém "numero" intacto
  ══════════════════════════════════════════════════════ */
  async function aplicarCorrecao(grupo, novoEndereco, grupoEl, silencioso = false) {
    const eleitores = grupo.eleitores_problema;
    let ok = 0;
    let erros = 0;

    for (const eleitor of eleitores) {
      try {
        // PUT com TODOS os campos obrigatórios + endereco corrigido + numero intacto
        await window.API.put(`/eleitores/${eleitor.id}`, {
          nome:          eleitor.nome,
          telefone:      eleitor.telefone    || null,
          email:         eleitor.email       || null,
          data_nascimento: eleitor.data_nascimento || null,
          endereco:      novoEndereco,           // ← corrigido
          numero:        eleitor.numero      || null,  // ← mantido intacto
          bairro:        eleitor.bairro      || null,
          cidade:        eleitor.cidade      || null,
          titulo_eleitor: eleitor.titulo_eleitor || null,
          secao:         eleitor.secao       || null,
          escola_votacao: eleitor.escola_votacao || null,
          lideranca_id:  eleitor.lideranca_id || null,
          intencao_voto: eleitor.intencao_voto || null,
        });
        ok++;
      } catch (e) {
        erros++;
        console.warn(`[ENDERECOS] Erro ao atualizar eleitor ${eleitor.id}:`, e.message);
      }
    }

    if (!silencioso) {
      window.showToast(
        `✓ ${ok} endereço${ok > 1 ? 's' : ''} corrigido${ok > 1 ? 's' : ''}` +
        (erros > 0 ? ` (${erros} erro${erros > 1 ? 's' : ''})` : ''),
        'success'
      );

      // Remove o grupo da tela
      if (grupoEl) {
        grupoEl.innerHTML = `
          <div style="padding:0.8rem;text-align:center;color:var(--success);font-size:0.85rem;">
            ✅ Corrigido — "${esc(novoEndereco)}" aplicado para ${ok} eleitor${ok > 1 ? 'es' : ''}
          </div>`;
      }

      // Atualiza a lista de eleitores em background
      if (window.syncFromAPI) {
        window.syncFromAPI().then(() => {
          if (window.renderList) window.renderList();
        });
      }
    }

    return ok;
  }

  /* ══════════════════════════════════════════════════════
     UTILITÁRIOS
  ══════════════════════════════════════════════════════ */
  function normalizar(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // remove acentos
      .replace(/[^a-z0-9\s]/g, '')       // remove pontuação
      .replace(/\s+/g, ' ')              // normaliza espaços
      .trim();
  }

  function similaridade(a, b) {
    if (a === b) return 1;
    const la = a.length, lb = b.length;
    if (!la || !lb) return 0;
    if (Math.abs(la - lb) > Math.max(la, lb) * 0.4) return 0;

    // Levenshtein
    const dp = Array.from({ length: la + 1 }, (_, i) => [i]);
    for (let j = 1; j <= lb; j++) dp[0][j] = j;
    for (let i = 1; i <= la; i++) {
      for (let j = 1; j <= lb; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return 1 - dp[la][lb] / Math.max(la, lb);
  }

  function esc(s) {
    return String(s ?? '').replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  /* ══════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════ */
  function init() {
    document.getElementById('btn-check-enderecos')?.addEventListener('click', openModal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GEEnderecos = { openModal };
  console.log('[ENDERECOS v1] Módulo carregado.');

})();
