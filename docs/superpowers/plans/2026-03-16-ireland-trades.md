# Ireland Trades Lead Miner — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the minerador-leads system to scrape trade businesses in Ireland without a website, then contact them via cold email (50/day) and Facebook Messenger DM (20/day).

**Architecture:** Copy `minerar.js` into `minerar-ireland.js` with locale, city list, and column changes. Add `email-sender.js` (Nodemailer + Gmail App Password). Add `facebook-sender.js` (Playwright, mirrors claudio-insta.js structure). All three point to a new Google Sheet `Leads-Ireland`.

**Tech Stack:** Node.js 24, Playwright, googleapis, nodemailer (new), Google Sheets API, Gmail App Password

---

## Chunk 1: Setup

### Task 1: Install nodemailer and create .env

**Files:**
- Modify: `package.json`
- Create: `.env` (if not exists)

- [ ] **Step 1: Install nodemailer**

Run:
```bash
cd "C:/Users/Win10/CLAUDE PROJETOS/minerador-leads"
npm install nodemailer
```
Expected: nodemailer appears in `package.json` dependencies.

- [ ] **Step 2: Add Ireland env vars to .env**

Open `.env` (or create it) and add:
```
# Ireland Trades
SHEET_ID_IRELAND=<paste new Google Sheet ID here>
SHEET_ABA_IRELAND=Leads-Ireland
GMAIL_USER=<your gmail address>
GMAIL_APP_PASSWORD=<your 16-char app password>
FB_EMAIL=<your facebook email>
FB_PASSWORD=<your facebook password>
```

Leave `SHEET_ID_IRELAND` blank for now — will be filled after Task 2.

- [ ] **Step 3: Verify nodemailer installed**

Run:
```bash
node -e "require('nodemailer'); console.log('OK')"
```
Expected: `OK`

---

### Task 2: Create the Leads-Ireland Google Sheet

**Files:** None (browser action)

- [ ] **Step 1: Create new Google Sheet**

Go to sheets.google.com → New spreadsheet → rename to `Leads-Ireland`.

- [ ] **Step 2: Copy the Sheet ID**

From the URL `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit` — copy the ID between `/d/` and `/edit`.

- [ ] **Step 3: Paste into .env**

Replace `<paste new Google Sheet ID here>` in `.env` with the copied ID.

- [ ] **Step 4: Share the sheet with the service account**

Open `credentials.json` → find `"client_email"` value (looks like `xxx@xxx.iam.gserviceaccount.com`).
In Google Sheets → Share → paste that email → Editor role → Share.

---

## Chunk 2: minerar-ireland.js

### Task 3: Create the Ireland scraper

**Files:**
- Create: `minerar-ireland.js` (copy of `minerar.js` with changes below)

- [ ] **Step 1: Copy minerar.js to minerar-ireland.js**

```bash
cp "C:/Users/Win10/CLAUDE PROJETOS/minerador-leads/minerar.js" \
   "C:/Users/Win10/CLAUDE PROJETOS/minerador-leads/minerar-ireland.js"
```

- [ ] **Step 2: Replace CIDADES_PARANA with CIDADES_IRELAND**

Find the `const CIDADES_PARANA = [...]` block (lines ~19–142) and replace entirely with:

```js
const CIDADES_IRELAND = [
  {
    cidade: "Dublin",
    bairros: ["Dublin 1", "Dublin 2", "Dublin 4", "Dublin 6", "Dublin 8", "Tallaght", "Blanchardstown", "Swords"]
  },
  {
    cidade: "Cork",
    bairros: ["Cork City", "Ballincollig", "Bishopstown"]
  },
  {
    cidade: "Galway",
    bairros: ["Galway City", "Salthill", "Tuam"]
  },
  {
    cidade: "Limerick",
    bairros: ["Limerick City", "Castletroy"]
  },
  {
    cidade: "Waterford",
    bairros: ["Waterford City"]
  },
  {
    cidade: "Kilkenny",
    bairros: ["Kilkenny City", "Callan"]
  },
  {
    cidade: "Drogheda",
    bairros: ["Drogheda Town", "Moneymore"]
  },
];
```

- [ ] **Step 3: Update CONFIG to use Ireland env vars and English sheet name**

Find the `const CONFIG = {` block (~line 144) and change:
```js
// FROM:
sheetId: process.env.SHEET_ID || "1IZTRE-...",
sheetNome: "Leads",
termo: process.env.TERMO || "",
cidadeUnica: process.env.CIDADE || null,
bairrosUnico: process.env.BAIRROS ? ... : null,
limiteDiario: Number(process.env.LIMITE_DIARIO) || 150,

// TO:
sheetId: process.env.SHEET_ID_IRELAND || "",
sheetNome: process.env.SHEET_ABA_IRELAND || "Leads-Ireland",
termo: process.env.TERMO_IRELAND || "plumber",
cidadeUnica: null,
bairrosUnico: null,
limiteDiario: Number(process.env.LIMITE_DIARIO) || 80,
```

- [ ] **Step 4: Update CABECALHO — replace Instagram with Facebook, Bairro with City**

Find the `const CABECALHO = [` block (~line 193) and change:
```js
// FROM:
"Instagram",   // E
"Bairro",      // H

// TO:
"Facebook",    // E
"City",        // H
```

- [ ] **Step 5: Update LARGURAS to match 13 columns (no change needed — already 13)**

Verify `LARGURAS` still has 13 values. No change required.

- [ ] **Step 6: Add extrairFacebook function (replaces extrairInstagram usage for search)**

After the `extrairInstagram` function (~line 256), add:

```js
function extrairFacebook(html) {
  const match = html.match(/(?:facebook\.com)\/(?:pages\/)?([a-zA-Z0-9._\-]{3,80})/);
  if (!match) return NAO;
  const u = match[1].replace(/\/$/, "");
  if (["sharer", "share", "login", "groups", "events", "marketplace", "watch", "photo", "video", "ads"].includes(u)) return NAO;
  return `facebook.com/${u}`;
}
```

- [ ] **Step 7: Update buscarInstagramViaBusca → buscarFacebookViaBusca**

Find `async function buscarInstagramViaBusca(nome, cidade)` (~line 323) and add a new function after it:

```js
async function buscarFacebookViaBusca(nome, cidade) {
  try {
    const q = encodeURIComponent(`"${nome}" facebook ${cidade} Ireland`);
    const html = await comTimeout(
      httpsGet(`https://html.duckduckgo.com/html/?q=${q}`),
      8000
    );
    const fb = extrairFacebook(html);
    return fb !== NAO ? fb : null;
  } catch (_) {
    return null;
  }
}
```

- [ ] **Step 8: Update processarLink to search Facebook instead of Instagram**

Find the `processarLink` function (~line 690). Make these changes:

**8a — Change lead initialization (line ~714):**
```js
// FROM:
const lead = { ...dados, bairro, mapsLink: link, email: NAO, instagram: NAO };

// TO:
const lead = { ...dados, bairro, mapsLink: link, email: NAO, facebook: NAO };
```

**8b — Remove Camada 1 block entirely (lines ~716-721, unreachable since leads have no website, but remove to avoid confusion):**
```js
// DELETE this entire block:
if (dados.website) {
  const info = await comTimeout(buscarSiteInfo(dados.website), 20000).catch(() => ({ email: NAO, instagram: NAO }));
  lead.email = info.email;
  lead.instagram = info.instagram;
}
```

**8c — Replace Camada 2 and Camada 3 with Facebook search:**
```js
// DELETE Camada 2 (Instagram via DuckDuckGo) and Camada 3 (email from Instagram bio).
// ADD in their place:
if (lead.facebook === NAO) {
  const fbEncontrado = await buscarFacebookViaBusca(dados.nome, bairro).catch(() => null);
  if (fbEncontrado) lead.facebook = fbEncontrado;
}
```

- [ ] **Step 9: Update formatarLinha to use facebook and city**

Find `function formatarLinha(lead)` (~line 583) and change:
```js
// FROM:
val(lead.instagram),   // col E
// ...
val(lead.bairro),      // col H
// ...
new Date().toLocaleDateString("pt-BR"),  // col L
"Não contatado",       // col A (status)

// TO:
val(lead.facebook),    // col E
// ...
val(lead.bairro),      // col H — holds the city string passed by rasparBairro (just cidade, see step 10)
// ...
new Date().toLocaleDateString("en-IE"),  // col L
"Not Contacted",       // col A (status)
```

- [ ] **Step 10: Update rasparBairro query format and URL locale**

Find `async function rasparBairro(page, bairro, cidade)` (~line 661). Change:
```js
// FROM:
const query = CONFIG.termo
  ? encodeURIComponent(`${CONFIG.termo} em ${bairro} ${cidade}`)
  : encodeURIComponent(`${bairro} ${cidade}`);
// ...
await page.goto(`https://www.google.com/maps/search/${query}?hl=pt-BR`, ...)
// ...
processarLink(pagesParalelas[idx], link, `${bairro} - ${cidade}`, ...)

// TO:
const query = CONFIG.termo
  ? encodeURIComponent(`${CONFIG.termo} in ${bairro} ${cidade} Ireland`)
  : encodeURIComponent(`${bairro} ${cidade} Ireland`);
// ...
await page.goto(`https://www.google.com/maps/search/${query}?hl=en`, ...)
// ...
// Pass only cidade (not bairro) so column H shows the city name only (e.g. "Dublin", not "Dublin 1, Dublin")
processarLink(pagesParalelas[idx], link, cidade, ...)
```

- [ ] **Step 11: Update browser launch locale and timezone**

Find `const browser = await chromium.launch(...)` (~line 767). Change:
```js
// FROM:
"--lang=pt-BR",
// TO:
"--lang=en-IE",
```

Find `const ctx = await browser.newContext(...)` (~line 780). Change:
```js
// FROM:
locale: "pt-BR",
timezoneId: "America/Sao_Paulo",
// TO:
locale: "en-IE",
timezoneId: "Europe/Dublin",
```

- [ ] **Step 12: Update status validation dropdown to English**

Find `setDataValidation` block (~line 500) and change the values:
```js
// FROM:
{ userEnteredValue: "Não contatado" },
{ userEnteredValue: "Em contato" },
{ userEnteredValue: "Proposta enviada" },
{ userEnteredValue: "Convertido ✓" },
{ userEnteredValue: "Sem interesse" },
{ userEnteredValue: "Sem resposta" },

// TO:
{ userEnteredValue: "Not Contacted" },
{ userEnteredValue: "In Contact" },
{ userEnteredValue: "Proposal Sent" },
{ userEnteredValue: "Converted ✓" },
{ userEnteredValue: "Not Interested" },
{ userEnteredValue: "No Response" },
```

Also update the 4 `addConditionalFormatRule` blocks (~lines 521–551). Each has this structure — change only the `userEnteredValue` string:

```js
// Example for "Converted" rule (index 0):
// FROM:
booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Convertido" }] }, ... }
// TO:
booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Converted" }] }, ... }

// Apply the same pattern to the other 3 rules:
// "Proposta enviada" → "Proposal Sent"
// "Em contato"       → "In Contact"
// "Sem interesse"    → "Not Interested"
```

Note: The cookie banner locator at `fecharCookies()` already uses a CSS comma selector `button:has-text("Aceitar tudo"), button:has-text("Accept all")` — **no change needed** for the cookie banner.

- [ ] **Step 13: Update main() to use CIDADES_IRELAND and fix counters**

Find `const listaCidades = CONFIG.cidadeUnica ? [...] : CIDADES_PARANA;` (~line 747). Change:
```js
const listaCidades = CIDADES_IRELAND;
```

Find `let totalInsta = 0;` (~line 805) and change to `let totalFacebook = 0;`.
Find `if (lead.instagram !== NAO) totalInsta++;` and change to `if (lead.facebook !== NAO) totalFacebook++;`.
Update the final summary console.log to print `totalFacebook` instead of `totalInsta`.

Also update console.log banner to say `IRELAND TRADES MINER`.

- [ ] **Step 14: Update carregarChavesExistentes to use SHEET_ID_IRELAND**

The function uses `CONFIG.sheetId` which now points to SHEET_ID_IRELAND — no change needed.

- [ ] **Step 15: Smoke test the scraper**

```bash
cd "C:/Users/Win10/CLAUDE PROJETOS/minerador-leads"
TERMO_IRELAND=plumber node minerar-ireland.js
```
Expected: Script starts, connects to the Ireland sheet, searches Google Maps for "plumber in Dublin 1 Dublin Ireland", finds and saves leads without websites to the `Leads-Ireland` sheet.

- [ ] **Step 16: Commit**

```bash
git add minerar-ireland.js .env package.json package-lock.json
git commit -m "feat: add Ireland trades scraper (minerar-ireland.js)"
```

---

## Chunk 3: email-sender.js

### Task 4: Build the cold email module

**Files:**
- Create: `email-sender.js`
- Create: `scripts/test-email.js`

- [ ] **Step 1: Write a failing test first**

Create `scripts/test-email.js`:
```js
// Manual smoke test — run: node scripts/test-email.js
require("dotenv").config();
const { enviarEmail } = require("../email-sender");

async function test() {
  // Test 1: should build correct email object
  const email = enviarEmail.buildEmail("O'Brien Plumbing");
  console.assert(email.subject.includes("O'Brien Plumbing"), "Subject must contain business name");
  console.assert(email.text.includes("Luan"), "Body must contain persona name");
  console.assert(email.text.includes("unsubscribe"), "Body must include opt-out");
  console.log("✓ buildEmail works");

  // Test 2: dry run — does not actually send, just verifies transport creation
  const ok = await enviarEmail.testTransport();
  console.assert(ok === true, "Gmail transport must connect");
  console.log("✓ Gmail transport OK");
}

test().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run test — verify it fails**

```bash
node scripts/test-email.js
```
Expected: `Error: Cannot find module '../email-sender'`

- [ ] **Step 3: Create email-sender.js**

```js
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

if (!process.env.SHEET_ID_IRELAND) { console.error("ERROR: SHEET_ID_IRELAND not set in .env"); process.exit(1); }
if (!process.env.GMAIL_USER) { console.error("ERROR: GMAIL_USER not set in .env"); process.exit(1); }
if (!process.env.GMAIL_APP_PASSWORD) { console.error("ERROR: GMAIL_APP_PASSWORD not set in .env"); process.exit(1); }

const SHEET_ID = process.env.SHEET_ID_IRELAND;
const SHEET_ABA = process.env.SHEET_ABA_IRELAND || "Leads-Ireland";
const DAILY_LIMIT = Number(process.env.EMAIL_LIMIT) || 50;
const DELAY_MIN = 60000;   // 60s
const DELAY_MAX = 180000;  // 180s
const MARKER = "Email Sent ✓";
const NAO = "Não encontrado"; // same value written by minerar-ireland.js
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
// Use local date (not UTC) to avoid the counter resetting an hour early in IST (UTC+1 summer)
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
```

- [ ] **Step 4: Run test — verify it passes**

```bash
node scripts/test-email.js
```
Expected:
```
✓ buildEmail works
✓ Gmail transport OK
```

If Gmail transport fails: double-check `GMAIL_APP_PASSWORD` in `.env` — must be the 16-char App Password (no spaces), not your regular Gmail password.

- [ ] **Step 5: Dry run — verify it reads the sheet without sending**

Comment out the `transport.sendMail(...)` call temporarily and run:
```bash
node email-sender.js
```
Expected: Prints leads that would receive email. Uncomment `sendMail` after verifying.

- [ ] **Step 6: Commit**

```bash
git add email-sender.js scripts/test-email.js
git commit -m "feat: add cold email sender for Ireland trades"
```

---

## Chunk 4: facebook-sender.js

### Task 5: Build the Facebook Messenger bot

**Files:**
- Create: `facebook-sender.js`

- [ ] **Step 1: Create facebook-sender.js**

```js
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

if (!process.env.SHEET_ID_IRELAND) { console.error("ERROR: SHEET_ID_IRELAND not set in .env"); process.exit(1); }
if (!process.env.FB_EMAIL) { console.error("ERROR: FB_EMAIL not set in .env"); process.exit(1); }
if (!process.env.FB_PASSWORD) { console.error("ERROR: FB_PASSWORD not set in .env"); process.exit(1); }

const SHEET_ID = process.env.SHEET_ID_IRELAND;
const SHEET_ABA = process.env.SHEET_ABA_IRELAND || "Leads-Ireland";
const DAILY_LIMIT = Number(process.env.FB_LIMIT) || 20;
const SESSION_FILE = path.join(__dirname, "facebook-session.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const MARKER = "FB Sent ✓";
const NAO = "Não encontrado";
// Persistent daily counter (local date, same logic as email-sender.js)
const today = new Date().toLocaleDateString("en-CA");
const FB_COUNTER_FILE = path.join(__dirname, `fb-count-${today}.json`);

function loadFbCounter() {
  try { return JSON.parse(fs.readFileSync(FB_COUNTER_FILE, "utf8")).count || 0; }
  catch (_) { return 0; }
}
function saveFbCounter(count) {
  fs.writeFileSync(FB_COUNTER_FILE, JSON.stringify({ count }), "utf8");
}

// Column indexes (0-based)
const COL = { STATUS: 0, NAME: 1, FACEBOOK: 4, NOTES: 12 };

const MENSAGEM = (nome) => `Hi ${nome}, I help tradespeople in Ireland get a professional website + Google My Business so customers find them online. I do it in 48 hours for €400. Would that interest you? — Luan`;

// ─── Human delays ────────────────────────────────────────────
function sleep(min, max) {
  const ms = max ? Math.floor(Math.random() * (max - min) + min) : min;
  return new Promise(r => setTimeout(r, ms));
}

async function digitarHumano(page, selector, texto) {
  await page.click(selector);
  for (const char of texto) {
    await page.keyboard.type(char);
    await sleep(40, 130);
  }
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

// ─── Facebook session ────────────────────────────────────────
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

async function login(page) {
  console.log("  → Logging in to Facebook...");
  await page.goto("https://www.facebook.com/login", { waitUntil: "domcontentloaded" });
  await sleep(1500, 2500);
  await digitarHumano(page, '#email', process.env.FB_EMAIL);
  await sleep(500, 1000);
  await digitarHumano(page, '#pass', process.env.FB_PASSWORD);
  await sleep(500, 1000);
  await page.click('[name="login"]');
  await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 });
  await verificarLoginSucesso(page); // throws if login failed or checkpoint hit
}

async function estaLogado(page) {
  try {
    await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(1500);
    // Only present in the authenticated feed — not on login page
    const loggedIn = await page.locator('[aria-label="Your profile"], [data-testid="royal_blue_bar"]').first().isVisible({ timeout: 4000 }).catch(() => false);
    // Fallback: if we're redirected back to /login, definitely not logged in
    if (page.url().includes("/login")) return false;
    return loggedIn;
  } catch (_) {
    return false;
  }
}

async function verificarLoginSucesso(page) {
  await sleep(2000, 3000);
  if (page.url().includes("/login") || page.url().includes("checkpoint")) {
    throw new Error("Login failed or checkpoint required. Check credentials or complete 2FA manually.");
  }
}

// ─── DM sender ───────────────────────────────────────────────
async function enviarDM(page, facebookUrl, nome) {
  try {
    const url = facebookUrl.startsWith("http") ? facebookUrl : `https://${facebookUrl}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2000, 3500);

    // Look for "Send message" button on the business page (Facebook current UI uses aria-label="Send message")
    const msgBtn = page.locator('[aria-label="Send message"], a:has-text("Send Message"), button:has-text("Message")').first();
    if (!await msgBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`  ✗ No Message button found: ${facebookUrl}`);
      return false;
    }

    await msgBtn.click();
    await sleep(2000, 3000);

    // Type in the Messenger compose box — focus explicitly before typing
    const inputBox = page.locator('[contenteditable="true"][aria-label*="message" i], [contenteditable="true"][aria-placeholder*="message" i], [contenteditable="true"]').first();
    await inputBox.waitFor({ timeout: 8000 });
    await inputBox.click(); // ensure focus
    await sleep(300, 600);
    for (const char of MENSAGEM(nome)) {
      await inputBox.type(char, { delay: 0 });
      await sleep(40, 130);
    }
    await sleep(800, 1500);

    // Send
    await page.keyboard.press("Enter");
    await sleep(1500, 2500);

    return true;
  } catch (err) {
    console.error(`  ✗ DM failed for ${facebookUrl}: ${err.message}`);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────
async function main() {
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
    headless: false, // Facebook requires visible browser to avoid detection
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
    if (!logado) await login(page); // login() throws if it fails — script stops cleanly
  } else {
    await login(page); // throws on failure
  }

  // Save session only after confirmed login — avoids persisting a bad session
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
```

- [ ] **Step 2: Test — verify it starts and reaches login screen**

```bash
node facebook-sender.js
```
Expected: Browser opens, navigates to Facebook login. On first run it will ask for credentials from `.env`. After login, `facebook-session.json` is created.

- [ ] **Step 3: Verify session persistence**

Run again:
```bash
node facebook-sender.js
```
Expected: Skips login, goes directly to first lead's Facebook page.

- [ ] **Step 4: Commit**

```bash
git add facebook-sender.js
git commit -m "feat: add Facebook Messenger bot for Ireland trades"
```

---

## Chunk 5: Final wiring

### Task 6: Create run scripts and update README

**Files:**
- Create: `ireland.bat` — double-click to run the scraper
- Create: `ireland-email.bat` — double-click to send emails
- Create: `ireland-fb.bat` — double-click to send Facebook DMs

- [ ] **Step 1: Create ireland.bat**

```bat
@echo off
cd /d "C:\Users\Win10\CLAUDE PROJETOS\minerador-leads"
node minerar-ireland.js
pause
```

- [ ] **Step 2: Create ireland-email.bat**

```bat
@echo off
cd /d "C:\Users\Win10\CLAUDE PROJETOS\minerador-leads"
node email-sender.js
pause
```

- [ ] **Step 3: Create ireland-fb.bat**

```bat
@echo off
cd /d "C:\Users\Win10\CLAUDE PROJETOS\minerador-leads"
node facebook-sender.js
pause
```

- [ ] **Step 4: Full end-to-end test**

1. Run `ireland.bat` — verify leads appear in `Leads-Ireland` Google Sheet
2. Run `ireland-email.bat` — verify column M shows `Email Sent ✓` for sent leads
3. Run `ireland-fb.bat` — verify column M shows `FB Sent ✓` for DM'd leads

- [ ] **Step 5: Final commit**

```bash
git add ireland.bat ireland-email.bat ireland-fb.bat
git commit -m "feat: add bat launchers for Ireland scraper and outreach"
```

---

## Daily workflow (after setup)

1. Morning: run `ireland.bat` — mines new leads
2. Then: run `ireland-email.bat` — sends up to 50 cold emails
3. Then: run `ireland-fb.bat` — sends up to 20 Facebook DMs
4. Check Google Sheet `Leads-Ireland` for replies — handle manually
