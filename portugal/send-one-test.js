require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const AICopywriter = require("./ai-copywriter");
const { buildHtmlEmail, LOGO_PATH } = require("./email-template");

const SHEET_ID = process.env.SHEET_ID_PORTUGAL;
const SHEET_NAME = "Leads-Premium";

(async () => {
    // 1. Conectar ao Sheets
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, "..", "credentials.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:O`
    });

    const rows = res.data.values || [];

    // 2. Pegar primeiro lead nao enviado com email valido
    let lead = null;
    let rowIndex = null;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const status = row[0] || "";
        const email = row[4] || "";

        if (status === "Email Sent") continue;
        if (!email || !email.includes("@") || email === "Não encontrado") continue;

        lead = {
            nome: (row[1] || "").replace(/^'/, ""),
            nicho: row[2] || "",
            cidade: row[8] || "",
            avaliacao: row[9] || "0",
            reviews: row[10] || "0",
            website: row[6] || "",
            email,
            assunto: row[13] || "",
            copy: row[14] || ""
        };
        rowIndex = i + 2;
        break;
    }

    if (!lead) {
        console.log("Nenhum lead disponivel para envio.");
        process.exit(0);
    }

    console.log(`\nLead selecionado:`);
    console.log(`  Nome:    ${lead.nome}`);
    console.log(`  Email:   ${lead.email}`);
    console.log(`  Nicho:   ${lead.nicho}`);
    console.log(`  Cidade:  ${lead.cidade}`);
    console.log(`  Google:  ${lead.avaliacao}★ · ${lead.reviews} avaliações`);
    console.log(`  Site:    ${lead.website || "Não têm"}\n`);

    // 3. Gerar copy com IA (ou usar existente na planilha)
    let assunto = lead.assunto;
    let copy = lead.copy;

    if (!assunto || !copy) {
        console.log("Gerando copy com GPT-4o...");
        const ai = new AICopywriter();
        const aiData = await ai.generateCopy(lead);
        assunto = aiData.assunto;
        copy = aiData.copy;
    } else {
        console.log("Usando copy existente da planilha.");
    }

    console.log(`\n--- ASSUNTO ---`);
    console.log(assunto);
    console.log(`\n--- CORPO ---`);
    console.log(copy);
    console.log(`\n---------------\n`);

    // 4. Configurar conta de envio
    const senderEmail = process.env.GMAIL_PT_1 || process.env.GMAIL_1;
    const senderPass = process.env.GMAIL_PT_1_PASS || process.env.GMAIL_1_PASS;

    if (!senderEmail || !senderPass) {
        console.error("Conta de envio nao configurada no .env (GMAIL_PT_1 + GMAIL_PT_1_PASS)");
        process.exit(1);
    }

    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: senderEmail, pass: senderPass }
    });

    await transporter.verify();
    console.log(`Conta autenticada: ${senderEmail}`);

    // 5. Enviar
    const logoExists = fs.existsSync(LOGO_PATH);

    await transporter.sendMail({
        from: `"Luan Andrade | Nox Tech" <${senderEmail}>`,
        to: lead.email,
        subject: assunto,
        text: copy,
        html: buildHtmlEmail(copy),
        attachments: logoExists ? [{
            filename: "logo-noxtech.png",
            path: LOGO_PATH,
            cid: "logo-noxtech"
        }] : []
    });

    // 6. Marcar como enviado na planilha
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [["Email Sent"]] }
    });

    // Salvar copy na planilha se foi gerado agora
    if (!lead.assunto || !lead.copy) {
        await sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: `${SHEET_NAME}!N${rowIndex}:O${rowIndex}`,
            valueInputOption: "RAW",
            requestBody: { values: [[assunto, copy]] }
        });
    }

    console.log(`\n[OK] Email enviado para ${lead.nome} <${lead.email}>`);
    console.log(`[OK] Marcado como "Email Sent" na planilha (linha ${rowIndex})`);
})().catch(err => {
    console.error("\n[ERRO]", err.message);
    process.exit(1);
});
