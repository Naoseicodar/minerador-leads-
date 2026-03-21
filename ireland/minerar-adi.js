/**
 * RSA ADI Miner — Approved Driving Instructors Ireland
 * Scrapa o diretorio oficial da RSA por condado
 * Salva na aba Leads-ADI da planilha Ireland
 * Usage: node minerar-adi.js
 */

require("dotenv").config();
const puppeteer = require("puppeteer");
const { google } = require("googleapis");
const https = require("https");
const http = require("http");
const dns = require("dns").promises;
const path = require("path");
const fs = require("fs");

// =============================================
// CONFIG
// =============================================
const SHEET_ID = process.env.SHEET_ID_IRELAND;
const SHEET_TAB = "Leads-ADI";
const RSA_URL = "https://www.rsa.ie/services/learner-drivers/driving-lessons/find-an-instructor/approved-driving-instructor";

const COUNTIES = [
  "Carlow", "Cavan", "Clare", "Cork", "Donegal", "Dublin",
  "Galway", "Kerry", "Kildare", "Kilkenny", "Laois", "Leitrim",
  "Limerick", "Longford", "Louth", "Mayo", "Meath", "Monaghan",
  "Offaly", "Roscommon", "Sligo", "Tipperary", "Waterford",
  "Westmeath", "Wexford", "Wicklow"
];

const CABECALHO = [
  "Status do Lead",   // A
  "Nome",             // B
  "Nicho",            // C
  "Telefone",         // D
  "Email",            // E
  "Facebook",         // F
  "Website",          // G
  "Rua",              // H
  "Area",             // I
  "Cidade",           // J
  "County",           // K
  "Avaliacao",        // L
  "Nr Avaliacoes",    // M
  "Link",             // N
  "Data da Busca",    // O
  "Observacoes",      // P
];

// =============================================
// EMAIL SEARCH UTILS
// =============================================
const DIRETORIOS = [
  "yelp.com", "goldenpages.ie", "trustpilot.com", "facebook.com", "instagram.com",
  "linkedin.com", "twitter.com", "x.com", "yellowpages.ie", "businessfinder.ie",
  "google.com", "maps.google", "ie.trustpilot.com", "cylex.ie", "hotfrog.ie",
  "local.ie", "brownbook.net", "foursquare.com", "tripadvisor.com", "bark.com",
  "checkatrade.com", "rated.ie", "ratedpeople.com", "mybuilder.com", "yell.com",
];

function ehDiretorio(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return DIRETORIOS.some(d => host === d || host.endsWith("." + d));
  } catch (_) { return false; }
}

function extrairEmail(html) {
  const regex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const ignorar = ["sentry", "example", "@email.", "@dominio", "@seu", "@wix", "shopify",
    "noreply", "no-reply", ".png", ".jpg", ".gif", ".svg", "schema.org",
    "google", "facebook", "bootstrap", "jquery", "wordpress", "amazon",
    "w3.org", "schema", "emailprotected", "yourdomain", "test@", "info@example",
    "support@", "abuse@", "postmaster@", "webmaster@example",
    "duckduckgo", "bing.com", "yahoo", "cloudflare", "squarespace",
    "privacy@", "legal@", "dmca@", "spam@", "phishing@"];
  const matches = html.match(regex) || [];
  const candidatos = matches.filter(e => !ignorar.some(i => e.toLowerCase().includes(i)));
  return candidatos.find(e => e.endsWith(".ie"))
    || candidatos.find(e => e.includes("@gmail") || e.includes("@hotmail") || e.includes("@outlook"))
    || candidatos[0]
    || "";
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      timeout: 6000
    }, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", c => { data += c; if (data.length > 200000) req.destroy(); });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

function comTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), ms))
  ]);
}

function extrairDominio(url) {
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
  } catch (_) { return ""; }
}

async function buscarEmailNoSite(url) {
  try {
    const html = await comTimeout(httpsGet(url), 5000);
    return extrairEmail(html) || "";
  } catch (_) { return ""; }
}

async function buscarEmailViaDuckDuckGo(nome, county) {
  const queries = [
    `"${nome}" email ${county} Ireland driving instructor`,
    `"${nome}" contact ${county} Ireland`,
  ];
  for (const q of queries) {
    try {
      const html = await comTimeout(
        httpsGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`),
        5000
      );
      const email = extrairEmail(html);
      if (email) return email;
    } catch (_) {}
  }
  return "";
}

async function buscarSiteViaBing(nome, county) {
  try {
    const q1 = encodeURIComponent(`"${nome}" ${county} Ireland driving instructor site:.ie`);
    const html1 = await comTimeout(
      httpsGet(`https://www.bing.com/search?q=${q1}&setlang=en-IE&cc=IE`),
      8000
    );
    const regex = /https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+\.ie)(?:\/[^\s"<]*)?/g;
    const matches1 = [...(html1.matchAll(regex) || [])].map(m => m[0]);
    const urlPropria1 = matches1.find(u => !ehDiretorio(u));
    if (urlPropria1) return urlPropria1;

    const q2 = encodeURIComponent(`${nome} ${county} Ireland driving`);
    const html2 = await comTimeout(
      httpsGet(`https://www.bing.com/search?q=${q2}&setlang=en-IE&cc=IE`),
      8000
    );
    const urlRegex = /https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+\.[a-z]{2,})(?:\/[^\s"<]*)?/g;
    const matches2 = [...(html2.matchAll(urlRegex) || [])].map(m => m[0]);
    return matches2.find(u => !ehDiretorio(u) && !u.includes("bing.com") && !u.includes("microsoft.com")) || "";
  } catch (_) { return ""; }
}

async function dominioTemMX(dominio) {
  try {
    const records = await dns.resolveMx(dominio);
    return records && records.length > 0;
  } catch (_) { return false; }
}

async function tentarEmailGuessing(nomeBusiness, dominio) {
  if (!dominio || ehDiretorio("https://" + dominio)) return "";
  const temMX = await dominioTemMX(dominio).catch(() => false);
  if (!temMX) return "";
  return `info@${dominio}`;
}

async function buscarEmailADI(nome, website, county) {
  let email = "";

  // Camada 1: scrape do site próprio (se tiver na RSA)
  if (website && !ehDiretorio(website)) {
    email = await buscarEmailNoSite(website).catch(() => "");
    if (email) return email;
  }

  // Camada 2: DuckDuckGo
  email = await buscarEmailViaDuckDuckGo(nome, county).catch(() => "");
  if (email) return email;

  // Camada 3: Bing para site próprio + email guessing
  const siteViaBing = await buscarSiteViaBing(nome, county).catch(() => "");
  if (siteViaBing) {
    const dominio = extrairDominio(siteViaBing);
    if (dominio) {
      email = await buscarEmailNoSite(siteViaBing).catch(() => "");
      if (email) return email;
      email = await tentarEmailGuessing(nome, dominio).catch(() => "");
      if (email) return email;
    }
  }

  return "";
}

// =============================================
// GOOGLE SHEETS
// =============================================
let _sheetsClient = null;

async function getSheets() {
  if (_sheetsClient) return _sheetsClient;

  let auth;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    const raw = process.env.GOOGLE_CREDENTIALS_JSON;
    const json = raw.trimStart().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    auth = new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  } else {
    const CREDS_PATH = path.resolve(process.cwd(), process.env.GOOGLE_CREDENTIALS_PATH);
    auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  }

  _sheetsClient = google.sheets({ version: "v4", auth: await auth.getClient() });
  return _sheetsClient;
}

async function garantirAba() {
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const abas = meta.data.sheets.map(s => s.properties.title);

  if (!abas.includes(SHEET_TAB)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: SHEET_TAB } } }]
      }
    });
    console.log(`[sheets] Aba "${SHEET_TAB}" criada.`);
  }

  // Escreve cabecalho
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A1:P1`,
    valueInputOption: "RAW",
    requestBody: { values: [CABECALHO] }
  });
}

async function getExistingPhones() {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!D2:D2000`
  });
  const rows = res.data.values || [];
  return new Set(rows.map(r => (r[0] || "").replace(/\s/g, "")));
}

async function appendLeads(leads) {
  if (leads.length === 0) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: leads }
  });
  console.log(`[sheets] ${leads.length} leads adicionados.`);
}

// =============================================
// UTILS
// =============================================
function sleep(min, max) {
  const ms = max ? Math.floor(Math.random() * (max - min) + min) : min;
  return new Promise(r => setTimeout(r, ms));
}

function limpar(txt) {
  if (!txt) return "";
  return String(txt).replace(/[\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizePhone(phone) {
  if (!phone) return "";
  let p = phone.replace(/[\s\-().]/g, "");
  if (p.startsWith("00353")) return "+" + p.slice(2);
  if (p.startsWith("353")) return "+" + p;
  if (p.startsWith("0")) return "+353" + p.slice(1);
  if (p.startsWith("+")) return p;
  return "+353" + p;
}

// =============================================
// SCRAPER RSA
// =============================================
async function selectOption(page, selector, value) {
  try {
    await page.waitForSelector(selector, { timeout: 4000 });
    await page.select(selector, value);
    return true;
  } catch (_) {
    return false;
  }
}

async function scrapeCounty(page, county, existingPhones) {
  console.log(`\n[rsa] Buscando condado: ${county}`);
  const leads = [];

  try {
    await page.goto(RSA_URL, { waitUntil: "networkidle0", timeout: 30000 });
    await sleep(2000, 3000);

    // Tenta selecionar categoria Car
    const catSelectors = [
      'select[name*="category"]', 'select[id*="category"]',
      'select[name*="Category"]', 'select[id*="licenceCategory"]'
    ];
    for (const sel of catSelectors) {
      try {
        const opts = await page.$$eval(`${sel} option`, els => els.map(e => ({ v: e.value, t: e.innerText })));
        const car = opts.find(o => /car|B|passenger/i.test(o.t));
        if (car) { await page.select(sel, car.v); break; }
      } catch (_) {}
    }

    // Seleciona o condado
    const countySelectors = [
      'select[name*="county"]', 'select[id*="county"]',
      'select[name*="County"]', 'select[name*="location"]', 'select[id*="location"]'
    ];
    let countySelected = false;
    for (const sel of countySelectors) {
      try {
        const opts = await page.$$eval(`${sel} option`, els => els.map(e => ({ v: e.value, t: e.innerText })));
        const match = opts.find(o => o.t.toLowerCase().includes(county.toLowerCase()));
        if (match) {
          await page.select(sel, match.v);
          countySelected = true;
          break;
        }
      } catch (_) {}
    }

    if (!countySelected) {
      // Tenta input de texto
      const inputSels = ['input[name*="county"]', 'input[placeholder*="county"]', 'input[name*="location"]'];
      for (const sel of inputSels) {
        try {
          await page.waitForSelector(sel, { timeout: 2000 });
          await page.type(sel, county);
          countySelected = true;
          break;
        } catch (_) {}
      }
    }

    await sleep(500);

    // Clica em Search/Submit
    const btnSels = ['button[type="submit"]', 'input[type="submit"]', 'button.search-btn', 'button.btn-search'];
    for (const sel of btnSels) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        await page.click(sel);
        break;
      } catch (_) {}
    }

    await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
    await sleep(2000, 3000);

    // Extrai resultados
    const resultados = await page.evaluate(() => {
      const items = [];

      const cards = document.querySelectorAll(
        ".adi-result, .instructor-card, .search-result, .result-item, " +
        "table tbody tr, .adi-list li, .instructor-list li, " +
        "[class*='result'], [class*='instructor'], [class*='adi-item']"
      );

      cards.forEach(card => {
        const text = (card.innerText || "").trim();
        if (!text || text.length < 10) return;

        const phoneMatch = text.match(/(?:\+353|0\d)[\d\s\-]{7,13}/);
        const phone = phoneMatch ? phoneMatch[0].trim() : "";
        const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        const email = emailMatch ? emailMatch[0] : "";
        const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
        const name = lines[0] || "";
        const websiteEl = card.querySelector('a[href^="http"]:not([href*="rsa.ie"])');
        const website = websiteEl ? websiteEl.href : "";

        if (phone || email) items.push({ name, phone, email, website });
      });

      // Fallback: extrai todos os telefones da pagina
      if (items.length === 0) {
        const body = document.body.innerText;
        const phones = [...new Set((body.match(/(?:\+353|0\d)[\d\s\-]{7,13}/g) || []))];
        phones.slice(0, 100).forEach(p => items.push({ name: "", phone: p.trim(), email: "" }));
      }

      return items;
    });

    if (resultados.length === 0) {
      console.log(`[rsa] Nenhum resultado para ${county}`);
      await page.screenshot({ path: `debug-adi-${county}.png` });
    }

    const hoje = new Date().toLocaleDateString("pt-BR");

    for (const r of resultados) {
      const phone = normalizePhone(r.phone);
      if (!phone || existingPhones.has(phone.replace(/\s/g, ""))) continue;
      existingPhones.add(phone.replace(/\s/g, ""));

      const nome = limpar(r.name) || "ADI Instructor";

      // Busca email em camadas se não veio direto da página RSA
      let email = r.email || "";
      if (!email) {
        const website = r.website || "";
        console.log(`  [email] Buscando email para ${nome}...`);
        email = await buscarEmailADI(nome, website, county).catch(() => "");
        if (email) console.log(`  [email] Encontrado: ${email}`);
      }

      leads.push([
        "Not Contacted",
        nome,
        "Driving Instructor",
        phone,
        email || "",
        "", "", "", "",
        county, county,
        "", "", RSA_URL,
        hoje, ""
      ]);
    }

    console.log(`[rsa] ${county}: ${leads.length} leads novos`);
  } catch (err) {
    console.error(`[rsa] Erro em ${county}:`, err.message);
  }

  return leads;
}

// =============================================
// MAIN
// =============================================
async function main() {
  console.log("=== RSA ADI Miner ===");
  console.log(`Planilha: ${SHEET_ID} | Aba: ${SHEET_TAB}`);

  await garantirAba();
  const existingPhones = await getExistingPhones();
  console.log(`[sheets] ${existingPhones.size} telefones ja existentes`);

  const browser = await puppeteer.launch({
    headless: false, // visivel para passar bloqueios
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--lang=en-IE"]
  });

  const page = await browser.newPage();

  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");

  // Remove sinais de automacao
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  let totalLeads = 0;

  // Primeira visita para aceitar cookies
  try {
    await page.goto(RSA_URL, { waitUntil: "networkidle0", timeout: 30000 });
    await sleep(2000);
    const cookieBtns = ['button[id*="accept"]', 'button[class*="accept"]', 'button[class*="cookie"]'];
    for (const sel of cookieBtns) {
      try {
        await page.click(sel, { timeout: 2000 });
        await sleep(1000);
        break;
      } catch (_) {}
    }
  } catch (err) {
    console.log("[rsa] Aviso na visita inicial:", err.message);
  }

  for (const county of COUNTIES) {
    const leads = await scrapeCounty(page, county, existingPhones);
    if (leads.length > 0) {
      await appendLeads(leads);
      totalLeads += leads.length;
    }
    await sleep(3000, 5000);
  }

  await browser.close();

  console.log(`\n=== CONCLUIDO ===`);
  console.log(`Total de leads minerados: ${totalLeads}`);
  console.log(`Aba: ${SHEET_TAB} na planilha Ireland`);
}

main().catch(err => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
