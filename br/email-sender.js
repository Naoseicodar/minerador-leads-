/**
 * email-sender.js — Cold email outreach for Ireland Trades
 * Usage: node email-sender.js
 * Sends initial emails + follow-ups (FU1 after 3d, FU2 after 7d)
 */

require("dotenv").config();
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SHEET_ID         = process.env.SHEET_ID_IRELAND;
const SHEET_ABA        = process.env.SHEET_ABA_IRELAND || "Leads-Ireland";
const DAILY_LIMIT      = Number(process.env.EMAIL_LIMIT) || 50;
const DELAY_MIN        = 60000;   // 60s
const DELAY_MAX        = 180000;  // 180s
const MARKER           = "Email Sent ✓";
const NAO              = "Não encontrado";
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const today            = new Date().toLocaleDateString("en-CA");
const COUNTER_FILE     = path.join(__dirname, `email-count-${today}.json`);

// Follow-up delays em dias
const FU1_DAYS = 3;
const FU2_DAYS = 7;

// Column indexes (0-based): A=0 Status, B=1 Name, C=2 Phone, D=3 Email, E=4 Facebook, M=12 Notes
const COL = { STATUS: 0, NAME: 1, EMAIL: 3, NOTES: 12 };

// ─── Counter ────────────────────────────────────────────────
function loadCounter() {
  try { return JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8")).count || 0; }
  catch (_) { return 0; }
}

function saveCounter(count) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count }), "utf8");
}

// ─── Sheets ─────────────────────────────────────────────────
let sheetsCache = null;

async function getSheets() {
  if (sheetsCache) return sheetsCache;
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsCache = google.sheets({ version: "v4", auth });
  return sheetsCache;
}

async function getLeads(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_ABA}!A2:M`,
  });
  return res.data.values || [];
}

async function atualizarLead(sheets, rowIndex, status, notes) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${SHEET_ABA}!A${rowIndex + 2}`, values: [[status]] },
        { range: `${SHEET_ABA}!M${rowIndex + 2}`, values: [[notes]] },
      ],
    },
  });
}

// ─── Follow-up helpers ───────────────────────────────────────
function diasDesde(dataStr) {
  const diff = Date.now() - new Date(dataStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function parseSentDate(notes) {
  const match = notes.match(/sent:(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function hasFU1(notes) { return notes.includes("FU1:"); }
function hasFU2(notes) { return notes.includes("FU2:"); }

// ─── Email templates ─────────────────────────────────────────
function buildInitialEmail(name) {
  const subject = `Your business isn't showing up on Google, ${name}`;

  const text = [
    `Hi ${name},`,
    "",
    "I help tradespeople in Ireland get found on Google with a professional website + Google My Business setup.",
    "",
    "Most of my clients start getting calls within the first week. I handle everything in 48 hours for a flat fee of €400.",
    "",
    "Would that be useful for your business?",
    "",
    "— Luan",
    "",
    "P.S. To opt out of future emails, just reply \"unsubscribe\".",
  ].join("\n");

  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
  <p>Hi ${name},</p>
  <p>I help tradespeople in Ireland get found on Google with a <strong>professional website + Google My Business setup</strong>.</p>
  <p>Most of my clients start getting calls within the first week. I handle everything in <strong>48 hours</strong> for a flat fee of <strong>€400</strong>.</p>
  <p>Would that be useful for your business?</p>
  <p>— Luan</p>
  <p style="font-size:12px;color:#888">To opt out of future emails, just reply "unsubscribe".</p>
</div>`.trim();

  return { subject, text, html };
}

function buildFU1Email(name) {
  const subject = `Re: ${name} on Google`;

  const text = [
    `Hi ${name},`,
    "",
    "Just following up on my last message.",
    "",
    "I noticed your business still isn't showing up when people search for your trade nearby — that's potential customers going to competitors every day.",
    "",
    "If you'd like to fix that this week, I'm available. Everything done in 48h, €400 flat, no payment if you're not happy.",
    "",
    "— Luan",
  ].join("\n");

  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
  <p>Hi ${name},</p>
  <p>Just following up on my last message.</p>
  <p>I noticed your business still isn't showing up when people search for your trade nearby — that's potential customers going to competitors every day.</p>
  <p>If you'd like to fix that this week, I'm available. Everything done in <strong>48h</strong>, <strong>€400 flat</strong>, no payment if you're not happy.</p>
  <p>— Luan</p>
</div>`.trim();

  return { subject, text, html };
}

function buildFU2Email(name) {
  const subject = `Last message — ${name}`;

  const text = [
    `Hi ${name},`,
    "",
    "Last follow-up from me — I don't want to keep filling your inbox.",
    "",
    "If you ever want more customers finding you on Google, just reply to this email and I'll get it sorted.",
    "",
    "All the best,",
    "Luan",
  ].join("\n");

  const html = `
<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:560px">
  <p>Hi ${name},</p>
  <p>Last follow-up from me — I don't want to keep filling your inbox.</p>
  <p>If you ever want more customers finding you on Google, just reply to this email and I'll get it sorted.</p>
  <p>All the best,<br>Luan</p>
</div>`.trim();

  return { subject, text, html };
}

// ─── Nodemailer ──────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

// ─── Delay ──────────────────────────────────────────────────
function sleep(min, max) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  if (!SHEET_ID)                       { console.error("ERROR: SHEET_ID_IRELAND not set in .env"); process.exit(1); }
  if (!process.env.GMAIL_USER)         { console.error("ERROR: GMAIL_USER not set in .env"); process.exit(1); }
  if (!process.env.GMAIL_APP_PASSWORD) { console.error("ERROR: GMAIL_APP_PASSWORD not set in .env"); process.exit(1); }

  console.log("\n  ╔══════════════════════════════════════╗");
  console.log("  ║     IRELAND EMAIL SENDER             ║");
  console.log("  ║     Initial + FU1 (3d) + FU2 (7d)   ║");
  console.log("  ╚══════════════════════════════════════╝\n");

  // Valida credenciais Gmail antes de começar
  const transport = createTransport();
  try {
    await transport.verify();
    console.log("  Gmail: OK\n");
  } catch (err) {
    console.error(`  Gmail auth failed: ${err.message}`);
    process.exit(1);
  }

  const sent = loadCounter();
  console.log(`  Today: ${sent}/${DAILY_LIMIT} emails sent`);

  if (sent >= DAILY_LIMIT) {
    console.log("  Daily limit reached. Run again tomorrow.");
    return;
  }

  const sheets = await getSheets();
  const rows   = await getLeads(sheets);

  let count = sent;
  let initialSent = 0;
  let fu1Sent = 0;
  let fu2Sent = 0;

  for (let i = 0; i < rows.length; i++) {
    if (count >= DAILY_LIMIT) break;

    const row    = rows[i];
    const status = (row[COL.STATUS] || "").trim();
    const name   = (row[COL.NAME]   || "").trim() || "there";
    const email  = (row[COL.EMAIL]  || "").trim();
    const notes  = (row[COL.NOTES]  || "").trim();

    if (!email || email === NAO) continue;
    if (status === "Not Interested" || status === "Converted ✓" || status === "Unsubscribed") continue;
    if (notes.includes("unsubscribe")) continue;

    let emailData, novoStatus, novasNotas, tipo;

    if (!notes.includes(MARKER)) {
      // ── Envio inicial ──────────────────────────────────────
      emailData   = buildInitialEmail(name);
      novoStatus  = "Em contato";
      novasNotas  = notes ? `${notes} | ${MARKER} | sent:${today}` : `${MARKER} | sent:${today}`;
      tipo        = "inicial";

    } else {
      // ── Follow-ups ─────────────────────────────────────────
      const sentDate = parseSentDate(notes);
      if (!sentDate) continue;
      const dias = diasDesde(sentDate);

      if (!hasFU1(notes) && dias >= FU1_DAYS) {
        emailData   = buildFU1Email(name);
        novoStatus  = "FU1 enviado";
        novasNotas  = `${notes} | FU1:${today}`;
        tipo        = "FU1";

      } else if (hasFU1(notes) && !hasFU2(notes) && dias >= FU2_DAYS) {
        emailData   = buildFU2Email(name);
        novoStatus  = "FU2 enviado";
        novasNotas  = `${notes} | FU2:${today}`;
        tipo        = "FU2";

      } else {
        continue; // ainda não é hora do follow-up
      }
    }

    try {
      await transport.sendMail({
        from:    `Luan <${process.env.GMAIL_USER}>`,
        to:      email,
        subject: emailData.subject,
        text:    emailData.text,
        html:    emailData.html,
      });

      // Primeiro grava na planilha, depois salva contador
      await atualizarLead(sheets, i, novoStatus, novasNotas);
      count++;
      saveCounter(count);

      if (tipo === "inicial") initialSent++;
      else if (tipo === "FU1") fu1Sent++;
      else if (tipo === "FU2") fu2Sent++;

      console.log(`  [${count}/${DAILY_LIMIT}] ${tipo.padEnd(7)} → ${name} <${email}>`);

      if (count < DAILY_LIMIT) await sleep(DELAY_MIN, DELAY_MAX);

    } catch (err) {
      console.error(`  ✗ Failed → ${email}: ${err.message}`);
    }
  }

  console.log(`\n  Done. ${count - sent} emails sent today (inicial: ${initialSent}, FU1: ${fu1Sent}, FU2: ${fu2Sent})`);
  console.log(`  Total hoje: ${count}/${DAILY_LIMIT}\n`);
}

if (require.main === module) main();
