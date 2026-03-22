/**
 * ZapChat Dashboard — http://localhost:3030
 * node dashboard.js
 */

require("dotenv").config();
const express = require("express");
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json());

const STATUS_FILE  = path.join(__dirname, "status.json");
const CONTROL_FILE = path.join(__dirname, "control.json");
const ENV_FILE     = path.join(__dirname, ".env");

// ── API endpoints ──────────────────────────────────────────────────────────

app.get(["/zapchat/status", "/status"], (req, res) => {
  try {
    if (!fs.existsSync(STATUS_FILE)) return res.json({ status_bot: "offline" });
    res.json(JSON.parse(fs.readFileSync(STATUS_FILE)));
  } catch {
    res.json({ status_bot: "offline" });
  }
});

app.post(["/zapchat/control", "/control"], (req, res) => {
  const { acao } = req.body; // pausar | retomar | parar
  const ctrl = { pausado: false, parado: false };
  if (acao === "pausar")  ctrl.pausado = true;
  if (acao === "parar")   ctrl.parado  = true;
  fs.writeFileSync(CONTROL_FILE, JSON.stringify(ctrl, null, 2));
  res.json({ ok: true, acao });
});

app.post(["/zapchat/limite", "/limite"], (req, res) => {
  const limite = Number(req.body.limite);
  if (!limite || limite < 1 || limite > 500) return res.status(400).json({ erro: "Inválido" });
  let env = fs.readFileSync(ENV_FILE, "utf-8");
  env = env.replace(/LIMITE_ZAP=\d+/, `LIMITE_ZAP=${limite}`);
  fs.writeFileSync(ENV_FILE, env);
  if (fs.existsSync(STATUS_FILE)) {
    const d = JSON.parse(fs.readFileSync(STATUS_FILE));
    d.limite = limite;
    fs.writeFileSync(STATUS_FILE, JSON.stringify(d, null, 2));
  }
  res.json({ ok: true, limite });
});

// ── Dashboard HTML ─────────────────────────────────────────────────────────

app.get(["/zapchat", "/"], (req, res) => res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZapChat Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#080c14;--surface:#0f1623;--surface2:#161d2e;--border:#1e2a3d;
  --green:#25d366;--blue:#3b82f6;--amber:#f59e0b;--purple:#a78bfa;
  --red:#ef4444;--muted:#4b5a72;--text:#e2e8f0;--text2:#94a3b8;
}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}

/* HEADER */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.logo{font-size:1.2rem;font-weight:800;color:var(--green);letter-spacing:-0.5px}
.logo span{color:var(--text2);font-weight:400}
.status-pill{padding:3px 12px;border-radius:999px;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
.pill-rodando  {background:#052e16;color:#4ade80;border:1px solid #166534}
.pill-pausado  {background:#451a03;color:#fbbf24;border:1px solid #92400e}
.pill-parado   {background:#450a0a;color:#f87171;border:1px solid #991b1b}
.pill-concluido{background:#1e1b4b;color:#a5b4fc;border:1px solid #4338ca}
.pill-offline  {background:#1c1c1c;color:var(--muted);border:1px solid #333}
.pill-iniciando{background:#0c1a2e;color:#60a5fa;border:1px solid #1e40af}
.timer{margin-left:auto;font-size:.8rem;color:var(--text2);font-variant-numeric:tabular-nums}
.controls{display:flex;gap:8px;margin-left:8px}
.btn{padding:7px 16px;border:none;border-radius:8px;font-size:.8rem;font-weight:700;cursor:pointer;transition:.15s}
.btn-pause {background:#451a03;color:#fbbf24;border:1px solid #92400e}
.btn-resume{background:#052e16;color:#4ade80;border:1px solid #166534}
.btn-stop  {background:#450a0a;color:#f87171;border:1px solid #991b1b}
.btn:hover{filter:brightness(1.2)}
.btn:disabled{opacity:.4;cursor:default}

/* MAIN */
.main{padding:20px 24px;display:flex;flex-direction:column;gap:18px;max-width:1400px;margin:0 auto}

/* CARDS */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 16px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;inset:0;opacity:.05;border-radius:14px}
.c-env::before{background:var(--blue)}
.c-resp::before{background:var(--amber)}
.c-int::before{background:var(--purple)}
.c-fech::before{background:var(--green)}
.c-sem::before{background:var(--red)}
.c-taxa::before{background:#06b6d4}
.card-num{font-size:2.2rem;font-weight:800;line-height:1}
.card-label{font-size:.7rem;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-top:6px}
.card-sub{font-size:.72rem;color:var(--muted);margin-top:3px}
.c-env  .card-num{color:var(--blue)}
.c-resp .card-num{color:var(--amber)}
.c-int  .card-num{color:var(--purple)}
.c-fech .card-num{color:var(--green)}
.c-sem  .card-num{color:var(--red)}
.c-taxa .card-num{color:#22d3ee}

/* PROGRESS */
.prog-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
.prog-header{display:flex;justify-content:space-between;font-size:.8rem;color:var(--text2);margin-bottom:10px}
.prog-bar{background:var(--surface2);border-radius:999px;height:12px;overflow:hidden}
.prog-fill{height:100%;background:linear-gradient(90deg,var(--green),var(--blue));border-radius:999px;transition:width .6s ease}

/* TWO COLS */
.row2{display:grid;grid-template-columns:1fr 340px;gap:14px}
@media(max-width:900px){.row2{grid-template-columns:1fr}}

/* FUNNEL */
.funnel-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
.funnel-title{font-size:.85rem;font-weight:700;color:var(--text2);margin-bottom:16px;text-transform:uppercase;letter-spacing:.05em}
.funnel{display:flex;flex-direction:column;gap:8px}
.funnel-step{display:flex;align-items:center;gap:12px}
.funnel-bar-wrap{flex:1;background:var(--surface2);border-radius:999px;height:28px;overflow:hidden;position:relative}
.funnel-bar{height:100%;border-radius:999px;transition:width .6s ease;display:flex;align-items:center;padding:0 10px}
.funnel-bar-label{font-size:.72rem;font-weight:700;color:#fff;white-space:nowrap}
.funnel-info{min-width:110px;text-align:right}
.funnel-num{font-size:1.1rem;font-weight:800}
.funnel-pct{font-size:.7rem;color:var(--muted)}
.f-env  .funnel-bar{background:var(--blue)}
.f-resp .funnel-bar{background:var(--amber)}
.f-int  .funnel-bar{background:var(--purple)}
.f-fech .funnel-bar{background:var(--green)}
.f-env  .funnel-num{color:var(--blue)}
.f-resp .funnel-num{color:var(--amber)}
.f-int  .funnel-num{color:var(--purple)}
.f-fech .funnel-num{color:var(--green)}
.funnel-step-label{font-size:.75rem;color:var(--text2);min-width:80px}

/* SETTINGS */
.settings-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:14px}
.settings-title{font-size:.85rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em}
.field label{font-size:.75rem;color:var(--text2);display:block;margin-bottom:6px}
.field input{width:100%;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:9px 12px;font-size:.9rem}
.field input:focus{outline:none;border-color:var(--green)}
.save-btn{width:100%;background:var(--green);color:#000;border:none;border-radius:8px;padding:10px;font-weight:800;font-size:.85rem;cursor:pointer}
.save-btn:hover{background:#1db954}
.toast{font-size:.75rem;color:var(--green);text-align:center;min-height:18px}

/* LEADS TABLE */
.table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden}
.table-header{padding:14px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)}
.table-header h2{font-size:.85rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:10px 16px;font-size:.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border)}
td{padding:10px 16px;font-size:.8rem;border-bottom:1px solid #0f1623}
tr:last-child td{border-bottom:none}
tr:hover td{background:#111827}
.badge{padding:2px 10px;border-radius:999px;font-size:.68rem;font-weight:700;white-space:nowrap}
.badge-hook       {background:#0c1a2e;color:#60a5fa;border:1px solid #1e40af}
.badge-offer      {background:#451a03;color:#fbbf24;border:1px solid #92400e}
.badge-objection  {background:#2d1b69;color:#c4b5fd;border:1px solid #5b21b6}
.badge-close      {background:#052e16;color:#4ade80;border:1px solid #166534}
.badge-done-ok    {background:#052e16;color:#4ade80;border:1px solid #166534}
.badge-done-sem   {background:#1c1c1c;color:var(--muted);border:1px solid #333}
.no-leads{padding:32px;text-align:center;color:var(--muted);font-size:.85rem}

/* LOG */
.log-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px}
.log-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.log-header h2{font-size:.85rem;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em}
.log-clear{font-size:.72rem;color:var(--muted);cursor:pointer;background:none;border:none;color:var(--muted)}
.log-list{font-family:'Courier New',monospace;font-size:.73rem;max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:3px}
.log-item{color:#94a3b8;padding:2px 0}
.log-item.l-enviado    {color:#60a5fa}
.log-item.l-respondeu  {color:#fbbf24}
.log-item.l-interessado{color:#c4b5fd}
.log-item.l-fechado    {color:#4ade80}
.log-item.l-erro       {color:#f87171}
.log-item.l-pause      {color:#fbbf24}
.log-item.l-stop       {color:#f87171}

/* FOOTER */
.footer{text-align:center;padding:16px;font-size:.7rem;color:var(--muted)}

/* TOAST GLOBAL */
#global-toast{position:fixed;bottom:24px;right:24px;background:#111827;border:1px solid var(--border);border-radius:12px;padding:12px 20px;font-size:.8rem;color:var(--text);box-shadow:0 8px 32px #000a;z-index:999;display:none;animation:slideIn .2s ease}
@keyframes slideIn{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="logo">ZapChat <span>Dashboard</span></div>
  <div id="status-pill" class="status-pill pill-offline">Offline</div>
  <div class="controls">
    <button class="btn btn-pause"  id="btn-pause"  onclick="controlar('pausar')" >⏸ Pausar</button>
    <button class="btn btn-resume" id="btn-resume" onclick="controlar('retomar')" disabled>▶ Retomar</button>
    <button class="btn btn-stop"   id="btn-stop"   onclick="confirmarParar()">⏹ Parar</button>
  </div>
  <div class="timer" id="timer">—</div>
</div>

<!-- MAIN -->
<div class="main">

  <!-- CARDS -->
  <div class="cards">
    <div class="card c-env">  <div class="card-num" id="n-env">0</div><div class="card-label">Enviados</div><div class="card-sub" id="n-env-sub">de 0</div></div>
    <div class="card c-resp"> <div class="card-num" id="n-resp">0</div><div class="card-label">Respostas</div></div>
    <div class="card c-int">  <div class="card-num" id="n-int">0</div><div class="card-label">Interessados</div></div>
    <div class="card c-fech"> <div class="card-num" id="n-fech">0</div><div class="card-label">Fechados</div></div>
    <div class="card c-sem">  <div class="card-num" id="n-sem">0</div><div class="card-label">Sem interesse</div></div>
    <div class="card c-taxa"> <div class="card-num" id="n-taxa">—</div><div class="card-label">Taxa de resposta</div></div>
  </div>

  <!-- PROGRESS -->
  <div class="prog-wrap">
    <div class="prog-header">
      <span>Progresso da campanha</span>
      <span id="prog-txt">0 / 0</span>
    </div>
    <div class="prog-bar"><div class="prog-fill" id="prog-fill" style="width:0%"></div></div>
  </div>

  <!-- FUNIL + SETTINGS -->
  <div class="row2">
    <div class="funnel-wrap">
      <div class="funnel-title">Funil de conversão</div>
      <div class="funnel">
        <div class="funnel-step f-env">
          <div class="funnel-step-label">Enviados</div>
          <div class="funnel-bar-wrap"><div class="funnel-bar" id="fb-env" style="width:100%"><span class="funnel-bar-label">100%</span></div></div>
          <div class="funnel-info"><div class="funnel-num" id="fv-env">0</div><div class="funnel-pct">base</div></div>
        </div>
        <div class="funnel-step f-resp">
          <div class="funnel-step-label">Respostas</div>
          <div class="funnel-bar-wrap"><div class="funnel-bar" id="fb-resp" style="width:0%"><span class="funnel-bar-label" id="fl-resp">0%</span></div></div>
          <div class="funnel-info"><div class="funnel-num" id="fv-resp">0</div><div class="funnel-pct" id="fp-resp">—</div></div>
        </div>
        <div class="funnel-step f-int">
          <div class="funnel-step-label">Interessados</div>
          <div class="funnel-bar-wrap"><div class="funnel-bar" id="fb-int" style="width:0%"><span class="funnel-bar-label" id="fl-int">0%</span></div></div>
          <div class="funnel-info"><div class="funnel-num" id="fv-int">0</div><div class="funnel-pct" id="fp-int">—</div></div>
        </div>
        <div class="funnel-step f-fech">
          <div class="funnel-step-label">Fechados</div>
          <div class="funnel-bar-wrap"><div class="funnel-bar" id="fb-fech" style="width:0%"><span class="funnel-bar-label" id="fl-fech">0%</span></div></div>
          <div class="funnel-info"><div class="funnel-num" id="fv-fech">0</div><div class="funnel-pct" id="fp-fech">—</div></div>
        </div>
      </div>
    </div>

    <div class="settings-wrap">
      <div class="settings-title">Configurações</div>
      <div class="field">
        <label>Meta de leads</label>
        <input type="number" id="inp-limite" min="1" max="500" placeholder="33">
      </div>
      <button class="save-btn" onclick="salvarLimite()">Salvar meta</button>
      <div class="toast" id="toast-settings"></div>
      <div style="margin-top:auto;font-size:.72rem;color:var(--muted);line-height:1.6">
        Alterações na meta são aplicadas no próximo reinício do bot.
      </div>
    </div>
  </div>

  <!-- LEADS TABLE -->
  <div class="table-wrap">
    <div class="table-header">
      <h2>Leads contatados</h2>
      <span id="leads-count" style="font-size:.75rem;color:var(--muted)"></span>
    </div>
    <div id="leads-table-body">
      <div class="no-leads">Aguardando envios...</div>
    </div>
  </div>

  <!-- LOG -->
  <div class="log-wrap">
    <div class="log-header">
      <h2>Log de atividade</h2>
      <button class="log-clear" onclick="document.getElementById('log-list').innerHTML=''">Limpar</button>
    </div>
    <div class="log-list" id="log-list"></div>
  </div>

</div>

<div class="footer">ZapChat Dashboard — atualiza a cada 4s</div>
<div id="global-toast"></div>

<script>
let iniciado = null;
let prevInteressados = 0;
let prevFechados = 0;
let notifPermissao = false;

// Pedir permissão de notificação
if ('Notification' in window) {
  Notification.requestPermission().then(p => notifPermissao = p === 'granted');
}

function notificar(titulo, corpo) {
  if (notifPermissao) new Notification(titulo, { body: corpo, icon: '' });
}

function toast(msg, cor) {
  const el = document.getElementById('global-toast');
  el.textContent = msg;
  el.style.display = 'block';
  el.style.borderColor = cor || '#1e2a3d';
  clearTimeout(el._t);
  el._t = setTimeout(() => el.style.display = 'none', 3500);
}

function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
function fmtPct(n) { return n + '%'; }

function atualizarFunil(d) {
  const env  = d.enviados     || 0;
  const resp = d.respostas    || 0;
  const int  = d.interessados || 0;
  const fech = d.fechados     || 0;

  set('fv-env',  env);
  set('fv-resp', resp);
  set('fv-int',  int);
  set('fv-fech', fech);

  const pResp = pct(resp, env);
  const pInt  = pct(int, env);
  const pFech = pct(fech, env);

  setFunnelBar('fb-resp', 'fl-resp', 'fp-resp', pResp, resp + ' leads');
  setFunnelBar('fb-int',  'fl-int',  'fp-int',  pInt,  int  + ' leads');
  setFunnelBar('fb-fech', 'fl-fech', 'fp-fech', pFech, fech + ' leads');
}

function setFunnelBar(barId, labelId, pctId, pctVal, sub) {
  const bar = document.getElementById(barId);
  bar.style.width = Math.max(pctVal, 0) + '%';
  document.getElementById(labelId).textContent = pctVal > 5 ? pctVal + '%' : '';
  document.getElementById(pctId).textContent = sub;
}

function atualizarTabela(leads) {
  const body = document.getElementById('leads-table-body');
  if (!leads || leads.length === 0) {
    body.innerHTML = '<div class="no-leads">Aguardando envios...</div>';
    document.getElementById('leads-count').textContent = '';
    return;
  }
  document.getElementById('leads-count').textContent = leads.length + ' leads';
  const rows = leads.map(l => {
    const badge = stageBadge(l.stage);
    const resp  = l.ultimaResposta ? '<span style="color:var(--muted)">' + l.ultimaResposta + '</span>' : '—';
    return '<tr>'
      + '<td style="font-weight:600">' + esc(l.nome) + '</td>'
      + '<td style="color:var(--text2)">' + esc(l.nicho || '—') + '</td>'
      + '<td style="color:var(--text2)">' + esc(l.bairro || '—') + '</td>'
      + '<td>' + badge + '</td>'
      + '<td style="color:var(--text2)">' + esc(l.horario || '—') + '</td>'
      + '<td>' + resp + '</td>'
      + '</tr>';
  }).join('');
  body.innerHTML = '<table><thead><tr>'
    + '<th>Nome</th><th>Nicho</th><th>Bairro</th><th>Status</th><th>Enviado</th><th>Última resposta</th>'
    + '</tr></thead><tbody>' + rows + '</tbody></table>';
}

function stageBadge(stage) {
  const map = {
    hook:       ['Em contato',   'badge-hook'],
    qualify:    ['Qualificando', 'badge-offer'],
    offer:      ['Apresentando', 'badge-offer'],
    objection:  ['Objeção',      'badge-objection'],
    close:      ['Interessado',  'badge-close'],
    done:       ['Encerrado',    'badge-done-sem'],
  };
  const [label, cls] = map[stage] || ['—', 'badge-hook'];
  return '<span class="badge ' + cls + '">' + label + '</span>';
}

function esc(s) { return String(s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function atualizarTimer(iniciado) {
  if (!iniciado) return;
  const diff = Math.floor((Date.now() - new Date(iniciado).getTime()) / 1000);
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  document.getElementById('timer').textContent =
    (h > 0 ? h + 'h ' : '') + String(m).padStart(2,'0') + 'm ' + String(s).padStart(2,'0') + 's';
}

async function atualizar() {
  const r = await fetch('/zapchat/status').catch(() => null);
  if (!r) return;
  const d = await r.json();

  // Status pill + botões
  const bot  = d.status_bot || 'offline';
  const pill = document.getElementById('status-pill');
  const pillMap = {
    rodando:            ['Rodando',          'pill-rodando'],
    pausado:            ['Pausado',           'pill-pausado'],
    parado:             ['Parado',            'pill-parado'],
    concluido:          ['Concluído',         'pill-concluido'],
    iniciando:          ['Iniciando',         'pill-iniciando'],
    aguardando_horario: ['Fora do horário',   'pill-pausado'],
    offline:            ['Offline',           'pill-offline'],
  };
  const [ptxt, pcls] = pillMap[bot] || ['Offline','pill-offline'];
  pill.textContent = ptxt;
  pill.className   = 'status-pill ' + pcls;

  const pausado = bot === 'pausado';
  const parado  = bot === 'parado' || bot === 'concluido' || bot === 'offline';
  document.getElementById('btn-pause').disabled  = pausado || parado;
  document.getElementById('btn-resume').disabled = !pausado;
  document.getElementById('btn-stop').disabled   = parado;

  // Métricas
  set('n-env',  d.enviados     || 0);
  set('n-resp', d.respostas    || 0);
  set('n-int',  d.interessados || 0);
  set('n-fech', d.fechados     || 0);
  set('n-sem',  d.semInteresse || 0);
  set('n-env-sub', 'de ' + (d.limite || 0));

  const taxa = d.enviados > 0 ? pct(d.respostas || 0, d.enviados) + '%' : '—';
  set('n-taxa', taxa);

  // Progress
  const p = d.limite > 0 ? Math.min(100, pct(d.enviados || 0, d.limite)) : 0;
  document.getElementById('prog-txt').textContent = (d.enviados || 0) + ' / ' + (d.limite || 0);
  document.getElementById('prog-fill').style.width = p + '%';

  // Funil
  atualizarFunil(d);

  // Tabela
  atualizarTabela(d.leadsStatus || []);

  // Log
  const logList = document.getElementById('log-list');
  const logs = (d.logs || []).slice(0, 100);
  logList.innerHTML = logs.map(l => {
    let cls = '';
    if (/Enviado/i.test(l))       cls = 'l-enviado';
    else if (/Interessado/i.test(l)) cls = 'l-interessado';
    else if (/Fechou/i.test(l))   cls = 'l-fechado';
    else if (/Respondeu/i.test(l))cls = 'l-respondeu';
    else if (/[Ee]rro/.test(l))   cls = 'l-erro';
    else if (/pausado/i.test(l))  cls = 'l-pause';
    else if (/parado/i.test(l))   cls = 'l-stop';
    return '<div class="log-item ' + cls + '">' + esc(l) + '</div>';
  }).join('');

  // Notificações de novos interessados/fechados
  if ((d.interessados || 0) > prevInteressados) notificar('ZapChat', 'Novo lead interessado!');
  if ((d.fechados     || 0) > prevFechados)     notificar('ZapChat', 'Lead fechou negócio!');
  prevInteressados = d.interessados || 0;
  prevFechados     = d.fechados     || 0;

  // Timer
  if (d.iniciado) {
    iniciado = d.iniciado;
    atualizarTimer(d.iniciado);
  }
}

async function controlar(acao) {
  const r = await fetch('/zapchat/control', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ acao })
  });
  const d = await r.json();
  if (d.ok) {
    const msgs = { pausar: 'Bot pausado', retomar: 'Bot retomado', parar: 'Bot parado' };
    toast(msgs[acao] || acao, acao === 'parar' ? '#991b1b' : acao === 'pausar' ? '#92400e' : '#166534');
  }
  atualizar();
}

function confirmarParar() {
  if (confirm('Tem certeza que quer parar o bot? Ele vai encerrar o loop de envios.')) {
    controlar('parar');
  }
}

async function salvarLimite() {
  const val = Number(document.getElementById('inp-limite').value);
  if (!val || val < 1) return;
  const r = await fetch('/zapchat/limite', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ limite: val })
  });
  const d = await r.json();
  const fb = document.getElementById('toast-settings');
  if (d.ok) {
    fb.textContent = 'Salvo! Reinicie o bot para aplicar.';
    setTimeout(() => fb.textContent = '', 4000);
  }
}

// Timer a cada segundo
setInterval(() => { if (iniciado) atualizarTimer(iniciado); }, 1000);

atualizar();
setInterval(atualizar, 4000);
</script>
</body>
</html>`));

const PORT = process.env.PORT || 3030;
app.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);

  // Self-ping a cada 10min para nao dormir no Render free tier
  if (process.env.RENDER_EXTERNAL_HOSTNAME) {
    const https = require("https");
    setInterval(() => {
      https.get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}/status`, () => {})
           .on("error", () => {});
    }, 10 * 60 * 1000);
    console.log("Self-ping ativado (Render free tier).");
  }
});
