require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const { google } = require("googleapis");
const path = require("path");

async function formatSheet() {
    console.log("Iniciando formatação premium da planilha...");
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

        const requests = [
            // 1. Congelar a primeira linha (Cabeçalho)
            {
                updateSheetProperties: {
                    properties: {
                        sheetId: sheetId,
                        gridProperties: { frozenRowCount: 1, frozenColumnCount: 2 } // Fixa Status e Nome
                    },
                    fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount'
                }
            },
            // 2. Formatar o Cabeçalho (Fundo Escuro, Texto Branco, Negrito, Centralizado)
            {
                repeatCell: {
                    range: { sheetId: sheetId, startRowIndex: 0, endRowIndex: 1 },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: { red: 0.117, green: 0.16, blue: 0.231 }, // #1e293b (Slate-800)
                            textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 11, fontFamily: "Montserrat" },
                            horizontalAlignment: "CENTER",
                            verticalAlignment: "MIDDLE"
                        }
                    },
                    fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)"
                }
            },
            // 3. Centralizar e alinhar dados base
            {
                repeatCell: {
                    range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 12 },
                    cell: {
                        userEnteredFormat: {
                            horizontalAlignment: "CENTER",
                            verticalAlignment: "MIDDLE",
                            textFormat: { fontFamily: "Roboto", fontSize: 10 }
                        }
                    },
                    fields: "userEnteredFormat(horizontalAlignment,verticalAlignment,textFormat)"
                }
            },
            // 4. Configurar as colunas N, O, P (Assunto, Copy, Diagnóstico) para Clipar (não estourar a celula)
            {
                repeatCell: {
                    range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: 13, endColumnIndex: 16 },
                    cell: {
                        userEnteredFormat: {
                            wrapStrategy: "CLIP",
                            verticalAlignment: "TOP",
                            textFormat: { fontFamily: "Roboto", fontSize: 10 }
                        }
                    },
                    fields: "userEnteredFormat(wrapStrategy,verticalAlignment,textFormat)"
                }
            },
            // 5. Aplicar o Padrão "Zebra" (Banding) - Verifica se falhar ele ignora
            {
                addBanding: {
                    bandedRange: {
                        range: { sheetId: sheetId, startRowIndex: 1, endRowIndex: 2000, startColumnIndex: 0, endColumnIndex: 16 },
                        rowProperties: {
                            firstBandColor: { red: 1, green: 1, blue: 1 },
                            secondBandColor: { red: 0.97, green: 0.98, blue: 0.99 } // #f8fafc Cinza ultra claro
                        }
                    }
                }
            },
            // 6. Adicionar Menu Suspenso (Dropdown) com Cores para a coluna STATUS
            {
                setDataValidation: {
                    range: { sheetId: sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
                    rule: {
                        condition: {
                            type: "ONE_OF_LIST",
                            values: [
                                { userEnteredValue: "Not Contacted" },
                                { userEnteredValue: "Email Sent" },
                                { userEnteredValue: "WhatsApp Enviado" },
                                { userEnteredValue: "Reunião Agendada" },
                                { userEnteredValue: "Venda Fechada" },
                                { userEnteredValue: "Sem Interesse" }
                            ]
                        },
                        showCustomUi: true,
                        strict: true
                    }
                }
            }
        ];

        try {
            await sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: { requests }
            });
            console.log("Planilha formatada com Sucesso!");
        } catch (e) {
            // Se já tiver zebra, o banding vai dar erro. Tentamos sem a zebra.
            if(e.message && e.message.includes("banding")) {
                requests.splice(4, 1); // remove o addBanding e tenta de novo
                await sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: { requests }
                });
                console.log("Planilha formatada (Zebra já existia).");
            } else {
                console.error("Erro Google Sheets:", e.message);
            }
        }
    } catch(err) {
        console.log("Erro geral:", err.message);
    }
}

formatSheet();
