/**
 * Painel Web — Minerador de Leads
 * Controla o minerador pelo navegador
 * Porta: 3000
 */

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const SENHA = "minerador2025"; // Troque para uma senha sua

// Estado do minerador
let processo = null;
let logs = [];
let rodando = false;
let stats = { leads: 0, emails: 0, instagram: 0, inicio: null };

function addLog(msg) {
  const linha = { t: new Date().toLocaleTimeString("pt-BR"), m: msg.trim() };
  logs.push(linha);
  if (logs.length > 500) logs.shift();
}

function iniciarMinerador(config) {
  if (rodando) return;

  // Reescreve configuracoes no minerar.js
  const minerarPath = path.join(__dirname, "minerar.js");
  let code = fs.readFileSync(minerarPath, "utf8");

  code = code.replace(/termo:\s*"[^"]*"/, `termo: "${config.termo}"`);
  code = code.replace(/cidade:\s*"[^"]*"/, `cidade: "${config.cidade}"`);

  if (config.bairros && config.bairros.length > 0) {
    const bairrosStr = config.bairros.map(b => `"${b.trim()}"`).join(", ");
    code = code.replace(/bairros:\s*\[[^\]]*\]/s, `bairros: [${bairrosStr}]`);
  }

  fs.writeFileSync(minerarPath, code);

  rodando = true;
  logs = [];
  stats = { leads: 0, emails: 0, instagram: 0, inicio: new Date().toLocaleString("pt-BR") };
  addLog("Iniciando minerador...");

  processo = spawn("node", ["minerar.js"], { cwd: __dirname });

  processo.stdout.on("data", d => {
    const txt = d.toString();
    txt.split("\n").filter(l => l.trim()).forEach(l => {
      addLog(l);
      const mLeads = l.match(/Total de leads:\s*(\d+)/);
      const mEmail = l.match(/Com email:\s*(\d+)/);
      const mInsta = l.match(/Com Instagram:\s*(\d+)/);
      if (mLeads) stats.leads = parseInt(mLeads[1]);
      if (mEmail) stats.emails = parseInt(mEmail[1]);
      if (mInsta) stats.instagram = parseInt(mInsta[1]);
    });
  });

  processo.stderr.on("data", d => addLog("ERRO: " + d.toString()));

  processo.on("close", code => {
    rodando = false;
    processo = null;
    addLog(`Minerador finalizado (código ${code})`);
  });
}

function pararMinerador() {
  if (processo) {
    processo.kill("SIGTERM");
    rodando = false;
    addLog("Minerador interrompido pelo usuário.");
  }
}

// HTML do painel
function html(autenticado) {
  if (!autenticado) {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Minerador de Leads</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #1e293b; border-radius: 12px; padding: 40px; width: 100%; max-width: 380px; box-shadow: 0 20px 60px rgba(0,0,0,0.5); }
    h1 { color: #f1f5f9; font-size: 22px; margin-bottom: 8px; }
    p { color: #94a3b8; font-size: 14px; margin-bottom: 28px; }
    input { width: 100%; padding: 12px 16px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 15px; margin-bottom: 16px; outline: none; }
    input:focus { border-color: #3b82f6; }
    button { width: 100%; padding: 13px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; }
    button:hover { background: #2563eb; }
    .erro { color: #f87171; font-size: 13px; margin-top: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <h1>⛏️ Minerador de Leads</h1>
    <p>Digite a senha para acessar o painel.</p>
    <form method="POST" action="/login">
      <input type="password" name="senha" placeholder="Senha" autofocus>
      <button type="submit">Entrar</button>
    </form>
    ${logs.length === 0 ? "" : '<p class="erro">Senha incorreta.</p>'}
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Minerador de Leads</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f1f5f9; min-height: 100vh; }
    header { background: #1e293b; padding: 16px 24px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid #334155; }
    header h1 { font-size: 18px; font-weight: 700; }
    .badge { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
    .badge.rodando { background: #dcfce7; color: #16a34a; }
    .badge.parado { background: #f1f5f9; color: #475569; }
    main { max-width: 960px; margin: 0 auto; padding: 24px; display: grid; grid-template-columns: 340px 1fr; gap: 20px; }
    .card { background: #1e293b; border-radius: 12px; padding: 24px; }
    label { display: block; color: #94a3b8; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; margin-top: 16px; }
    label:first-child { margin-top: 0; }
    input, textarea { width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 14px; outline: none; resize: vertical; }
    input:focus, textarea:focus { border-color: #3b82f6; }
    textarea { min-height: 120px; font-family: monospace; }
    .btns { display: flex; gap: 10px; margin-top: 20px; }
    .btn { flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn-start { background: #22c55e; color: #fff; }
    .btn-start:hover { background: #16a34a; }
    .btn-start:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
    .btn-stop { background: #ef4444; color: #fff; }
    .btn-stop:hover { background: #dc2626; }
    .btn-stop:disabled { background: #334155; color: #64748b; cursor: not-allowed; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat { background: #0f172a; border-radius: 8px; padding: 14px; text-align: center; }
    .stat-num { font-size: 28px; font-weight: 700; color: #3b82f6; }
    .stat-label { font-size: 11px; color: #64748b; margin-top: 2px; }
    .log-box { background: #0f172a; border-radius: 8px; padding: 16px; height: 380px; overflow-y: auto; font-family: monospace; font-size: 12px; line-height: 1.6; }
    .log-line { color: #94a3b8; }
    .log-line.ok { color: #4ade80; }
    .log-line.erro { color: #f87171; }
    .log-time { color: #475569; margin-right: 8px; }
    .sheet-link { display: block; text-align: center; margin-top: 14px; color: #3b82f6; font-size: 13px; text-decoration: none; }
    .sheet-link:hover { text-decoration: underline; }
    @media (max-width: 700px) { main { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <span>⛏️</span>
    <h1>Minerador de Leads</h1>
    <span class="badge ${rodando ? "rodando" : "parado"}" id="badge">${rodando ? "● Rodando" : "○ Parado"}</span>
  </header>

  <main>
    <!-- Configuracoes -->
    <div class="card">
      <h2 style="font-size:15px;color:#94a3b8;margin-bottom:16px">CONFIGURAÇÕES</h2>

      <label>Termo de busca</label>
      <input type="text" id="termo" value="clinica estetica">

      <label>Cidade</label>
      <input type="text" id="cidade" value="Curitiba">

      <label>Bairros (um por linha)</label>
      <textarea id="bairros">Centro
Batel
Agua Verde
Bigorrilho
Mercês
Santa Felicidade
Boa Vista
Ahú
Cabral
Hugo Lange
Juvevê
Champagnat
Ecoville
Portão
Fazendinha
Pinheirinho
Sítio Cercado
CIC
Cajuru
Uberaba
Bacacheri
Tingui
Tatuquara
Xaxim
Rebouças</textarea>

      <div class="btns">
        <button class="btn btn-start" id="btnStart" onclick="iniciar()" ${rodando ? "disabled" : ""}>▶ Iniciar</button>
        <button class="btn btn-stop" id="btnStop" onclick="parar()" ${!rodando ? "disabled" : ""}>■ Parar</button>
      </div>

      <a class="sheet-link" href="https://docs.google.com/spreadsheets/d/1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI" target="_blank">
        📊 Abrir Google Sheets →
      </a>
    </div>

    <!-- Logs e stats -->
    <div class="card">
      <div class="stats">
        <div class="stat"><div class="stat-num" id="sLeads">${stats.leads}</div><div class="stat-label">Leads Salvos</div></div>
        <div class="stat"><div class="stat-num" id="sEmail">${stats.emails}</div><div class="stat-label">Com Email</div></div>
        <div class="stat"><div class="stat-num" id="sInsta">${stats.instagram}</div><div class="stat-label">Com Instagram</div></div>
      </div>
      <div class="log-box" id="logBox">
        ${logs.map(l => {
          const cls = l.m.includes("✓") ? "ok" : l.m.includes("ERRO") ? "erro" : "";
          return `<div class="log-line ${cls}"><span class="log-time">${l.t}</span>${escapeHtml(l.m)}</div>`;
        }).join("")}
      </div>
    </div>
  </main>

  <script>
    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    async function iniciar() {
      const termo = document.getElementById('termo').value.trim();
      const cidade = document.getElementById('cidade').value.trim();
      const bairros = document.getElementById('bairros').value.split('\\n').map(b => b.trim()).filter(Boolean);
      if (!termo || !cidade || bairros.length === 0) return alert('Preencha todos os campos.');
      await fetch('/iniciar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ termo, cidade, bairros }) });
    }

    async function parar() {
      await fetch('/parar', { method: 'POST' });
    }

    // Polling a cada 2s
    setInterval(async () => {
      const r = await fetch('/status').then(r => r.json());
      document.getElementById('badge').textContent = r.rodando ? '● Rodando' : '○ Parado';
      document.getElementById('badge').className = 'badge ' + (r.rodando ? 'rodando' : 'parado');
      document.getElementById('btnStart').disabled = r.rodando;
      document.getElementById('btnStop').disabled = !r.rodando;
      document.getElementById('sLeads').textContent = r.stats.leads;
      document.getElementById('sEmail').textContent = r.stats.emails;
      document.getElementById('sInsta').textContent = r.stats.instagram;

      const box = document.getElementById('logBox');
      const noFundo = box.scrollTop + box.clientHeight >= box.scrollHeight - 10;
      box.innerHTML = r.logs.map(l => {
        const cls = l.m.includes('✓') ? 'ok' : l.m.includes('ERRO') ? 'erro' : '';
        return '<div class="log-line ' + cls + '"><span class="log-time">' + l.t + '</span>' + escapeHtml(l.m) + '</div>';
      }).join('');
      if (noFundo) box.scrollTop = box.scrollHeight;
    }, 2000);
  </script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Sessoes simples
const sessoes = new Set();
function gerarToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function getCookie(req, nome) {
  const c = req.headers.cookie || "";
  const m = c.match(new RegExp(`${nome}=([^;]+)`));
  return m ? m[1] : null;
}

// Servidor HTTP
const server = http.createServer((req, res) => {
  const token = getCookie(req, "token");
  const autenticado = sessoes.has(token);
  const url = req.url;
  const method = req.method;

  // Login POST
  if (url === "/login" && method === "POST") {
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const senha = params.get("senha");
      if (senha === SENHA) {
        const t = gerarToken();
        sessoes.add(t);
        res.writeHead(302, { "Set-Cookie": `token=${t}; Path=/; HttpOnly`, "Location": "/" });
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html(false));
      }
    });
    return;
  }

  // Status JSON
  if (url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rodando, logs, stats }));
    return;
  }

  // Iniciar POST (requer auth)
  if (url === "/iniciar" && method === "POST") {
    if (!autenticado) { res.writeHead(401); res.end(); return; }
    let body = "";
    req.on("data", d => body += d);
    req.on("end", () => {
      try {
        const config = JSON.parse(body);
        iniciarMinerador(config);
        res.writeHead(200);
        res.end("ok");
      } catch (_) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // Parar POST (requer auth)
  if (url === "/parar" && method === "POST") {
    if (!autenticado) { res.writeHead(401); res.end(); return; }
    pararMinerador();
    res.writeHead(200);
    res.end("ok");
    return;
  }

  // Painel principal
  if (!autenticado) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html(false));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html(true));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n  Painel rodando em http://0.0.0.0:${PORT}`);
  console.log(`  Senha: ${SENHA}\n`);
});
