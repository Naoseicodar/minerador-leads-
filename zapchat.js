/**
 * ZapChat — Bot WhatsApp com comportamento humano
 * Autenticação por pairing code (sem QR code)
 * Uso: node zapchat.js
 */

require("dotenv").config();
const { Client, LocalAuth, RemoteAuth, MessageMedia } = require("whatsapp-web.js");
const { SupabaseStore } = require("./supabase-store");
const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

// No Render: decodifica credentials.json a partir de variavel de ambiente
if (process.env.GOOGLE_CREDENTIALS_B64 && !fs.existsSync(path.join(__dirname, "credentials.json"))) {
  fs.writeFileSync(
    path.join(__dirname, "credentials.json"),
    Buffer.from(process.env.GOOGLE_CREDENTIALS_B64, "base64")
  );
}

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// =============================================
// CONFIGURAÇÕES
// =============================================
const CONFIG = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,

  credenciaisPath: path.join(__dirname, "credentials.json"),
  sheetId: process.env.SHEET_ID || "1IZTRE-aYZ1kfMe04fClHWc0JUShlQJxgp51I2_JsKlI",
  sheetNome: "leads-Br",

  // Seu número WhatsApp — SÓ dígitos, com código do país (sem +)
  meuNumero: process.env.MEU_NUMERO_ZAP || "16126333722",

  // Limites diários
  limiteDia: Number(process.env.LIMITE_ZAP) || 40,

  // Horário comercial (hora local da máquina)
  horarioInicio: Number(process.env.HORARIO_INICIO) || 8,
  horarioFim: Number(process.env.HORARIO_FIM) || 22,

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

const STAGE = {
  HOOK:       "hook",        // enviou pattern interrupt — aguardando resposta
  QUALIFY:    "qualify",     // fez pergunta qualificadora — aguardando resposta
  OFFER:      "offer",       // apresentou oferta zero risco — aguardando
  OBJECTION:  "objection",   // tratando objeção
  CLOSE:      "close",       // lead interessado — confirmando próximos passos
  DONE:       "done",        // conversa encerrada
};

// Sequência de follow-up para leads sem resposta (em ms)
const FOLLOWUP_DELAYS = [
  30 * 60 * 1000,        // 30 minutos
  3 * 60 * 60 * 1000,    // 3 horas
  24 * 60 * 60 * 1000,   // 24 horas
  48 * 60 * 60 * 1000,   // 48 horas
];

const FOLLOWUP_MSGS = [
  // Follow-up 1 (30min) — checar recebimento, curto e neutro
  [
    "Oi! Minha mensagem chegou certinho?",
    "Oi, tudo bem? Só checando se recebeu antes",
    "Chegou minha mensagem aí?",
    "Oi! Conferindo se chegou — às vezes some no WhatsApp",
  ],
  // Follow-up 2 (4h) — social proof, caso similar, sem pitch direto
  [
    "Lembrei de um caso parecido — trabalhei com ${nicho} que tinha o mesmo problema. Depois que o site foi pro ar, começaram a receber 4-5 contatos novos por semana só do Google. Pensei no ${nome}.",
    "Ontem finalizei um projeto pra ${nicho} semelhante ao ${nome}. Em 3 semanas já aparecia no topo do Google Maps do bairro. Achei que podia ser útil compartilhar.",
    "Acabei de entregar um site pra ${nicho} que não aparecia no Google. Hoje aparece na frente da concorrência. Lembrei do ${nome} na hora — seria o mesmo caso.",
  ],
  // Follow-up 3 (24h) — ângulo diferente, pergunta genuína sem mencionar o site
  [
    "Pergunta diferente — sem falar de site: quando um cliente novo chega no ${nome}, como ele costuma ter encontrado vocês?",
    "Curiosidade genuína: o ${nome} recebe mais clientes por indicação ou por busca no Google hoje?",
    "Mudando o ângulo — vocês já tentaram algo antes pra aparecer mais no Google Maps?",
  ],
  // Follow-up 4 (48h) — saída elegante, porta aberta
  [
    "Tudo bem! Não vou insistir mais. Se um dia quiser aparecer melhor no Google, é só chamar. Abraço!",
    "Ok, entendo que pode não ser o momento. Fica o contato — qualquer hora, é só falar. Abraço!",
    "Última aqui! Se quiser trazer mais clientes pelo Google no futuro, pode me chamar. Abraço!",
  ],
];

// =============================================
// STATUS — Dashboard
// =============================================
const statusPath  = path.join(__dirname, "status.json");
const controlPath = path.join(__dirname, "control.json");

const statusData = {
  status_bot: "iniciando",
  iniciado: new Date().toISOString(),
  enviados: 0,
  limite: CONFIG.limiteDia,
  totalLeads: 0,
  respostas: 0,
  interessados: 0,
  fechados: 0,
  semInteresse: 0,
  botIa: 0,
  leadsStatus: [],
  logs: [],
  ultimaAtualizacao: null,
};

function atualizarStatus(patch, logMsg) {
  Object.assign(statusData, patch);
  if (logMsg) {
    statusData.logs.unshift(`[${new Date().toLocaleTimeString("pt-BR")}] ${logMsg}`);
    if (statusData.logs.length > 150) statusData.logs.length = 150;
  }
  statusData.ultimaAtualizacao = new Date().toISOString();
  try { fs.writeFileSync(statusPath, JSON.stringify(statusData, null, 2)); } catch {}
}

function getControl() {
  try {
    if (fs.existsSync(controlPath)) return JSON.parse(fs.readFileSync(controlPath));
  } catch {}
  return { pausado: false, parado: false };
}

async function verificarControle() {
  while (true) {
    const ctrl = getControl();
    if (ctrl.parado) return "parado";
    if (!ctrl.pausado) return "ok";
    if (statusData.status_bot !== "pausado") {
      atualizarStatus({ status_bot: "pausado" }, "Bot pausado pelo dashboard");
    }
    await sleep(2000);
  }
}

// Mapa de chatId → dados do lead (para ouvir respostas)
const leadsEnviados = new Map();

// Timers de follow-up ativos (para cancelar se lead responder)
const followupTimers = new Map();

// Lock por chatId para evitar race condition em respostas simultâneas
const respondendo = new Set();

// Cache de autenticação Google Sheets
let sheetsCache = null;

// Número de teste (escopo global para o listener de mensagens ter acesso)
const testeNumero = process.env.TESTE_NUMERO || null;

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

function saudacaoHorario() {
  const h = new Date().getHours();
  const manha = [
    "Oi, bom dia!",
    "Bom dia!",
    "Oi! Bom dia",
    "Boa manhã!",
    "Olá, bom dia!",
  ];
  const tarde = [
    "Olá, boa tarde!",
    "Boa tarde!",
    "Oi, boa tarde!",
    "Olá! Boa tarde",
    "Oi! Tudo bem?",
  ];
  const noite = [
    "Oi, boa noite!",
    "Boa noite!",
    "Olá, boa noite!",
    "Oi! Boa noite",
    "Olá! Tudo bem?",
  ];
  const lista = h >= 6 && h < 12 ? manha : h >= 12 && h < 18 ? tarde : noite;
  return lista[Math.floor(Math.random() * lista.length)];
}

function dentroHorario() {
  const h = new Date().getHours();
  return h >= CONFIG.horarioInicio && h < CONFIG.horarioFim;
}

// Aguarda até o início do horário comercial, checando a cada minuto
async function aguardarHorarioComercial() {
  if (dentroHorario()) return;
  const agora = new Date();
  const h = agora.getHours();
  const min = agora.getMinutes();
  const minutosAteInicio = h < CONFIG.horarioInicio
    ? (CONFIG.horarioInicio - h) * 60 - min
    : (24 - h + CONFIG.horarioInicio) * 60 - min;
  log(`Fora do horário comercial (${h}h). Aguardando ${Math.round(minutosAteInicio)}min até ${CONFIG.horarioInicio}h...`);
  atualizarStatus({ status_bot: "aguardando_horario" }, `Fora do horário — aguardando ${CONFIG.horarioInicio}h`);
  while (!dentroHorario()) {
    await sleep(60000); // checa a cada 1 minuto
  }
  log(`Horário comercial iniciado. Retomando envios...`);
}

// Converte (41) 99999-9999 → 5541999999999@c.us
function formatarParaWhatsApp(telefone) {
  const d = telefone.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) return d + "@c.us";
  if (d.length === 11) return `55${d}@c.us`;
  if (d.length === 10) return `55${d}@c.us`;
  return null;
}

// Só celular: aceita 11 dígitos (sem 55) ou 13 dígitos (com 55)
function ehCelular(telefone) {
  const d = telefone.replace(/\D/g, "");
  if (d.length === 11) return d[2] === "9";
  if (d.length === 13 && d.startsWith("55")) return d[4] === "9";
  return false;
}

// =============================================
// GOOGLE SHEETS
// =============================================
async function getSheets() {
  if (sheetsCache) return sheetsCache;
  const auth = new google.auth.GoogleAuth({
    keyFile: CONFIG.credenciaisPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsCache = google.sheets({ version: "v4", auth });
  return sheetsCache;
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

// Variações do gancho — foco no PROBLEMA de não aparecer bem no Google
const GANCHOS = [
  (nome, nicho, bairro) =>
    `Pesquisei "${nicho} no ${bairro || "bairro de vocês"}" agora no Google — o ${nome} não aparece nas primeiras posições. Sabe quantos clientes estão indo pra concorrência por isso?`,

  (nome, nicho, bairro) =>
    `Toda vez que alguém pesquisa "${nicho} perto de mim" aí no ${bairro || "bairro"} e o ${nome} não aparece... esse cliente vai pra quem aparece primeiro. Isso acontece todo dia.`,

  (nome, nicho, bairro) =>
    `Vi que tem ${nicho} aparecendo antes do ${nome} no Google Maps aí no ${bairro || "bairro"}. Esses clientes que pesquisam e não encontram vocês — pra onde acham que vão?`,

  (nome, nicho, bairro) =>
    `Fiz uma busca rápida: "${nicho} no ${bairro || "bairro de vocês"}" — apareceram outros antes do ${nome}. Vocês sabem quanto isso custa por mês em clientes perdidos?`,
];

function montarGancho(nome, nicho, bairro) {
  const fn = GANCHOS[Math.floor(Math.random() * GANCHOS.length)];
  return fn(nome, nicho, bairro || "região de vocês");
}

// =============================================
// NOVO FUNIL — PATTERN INTERRUPT + REVELAÇÃO
// =============================================

// Mensagem 1 — Pattern Interrupt (curiosity gap, específico, 1 linha)
const MSG1_HOOKS = [
  (nome, nicho, bairro) =>
    `Pesquisei agora "${nicho} no ${bairro}" no Google — tem algo sobre o ${nome} que precisa de atenção. Posso te mostrar?`,

  (nome, nicho, bairro) =>
    `Passei pelo Google Maps procurando ${nicho} aí no ${bairro} — encontrei algo sobre o ${nome} que me chamou atenção. Vale um minuto?`,

  (nome, nicho, bairro) =>
    `Vi uma coisa sobre o ${nome} no Google agora que pode estar custando clientes pra vocês. Posso te falar rapidinho?`,

  (nome, nicho, bairro) =>
    `Fiz uma busca aqui: "${nicho} no ${bairro}". Apareceu algo sobre o ${nome} que acho importante vocês saberem. Posso compartilhar?`,

  (nome, nicho, bairro) =>
    `Rodei uma análise rápida do ${nome} no Google — encontrei um ponto que outros ${nicho} do ${bairro} já resolveram. Posso te mostrar?`,

  (nome, nicho, bairro) =>
    `Procurei ${nicho} no ${bairro} agora e vi algo que achei importante falar com o ${nome}. Tudo bem se eu explicar?`,
];

// Mensagem 2 — Revelação (problema + resultado + velocidade, máx 2 linhas)
const MSG2_REVELACAO = [
  (nome, nicho, bairro) =>
    `O ${nome} não aparece quando alguém pesquisa "${nicho} no ${bairro}" — esses clientes vão direto pra concorrência. Resolvo isso em 48h, só cobra se gostar. Faz sentido ver?`,

  (nome, nicho, bairro) =>
    `Outros ${nicho} aparecem antes do ${nome} no Google Maps daqui. Em 48h isso muda — site profissional + Google configurado, R$500 só se gostar. Vale dar uma olhada?`,

  (nome, nicho, bairro) =>
    `Quem pesquisa ${nicho} no ${bairro} não está encontrando o ${nome}. Em 2 dias resolvo isso — entrego primeiro, você avalia, só paga se gostar. Faz sentido?`,

  (nome, nicho, bairro) =>
    `Cada dia que o ${nome} não aparece no Google, alguém no ${bairro} vai pro concorrente. Em 48h isso para — entrego, você avalia, só paga se gostar. Posso detalhar?`,

  (nome, nicho, bairro) =>
    `O ${nome} some nas buscas de ${nicho} no ${bairro} — e a concorrência aparece no lugar. Em 48h inverto isso. Só cobra se gostar. Posso te explicar como?`,

  (nome, nicho, bairro) =>
    `Vi que o ${nome} não aparece nas primeiras posições quando alguém busca ${nicho} aí. Em 48h coloco vocês no topo — sem custo antecipado. Posso mostrar como funciona?`,
];

function montarPatternInterrupt(nome, nicho, bairro) {
  const fn = MSG1_HOOKS[Math.floor(Math.random() * MSG1_HOOKS.length)];
  return fn(nome, nicho, bairro || "região de vocês");
}

function montarRevelacao(nome, nicho, bairro) {
  const fn = MSG2_REVELACAO[Math.floor(Math.random() * MSG2_REVELACAO.length)];
  return fn(nome, nicho, bairro || "região de vocês");
}

// =============================================
// MÍDIA — ÁUDIO E IMAGEM
// =============================================
async function transcreverAudio(base64data, mimetype) {
  if (!openai) {
    log("OPENAI_API_KEY não configurada — áudio ignorado.");
    return null;
  }
  const ext = mimetype.includes("ogg") ? "ogg" : mimetype.includes("mp4") ? "mp4" : "mp3";
  const tempFile = path.join(__dirname, `_audio_tmp_${Date.now()}.${ext}`);
  try {
    fs.writeFileSync(tempFile, Buffer.from(base64data, "base64"));
    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: "whisper-1",
      language: "pt",
    });
    return resp.text;
  } finally {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

async function processarMidia(msg) {
  // Retorna { texto, imagemBase64, imagemMime } conforme o tipo
  if (!msg.hasMedia) return { texto: msg.body || "", imagemBase64: null, imagemMime: null };

  const tipo = msg.type; // image | audio | ptt | video | document
  const media = await msg.downloadMedia();

  if (tipo === "image") {
    return {
      texto: msg.body || "[lead enviou uma imagem]",
      imagemBase64: media.data,
      imagemMime: media.mimetype,
    };
  }

  if (tipo === "audio" || tipo === "ptt") {
    log("Áudio recebido — transcrevendo...");
    const transcricao = await transcreverAudio(media.data, media.mimetype);
    return {
      texto: transcricao ? `[áudio]: ${transcricao}` : "[lead enviou um áudio — sem transcrição]",
      imagemBase64: null,
      imagemMime: null,
    };
  }

  return { texto: msg.body || `[lead enviou ${tipo}]`, imagemBase64: null, imagemMime: null };
}

// =============================================
// IA — FUNIL DE CONVERSA (Estratégia Zero Risco)
// =============================================
async function gerarRespostaFunil(dadosLead, mensagemRecebida, imagemBase64 = null, imagemMime = null) {
  const { stage, historico, nome, nicho, bairro } = dadosLead;

  const system = `Você é Luan, especialista em sites e Google My Business para negócios locais no Brasil. Entrega em 48h.
Está no WhatsApp com: ${nome} (${nicho}, ${bairro || "bairro local"})
Estágio atual: ${stage}

## QUEM VOCÊ É
Você NÃO é vendedor. É um especialista que genuinamente quer ajudar negócios locais a aparecerem no Google e trazerem mais clientes. Já fez sites pra dentistas, clínicas de estética, fisioterapeutas e psicólogos — e viu isso mudar o faturamento deles.
Você soa como uma pessoa real — direto, warm, levemente casual. O cara confiante que sabe o que faz mas nunca empurra goela abaixo.

## SUA OFERTA
Site profissional + Google My Business configurado, entregue em 48h.
Valor: R$500 — cobrado SOMENTE se o cliente gostar. Se não gostar, não precisa nem responder. Zero risco.

## TONALIDADE — BELFORT STRAIGHT LINE (texto, não voz)

Alterne naturalmente entre 3 tons:

1. CERTEZA ABSOLUTA — ao falar de resultados, seja firme e confiante:
   "Quando o site vai pro ar, o Google começa a mostrar o ${nome} pra quem pesquisa ${nicho} aqui no ${bairro || "bairro"}..."

2. CURIOSIDADE GENUÍNA — ao fazer perguntas, pareça realmente interessado:
   "Quanto tempo o ${nome} tá no ${bairro || "bairro"}?"

3. HOMEM RAZOÁVEL — nas objeções, calmo e lógico, como se fosse óbvio:
   "Olha, entendo completamente — e honestamente, a maioria fala a mesma coisa..."

Nunca pareça desesperado. Nunca pressione. Após uma afirmação forte, espere a resposta.

## TÉCNICAS AVANÇADAS

FUTURE PACING — pinte o quadro do futuro deles:
"Imagina daqui 3 semanas — alguém aqui no ${bairro || "bairro"} pesquisa '${nicho} perto de mim' às 21h. O ${nome} aparece. Ela liga. Esse cliente? Nunca teria chegado sem o site."

QUERO SER HONESTO — use pra baixar a guarda:
"Olha, quero ser honesto — não tô aqui pra vender algo que não faz sentido pra vocês. Se a agenda tá lotada pelos próximos 6 meses, tudo bem. Mas se tem espaço pra mais um cliente por semana, um site resolve isso de forma permanente."

THE LOOP — se estiverem quase convencidos mas hesitando:
"Esquece tudo que falei por um segundo. Resumindo: toda vez que alguém pesquisa ${nicho} aqui no ${bairro || "bairro"}, aparece a concorrência, não o ${nome}. É um cliente real, indo embora. Todo dia. Tudo que faço é resolver isso. Por R$500."

FAIR ENOUGH — valide ANTES de redirecionar qualquer objeção:
"Faz sentido..." → depois redirecione. Nunca resista diretamente.

ÂNCORA DE PREÇO — quando preço vier à tona:
"Agências cobram R$3.000 a R$8.000 por isso. Eu cobro R$500 porque trabalho direto, sem intermediário. Uma vez só."

## FUNIL POR ESTÁGIO

### hook → lead respondeu ao primeiro contato (pattern interrupt)
Apresente-se em 1 linha e faça UMA pergunta qualificadora genuína com base no que eles responderam:
- Se não tem site / dúvida: "Vocês já têm site hoje ou ainda não?"
- Se mencionaram Google / visibilidade: "O ${nome} aparece bem nas buscas do Google hoje?"
- Se resposta genérica / saudação: "Quando um cliente novo chega no ${nome}, como ele costuma ter encontrado vocês?"
Seja warm e genuinamente curioso. NÃO mencione a oferta ainda. NÃO diga o preço.
proximo_stage: "qualify"

### qualify → lead respondeu à pergunta qualificadora
Com base EXATAMENTE no que ele respondeu, apresente a oferta personalizada:
- Conecte a resposta dele com a solução: "Já que vocês [o que ele disse]..."
- Mencione que já montou uma prévia de site pro ${nome}
- Explique a oferta zero risco em 1-2 frases (entrega em 48h, R$500 só se gostar)
- Termine com: "Posso mandar o link da prévia?"
proximo_stage: "offer"

### offer → lead respondeu à oferta
- QUER VER / QUALQUER CURIOSIDADE / PERGUNTA:
  Peça o e-mail pra enviar o link. Tom animado mas contido.
  proximo_stage: "close"
- JÁ TEM SITE:
  "Faz sentido. E aparece bem quando alguém pesquisa ${nicho} aqui no ${bairro || "bairro"}?"
  proximo_stage: "objection"
- SEM INTERESSE:
  "Faz sentido, sem problema. Se um dia quiser aparecer melhor no Google, pode chamar. Abraço!"
  proximo_stage: "done"

### objection → tratando objeção
"R$500 caro":
Use ÂNCORA DE PREÇO + "uma consulta/paciente já paga o site. Depois disso, todo cliente do Google é lucro puro. Todo mês. Pra sempre. E só cobra se gostar."
proximo_stage: "offer"

"Já temos site":
"Faz sentido. E vocês aparecem nas primeiras posições quando alguém pesquisa ${nicho} aqui no ${bairro || "bairro"}? Porque é exatamente isso que a gente garante."
proximo_stage: "offer"

"Não precisamos / estamos bem":
Use QUERO SER HONESTO + "não é sobre mais trabalho — é sobre clientes melhores, que pagam mais. Quem aparece no Google cobra mais porque parece mais profissional."
proximo_stage: "offer"

"Como sei que é sério?":
"Pergunta certa. Olha — não tô pedindo nada agora. A gente entrega primeiro. Se não gostar, não paga. Posso mandar exemplos de sites que já fizemos?"
proximo_stage: "offer"

Após 2 objeções seguidas sem avanço — use THE LOOP uma vez. Se ainda não avançar, encerre com elegância.
proximo_stage: "done"

### close → lead deu e-mail / confirmou interesse
Confirme com entusiasmo contido, diga que entrega em 48h, encerre positivamente.
proximo_stage: "done"

## REGRAS ABSOLUTAS
- Nunca mencione ligação ou chamada — tudo acontece no WhatsApp
- Sem emojis
- Máximo 4 linhas por mensagem
- Use o nome do estabelecimento 1-2x de forma natural
- Se perguntarem se é robô/IA: "Não, sou o Luan — cuido dos projetos pessoalmente."
- Cada mensagem termina com UMA pergunta ou ação clara — nunca deixe sem direcionamento

Responda SOMENTE com JSON válido:
{"proximo_stage": "...", "mensagem": "..."}`;

  const userContent = imagemBase64
    ? [
        { type: "image", source: { type: "base64", media_type: imagemMime, data: imagemBase64 } },
        { type: "text", text: mensagemRecebida },
      ]
    : mensagemRecebida;

  const messages = [
    ...historico,
    { role: "user", content: userContent },
  ];

  const res = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system,
    messages,
  });

  const text = res.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  return { proximo_stage: stage, mensagem: text };
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

// =============================================
// DETECTOR DE MENSAGEM AUTOMÁTICA
// =============================================
// Bot de IA ativo — para tudo, não responde, cancela follow-ups
const PADROES_BOT_IA = [
  /digite \d/i,
  /pressione \d/i,
  /para continuar.*\d/i,
  /para falar com.*\d/i,
  /ol[aá].*voc[eê] est[aá] falando com.*bot/i,
  /bot de atendimento/i,
  /chatbot/i,
  /atendimento autom[aá]tico/i,
  /este [eé] um n[uú]mero autom[aá]tico/i,
  /n[aã]o responda a este n[uú]mero/i,
  /sistema de atendimento/i,
  /protocolo n[uú]mero/i,
  /auto.?reply/i,
  /powered by/i,
];

// Fora do horário — só ignora, mantém follow-ups (a pessoa vai ver depois)
const PADROES_FORA_HORARIO = [
  /retornaremos em breve/i,
  /entraremos em contato/i,
  /obrigad[oa] por entrar em contato/i,
  /fora do hor[aá]rio/i,
  /hor[aá]rio de atendimento/i,
  /sua mensagem foi recebida/i,
  /no momento n[aã]o estamos dispon[ií]veis/i,
  /we.ll get back to you/i,
  /out of office/i,
  /ausente/i,
];

function ehBotIa(texto)        { return PADROES_BOT_IA.some(p => p.test(texto)); }
function ehForaHorario(texto)  { return PADROES_FORA_HORARIO.some(p => p.test(texto)); }

// =============================================
// ETIQUETAS WHATSAPP BUSINESS
// =============================================
// Mapa de nome → id (preenchido no evento ready)
const labelMap = {};

async function carregarEtiquetas(client) {
  try {
    const labels = await client.getLabels();
    for (const l of labels) labelMap[l.name.toLowerCase()] = l.id;
    log(`Etiquetas carregadas: ${Object.keys(labelMap).join(", ") || "nenhuma"}`);
  } catch {
    log("Etiquetas não disponíveis (requer WhatsApp Business).");
  }
}

async function aplicarEtiqueta(client, chatId, nome) {
  const id = labelMap[nome.toLowerCase()];
  if (!id) return; // etiqueta não existe no app
  try {
    await client.addOrRemoveLabels([id], [chatId]);
  } catch {}
}

// =============================================
// FOLLOW-UP AUTOMÁTICO
// =============================================
function agendarFollowUps(client, chatId) {
  const timers = [];

  FOLLOWUP_DELAYS.forEach((delay, index) => {
    const t = setTimeout(async () => {
      const lead = leadsEnviados.get(chatId);
      if (!lead || lead.stage !== STAGE.HOOK) return; // já respondeu ou avançou

      const opcoes = FOLLOWUP_MSGS[index];
      const template = opcoes[Math.floor(Math.random() * opcoes.length)];
      const mensagem = template
        .replace(/\$\{nome\}/g,   lead.nome)
        .replace(/\$\{nicho\}/g,  lead.nicho  || "negócio")
        .replace(/\$\{bairro\}/g, lead.bairro || "bairro de vocês");

      try {
        log(`Follow-up ${index + 1}/4 → ${lead.nome}`);
        await enviarTextoComoHumano(client, chatId, mensagem);
        lead.historico.push({ role: "assistant", content: mensagem });
        leadsEnviados.set(chatId, lead);
      } catch (e) {
        log(`Erro no follow-up ${index + 1} para ${lead.nome}: ${e.message}`);
      }

      // Após último follow-up, marca como encerrado
      if (index === FOLLOWUP_DELAYS.length - 1) {
        lead.stage = STAGE.DONE;
        leadsEnviados.set(chatId, lead);
        log(`Follow-ups encerrados para ${lead.nome} — sem resposta.`);
      }
    }, delay);

    timers.push(t);
  });

  followupTimers.set(chatId, timers);
}

function cancelarFollowUps(chatId) {
  const timers = followupTimers.get(chatId);
  if (timers) {
    timers.forEach(t => clearTimeout(t));
    followupTimers.delete(chatId);
  }
}

// =============================================
// MAIN
// =============================================
async function main() {

  // RemoteAuth no Render (Supabase), LocalAuth local
  const authStrategy = process.env.SUPABASE_URL
    ? new RemoteAuth({
        store: new SupabaseStore(),
        clientId: "zapchat",
        backupSyncIntervalMs: 5 * 60 * 1000, // salva sessao a cada 5min
      })
    : new LocalAuth({ clientId: "zapchat" });

  const client = new Client({
    authStrategy,
    pairWithPhoneNumber: { phoneNumber: CONFIG.meuNumero },
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
      ],
    },
  });

  // ── Pairing code (sem QR) ──────────────────────────────────────────
  let primeiroCode = true;
  client.on("code", (code) => {
    if (!primeiroCode) {
      console.log("\n[Código anterior expirou. Use o novo abaixo:]\n");
    }
    primeiroCode = false;
    console.log("\n╔══════════════════════════════════════╗");
    console.log(`║  PAIRING CODE: ${code.padEnd(22)}║`);
    console.log("║                                      ║");
    console.log("║  No WhatsApp do celular:             ║");
    console.log("║  Dispositivos vinculados →           ║");
    console.log("║  Vincular com número de telefone     ║");
    console.log("╚══════════════════════════════════════╝\n");
  });

  client.on("authenticated", () => {
    log("Autenticado!");
  });

  client.on("ready", async () => {
    log("WhatsApp conectado. Buscando leads...");
    await carregarEtiquetas(client);

    // Modo teste — pula Google Sheets, envia pra número fixo
    let leads, sheets;

    if (testeNumero) {
      log(`*** MODO TESTE — enviando apenas para ${testeNumero} ***`);
      leads = [{
        linha:     1,
        nome:      "Clínica Teste",
        telefone:  testeNumero,
        bairro:    "Batel",
        avaliacao: "4.8",
        reviews:   "52",
        obs:       "",
      }];
    } else {
      sheets = await getSheets();
      leads = await buscarLeads(sheets);
      log(`${leads.length} leads disponíveis (celular, sem WhatsApp enviado)`);
      atualizarStatus({ status_bot: "rodando", totalLeads: leads.length, limite: CONFIG.limiteDia });
    }

    // Aguarda horário comercial antes de começar
    await aguardarHorarioComercial();

    // Delay humano antes de começar — simula abrir o app e checar mensagens
    const inicioDelay = Math.floor(Math.random() * 60000) + 30000; // 30-90s
    log(`Aguardando ${Math.round(inicioDelay / 1000)}s antes de iniciar (comportamento humano)...`);
    await sleep(inicioDelay);

    let enviados = 0;
    let erros = 0;

    for (const lead of leads) {
      if (enviados >= CONFIG.limiteDia) {
        log(`Limite de ${CONFIG.limiteDia} msgs/dia atingido. Encerrando.`);
        break;
      }

      const chatIdRaw = formatarParaWhatsApp(lead.telefone);
      if (!chatIdRaw) {
        log(`Número inválido — ${lead.nome}: ${lead.telefone}`);
        continue;
      }

      // Aguarda horário comercial antes de cada envio (caso o loop passe da meia-noite)
      await aguardarHorarioComercial();

      // Verifica pause/stop antes de cada envio
      const estado = await verificarControle();
      if (estado === "parado") {
        atualizarStatus({ status_bot: "parado" }, "Bot parado pelo usuário");
        log("Bot parado pelo dashboard.");
        break;
      }
      atualizarStatus({ status_bot: "rodando" });

      try {
        // Resolve o ID correto (compatível com o novo sistema LID do WhatsApp)
        const numeroLimpo = chatIdRaw.replace("@c.us", "");
        const numberId = await client.getNumberId(numeroLimpo);
        if (!numberId) {
          log(`Número não encontrado no WhatsApp — ${lead.nome}: ${lead.telefone}`);
          continue;
        }
        const chatId = numberId._serialized;

        const nicho = inferirSubNicho(lead.nome);
        const msg1  = montarPatternInterrupt(lead.nome, nicho, lead.bairro);
        const msg2  = montarRevelacao(lead.nome, nicho, lead.bairro);

        // Msg 1: pattern interrupt — curiosity gap específico
        log(`[${enviados + 1}/${CONFIG.limiteDia}] Iniciando conversa com ${lead.nome}...`);
        await enviarTextoComoHumano(client, chatId, msg1);

        // Delay humano entre as duas mensagens (12-28s — abre o contato, digita, relê)
        await sleep(12000, 28000);

        // Msg 2: revelação — problema + resultado + velocidade
        await enviarTextoComoHumano(client, chatId, msg2);
        if (sheets) await marcarEnviado(sheets, lead.linha, lead.obs);

        // Registra no mapa com estágio e histórico para o funil
        // A API Anthropic exige alternância user/assistant — simulamos um "user" vazio no início
        const historico = [
          { role: "user", content: "[início da conversa]" },
          { role: "assistant", content: `${msg1}\n\n${msg2}` },
        ];
        leadsEnviados.set(chatId, {
          linha:    lead.linha,
          nome:     lead.nome,
          nicho,
          bairro:   lead.bairro,
          stage:    STAGE.HOOK,
          historico,
        });

        // Registra lead na tabela do dashboard
        statusData.leadsStatus.unshift({
          nome:    lead.nome,
          nicho,
          bairro:  lead.bairro || "",
          stage:   STAGE.HOOK,
          horario: new Date().toLocaleTimeString("pt-BR"),
          ultimaResposta: null,
        });

        // Agenda follow-ups automáticos caso não haja resposta
        agendarFollowUps(client, chatId);

        enviados++;
        atualizarStatus({ enviados }, `Enviado (${enviados}/${CONFIG.limiteDia}): ${lead.nome}`);
        log(`Enviado (${enviados}): ${lead.nome} — aguardando resposta`);

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

    atualizarStatus({ status_bot: "concluido" }, `Envios concluídos: ${enviados} enviados, ${erros} erros`);
    log(`\nEnvios concluídos: ${enviados} enviados, ${erros} erros.`);
    log(`Ouvindo respostas em background. Pressione Ctrl+C para encerrar.`);
    // Não encerra — fica ouvindo respostas o dia todo
  });

  // ── Funil de conversa — ouvir e responder leads ───────────────────
  client.on("message", async msg => {
    if (msg.fromMe) return;

    const chatId = msg.from;
    const lead = leadsEnviados.get(chatId);
    if (!lead) return;
    if (lead.stage === STAGE.DONE) return;

    const { texto, imagemBase64, imagemMime } = await processarMidia(msg);
    if (!texto.trim()) return;
    log(`[${lead.stage}] ${lead.nome}: "${texto.slice(0, 80)}"`);

    // Bot de IA ativo — para tudo, não responde
    if (ehBotIa(texto)) {
      cancelarFollowUps(chatId);
      lead.stage = STAGE.DONE;
      leadsEnviados.set(chatId, lead);
      atualizarStatus({ botIa: statusData.botIa + 1 }, `Bot IA detectado: ${lead.nome}`);
      log(`Bot de IA detectado — ${lead.nome}. Automação encerrada.`);
      try {
        const sheets = await getSheets();
        await marcarResposta(sheets, lead.linha, "Bot de IA");
      } catch {}
      return;
    }

    // Fora do horário — ignora, não responde, mantém follow-ups ativos
    if (ehForaHorario(texto)) {
      log(`Fora do horário — ${lead.nome}. Aguardando resposta real.`);
      return;
    }

    // Lead respondeu — cancela todos os follow-ups pendentes
    cancelarFollowUps(chatId);

    // Evita processar duas respostas ao mesmo tempo do mesmo lead
    if (respondendo.has(chatId)) {
      log(`${lead.nome} já está sendo respondido — mensagem ignorada.`);
      return;
    }
    respondendo.add(chatId);

    try {
      // Adiciona mensagem do lead ao histórico
      lead.historico.push({ role: "user", content: texto });

      // Gera resposta do funil via Claude (com imagem se houver)
      const { proximo_stage, mensagem } = await gerarRespostaFunil(lead, texto, imagemBase64, imagemMime);

      // Envia com comportamento humano
      await enviarTextoComoHumano(client, chatId, mensagem);

      // Guarda stage anterior antes de atualizar (necessário para check da etiqueta "Fechado")
      const stageAnterior = lead.stage;

      // Atualiza histórico e estágio
      lead.historico.push({ role: "assistant", content: mensagem });
      lead.stage = proximo_stage;
      leadsEnviados.set(chatId, lead);

      // Atualiza tabela de leads no dashboard
      const lidx = statusData.leadsStatus.findIndex(l => l.nome === lead.nome);
      if (lidx >= 0) {
        statusData.leadsStatus[lidx].stage = proximo_stage;
        statusData.leadsStatus[lidx].ultimaResposta = new Date().toLocaleTimeString("pt-BR");
      }

      // Atualiza métricas de resposta
      if (stageAnterior === STAGE.HOOK && proximo_stage !== STAGE.HOOK) {
        atualizarStatus({ respostas: statusData.respostas + 1 }, `Respondeu: ${lead.nome}`);
      }
      if (proximo_stage === STAGE.CLOSE) {
        atualizarStatus({ interessados: statusData.interessados + 1 }, `Interessado: ${lead.nome}`);
      } else if (proximo_stage === STAGE.DONE && stageAnterior === STAGE.CLOSE) {
        atualizarStatus({ fechados: statusData.fechados + 1 }, `Fechou: ${lead.nome}`);
      } else if (proximo_stage === STAGE.DONE) {
        atualizarStatus({ semInteresse: statusData.semInteresse + 1 }, `Sem interesse: ${lead.nome}`);
      }
      log(`Respondeu ${lead.nome} → estágio: ${proximo_stage}`);
      console.log(`\n--- Resposta enviada ---\n${mensagem}\n------------------------\n`);

      // Etiquetas + planilha por estágio
      const sheetsResp = testeNumero ? null : await getSheets();

      // Qualquer resposta real → etiqueta "Respondeu"
      await aplicarEtiqueta(client, chatId, "Respondeu");

      if (proximo_stage === STAGE.OFFER) {
        await aplicarEtiqueta(client, chatId, "Em conversa");
      } else if (proximo_stage === STAGE.CLOSE) {
        await aplicarEtiqueta(client, chatId, "Interessado");
        if (sheetsResp) await marcarResposta(sheetsResp, lead.linha, "Interessado");
      } else if (proximo_stage === STAGE.DONE && stageAnterior === STAGE.CLOSE) {
        await aplicarEtiqueta(client, chatId, "Fechado");
        if (sheetsResp) await marcarResposta(sheetsResp, lead.linha, "Fechado — aguardando entrega");
      } else if (proximo_stage === STAGE.DONE) {
        if (sheetsResp) await marcarResposta(sheetsResp, lead.linha, "Sem interesse");
      }

    } catch (e) {
      log(`Erro ao responder ${lead.nome}: ${e.message}`);
    } finally {
      respondendo.delete(chatId);
    }
  });

  client.on("auth_failure", () => {
    log("Falha na autenticação. Delete a pasta .wwebjs_auth e tente novamente.");
    process.exit(1);
  });

  client.on("disconnected", reason => {
    log(`Desconectado: ${reason}. Reiniciando em 15s...`);
    setTimeout(() => {
      client.initialize();
    }, 15000);
  });

  client.initialize();
}

main().catch(err => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
