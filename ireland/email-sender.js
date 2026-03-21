require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");

// ── CONFIG ──────────────────────────────────────────────────
const SHEET_ID    = process.env.SHEET_ID_IRELAND || "";
const SHEET_NAME  = process.env.SHEET_ABA_IRELAND || "Leads-Ireland";
const DAILY_LIMIT = Number(process.env.IRELAND_EMAIL_LIMIT) || 40;
const CREDS_PATH  = path.join(__dirname, "..", "credentials.json");

const SENDER_NAME  = "Luan Andrade | Nox Tech";
const SENDER_PHONE = "+1 (612) 633-3722";
const SENDER_EMAIL = "luannoxtech@gmail.com";
const SENDER_SITE  = "noxtech.io";

// Gmail accounts: GMAIL_IE_1, GMAIL_IE_1_PASS, GMAIL_IE_2, GMAIL_IE_2_PASS ...
// Fallback to Portugal accounts if Ireland-specific ones not set
function getAccounts() {
    const accounts = [];
    for (let i = 1; i <= 10; i++) {
        const email = process.env[`GMAIL_IE_${i}`] || process.env[`GMAIL_PT_${i}`];
        const pass  = process.env[`GMAIL_IE_${i}_PASS`] || process.env[`GMAIL_PT_${i}_PASS`];
        if (email && pass) accounts.push({ email, pass });
    }
    return accounts;
}

// ── COPY ────────────────────────────────────────────────────
// Nicho → trade label amigável (para personalizar o subject)
const TRADE_LABELS = {
    plumber:               "plumbing",
    "plumbing service":    "plumbing",
    "heating engineer":    "heating",
    "boiler repair":       "heating",
    electrician:           "electrical",
    "electrical contractor":"electrical",
    "electrical services": "electrical",
    builder:               "building",
    "construction company":"construction",
    "general contractor":  "construction",
    roofer:                "roofing",
    "roofing contractor":  "roofing",
    carpenter:             "carpentry",
    joinery:               "joinery",
    "painter decorator":   "painting",
    plasterer:             "plastering",
    tiler:                 "tiling",
    "driveway contractor": "driveways",
};

function getTradeLabel(nicho) {
    return TRADE_LABELS[(nicho || "").toLowerCase()] || nicho || "trade";
}

// ── SUBJECTS ────────────────────────────────────────────────
// Rotação de assuntos — evita padrão repetitivo
const SUBJECTS = [
    (nome) => `quick question, ${nome}`,
    (nome) => `noticed something about ${nome}`,
    (nome) => `${nome} on Google`,
    (nome) => `idea for your ${"{trade}"}`,       // placeholder substituído abaixo
    (nome) => `tried to find you online`,
];

function getSubject(nome, nicho) {
    const trade = getTradeLabel(nicho);
    const roll  = SUBJECTS[Math.floor(Math.random() * SUBJECTS.length)];
    return roll(nome).replace("{trade}", trade);
}

// ── BODY TEMPLATES ──────────────────────────────────────────
// 3 variações de corpo — rotação automática para evitar detecção de padrão
const BODIES = [
    // Variação 1 — dor direta + prova social de outro cliente
    (nome, nicho, cidade) => {
        const trade = getTradeLabel(nicho);
        return `Hi ${nome},

I was searching for ${trade} services in ${cidade} and couldn't find your business online — only your competitors showed up.

Every day without a website, those searches are going straight to someone else. You already have a solid reputation — but new customers who don't know you yet can't find you.

We build professional websites for tradespeople in Ireland with full Google setup, delivered in 48 hours. One of our clients — a heating engineer in Dublin — started getting inbound calls within the first week.

Would that be useful for your business? Happy to send over a few examples if you're curious.

—

${SENDER_NAME}
📱 ${SENDER_PHONE} (WhatsApp)
📧 ${SENDER_EMAIL}
🌐 ${SENDER_SITE}

P.S. If you'd prefer not to receive emails like this, just reply "unsubscribe" and I'll remove you immediately.`;
    },

    // Variação 2 — foco no Google / SEO local
    (nome, nicho, cidade) => {
        const trade = getTradeLabel(nicho);
        return `Hi ${nome},

When someone in ${cidade} searches for "${trade} near me" right now, your business isn't showing up — but your competitors are.

A professional website with local SEO changes that. We've helped over 30 tradespeople across Ireland get found on Google, with sites delivered in 48 hours and no monthly fees.

One electrician we worked with went from invisible to getting calls from Google within two weeks.

Worth a quick conversation? I can show you a few examples from the same trade.

—

${SENDER_NAME}
📱 ${SENDER_PHONE} (WhatsApp)
📧 ${SENDER_EMAIL}
🌐 ${SENDER_SITE}

P.S. Reply "unsubscribe" anytime and I'll take you off the list.`;
    },

    // Variação 3 — autoridade + escassez (sem urgência falsa)
    (nome, nicho, cidade) => {
        const trade = getTradeLabel(nicho);
        return `Hi ${nome},

I help ${trade} businesses in Ireland get a professional website and rank on Google — everything done in 48 hours for a flat fee, no monthly costs.

I looked your business up and noticed you don't have a website yet. In ${cidade}, most of your competitors do — which means customers searching online aren't reaching you.

We've built sites for plumbers, electricians, builders and other tradespeople across Dublin, Cork and Galway. Happy to send you some examples.

Would this be relevant for ${nome}?

—

${SENDER_NAME}
📱 ${SENDER_PHONE} (WhatsApp)
📧 ${SENDER_EMAIL}
🌐 ${SENDER_SITE}

P.S. No interest? Just reply "unsubscribe" and you won't hear from us again.`;
    },
];

function getBody(nome, nicho, cidade) {
    const fn = BODIES[Math.floor(Math.random() * BODIES.length)];
    return fn(nome, nicho, cidade);
}

// ── DAILY COUNTER ───────────────────────────────────────────
function getCountFile(email) {
    const today = new Date().toISOString().slice(0, 10);
    const safe  = email.replace(/[@.]/g, "_");
    return path.join(__dirname, `email-count-ireland-${safe}-${today}.json`);
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
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDS_PATH,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return google.sheets({ version: "v4", auth });
}

// Estrutura v5: A=Status B=Nome C=Nicho D=Tel E=Email ... J=Cidade ... P=Obs
async function getLeads(sheets) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A2:P`,
    });
    const rows = res.data.values || [];
    return rows.map((row, idx) => ({
        rowIndex: idx + 2,
        status:   row[0]  || "",
        nome:     (row[1] || "").replace(/^'/, ""),
        nicho:    row[2]  || "",
        email:    row[4]  || "",
        cidade:   row[9]  || "",
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
        range: `${SHEET_NAME}!A${rowIndex}`,
        valueInputOption: "RAW",
        requestBody: { values: [["Email Sent"]] },
    });
}

// ── MAIN ────────────────────────────────────────────────────
async function main() {
    console.log("\n  ╔══════════════════════════════════════╗");
    console.log("  ║     IRELAND EMAIL SENDER             ║");
    console.log("  ║     Nox Tech — luannoxtech@gmail.com ║");
    console.log("  ╚══════════════════════════════════════╝\n");

    const accounts = getAccounts();
    if (!accounts.length) {
        console.error("  ✗ No email accounts configured. Set GMAIL_IE_1 / GMAIL_IE_1_PASS in .env");
        process.exit(1);
    }
    if (!SHEET_ID) {
        console.error("  ✗ SHEET_ID_IRELAND not set in .env");
        process.exit(1);
    }

    // Authenticate transporters
    const transporters = [];
    for (const acc of accounts) {
        const t = nodemailer.createTransport({
            service: "gmail",
            auth: { user: acc.email, pass: acc.pass },
        });
        try {
            await t.verify();
            console.log(`  ✓ Auth OK: ${acc.email}`);
            transporters.push({ transporter: t, email: acc.email });
        } catch (err) {
            console.log(`  ✗ Auth failed: ${acc.email} — ${err.message}`);
        }
    }

    if (!transporters.length) {
        console.error("  ✗ No accounts authenticated.");
        process.exit(1);
    }

    const sheets = await initSheets();
    const leads  = await getLeads(sheets);
    console.log(`\n  ${leads.length} leads with email ready.`);
    console.log(`  Limit: ${DAILY_LIMIT} emails/day per account\n`);

    let sent = 0;
    let accIdx = 0;

    for (const lead of leads) {
        // Find next account under limit
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

        const subject = getSubject(lead.nome, lead.nicho);
        const body    = getBody(lead.nome, lead.nicho, lead.cidade);

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
            console.log(`  ✓ [${count}/${DAILY_LIMIT}] ${lead.nome} <${lead.email}> via ${acc.email}`);
        } catch (err) {
            console.log(`  ✗ Failed: ${lead.nome} — ${err.message}`);
        }

        const delay = 45000 + Math.random() * 75000; // 45–120s
        console.log(`  → Waiting ${Math.round(delay / 1000)}s...`);
        await new Promise(r => setTimeout(r, delay));
    }

    console.log(`\n  ══════════════════════════════════════`);
    console.log(`  ✓ Session complete — ${sent} emails sent`);
    console.log(`  ══════════════════════════════════════\n`);
}

main().catch(err => {
    console.error("\n  FATAL ERROR:", err.message);
    process.exit(1);
});
