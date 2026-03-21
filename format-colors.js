require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { google } = require("googleapis");
const path = require("path");

async function applyColors() {
    console.log("Iniciando aplicação de Cores Automatizadas (Formatação Condicional) na Planilha...");
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, "credentials.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheetsClient = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.SHEET_ID_PORTUGAL;
    const sheetName = "Leads-Premium";

    try {
        const info = await sheetsClient.spreadsheets.get({ spreadsheetId });
        const sheet = info.data.sheets.find(s => s.properties.title === sheetName);
        if (!sheet) return console.log("Aba não encontrada");
        const sheetId = sheet.properties.sheetId;

        // Limpar regras condicionais anteriores (opcional, evita sobreposição)
        const clearRequests = [{
            updateConditionalFormatRule: {
                sheetId: sheetId,
                index: 0,
                rule: { ranges: [{ sheetId, startRowIndex: 1 }] } // Invalidating logic to clear
            }
        }];

        function buildRowRule(keyword, bgR, bgG, bgB, txtR, txtG, txtB) {
            return {
                addConditionalFormatRule: {
                    rule: {
                        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 16 }],
                        booleanRule: {
                            condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=$A2="${keyword}"` }] },
                            format: { 
                                backgroundColor: { red: bgR, green: bgG, blue: bgB },
                                textFormat: txtR !== undefined ? { foregroundColor: { red: txtR, green: txtG, blue: txtB } } : {}
                            }
                        }
                    },
                    index: 0
                }
            };
        }

        const requests = [
            // Apagar regras se quiséssemos: mas a API permite empilhar ou apagar manualmente. Vamos apenas Adicionar.
            // 1. Not Contacted -> Cinza claro (Zebra nativa já serve, mas garantiremos um tom neutro se quiser)
            // 2. Email Sent -> Azul Suave
            buildRowRule("Email Sent", 0.93, 0.96, 1.0, 0.1, 0.2, 0.5), 
            // 3. WhatsApp Enviado -> Verde suave Zap
            buildRowRule("WhatsApp Enviado", 0.90, 0.98, 0.93, 0.05, 0.3, 0.1),
            // 4. Reunião Agendada -> Amarelo Ouro
            buildRowRule("Reunião Agendada", 1.0, 0.98, 0.8, 0.5, 0.3, 0.0),
            // 5. Email Respondido -> Verde forte
            buildRowRule("Email Respondido", 0.13, 0.77, 0.36, 1.0, 1.0, 1.0),
            // 6. Venda Fechada -> Verde Neon Escuro
            buildRowRule("Venda Fechada", 0.06, 0.46, 0.23, 1.0, 1.0, 1.0),
            // 7. Sem Interesse -> Vermelho Suave
            buildRowRule("Sem Interesse", 0.99, 0.89, 0.89, 0.6, 0.1, 0.1)
        ];

        await sheetsClient.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests }
        });
        console.log("✨ Cores injetadas com Sucesso! Seu CRM agora reage automaticamente aos Status.");
    } catch (e) {
        console.error("Erro Google Sheets:", e.message);
    }
}
applyColors();
