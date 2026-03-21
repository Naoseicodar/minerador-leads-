require("dotenv").config();
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);
const { google } = require("googleapis");
const path = require("path");

const leadsObj = `Canalizador de Lisboa
SOS Obras Aveiro, pinturas, remodelações, canalizador, capoto
CANALIZADOR 24 HORAS SERVIÇOS COM QUALIDADE PROFISSIONAIS CERTIFICADOS.
Canalizador 24 Horas - Desentupimentos - Remodelações - Fugas de Agua - Torneiras - Autoclismos
CanalizadorTravassos - Desentupimentos e Canalizador em Lisboa
Resolve Soluções 24h | Canalizador e Desentupimentos em Lisboa
Canalizador do Bairro - Serviços Canalização - Canalizador Lisboa - Desentupimentos Lisboa
Mundo dos Canalizadores, Lda.
Canalizador 24 Horas
Canalizadora de Santo Amaro
O Canalizador
Canalizadores Lisboa
SOS Espiral canalizacao
Multi 24 Serviços
Telheiro de Pascoal
O Cantinho do Tito
Restaurante Piccolino
O Hipólito
A Púcara
Inprovviso
Santa Luzia
Tasquinha do Brasileiro
Churrasqueira Bota Fogo
Restaurante Gilberto o Brasileiro
Casa Arouquesa
Cantinho do Alex
Marisqueira Casablanca
Tia Alice
100 Papas na língua
Nomiya Sushi Bar
Restaurante D. Duarte
Vintage Maison
Mesa d'Alegria
Taberna Dona Antónia
O Sabor
Viriatus Brunch
cervejaria o cambalro
Taberna do Dão
Café Rio de Loba
Restaurante Ibérico
Taberna O Seca Adegas
Porta Cozinha Tradicional
O Viso
Restaurante Cheio Wok
Rude - Restaurante
Churrasqueira Santa Eulália
Recanto Caseiro
virginiatalfrancesinhaviseu
The flames restaurant
Seven Senses
Restaurante Frequente
O Cortiço
Taberna Londrina Viseu
Palace Viseu
Última Ceia
A Família
Steak House by XXL
Quinta da Magarenha
Dalla's
Restaurante Rossio Parque
Zé do Pernil
Muralha da Sé
Restaurante O Junior
Mesa de Lemos
O Pateo`.split('\n').map(x => x.trim()).filter(Boolean);

async function run() {
    console.log("[Importer] Iniciando importação silenciosa de " + leadsObj.length + " leads...");
    
    let sheetsClient;
    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: path.join(__dirname, "credentials.json"),
            scopes: ["https://www.googleapis.com/auth/spreadsheets"],
        });
        sheetsClient = google.sheets({ version: "v4", auth });
    } catch(e) {
        console.error("Sheets falhou:", e);
        return;
    }
    const sheetId = process.env.SHEET_ID_PORTUGAL;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    let rowsToInsert = [];

    for (const name of leadsObj) {
        let phone = "Não encontrado";
        try {
            console.log("Buscando telefone para:", name);
            const query = encodeURIComponent(name + " telefone Portugal");
            await page.goto("https://www.google.com/search?q=" + query, { waitUntil: "domcontentloaded", timeout: 15000 });
            
            const phoneLocator = page.locator('span[aria-label^="Ligar"]').first();
            if (await phoneLocator.isVisible({ timeout: 2000 }).catch(()=>false)) {
                 let rawPhone = await phoneLocator.textContent();
                 if(rawPhone) {
                     phone = rawPhone.replace(/\D/g, "");
                     if(phone.length >= 9 && !phone.startsWith("351")) phone = "351" + phone;
                 }
            } else {
                 const bodyText = await page.locator("body").textContent();
                 const match = bodyText.match(/(?:(?:\+|00)351|)\s*(?:[29]\d{2}\s*\d{3}\s*\d{3})/);
                 if(match) {
                     phone = match[0].replace(/\D/g, "");
                     if(phone.length >= 9 && !phone.startsWith("351")) phone = "351" + phone;
                 }
            }
        } catch (e) {}

        console.log(`-> ${name} / ${phone}`);
        
        let safePhone = phone !== "Não encontrado" ? phone.trim() : "Não encontrado";
        let wppLink = phone !== "Não encontrado" ? `https://wa.me/${phone.trim()}` : "Sem telefone";

        rowsToInsert.push([
            "Not Contacted",
            name,
            "Estabelecimento",
            safePhone,
            "Não encontrado",
            "Não encontrado",
            "Não encontrado",
            "Portugal",
            "Portugal",
            "0",
            "0",
            "",
            wppLink,
            "",
            "",
            ""
        ]);
        
        if (rowsToInsert.length >= 5) {
             await sheetsClient.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: `Leads-Premium!A1`,
                valueInputOption: "RAW",
                insertDataOption: "INSERT_ROWS",
                requestBody: { values: rowsToInsert }
            });
            console.log("Salvos 5 no sheets.");
            rowsToInsert = [];
        }
    }
    
    if (rowsToInsert.length > 0) {
        await sheetsClient.spreadsheets.values.append({
            spreadsheetId: sheetId,
            range: `Leads-Premium!A1`,
            valueInputOption: "RAW",
            insertDataOption: "INSERT_ROWS",
            requestBody: { values: rowsToInsert }
        });
    }

    console.log("[Importer] Finalizado com sucesso!");
    await browser.close();
}

run();
