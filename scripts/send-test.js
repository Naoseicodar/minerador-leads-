require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const nodemailer = require("nodemailer");

const transport = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

transport.sendMail({
  from: `Luan <${process.env.GMAIL_USER}>`,
  to: process.env.GMAIL_USER,
  subject: "teste",
  text: "teste",
}).then(() => {
  console.log("Email enviado com sucesso!");
}).catch(err => {
  console.error("Erro:", err.message);
});
