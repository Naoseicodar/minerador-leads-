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
const fs = require("fs");

// =============================================
// CONFIGURACOES
// =============================================
// Lista de cidades do Paraná em ordem de varredura
// Quando CIDADE env var não é definida, percorre todas sequencialmente
const CIDADES_PARANA = [
  {
    cidade: "Curitiba",
    bairros: [
      "Centro", "Batel", "Agua Verde", "Bigorrilho", "Mercês",
      "Santa Felicidade", "Boa Vista", "Ahú", "Cabral", "Hugo Lange",
      "Juvevê", "Champagnat", "Ecoville", "Portão", "Fazendinha",
      "Pinheirinho", "Sítio Cercado", "CIC", "Cajuru", "Uberaba",
      "Bacacheri", "Tingui", "Tatuquara", "Xaxim", "Rebouças"
    ]
  },
  {
    cidade: "Campo Largo",
    bairros: [
      "Centro", "Colônia Dom Pedro", "Jardim Primavera", "Vila Nova",
      "Bairro São João", "Campina das Pedras", "Três Córregos"
    ]
  },
  {
    cidade: "São José dos Pinhais",
    bairros: [
      "Centro", "Colônia Rio Grande", "Afonso Pena", "Guatupê",
      "Costeira", "Borda do Campo", "Santos Dumont"
    ]
  },
  {
    cidade: "Araucária",
    bairros: [
      "Centro", "Tindiquera", "Thomaz Coelho", "Cachoeira",
      "Chapada", "Porto das Laranjeiras"
    ]
  },
  {
    cidade: "Colombo",
    bairros: [
      "Centro", "Jardim Bela Vista", "Maracanã", "Guaraituba",
      "Palmital", "São Gabriel", "Roça Grande"
    ]
  },
  {
    cidade: "Pinhais",
    bairros: [
      "Centro", "Estância Pinhais", "Jardim Claudia", "Weissópolis",
      "Maria Antonieta", "Emiliano Perneta"
    ]
  },
  {
    cidade: "Almirante Tamandaré",
    bairros: [
      "Centro", "Cachoeira", "Lamenha Pequena", "Tranqueira",
      "Tigre", "Jardim das Graças"
    ]
  },
  {
    cidade: "Fazenda Rio Grande",
    bairros: [
      "Centro", "Eucaliptos", "Nações", "Iguaçu",
      "Roseira", "Vale Verde"
    ]
  },
  {
    cidade: "Ponta Grossa",
    bairros: [
      "Centro", "Uvaranas", "Jardim Carvalho", "Oficinas",
      "Contorno", "Nova Rússia", "Órfãs", "Estrela", "Chapada"
    ]
  },
  {
    cidade: "Londrina",
    bairros: [
      "Centro", "Gleba Palhano", "Jardim Shangri-La", "Higienópolis",
      "Cambezinho", "Cinco Conjuntos", "Cafezal", "Ipiranga", "Warta"
    ]
  },
  {
    cidade: "Maringá",
    bairros: [
      "Centro", "Zona 01", "Zona 02", "Zona 03", "Zona 04",
      "Zona 05", "Jardim Alvorada", "Jardim Sumaré", "Jardim Novo Horizonte"
    ]
  },
  {
    cidade: "Cascavel",
    bairros: [
      "Centro", "Cascavel Velho", "Zona Norte", "Zona Sul",
      "Brasília", "Country", "Santa Felicidade", "Universitário"
    ]
  },
  {
    cidade: "Foz do Iguaçu",
    bairros: [
      "Centro", "Porto Meira", "Morumbi", "Três Lagoas",
      "Campos do Iguaçu", "Carimã", "Villa A"
    ]
  },
  {
    cidade: "Guarapuava",
    bairros: [
      "Centro", "Batel", "Conradinho", "Jordão",
      "Morro Alto", "Trianon", "Santa Cruz"
    ]
  },
  {
    cidade: "Paranaguá",
    bairros: [
      "Centro", "Rocio", "Vila Itiberê", "Jardim Iguaçu",
      "Porto Seguro", "Serraria do Rocha"
    ]
  },
  {
    cidade: "Apucarana",
    bairros: [
      "Centro", "Jardim Mônaco", "Nova Esperança", "Recanto Tropical",
      "Jardim Paraíso", "Vitória Régia"
    ]
  },
  {
    cidade: "Campo Mourão",
    bairros: [
      "Centro", "Jardim Tropical", "Parque das Laranjeiras",
      "Santa Cruz", "Industrial", "Lar Paraná"
    ]
  },
];

const CONFIG = {
  credenciaisPath: path.join(__dirname, "credentials.json"),
  sheetId: process.env.SHEET_ID || "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI",
  sheetNome: "Leads",

  termo: process.env.TERMO || "clinica estetica",

  // Modo single-city (via env var) ou multi-city (percorre CIDADES_PARANA)
  cidadeUnica: process.env.CIDADE || null,
  bairrosUnico: process.env.BAIRROS
    ? process.env.BAIRROS.split(",").map(b => b.trim()).filter(Boolean)
    : null,

  maxScroll: 6,
  headless: true,
  delayMin: 300,
  delayMax: 600,
  paginasParalelas: 2,
  limiteDiario: Number(process.env.LIMITE_DIARIO) || 150,
};

const PROGRESSO_PATH = path.join(__dirname, "progresso.json");

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
  "Instagram",            // E
  "Website",              // F
  "Endereço",             // G
  "Bairro",               // H
  "Avaliação Google ⭐",  // I
  "Nº Avaliações",        // J
  "Data da Busca",        // K
  "Observações",          // L
];

const LARGURAS = [150, 220, 145, 205, 185, 195, 245, 125, 125, 110, 115, 220];

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
  const paginas = [
    "", "/contato", "/contact", "/fale-conosco", "/sobre",
    "/sobre-nos", "/quem-somos", "/atendimento", "/agenda", "/home"
  ];

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

// Busca Instagram pelo nome da empresa via DuckDuckGo (fallback quando não tem site)
async function buscarInstagramViaBusca(nome, cidade) {
  try {
    const q = encodeURIComponent(`"${nome}" instagram ${cidade}`);
    const html = await comTimeout(
      httpsGet(`https://html.duckduckgo.com/html/?q=${q}`),
      8000
    );
    const insta = extrairInstagram(html);
    return insta !== NAO ? insta : null;
  } catch (_) {
    return null;
  }
}

// Busca email na bio do Instagram (perfis públicos expõem dados no HTML)
async function buscarEmailNoInstagram(instagramUrl) {
  try {
    const url = instagramUrl.startsWith("http") ? instagramUrl : `https://${instagramUrl}`;
    const html = await comTimeout(httpsGet(url), 8000);

    // Tenta mailto primeiro
    const mailtoMatch = html.match(/href=["']mailto:([^"'?]+)/i);
    if (mailtoMatch && mailtoMatch[1].includes("@")) return mailtoMatch[1].trim();

    // Tenta extrair do JSON embarcado no HTML do Instagram
    const jsonMatch = html.match(/"email":"([^"]+@[^"]+)"/);
    if (jsonMatch) return jsonMatch[1];

    // Tenta regex geral
    const found = extrairEmail(html);
    return found || null;
  } catch (_) {
    return null;
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
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A1:L1`,
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
        // Cores por status — aplica na linha inteira
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Convertido" }] }, format: { backgroundColor: { red: 0.8, green: 0.94, blue: 0.8 } } }
            }, index: 0
          }
        },
        {
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Proposta enviada" }] }, format: { backgroundColor: { red: 0.8, green: 0.9, blue: 1.0 } } }
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
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId: gid, startRowIndex: 1, endRowIndex: 50000, startColumnIndex: 0, endColumnIndex: CABECALHO.length }],
              booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Sem interesse" }] }, format: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 } } }
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

  console.log("  ✓ Planilha configurada");
}

async function carregarChavesExistentes(sheets) {
  // Nova ordem: A=Status, B=Nome, C=Telefone, D=Email, E=Instagram, F=Website, G=Endereço
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
    "Não contatado",
    val(lead.nome),
    lead.telefone ? formatarTelefone(lead.telefone) : NAO,
    val(lead.email),
    val(lead.instagram),
    val(lead.website),
    val(lead.endereco),
    val(lead.bairro),
    lead.avaliacao || NAO,
    lead.reviews || NAO,
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

async function rasparBairro(page, bairro, cidade) {
  const query = encodeURIComponent(`${CONFIG.termo} em ${bairro} ${cidade}`);
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

    // Camada 1: busca no site da empresa
    if (dados.website) {
      const info = await comTimeout(buscarSiteInfo(dados.website), 20000).catch(() => ({ email: NAO, instagram: NAO }));
      lead.email = info.email;
      lead.instagram = info.instagram;
    }

    // Camada 2: se não achou Instagram no site → busca via DuckDuckGo
    if (lead.instagram === NAO) {
      const instaEncontrado = await buscarInstagramViaBusca(dados.nome, bairro).catch(() => null);
      if (instaEncontrado) lead.instagram = instaEncontrado;
    }

    // Camada 3: se achou Instagram mas não achou email → busca email na bio do Instagram
    if (lead.email === NAO && lead.instagram !== NAO) {
      const emailInsta = await buscarEmailNoInstagram(lead.instagram).catch(() => null);
      if (emailInsta) lead.email = emailInsta;
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
  // Determina se roda single-city (env var) ou percorre todas as cidades do PR
  const listaCidades = CONFIG.cidadeUnica
    ? [{ cidade: CONFIG.cidadeUnica, bairros: CONFIG.bairrosUnico || ["Centro"] }]
    : CIDADES_PARANA;

  const totalCidades = listaCidades.length;
  const totalBairrosGeral = listaCidades.reduce((acc, c) => acc + c.bairros.length, 0);

  console.log("\n");
  console.log("  ╔══════════════════════════════════════╗");
  console.log("  ║     MINERADOR DE LEADS               ║");
  console.log("  ║     Google Maps → Google Sheets      ║");
  console.log("  ╚══════════════════════════════════════╝");
  console.log(`\n  Termo:   ${CONFIG.termo}`);
  console.log(`  Cidades: ${totalCidades} | Bairros total: ${totalBairrosGeral}\n`);
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

  const pagePrincipal = await criarPagina();
  const pagesParalelas = await Promise.all(
    Array.from({ length: CONFIG.paginasParalelas }, () => criarPagina())
  );

  const progresso = carregarProgresso();
  if (progresso.cidadeIdx > 0 || progresso.bairroIdx > 0) {
    const c = listaCidades[progresso.cidadeIdx];
    console.log(`  → Retomando: ${c?.cidade || "?"} / ${c?.bairros[progresso.bairroIdx] || "?"}`);
  }

  const chavesVistas = new Set();
  let totalLeads = 0;
  let totalEmail = 0;
  let totalInsta = 0;
  let limiteAtingido = false;

  outer: for (let ci = progresso.cidadeIdx; ci < listaCidades.length; ci++) {
    const { cidade, bairros } = listaCidades[ci];
    const inicioBairro = ci === progresso.cidadeIdx ? progresso.bairroIdx : 0;

    console.log(`\n  ▶ ${cidade.toUpperCase()} (${bairros.length} bairros)`);

    for (let i = inicioBairro; i < bairros.length; i++) {
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
          bloco.map((link, idx) => processarLink(pagesParalelas[idx], link, `${bairro} - ${cidade}`, chavesVistas, chavesExistentes))
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

      await appendLote(sheets, leadsDoLote);
      totalLeads += leadsDoLote.length;

      process.stdout.write(`\r  ${prog} ${bairro}: ${leadsDoLote.length} leads salvos ✓                          `);

      if (limiteAtingido) {
        salvarProgresso(ci, i);
        console.log(`\n\n  ⚠ Limite de ${CONFIG.limiteDiario} leads atingido.`);
        console.log(`  → Retomará amanhã: ${cidade} / ${bairro}`);
        break outer;
      }
    }
  }

  if (!limiteAtingido) {
    limparProgresso();
    console.log("\n\n  ✓ Todas as cidades concluídas. Progresso resetado.");
  }

  await browser.close();

  console.log("\n  ══════════════════════════════════════");
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
