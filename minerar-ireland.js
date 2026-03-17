/**
 * Ireland Business Miner — Google Maps + Google Sheets
 * Todos os tipos de negocio sem website — filtro: >= 4.0 estrelas, >= 20 avaliacoes
 * Playwright + googleapis
 * Usage: node minerar-ireland.js
 */

require("dotenv").config();
const { chromium } = require("playwright");
const { google } = require("googleapis");
const https = require("https");
const http = require("http");
const dns = require("dns").promises;
const path = require("path");
const fs = require("fs");

// =============================================
// CONFIGURACOES
// =============================================
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

const CONFIG = {
  credenciaisPath: path.join(__dirname, "credentials.json"),
  sheetId: process.env.SHEET_ID_IRELAND || "",
  sheetNome: process.env.SHEET_ABA_IRELAND || "Leads-Ireland",

  minEstrelas: Number(process.env.MIN_ESTRELAS) || 4.0,
  minAvaliacoes: Number(process.env.MIN_AVALIACOES) || 20,

  maxScroll: 6,
  headless: true,
  delayMin: 150,
  delayMax: 300,
  paginasParalelas: 4,
  limiteDiario: Number(process.env.LIMITE_DIARIO) || 200,
};

const PROGRESSO_PATH = path.join(__dirname, "progresso-ireland.json");

function carregarProgresso() {
  try {
    const data = JSON.parse(fs.readFileSync(PROGRESSO_PATH, "utf8"));
    return { cidadeIdx: data.cidadeIdx || 0, bairroIdx: data.bairroIdx || 0 };
  } catch (_) {
    return { cidadeIdx: 0, bairroIdx: 0 };
  }
}

function salvarProgresso(cidadeIdx, bairroIdx) {
  fs.writeFileSync(PROGRESSO_PATH, JSON.stringify({ cidadeIdx, bairroIdx }), "utf8");
}

function limparProgresso() {
  try { fs.unlinkSync(PROGRESSO_PATH); } catch (_) {}
}

const NAO = "Não encontrado";

// =============================================
// CABECALHO (12 colunas)
// =============================================
const CABECALHO = [
  "Status do Lead",       // A  ← primeiro para acompanhamento imediato
  "Nome da Empresa",      // B
  "Telefone",             // C
  "Email",                // D
  "Facebook",             // E
  "Website",              // F
  "Endereço",             // G
  "City",                 // H
  "Avaliação Google ⭐",  // I
  "Nº Avaliações",        // J
  "Link Maps",            // K
  "Data da Busca",        // L
  "Observações",          // M
];

const LARGURAS = [150, 220, 145, 205, 185, 195, 245, 125, 125, 110, 220, 115, 220];

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
  return raw.trim();
}

// =============================================
// EMAIL + FACEBOOK — scraping e busca DuckDuckGo
// =============================================

// Domínios de diretórios — presença aqui NÃO significa que o negócio tem site próprio
const DIRETORIOS = [
  "yelp.com", "goldenpages.ie", "trustpilot.com", "facebook.com", "instagram.com",
  "linkedin.com", "twitter.com", "x.com", "yellowpages.ie", "businessfinder.ie",
  "google.com", "maps.google", "ie.trustpilot.com", "cylex.ie", "hotfrog.ie",
  "local.ie", "brownbook.net", "foursquare.com", "tripadvisor.com", "bark.com",
  "checkatrade.com", "rated.ie", "ratedpeople.com", "mybuilder.com", "yell.com",
  "bizify.ie", "kompass.com", "dnb.com", "companieshouse.gov.uk", "vision-net.ie",
];

function ehDiretorio(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return DIRETORIOS.some(d => host === d || host.endsWith("." + d));
  } catch (_) {
    return false;
  }
}

function extrairEmail(html) {
  const regex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const ignorar = ["sentry", "example", "@email.", "@dominio", "@seu", "@wix", "shopify",
    "noreply", "no-reply", ".png", ".jpg", ".gif", ".svg", "schema.org",
    "google", "facebook", "bootstrap", "jquery", "wordpress", "amazon",
    "w3.org", "schema", "emailprotected", "yourdomain", "test@", "info@example",
    "support@", "abuse@", "postmaster@", "webmaster@example",
    "duckduckgo", "bing.com", "yahoo", "cloudflare", "squarespace",
    "godaddy", "namecheap", "siteground", "bluehost", "hostgator",
    "privacy@", "legal@", "dmca@", "spam@", "phishing@"];
  const matches = html.match(regex) || [];
  const candidatos = matches.filter(e => !ignorar.some(i => e.toLowerCase().includes(i)));
  // Prefere emails com domínio .ie, depois gmail/hotmail, depois qualquer outro
  return candidatos.find(e => e.endsWith(".ie"))
    || candidatos.find(e => e.includes("@gmail") || e.includes("@hotmail") || e.includes("@outlook"))
    || candidatos[0]
    || "";
}

function extrairFacebook(html) {
  const match = html.match(/(?:facebook\.com)\/(?:pages\/)?([a-zA-Z0-9._\-]{3,80})/);
  if (!match) return NAO;
  const u = match[1].replace(/\/$/, "");
  if (["sharer", "share", "login", "groups", "events", "marketplace", "watch", "photo", "video", "ads"].includes(u)) return NAO;
  return `facebook.com/${u}`;
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

// Verifica links externos na página do Maps (Web results)
// Retorna { temSiteProprio: bool, urlDiretorio: string|null }
async function verificarWebResults(page) {
  try {
    // Pega apenas links dentro do painel de informações do negócio
    // Exclui links de navegação, botões de ação (Call, Directions, Share) e UI do Maps
    const hrefs = await page.locator('[data-section-id] a[href^="http"], [jslog] a[href^="http"]').evaluateAll(els =>
      els.map(a => a.href).filter(h =>
        h.startsWith("http") &&
        !h.includes("google.com") &&
        !h.includes("goo.gl") &&
        !h.includes("maps.app") &&
        !h.includes("apple.com") &&
        !h.includes("googleapis.com")
      )
    );

    const unicos = [...new Set(hrefs)];

    // Se QUALQUER link não for diretório → negócio tem site próprio
    const siteProprio = unicos.find(url => !ehDiretorio(url));
    if (siteProprio) return { temSiteProprio: true, urlDiretorio: null };

    // Todos são diretórios — pega o primeiro para scraping de email
    // Prioriza Golden Pages (maior diretório da Irlanda)
    const goldenPages = unicos.find(u => u.includes("goldenpages.ie"));
    const urlDiretorio = goldenPages || unicos[0] || null;

    return { temSiteProprio: false, urlDiretorio };
  } catch (_) {
    return { temSiteProprio: false, urlDiretorio: null };
  }
}

async function buscarEmailNoSite(url) {
  try {
    const html = await comTimeout(httpsGet(url), 5000);
    return extrairEmail(html) || "";
  } catch (_) {
    return "";
  }
}

async function buscarEmailViaDuckDuckGo(nome, cidade) {
  const queries = [
    `"${nome}" email ${cidade} Ireland`,
    `"${nome}" contact ${cidade} Ireland`,
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

async function buscarEmailGoldenPages(nome, cidade) {
  try {
    const q = encodeURIComponent(`${nome} ${cidade}`);
    const html = await comTimeout(
      httpsGet(`https://www.goldenpages.ie/q-business+local-where-${encodeURIComponent(cidade)}-adtype-paid-what-${encodeURIComponent(nome)}`),
      8000
    );
    return extrairEmail(html) || "";
  } catch (_) {
    return "";
  }
}

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

// ─── MX Validation ──────────────────────────────────────────
async function dominioTemMX(dominio) {
  try {
    const records = await dns.resolveMx(dominio);
    return records && records.length > 0;
  } catch (_) {
    return false;
  }
}

// Extrai domínio de uma URL
function extrairDominio(url) {
  try {
    return new URL(url.startsWith("http") ? url : "https://" + url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

// Email guessing: testa padrões comuns dado o nome do negócio e domínio
// Valida apenas via MX record (não envia nada)
async function tentarEmailGuessing(nomeBusiness, dominio) {
  if (!dominio || ehDiretorio("https://" + dominio)) return "";
  const temMX = await dominioTemMX(dominio).catch(() => false);
  if (!temMX) return "";

  // Padrões mais comuns para trades na Irlanda
  const prefixos = ["info", "hello", "contact", "admin", "office"];

  // Tenta extrair first name do nome do negócio (ex: "Murphy Plumbing" → "murphy")
  const palavras = nomeBusiness.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/);
  const primeiroNome = palavras[0];
  if (primeiroNome && primeiroNome.length > 2) prefixos.push(primeiroNome);

  // Retorna o primeiro padrão mais provável — info@ é o mais comum para trades
  // Não verificamos se a caixa existe (SMTP check bloqueado pela maioria)
  return `info@${dominio}`;
}

// ─── Bing Search para site próprio ──────────────────────────
async function buscarSiteViaBing(nome, cidade) {
  try {
    // Busca específica por site .ie com nome do negócio
    const q = encodeURIComponent(`"${nome}" ${cidade} Ireland site:.ie`);
    const html = await comTimeout(
      httpsGet(`https://www.bing.com/search?q=${q}&setlang=en-IE&cc=IE`),
      8000
    );
    // Extrai URLs .ie dos resultados
    const regex = /https?:\/\/(?:www\.)?([a-zA-Z0-9\-]+\.ie)(?:\/[^\s"<]*)?/g;
    const matches = [...(html.matchAll(regex) || [])].map(m => m[0]);
    const urlPropria = matches.find(u => !ehDiretorio(u));
    return urlPropria || "";
  } catch (_) {
    return "";
  }
}

// ─── Golden Pages Estruturado ────────────────────────────────
async function buscarGoldenPagesDireto(nome, cidade) {
  try {
    // goldenpages.ie tem estrutura de busca por termo + localização
    const nomeCodificado = encodeURIComponent(nome);
    const cidadeCodificada = encodeURIComponent(cidade);
    const url = `https://www.goldenpages.ie/q-business+local-where-${cidadeCodificada}-adtype-paid-what-${nomeCodificado}`;
    const html = await comTimeout(httpsGet(url), 5000);

    // Tenta extrair email e website da página de resultado
    const email = extrairEmail(html);
    const websiteMatch = html.match(/href=["'](https?:\/\/(?!www\.goldenpages)[^"']+)["']/);
    const website = websiteMatch ? websiteMatch[1] : "";

    return { email, website };
  } catch (_) {
    return { email: "", website: "" };
  }
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
  // Verifica se a aba existe, cria se não existir
  const info = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.sheetId });
  const abaExistente = info.data.sheets.find(s => s.properties.title === CONFIG.sheetNome);
  if (!abaExistente) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: CONFIG.sheetNome } } }] },
    });
    console.log(`  → Aba "${CONFIG.sheetNome}" criada`);
  }

  // Lê até Z para detectar qualquer estrutura, antiga ou nova
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A1:Z1`,
  }).catch(() => null);

  const cabecalhoAtual = res?.data?.values?.[0] || [];
  const infoAtual = await sheets.spreadsheets.get({ spreadsheetId: CONFIG.sheetId });
  const abaInfo = infoAtual.data.sheets.find(s => s.properties.title === CONFIG.sheetNome);
  const gid = abaInfo ? abaInfo.properties.sheetId : infoAtual.data.sheets[0].properties.sheetId;

  // Já está na estrutura nova — só aplica formatação
  if (cabecalhoAtual[0] === CABECALHO[0] && cabecalhoAtual.length === CABECALHO.length) {
    console.log("  → Planilha pronta");
    await aplicarFormatacao(sheets, gid);
    return;
  }

  // Detecta estrutura antiga (14 colunas, começa com "Nome da Empresa")
  const estruturaAntiga = cabecalhoAtual[0] === "Nome da Empresa" && cabecalhoAtual.length === 14;
  // Detecta estrutura v2 sem Link Maps (12 colunas, começa com "Status do Lead")
  const estruturaV2 = cabecalhoAtual[0] === "Status do Lead" && cabecalhoAtual.length === 12;
  let dadosMigrados = [];

  if (estruturaAntiga) {
    console.log("  → Estrutura antiga detectada, migrando dados...");
    const dadosRes = await sheets.spreadsheets.values.get({
      spreadsheetId: CONFIG.sheetId,
      range: `${CONFIG.sheetNome}!A2:N`,
    }).catch(() => null);

    const linhas = dadosRes?.data?.values || [];
    dadosMigrados = linhas.map(r => [
      r[11] || "Not Contacted",  // Status
      r[0]  || "",               // Nome
      r[1]  || "",               // Telefone
      r[9]  || "",               // Email
      r[10] || "",               // Facebook
      r[2]  || "",               // Website
      r[3]  || "",               // Endereço
      r[4]  || "",               // City
      r[6]  || "",               // Avaliação
      r[7]  || "",               // Nº Avaliações
      "",                        // Link Maps (novo)
      r[12] || "",               // Data
      r[13] || "",               // Observações
    ]);
    console.log(`  → ${dadosMigrados.length} leads serão migrados`);
  } else if (estruturaV2) {
    console.log("  → Estrutura v2 detectada, adicionando coluna Link Maps...");
    const dadosRes = await sheets.spreadsheets.values.get({
      spreadsheetId: CONFIG.sheetId,
      range: `${CONFIG.sheetNome}!A2:L`,
    }).catch(() => null);

    const linhas = dadosRes?.data?.values || [];
    dadosMigrados = linhas.map(r => [
      r[0]  || "Not Contacted",  // Status
      r[1]  || "",               // Nome
      r[2]  || "",               // Telefone
      r[3]  || "",               // Email
      r[4]  || "",               // Facebook
      r[5]  || "",               // Website
      r[6]  || "",               // Endereço
      r[7]  || "",               // City
      r[8]  || "",               // Avaliação
      r[9]  || "",               // Nº Avaliações
      "",                        // Link Maps (novo)
      r[10] || "",               // Data
      r[11] || "",               // Observações
    ]);
    console.log(`  → ${dadosMigrados.length} leads serão migrados`);
  }

  // Limpa e reescreve com nova estrutura + dados migrados
  await sheets.spreadsheets.values.clear({ spreadsheetId: CONFIG.sheetId, range: CONFIG.sheetNome });

  const novasLinhas = [CABECALHO, ...dadosMigrados];
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: novasLinhas },
  });

  if (estruturaAntiga || estruturaV2) console.log(`  ✓ ${dadosMigrados.length} leads migrados com sucesso`);

  await aplicarFormatacao(sheets, gid);
  console.log("  ✓ Planilha configurada");
}

async function aplicarFormatacao(sheets, gid) {
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
        {
          repeatCell: {
            range: { sheetId: gid, startRowIndex: 1, endRowIndex: 50000 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 1, green: 1, blue: 1 },
              }
            },
            fields: "userEnteredFormat.backgroundColor"
          }
        },
        { updateSheetProperties: { properties: { sheetId: gid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
        { setBasicFilter: { filter: { range: { sheetId: gid, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: CABECALHO.length } } } },
        { updateDimensionProperties: { range: { sheetId: gid, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: "pixelSize" } },
        {
          setDataValidation: {
            // Status do Lead agora é coluna A (index 0)
            range: { sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: 1 },
            rule: {
              condition: {
                type: "ONE_OF_LIST",
                values: [
                  { userEnteredValue: "Not Contacted" },
                  { userEnteredValue: "In Contact" },
                  { userEnteredValue: "Proposal Sent" },
                  { userEnteredValue: "Converted ✓" },
                  { userEnteredValue: "Not Interested" },
                  { userEnteredValue: "No Response" },
                ]
              },
              showCustomUi: true, strict: false
            }
          }
        },
        // Cores por status — aplica na linha inteira
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Converted" }] }, format: { backgroundColor: { red: 0.8, green: 0.94, blue: 0.8 } } }
            }, index: 0
          }
        },
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Proposal Sent" }] }, format: { backgroundColor: { red: 0.8, green: 0.9, blue: 1.0 } } }
            }, index: 1
          }
        },
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "In Contact" }] }, format: { backgroundColor: { red: 1, green: 0.97, blue: 0.8 } } }
            }, index: 2
          }
        },
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Not Interested" }] }, format: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } }
            }, index: 3
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
}

async function carregarChavesExistentes(sheets) {
  // Column order: A=Status, B=Name, C=Phone, D=Email, E=Facebook, F=Website, G=Address
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A2:G`,
  }).catch(() => null);

  const chaves = new Set();
  const rows = res?.data?.values || [];
  for (const row of rows) {
    const nome = row[1] || "";
    const telefone = row[2] || "";
    const endereco = row[6] || "";
    if (telefone && telefone !== NAO) chaves.add(telefone.replace(/\D/g, ""));
    if (nome && endereco) chaves.add(`${nome}|${endereco}`);
  }
  console.log(`  → ${chaves.size} leads já existentes carregados`);
  return chaves;
}

function formatarLinha(lead) {
  return [
    "Not Contacted",
    val(lead.nome),
    lead.telefone ? formatarTelefone(lead.telefone) : NAO,
    val(lead.email),
    val(lead.facebook),
    val(lead.website),
    val(lead.endereco),
    val(lead.bairro),
    lead.avaliacao || NAO,
    lead.reviews || NAO,
    val(lead.mapsLink),
    new Date().toLocaleDateString("en-IE"),
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
  const d = { nome: "", telefone: "", website: "", endereco: "", avaliacao: "", reviews: "", categoria: "", emailMaps: "" };
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
      d.telefone = lbl.replace(/^Telefone:\s*/i, "").replace(/^Phone:\s*/i, "").trim();
    }

    // Detecta site em múltiplos seletores possíveis
    const siteSelectors = [
      '[data-item-id="authority"]',
      'a[data-value="Website"]',
      'a[aria-label*="website" i]',
      'a[aria-label*="Visit" i]',
    ];
    for (const sel of siteSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
        d.website = await el.getAttribute("href").catch(() => "") || "";
        if (d.website) break;
      }
    }

    const endEl = page.locator('[data-item-id="address"]').first();
    if (await endEl.isVisible({ timeout: 1500 }).catch(() => false)) {
      const lbl = await endEl.getAttribute("aria-label").catch(() => "");
      d.endereco = lbl.replace(/^Endereço:\s*/i, "").replace(/^Address:\s*/i, "").trim();
    }

    // Tenta extrair email do texto visível da página (descrição, posts, etc.)
    const textoVisivel = await page.locator('[data-section-id], [jslog]').first().textContent({ timeout: 1500 }).catch(() => "");
    if (textoVisivel) d.emailMaps = extrairEmail(textoVisivel);

  } catch (_) {}
  return d;
}

async function rasparBairro(page, bairro, cidade) {
  const query = encodeURIComponent(`businesses in ${bairro} ${cidade} Ireland`);
  const links = new Set();

  await page.goto(`https://www.google.com/maps/search/${query}?hl=en`, { waitUntil: "domcontentloaded", timeout: 30000 });
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
      const fim = await page.locator('text="You\'ve reached the end of the list."').isVisible().catch(() => false);
      if (fim) break;
    }
  }

  return [...links];
}

// Processa um link e retorna o lead ou null
async function processarLink(page, link, area, chavesVistas, chavesExistentes) {
  try {
    await page.goto(link + "?hl=en", { waitUntil: "domcontentloaded", timeout: 18000 });
    await sleep(CONFIG.delayMin, CONFIG.delayMax);

    const dados = await extrairDadosPlace(page);
    if (!dados.nome) return null;

    // Camada 1: site oficial cadastrado no Maps → descarta
    if (dados.website) return null;

    // Camada 2: verifica Web Results na página
    // Se encontrar site próprio (não diretório) → o negócio JÁ TEM site → descarta
    const webResults = await verificarWebResults(page).catch(() => ({ temSiteProprio: false, urlDiretorio: null }));
    if (webResults.temSiteProprio) return null;

    // Filtro de qualidade: minimo de estrelas e avaliacoes
    const estrelas = parseFloat(dados.avaliacao);
    const numAvaliacoes = parseInt(dados.reviews);
    if (isNaN(estrelas) || estrelas < CONFIG.minEstrelas) return null;
    if (isNaN(numAvaliacoes) || numAvaliacoes < CONFIG.minAvaliacoes) return null;

    const chaveNome = `${dados.nome}|${dados.endereco}`;
    const chaveTel = dados.telefone ? dados.telefone.replace(/\D/g, "") : "";
    const chave = chaveTel || chaveNome;

    if (chavesVistas.has(chave) || chavesExistentes.has(chaveTel) || chavesExistentes.has(chaveNome)) return null;
    chavesVistas.add(chave);

    const lead = { ...dados, bairro: area, mapsLink: link, email: NAO, facebook: NAO };
    let dominioEncontrado = "";

    // CAMADA 1: email direto na página do Maps (descrição, posts)
    if (dados.emailMaps) lead.email = dados.emailMaps;

    // CAMADA 2: diretório nos Web Results → scrapa o diretório
    if (lead.email === NAO && webResults.urlDiretorio) {
      const emailDiretorio = await buscarEmailNoSite(webResults.urlDiretorio).catch(() => "");
      if (emailDiretorio) lead.email = emailDiretorio;
    }

    // CAMADA 3: Golden Pages estruturado — maior diretório da Irlanda
    if (lead.email === NAO) {
      const gp = await buscarGoldenPagesDireto(dados.nome, area).catch(() => ({ email: "", website: "" }));
      if (gp.email) lead.email = gp.email;
      // Se encontrou site no Golden Pages, guarda o domínio para email guessing
      if (gp.website && !dominioEncontrado) dominioEncontrado = extrairDominio(gp.website);
    }

    // CAMADA 4: Bing busca site .ie próprio não linkado no Maps
    if (!dominioEncontrado) {
      const siteViBing = await buscarSiteViaBing(dados.nome, area).catch(() => "");
      if (siteViBing) {
        dominioEncontrado = extrairDominio(siteViBing);
        // Se encontrou site próprio via Bing → negócio TEM site → descarta
        if (dominioEncontrado && !ehDiretorio("https://" + dominioEncontrado)) {
          return null;
        }
      }
    }

    // CAMADA 5: Email guessing com MX validation no domínio encontrado
    if (lead.email === NAO && dominioEncontrado) {
      const emailGuess = await tentarEmailGuessing(dados.nome, dominioEncontrado).catch(() => "");
      if (emailGuess) lead.email = emailGuess;
    }

    // CAMADA 6: DuckDuckGo com múltiplas queries (fallback final)
    if (lead.email === NAO) {
      const emailDuck = await buscarEmailViaDuckDuckGo(dados.nome, area).catch(() => "");
      if (emailDuck) lead.email = emailDuck;
    }

    // Busca Facebook
    if (lead.facebook === NAO) {
      const fbEncontrado = await buscarFacebookViaBusca(dados.nome, area).catch(() => null);
      if (fbEncontrado) lead.facebook = fbEncontrado;
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
  const listaCidades = CIDADES_IRELAND;
  const totalBairrosGeral = listaCidades.reduce((acc, c) => acc + c.bairros.length, 0);

  console.log("\n");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║     IRELAND TRADES MINER             ║");
  console.log("  ║     Trades with no website → Sheets  ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log(`\n  Filtro:  no website | >= ${CONFIG.minEstrelas} stars | >= ${CONFIG.minAvaliacoes} reviews`);
  console.log(`  Cidades: ${listaCidades.length} | Bairros: ${totalBairrosGeral} | Limite: ${CONFIG.limiteDiario}\n`);
  console.log("  ──────────────────────────────────────");

  const sheets = await criarSheets();
  await garantirCabecalho(sheets);
  const chavesExistentes = await carregarChavesExistentes(sheets);

  const browser = await chromium.launch({
    headless: CONFIG.headless,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-IE",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-background-networking",
    ]
  });

  const criarPagina = async () => {
    const ctx = await browser.newContext({
      locale: "en-IE",
      timezoneId: "Europe/Dublin",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 }
    });
    const pg = await ctx.newPage();
    await pg.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,css}", r => r.abort());
    return pg;
  };

  const pagePrincipal = await criarPagina();
  const pagesParalelas = await Promise.all(
    Array.from({ length: CONFIG.paginasParalelas }, () => criarPagina())
  );

  const chavesVistas = new Set();
  let totalLeads = 0;
  let totalEmail = 0;
  let totalFacebook = 0;
  let limiteAtingido = false;

  const progresso = carregarProgresso();
  const cidadeInicio = progresso.cidadeIdx || 0;

  mainLoop: for (let ci = cidadeInicio; ci < listaCidades.length; ci++) {
    const { cidade, bairros } = listaCidades[ci];
    const bairroInicio = ci === cidadeInicio ? (progresso.bairroIdx || 0) : 0;

    console.log(`\n  ▶ ${cidade.toUpperCase()} (${bairros.length} areas)`);

    for (let i = bairroInicio; i < bairros.length; i++) {
      const bairro = bairros[i];
      const prog = `[${String(i + 1).padStart(2, "0")}/${bairros.length}]`;

      process.stdout.write(`\n  ${prog} ${bairro}: buscando...`);

      const links = await rasparBairro(pagePrincipal, bairro, cidade).catch(() => []);
      process.stdout.write(` ${links.length} lugares`);

      const leadsDoLote = [];
      let processados = 0;

      for (let j = 0; j < links.length; j += CONFIG.paginasParalelas) {
        const restante = CONFIG.limiteDiario - totalLeads - leadsDoLote.length;
        if (restante <= 0) {
          limiteAtingido = true;
          break;
        }

        const bloco = links.slice(j, j + CONFIG.paginasParalelas);
        const resultados = await Promise.all(
          bloco.map((link, idx) => processarLink(pagesParalelas[idx], link, cidade, chavesVistas, chavesExistentes))
        );

        for (const lead of resultados) {
          processados++;
          if (!lead) continue;
          leadsDoLote.push(lead);
          if (lead.email !== NAO) totalEmail++;
          if (lead.facebook !== NAO) totalFacebook++;
        }

        process.stdout.write(`\r  ${prog} ${bairro}: ${processados}/${links.length} | novos: ${leadsDoLote.length}        `);
      }

      await appendLote(sheets, leadsDoLote);
      totalLeads += leadsDoLote.length;

      process.stdout.write(`\r  ${prog} ${bairro}: ${leadsDoLote.length} leads salvos ✓                          `);

      if (limiteAtingido) {
        salvarProgresso(ci, i);
        console.log(`\n\n  ⚠ Limite de ${CONFIG.limiteDiario} leads atingido.`);
        console.log(`  → Retomará: ${cidade} / ${bairro}`);
        break mainLoop;
      }
    }
  }

  if (!limiteAtingido) {
    limparProgresso();
    console.log("\n\n  ✓ Todas as cidades concluidas. Progresso resetado.");
  }

  await browser.close();

  console.log("\n  ══════════════════════════════════════");
  console.log(`  ✓ Total de leads:   ${totalLeads}`);
  console.log(`  ✓ Com email:        ${totalEmail}`);
  console.log(`  ✓ Com Facebook:     ${totalFacebook}`);
  console.log(`\n  https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}`);
  console.log("  ══════════════════════════════════════\n");
}

main().catch(err => {
  console.error("\n  ERRO FATAL:", err.message);
  process.exit(1);
});
