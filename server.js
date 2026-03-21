require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const MinerEngine = require("./portugal/miner-engine-pt");
const EmailSender = require("./portugal/email-sender-pt");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// State for the miner
let engineInstance = null;

// State for the email sender
let emailSender = null;

// Send live logs to the frontend via WebSockets
const emitLog = (msg, type = "info") => {
    io.emit("log", { time: new Date().toLocaleTimeString("pt-BR"), message: msg, type });
};
const emitStats = (stats) => {
    io.emit("stats", stats);
};
const emitStatus = (statusInfo) => {
    io.emit("status", statusInfo);
};

// API Endpoints for Control
app.post("/api/start", async (req, res) => {
    if (engineInstance && engineInstance.isRunning) {
        return res.status(400).json({ error: "O minerador já está rodando." });
    }
    const config = req.body;
    
    // Pass emit hooks to the engine
    engineInstance = new MinerEngine({
        ...config,
        onLog: emitLog,
        onStats: emitStats,
        onStatus: emitStatus
    });

    emitLog("Iniciando nova carga de mineração...", "info");
    
    // Start asynchronously so the API responds immediately
    engineInstance.start().catch((err) => {
        emitLog(`Erro fatal: ${err.message}`, "error");
        emitStatus({ isRunning: false, isPaused: false });
    });

    res.json({ success: true, message: "Minerador iniciado!" });
});

app.post("/api/pause", (req, res) => {
    if (engineInstance) {
        engineInstance.pause();
        return res.json({ success: true, message: "Minerador pausado." });
    }
    res.status(400).json({ error: "Nenhum minerador ativo." });
});

app.post("/api/resume", (req, res) => {
    if (engineInstance) {
        engineInstance.resume();
        return res.json({ success: true, message: "Voltando à mineração." });
    }
    res.status(400).json({ error: "Nenhum minerador ativo." });
});

app.post("/api/stop", (req, res) => {
    if (engineInstance) {
        engineInstance.stop();
        engineInstance = null;
        return res.json({ success: true, message: "Minerador interrompido." });
    }
    res.status(400).json({ error: "Nenhum minerador ativo." });
});

app.get("/api/currentStatus", (req, res) => {
    if (engineInstance) {
        res.json({
            isRunning: engineInstance.isRunning,
            isPaused: engineInstance.isPaused,
            stats: engineInstance.getStats()
        });
    } else {
        res.json({ isRunning: false, isPaused: false, stats: null });
    }
});

// Email Marketing Routes
app.post("/api/email/start", async (req, res) => {
    if (emailSender && emailSender.isRunning) {
        return res.status(400).json({ error: "Envio já em andamento." });
    }
    const { subject, body } = req.body || {};
    emailSender = new EmailSender({ onLog: emitLog, io });
    emailSender.start({ subject: subject || null, body: body || null }).catch(err => {
        emitLog(`Erro fatal no email sender: ${err.message}`, "error");
    });
    res.json({ success: true, message: "Campanha de email iniciada." });
});

app.post("/api/email/pause", (req, res) => {
    if (!emailSender || !emailSender.isRunning) {
        return res.status(400).json({ error: "Nenhum envio ativo." });
    }
    if (emailSender.isPaused) {
        emailSender.resume();
        return res.json({ success: true, message: "Envio retomado." });
    }
    emailSender.pause();
    res.json({ success: true, message: "Envio pausado." });
});

app.post("/api/email/stop", (req, res) => {
    if (emailSender) {
        emailSender.stop();
        emailSender = null;
    }
    res.json({ success: true, message: "Envio interrompido." });
});

app.get("/api/email/status", (req, res) => {
    const fs = require("fs");
    const path2 = require("path");
    const today = new Date().toISOString().slice(0, 10);

    // Soma contadores de todas as contas configuradas
    let totalSent = 0;
    let totalLimit = 0;
    const accounts = [];
    for (let i = 1; i <= 10; i++) {
        const email = process.env[`GMAIL_PT_${i}`];
        const pass = process.env[`GMAIL_PT_${i}_PASS`];
        if (!email || !pass) continue;
        const safe = email.replace(/[@.]/g, "_");
        const countFile = path2.join(__dirname, "portugal", `email-count-${safe}-${today}.json`);
        let count = 0;
        try { if (fs.existsSync(countFile)) count = JSON.parse(fs.readFileSync(countFile)).count || 0; } catch (e) {}
        totalSent += count;
        totalLimit += 40;
        accounts.push({ email, sent: count, limit: 40 });
    }

    res.json({
        isRunning: emailSender ? emailSender.isRunning : false,
        isPaused: emailSender ? emailSender.isPaused : false,
        dailyCount: totalSent,
        dailyLimit: totalLimit,
        accounts
    });
});

// New Endpoint to get leads from Google Sheets directly
app.get("/api/leads", async (req, res) => {
    try {
        const { google } = require("googleapis");
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, "credentials.json"),
            scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });
        const sheetsClient = google.sheets({ version: "v4", auth });
        
        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId: process.env.SHEET_ID_PORTUGAL,
            range: "Leads-Premium!A2:P"
        });

        const rows = response.data.values || [];
        const leads = rows.reverse().map(row => ({
            status: row[0] || "Not Contacted",
            nome: (row[1] || "").replace(/^'/, ''),
            nicho: row[2] || "",
            telefone: (row[3] || "").replace(/^'/, ''),
            email: row[4] || "",
            social: row[5] || "",
            website: row[6] || "",
            area: row[7] || "",
            cidade: row[8] || "",
            avaliacao: row[9] || "",
            reviews: row[10] || "",
            mapsLink: row[11] || "",
            wppLink: row[12] || "",
            assunto: row[13] || "",
            copy: row[14] || "",
            diagnostico: row[15] || ""
        }));

        res.json({ success: true, leads });
    } catch (err) {
        console.error("Erro lendo leads:", err);
        res.status(500).json({ error: "Falha ao carregar leads do Database (Sheets)." });
    }
});

const PORT = 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`[ SERVER ] Miner Dashboard Premium running on port ${PORT}`);
});
