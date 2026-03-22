/**
 * start-all.js
 * Script central para rodar TODOS os agentes e painéis simultaneamente,
 * com um proxy reverso expondo tanto o ZapChat antigo quanto o Minerador Premium
 * numa única porta acessível pela web (Render).
 */

const { spawn } = require('child_process');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

console.log("🔥 [SYSTEM] Iniciando inicialização massiva de bots e painéis...");

// 1. Iniciar Telegram Agent (porta isolada 5001)
const botTelegram = spawn('node', ['telegram-agent.js'], { 
    stdio: 'inherit', 
    env: { ...process.env, PORT: 5001 } 
});

// 2. Iniciar dashboard.js (ZapChat Antigo) (porta 5030)
const botDashAntigo = spawn('node', ['dashboard.js'], { 
    stdio: 'inherit', 
    env: { ...process.env, PORT: 5030 } 
});

// 3. Iniciar o Worker Original do ZapChat (br/zapchat.js)
const botMinerZap = spawn('node', ['br/zapchat.js'], { 
    stdio: 'inherit', 
    env: { ...process.env } 
});

// 4. Iniciar o Server.js (Dashboard Premium + API) (porta 5000)
const botServerPremium = spawn('node', ['server.js'], { 
    stdio: 'inherit', 
    env: { ...process.env, PORT: 5000 } 
});

// 5. Servidor Proxy na porta principal (a que o Render expõe para internet)
const app = express();
const mainPort = process.env.PORT || 10000;

// Roteador para o Dashboard Antigo (/zapchat -> 5030)
app.use('/zapchat', createProxyMiddleware({
    target: 'http://localhost:5030',
    changeOrigin: true,
}));

// Roteador para o Dashboard Premium (/ -> 5000) com WebSocket
const proxyPremium = createProxyMiddleware({
    target: 'http://localhost:5000',
    changeOrigin: true,
    ws: true // Repassar WebSockets do Socket.io do server.js
});
app.use('/', proxyPremium);

const proxyServer = app.listen(mainPort, '0.0.0.0', () => {
    console.log(`🚀 [PROXY] Proxy Reverso Global rodando na porta externa: ${mainPort}`);
    console.log(`🔗 Premium Dashboard: http://localhost:${mainPort}/`);
    console.log(`🔗 ZapChat Antigo: http://localhost:${mainPort}/zapchat/`);
});

// Anexar WebSockets ao servidor Express
proxyServer.on('upgrade', proxyPremium.upgrade);

// Auto-kill bots caso o proxy feche
const cleanExit = () => {
    console.log("🛑 Encerrando todos os processos filhos...");
    botTelegram.kill();
    botDashAntigo.kill();
    botMinerZap.kill();
    botServerPremium.kill();
    process.exit();
};

process.on('SIGINT', cleanExit);
process.on('SIGTERM', cleanExit);
