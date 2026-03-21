/**
 * facebook-sender.js — Facebook Messenger outreach for Ireland Trades
 * Usage: node facebook-sender.js
 * Sends up to 20 DMs/day to trade business Facebook pages.
 * Mirrors claudio-insta.js behavior: human-like delays, session persistence.
 */

require("dotenv").config();
const { chromium } = require("playwright");
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");

const SHEET_ID = process.env.SHEET_ID_IRELAND;
const SHEET_ABA = process.env.SHEET_ABA_IRELAND || "Leads-Ireland";
const DAILY_LIMIT = Number(process.env.FB_LIMIT) || 20;
const SESSION_FILE = path.join(__dirname, "facebook-session.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const MARKER = "FB Sent ✓";
const NAO = "Não encontrado";
const today = new Date().toLocaleDateString("en-CA");
const FB_COUNTER_FILE = path.join(__dirname, `fb-count-${today}.json`);

const COL = { STATUS: 0, NAME: 1, FACEBOOK: 4, NOTES: 12 };

const MENSAGEM = (nome) => `Hi ${nome}, I help tradespeople in Ireland get a professional website + Google My Business so customers find them online. I do it in 48 hours for €400. Would that interest you? — Luan`;

function sleep(min, max) {
  const ms = max ? Math.floor(Math.random() * (max - min) + min) : min;
  return new Promise(r => setTimeout(r, ms));
}

function loadFbCounter() {
  try { return JSON.parse(fs.readFileSync(FB_COUNTER_FILE, "utf8")).count || 0; }
  catch (_) { return 0; }
}

function saveFbCounter(count) {
  fs.writeFileSync(FB_COUNTER_FILE, JSON.stringify({ count }), "utf8");
}

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

async function carregarSessao(context) {
  if (fs.existsSync(SESSION_FILE)) {
    const cookies = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    await context.addCookies(cookies);
    return true;
  }
  return false;
}

async function salvarSessao(context) {
  const cookies = await context.cookies();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies), "utf8");
}

async function verificarLoginSucesso(page) {
  await sleep(2000, 3000);
  if (page.url().includes("/login") || page.url().includes("checkpoint")) {
    throw new Error("Login failed or checkpoint required. Check credentials or complete 2FA manually.");
  }
}

async function login(page) {
  console.log("  → Logging in to Facebook...");
  await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });
  await sleep(1500, 2500);
  await page.click("#email");
  for (const char of process.env.FB_EMAIL) { await page.keyboard.type(char); await sleep(40, 130); }
  await sleep(500, 1000);
  await page.click("#pass");
  for (const char of process.env.FB_PASSWORD) { await page.keyboard.type(char); await sleep(40, 130); }
  await sleep(500, 1000);
  await page.click('[name="login"]');
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
  await verificarLoginSucesso(page);
}

async function estaLogado(page) {
  try {
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(1500);
    if (page.url().includes("/login")) return false;
    const loggedIn = await page.locator('[aria-label="Your profile"], [data-testid="royal_blue_bar"]').first().isVisible({ timeout: 4000 }).catch(() => false);
    return loggedIn;
  } catch (_) {
    return false;
  }
}

async function enviarDM(page, facebookUrl, nome) {
  try {
    const url = facebookUrl.startsWith("http") ? facebookUrl : `https://${facebookUrl}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2000, 3500);

    const msgBtn = page.locator('[aria-label="Send message"], a:has-text("Send Message"), button:has-text("Message")').first();
    if (!await msgBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`  ✗ No Message button: ${facebookUrl}`);
      return false;
    }

    await msgBtn.click();
    await sleep(2000, 3000);

    const inputBox = page.locator('[contenteditable="true"][aria-label*="message" i], [contenteditable="true"][aria-placeholder*="message" i], [contenteditable="true"]').first();
    await inputBox.waitFor({ timeout: 8000 });
    await inputBox.click();
    await sleep(300, 600);
    for (const char of MENSAGEM(nome)) {
      await inputBox.type(char, { delay: 0 });
      await sleep(40, 130);
    }
    await sleep(800, 1500);
    await page.keyboard.press("Enter");
    await sleep(1500, 2500);
    return true;
  } catch (err) {
    console.error(`  ✗ DM failed for ${facebookUrl}: ${err.message}`);
    return false;
  }
}

async function main() {
  if (!process.env.SHEET_ID_IRELAND) { console.error("ERROR: SHEET_ID_IRELAND not set in .env"); process.exit(1); }
  if (!process.env.FB_EMAIL) { console.error("ERROR: FB_EMAIL not set in .env"); process.exit(1); }
  if (!process.env.FB_PASSWORD) { console.error("ERROR: FB_PASSWORD not set in .env"); process.exit(1); }

  console.log("\n  ╔══════════════════════════════════════╗");
  console.log("  ║     IRELAND FACEBOOK SENDER          ║");
  console.log("  ║     Messenger DM → Trades Ireland    ║");
  console.log("  ╚══════════════════════════════════════╝\n");

  const sheets = await getSheets();
  const rows = await getLeads(sheets);

  const leads = rows
    .map((row, i) => ({ row, i }))
    .filter(({ row }) => {
      const fb = (row[COL.FACEBOOK] || "").trim();
      const notes = (row[COL.NOTES] || "").trim();
      const status = (row[COL.STATUS] || "").trim();
      if (!fb || fb === NAO) return false;
      if (notes.includes(MARKER)) return false;
      if (status === "Not Interested" || status === "Converted ✓") return false;
      return true;
    });

  console.log(`  Leads with Facebook to contact: ${leads.length}`);
  if (!leads.length) { console.log("  Nothing to send."); return; }

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--lang=en-IE"]
  });

  const context = await browser.newContext({
    locale: "en-IE",
    timezoneId: "Europe/Dublin",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 }
  });

  const page = await context.newPage();
  const temSessao = await carregarSessao(context);

  if (temSessao) {
    const logado = await estaLogado(page);
    if (!logado) await login(page);
  } else {
    await login(page);
  }

  await salvarSessao(context);
  console.log("  ✓ Logged in\n");

  const sent = loadFbCounter();
  console.log(`  Today: ${sent}/${DAILY_LIMIT} DMs sent`);
  if (sent >= DAILY_LIMIT) { console.log("  Daily limit reached. Run again tomorrow."); await browser.close(); return; }

  let count = sent;

  for (const { row, i } of leads) {
    if (count >= DAILY_LIMIT) break;
    const nome = (row[COL.NAME] || "there").trim();
    const fb = (row[COL.FACEBOOK] || "").trim();
    const notes = (row[COL.NOTES] || "").trim();

    process.stdout.write(`  [${count + 1}/${DAILY_LIMIT}] ${nome}: sending...`);
    const ok = await enviarDM(page, fb, nome);

    if (ok) {
      count++;
      saveFbCounter(count);
      await marcarEnviado(sheets, i, notes);
      console.log(` ✓`);
      if (count < DAILY_LIMIT) await sleep(45000, 120000);
    } else {
      console.log(` ✗`);
    }
  }

  await salvarSessao(context);
  await browser.close();
  console.log(`\n  Done. ${count - sent} DMs sent today (total: ${count}/${DAILY_LIMIT}).`);
}

main();
