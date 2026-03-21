require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { google } = require("googleapis");
const path = require("path");
const AICopywriter = require("./ai-copywriter");

const SHEET_ID = process.env.SHEET_ID_PORTUGAL;
const SHEET_NAME = "Leads-Premium";
const DELAY_MS = 3000;

(async () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, "..", "credentials.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const ai = new AICopywriter();

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:O`
    });

    const rows = res.data.values || [];
    console.log(`Total de leads na planilha: ${rows.length}`);

    const pendentes = rows
        .map((row, i) => ({ row, rowIndex: i + 2 }))
        .filter(({ row }) => {
            const status = row[0] || "";
            const email = row[4] || "";
            return status !== "Email Sent" && email && email.includes("@") && email !== "Não encontrado";
        });

    console.log(`Leads nao enviados com email valido: ${pendentes.length}`);
    console.log(`Iniciando limpeza e regeneracao com GPT-4o...\n`);

    let regenerados = 0;
    let erros = 0;

    for (const { row, rowIndex } of pendentes) {
        const nome = (row[1] || "").replace(/^'/, "");
        const nicho = row[2] || "";
        const cidade = row[8] || "";
        const avaliacao = row[9] || "0";
        const reviews = row[10] || "0";
        const website = row[6] || "";

        process.stdout.write(`[${rowIndex}] ${nome} (${nicho}, ${cidade})... `);

        try {
            // Limpar copy antigo
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!N${rowIndex}:O${rowIndex}`,
                valueInputOption: "RAW",
                requestBody: { values: [["", ""]] }
            });

            // Gerar novo copy com GPT-4o
            const aiData = await ai.generateCopy({ nome, nicho, cidade, avaliacao, reviews, website });

            // Salvar novo copy
            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!N${rowIndex}:O${rowIndex}`,
                valueInputOption: "RAW",
                requestBody: { values: [[aiData.assunto, aiData.copy]] }
            });

            console.log(`OK — "${aiData.assunto}"`);
            regenerados++;
        } catch (err) {
            console.log(`ERRO: ${err.message}`);
            erros++;
        }

        await new Promise(r => setTimeout(r, DELAY_MS));
    }

    console.log(`\nConcluido. ${regenerados} regenerados · ${erros} erros.`);
})().catch(err => {
    console.error("\n[ERRO FATAL]", err.message);
    process.exit(1);
});
