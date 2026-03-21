require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const { buildHtmlEmail, LOGO_PATH } = require("./email-template");

function getAccounts() {
    const accounts = [];
    for (let i = 1; i <= 10; i++) {
        const email = process.env[`GMAIL_PT_${i}`];
        const pass = process.env[`GMAIL_PT_${i}_PASS`];
        if (email && pass) accounts.push({ email, pass });
    }
    return accounts;
}

class EmailSender {
    constructor({ onLog, io } = {}) {
        this.onLog = onLog || (() => {});
        this.io = io || null;
        this.isRunning = false;
        this.isPaused = false;
        this.sheetId = process.env.SHEET_ID_PORTUGAL;
        this.sheetName = "Leads-Premium";
        this.credentialsPath = path.join(__dirname, "..", "credentials.json");
        this.dailyLimit = 40;
        this.sheetsClient = null;
        this.accounts = getAccounts();
        this.transporters = [];
        this.currentAccountIndex = 0;
    }

    getCountFile(email) {
        const today = new Date().toISOString().slice(0, 10);
        const safe = email.replace(/[@.]/g, "_");
        return path.join(__dirname, `email-count-${safe}-${today}.json`);
    }

    getDailyCount(email) {
        try {
            const f = this.getCountFile(email);
            if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)).count || 0;
        } catch (e) {}
        return 0;
    }

    incrementDailyCount(email) {
        const f = this.getCountFile(email);
        const count = this.getDailyCount(email) + 1;
        fs.writeFileSync(f, JSON.stringify({ count }));
        return count;
    }

    log(msg, type = "info") {
        this.onLog(msg, type);
        if (this.io) this.io.emit("email-log", { time: new Date().toLocaleTimeString("pt-BR"), message: msg, type });
    }

    async initSheets() {
        const auth = new google.auth.GoogleAuth({
            keyFile: this.credentialsPath,
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        this.sheetsClient = google.sheets({ version: "v4", auth });
    }

    async initTransporters() {
        if (this.accounts.length === 0) {
            throw new Error("Nenhuma conta de email configurada no .env (GMAIL_PT_1, GMAIL_PT_2...)");
        }
        this.transporters = [];
        for (const acc of this.accounts) {
            const t = nodemailer.createTransport({
                service: "gmail",
                auth: { user: acc.email, pass: acc.pass }
            });
            try {
                await t.verify();
                this.transporters.push({ transporter: t, email: acc.email });
                this.log(`[✓ Auth] ${acc.email}`, "success");
            } catch (err) {
                this.log(`[✗ Auth falhou] ${acc.email}: ${err.message}`, "error");
            }
        }
        if (this.transporters.length === 0) {
            throw new Error("Nenhuma conta autenticou com sucesso.");
        }
    }

    getNextTransporter() {
        const start = this.currentAccountIndex;
        for (let i = 0; i < this.transporters.length; i++) {
            const idx = (start + i) % this.transporters.length;
            const acc = this.transporters[idx];
            if (this.getDailyCount(acc.email) < this.dailyLimit) {
                this.currentAccountIndex = (idx + 1) % this.transporters.length;
                return acc;
            }
        }
        return null;
    }

    getTotalDailyCount() {
        return this.transporters.reduce((sum, acc) => sum + this.getDailyCount(acc.email), 0);
    }

    getTotalDailyLimit() {
        return this.transporters.length * this.dailyLimit;
    }

    async getLeadsWithEmail() {
        const res = await this.sheetsClient.spreadsheets.values.get({
            spreadsheetId: this.sheetId,
            range: `${this.sheetName}!A2:O`
        });
        const rows = res.data.values || [];
        return rows.map((row, idx) => ({
            rowIndex: idx + 2,
            status: row[0] || "",
            nome: (row[1] || "").replace(/^'/, ""),
            email: row[4] || "",
            assunto: row[13] || "",
            copy: row[14] || ""
        })).filter(l =>
            l.email &&
            l.email !== "Não encontrado" &&
            l.email.includes("@") &&
            l.status !== "Email Sent"
        );
    }

    async markSent(rowIndex) {
        await this.sheetsClient.spreadsheets.values.update({
            spreadsheetId: this.sheetId,
            range: `${this.sheetName}!A${rowIndex}`,
            valueInputOption: "RAW",
            requestBody: { values: [["Email Sent"]] }
        });
    }

    async start({ subject: overrideSubject, body: overrideBody } = {}) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.isPaused = false;

        try {
            await this.initSheets();
            await this.initTransporters();
        } catch (err) {
            this.log(`Erro ao inicializar: ${err.message}`, "error");
            this.isRunning = false;
            return;
        }

        this.log(`${this.transporters.length} conta(s) ativas · Limite: ${this.getTotalDailyLimit()} emails/dia`, "system");

        let leads;
        try {
            leads = await this.getLeadsWithEmail();
        } catch (err) {
            this.log(`Erro ao carregar leads: ${err.message}`, "error");
            this.isRunning = false;
            return;
        }

        this.log(`${leads.length} leads com email válido prontos para envio.`, "system");

        const logoExists = fs.existsSync(LOGO_PATH);
        if (!logoExists) {
            this.log(`[AVISO] Logo não encontrada em ${LOGO_PATH} — emails sem logo.`, "warning");
        }

        let sent = 0;
        for (const lead of leads) {
            if (!this.isRunning) break;

            while (this.isPaused) {
                await new Promise(r => setTimeout(r, 1000));
                if (!this.isRunning) break;
            }
            if (!this.isRunning) break;

            const acc = this.getNextTransporter();
            if (!acc) {
                this.log(`Limite diário atingido em todas as contas (${this.getTotalDailyLimit()} emails).`, "warning");
                break;
            }

            const subject = overrideSubject || lead.assunto || `pergunta sobre ${lead.nome}`;
            const bodyText = overrideBody || lead.copy || `Olá, gostaríamos de conversar sobre a presença online de ${lead.nome}.`;

            const mailOptions = {
                from: `"Luan Andrade | Nox Tech" <${acc.email}>`,
                to: lead.email,
                subject,
                text: bodyText, // fallback plain text
                html: buildHtmlEmail(bodyText),
                attachments: logoExists ? [{
                    filename: "logo-noxtech.png",
                    path: LOGO_PATH,
                    cid: "logo-noxtech"
                }] : []
            };

            try {
                await acc.transporter.sendMail(mailOptions);
                await this.markSent(lead.rowIndex);
                this.incrementDailyCount(acc.email);
                sent++;
                const count = this.getDailyCount(acc.email);
                this.log(`[✓ Enviado] ${lead.nome} <${lead.email}> via ${acc.email} (${count}/${this.dailyLimit} hoje)`, "success");
            } catch (err) {
                this.log(`[✗ Falha] ${lead.nome}: ${err.message}`, "error");
            }

            const delay = 45000 + Math.random() * 75000;
            this.log(`Aguardando ${Math.round(delay / 1000)}s...`, "info");
            await new Promise(r => setTimeout(r, delay));
        }

        this.log(`Campanha finalizada. ${sent} emails enviados nesta sessão.`, "system");
        this.isRunning = false;
    }

    pause() {
        this.isPaused = true;
        this.log("Envio pausado.", "warning");
    }

    resume() {
        this.isPaused = false;
        this.log("Envio retomado.", "success");
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;
        this.log("Envio interrompido.", "error");
    }
}

module.exports = EmailSender;
