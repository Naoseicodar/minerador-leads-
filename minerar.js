/**
 * Minerador de Leads — Google Maps + Google Sheets
 * Playwright (gratuito) + googleapis
 * Uso: node minerar.js
 */

const { chromium } = require("playwright");
const { google } = require("googleapis");
const https = require("https");
const http = require("http");
const path = require("path");

// =============================================
// CONFIGURACOES
// =============================================
const CONFIG = {
  credenciaisPath: path.join(__dirname, "credentials.json"),
  sheetId: "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI",
  sheetNome: "Leads",

  termo: "clinica estetica",
  cidade: "Curitiba",

  bairros: [
    "Centro", "Batel", "Agua Verde", "Bigorrilho", "Mercês",
    "Santa Felicidade", "Boa Vista", "Ahú", "Cabral", "Hugo Lange",
    "Juvevê", "Champagnat", "Ecoville", "Portão", "Fazendinha",
    "Pinheirinho", "Sítio Cercado", "CIC", "Cajuru", "Uberaba",
    "Bacacheri", "Tingui", "Tatuquara", "Xaxim", "Rebouças"
  ],

  maxScroll: 6,
  headless: true,
  delayMin: 300,
  delayMax: 600,
  paginasParalelas: 2,   // páginas simultâneas para visitar places
};

const NAO = "Não encontrado";

// =============================================
// CABECALHO (14 colunas)
// =============================================
const CABECALHO = [
  "Nome da Empresa",      // A
  "Telefone",             // B
  "Website",              // C
  "Endereço",             // D
  "Bairro",               // E
  "CEP",                  // F
  "Avaliação Google ⭐",  // G
  "Nº Avaliações",        // H
  "Categoria",            // I
  "Email",                // J
  "Instagram",            // K
  "Status do Lead",       // L
  "Data da Busca",        // M
  "Observações",          // N
];

const LARGURAS = [240, 145, 210, 260, 120, 100, 130, 120, 160, 210, 190, 155, 130, 220];

// =============================================
// UTILITARIOS
// =============================================
function sleep(min, max) {
  const ms = max ? Math.floor(Math.random() * (max - min) + min) : min;
  return new Promise(r => setTimeout(r, ms));
}

function comTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout global")), ms))
  ]);
}

function limpar(txt) {
  if (!txt) return "";
  return String(txt).replace(/["\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
}

function val(txt) {
  const v = limpar(txt);
  return v || NAO;
}

function formatarTelefone(raw) {
  if (!raw) return NAO;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0,2)}) ${d.slice(2,6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0,2)}) ${d.slice(2,7)}-${d.slice(7)}`;
  return raw;
}

// =============================================
// EMAIL + INSTAGRAM — paralelo, homepage única
// =============================================
function extrairEmail(html) {
  const regex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const ignorar = ["sentry", "example", "@email.", "@dominio", "@seu", "@wix", "shopify",
    "noreply", "no-reply", ".png", ".jpg", ".gif", ".svg", "schema.org",
    "google", "facebook", "bootstrap", "jquery", "wordpress", "amazon"];
  const matches = html.match(regex) || [];
  return matches.find(e => !ignorar.some(i => e.toLowerCase().includes(i))) || "";
}

function extrairInstagram(html) {
  const match = html.match(/(?:instagram\.com|instagr\.am)\/([a-zA-Z0-9_.]{2,30})/);
  if (!match) return NAO;
  const u = match[1].replace(/\/$/, "");
  if (["p", "reel", "explore", "stories", "tv"].includes(u)) return NAO;
  return `instagram.com/${u}`;
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

// Busca email e instagram de uma vez, com páginas em paralelo
async function buscarSiteInfo(website) {
  if (!website || website === NAO) return { email: NAO, instagram: NAO };
  const base = website.replace(/\/$/, "");
  const paginas = ["", "/contato", "/contact", "/fale-conosco", "/sobre"];

  // Busca todas as páginas em paralelo
  const resultados = await Promise.allSettled(
    paginas.map(p => comTimeout(httpsGet(base + p), 6000))
  );

  let email = NAO;
  let instagram = NAO;

  for (const r of resultados) {
    if (r.status !== "fulfilled" || !r.value) continue;
    const html = r.value;

    if (instagram === NAO) instagram = extrairInstagram(html);

    if (email === NAO) {
      const mailtoMatch = html.match(/href=["']mailto:([^"'?]+)/i);
      if (mailtoMatch && mailtoMatch[1].includes("@")) {
        email = mailtoMatch[1].trim();
      } else {
        const found = extrairEmail(html);
        if (found) email = found;
      }
    }

    if (email !== NAO && instagram !== NAO) break;
  }

  return { email, instagram };
}

// =============================================
// GOOGLE SHEETS
// =============================================
async function criarSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CONFIG.credenciaisPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function garantirCabecalho(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A1:N1`,
  }).catch(() => null);

  const atual = res?.data?.values?.[0] || [];
  if (atual[0] === CABECALHO[0] && atual.length === CABECALHO.length) {
    console.log("  → Planilha pronta");
    return;
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId: CONFIG.sheetId, range: CONFIG.sheetNome });

  const info = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.sheetId });
  const gid = info.data.sheets[0].properties.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [CABECALHO] },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: CONFIG.sheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: { sheetId: gid, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.13, green: 0.27, blue: 0.53 },
                textFormat: { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1 } },
                horizontalAlignment: "CENTER",
                verticalAlignment: "MIDDLE",
              }
            },
            fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
          }
        },
        { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
        { setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: CABECALHO.length } } } },
        { updateDimensionProperties: { range: { sheetId: gid, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: "pixelSize" } },
        {
          setDataValidation: {
            range: { sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 11, endColumnIndex: 12 },
            rule: {
              condition: {
                type: "ONE_OF_LIST",
                values: [
                  { userEnteredValue: "Não contatado" },
                  { userEnteredValue: "Em contato" },
                  { userEnteredValue: "Proposta enviada" },
                  { userEnteredValue: "Convertido ✓" },
                  { userEnteredValue: "Sem interesse" },
                  { userEnteredValue: "Sem resposta" },
                ]
              },
              showCustomUi: true, strict: false
            }
          }
        },
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Convertido" }] }, format: { backgroundColor: { red: 0.83, green: 0.95, blue: 0.83 } } }
            }, index: 0
          }
        },
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Sem interesse" }] }, format: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } }
            }, index: 1
          }
        },
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Em contato" }] }, format: { backgroundColor: { red: 1, green: 0.97, blue: 0.8 } } }
            }, index: 2
          }
        },
        {
          addBanding: {
            bandedRange: {
              range: { sheetId: gid, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: CABECALHO.length },
              rowProperties: {
                firstBandColor:  { red: 0.93, green: 0.93, blue: 0.93 },
                secondBandColor: { red: 0.98, green: 0.98, blue: 0.98 },
              }
            }
          }
        },
        ...LARGURAS.map((px, i) => ({
          updateDimensionProperties: {
            range: { sheetId: gid, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 },
            properties: { pixelSize: px }, fields: "pixelSize"
          }
        })),
      ]
    }
  });

  console.log("  ✓ Planilha configurada");
}

async function carregarChavesExistentes(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A2:D`,
  }).catch(() => null);

  const chaves = new Set();
  const rows = res?.data?.values || [];
  for (const row of rows) {
    const nome = row[0] || "";
    const telefone = row[1] || "";
    const endereco = row[3] || "";
    if (telefone && telefone !== NAO) chaves.add(telefone.replace(/\D/g, ""));
    if (nome && endereco) chaves.add(`${nome}|${endereco}`);
  }
  console.log(`  → ${chaves.size} leads já existentes carregados`);
  return chaves;
}

function formatarLinha(lead) {
  return [
    val(lead.nome),
    lead.telefone ? formatarTelefone(lead.telefone) : NAO,
    val(lead.website),
    val(lead.endereco),
    val(lead.bairro),
    val(lead.cep),
    lead.avaliacao || NAO,
    lead.reviews || NAO,
    val(lead.categoria),
    val(lead.email),
    val(lead.instagram),
    "Não contatado",
    new Date().toLocaleDateString("pt-BR"),
    "",
  ];
}

// Escreve lote de leads de uma vez (uma chamada API por bairro)
async function appendLote(sheets, leads) {
  if (!leads.length) return;
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: leads.map(formatarLinha) },
  });
}

// =============================================
// SCRAPER GOOGLE MAPS
// =============================================
async function fecharCookies(page) {
  try {
    const btn = page.locator('button:has-text("Aceitar tudo"), button:has-text("Accept all")').first();
    if (await btn.isVisible({ timeout: 2000 })) await btn.click();
    await sleep(300);
  } catch (_) {}
}

async function extrairDadosPlace(page) {
  const d = { nome: "", telefone: "", website: "", endereco: "", cep: "", avaliacao: "", reviews: "", categoria: "" };
  try {
    d.nome = (await page.locator("h1").first().textContent({ timeout: 4000 }).catch(() => "")).trim();

    const ratingLabel = await page.locator('[aria-label*="estrela"], [aria-label*="star"]').first().getAttribute("aria-label", { timeout: 1500 }).catch(() => "");
    const rm = ratingLabel.match(/[\d,\.]+/);
    if (rm) d.avaliacao = rm[0].replace(",", ".");

    const reviewLabel = await page.locator('[aria-label*="valiaç"], [aria-label*="review"]').first().getAttribute("aria-label", { timeout: 1500 }).catch(() => "");
    const rvm = reviewLabel.match(/(\d[\d\.]*)/);
    if (rvm) d.reviews = rvm[0].replace(/\./g, "");

    d.categoria = await page.locator('button[jsaction*="category"]').first().textContent({ timeout: 1500 }).catch(() => "");

    const phoneEl = page.locator('[data-item-id^="phone"]').first();
    if (await phoneEl.isVisible({ timeout: 1500 }).catch(() => false)) {
      const lbl = await phoneEl.getAttribute("aria-label").catch(() => "");
      d.telefone = lbl.replace(/^Telefone:\s*/i, "").trim();
    }

    const siteEl = page.locator('[data-item-id="authority"]').first();
    if (await siteEl.isVisible({ timeout: 1500 }).catch(() => false)) {
      d.website = await siteEl.getAttribute("href").catch(() => "");
    }

    const endEl = page.locator('[data-item-id="address"]').first();
    if (await endEl.isVisible({ timeout: 1500 }).catch(() => false)) {
      const lbl = await endEl.getAttribute("aria-label").catch(() => "");
      d.endereco = lbl.replace(/^Endereço:\s*/i, "").trim();
      const cm = d.endereco.match(/\d{5}-?\d{3}/);
      if (cm) d.cep = cm[0];
    }
  } catch (_) {}
  return d;
}

async function rasparBairro(page, bairro) {
  const query = encodeURIComponent(`${CONFIG.termo} em ${bairro} ${CONFIG.cidade}`);
  const links = new Set();

  await page.goto(`https://www.google.com/maps/search/${query}?hl=pt-BR`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await fecharCookies(page);

  const feed = page.locator('div[role="feed"]');
  await feed.waitFor({ timeout: 15000 }).catch(() => null);
  await sleep(1000, 1800);

  for (let s = 0; s <= CONFIG.maxScroll; s++) {
    const hrefs = await page.locator('a[href*="/maps/place/"]').evaluateAll(els => els.map(a => a.href));
    hrefs.forEach(h => links.add(h.split("?")[0].split("@")[0]));

    if (s < CONFIG.maxScroll) {
      await feed.evaluate(el => el.scrollBy(0, 1000)).catch(() => page.evaluate(() => window.scrollBy(0, 1000)));
      await sleep(700, 1100);
      const fim = await page.locator('text="Você chegou ao fim"').isVisible().catch(() => false);
      if (fim) break;
    }
  }

  return [...links];
}

// Processa um link e retorna o lead ou null
async function processarLink(page, link, bairro, chavesVistas, chavesExistentes) {
  try {
    await page.goto(link + "?hl=pt-BR", { waitUntil: "domcontentloaded", timeout: 18000 });
    await sleep(CONFIG.delayMin, CONFIG.delayMax);

    const dados = await extrairDadosPlace(page);
    if (!dados.nome) return null;

    const chaveNome = `${dados.nome}|${dados.endereco}`;
    const chaveTel = dados.telefone ? dados.telefone.replace(/\D/g, "") : "";
    const chave = chaveTel || chaveNome;

    if (chavesVistas.has(chave) || chavesExistentes.has(chaveTel) || chavesExistentes.has(chaveNome)) return null;
    chavesVistas.add(chave);

    const lead = { ...dados, bairro, email: NAO, instagram: NAO };

    if (dados.website) {
      const info = await comTimeout(buscarSiteInfo(dados.website), 18000).catch(() => ({ email: NAO, instagram: NAO }));
      lead.email = info.email;
      lead.instagram = info.instagram;
    }

    return lead;
  } catch (_) {
    return null;
  }
}

// =============================================
// MAIN
// =============================================
async function main() {
  console.log("\n");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║     MINERADOR DE LEADS               ║");
  console.log("  ║     Google Maps → Google Sheets      ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log(`\n  Termo:   ${CONFIG.termo} — ${CONFIG.cidade}`);
  console.log(`  Bairros: ${CONFIG.bairros.length}\n`);
  console.log("  ──────────────────────────────────────");

  const sheets = await criarSheets();
  await garantirCabecalho(sheets);
  const chavesExistentes = await carregarChavesExistentes(sheets);

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--lang=pt-BR",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
    ]
  });

  const criarPagina = async () => {
    const ctx = await browser.newContext({
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 }
    });
    const pg = await ctx.newPage();
    await pg.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,css}", r => r.abort());
    return pg;
  };

  // Página principal para navegar nos bairros
  const pagePrincipal = await criarPagina();
  // Páginas paralelas para visitar places
  const pagesParalelas = await Promise.all(
    Array.from({ length: CONFIG.paginasParalelas }, () => criarPagina())
  );

  const chavesVistas = new Set();
  let totalLeads = 0;
  let totalEmail = 0;
  let totalInsta = 0;

  for (let i = 0; i < CONFIG.bairros.length; i++) {
    const bairro = CONFIG.bairros[i];
    const prog = `[${String(i + 1).padStart(2, "0")}/${CONFIG.bairros.length}]`;

    process.stdout.write(`\n  ${prog} ${bairro}: buscando...`);

    const links = await rasparBairro(pagePrincipal, bairro).catch(() => []);
    process.stdout.write(` ${links.length} lugares`);

    const leadsDoLote = [];
    let processados = 0;

    // Processa em lotes usando páginas paralelas
    for (let j = 0; j < links.length; j += CONFIG.paginasParalelas) {
      const bloco = links.slice(j, j + CONFIG.paginasParalelas);
      const resultados = await Promise.all(
        bloco.map((link, idx) => processarLink(pagesParalelas[idx], link, bairro, chavesVistas, chavesExistentes))
      );

      for (const lead of resultados) {
        processados++;
        if (!lead) continue;
        leadsDoLote.push(lead);
        if (lead.email !== NAO) totalEmail++;
        if (lead.instagram !== NAO) totalInsta++;
      }

      process.stdout.write(`\r  ${prog} ${bairro}: ${processados}/${links.length} | novos: ${leadsDoLote.length}        `);
    }

    // Escreve todos os leads do bairro de uma vez
    await appendLote(sheets, leadsDoLote);
    totalLeads += leadsDoLote.length;

    process.stdout.write(`\r  ${prog} ${bairro}: ${leadsDoLote.length} leads salvos ✓                          `);
  }

  await browser.close();

  console.log("\n\n  ══════════════════════════════════════");
  console.log(`  ✓ Total de leads:   ${totalLeads}`);
  console.log(`  ✓ Com email:        ${totalEmail}`);
  console.log(`  ✓ Com Instagram:    ${totalInsta}`);
  console.log(`\n  https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}`);
  console.log("  ══════════════════════════════════════\n");
}

main().catch(err => {
  console.error("\n  ERRO FATAL:", err.message);
  process.exit(1);
});
