/**
 * enriquecer-leads.js — Enriquece leads BR com CNPJ + telefone
 *
 * Fluxo:
 *   1. cnpj.biz/procura/{nome} (Playwright) → encontra CNPJ pelo nome
 *   2. BrasilAPI /cnpj/v1/{cnpj} (fetch) → pega telefone, situacao, endereco
 *   3. Atualiza planilha: coluna CNPJ, Telefone (se vazio), Obs
 *
 * Uso: node enriquecer-leads.js
 */

require("dotenv").config();
const { chromium } = require("playwright");
const { google }   = require("googleapis");
const path         = require("path");

// ─── Config ─────────────────────────────────────────────────
const SHEET_ID         = process.env.SHEET_ID || "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI";
const SHEET_ABA        = process.env.SHEET_ABA_BR || "leads-Br";
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const LIMITE           = Number(process.env.LIMITE_ENRICH) || 80;
const NAO              = "Não encontrado";
const MARKER           = "CNPJ✓";

// A=Status(0) B=CNPJ(1) C=Nome(2) D=Tel(3) E=Email(4) F=Instagram(5)
// G=Website(6) H=Endereco(7) I=Bairro(8) J=Aval(9) K=NrAval(10)
// L=LinkMaps(11) M=Data(12) N=Obs(13)
const COL = {
  STATUS:0, CNPJ:1, NOME:2, TEL:3, EMAIL:4,
  INSTAGRAM:5, WEBSITE:6, ENDERECO:7, BAIRRO:8,
  AVAL:9, NRAVAL:10, MAPS:11, DATA:12, OBS:13
};

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

async function atualizarLead(sheets, rowIndex, campos) {
  const data = Object.entries(campos).map(([col, valor]) => ({
    range: `${SHEET_ABA}!${String.fromCharCode(65 + Number(col))}${rowIndex + 2}`,
    values: [[valor]],
  }));
  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { valueInputOption: "RAW", data },
  });
}

// ─── Utilitarios ────────────────────────────────────────────
const sleep = (min, max) => new Promise(r =>
  setTimeout(r, max ? Math.floor(Math.random() * (max - min) + min) : min)
);

function normalizar(str) {
  if (!str) return "";
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Extrai o nome real da empresa — remove lixo do Maps
function limparNome(nome) {
  // Remove tudo depois de separadores de descricao
  let n = nome
    .replace(/\s*[-|–]\s*(ozonio|medicina|estetica|beleza|rejuv|ultraformer|depila|laser|botox|limpeza|massagem|nutri|fisio|psicologo|implante|odonto|dental|clinica|centro|curitiba|parana|\bpr\b|ltda).*/gi, "")
    .replace(/\s*[|]\s*.*/g, "")          // remove tudo apos |
    .replace(/\s*\(.*?\)/g, "")           // remove parenteses
    .replace(/\s*-\s*(curitiba|pr|parana|centro|batel|agua verde).*/gi, "") // remove cidade no final
    .replace(/\s*em\s+(curitiba|londrina|maringá|cascavel).*/gi, "")
    .trim();

  // Se ficou muito longo (>5 palavras), pega as 4 primeiras
  const palavras = n.split(/\s+/).filter(Boolean);
  if (palavras.length > 4) n = palavras.slice(0, 4).join(" ");

  return n || nome.split(/\s+/).slice(0, 3).join(" ");
}

// Gera variações de busca do mais especifico ao mais generico
function variacoesBusca(nome, cidade) {
  const limpo   = limparNome(nome);
  const palavras = limpo.split(/\s+/).filter(Boolean);
  const curto    = palavras.slice(0, 2).join(" ");
  const c        = cidade ? normalizar(cidade).split(" ")[0] : "";

  const vars = [limpo];
  if (curto !== limpo && curto.length > 3) vars.push(curto);
  if (c && !normalizar(limpo).includes(c)) vars.push(`${limpo} ${c}`);
  if (palavras.length > 2) vars.push(palavras.slice(0, 3).join(" "));

  // Remove duplicatas preservando ordem
  return [...new Set(vars)];
}

function extrairCidade(bairro, endereco) {
  if (bairro) {
    const p = bairro.split(" - ");
    if (p.length > 1) return normalizar(p[p.length - 1]).split(" ")[0];
  }
  if (endereco) {
    const m = endereco.match(/[A-Z][a-z]+ - [A-Z]{2}/) || endereco.match(/,\s*([^,]+),\s*[A-Z]{2}/);
    if (m) return normalizar(m[1] || m[0]);
  }
  return "";
}

// Score de similaridade entre dois nomes
function scoreSimilaridade(nomeLead, nomeResultado) {
  const IGNORAR = new Set(["clinica","consultorio","centro","instituto","espaco",
    "studio","estetica","saude","ltda","eireli","me","epp","ss","de","do","da",
    "dos","das","e","em","para","integrada","avancada","corp","facial","corporal"]);

  const palavrasLead = normalizar(nomeLead).split(" ").filter(p => p.length > 2 && !IGNORAR.has(p));
  const palavrasRes  = normalizar(nomeResultado).split(" ").filter(p => p.length > 2 && !IGNORAR.has(p));
  if (!palavrasLead.length || !palavrasRes.length) return 0;

  const matches = palavrasLead.filter(w => palavrasRes.some(r => r.includes(w) || w.includes(r))).length;
  return matches / Math.max(palavrasLead.length, palavrasRes.length);
}

// ─── BrasilAPI ──────────────────────────────────────────────
async function buscarBrasilAPI(cnpj) {
  try {
    const digits = cnpj.replace(/\D/g, "");
    const res    = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = await res.json();

    const ddd = (d.ddd_telefone_1 || "").replace(/\D/g, "");
    let telefone = "";
    if (ddd.length >= 10) {
      telefone = `(${ddd.slice(0,2)}) ${ddd.slice(2,7)}-${ddd.slice(7)}`;
    }

    return {
      razaoSocial:  d.razao_social        || "",
      nomeFantasia: d.nome_fantasia        || "",
      situacao:     d.descricao_situacao_cadastral || "",
      atividade:    d.cnae_fiscal_descricao || "",
      municipio:    d.municipio            || "",
      uf:           d.uf                   || "",
      telefone,
    };
  } catch (_) {
    return null;
  }
}

// ─── cnpj.biz via Playwright ────────────────────────────────
async function buscarNoCnpjBiz(page, termos, nomeLead, cidadeLead) {
  for (const termo of termos) {
    try {
      const slug = encodeURIComponent(termo);
      await page.goto(`https://cnpj.biz/procura/${slug}`, {
        waitUntil: "domcontentloaded", timeout: 15000,
      });
      await sleep(1000, 2000);

      // Extrai todos os resultados da pagina
      const resultados = await page.evaluate(() => {
        const items = [];
        document.querySelectorAll("a[href]").forEach(a => {
          const href = a.href || a.getAttribute("href") || "";
          // Links de empresa: href absoluto ou relativo com 14 digitos no final
          if (!/\d{14}$/.test(href)) return;
          const bloco = a.closest("div,li,article,section") || a;
          const texto = bloco.innerText || a.innerText || "";
          const cnpjMatch = texto.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
          if (!cnpjMatch) return;
          // Evita duplicatas pelo CNPJ
          if (items.some(i => i.cnpj === cnpjMatch[0])) return;
          items.push({
            cnpj:  cnpjMatch[0],
            texto: texto.trim(),
          });
        });
        return items;
      });

      // Fallback — pega CNPJ diretamente do texto da pagina se so tiver 1 resultado
      if (!resultados.length) {
        const cnpjsNaPagina = await page.evaluate(() => {
          const matches = document.body.innerText.match(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g) || [];
          return [...new Set(matches)];
        });
        if (cnpjsNaPagina.length === 1) {
          // So um resultado — confere se a cidade bate
          const bodyText = await page.evaluate(() => document.body.innerText);
          return { cnpj: cnpjsNaPagina[0], scoreMatch: 0.5, fonte: "unico-resultado", bodyText };
        }
        continue; // Proxima variacao de busca
      }

      // Escolhe o melhor match por nome + cidade
      let melhor = null, melhorScore = 0;
      for (const r of resultados.slice(0, 10)) {
        const sNome = scoreSimilaridade(nomeLead, r.texto);
        const sCidade = cidadeLead && normalizar(r.texto).includes(cidadeLead) ? 0.3 : 0;
        const total  = sNome + sCidade;
        if (total > melhorScore) { melhorScore = total; melhor = r; }
      }

      // Aceita match com score baixo se so tiver 1 resultado
      const minScore = resultados.length === 1 ? 0.15 : 0.25;
      if (melhor && melhorScore >= minScore) {
        return { cnpj: melhor.cnpj, scoreMatch: melhorScore, texto: melhor.texto, fonte: "cnpjbiz" };
      }

    } catch (_) {
      continue;
    }

    await sleep(800, 1500);
  }

  return null;
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  console.log("\n  ╔══════════════════════════════════════╗");
  console.log("  ║     ENRIQUECEDOR DE LEADS            ║");
  console.log("  ║     cnpj.biz + BrasilAPI             ║");
  console.log("  ╚══════════════════════════════════════╝\n");
  console.log(`  Aba: ${SHEET_ABA} | Limite: ${LIMITE} leads\n`);

  const sheets = await getSheets();
  const rows   = await getLeads(sheets);

  const pendentes = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => !(row[COL.OBS] || "").includes(MARKER) && !(row[COL.CNPJ] || "").match(/\d{2}\.\d{3}/));

  console.log(`  Total: ${rows.length} | Pendentes: ${pendentes.length}`);
  console.log(`  Processando: ${Math.min(pendentes.length, LIMITE)}\n`);
  console.log("  ──────────────────────────────────────\n");

  if (!pendentes.length) { console.log("  Todos ja enriquecidos.\n"); return; }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled", "--lang=pt-BR"],
  });

  const ctx = await browser.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { "Accept-Language": "pt-BR,pt;q=0.9" },
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins",   { get: () => [1, 2, 3] });
  });

  const page = await ctx.newPage();
  await page.route("**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,eot,css}", r => r.abort());

  let achouCnpj = 0, achouTel = 0, semMatch = 0;

  for (let i = 0; i < Math.min(pendentes.length, LIMITE); i++) {
    const { row, idx } = pendentes[i];
    const nome     = (row[COL.NOME]     || "").trim();
    const telAtual = (row[COL.TEL]      || "").trim();
    const bairro   = (row[COL.BAIRRO]   || "").trim();
    const endereco = (row[COL.ENDERECO] || "").trim();
    const obs      = (row[COL.OBS]      || "").trim();

    if (!nome) continue;

    process.stdout.write(`  [${i+1}/${Math.min(pendentes.length, LIMITE)}] ${nome.slice(0,38).padEnd(38)} `);

    const cidade  = extrairCidade(bairro, endereco);
    const termos  = variacoesBusca(nome, cidade);
    const achado  = await buscarNoCnpjBiz(page, termos, nome, cidade);

    if (!achado?.cnpj) {
      semMatch++;
      process.stdout.write(`sem match\n`);
      // Marca para nao tentar de novo
      await atualizarLead(sheets, idx, {
        [COL.OBS]: obs ? `${obs} | ${MARKER}:0` : `${MARKER}:0`
      }).catch(() => {});
      await sleep(1500, 3000);
      continue;
    }

    // Busca detalhes na BrasilAPI
    const detalhe = await buscarBrasilAPI(achado.cnpj);
    const campos  = {};
    const info    = [`CNPJ:${achado.cnpj}`];

    // Salva CNPJ
    campos[COL.CNPJ] = achado.cnpj;
    achouCnpj++;

    // Atualiza telefone se estava vazio
    if (detalhe?.telefone && (!telAtual || telAtual === NAO)) {
      campos[COL.TEL] = detalhe.telefone;
      achouTel++;
      info.push(`tel:${detalhe.telefone}`);
    }

    // Obs: atividade + situacao + marker
    const extra = [
      detalhe?.situacao  ? `Sit:${detalhe.situacao}`              : "",
      detalhe?.atividade ? detalhe.atividade.slice(0, 45)          : "",
      detalhe?.municipio ? `${detalhe.municipio}/${detalhe.uf}`   : "",
    ].filter(Boolean).join(" | ");

    campos[COL.OBS] = obs
      ? `${obs} | ${MARKER}${extra ? ` | ${extra}` : ""}`
      : `${MARKER}${extra ? ` | ${extra}` : ""}`;

    await atualizarLead(sheets, idx, campos).catch(err =>
      process.stdout.write(`\n  ERRO salvar linha ${idx+2}: ${err.message}\n`)
    );

    process.stdout.write(`✓ score:${achado.scoreMatch.toFixed(2)} | ${info.join(" | ")}\n`);
    await sleep(2000, 4000);
  }

  await browser.close();

  console.log("\n  ══════════════════════════════════════");
  console.log(`  CNPJ encontrado: ${achouCnpj}`);
  console.log(`  Telefone novo:   ${achouTel}`);
  console.log(`  Sem match:       ${semMatch}`);
  console.log("  ══════════════════════════════════════\n");
}

main().catch(err => {
  console.error("\n  ERRO FATAL:", err.message);
  process.exit(1);
});
