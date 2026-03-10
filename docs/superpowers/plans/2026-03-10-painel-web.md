# Painel Web Minerador de Leads - Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar um único arquivo `index.html` hospedado no GitHub Pages que permite disparar o workflow do minerador de leads via GitHub API.

**Architecture:** Um arquivo HTML estático com JavaScript inline que faz POST para a API REST do GitHub usando um PAT armazenado no localStorage do navegador. Sem dependências externas, sem build step, sem servidor.

**Tech Stack:** HTML5, CSS3, JavaScript (Vanilla), GitHub REST API v3, GitHub Pages

---

## Chunk 1: Criar o index.html com formulário e lógica de disparo

### Task 1: Criar index.html

**Files:**
- Create: `index.html` (raiz do repositório)

- [ ] **Step 1: Criar o arquivo `index.html` com estrutura base**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minerador de Leads</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, sans-serif;
      background: #0d1117;
      color: #e6edf3;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      padding: 32px;
      width: 100%;
      max-width: 480px;
    }
    h1 {
      font-size: 20px;
      margin-bottom: 24px;
      color: #58a6ff;
    }
    label {
      display: block;
      font-size: 13px;
      color: #8b949e;
      margin-bottom: 6px;
      margin-top: 16px;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 6px;
      color: #e6edf3;
      font-size: 14px;
      outline: none;
    }
    input:focus { border-color: #58a6ff; }
    button {
      width: 100%;
      margin-top: 24px;
      padding: 12px;
      background: #238636;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #2ea043; }
    button:disabled { background: #21262d; color: #8b949e; cursor: not-allowed; }
    #status {
      margin-top: 16px;
      padding: 12px;
      border-radius: 6px;
      font-size: 14px;
      display: none;
    }
    #status.success { background: #0f2a1a; border: 1px solid #238636; color: #3fb950; }
    #status.error   { background: #2a0f0f; border: 1px solid #da3633; color: #f85149; }
    #status.info    { background: #0a1628; border: 1px solid #1f6feb; color: #58a6ff; }
    a { color: #58a6ff; }
    .divider { border: none; border-top: 1px solid #30363d; margin: 20px 0 4px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Minerador de Leads</h1>

    <label for="pat">GitHub Token (PAT)</label>
    <input type="password" id="pat" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx">

    <hr class="divider">

    <label for="cidade">Cidade</label>
    <input type="text" id="cidade" placeholder="Curitiba" value="Curitiba">

    <label for="termo">Termo de busca</label>
    <input type="text" id="termo" placeholder="clinica estetica" value="clinica estetica">

    <label for="bairros">Bairros (separados por vírgula, opcional)</label>
    <input type="text" id="bairros" placeholder="Centro, Batel, Água Verde">

    <label for="limite">Limite de leads</label>
    <input type="number" id="limite" placeholder="150" value="150" min="1" max="500">

    <button id="btn" onclick="disparar()">Disparar Minerador</button>

    <div id="status"></div>
  </div>

  <script>
    const REPO = 'Naoseicodar/minerador-leads-';
    const WORKFLOW = 'minerador.yml';

    // Carregar PAT salvo
    window.onload = () => {
      const pat = localStorage.getItem('gh_pat');
      if (pat) document.getElementById('pat').value = pat;
    };

    function setStatus(msg, type) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = type;
      el.style.display = 'block';
      if (type === 'success') el.innerHTML = msg; // permite link HTML
    }

    async function disparar() {
      const pat    = document.getElementById('pat').value.trim();
      const cidade = document.getElementById('cidade').value.trim();
      const termo  = document.getElementById('termo').value.trim();
      const bairros = document.getElementById('bairros').value.trim();
      const limite = document.getElementById('limite').value.trim();

      if (!pat)    return setStatus('Informe o GitHub Token (PAT).', 'error');
      if (!cidade) return setStatus('Informe a cidade.', 'error');
      if (!termo)  return setStatus('Informe o termo de busca.', 'error');

      // Salvar PAT no localStorage
      localStorage.setItem('gh_pat', pat);

      const btn = document.getElementById('btn');
      btn.disabled = true;
      setStatus('Disparando workflow...', 'info');

      try {
        const res = await fetch(
          `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${pat}`,
              'Accept': 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              ref: 'master',
              inputs: {
                cidade,
                termo,
                bairros,
                limite_diario: limite
              }
            })
          }
        );

        if (res.status === 204) {
          setStatus(
            `Minerador disparado com sucesso! <a href="https://github.com/${REPO}/actions" target="_blank">Acompanhar execução →</a>`,
            'success'
          );
        } else {
          const body = await res.json().catch(() => ({}));
          setStatus(`Erro ${res.status}: ${body.message || 'Falha ao disparar'}`, 'error');
        }
      } catch (e) {
        setStatus('Erro de rede: ' + e.message, 'error');
      } finally {
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Verificar o arquivo criado**

```bash
cat index.html | head -5
```
Esperado: `<!DOCTYPE html>` na linha 1.

- [ ] **Step 3: Commitar o arquivo**

```bash
cd '/c/Users/Win10/CLAUDE PROJETOS/minerador-leads'
git add index.html docs/
git commit -m "feat: painel web para disparar minerador via GitHub Pages"
git push origin master
```

---

## Chunk 2: Habilitar GitHub Pages

### Task 2: Configurar GitHub Pages no repositório

- [ ] **Step 1: Acessar configurações do repositório**

Abrir no Chrome: `https://github.com/Naoseicodar/minerador-leads-/settings/pages`

- [ ] **Step 2: Configurar a source**

Em **"Build and deployment"**:
- Source: `Deploy from a branch`
- Branch: `master`
- Folder: `/ (root)`
- Clicar em **Save**

- [ ] **Step 3: Aguardar o deploy (1-2 minutos) e verificar**

Acessar: `https://naoseicodar.github.io/minerador-leads-/`

Esperado: Painel web com fundo escuro, campos de formulário e botão verde "Disparar Minerador".

---

## Chunk 3: Criar GitHub PAT com permissão workflow

### Task 3: Gerar o Personal Access Token

- [ ] **Step 1: Acessar criação de tokens**

Abrir: `https://github.com/settings/tokens/new`

- [ ] **Step 2: Configurar o token**

- Note: `Painel Minerador`
- Expiration: `90 days` (ou `No expiration` para uso contínuo)
- Marcar permissão: `workflow` (em "repo" group)
- Clicar **Generate token**
- Copiar o token gerado (`ghp_...`)

- [ ] **Step 3: Testar no painel**

- Acessar `https://naoseicodar.github.io/minerador-leads-/`
- Colar o PAT no campo "GitHub Token"
- Preencher cidade e termo
- Clicar "Disparar Minerador"
- Esperado: mensagem verde "Minerador disparado com sucesso!" com link para Actions

- [ ] **Step 4: Verificar execução no Actions**

Acessar: `https://github.com/Naoseicodar/minerador-leads-/actions`
Esperado: workflow rodando com os parâmetros informados no painel.
