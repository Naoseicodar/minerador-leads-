const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const path = require('path');
const fs = require('fs');

async function run() {
    console.log("Iniciando máquina de renderização vetorial do Brand Kit (SVG -> PNG alta resolução)...");
    const browser = await chromium.launch({ headless: true });
    
    // Usar dispositivo com alta densidade de pixel (Retina) para máxima nitidez (deviceScaleFactor: 2)
    const context = await browser.newContext({
        viewport: { width: 3000, height: 6000 },
        deviceScaleFactor: 2 
    });
    
    const page = await context.newPage();
    const filePath = `file:///${path.join(__dirname, 'brand-kit-template.html').replace(/\\/g, '/')}`;
    
    console.log("Carregando o Layout da Identidade Visual...");
    await page.goto(filePath, { waitUntil: 'networkidle' });

    console.log("Aguardando carregamento da tipografia Syne e Manrope...");
    await page.evaluate(async () => {
        await document.fonts.ready;
        // Tempo extra para garantir a interpolação do gradient
        return new Promise(r => setTimeout(r, 500));
    });

    const outDir = path.join(__dirname, "Brand-Kit-Prisma");
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir);
    }

    const jobs = [
        { id: '#logo-dark', name: 'logo-dark.png' },
        { id: '#logo-light', name: 'logo-light.png' },
        { id: '#logo-transparente', name: 'logo-transparente.png', omitBg: true },
        { id: '#cartao-frente', name: 'cartao-frente.png' },
        { id: '#cartao-verso', name: 'cartao-verso.png' },
        { id: '#email-signature', name: 'email-signature.png', omitBg: true },
        { id: '#letterhead-a4', name: 'letterhead-a4.png' },
        { id: '#profile-pic', name: 'profile-pic.png' },
        { id: '#banner-social', name: 'banner-social.png' }
    ];

    for (const job of jobs) {
        console.log(`📸 Renderizando arquivo: ${job.name}...`);
        const element = await page.$(job.id);
        if (element) {
            await element.screenshot({
                path: path.join(outDir, job.name),
                omitBackground: !!job.omitBg,
                type: 'png'
            });
        }
    }

    await browser.close();
    console.log("\n✅ Brand Kit Finalizado! Verifique a pasta 'Brand-Kit-Prisma'.");
}

run().catch(console.error);
