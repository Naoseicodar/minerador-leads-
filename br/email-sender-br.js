/**
 * email-sender-br.js — Cold email para leads brasileiros (saude/Parana)
 * Uso: node email-sender-br.js
 * Envia email inicial + FU1 (3 dias) + FU2 (7 dias)
 */

require("dotenv").config();
const nodemailer = require("nodemailer");
const { google }  = require("googleapis");
const fs          = require("fs");
const path        = require("path");

// ─── Config ─────────────────────────────────────────────────
const SHEET_ID         = process.env.SHEET_ID || "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI";
const SHEET_ABA        = process.env.SHEET_ABA_BR || "Leads";
const DAILY_LIMIT      = Number(process.env.EMAIL_LIMIT_BR) || 40;
const DELAY_MIN        = 45000;   // 45s
const DELAY_MAX        = 120000;  // 120s
const MARKER           = "Email BR ✓";
const NAO              = "Não encontrado";
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const today            = new Date().toLocaleDateString("en-CA");
const COUNTER_FILE     = path.join(__dirname, `email-count-br-${today}.json`);

const FU1_DAYS = 3;
const FU2_DAYS = 7;

// Colunas 0-based:
// A=Status, B=CNPJ, C=Nome, D=Tel, E=Email, F=Instagram,
// G=Website, H=Endereco, I=Bairro, J=Aval, K=NrAval, L=LinkMaps, M=Data, N=Obs
const COL = { STATUS: 0, CNPJ: 1, NOME: 2, EMAIL: 4, BAIRRO: 8, OBS: 13 };

// ─── Detecção de sub-nicho ───────────────────────────────────
function detectarNicho(nome) {
  const n = nome.toLowerCase();
  if (/dent|odont|sorriso|dental|implant/.test(n))          return "dentista";
  if (/capilar|cabelo|trich|hair|calvic/.test(n))           return "capilar";
  if (/psicolog|terapeut|mental|emocional/.test(n))         return "psicologia";
  if (/fisio|reabilit|pilates|postural/.test(n))            return "fisioterapia";
  if (/nutri|dieta|emagre|alimenta/.test(n))                return "nutricao";
  if (/estet|beleza|spa|laser|corporal|estetica/.test(n))   return "estetica";
  return "saude";
}

const COPY_NICHO = {
  dentista: {
    dor: "novos pacientes chegando pelo Google em vez de depender so de indicacao",
    cta: "Posso te mostrar como ficaria a pagina do seu consultorio?"
  },
  capilar: {
    dor: "clientes pesquisando tratamento capilar na sua cidade e encontrando voce antes da concorrencia",
    cta: "Posso te mostrar um modelo de site para clinica capilar?"
  },
  psicologia: {
    dor: "pacientes encontrando seu consultorio quando pesquisam por psicologia na sua cidade",
    cta: "Posso te mostrar como ficaria a sua pagina de atendimento online?"
  },
  fisioterapia: {
    dor: "pacientes te encontrando no Google quando pesquisam fisioterapia perto deles",
    cta: "Posso te mostrar um modelo de site para clinica de fisioterapia?"
  },
  nutricao: {
    dor: "clientes chegando pelo Google pesquisando nutricionista na sua regiao",
    cta: "Posso te mostrar como ficaria a sua pagina de consultas?"
  },
  estetica: {
    dor: "clientes encontrando sua clinica antes da concorrencia quando pesquisam no Google",
    cta: "Posso te mostrar um modelo de site para clinica de estetica?"
  },
  saude: {
    dor: "novos pacientes te encontrando no Google em vez de ir para a concorrencia",
    cta: "Posso te mostrar como ficaria o site do seu negocio?"
  }
};

// Extrai cidade do campo bairro ("Centro - Curitiba" → "Curitiba")
function extrairCidade(bairro) {
  if (!bairro) return "sua cidade";
  const partes = bairro.split(" - ");
  return partes.length > 1 ? partes[partes.length - 1].trim() : bairro.trim();
}

// Extrai primeiro nome
function primeiroNome(nome) {
  if (!nome || nome === NAO) return "boa tarde";
  return nome.trim().split(/[\s,]/)[0];
}

// ─── Templates de email ──────────────────────────────────────
function emailInicial(nome, bairro) {
  const nicho   = detectarNicho(nome);
  const copy    = COPY_NICHO[nicho];
  const cidade  = extrairCidade(bairro);
  const saudacao = primeiroNome(nome);

  const subject = `Encontrei um problema no seu negocio no Google`;

  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:580px;line-height:1.6">
  <p>${saudacao},</p>

  <p>Pesquisei o <strong>${nome}</strong> no Google agora.</p>

  <p>Aparece no Maps, tem avaliacoes — mas quando o cliente clica pra saber mais, <strong>nao tem site</strong>.</p>

  <p>Ele fecha a aba e abre o proximo resultado.</p>

  <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

  <p>Esse e o ciclo que acontece todo dia com negocios de saude em ${cidade}:</p>
  <ol style="padding-left:20px">
    <li>Cliente pesquisa no Google</li>
    <li>Acha voce no Maps</li>
    <li>Quer saber mais antes de ligar</li>
    <li>Nao encontra nada</li>
    <li>Liga pra concorrencia que tem pagina</li>
  </ol>

  <p>Voce nao sabe quantos — porque foram embora sem deixar rastro.</p>

  <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

  <p><strong>O que eu faco:</strong></p>
  <p>Crio uma landing page profissional para o seu negocio, otimizada para ${copy.dor}. Junto com isso, configuro o Google Meu Negocio corretamente para voce converter mais quem ja te encontra.</p>

  <p><strong>Entrega em menos de 48 horas. Investimento unico de R$500. Sem mensalidade.</strong></p>

  <p>Um paciente novo ja paga o investimento inteiro.</p>

  <hr style="border:none;border-top:1px solid #eee;margin:20px 0">

  <p>${copy.cta} Sem compromisso — so responda esse email ou me chame no WhatsApp: <strong>${process.env.WHATSAPP_BR || "adicione seu numero no .env"}</strong></p>

  <p>Luan<br>
  <span style="color:#666;font-size:13px">Especialista em presenca digital para saude no Parana</span></p>

  <p style="font-size:12px;color:#999">P.S.: Se voce ja tem um site funcionando bem, pode ignorar esse email. Mas se ainda nao tem — cada dia sem site e dinheiro que vai pra quem tem.<br><br>
  Para nao receber mais emails, responda com "cancelar".</p>
</div>`.trim();

  const text = [
    `${saudacao},`,
    "",
    `Pesquisei o ${nome} no Google agora.`,
    "",
    "Aparece no Maps, tem avaliacoes — mas quando o cliente clica pra saber mais, nao tem site.",
    "Ele fecha a aba e abre o proximo resultado.",
    "",
    `Esse e o ciclo que acontece todo dia com negocios de saude em ${cidade}:`,
    "1. Cliente pesquisa no Google",
    "2. Acha voce no Maps",
    "3. Quer saber mais antes de ligar",
    "4. Nao encontra nada",
    "5. Liga pra concorrencia que tem pagina",
    "",
    "Voce nao sabe quantos — porque foram embora sem deixar rastro.",
    "",
    "O que eu faco:",
    `Crio uma landing page profissional otimizada para ${copy.dor}. Entrego em menos de 48 horas por R$500 unico. Sem mensalidade.`,
    "",
    `${copy.cta}`,
    "",
    "Luan",
    "Especialista em presenca digital para saude no Parana",
    "",
    `P.S.: Para nao receber mais emails, responda com "cancelar".`,
  ].join("\n");

  return { subject, html, text };
}

function emailFU1(nome, bairro) {
  const cidade   = extrairCidade(bairro);
  const saudacao = primeiroNome(nome);

  const subject = `Re: ${nome} no Google`;

  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:580px;line-height:1.6">
  <p>${saudacao},</p>

  <p>So passando pra dar um retorno sobre o email que mandei.</p>

  <p>Verificar agora: seu negocio ainda aparece sem site no Google em ${cidade}. Isso significa que concorrentes com pagina estao pegando clientes que poderiam ser seus — todos os dias.</p>

  <p>Se quiser resolver essa semana, tenho disponibilidade. Entrego tudo em 48h por R$500 unico. Se nao gostar do resultado, nao paga.</p>

  <p>E so responder esse email.</p>

  <p>Luan</p>
</div>`.trim();

  const text = [
    `${saudacao},`,
    "",
    "So passando pra dar um retorno sobre o email que mandei.",
    "",
    `Seu negocio ainda aparece sem site no Google em ${cidade}. Concorrentes com pagina estao pegando clientes que poderiam ser seus — todos os dias.`,
    "",
    "Se quiser resolver essa semana, tenho disponibilidade. Entrego tudo em 48h por R$500 unico. Se nao gostar do resultado, nao paga.",
    "",
    "E so responder esse email.",
    "",
    "Luan",
  ].join("\n");

  return { subject, html, text };
}

function emailFU2(nome) {
  const saudacao = primeiroNome(nome);

  const subject = `Ultimo contato — ${nome}`;

  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:580px;line-height:1.6">
  <p>${saudacao},</p>

  <p>Ultimo email da minha parte — nao quero encher sua caixa de entrada.</p>

  <p>Se um dia precisar de um site profissional com SEO local pra aparecer no Google, e so responder esse email que resolvo em 48h.</p>

  <p>Ate mais,<br>Luan</p>
</div>`.trim();

  const text = [
    `${saudacao},`,
    "",
    "Ultimo email da minha parte — nao quero encher sua caixa de entrada.",
    "",
    "Se um dia precisar de um site profissional com SEO local pra aparecer no Google, e so responder esse email que resolvo em 48h.",
    "",
    "Ate mais,",
    "Luan",
  ].join("\n");

  return { subject, html, text };
}

// ─── Counter ────────────────────────────────────────────────
function loadCounter() {
  try { return JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8")).count || 0; }
  catch (_) { return 0; }
}

function saveCounter(count) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count }), "utf8");
}

// ─── Sheets ─────────────────────────────────────────────────
async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function getLeads(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_ABA}!A2:N`,
  });
  return res.data.values || [];
}

async function atualizarLead(sheets, rowIndex, status, obs) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${SHEET_ABA}!A${rowIndex + 2}`, values: [[status]] },
        { range: `${SHEET_ABA}!M${rowIndex + 2}`, values: [[obs]] },
      ],
    },
  });
}

// ─── Follow-up helpers ───────────────────────────────────────
function diasDesde(dataStr) {
  return Math.floor((Date.now() - new Date(dataStr).getTime()) / 86400000);
}

function parseSentDate(obs) {
  const m = obs.match(/enviado:(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

// ─── Delay ──────────────────────────────────────────────────
function sleep(min, max) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  process.stdout.write(`  aguardando ${Math.round(ms / 1000)}s...\r`);
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  if (!process.env.GMAIL_USER)         { console.error("ERRO: GMAIL_USER nao definido no .env"); process.exit(1); }
  if (!process.env.GMAIL_APP_PASSWORD) { console.error("ERRO: GMAIL_APP_PASSWORD nao definido no .env"); process.exit(1); }

  console.log("\n  ╔══════════════════════════════════════╗");
  console.log("  ║     EMAIL SENDER BR                  ║");
  console.log("  ║     Saude | Parana                   ║");
  console.log("  ║     Inicial + FU1 (3d) + FU2 (7d)   ║");
  console.log("  ╚══════════════════════════════════════╝\n");
  console.log(`  Planilha: ${SHEET_ABA} | Limite: ${DAILY_LIMIT}/dia\n`);

  const transport = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  try {
    await transport.verify();
    console.log("  Gmail: OK\n");
  } catch (err) {
    console.error(`  Gmail falhou: ${err.message}`);
    console.error("  Verifique GMAIL_USER e GMAIL_APP_PASSWORD no .env");
    process.exit(1);
  }

  const enviados = loadCounter();
  console.log(`  Hoje: ${enviados}/${DAILY_LIMIT} emails ja enviados\n`);

  if (enviados >= DAILY_LIMIT) {
    console.log("  Limite diario atingido. Rode novamente amanha.\n");
    return;
  }

  const sheets = await getSheets();
  const rows   = await getLeads(sheets);
  console.log(`  Leads na planilha: ${rows.length}\n`);
  console.log("  ──────────────────────────────────────");

  let count      = enviados;
  let inicialCt  = 0;
  let fu1Ct      = 0;
  let fu2Ct      = 0;
  let skipadosCt = 0;

  for (let i = 0; i < rows.length; i++) {
    if (count >= DAILY_LIMIT) break;

    const row    = rows[i];
    const status = (row[COL.STATUS] || "").trim();
    const nome   = (row[COL.NOME]   || "").trim();
    const email  = (row[COL.EMAIL]  || "").trim();
    const bairro = (row[COL.BAIRRO] || "").trim();
    const obs    = (row[COL.OBS]    || "").trim();

    // Pula sem email
    if (!email || email === NAO || !email.includes("@")) { skipadosCt++; continue; }

    // Pula se ja descartado
    if (["Sem interesse", "Convertido ✓", "cancelar"].some(s => status.includes(s))) continue;
    if (obs.toLowerCase().includes("cancelar") || obs.toLowerCase().includes("unsubscribe")) continue;

    let emailData, novoStatus, novasObs, tipo;

    if (!obs.includes(MARKER)) {
      // ── Email inicial ──────────────────────────────────────
      emailData  = emailInicial(nome, bairro);
      novoStatus = "Em contato";
      novasObs   = obs ? `${obs} | ${MARKER} | enviado:${today}` : `${MARKER} | enviado:${today}`;
      tipo       = "inicial";

    } else {
      // ── Follow-ups ─────────────────────────────────────────
      const sentDate = parseSentDate(obs);
      if (!sentDate) continue;
      const dias = diasDesde(sentDate);

      if (!obs.includes("FU1:") && dias >= FU1_DAYS) {
        emailData  = emailFU1(nome, bairro);
        novoStatus = "FU1 enviado";
        novasObs   = `${obs} | FU1:${today}`;
        tipo       = "FU1";

      } else if (obs.includes("FU1:") && !obs.includes("FU2:") && dias >= FU2_DAYS) {
        emailData  = emailFU2(nome);
        novoStatus = "FU2 enviado";
        novasObs   = `${obs} | FU2:${today}`;
        tipo       = "FU2";

      } else {
        continue;
      }
    }

    try {
      await transport.sendMail({
        from:    `Luan <${process.env.GMAIL_USER}>`,
        to:      email,
        subject: emailData.subject,
        text:    emailData.text,
        html:    emailData.html,
        replyTo: process.env.GMAIL_USER,
      });

      await atualizarLead(sheets, i, novoStatus, novasObs);
      count++;
      saveCounter(count);

      if (tipo === "inicial") inicialCt++;
      else if (tipo === "FU1") fu1Ct++;
      else if (tipo === "FU2") fu2Ct++;

      const nicho = detectarNicho(nome);
      console.log(`  [${String(count).padStart(2)}/${DAILY_LIMIT}] ${tipo.padEnd(7)} | ${nicho.padEnd(12)} | ${nome.padEnd(30)} → ${email}`);

      if (count < DAILY_LIMIT) await sleep(DELAY_MIN, DELAY_MAX);

    } catch (err) {
      console.error(`  ERRO → ${email}: ${err.message}`);
    }
  }

  console.log("\n  ══════════════════════════════════════");
  console.log(`  Enviados hoje:  ${count - enviados}`);
  console.log(`    Inicial:      ${inicialCt}`);
  console.log(`    FU1 (3d):     ${fu1Ct}`);
  console.log(`    FU2 (7d):     ${fu2Ct}`);
  console.log(`  Sem email:      ${skipadosCt}`);
  console.log(`  Total do dia:   ${count}/${DAILY_LIMIT}`);
  console.log("  ══════════════════════════════════════\n");
}

if (require.main === module) main();
