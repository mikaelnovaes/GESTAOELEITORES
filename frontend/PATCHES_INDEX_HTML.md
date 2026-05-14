# 📝 Patches do index.html

O `index.html` original tem mais de 600 linhas. Aplique APENAS estas alterações pontuais.

---

## ✏️ Patch 1 — Adicionar botão "Excluir TODOS" na barra de ações da lista

**Localize esta linha** (header da view `view-list`):
```html
<button class="btn btn-secondary" id="btn-check-duplicates" title="Verificar registros duplicados...">
```

**Logo ANTES dela**, adicione:

```html
<button class="btn admin-only" id="btn-purge-all"
        style="display:none;background:var(--danger);color:white;border:1px solid var(--danger);"
        title="Excluir TODOS os eleitores do sistema (irreversível)">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
  </svg>
  Excluir Todos
</button>
```

---

## ✏️ Patch 2 — Simplificar a view de Aniversários

**Substitua TODO o bloco `<section id="view-birthday">...</section>`** por:

```html
<section id="view-birthday" class="view" aria-label="Robô de Aniversários">
  <div class="panel">
    <div class="panel-header">
      <div>
        <div class="panel-subtitle">Robôs de IA</div>
        <div class="panel-title">Robô de Aniversários</div>
      </div>
    </div>
    <!-- O conteúdo será preenchido por robots.js → openBirthday() -->
    <div id="birthday-content" style="padding:1.8rem 2rem;"></div>
  </div>
</section>
```

---

## ✏️ Patch 3 — Simplificar a view de Reativação

**Substitua TODO o bloco `<section id="view-reactivation">...</section>`** por:

```html
<section id="view-reactivation" class="view" aria-label="Robô de Reativação">
  <div class="panel">
    <div class="panel-header">
      <div>
        <div class="panel-subtitle">Robôs de IA</div>
        <div class="panel-title">Robô de Reativação</div>
      </div>
    </div>
    <!-- O conteúdo será preenchido por robots.js → openReactivation() -->
    <div id="reactivation-content" style="padding:1.8rem 2rem;"></div>
  </div>
</section>
```

> **Importante**: isso remove os `onclick="..."` inline que existiam nos toggles. A nova UI dos robôs (criada por `robots.js`) tem controles próprios que falam direto com a API, e por isso resolvem os pontos 8 e 9 (campos não habilitavam).

---

## ✏️ Patch 4 — Bumpar versão dos scripts (forçar cache miss no navegador)

**Localize** os 6 scripts no final do `index.html`:
```html
<script src="js/security.js?v=4"></script>
<script src="js/data.js?v=4"></script>
<script src="js/whatsapp.js?v=4"></script>
<script src="js/robots.js?v=4"></script>
<script src="js/import.js?v=4"></script>
<script src="js/app.js?v=4"></script>
```

**Substitua TODOS os `?v=4` por `?v=5`**:
```html
<script src="js/security.js?v=5"></script>
<script src="js/data.js?v=5"></script>
<script src="js/whatsapp.js?v=5"></script>
<script src="js/robots.js?v=5"></script>
<script src="js/import.js?v=5"></script>
<script src="js/app.js?v=5"></script>
```

---

Pronto. O restante do HTML pode permanecer como está.
