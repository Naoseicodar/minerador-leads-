require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { google } = require("googleapis");
const path = require("path");
const AICopywriter = require("./ai-copywriter");

const SHEET_ID = process.env.SHEET_ID_PORTUGAL;
const SHEET_NAME = "Leads-Premium";
const DELAY_MS = 2000; // 2s entre chamadas à OpenAI

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
    console.log(`Total de leads: ${rows.length}`);

    let enriquecidos = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowIndex = i + 2;
        const assunto = row[13] || "";
        const copy = row[14] || "";

        if (assunto && copy) {
            process.stdout.write(`[${rowIndex}] Já tem copy, pulando...\n`);
            continue;
        }

        const email = row[4] || "";
        if (!email || !email.includes("@")) {
            process.stdout.write(`[${rowIndex}] Sem email válido, pulando...\n`);
            continue;
        }

        const nome = (row[1] || "").replace(/^'/, "");
        const nicho = row[2] || "";
        const cidade = row[8] || "";
        const avaliacao = row[9] || "0";
        const reviews = row[10] || "0";
        const website = row[6] || "";

        process.stdout.write(`[${rowIndex}] Gerando copy para: ${nome}...`);

        try {
            const aiData = await ai.generateCopy({ nome, nicho, cidade, avaliacao, reviews, website });

            await sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: `${SHEET_NAME}!N${rowIndex}:O${rowIndex}`,
                valueInputOption: "RAW",
                requestBody: { values: [[aiData.assunto, aiData.copy]] }
            });

            enriquecidos++;
            console.log(` OK`);
        } catch (err) {
            console.log(` ERRO: ${err.message}`);
        }

        await new Promise(r => setTimeout(r, DELAY_MS));
    }

    console.log(`\nConcluído. ${enriquecidos} leads enriquecidos com copy da IA.`);
})();
