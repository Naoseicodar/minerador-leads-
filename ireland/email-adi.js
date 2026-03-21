require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

// ── CONFIG ──────────────────────────────────────────────────
const SHEET_ID    = process.env.SHEET_ID_IRELAND || "";
const SHEET_TAB   = "Leads-ADI";
const DAILY_LIMIT = Number(process.env.ADI_EMAIL_LIMIT) || 50;
const CREDS_PATH  = path.join(__dirname, "..", "credentials.json");

const SENDER_NAME  = "Luan Andrade | Nox Tech";
const SENDER_PHONE = "+1 (612) 633-3722";
const SENDER_EMAIL = "luannoxtech@gmail.com";
const SENDER_SITE  = "noxtech.io";

function getAccounts() {
    const accounts = [];
    for (let i = 1; i <= 10; i++) {
        const email = process.env[`GMAIL_PT_${i}`];
        const pass  = process.env[`GMAIL_PT_${i}_PASS`];
        if (email && pass) accounts.push({ email, pass });
    }
    return accounts;
}

// ── SUBJECTS ────────────────────────────────────────────────
const SUBJECTS = [
    (nome)   => `quick question, ${nome}`,
    (nome)   => `noticed something about your lessons`,
    (nome, county) => `driving lessons in ${county}`,
    (nome)   => `tried to find you online`,
    (nome)   => `${nome} on Google`,
];

function getSubject(nome, county) {
    const fn = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
    return fn(nome, county);
}

// ── BODY TEMPLATES ──────────────────────────────────────────
const BODIES = [
    // Variação 1 — dor de invisibilidade + resultado concreto
    (nome, county) => `Hi ${nome},

I searched for driving instructors in ${county} and your name didn't come up — only the bigger schools showed.

Most learner drivers (and their parents) go straight to Google before calling anyone. If you're not there, those enquiries go to whoever is.

We build professional websites for ADIs across Ireland — full Google Business setup included, delivered in 48 hours, one flat fee, no monthly charges. An instructor in Dublin we worked with went from relying on word-of-mouth to getting weekly online enquiries within the first month.

Would that be useful for you?

—

${SENDER_NAME}
📱 ${SENDER_PHONE} (WhatsApp)
📧 ${SENDER_EMAIL}
🌐 ${SENDER_SITE}

P.S. No interest? Just reply "unsubscribe" and I won't contact you again.`,

    // Variação 2 — RSA listing não é suficiente
    (nome, county) => `Hi ${nome},

Being on the RSA directory is a start — but most learner drivers don't begin their search there. They open Google, type "driving lessons ${county}", and call whoever comes up first.

If you don't have a website and Google Business profile, you're invisible to that search.

We've helped driving instructors across Ireland fix exactly this, with a professional site delivered in 48 hours and no ongoing fees. One ADI in Galway doubled her weekly enquiries within six weeks.

Happy to send you a few examples. Would it be worth a quick chat?

—

${SENDER_NAME}
📱 ${SENDER_PHONE} (WhatsApp)
📧 ${SENDER_EMAIL}
🌐 ${SENDER_SITE}

P.S. Reply "unsubscribe" anytime and I'll remove you straight away.`,

    // Variação 3 — autoridade direta sem rodeios
    (nome, county) => `Hi ${nome},

Most ADIs in ${county} are losing potential students to instructors who are easier to find online.

When someone in your area searches for driving lessons on Google right now, your name isn't coming up. That's students going to someone else — not because they're better, just because they're visible.

A professional website + Google Business profile changes that. We set it up in 48 hours, one-off payment, nothing monthly.

Worth a quick conversation?

—

${SENDER_NAME}
📱 ${SENDER_PHONE} (WhatsApp)
📧 ${SENDER_EMAIL}
🌐 ${SENDER_SITE}

P.S. Not interested? Reply "unsubscribe" and you'll never hear from me again.`,
];

function getBody(nome, county) {
    const fn = BODIES[Math.floor(Math.random() * BODIES.length)];
    return fn(nome, county);
}

// ── DAILY COUNTER ───────────────────────────────────────────
function getCountFile(email) {
    const today = new Date().toISOString().slice(0, 10);
    const safe  = email.replace(/[@.]/g, "_");
    return path.join(__dirname, `email-count-adi-${safe}-${today}.json`);
}

function getDailyCount(email) {
    try {
        const f = getCountFile(email);
        if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)).count || 0;
    } catch (_) {}
    return 0;
}

function incrementCount(email) {
    const f = getCountFile(email);
    const count = getDailyCount(email) + 1;
    fs.writeFileSync(f, JSON.stringify({ count }));
    return count;
}

// ── SHEETS ──────────────────────────────────────────────────
async function initSheets() {
    let auth;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        const raw = process.env.GOOGLE_CREDENTIALS_JSON;
        const json = raw.trimStart().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
        auth = new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    } else {
        auth = new google.auth.GoogleAuth({ keyFile: CREDS_PATH, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
    }
    return google.sheets({ version: "v4", auth });
}

// CABECALHO Leads-ADI: A=Status B=Nome C=Nicho D=Tel E=Email F=FB G=Website H=Rua I=Area J=Cidade K=County ...
async function getLeads(sheets) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A2:P`,
    });
    const rows = res.data.values || [];
    return rows.map((row, idx) => ({
        rowIndex: idx + 2,
        status:   row[0]  || "",
        nome:     (row[1] || "").replace(/^'/, ""),
        email:    row[4]  || "",
        county:   row[10] || row[9] || "Ireland",
    })).filter(l =>
        l.email &&
        l.email !== "Não encontrado" &&
        l.email !== "Not Found" &&
        l.email.includes("@") &&
        l.status !== "Email Sent" &&
        l.status !== "Not Interested" &&
        l.status !== "Converted ✓"
    );
}

async function markSent(sheets, rowIndex) {
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_TAB}!A${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [["Email Sent"]] },
    });
}

// ── MAIN ────────────────────────────────────────────────────
async function main() {
    console.log("\n  ╔══════════════════════════════════════╗");
    console.log("  ║     ADI EMAIL SENDER                 ║");
    console.log("  ║     Approved Driving Instructors     ║");
    console.log("  ║     Nox Tech — luannoxtech@gmail.com ║");
    console.log("  ╚══════════════════════════════════════╝\n");

    const accounts = getAccounts();
    if (!accounts.length) {
        console.error("  ✗ No email accounts configured. Set GMAIL_PT_1 / GMAIL_PT_1_PASS in .env");
        process.exit(1);
    }
    if (!SHEET_ID) {
        console.error("  ✗ SHEET_ID_IRELAND not set in .env");
        process.exit(1);
    }

    const transporters = [];
    for (const acc of accounts) {
        const t = nodemailer.createTransport({
            service: "gmail",
            auth: { user: acc.email, pass: acc.pass },
        });
        try {
            await t.verify();
            console.log(`  ✓ Auth OK: ${acc.email} (${getDailyCount(acc.email)}/${DAILY_LIMIT} today)`);
            transporters.push({ transporter: t, email: acc.email });
        } catch (err) {
            console.log(`  ✗ Auth failed: ${acc.email} — ${err.message}`);
        }
    }

    if (!transporters.length) {
        console.error("  ✗ No accounts authenticated. Check GMAIL_PT_1_PASS in .env");
        process.exit(1);
    }

    const sheets = await initSheets();
    let leads;
    try {
        leads = await getLeads(sheets);
    } catch (err) {
        console.error(`  ✗ Failed to load leads: ${err.message}`);
        process.exit(1);
    }

    console.log(`\n  ${leads.length} ADI leads with email ready.`);
    console.log(`  Limit: ${DAILY_LIMIT} emails/day per account`);
    console.log(`  Total capacity: ${transporters.length * DAILY_LIMIT} emails today\n`);

    let sent = 0;
    let skipped = 0;
    let accIdx = 0;

    for (const lead of leads) {
        const start = accIdx;
        let acc = null;
        for (let i = 0; i < transporters.length; i++) {
            const candidate = transporters[(start + i) % transporters.length];
            if (getDailyCount(candidate.email) < DAILY_LIMIT) {
                acc = candidate;
                accIdx = (transporters.indexOf(candidate) + 1) % transporters.length;
                break;
            }
        }
        if (!acc) {
            console.log(`\n  ⚠ Daily limit reached for all accounts.`);
            break;
        }

        const subject = getSubject(lead.nome, lead.county);
        const body    = getBody(lead.nome, lead.county);

        try {
            await acc.transporter.sendMail({
                from:    `"${SENDER_NAME}" <${acc.email}>`,
                to:      lead.email,
                subject,
                text:    body,
            });
            await markSent(sheets, lead.rowIndex);
            const count = incrementCount(acc.email);
            sent++;
            console.log(`  ✓ [${count}/${DAILY_LIMIT}] ${lead.nome} <${lead.email}>`);
        } catch (err) {
            skipped++;
            console.log(`  ✗ Failed: ${lead.nome} <${lead.email}> — ${err.message}`);
        }

        const delay = 45000 + Math.random() * 75000;
        console.log(`  → ${Math.round(delay / 1000)}s delay...`);
        await new Promise(r => setTimeout(r, delay));
    }

    console.log(`\n  ══════════════════════════════════════`);
    console.log(`  ✓ Done — ${sent} sent, ${skipped} failed`);
    console.log(`  ══════════════════════════════════════\n`);
}

main().catch(err => {
    console.error("\n  FATAL:", err.message);
    process.exit(1);
});
