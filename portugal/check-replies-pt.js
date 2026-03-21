require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

const SHEET_ID = process.env.SHEET_ID_PORTUGAL;
const SHEET_NAME = "Leads-Premium";
const CREDENTIALS = path.join(__dirname, "..", "credentials.json");

function getAccounts() {
    const accounts = [];
    for (let i = 1; i <= 10; i++) {
        const email = process.env[`GMAIL_PT_${i}`];
        const pass = process.env[`GMAIL_PT_${i}_PASS`];
        if (email && pass) accounts.push({ email, pass });
    }
    return accounts;
}

async function getSheetsClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
}

async function getLeadsMap(sheets) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:E`
    });
    const rows = res.data.values || [];
    const map = new Map();
    rows.forEach((row, idx) => {
        const status = row[0] || "";
        const email = row[4] || "";
        const name = row[1] || "";
        // Somente se for um email válido e não estiver já setado como respondido/fechado
        if (email && email.includes("@")) {
            map.set(email.toLowerCase().trim(), {
                rowIndex: idx + 2,
                status,
                name
            });
        }
    });
    return map;
}

function extractEmailAddress(fromHeader) {
    if (!fromHeader) return null;
    const match = fromHeader.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase() : fromHeader.toLowerCase().trim();
}

async function checkAccount(acc, leadsMap, sheets) {
    console.log(`\n[IMAP] Conectando à conta: ${acc.email} ...`);
    
    const config = {
        imap: {
            user: acc.email,
            password: acc.pass,
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false },
            authTimeout: 15000
        }
    };

    let connection;
    try {
        connection = await imaps.connect(config);
    } catch (e) {
        console.error(`[IMAP Erro] Falha na conexão de ${acc.email}: ${e.message}`);
        return;
    }

    await connection.openBox('INBOX');

    // Buscar mensagens não lidas ou recebidas recentemente
    // Como a caixa pode lotar, buscamos apenas mensagens das últimas 72 horas que não são enviadas por nós mesmos
    const delay = 3 * 24 * 3600 * 1000;
    const since = new Date(Date.now() - delay).toISOString(); 
    
    // Critério: UNSEEN
    const searchCriteria = ['UNSEEN'];
    const fetchOptions = {
        bodies: ['HEADER', 'TEXT'],
        markSeen: false
    };

    console.log(`[IMAP] Buscando respostas não lidas...`);
    let results = [];
    try {
        results = await connection.search(searchCriteria, fetchOptions);
    } catch(e) {
        console.error(`[IMAP Erro] Falha na busca de ${acc.email}: ${e.message}`);
        connection.end();
        return;
    }

    if (!results || results.length === 0) {
        console.log(`[IMAP] Nenhuma resposta nova não-lida nesta conta.`);
        connection.end();
        return;
    }

    let foundReplies = 0;

    for (const item of results) {
        try {
            const headerPart = item.parts.find(p => p.which === 'HEADER');
            const parsed = await simpleParser(item.parts.find(p => p.which === 'TEXT').body);
            const fromField = parsed.from && parsed.from.text ? parsed.from.text : "";
            const senderEmail = extractEmailAddress(fromField);
            
            if (!senderEmail) continue;

            // Ignorar emails do próprio sistema
            if (senderEmail.includes("nox") || senderEmail.includes("gmail") && senderEmail === acc.email.toLowerCase()) {
                continue;
            }

            // Checar contra nosso CRM Sheets
            if (leadsMap.has(senderEmail)) {
                const leadData = leadsMap.get(senderEmail);
                
                // Mudar Status apenas se for diferente
                if (leadData.status !== "Email Respondido") {
                    console.log(`[★ MATCH!] Resposta de ${leadData.name} (${senderEmail})! Atualizando CRM...`);
                    
                    await sheets.spreadsheets.values.update({
                        spreadsheetId: SHEET_ID,
                        range: `${SHEET_NAME}!A${leadData.rowIndex}`,
                        valueInputOption: "RAW",
                        requestBody: { values: [["Email Respondido"]] }
                    });
                    
                    // Mark map as updated locally avoiding double-updates
                    leadData.status = "Email Respondido";
                    foundReplies++;
                }
            }

        } catch(e) {
            console.error(`[Erro Parse Email]`, e.message);
        }
    }

    console.log(`[IMAP] Finalizado ${acc.email}. Respostas detectadas que alteraram o CRM: ${foundReplies}`);
    connection.end();
}

async function run() {
    console.log("==================================================");
    console.log(" INICIANDO RASTREADOR DE RESPOSTAS (SDR A.I.) ");
    console.log("==================================================");
    
    const accounts = getAccounts();
    if (accounts.length === 0) {
        return console.warn("Nenhuma conta GMAIL_PT configurada no .env.");
    }

    let sheets;
    try {
        sheets = await getSheetsClient();
    } catch(e) {
        return console.error("Falha ao inicializar o Google Sheets API:", e.message);
    }

    console.log("[CRM] Carregando mapa de Leads do Google Sheets...");
    let leadsMap;
    try {
        leadsMap = await getLeadsMap(sheets);
        console.log(`[CRM] ${leadsMap.size} Leads com E-mail em memória.`);
    } catch(e) {
        return console.error("Falha ao ler Leads:", e.message);
    }

    for (const acc of accounts) {
        await checkAccount(acc, leadsMap, sheets);
    }

    console.log("\n==================================================");
    console.log(" RASTREAMENTO FINALIZADO COM SUCESSO ");
    console.log("==================================================");
}

run();
