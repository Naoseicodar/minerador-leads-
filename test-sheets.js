require("dotenv").config();
const { google } = require("googleapis");
const path = require("path");

async function test() {
    console.log("SHEET_ID:", process.env.SHEET_ID_PORTUGAL);
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, "credentials.json"),
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    
    try {
        const info = await sheets.spreadsheets.get({ spreadsheetId: process.env.SHEET_ID_PORTUGAL });
        console.log("Spreadsheet found!", info.data.properties.title);
        console.log("Sheets available:");
        info.data.sheets.forEach(s => console.log("- " + s.properties.title));
    } catch (e) {
        console.error("Error:", e.message);
    }
}
test();
