/**
 * email-sender.js — Cold email outreach for Ireland Trades
 * Usage: node email-sender.js
 * Sends up to 50 emails/day to leads in Leads-Ireland sheet with no email sent yet.
 */

require("dotenv").config();
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SHEET_ID = process.env.SHEET_ID_IRELAND;
const SHEET_ABA = process.env.SHEET_ABA_IRELAND || "Leads-Ireland";
const DAILY_LIMIT = Number(process.env.EMAIL_LIMIT) || 50;
const DELAY_MIN = 60000;   // 60s
const DELAY_MAX = 180000;  // 180s
const MARKER = "Email Sent ✓";
const NAO = "Não encontrado"; // same value written by minerar-ireland.js
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
// Use local date (not UTC) to avoid counter resetting early in IST (UTC+1 summer)
const today = new Date().toLocaleDateString("en-CA"); // en-CA gives YYYY-MM-DD in local time
const COUNTER_FILE = path.join(__dirname, `email-count-${today}.json`);

// Column indexes (0-based): A=0 Status, B=1 Name, C=2 Phone, D=3 Email, E=4 Facebook, M=12 Notes
const COL = { STATUS: 0, NAME: 1, EMAIL: 3, NOTES: 12 };

// ─── Counter ───────────────────────────────────────────────
function loadCounter() {
  try { return JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8")).count || 0; }
  catch (_) { return 0; }
}

function saveCounter(count) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ count }), "utf8");
}

// ─── Nodemailer ─────────────────────────────────────────────
function createTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

function buildEmail(businessName) {
  const subject = `Your business isn't showing up on Google, ${businessName}`;
  const text = [
    `Hi ${businessName},`,
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
  return { subject, text };
}

async function testTransport() {
  const t = createTransport();
  await t.verify(); // throws on failure — caller will see the real error
  return true;
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
    range: `${SHEET_ABA}!A2:M`,
  });
  return res.data.values || [];
}

async function marcarEnviado(sheets, rowIndex, currentNotes) {
  const nota = currentNotes ? `${currentNotes} | ${MARKER}` : MARKER;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_ABA}!M${rowIndex + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [[nota]] },
  });
}

// ─── Delay ──────────────────────────────────────────────────
function sleep(min, max) {
  const ms = Math.floor(Math.random() * (max - min) + min);
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  if (!process.env.SHEET_ID_IRELAND) { console.error("ERROR: SHEET_ID_IRELAND not set in .env"); process.exit(1); }
  if (!process.env.GMAIL_USER) { console.error("ERROR: GMAIL_USER not set in .env"); process.exit(1); }
  if (!process.env.GMAIL_APP_PASSWORD) { console.error("ERROR: GMAIL_APP_PASSWORD not set in .env"); process.exit(1); }

  console.log("\n  ╔══════════════════════════════════════╗");
  console.log("  ║     IRELAND EMAIL SENDER             ║");
  console.log("  ║     Cold email → Trades Ireland      ║");
  console.log("  ╚══════════════════════════════════════╝\n");

  const sent = loadCounter();
  console.log(`  Today: ${sent}/${DAILY_LIMIT} emails sent`);

  if (sent >= DAILY_LIMIT) {
    console.log("  Daily limit reached. Run again tomorrow.");
    return;
  }

  const sheets = await getSheets();
  const rows = await getLeads(sheets);
  const transport = createTransport();

  let count = sent;

  for (let i = 0; i < rows.length; i++) {
    if (count >= DAILY_LIMIT) break;

    const row = rows[i];
    const status = (row[COL.STATUS] || "").trim();
    const name = (row[COL.NAME] || "").trim();
    const email = (row[COL.EMAIL] || "").trim();
    const notes = (row[COL.NOTES] || "").trim();

    // Skip: no email, already sent, or disqualified
    if (!email || email === NAO) continue;
    if (notes.includes(MARKER)) continue;
    if (status === "Not Interested" || status === "Converted ✓") continue;

    const { subject, text } = buildEmail(name || "there");

    try {
      await transport.sendMail({
        from: `Luan <${process.env.GMAIL_USER}>`,
        to: email,
        subject,
        text,
      });

      count++;
      saveCounter(count);
      await marcarEnviado(sheets, i, notes);
      console.log(`  [${count}/${DAILY_LIMIT}] Sent → ${name} <${email}>`);

      if (count < DAILY_LIMIT) await sleep(DELAY_MIN, DELAY_MAX);
    } catch (err) {
      console.error(`  ✗ Failed → ${email}: ${err.message}`);
    }
  }

  console.log(`\n  Done. ${count - sent} emails sent today (total: ${count}/${DAILY_LIMIT})`);
}

module.exports = { enviarEmail: { buildEmail, testTransport } };

if (require.main === module) main();
