/**
 * Claudio Insta — Bot DM Instagram com IA
 * Mensagens personalizadas via Claude + comportamento humano
 * Uso: node claudio-insta.js
 */

const Anthropic = require("@anthropic-ai/sdk");
const { chromium } = require("playwright");
const { google }   = require("googleapis");
const https = require("https");
const http  = require("http");
const path  = require("path");
const fs    = require("fs");

// =============================================
// CONFIGURAÇÕES
// =============================================
const CONFIG = {
  // Anthropic
  anthropicKey: process.env.ANTHROPIC_API_KEY,

  // Google Sheets
  credenciaisPath: path.join(__dirname, "credentials.json"),
  sheetId:   process.env.SHEET_ID || "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI",
  sheetNome: "Leads",

  // Instagram
  sessaoPath: path.join(__dirname, "instagram-session.json"),

  // Limite seguro de DMs por execução (não passe de 25/dia)
  limiteDMs: Number(process.env.LIMITE_DMS) || 20,

  // ── PERSONA DO VENDEDOR ───────────────────────────────────
  vendedor: {
    nome:      "Luan",
    instagram: "@luandev",   // seu @ do Instagram para o lead responder
    especialidade: "criação de sites com foco em SEO e posicionamento no Google",
    diferencial: "sites que aparecem na primeira página do Google para quem busca o serviço na cidade",
  },

  // ── DELAYS HUMANOS (ms) ────────────────────────────────────
  acoes:    { min: 600,   max: 2200  },
  leitura:  { min: 2500,  max: 5500  },
  digitacao:{ min: 40,    max: 180   },
  erroDigit:{ min: 280,   max: 650   },
  entreDMs: { min: 55000, max: 135000 }, // 55s ~ 2min entre cada DM
};

// Colunas no Sheets (índice 0 = coluna A)
const COL = {
  status:    0,  // A
  nome:      1,  // B
  telefone:  2,  // C
  email:     3,  // D
  instagram: 4,  // E
  website:   5,  // F
  endereco:  6,  // G
  bairro:    7,  // H
  avaliacao: 8,  // I
  reviews:   9,  // J
  mapsLink:  10, // K
  obs:       12, // M
};

const NAO       = "Não encontrado";
const MARCA_DM  = "DM Instagram ✓";

// =============================================
// UTILITÁRIOS
// =============================================
function sleep(min, max) {
  const ms = max ? Math.floor(Math.random() * (max - min) + min) : min;
  return new Promise(r => setTimeout(r, ms));
}
function comTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Timeout")), ms))]);
}

// =============================================
// IA — GERAÇÃO DE MENSAGEM PERSONALIZADA
// =============================================
const anthropic = new Anthropic({ apiKey: CONFIG.anthropicKey });

// Inferência de sub-nicho pelo nome da empresa
function inferirSubNicho(nome) {
  const n = nome.toLowerCase();

  if (/dent|odont|sorriso|oral|orto|implant.*dent|clinica.*dent/.test(n))
    return "dentista";
  if (/capilar|micropig|cabelo|calvice|fio.*cabelo|hair/.test(n))
    return "capilar";
  if (/psicol|terapia|terapeut|mental|emocion|ansied/.test(n))
    return "psicologia";
  if (/fisio|reabilit|ortopedi|coluna|postur/.test(n))
    return "fisioterapia";
  if (/nutri|emagre|dieta|peso|metabol/.test(n))
    return "nutricao";
  if (/estet|beleza|skin|harmoniz|botox|filler|pele|laser|depil|cilio/.test(n))
    return "estetica";

  return "saude"; // genérico
}

const NICHO_COPY = {
  dentista: {
    cenario: (bairro) =>
      `Imagina que agora tem alguém em ${bairro} com dor de dente pesquisando "dentista perto de mim" no Google`,
    dor: "Essa pessoa não vai encontrar vocês. Sem site, o Google simplesmente ignora a clínica — e ela liga pro concorrente que aparece primeiro.",
    contexto: "Para dentista, a busca é urgente. O paciente quer resolver agora e escolhe quem aparece primeiro, não necessariamente quem é melhor.",
  },
  capilar: {
    cenario: (bairro) =>
      `Imagina que alguém pesquisando há semanas sobre implante capilar abre o Google e compara clínicas em ${bairro}`,
    dor: "Sem site, vocês são eliminados da lista antes mesmo do primeiro contato. Para um serviço de alto valor como esse, o cliente precisa de credibilidade antes de ligar.",
    contexto: "Implante capilar é decisão de alto ticket — o cliente pesquisa muito. Site é pré-requisito de credibilidade para fechar.",
  },
  psicologia: {
    cenario: (bairro) =>
      `Imagina que alguém está passando por um momento difícil e pesquisa "psicólogo em ${bairro}" em busca de alguém de confiança`,
    dor: "Sem site, essa pessoa não sente segurança suficiente para ligar. Para um serviço tão sensível, a primeira impressão é tudo — e ela acontece no Google.",
    contexto: "Paciente de psicologia busca confiança e discrição. Site profissional é o que transmite isso antes do primeiro contato.",
  },
  fisioterapia: {
    cenario: (bairro) =>
      `Imagina que alguém com dor crônica que não tem indicação abre o Google e pesquisa "fisioterapeuta em ${bairro}"`,
    dor: "Sem site, vocês não aparecem para quem está buscando ativamente — e esse é um público enorme que não chega por indicação.",
    contexto: "Fisioterapia ainda depende muito de indicação, mas perde quem pesquisa no Google. São pacientes que ninguém está captando.",
  },
  nutricao: {
    cenario: (bairro) =>
      `Imagina que alguém querendo emagrecer e cansado de tentativas pesquisa "nutricionista em ${bairro}" no Google`,
    dor: "Sem site, vocês não aparecem nesse momento de decisão. E num nicho tão concorrido no Instagram, quem aparece no Google leva uma vantagem enorme.",
    contexto: "Nutrição é nicho muito competitivo. Instagram tem muito player, mas Google local ainda é pouco explorado — vantagem real.",
  },
  estetica: {
    cenario: (bairro) =>
      `Imagina que alguém querendo fazer um procedimento estético pesquisa "clínica estética em ${bairro}" no Google`,
    dor: "Mesmo com um Instagram incrível mostrando resultados, quem não tem site não aparece nessa busca — e vai direto pra concorrência.",
    contexto: "Clínica estética costuma investir muito no Instagram mas esquece o Google. Quem equilibra os dois capta muito mais.",
  },
  saude: {
    cenario: (bairro) =>
      `Imagina que alguém em ${bairro} está precisando exatamente do serviço que vocês oferecem e abre o Google pra buscar`,
    dor: "Sem site, esse paciente não vai encontrar vocês. O Google prioriza quem tem site otimizado — e o cliente vai direto pra quem aparece primeiro.",
    contexto: "Na área da saúde, a decisão começa no Google. Quem não aparece lá simplesmente não existe para esse cliente.",
  },
};

async function gerarMensagem(lead) {
  const { nome, bairro, avaliacao, reviews } = lead;

  const subNicho  = inferirSubNicho(nome);
  const copy      = NICHO_COPY[subNicho];
  const cenario   = copy.cenario(bairro || "sua região");

  // Contexto de reputação para personalizar tom
  const rep = Number(avaliacao) >= 4.5 && Number(reviews) > 30
    ? `A ${nome} tem ${avaliacao}★ e ${reviews} avaliações — reputação sólida que merece mais visibilidade.`
    : Number(reviews) > 0
    ? `Vi que a ${nome} tem ${reviews} avaliações no Google Maps.`
    : `Vi a ${nome} no Google Maps.`;

  const prompt = `Você é ${CONFIG.vendedor.nome}, especialista em criação de sites com foco em SEO e posicionamento no Google para negócios de saúde. Você entrega sites prontos em menos de 48 horas.

Escreva uma DM personalizada no Instagram para este negócio seguindo EXATAMENTE a estrutura AIDA abaixo.

DADOS DO LEAD:
- Empresa: ${nome}
- Sub-nicho: ${subNicho}
- Localização: ${bairro || "região local"}
- Reputação: ${rep}
- Contexto de nicho: ${copy.contexto}

ESTRUTURA OBRIGATÓRIA (nessa ordem):

1. AUTORIDADE — Apresente-se: "Oi [nome da empresa]! Me chamo ${CONFIG.vendedor.nome}, sou especialista em sites e SEO para negócios de saúde." Varie o modo de dizer mas mantenha nome + especialidade + nicho saúde.

2. ATENÇÃO — Use este cenário adaptado: "${cenario}..." Crie a cena de forma vívida, coloque o empresário na cabeça do cliente dele.

3. INTERESSE — Use esta dor: "${copy.dor}" Mostre que ele está perdendo paciente agora, nesse momento.

4. DESEJO — Apresente a solução de forma leve: site otimizado para o Google da região, pronto em menos de 48h. Não cite preço. Não faça pitch agressivo.

5. AÇÃO — Termine com UMA pergunta de baixíssimo compromisso. Exemplos do estilo certo: "Posso te mostrar como ficaria pra [nome]?" / "Quer ver um exemplo de como apareceria no Google?" / "Faz sentido eu te mostrar como funciona?" — varie, nunca repita a mesma.

REGRAS:
- Tom: direto, confiante, humano — NUNCA corporativo ou robótico
- Máximo 5 parágrafos curtos
- Zero emojis ou no máximo 1 se encaixar naturalmente
- Escreva em português brasileiro informal mas profissional
- Varie a estrutura de frase — nunca comece dois parágrafos da mesma forma
- NÃO cite preço na primeira mensagem
- Gere APENAS o texto da mensagem, sem aspas, sem título, sem explicação`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 450,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content[0].text.trim();
}

// =============================================
// BUSCA DE INSTAGRAM
// =============================================
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/html" },
      timeout: 8000,
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", c => { data += c; if (data.length > 150000) req.destroy(); });
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
  });
}

// =============================================
// BUSCA DE INSTAGRAM — API interna + fallbacks
// =============================================

// Palavras comuns que não servem para identificar um negócio
const STOPWORDS = new Set([
  "clinica", "clinic", "estetica", "estetico", "avancada", "avancado",
  "espaco", "space", "studio", "studio", "salon", "salao", "centro",
  "instituto", "institute", "beauty", "beleza", "saude", "health",
  "curitiba", "ctba", "parana", "brasil", "brazil", "de", "da", "do",
  "das", "dos", "e", "em", "para", "com", "the", "and", "of",
]);

/**
 * Extrai palavras-chave do nome da empresa (remove stopwords e termos genéricos)
 * Ex: "Clínica Estética Avançada - Adalgisa Castro" → ["adalgisa", "castro"]
 */
function extrairPalavrasChave(nome) {
  return nome
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(p => p.length >= 4 && !STOPWORDS.has(p));
}

/**
 * Calcula score de similaridade entre nome da empresa e perfil encontrado
 */
function calcularScore(palavrasChave, username, fullName) {
  const uNorm = username.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  const fNorm = (fullName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "");

  let score = 0;
  for (const palavra of palavrasChave) {
    if (uNorm.includes(palavra)) score += 2;       // match no username vale mais
    if (fNorm.includes(palavra)) score += 1;       // match no nome completo
  }
  return score;
}

/**
 * Método 1 (principal): API interna do Instagram via browser autenticado
 * Exatamente como PhantomBuster funciona
 */
async function buscarInstagramViaAPI(page, nome) {
  try {
    const palavrasChave = extrairPalavrasChave(nome);
    if (!palavrasChave.length) return null;

    // Garante que a página está no domínio do Instagram para a fetch relativa funcionar
    const urlAtual = page.url();
    if (!urlAtual.includes("instagram.com")) {
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
      await sleep(1000, 2000);
    }

    // Tenta buscar por diferentes combinações de palavras-chave
    const queries = [
      palavrasChave.join(" "),           // todas as palavras
      palavrasChave.slice(0, 2).join(" "), // primeiras 2
      palavrasChave[0],                    // primeira palavra-chave isolada
    ].filter((q, i, arr) => arr.indexOf(q) === i && q.trim().length > 2); // sem duplicatas

    for (const query of queries) {
      const resultado = await page.evaluate(async (q) => {
        try {
          const res = await fetch(
            `/api/v1/web/search/topsearch/?query=${encodeURIComponent(q)}&context=blended`,
            { headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "*/*" }, credentials: "include" }
          );
          if (!res.ok) return null;
          return await res.json();
        } catch (_) { return null; }
      }, query);

      const users = resultado?.users || [];
      if (!users.length) continue;

      // Pontua cada resultado e pega o melhor
      let melhor = null;
      let melhorScore = 0;

      for (const entry of users.slice(0, 8)) {
        const u = entry.user;
        if (!u?.username) continue;
        const score = calcularScore(palavrasChave, u.username, u.full_name);
        if (score > melhorScore) {
          melhorScore = score;
          melhor = u.username;
        }
      }

      // Só aceita se tiver score mínimo (pelo menos 1 palavra-chave bateu)
      if (melhor && melhorScore >= 1) return melhor;
      await sleep(600, 1200);
    }

    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Método 2 (fallback): busca pelo campo de pesquisa do Instagram via Playwright
 */
async function buscarInstagramViaPesquisa(page, nome) {
  try {
    // Vai para o Instagram e usa a barra de pesquisa
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(1500, 2500);

    // Clica no ícone de busca
    const btnBusca = page.locator('a[href="/explore/"], svg[aria-label="Buscar"], svg[aria-label="Search"]').first();
    if (!await btnBusca.isVisible({ timeout: 3000 }).catch(() => false)) return null;
    await humanClick(page, btnBusca);
    await sleep(800, 1500);

    // Campo de busca
    const inputBusca = page.locator('input[placeholder*="busca"], input[placeholder*="Search"], input[aria-label*="busca"]').first();
    if (!await inputBusca.isVisible({ timeout: 3000 }).catch(() => false)) return null;

    await humanClick(page, inputBusca);
    await sleep(400, 800);

    // Digita o nome
    const nomeCurto = nome.split(" ").slice(0, 3).join(" "); // máx 3 palavras
    for (const char of nomeCurto) {
      await page.keyboard.type(char, { delay: 0 });
      await sleep(60, 150);
    }
    await sleep(1500, 2500);

    // Pega primeiro resultado
    const resultado = page.locator('a[href*="/"][role="link"]').first();
    if (!await resultado.isVisible({ timeout: 4000 }).catch(() => false)) return null;

    const href = await resultado.getAttribute("href").catch(() => "");
    const match = href?.match(/^\/([a-zA-Z0-9_.]{2,30})\/?$/);

    // Limpa a busca
    await page.keyboard.press("Escape").catch(() => {});

    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

/**
 * Método 3 (último recurso): DuckDuckGo externo
 */
const HANDLES_IGNORAR = new Set([
  "p", "reel", "reels", "explore", "stories", "tv", "accounts",
  "about", "help", "legal", "privacy", "safety", "shoppingapp",
]);

function extrairHandleDDG(html) {
  const regex = /(?:instagram\.com|instagr\.am)\/([a-zA-Z0-9_.]{2,30})/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const u = match[1].replace(/\/$/, "").toLowerCase();
    if (!HANDLES_IGNORAR.has(u) && !u.includes(".") && u.length >= 3) return match[1];
  }
  return null;
}

async function buscarInstagramDDG(nome, bairro) {
  try {
    const q = encodeURIComponent(`"${nome}" instagram ${bairro}`);
    const html = await comTimeout(httpsGet(`https://html.duckduckgo.com/html/?q=${q}`), 8000);
    return extrairHandleDDG(html) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Busca Instagram com os 3 métodos em cascata
 */
async function buscarInstagram(page, nome, bairro) {
  // Método 1: API interna (mais confiável)
  const viaAPI = await buscarInstagramViaAPI(page, nome).catch(() => null);
  if (viaAPI) return viaAPI;
  await sleep(500, 1000);

  // Método 2: barra de pesquisa do Instagram
  const viaPesquisa = await buscarInstagramViaPesquisa(page, nome).catch(() => null);
  if (viaPesquisa) return viaPesquisa;
  await sleep(500, 1000);

  // Método 3: DuckDuckGo
  return buscarInstagramDDG(nome, bairro).catch(() => null);
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

async function carregarLeads(sheets) {
  // Lê o cabeçalho primeiro para detectar o formato da planilha
  const cabRes = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A1:Z1`,
  }).catch(() => null);

  const cabecalho = cabRes?.data?.values?.[0] || [];
  const numColunas = cabecalho.length;
  console.log(`  → Formato detectado: ${numColunas} colunas`);

  // Detecta índice real da coluna Observações pelo cabeçalho
  const idxObs = cabecalho.findIndex(c =>
    c && c.toLowerCase().includes("observa")
  );
  const obsCol = idxObs >= 0 ? idxObs : COL.obs;
  if (idxObs >= 0 && idxObs !== COL.obs) {
    console.log(`  → Coluna Observações detectada no índice ${idxObs} (esperado: ${COL.obs})`);
  }

  const range = `${CONFIG.sheetNome}!A2:${String.fromCharCode(65 + Math.max(numColunas - 1, 12))}`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range,
  }).catch(() => null);

  const rows = res?.data?.values || [];
  console.log(`  → ${rows.length} linhas totais na planilha`);

  let filtradosDM       = 0;
  let filtradosStatus   = 0;
  let filtradosSemNome  = 0;

  const leads = rows
    .map((r, i) => ({
      linha:     i + 2,
      nome:      r[COL.nome]      || "",
      instagram: r[COL.instagram] || NAO,
      website:   r[COL.website]   || NAO,
      bairro:    r[COL.bairro]    || "",
      avaliacao: r[COL.avaliacao] || "",
      reviews:   r[COL.reviews]   || "",
      mapsLink:  r[COL.mapsLink]  || NAO,
      obs:       r[obsCol]        || "",
      status:    r[COL.status]    || "",
    }))
    .filter(l => {
      if (!l.nome) { filtradosSemNome++; return false; }
      if (l.obs.includes(MARCA_DM)) { filtradosDM++; return false; }
      if (l.status.includes("Sem interesse") || l.status.includes("Convertido")) {
        filtradosStatus++; return false;
      }
      // Só leads SEM site — público-alvo principal
      if (l.website && l.website !== NAO && l.website.trim() !== "") return false;
      return true;
    });

  console.log(`  → Filtrados: ${filtradosDM} já contatados | ${filtradosStatus} sem interesse/convertidos | ${filtradosSemNome} sem nome`);
  return leads;
}

async function marcarEnviado(sheets, linha, obs) {
  const novaObs = obs ? `${obs} | ${MARCA_DM}` : MARCA_DM;
  // Atualiza Status (col A) e Observações (col M)
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CONFIG.sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${CONFIG.sheetNome}!A${linha}`, values: [["Em contato"]] },
        { range: `${CONFIG.sheetNome}!M${linha}`, values: [[novaObs]] },
      ],
    },
  });
}

async function salvarInstagram(sheets, linha, handle) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!E${linha}`,
    valueInputOption: "RAW",
    requestBody: { values: [[`instagram.com/${handle}`]] },
  });
}

// =============================================
// COMPORTAMENTO HUMANO
// =============================================
async function humanMove(page, x, y) {
  const steps = 8 + Math.floor(Math.random() * 8);
  const cx = x - 100 - Math.random() * 200;
  const cy = y - 50  - Math.random() * 100;
  const cpx = cx + (x - cx) * 0.4 + (Math.random() - 0.5) * 140;
  const cpy = cy + (y - cy) * 0.4 + (Math.random() - 0.5) * 140;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mx = (1-t)*(1-t)*cx + 2*(1-t)*t*cpx + t*t*x;
    const my = (1-t)*(1-t)*cy + 2*(1-t)*t*cpy + t*t*y;
    await page.mouse.move(mx + (Math.random()-0.5)*4, my + (Math.random()-0.5)*4);
    await sleep(10, 30);
  }
}

async function humanClick(page, locator) {
  const box = await locator.boundingBox();
  if (!box) { await locator.click(); return; }
  const x = box.x + box.width  * (0.3 + Math.random() * 0.4);
  const y = box.y + box.height * (0.3 + Math.random() * 0.4);
  await humanMove(page, x, y);
  await sleep(60, 220);
  await page.mouse.click(x, y);
}

async function humanScroll(page, pixels) {
  const passos = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < passos; i++) {
    await page.mouse.wheel(0, (pixels / passos) + (Math.random()-0.5)*50);
    await sleep(80, 280);
  }
}

/**
 * Digita texto com velocidade humana, erros ocasionais e pausas de "pensamento"
 */
async function humanType(page, texto) {
  for (let i = 0; i < texto.length; i++) {
    const char = texto[i];

    // ~4% chance de digitar errado e corrigir
    if (Math.random() < 0.04 && /[a-zA-ZÀ-ú]/.test(char)) {
      const vizinho = String.fromCharCode(char.charCodeAt(0) + (Math.random() > 0.5 ? 1 : -1));
      await page.keyboard.type(vizinho, { delay: 0 });
      await sleep(CONFIG.erroDigit.min, CONFIG.erroDigit.max);
      await page.keyboard.press("Backspace");
      await sleep(60, 180);
    }

    if (char === "\n") {
      await page.keyboard.press("Shift+Enter");
    } else {
      await page.keyboard.type(char, { delay: 0 });
    }

    // Pausa maior após pontuação final
    if (/[.!?]/.test(char))       await sleep(250, 700);
    else if (/[,;:]/.test(char))  await sleep(100, 300);
    else                           await sleep(CONFIG.digitacao.min, CONFIG.digitacao.max);

    // Micro-pausa aleatória (quem digita pensa)
    if (Math.random() < 0.035) await sleep(350, 1100);
  }
}

// =============================================
// SESSÃO INSTAGRAM
// =============================================
async function salvarSessao(context) {
  try {
    const cookies = await context.cookies();
    fs.writeFileSync(CONFIG.sessaoPath, JSON.stringify({ cookies }, null, 2));
  } catch (_) {}
}

async function carregarSessao(context) {
  if (!fs.existsSync(CONFIG.sessaoPath)) return false;
  try {
    const { cookies } = JSON.parse(fs.readFileSync(CONFIG.sessaoPath, "utf8"));
    if (cookies?.length) { await context.addCookies(cookies); return true; }
  } catch (_) {}
  return false;
}

async function estaLogado(page) {
  try {
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await sleep(2000, 3500);
    const loginBtn = await page.locator('a[href="/accounts/login/"]').isVisible({ timeout: 3000 }).catch(() => false);
    return !loginBtn;
  } catch (_) { return false; }
}

async function loginManual(browser) {
  console.log("\n  ─────────────────────────────────────────────────");
  console.log("  PRIMEIRA VEZ: faça login no Instagram que abrir.");
  console.log("  Quando estiver no feed, pressione ENTER aqui.");
  console.log("  ─────────────────────────────────────────────────\n");

  const context = await browser.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });

  await new Promise(resolve => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => { process.stdin.pause(); resolve(); });
  });

  await salvarSessao(context);
  return { context, page };
}

// =============================================
// ENVIO DE DM
// =============================================
async function enviarDM(page, handle, mensagem) {
  await page.goto(`https://www.instagram.com/${handle}/`, {
    waitUntil: "domcontentloaded",
    timeout: 25000,
  });
  await sleep(CONFIG.leitura.min, CONFIG.leitura.max);

  // Verifica se perfil existe
  const naoExiste = await page.locator('text="Essa página não está disponível"').isVisible({ timeout: 3000 }).catch(() => false);
  if (naoExiste) return { ok: false, motivo: "perfil não encontrado" };

  // Simula leitura do perfil
  await humanScroll(page, 180 + Math.random() * 160);
  await sleep(CONFIG.leitura.min, CONFIG.leitura.max);
  await humanScroll(page, -(80 + Math.random() * 80));
  await sleep(800, 1800);

  // Clica em "Enviar mensagem"
  const btnMsg = page.locator([
    'div[role="button"]:has-text("Enviar mensagem")',
    'button:has-text("Enviar mensagem")',
    'div[role="button"]:has-text("Message")',
  ].join(", ")).first();

  if (!await btnMsg.isVisible({ timeout: 5000 }).catch(() => false))
    return { ok: false, motivo: "botão de mensagem não encontrado" };

  await sleep(CONFIG.acoes.min, CONFIG.acoes.max);
  await humanClick(page, btnMsg);
  await sleep(1800, 3500);

  // Solicitação de mensagem (se aparecer)
  const btnSolicitar = page.locator([
    'button:has-text("Enviar solicitação de mensagem")',
    'div[role="button"]:has-text("Enviar solicitação")',
  ].join(", ")).first();
  if (await btnSolicitar.isVisible({ timeout: 2000 }).catch(() => false)) {
    await humanClick(page, btnSolicitar);
    await sleep(1500, 2800);
  }

  // Campo de mensagem
  const inputMsg = page.locator([
    'div[aria-label="Mensagem"]',
    'textarea[placeholder*="mensagem"]',
    'div[role="textbox"]',
  ].join(", ")).last();

  if (!await inputMsg.isVisible({ timeout: 8000 }).catch(() => false))
    return { ok: false, motivo: "campo de mensagem não encontrado" };

  await sleep(CONFIG.acoes.min, CONFIG.acoes.max);
  await humanClick(page, inputMsg);
  await sleep(500, 1000);

  // Digita a mensagem
  await humanType(page, mensagem);

  // Pausa de "releitura" antes de enviar
  await sleep(1800, 4500);

  await page.keyboard.press("Enter");
  await sleep(2000, 4000);

  // Fallback: clica no botão Enviar se o campo não esvaziou
  const campoTexto = await inputMsg.evaluate(el => el.textContent?.trim() || el.innerText?.trim() || "").catch(() => "");
  if (campoTexto.length > 3) {
    const btnEnviar = page.locator('button:has-text("Enviar"), div[role="button"]:has-text("Enviar")').last();
    if (await btnEnviar.isVisible({ timeout: 2000 }).catch(() => false)) {
      await humanClick(page, btnEnviar);
      await sleep(1500, 3000);
    }
  }

  return { ok: true };
}

// =============================================
// MAIN
// =============================================
async function main() {
  if (!CONFIG.anthropicKey) {
    console.error("\n  ERRO: defina a variável ANTHROPIC_API_KEY antes de rodar.");
    console.error("  Exemplo: ANTHROPIC_API_KEY=sk-ant-... node claudio-insta.js\n");
    process.exit(1);
  }

  console.log("\n");
  console.log("  ╔═══════════════════════════════════════════╗");
  console.log("  ║        CLAUDIO INSTA  ×  IA               ║");
  console.log("  ║        DMs personalizados com Claude       ║");
  console.log("  ╚═══════════════════════════════════════════╝\n");

  const sheets = await criarSheets();
  console.log("  → Carregando leads...");
  const leads = await carregarLeads(sheets);
  console.log(`  → ${leads.length} leads pendentes\n`);

  if (!leads.length) {
    console.log("  Nenhum lead pendente.");
    console.log("  Verifique se a planilha tem leads com status diferente de 'Sem interesse' ou 'Convertido'");
    console.log("  e que a coluna M (Observações) não contém 'DM Instagram ✓'.\n");
    return;
  }

  // ── Browser ────────────────────────────────────────────
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--lang=pt-BR",
      "--disable-dev-shm-usage",
    ],
  });

  const ctxOpts = {
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280 + Math.floor(Math.random()*80), height: 900 + Math.floor(Math.random()*40) },
  };

  let context = await browser.newContext(ctxOpts);
  let page    = await context.newPage();
  await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}", r => r.abort());

  // ── Login ────────────────────────────────────────────
  const sessaoOk = await carregarSessao(context);
  let logado = sessaoOk ? await estaLogado(page) : false;

  if (!logado) {
    await browser.close();
    const novo = await loginManual(
      await chromium.launch({ headless: false, args: ["--no-sandbox", "--lang=pt-BR"] })
    );
    context = novo.context;
    page    = novo.page;
    await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded" });
    await sleep(2000, 4000);
  } else {
    console.log("  ✓ Sessão Instagram carregada\n");
    await humanScroll(page, 250 + Math.random() * 250);
    await sleep(CONFIG.leitura.min, CONFIG.leitura.max);
  }

  // ── Loop de envio ────────────────────────────────────
  let enviados = 0;
  let buscados = 0;
  let erros    = 0;

  console.log("  ──────────────────────────────────────────────\n");

  for (const lead of leads) {
    if (enviados >= CONFIG.limiteDMs) {
      console.log(`\n  ⚠ Limite de ${CONFIG.limiteDMs} DMs atingido para hoje.`);
      break;
    }

    // ── Resolve handle ──────────────────────────────────
    let handle = null;
    if (lead.instagram && lead.instagram !== NAO) {
      const m = lead.instagram.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
      handle = m ? m[1] : (!lead.instagram.includes("/") ? lead.instagram : null);
    }

    if (!handle) {
      process.stdout.write(`  Buscando Instagram: ${lead.nome}... `);
      handle = await buscarInstagram(page, lead.nome, lead.bairro).catch(() => null);
      if (handle) {
        process.stdout.write(`@${handle} encontrado\n`);
        buscados++;
        await salvarInstagram(sheets, lead.linha, handle).catch(() => {});
      } else {
        process.stdout.write("não encontrado, pulando\n");
        continue;
      }
    }

    // ── Gera mensagem com IA ────────────────────────────
    process.stdout.write(`  [${enviados + 1}] Gerando mensagem para ${lead.nome}...`);
    let mensagem = null;
    try {
      mensagem = await gerarMensagem(lead);
    } catch (err) {
      process.stdout.write(` erro na IA: ${err.message}\n`);
      erros++;
      continue;
    }
    if (!mensagem) {
      process.stdout.write(" IA retornou vazio, pulando\n");
      erros++;
      continue;
    }
    process.stdout.write(" ok\n");

    // Preview da mensagem gerada
    console.log("  ┌─────────────────────────────────────────");
    mensagem.split("\n").forEach(l => console.log(`  │ ${l}`));
    console.log("  └─────────────────────────────────────────\n");

    // ── Envia DM ────────────────────────────────────────
    process.stdout.write(`  Enviando DM para @${handle}...`);
    const res = await enviarDM(page, handle, mensagem).catch(err => ({ ok: false, motivo: err.message }));

    if (res.ok) {
      process.stdout.write(" ✓ enviado\n\n");
      await marcarEnviado(sheets, lead.linha, lead.obs).catch(() => {});
      enviados++;
      if (enviados % 5 === 0) await salvarSessao(context).catch(() => {});
    } else {
      process.stdout.write(` ✗ ${res.motivo}\n\n`);
      erros++;
    }

    // ── Comportamento humano entre leads ───────────────
    if (enviados < CONFIG.limiteDMs) {
      const espera = CONFIG.entreDMs.min + Math.random() * (CONFIG.entreDMs.max - CONFIG.entreDMs.min);
      console.log(`  Aguardando ${Math.round(espera / 1000)}s antes do próximo...`);
      console.log("  ──────────────────────────────────────────────\n");

      // Durante a espera, simula comportamento humano no feed
      const acaoHumana = Math.random();
      if (acaoHumana < 0.4) {
        // Navega pelo feed e rola um pouco
        await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
        await sleep(1500, 3000);
        await humanScroll(page, 400 + Math.random() * 600);
        await sleep(2000, 4000);
        await humanScroll(page, 200 + Math.random() * 300);
      } else if (acaoHumana < 0.6) {
        // Fica parado na tela atual (como quem foi tomar café)
        await sleep(3000, 6000);
        // Mexe o mouse aleatoriamente
        await page.mouse.move(300 + Math.random() * 600, 200 + Math.random() * 400);
        await sleep(1000, 2000);
        await page.mouse.move(400 + Math.random() * 400, 300 + Math.random() * 300);
      }
      // Espera o restante do delay
      await sleep(espera * 0.6);
    }
  }

  await salvarSessao(context).catch(() => {});
  await browser.close();

  console.log("\n  ══════════════════════════════════════════════");
  console.log(`  ✓ DMs enviados:       ${enviados}`);
  console.log(`  ✓ Instas encontrados: ${buscados}`);
  console.log(`  ✗ Erros:              ${erros}`);
  console.log("  ══════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error("\n  ERRO FATAL:", err.message);
  process.exit(1);
});
