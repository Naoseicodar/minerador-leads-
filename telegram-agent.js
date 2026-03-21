require('dotenv').config();
const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');
const { exec } = require('child_process');
const fs = require('fs');
const util = require('util');
const path = require('path');
const cron = require('node-cron');
const execPromise = util.promisify(exec);

console.log("Iniciando Agente Telegram (Mega Inteligência) com suporte a Áudio e Rotina Diária...");

if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.OPENAI_API_KEY) {
    console.error("ERRO: Tokens não encontrados no seu .env!");
    process.exit(1);
}

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const conversations = {};

const ROOT_DIR = "C:\\Users\\Win10\\CLAUDE PROJETOS\\minerador-leads";
const CHAT_ID_FILE = path.join(ROOT_DIR, "telegram-chat-id.txt");

const tools = [
    {
        type: "function",
        function: {
            name: "execute_command",
            description: "Abre uma janela CMD visível no PC do usuário e roda um script (ideal para bots de longa duração como .bat ou servers). Não retorna o output para a IA.",
            parameters: {
                type: "object",
                properties: { command: { type: "string" } },
                required: ["command"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "run_silent_command",
            description: "Roda um comando de forma rápida e silenciosa (shell/cmd) e devolve a resposta pra IA. Use para comandos do GITHUB, npm, wmic, etc.",
            parameters: {
                type: "object",
                properties: { command: { type: "string" } },
                required: ["command"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Lê o conteúdo de um arquivo de texto no computador.",
            parameters: {
                type: "object",
                properties: { filepath: { type: "string", description: "Caminho relativo ou absoluto. Ex: memoria-projeto.txt ou server.js" } },
                required: ["filepath"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_dir",
            description: "Lista os arquivos de uma pasta para você encontrar o que procura.",
            parameters: {
                type: "object",
                properties: { dirpath: { type: "string", description: "Caminho. Deixe vazio para listar a raiz do projeto." } },
            },
        },
    }
];

const getSystemPrompt = () => `Data e hora atual: ${new Date().toLocaleString('pt-BR')}
Você é a IA da Nox Tech (Assistente Pessoal do Luan). Você é Mega Inteligente.
Você compartilha o arquivo 'memoria-projeto.txt' com a IA do código. Leia-o quando pedido um relatório.
Seja objetivo, rápido e o mais inteligente possível.`;

// Salva o Chat ID para envio da rotina diária
function saveChatId(chatId) {
    if (!fs.existsSync(CHAT_ID_FILE)) {
        fs.writeFileSync(CHAT_ID_FILE, chatId.toString());
        console.log("Chat ID salvo para automações matinais:", chatId);
    }
}

bot.start((ctx) => {
    saveChatId(ctx.chat.id);
    conversations[ctx.chat.id] = [{ role: 'system', content: getSystemPrompt() }];
    ctx.reply('Olá Luan! É oficial: Recebi o **Upgrade de Rotina Automática**. 🌅\n\nAgora, além de te ouvir e entender áudios, vou te acordar TODOS OS DIAS às 8:00 (Horário de Portugal) com as metas traçadas para a agência Nox Tech!');
});

async function processUserMessage(ctx, chatId, userText) {
    saveChatId(chatId);

    if (!conversations[chatId]) {
        conversations[chatId] = [{ role: 'system', content: getSystemPrompt() }];
    } else {
        conversations[chatId][0].content = getSystemPrompt();
    }

    conversations[chatId].push({ role: "user", content: userText });

    try {
        ctx.sendChatAction('typing');

        let response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: conversations[chatId],
            tools: tools,
            tool_choice: "auto",
        });

        let responseMessage = response.choices[0].message;
        let messageToStore = { role: responseMessage.role, content: responseMessage.content };
        if (responseMessage.tool_calls) messageToStore.tool_calls = responseMessage.tool_calls;
        conversations[chatId].push(messageToStore);

        while (responseMessage.tool_calls) {
            for (const toolCall of responseMessage.tool_calls) {
                const args = JSON.parse(toolCall.function.arguments);
                let toolResponse = "";
                
                try {
                    if (toolCall.function.name === "execute_command") {
                        ctx.reply(`💻 Abrindo visualmente: \`${args.command}\`...`, { parse_mode: 'Markdown' });
                        exec(`start "" cmd /k "${args.command}"`, { cwd: ROOT_DIR }, () => {});
                        toolResponse = `A janela abriu com sucesso (rodando em background).`;
                    
                    } else if (toolCall.function.name === "run_silent_command") {
                        ctx.reply(`⚙️ Comando: \`${args.command}\`...`, { parse_mode: 'Markdown' });
                        const { stdout, stderr } = await execPromise(args.command, { cwd: ROOT_DIR });
                        toolResponse = stdout.trim() || stderr.trim() || "Comando rodado mas sem texto de output.";
                    
                    } else if (toolCall.function.name === "read_file") {
                        const targetPath = path.isAbsolute(args.filepath) ? args.filepath : path.join(ROOT_DIR, args.filepath);
                        toolResponse = fs.readFileSync(targetPath, 'utf8');
                    
                    } else if (toolCall.function.name === "list_dir") {
                        const targetDir = args.dirpath ? (path.isAbsolute(args.dirpath) ? args.dirpath : path.join(ROOT_DIR, args.dirpath)) : ROOT_DIR;
                        toolResponse = fs.readdirSync(targetDir).join('\\n');
                    }
                } catch (e) {
                    toolResponse = `Erro na tool: ${e.message}`;
                }

                conversations[chatId].push({
                    tool_call_id: toolCall.id,
                    role: "tool",
                    name: toolCall.function.name,
                    content: (toolResponse || "").substring(0, 10000)
                });
            }

            response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: conversations[chatId],
                tools: tools,
            });
            responseMessage = response.choices[0].message;
            
            let followUpToStore = { role: responseMessage.role, content: responseMessage.content };
            if (responseMessage.tool_calls) followUpToStore.tool_calls = responseMessage.tool_calls;
            conversations[chatId].push(followUpToStore);
        }

        if (responseMessage.content) {
            ctx.reply(responseMessage.content);
        }

    } catch (error) {
        console.error("API Erro:", error);
        ctx.reply('Ocorreu um erro ao pensar na reposta. Detalhe salvo nos logs do terminal.');
    }
}

bot.on('text', async (ctx) => {
    await processUserMessage(ctx, ctx.chat.id, ctx.message.text);
});

bot.on('voice', async (ctx) => {
    const chatId = ctx.chat.id;
    try {
        ctx.sendChatAction('typing');
        const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
        
        ctx.reply('🎙️ Ouvindo...');
        
        const response = await fetch(fileLink.href);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const audioPath = path.join(ROOT_DIR, 'temp_audio.ogg');
        fs.writeFileSync(audioPath, buffer);
        
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            model: "whisper-1",
        });
        
        const userText = transcription.text;
        ctx.reply(`🗣️ *Você:* "${userText}"`, { parse_mode: 'Markdown' });
        fs.unlinkSync(audioPath);
        
        await processUserMessage(ctx, chatId, userText);
        
    } catch (e) {
        console.error("Erro no áudio:", e);
        ctx.reply('Desculpe, não consegui escutar direito.');
    }
});

// =============================================
// ROTINA MATINAL (NODE-CRON) - 8:00 AM PORTUGAL
// =============================================
cron.schedule('0 8 * * *', async () => {
    console.log("Executando rotina matinal das 8:00 AM (Portugal)...");
    
    if (fs.existsSync(CHAT_ID_FILE)) {
        const chatId = fs.readFileSync(CHAT_ID_FILE, 'utf8').trim();
        
        const promptMatinal = `
        Gere uma mensagem motivacional de "Bom dia" para o Luan Silva, CEO da Nox Tech. 
        Aja como o assistente pessoal dele. Hoje é dia ${new Date().toLocaleDateString('pt-BR')}.
        
        A mensagem DEVE trazer essa lista de metas diárias que não podem falhar:
        1. Ligar para no mínimo 30 pessoas (prospecção ativa).
        2. Criar 3 sites para clientes que fecharam via email.
        3. Criar 3 sites para clientes que fecharam via cold call.
        4. O desafio de entregar tudo em 48h!
        
        Instruções:
        - A mensagem deve parecer escrita por uma IA mega inteligente e leal ao dono (você).
        - Use formatação no Telegram (Markdown com asteriscos **).
        - Use emojis relevantes para o negócio.
        - Termine perguntando por onde ele quer que a IA comece os trabalhos do dia (ex: rodar algum minerador).`;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: 'system', content: promptMatinal }]
            });
            
            const mensagem = response.choices[0].message.content;
            await bot.telegram.sendMessage(chatId, mensagem, { parse_mode: 'Markdown' });
            console.log("Mensagem diária enviada com sucesso ao chat ID:", chatId);
            
        } catch (e) {
             console.error("Erro ao gerar/enviar mensagem do cron diário:", e.message);
        }
    } else {
        console.log("Chat ID não encontrado. O Luan precisa mandar uma mensagem primeiro.");
    }
}, {
    timezone: "Europe/Lisbon" // Fuso de Portugal garantido
});

bot.launch().then(() => console.log("🚀 Telegram AI Agent (Nível 3 - Mega Inteligente & Cronometrado) Online!"));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// =============================================
// Servidor Web Dummy (Para o Healthcheck do Railway)
// =============================================
const http = require('http');
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Online e Saudavel!\\n');
}).listen(PORT, () => {
    console.log(`🌍 Healthcheck do Railway rodando na porta ${PORT}`);
});
