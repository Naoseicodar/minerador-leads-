// Manual smoke test — run: node scripts/test-email.js
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { enviarEmail } = require("../email-sender");

async function test() {
  // Test 1: should build correct email object
  const email = enviarEmail.buildEmail("O'Brien Plumbing");
  if (!email.subject.includes("O'Brien Plumbing")) throw new Error("Subject must contain business name");
  if (!email.text.includes("Luan")) throw new Error("Body must contain persona name");
  if (!email.text.includes("unsubscribe")) throw new Error("Body must include opt-out");
  console.log("✓ buildEmail works");

  // Test 2: verify transport connects to Gmail
  const ok = await enviarEmail.testTransport();
  if (!ok) throw new Error("Gmail transport failed — check GMAIL_USER and GMAIL_APP_PASSWORD in .env");
  console.log("✓ Gmail transport OK");
}

test().catch(e => { console.error("✗", e.message); process.exit(1); });
