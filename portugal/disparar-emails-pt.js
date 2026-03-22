require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const EmailSender = require("./email-sender-pt");

const sender = new EmailSender({
    onLog: (msg, type) => {
        const prefix = { success: "[✓]", error: "[✗]", warning: "[!]", system: "[*]", info: "   " }[type] || "   ";
        console.log(`${prefix} ${msg}`);
    }
});

console.log("=== MinerADOR PRO — Disparo Portugal ===\n");

sender.start().then(() => {
    console.log("\nDisparo concluido.");
    process.exit(0);
}).catch(err => {
    console.error("\n[ERRO FATAL]", err.message);
    process.exit(1);
});
