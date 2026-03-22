require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

const { google } = require("googleapis");
const path = require("path");
const fs = require("fs");
const async = require("async");
const https = require("https");
const http = require("http");
const cheerio = require("cheerio");
const AICopywriter = require("./ai-copywriter");

class MinerEngine {
    constructor(config) {
        this.config = config;
        this.term = config.term || "canalizador";
        this.country = config.country || "Portugal";
        this.state = config.state || "";
        this.city = config.city || "Lisboa";
        this.limit = parseInt(config.limit) || 150;
        this.hoods = config.hoods && config.hoods.length > 0 ? config.hoods : [this.city];
        
        this.onLog = config.onLog || (() => {});
        this.onStats = config.onStats || (() => {});
        this.onStatus = config.onStatus || (() => {});
        
        this.isRunning = false;
        this.isPaused = false;
        
        this.stats = {
            leads: 0,
            emails: 0,
            socials: 0
        };
        
        this.browser = null;
        this.queue = null;
        this.ai = new AICopywriter();
        this.knownLeads = new Set();
        
        // Google Sheets setup
        this.sheetId = process.env.SHEET_ID_PORTUGAL || "";
        this.sheetName = "Leads-Premium";
        this.credentialsPath = path.join(__dirname, "..", "credentials.json");
        this.sheetsClient = null;
        
        // Cache to avoid duplicates
        this.seenPhones = new Set();
        this.leadsBuffer = [];
    }

    pause() {
        this.isPaused = true;
        if(this.queue) this.queue.pause();
        this.log("Motor pausado pelo usuário.", "warning");
        this.onStatus({ isRunning: this.isRunning, isPaused: this.isPaused });
    }

    resume() {
        this.isPaused = false;
        if(this.queue) this.queue.resume();
        this.log("Motor retomado.", "success");
        this.onStatus({ isRunning: this.isRunning, isPaused: this.isPaused });
    }

    stop() {
        this.isRunning = false;
        this.isPaused = false;
        if(this.queue) this.queue.kill();
        this.closeBrowser();
        this.flushBuffer();
        this.log("Motor interrompido definitivamente.", "error");
        this.onStatus({ isRunning: false, isPaused: false });
    }

    getStats() {
        return this.stats;
    }

    log(msg, type = "info") {
        this.onLog(msg, type);
        console.log(`[${type.toUpperCase()}] ${msg}`);
    }

    async initGoogleSheets() {
        if (!fs.existsSync(this.credentialsPath)) {
            this.log("credentials.json não encontrado. Salvamento em Google Sheets desativado. Os dados serão mostrados apenas nos logs.", "warning");
            return false;
        }

        try {
            const auth = new google.auth.GoogleAuth({
                keyFile: this.credentialsPath,
                scopes: ["https://www.googleapis.com/auth/spreadsheets"],
            });
            this.sheetsClient = google.sheets({ version: "v4", auth });
            
            // Check sheet exists
            if (!this.sheetId) {
                this.log("SHEET_ID_PORTUGAL não definido no .env.", "warning");
                return false;
            }

            const info = await this.sheetsClient.spreadsheets.get({ spreadsheetId: this.sheetId });
            const abaExistente = info.data.sheets.find(s => s.properties.title === this.sheetName);
            if (!abaExistente) {
                await this.sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    requestBody: { requests: [{ addSheet: { properties: { title: this.sheetName } } }] },
                });
                
                // Add Headers
                await this.sheetsClient.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: `${this.sheetName}!A1`,
                    valueInputOption: "RAW",
                    requestBody: { values: [["Status", "Nome", "Nicho", "Telefone", "Email", "Facebook/Instagram", "Website", "Area", "Cidade", "Avaliação", "Reviews", "Map Link", "Link WhatsApp", "Assunto Sugerido", "Copy do Email", "Diagnóstico Técnico"]] },
                });
                this.log(`Aba ${this.sheetName} criada com sucesso.`, "success");
            }

            // Load existing names and phones to avoid dups
            const res = await this.sheetsClient.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: `${this.sheetName}!B2:D` // B = Nome, C = Nicho, D = Telefone
            }).catch(() => null);
            
            this.knownLeads = new Set();
            if (res && res.data && res.data.values) {
                res.data.values.forEach(row => {
                    if (row[0]) this.knownLeads.add(row[0].toLowerCase().trim()); // B (Nome)
                    if (row[2]) this.seenPhones.add(row[2].replace(/\D/g, "")); // D (Telefone)
                });
            }
            this.log(`Google Sheets conectado. Memória Anti-Duplicação: ${this.knownLeads.size} Nomes e ${this.seenPhones.size} Telefones registrados.`, "system");
            return true;
        } catch (err) {
            this.log(`Erro ao conectar Sheets: ${err.message}`, "error");
            return false;
        }
    }

    async closeBrowser() {
        if (this.browser) {
            try { await this.browser.close(); } catch(e){}
            this.browser = null;
        }
    }

    async start() {
        this.isRunning = true;
        this.isPaused = false;
        this.onStatus({ isRunning: true, isPaused: false });
        
        await this.initGoogleSheets();

        this.log("Inicializando Playwright Stealth Mode...", "system");
        this.browser = await chromium.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
        });

        // Initialize Async Queue with Concurrency of 2 to avoid bot detection and RAM overload
        this.queue = async.queue(async (task, callback) => {
            if (!this.isRunning) return callback();
            try {
                await this.processLead(task);
            } catch (err) {
                this.log(`Erro crítico processando [${task.url}]: ${err.message}`, "error");
            }
            
            // Random delay to simulate human behavior
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            callback();
        }, 2); // Strict concurrency to prevent memory leak
        
        this.queue.drain(async () => {
            if (this.isRunning) {
                this.log("Fila vazia. O motor de busca concluiu todas as requisições.", "success");
                await this.flushBuffer();
                this.stop();
            }
        });

        // Layer 1: Start finding places in Maps
        try {
            await this.crawlGoogleMaps();
        } catch(err) {
            this.log(`Erro na Camada 1: ${err.message}`, "error");
            this.stop();
        }
    }

    async crawlGoogleMaps() {
        const page = await this.browser.newPage();
        
        for (const hood of this.hoods) {
            if (!this.isRunning) break;
            
            const locationString = [hood, this.city, this.state, this.country].filter(Boolean).join(", ");
            const query = encodeURIComponent(`${this.term} em ${locationString}`);
            this.log(`[L1 Maps] Buscando: ${this.term} em ${locationString}...`, "info");
            
            try {
                await page.goto(`https://www.google.com/maps/search/${query}?hl=en`, { timeout: 45000, waitUntil: "domcontentloaded" });
                
                // Deal with consent
                const consent = page.locator('button:has-text("Aceitar tudo"), button:has-text("Accept all")').first();
                if (await consent.isVisible({ timeout: 3000 }).catch(() => false)) await consent.click();

                // Scroll & Extract Links
                const feed = page.locator('div[role="feed"]');
                await feed.waitFor({ timeout: 15000 }).catch(() => null);

                let previousLinkCount = 0;
                let linksSet = new Set();
                
                for (let i = 0; i < 40; i++) {
                    if (!this.isRunning) break;
                    
                    const hrefs = await page.locator('a[href*="/maps/place/"]').evaluateAll(els => els.map(a => a.href));
                    hrefs.forEach(h => linksSet.add(h.split("?")[0]));

                    if (linksSet.size >= this.limit && this.limit > 0) break;
                    
                    await feed.evaluate(el => el.scrollBy(0, 1500)).catch(() => page.evaluate(() => window.scrollBy(0, 1500)));
                    await new Promise(r => setTimeout(r, 1500));
                    
                    if (linksSet.size === previousLinkCount) break; // Reached end
                    previousLinkCount = linksSet.size;
                }

                const arrLinks = Array.from(linksSet).slice(0, this.limit);
                this.log(`[L1 Maps] Encontrados ${arrLinks.length} leads base na localização ${hood}.`, "success");
                
                // Add to premium processing queue
                arrLinks.forEach(url => {
                    this.queue.push({ url, hood });
                });
                
            } catch (err) {
                if (this.isRunning) {
                    this.log(`[L1 Maps] Falha ao raspar localização ${hood}: ${err.message}`, "warning");
                }
            }
        }
        await page.close();
    }

    async processLead(task) {
        if (!this.isRunning) return;

        const page = await this.browser.newPage();
        const d = { nome: "", telefone: "", website: null, avaliacao: "", reviews: "", mapsLink: task.url, area: task.hood, email: "", social: "" };
        
        try {
            await page.route("**/*", async route => {
                try {
                    const type = route.request().resourceType();
                    if (["image", "media", "font", "css"].includes(type)) {
                        await route.abort();
                    } else {
                        await route.continue();
                    }
                } catch(e) {}
            });

            await page.goto(task.url + "&hl=en", { waitUntil: "domcontentloaded", timeout: 20000 });
            await new Promise(r => setTimeout(r, 800));

            // Extract primary data
            d.nome = await page.locator("h1").first().textContent({ timeout: 2000 }).catch(() => "");
            if (!d.nome) throw new Error("Sem nome detectado");
            
            // Name Deduplication Check
            const cleanName = d.nome.toLowerCase().trim();
            if (this.knownLeads.has(cleanName)) {
                this.log(`[Deduplicator] Lead descartado, NOME já processado: ${d.nome}`, "warning");
                await page.close().catch(()=>{});
                return;
            }
            this.knownLeads.add(cleanName);
            
            const ratingText = await page.locator('[aria-label*="estrela"], [aria-label*="star"]').first().getAttribute("aria-label", { timeout: 1000 }).catch(() => "");
            const rm = ratingText.match(/[\d,\.]+/);
            if(rm) d.avaliacao = rm[0].replace(",", ".");

            const rewText = await page.locator('[aria-label*="valiaç"], [aria-label*="review"]').first().getAttribute("aria-label", { timeout: 1000 }).catch(() => "");
            const rx = rewText.match(/(\d[\d\.]*)/);
            if(rx) d.reviews = rx[0].replace(/\./g, "");

            const phoneEl = page.locator('[data-item-id^="phone"]').first();
            if (await phoneEl.isVisible({timeout:1000}).catch(()=>false)) {
                d.telefone = (await phoneEl.getAttribute("aria-label").catch(()=>"")).replace(/(Telefone:|Phone:)/i, "").trim();
            }

            // Phone Deduplication Check
            if (d.telefone) {
                const justNum = d.telefone.replace(/\D/g, "");
                if (this.seenPhones.has(justNum)) {
                    this.log(`[Deduplicator] Lead descartado, TELEFONE já processado: ${d.nome}`, "warning");
                    await page.close().catch(()=>{});
                    return;
                }
                this.seenPhones.add(justNum);
            }

            // Find Website
            const siteEl = page.locator('[data-item-id="authority"], a[data-value="Website"]').first();
            if (await siteEl.isVisible({timeout:1000}).catch(()=>false)) {
                d.website = await siteEl.getAttribute("href").catch(()=>null);
            }

            await page.close().catch(()=>{});

            // Intelligent Fallback Layers
            if (!d.website) {
                this.log(`[L2 DeepSearch] Sem site. Buscando site oficial para: ${d.nome}...`, "system");
                d.website = await this.deepSearchWebsite(d.nome);
            }

            // Layer 3: Website Crawling
            if (d.website && d.website !== "Não encontrado" && d.website.startsWith("http")) {
                this.log(`[L3 Crawl] Entrando em ${d.website}...`, "system");
                const crawl = await this.crawlWebsite(d.website);
                if (crawl.email) d.email = crawl.email;
                if (crawl.social) d.social = crawl.social;
                if (crawl.diagnostico) d.diagnostico = crawl.diagnostico;
            }

            if (!d.email && !d.social) {
                this.log(`[L4 SocialFallback] Buscando Redes Sociais cruas para: ${d.nome}...`, "system");
                d.social = await this.searchSocialFallback(d.nome);
            }

            // Layer 6: AI Copywriter (Pre-Sales)
            this.log(`[L5 AI] Gerando Copy hiper-customizada para: ${d.nome}...`, "system");
            const aiData = await this.ai.generateCopy({
                nome: d.nome,
                nicho: this.term,
                cidade: this.city,
                avaliacao: d.avaliacao || "0",
                reviews: d.reviews || "0",
                website: d.website || "Não encontrado",
                diagnostico: d.diagnostico || ""
            });
            d.assunto = aiData.assunto;
            d.copy = aiData.copy;

            // Save Stats
            this.stats.leads++;
            if (d.email) this.stats.emails++;
            if (d.social) this.stats.socials++;
            this.onStats(this.stats);

            // Print success
            const foundString = [d.email ? "Email" : "", d.social ? "Redes Sociais" : ""].filter(Boolean).join(" & ");
            if (foundString) {
                this.log(`[✓ Capturado] ${d.nome} -> Encontrado: ${foundString}`, "success");
            } else {
                this.log(`[Captalizado] ${d.nome} -> Apenas Maps (Sem canais digitais detectados)`, "warning");
            }

            this.leadsBuffer.push(d);
            if (this.leadsBuffer.length >= 5) await this.flushBuffer();

        } catch (err) {
            await page.close().catch(()=>{});
            throw err;
        }
    }

    async deepSearchWebsite(name) {
        try {
            const query = encodeURIComponent(`"${name}" ${this.city} ${this.country}`);
            const html = await this.fetchHtml(`https://html.duckduckgo.com/html/?q=${query}`);
            const $ = cheerio.load(html);
            let site = null;
            $(".result__url").each((i, el) => {
                const url = $(el).text().trim();
                if (!url.includes("facebook") && !url.includes("instagram") && !url.includes("pai.pt") && !url.includes("yellowpages") && !url.includes("goldenpages") && !url.includes("tripadvisor") && !url.includes("yelp")) {
                    if (!site) site = "https://" + url;
                }
            });
            return site;
        } catch (e) {
            return null;
        }
    }

    async crawlWebsite(url) {
        try {
            const html = await this.fetchHtml(url);
            let email = null;
            let social = null;
            let diagnostico = "";

            if (html) {
                const $ = cheerio.load(html);
                
                // --- Website Auditor (Heurísticas de Falha) ---
                let falhas = [];
                if (!url.startsWith("https")) falhas.push("❌ Sem Certificado de Segurança SSL (Site Não Seguro)");
                if ($('meta[name="viewport"]').length === 0) falhas.push("❌ Não otimizado para telemóvel (Sem Mobile Viewport)");
                
                const scripts = $('script').text().toLowerCase();
                if (!scripts.includes("gtm.js") && !scripts.includes("analytics.js") && !scripts.includes("googletagmanager")) {
                    falhas.push("❌ Nenhum rastreio do Google Analytics detectado");
                }
                if (!scripts.includes("fbq(") && !scripts.includes("fbevents.js")) {
                    falhas.push("❌ Sem Pixel do Facebook/Instagram (Perdendo remarketing)");
                }
                if ($('h1').length === 0) {
                    falhas.push("❌ Faltam tags H1 (Péssimo para SEO local)");
                }
                diagnostico = falhas.length > 0 ? falhas.join(" | ") : "✅ Site bem otimizado tecnicamente";

                // Extração de Emails
                const DOMINIOS_INVALIDOS = [
                    "sentry.io", "ingest.sentry.io", "sentry-next.wixpress.com",
                    "wixpress.com", "example.com", "test.com", "domain.com",
                    "email.com", "yoursite.com", "site.com", "2x.png", "1x.png"
                ];
                const emailMatches = html.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi) || [];
                const emailValido = emailMatches.find(e => {
                    const lower = e.toLowerCase();
                    return !DOMINIOS_INVALIDOS.some(d => lower.includes(d));
                });
                if (emailValido) email = emailValido;
                social = (html.match(/https?:\/\/(www\.)?(facebook\.com|instagram\.com)\/[A-Za-z0-9_.]+/i) || [])[0] || null;
            }
            return { email, social, diagnostico };
        } catch(e) {
            return { email: null, social: null, diagnostico: `Erro ao auditar/raspar site: ${e.message}` };
        }
    }

    async searchSocialFallback(name) {
        try {
            const query = encodeURIComponent(`"${name}" site:facebook.com OR site:instagram.com`);
            const html = await this.fetchHtml(`https://html.duckduckgo.com/html/?q=${query}`);
            const $ = cheerio.load(html);
            let social = null;
            $(".result__url").each((i, el) => {
                const url = $(el).text().trim();
                if (url.includes("facebook.com") || url.includes("instagram.com")) {
                    if (!social) social = "https://" + url;
                }
            });
            return social;
        } catch(e) {
            return null;
        }
    }

    fetchHtml(url) {
        return new Promise((resolve, reject) => {
            if (!url) return reject(new Error("Empty URL"));
            let parsedUrl;
            try { parsedUrl = new URL(url); } catch(e) { return reject(e); }
            
            const lib = parsedUrl.protocol === "https:" ? https : http;
            const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" } }, res => {
                if ([301, 302, 308, 307].includes(res.statusCode) && res.headers.location) {
                    try {
                        const redirectUrl = new URL(res.headers.location, url).href;
                        return this.fetchHtml(redirectUrl).then(resolve).catch(reject);
                    } catch(e) {
                        return reject(e);
                    }
                }
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => resolve(data));
            });
            req.on("error", reject);
            req.setTimeout(8000, () => { req.destroy(); reject(new Error("Timeout")); });
        });
    }

    async flushBuffer() {
        if (this.leadsBuffer.length === 0 || !this.sheetsClient) return;
        const lot = [...this.leadsBuffer];
        this.leadsBuffer = [];

        const countryDialCodes = {
            "Portugal": "351",
            "Brasil": "55",
            "United States": "1",
            "USA": "1",
            "Reino Unido": "44",
            "UK": "44",
            "Espanha": "34",
            "França": "33"
        };
        const dialCode = countryDialCodes[this.country] || "";

        try {
            const rows = lot.map(d => {
                let wppLink = "Sem telefone";
                const safeName = d.nome ? d.nome.trim() : "";

                let safePhone = "Não encontrado";
                if (d.telefone) {
                    safePhone = d.telefone.trim(); // RAW: sem apostrofe, sem formula
                    let num = d.telefone.replace(/\D/g, "");
                    // If no country code, and we have a mapped one, add it.
                    // Assumes local numbers are >= 8 digits
                    if (dialCode && num.length >= 8 && !num.startsWith(dialCode)) {
                        num = dialCode + num;
                    }
                    wppLink = `https://wa.me/${num}`;
                }
                
                return [
                    "Not Contacted",
                    safeName,
                    this.term,
                    safePhone,
                    d.email || "Não encontrado",
                    d.social || "Não encontrado",
                    d.website || "Não encontrado",
                    d.area,
                    this.city,
                    d.avaliacao,
                    d.reviews,
                    d.mapsLink,
                    wppLink,
                    d.assunto || "",
                    d.copy || "",
                    d.diagnostico || ""
                ];
            });

            await this.sheetsClient.spreadsheets.values.append({
                spreadsheetId: this.sheetId,
                range: `${this.sheetName}!A1`,
                valueInputOption: "RAW",
                insertDataOption: "INSERT_ROWS",
                requestBody: { values: rows },
            });
            this.log(`[Google Sheets] Sincronizados ${lot.length} leads para a nuvem.`, "system");
        } catch (e) {
            this.log(`[Google Sheets] Erro de rede ao sincronizar: ${e.message}`, "error");
            // Add back to buffer to try again
            this.leadsBuffer.push(...lot);
        }
    }
}

module.exports = MinerEngine;
