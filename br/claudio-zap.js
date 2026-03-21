/**
 * Claudio Zap — Bot WhatsApp com comportamento humano
 * Autenticação por pairing code (sem QR code)
 * Uso: node claudio-zap.js
 */

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const Anthropic = require("@anthropic-ai/sdk");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

// =============================================
// CONFIGURAÇÕES
// =============================================
const CONFIG = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,

  credenciaisPath: path.join(__dirname, "credentials.json"),
  sheetId: process.env.SHEET_ID || "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI",
  sheetNome: "Leads",

  // Seu número WhatsApp — SÓ dígitos, com código do país (sem +)
  meuNumero: "16126333722",  // +1 612 633 3722

  // Limites diários
  limiteDia: Number(process.env.LIMITE_ZAP) || 40,

  // Horário comercial (hora local da máquina)
  horarioInicio: 8,
  horarioFim: 18,

  vendedor: {
    nome: "Luan",
  },

  // Áudio padrão — coloque o arquivo na pasta do projeto
  // Formatos aceitos: .ogg, .mp3, .m4a, .wav
  // Se o arquivo não existir, envia mensagem de texto normalmente
  audioPath: path.join(__dirname, "audio-padrao.ogg"),

  // ── DELAYS HUMANOS (ms) ────────────────────────────────────────────
  leitura:    { min: 3000,   max: 8000   },  // "lendo" o chat antes de digitar
  entreDMs:   { min: 130000, max: 310000 },  // 2m10s ~ 5m10s entre cada mensagem
  pausaLonga: { min: 480000, max: 750000 },  // 8~12min a cada 10 msgs (pausa humana)
  erroEspera: { min: 45000,  max: 90000  },  // espera extra em caso de erro
};

// Colunas da planilha (índice 0 = coluna A)
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
  obs:       12, // M
};

const MARCA_ZAP = "WhatsApp ✓";
const NAO = "Não encontrado";

// Mapa de chatId → dados do lead (para ouvir respostas)
const leadsEnviados = new Map();

// =============================================
// UTILITÁRIOS
// =============================================
function sleep(min, max) {
  const ms = max ? Math.floor(Math.random() * (max - min) + min) : min;
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const hora = new Date().toLocaleTimeString("pt-BR");
  console.log(`[${hora}] ${msg}`);
}

function dentroHorario() {
  const h = new Date().getHours();
  return h >= CONFIG.horarioInicio && h < CONFIG.horarioFim;
}

// Converte (41) 99999-9999 → 5541999999999@c.us
function formatarParaWhatsApp(telefone) {
  const d = telefone.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return d + "@c.us";
  if (d.length === 11) return `55${d}@c.us`;
  if (d.length === 10) return `55${d}@c.us`;
  return null;
}

// Só celular: 11 dígitos onde o 3º dígito (após DDD) é 9
function ehCelular(telefone) {
  const d = telefone.replace(/\D/g, "");
  return d.length === 11 && d[2] === "9";
}

// =============================================
// GOOGLE SHEETS
// =============================================
async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CONFIG.credenciaisPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

async function buscarLeads(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.sheetId,
    range: `${CONFIG.sheetNome}!A2:M`,
  });
  const rows = res.data.values || [];

  return rows.map((row, i) => ({
    linha:     i + 2,
    nome:      row[COL.nome]      || "",
    telefone:  row[COL.telefone]  || "",
    website:   row[COL.website]   || "",
    bairro:    row[COL.bairro]    || "",
    avaliacao: row[COL.avaliacao] || "",
    reviews:   row[COL.reviews]   || "",
    obs:       row[COL.obs]       || "",
  })).filter(lead => {
    if (!lead.telefone || lead.telefone === NAO) return false;
    if (!ehCelular(lead.telefone)) return false;
    if (lead.obs.includes(MARCA_ZAP)) return false;
    return true;
  });
}

async function marcarEnviado(sheets, linha, obsAtual) {
  const novaObs = obsAtual ? `${obsAtual} | ${MARCA_ZAP}` : MARCA_ZAP;
  // Atualiza coluna A (Status) e coluna M (Obs) ao mesmo tempo
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

async function marcarResposta(sheets, linha, classificacao) {
  const data = new Date().toLocaleString("pt-BR");
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CONFIG.sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${CONFIG.sheetNome}!A${linha}`, values: [[classificacao]] },
        { range: `${CONFIG.sheetNome}!M${linha}`, values: [[`${MARCA_ZAP} | Respondeu: ${data}`]] },
      ],
    },
  });
}

// =============================================
// IA — GERAÇÃO DE MENSAGEM CURTA E HUMANA
// =============================================
const anthropic = new Anthropic({ apiKey: CONFIG.anthropicKey });

function inferirSubNicho(nome) {
  const n = nome.toLowerCase();
  if (/dent|odont|sorriso|oral|orto/.test(n))           return "dentista";
  if (/capilar|micropig|cabelo|calvice|hair/.test(n))    return "capilar";
  if (/psicol|terapia|terapeut|mental|emocion/.test(n))  return "psicologia";
  if (/fisio|reabilit|ortopedi|coluna|postur/.test(n))   return "fisioterapia";
  if (/nutri|emagre|dieta|peso/.test(n))                 return "nutricao";
  if (/estet|beleza|skin|harmoniz|botox|pele|laser|depil/.test(n)) return "estetica";
  return "saude";
}

const NICHO_COPY = {
  dentista:      { dor: "alguém com dor de dente pesquisando 'dentista perto de mim' não vai achar vocês", gancho: "quem aparece primeiro no Google leva o paciente — é decisão de urgência" },
  capilar:       { dor: "o cliente pesquisa semanas antes de decidir — sem site, vocês são eliminados antes do primeiro contato", gancho: "num serviço de alto valor, credibilidade online é pré-requisito" },
  psicologia:    { dor: "paciente novo buscando terapeuta não liga sem antes ver o profissional online", gancho: "a primeira impressão hoje acontece no Google, não no consultório" },
  fisioterapia:  { dor: "quem não tem indicação vai direto ao Google — e escolhe quem aparece primeiro", gancho: "são pacientes novos que ninguém está captando" },
  nutricao:      { dor: "no Instagram tem muita concorrência — no Google local ainda dá pra aparecer na frente", gancho: "quem domina o Google Maps do bairro tem vantagem real" },
  estetica:      { dor: "mesmo com Instagram incrível, sem site vocês não aparecem na busca do Google", gancho: "quem equilibra Instagram e Google capta muito mais" },
  saude:         { dor: "quem precisa do serviço e abre o Google não vai achar vocês sem site", gancho: "o paciente escolhe quem aparece primeiro, não necessariamente quem é melhor" },
};

async function gerarMensagem(lead) {
  const { nome, bairro, avaliacao, reviews } = lead;
  const copy = NICHO_COPY[inferirSubNicho(nome)];

  const rep =
    Number(avaliacao) >= 4.5 && Number(reviews) > 30
      ? `tem ${avaliacao}★ com ${reviews} avaliações no Google`
      : Number(reviews) > 0
      ? `aparece no Google Maps com ${reviews} avaliações`
      : `aparece no Google Maps`;

  const prompt = `Você é ${CONFIG.vendedor.nome}, especialista em sites e SEO para negócios de saúde. Entrega em menos de 48h.

Escreva uma mensagem de WhatsApp CURTA para este lead. Tom: humano e direto, como um colega mandando mensagem — não pode parecer robô ou vendedor.

LEAD:
- Empresa: ${nome}
- Bairro: ${bairro || "região local"}
- Situação: ${rep}
- Problema: ${copy.dor}
- Argumento: ${copy.gancho}

ESTRUTURA (máximo 4 linhas):
1. Cumprimento + apresentação rápida (1 frase curta)
2. Observação específica sobre a empresa + o problema que eles têm (2 frases)
3. Uma única pergunta simples para abrir conversa (sem compromisso)

REGRAS ABSOLUTAS:
- Máximo 4 linhas no total — seja conciso
- Comece com: Oi [nome da empresa]!
- Zero formalidade ("prezado", "espero que esteja bem" = proibido)
- Sem emojis
- Sem mencionar preço
- Escreva APENAS o texto da mensagem, sem aspas nem explicação`;

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    messages: [{ role: "user", content: prompt }],
  });

  return res.content[0].text.trim();
}

// =============================================
// IA — CLASSIFICAÇÃO DE RESPOSTA
// =============================================
async function classificarResposta(mensagem) {
  const prompt = `Classifique esta resposta de WhatsApp em UMA das categorias abaixo. Responda APENAS com o nome da categoria, sem explicação.

CATEGORIAS:
- Interessado         → demonstra interesse, quer saber mais, fez pergunta sobre o serviço
- Agendar conversa    → quer marcar horário, ligar, reunião
- Pediu mais info     → perguntou preço, prazo, como funciona
- Resposta automática → mensagem automática de bot/ausência ("obrigado por entrar em contato", "retornaremos em breve", "fora do horário")
- Nao tem interesse   → recusou, já tem site, não precisa, não quer
- Numero errado       → pessoa errada, não conhece a empresa
- Outra               → qualquer outra coisa que não se encaixa

MENSAGEM RECEBIDA:
"${mensagem}"`;

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 20,
    messages: [{ role: "user", content: prompt }],
  });

  return res.content[0].text.trim();
}

// =============================================
// COMPORTAMENTO HUMANO — ENVIO
// =============================================

// Verifica se existe arquivo de áudio configurado
function temAudio() {
  // Tenta extensões alternativas se audio-padrao.ogg não existir
  const extensoes = [".ogg", ".mp3", ".m4a", ".wav"];
  const base = path.join(__dirname, "audio-padrao");
  for (const ext of extensoes) {
    if (fs.existsSync(base + ext)) {
      CONFIG.audioPath = base + ext;
      return true;
    }
  }
  return false;
}

async function enviarAudioComoHumano(client, chatId) {
  const chat = await client.getChatById(chatId);

  // 1. Ficar "online"
  await client.sendPresenceAvailable();
  await sleep(800, 2000);

  // 2. "Abrir" o chat
  await chat.sendSeen();
  await sleep(CONFIG.leitura.min, CONFIG.leitura.max);

  // 3. Mostrar "gravando áudio..." (microfone — igual ao WhatsApp real)
  await chat.sendStateRecording();

  // Simula tempo de gravação (entre 8s e 20s — como alguém gravando de verdade)
  const tempoGravando = Math.floor(Math.random() * 12000) + 8000;
  await sleep(tempoGravando);

  // 4. Para o indicador e pausa breve antes de enviar
  await chat.clearState();
  await sleep(500, 1200);

  // 5. Enviar o áudio como mensagem de voz
  const media = MessageMedia.fromFilePath(CONFIG.audioPath);
  await client.sendMessage(chatId, media, { sendAudioAsVoice: true });

  // 6. Ficar offline
  await sleep(3000, 7000);
  await client.sendPresenceUnavailable();
}

async function enviarTextoComoHumano(client, chatId, mensagem) {
  const chat = await client.getChatById(chatId);

  await client.sendPresenceAvailable();
  await sleep(800, 2000);
  await chat.sendSeen();
  await sleep(CONFIG.leitura.min, CONFIG.leitura.max);

  await chat.sendStateTyping();

  const palavras = mensagem.split(" ").length;
  const msPorPalavra = 60000 / 42;
  const variacao = 0.65 + Math.random() * 0.70;
  const tempoDigitando = Math.min(Math.max(palavras * msPorPalavra * variacao, 4000), 20000);
  await sleep(tempoDigitando);

  await chat.clearState();
  await sleep(600, 1800);
  await client.sendMessage(chatId, mensagem);

  await sleep(3000, 7000);
  await client.sendPresenceUnavailable();
}

async function enviarComoHumano(client, chatId, mensagem) {
  if (temAudio()) {
    await enviarAudioComoHumano(client, chatId);
  } else {
    await enviarTextoComoHumano(client, chatId, mensagem);
  }
}

// =============================================
// MAIN
// =============================================
async function main() {
  if (!dentroHorario()) {
    log(`Fora do horário comercial (${CONFIG.horarioInicio}h–${CONFIG.horarioFim}h). Encerrando.`);
    process.exit(0);
  }

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: "claudio-zap" }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    },
  });

  // ── Pairing code (sem QR) ──────────────────────────────────────────
  let pairingCodeSolicitado = false;
  client.on("qr", async () => {
    if (pairingCodeSolicitado) return;
    pairingCodeSolicitado = true;
    log("Gerando pairing code...");
    try {
      const code = await client.requestPairingCode(CONFIG.meuNumero);
      console.log("\n╔══════════════════════════════════════╗");
      console.log(`║  PAIRING CODE: ${code.padEnd(22)}║`);
      console.log("║                                      ║");
      console.log("║  No WhatsApp do celular:             ║");
      console.log("║  Dispositivos vinculados →           ║");
      console.log("║  Vincular com número de telefone     ║");
      console.log("╚══════════════════════════════════════╝\n");
    } catch (e) {
      log("Erro ao gerar pairing code: " + e.message);
    }
  });

  client.on("authenticated", () => log("Autenticado!"));

  client.on("ready", async () => {
    log("WhatsApp conectado. Buscando leads...");

    const sheets = await getSheets();
    const leads = await buscarLeads(sheets);
    log(`${leads.length} leads disponíveis (celular, sem WhatsApp enviado)`);

    let enviados = 0;
    let erros = 0;

    for (const lead of leads) {
      if (enviados >= CONFIG.limiteDia) {
        log(`Limite de ${CONFIG.limiteDia} msgs/dia atingido. Encerrando.`);
        break;
      }

      if (!dentroHorario()) {
        log("Fora do horário comercial. Parando por hoje.");
        break;
      }

      const chatId = formatarParaWhatsApp(lead.telefone);
      if (!chatId) {
        log(`Número inválido — ${lead.nome}: ${lead.telefone}`);
        continue;
      }

      try {
        log(`[${enviados + 1}/${CONFIG.limiteDia}] Preparando mensagem para ${lead.nome}...`);
        const mensagem = await gerarMensagem(lead);

        log(`Enviando para ${lead.nome} (${lead.telefone})...`);
        await enviarComoHumano(client, chatId, mensagem);
        await marcarEnviado(sheets, lead.linha, lead.obs);

        // Registra no mapa para detectar respostas
        leadsEnviados.set(chatId, { linha: lead.linha, nome: lead.nome });

        enviados++;
        log(`Enviado (${enviados}): ${lead.nome}`);
        console.log(`\n--- Mensagem ---\n${mensagem}\n----------------\n`);

        // Pausa longa a cada 10 msgs
        if (enviados % 10 === 0 && enviados < CONFIG.limiteDia) {
          const pausa = Math.floor(Math.random() * (CONFIG.pausaLonga.max - CONFIG.pausaLonga.min) + CONFIG.pausaLonga.min);
          log(`Pausa de ${Math.round(pausa / 60000)}min (comportamento humano)...`);
          await sleep(pausa);
        } else {
          const delay = Math.floor(Math.random() * (CONFIG.entreDMs.max - CONFIG.entreDMs.min) + CONFIG.entreDMs.min);
          log(`Aguardando ${Math.round(delay / 1000)}s antes do próximo...`);
          await sleep(delay);
        }

      } catch (e) {
        erros++;
        log(`Erro ao enviar para ${lead.nome}: ${e.message}`);
        await sleep(CONFIG.erroEspera.min, CONFIG.erroEspera.max);
      }
    }

    log(`\nEnvios concluídos: ${enviados} enviados, ${erros} erros.`);
    log(`Ouvindo respostas em background. Pressione Ctrl+C para encerrar.`);
    // Não encerra — fica ouvindo respostas o dia todo
  });

  // ── Ouvir respostas dos leads ──────────────────────────────────────
  client.on("message", async msg => {
    // Ignora mensagens enviadas por nós mesmos
    if (msg.fromMe) return;

    const chatId = msg.from;
    const lead = leadsEnviados.get(chatId);
    if (!lead) return; // Não é um lead que contactamos hoje

    try {
      const texto = msg.body || "";
      log(`Resposta recebida de ${lead.nome}: "${texto.slice(0, 80)}"`);

      const sheets = await getSheets();
      const classificacao = await classificarResposta(texto);
      await marcarResposta(sheets, lead.linha, classificacao);

      log(`Planilha atualizada — ${lead.nome}: ${classificacao}`);
    } catch (e) {
      log(`Erro ao processar resposta de ${lead.nome}: ${e.message}`);
    }
  });

  client.on("auth_failure", () => {
    log("Falha na autenticação. Delete a pasta .wwebjs_auth e tente novamente.");
    process.exit(1);
  });

  client.on("disconnected", reason => {
    log("Desconectado: " + reason);
    process.exit(1);
  });

  client.initialize();
}

main().catch(err => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
