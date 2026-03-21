require("dotenv").config();
const { google } = require("googleapis");
const path = require("path");

async function initGoogleSheets() {
    const credentialsPath = path.join(__dirname, "credentials.json");
    const sheetId = process.env.SHEET_ID_PORTUGAL;
    const sheetName = "Leads-Premium";
    
    console.log("Auth:", credentialsPath);
    console.log("SheetID:", sheetId);

    const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheetsClient = google.sheets({ version: "v4", auth });

    try {
        const info = await sheetsClient.spreadsheets.get({ spreadsheetId: sheetId });
        const abaExistente = info.data.sheets.find(s => s.properties.title === sheetName);
        if (!abaExistente) {
            console.log("Creating sheet...");
            await sheetsClient.spreadsheets.batchUpdate({
                spreadsheetId: sheetId,
                requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
            });
            console.log("Created. Updating header...");
            
            await sheetsClient.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: `${sheetName}!A1`,
                valueInputOption: "RAW",
                requestBody: { values: [["Status", "Nome", "Nicho", "Telefone", "Email", "Facebook/Instagram", "Website", "Area", "Cidade", "Avaliação", "Reviews", "Map Link", "Link WhatsApp"]] },
            });
            console.log("Header written.");
        } else {
            console.log("Sheet already exists.");
        }
    } catch (err) {
        console.error("Erro ao conectar Sheets:", err);
    }
}
initGoogleSheets();
