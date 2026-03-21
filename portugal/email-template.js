const path = require("path");

const LOGO_PATH = path.join(__dirname, "..", "Brand-Kit-Prisma", "logo-light.png");
const WEBSITE = process.env.NOXTECH_WEBSITE || "https://noxtechdev.netlify.app";
const PHONE = "+1 (612) 633-3722";
const WHATSAPP = "https://wa.me/16126333722";

function buildHtmlEmail(bodyText) {
    const htmlBody = bodyText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");

    return `<!DOCTYPE html>
<html lang="pt">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;max-width:600px;">

    <!-- CORPO DO EMAIL -->
    <tr>
      <td style="padding:36px 40px 28px 40px;">
        <p style="margin:0;font-size:15px;line-height:1.75;color:#1a1a1a;">${htmlBody}</p>
      </td>
    </tr>

    <!-- LINHA SEPARADORA -->
    <tr>
      <td style="padding:0 40px;">
        <div style="border-top:2px solid #1db87a;"></div>
      </td>
    </tr>

    <!-- ASSINATURA HTML -->
    <tr>
      <td style="padding:20px 40px 36px 40px;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <!-- LOGO -->
            <td style="vertical-align:middle;padding-right:18px;">
              <img src="cid:logo-noxtech" alt="Nox Tech" width="72" style="display:block;border:0;outline:0;">
            </td>
            <!-- DIVISOR VERDE -->
            <td style="vertical-align:middle;padding-right:18px;">
              <div style="width:2px;height:52px;background:#1db87a;"></div>
            </td>
            <!-- DADOS -->
            <td style="vertical-align:middle;">
              <p style="margin:0 0 1px 0;font-size:15px;font-weight:bold;color:#1a1a1a;font-family:Arial;">Luan Andrade</p>
              <p style="margin:0 0 8px 0;font-size:12px;color:#1db87a;font-weight:bold;font-family:Arial;letter-spacing:0.5px;text-transform:uppercase;">CEO, Nox Tech</p>
              <p style="margin:0 0 3px 0;font-size:12px;font-family:Arial;">
                <a href="${WEBSITE}" style="color:#1db87a;text-decoration:none;font-weight:bold;">${WEBSITE.replace("https://", "")}</a>
              </p>
              <p style="margin:0;font-size:12px;color:#888888;font-family:Arial;">
                <a href="${WHATSAPP}" style="color:#888888;text-decoration:none;">${PHONE} (WhatsApp)</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

  </table>
</body>
</html>`;
}

module.exports = { buildHtmlEmail, LOGO_PATH };
