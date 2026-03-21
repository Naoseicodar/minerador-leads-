const socket = io();

// UI Elements
const badge = document.getElementById("bot-badge");
const systemDot = document.getElementById("system-status-dot");
const systemText = document.getElementById("system-status-text");

const btnStart = document.getElementById("btnStart");
const btnPause = document.getElementById("btnPause");
const btnStop = document.getElementById("btnStop");

const statLeads = document.getElementById("stat-leads");
const statEmails = document.getElementById("stat-emails");
const statSocials = document.getElementById("stat-socials");
const statCr = document.getElementById("stat-cr");

const terminalOutput = document.getElementById("terminal-output");

// Socket Events
socket.on("connect", () => {
    badge.textContent = "ONLINE";
    badge.className = "badge online";
    appendLog("System Connected to WebSocket Server", "system");
    fetchStatus();
});

socket.on("disconnect", () => {
    badge.textContent = "OFFLINE";
    badge.className = "badge";
    systemDot.className = "status-dot offline";
    systemText.textContent = "Offline";
    appendLog("Disconnected from server", "error");
});

socket.on("log", (data) => {
    appendLog(data.message, data.type, data.time);
});

socket.on("stats", (stats) => {
    statLeads.textContent = stats.leads;
    statEmails.textContent = stats.emails;
    statSocials.textContent = stats.socials;
    
    if (stats.leads > 0) {
        const cr = Math.round(((stats.emails + stats.socials) / stats.leads) * 100);
        statCr.textContent = `${cr}%`;
    }
});

socket.on("status", (s) => {
    updateUI(s.isRunning, s.isPaused);
});

// Functions
function appendLog(msg, type = "info", manualTime = null) {
    const time = manualTime || new Date().toLocaleTimeString("pt-BR");
    const div = document.createElement("div");
    div.className = `log-line ${type}`;
    div.innerHTML = `<span class="time">[${time}]</span> <span class="msg">${escapeHtml(msg)}</span>`;
    
    const isScrolledToBottom = terminalOutput.scrollHeight - terminalOutput.clientHeight <= terminalOutput.scrollTop + 10;
    
    terminalOutput.appendChild(div);
    
    // Auto scroll if user was at the bottom
    if (isScrolledToBottom) {
        terminalOutput.scrollTop = terminalOutput.scrollHeight;
    }
}

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");
}

function updateUI(isRunning, isPaused) {
    btnStart.disabled = isRunning;
    btnPause.disabled = !isRunning;
    btnStop.disabled = !isRunning;

    if (isRunning && !isPaused) {
        systemDot.className = "status-dot running";
        systemText.textContent = "Mining in progress...";
        btnPause.textContent = "⏸ Pause";
    } else if (isRunning && isPaused) {
        systemDot.className = "status-dot";
        systemDot.style.background = "var(--warning)";
        systemDot.style.boxShadow = "none";
        systemText.textContent = "Mining paused";
        btnPause.textContent = "▶ Resume";
    } else {
        systemDot.className = "status-dot";
        systemDot.style.background = "var(--success)";
        systemDot.style.boxShadow = "none";
        systemText.textContent = "System Ready";
        btnPause.textContent = "⏸ Pause";
    }
}

async function fetchStatus() {
    try {
        const res = await fetch("/api/currentStatus");
        const data = await res.json();
        updateUI(data.isRunning, data.isPaused);
        if (data.stats) {
            statLeads.textContent = data.stats.leads;
            statEmails.textContent = data.stats.emails;
            statSocials.textContent = data.stats.socials;
        }
    } catch (e) {
        appendLog("Failed to fetch initial status", "error");
    }
}

// Actions
btnStart.addEventListener("click", async () => {
    const term = document.getElementById("termInput").value;
    const country = document.getElementById("countryInput").value;
    const state = document.getElementById("stateInput").value;
    const city = document.getElementById("cityInput").value;
    const limit = document.getElementById("limitInput").value;
    const hoods = document.getElementById("neighborhoodsInput").value.split(",").map(x => x.trim()).filter(Boolean);

    try {
        btnStart.disabled = true;
        const res = await fetch("/api/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ term, country, state, city, limit, hoods })
        });
        const d = await res.json();
        if(!res.ok) {
            btnStart.disabled = false;
            appendLog(d.error || "Failed to start", "error");
        }
    } catch (e) {
        btnStart.disabled = false;
        appendLog(e.message, "error");
    }
});

// Autocomplete for Cities using Nominatim OpenStreetMap API
let cityTimeout;
document.getElementById('cityInput').addEventListener('input', (e) => {
    clearTimeout(cityTimeout);
    const query = e.target.value;
    if (query.length < 3) return;
    
    cityTimeout = setTimeout(async () => {
        try {
            const country = document.getElementById('countryInput').value;
            const res = await fetch(`https://nominatim.openstreetmap.org/search?city=${encodeURIComponent(query)}&country=${encodeURIComponent(country)}&format=json&limit=6`);
            const data = await res.json();
            
            const datalist = document.getElementById('cityList');
            datalist.innerHTML = '';
            const seen = new Set();
            
            data.forEach(item => {
                const name = item.name || (item.display_name ? item.display_name.split(',')[0] : "");
                if (name && !seen.has(name)) {
                    seen.add(name);
                    const option = document.createElement('option');
                    option.value = name;
                    datalist.appendChild(option);
                }
            });
        } catch(err) {
            // Silently ignore network errors for autocomplete
        }
    }, 450); // debounce API calls
});

btnPause.addEventListener("click", async () => {
    const isPaused = systemText.textContent.includes("paused");
    const route = isPaused ? "/api/resume" : "/api/pause";
    try {
        await fetch(route, { method: "POST" });
    } catch (e) {
        appendLog("Network error", "error");
    }
});

btnStop.addEventListener("click", async () => {
    if(!confirm("Are you sure you want to stop the extraction engine?")) return;
    try {
        await fetch("/api/stop", { method: "POST" });
    } catch (e) {
        appendLog("Network error", "error");
    }
});

// --- CRM View Logic ---
let allLeadsInfo = [];

function switchTab(tabId) {
    document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
    document.querySelectorAll('.view-section').forEach(v => v.style.display = 'none');

    document.getElementById(`nav-${tabId}`).classList.add('active');
    document.getElementById(`view-${tabId}`).style.display = 'block';

    if (tabId === 'crm') {
        document.getElementById('topbar-title').textContent = "CRM / Database Premium";
        document.getElementById('topbar-subtitle').textContent = "Visualização Profissional dos Leads Extraídos";
        if (allLeadsInfo.length === 0) loadLeads();
    } else if (tabId === 'email') {
        document.getElementById('topbar-title').textContent = "Mail Automator";
        document.getElementById('topbar-subtitle').textContent = "Disparo automático com copy personalizada por IA · 40 emails/dia";
        loadEmailStatus();
        loadEmailLeadStats();
    } else {
        document.getElementById('topbar-title').textContent = "Portugal Extraction Engine";
        document.getElementById('topbar-subtitle').textContent = "Multi-layer deep scraping powered by AI & Stealth Protocol";
    }
}

async function loadLeads() {
    const tbody = document.getElementById("crm-tbody");
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px;"><div class="status-dot running" style="margin: 0 auto 10px; display:block"></div> Sincronizando com a Nuvem...</td></tr>`;
    try {
        const res = await fetch("/api/leads");
        const data = await res.json();
        
        if (data.success) {
            allLeadsInfo = data.leads;
            document.getElementById("crm-badge").textContent = allLeadsInfo.length;
            renderCRM(allLeadsInfo);
        } else {
            throw new Error(data.error);
        }
    } catch(e) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--danger);">${e.message || "Erro de conexão"}</td></tr>`;
    }
}

function filterCRM() {
    const term = document.getElementById("crm-search").value.toLowerCase();
    const filtered = allLeadsInfo.filter(l => 
        l.nome.toLowerCase().includes(term) || 
        l.cidade.toLowerCase().includes(term) ||
        l.nicho.toLowerCase().includes(term) ||
        l.email.toLowerCase().includes(term)
    );
    renderCRM(filtered);
}

function renderCRM(leads) {
    const tbody = document.getElementById("crm-tbody");
    if (leads.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">Nenhum lead encontrado.</td></tr>`;
        return;
    }

    let rowsHtml = '';
    leads.forEach(l => {
        let emailBadge = l.email && l.email !== "Não encontrado" ? `<span class="status-badge badge-found">${l.email}</span>` : `<span class="status-badge badge-missing">Missing</span>`;
        let socialBadge = l.social && l.social !== "Não encontrado" ? `<a href="${l.social}" target="_blank" class="status-badge badge-found">Ver Perfil</a>` : `<span class="status-badge badge-missing">Missing</span>`;
        
        let wppAction = l.wppLink && l.wppLink.startsWith("http") 
            ? `<a href="${l.wppLink}" target="_blank" class="btn-icon btn-wpp" title="Puxar Assunto WhatsApp">💬</a>`
            : '';
            
        let mailAction = l.email && l.email !== "Não encontrado"
            ? `<a href="mailto:${l.email}" class="btn-icon btn-mail" title="Abrir Email">✉️</a>`
            : '';

        let siteAction = l.website && l.website.startsWith("http")
            ? `<a href="${l.website}" target="_blank" class="btn-icon btn-link" title="Visitar Site">🌍</a>`
            : '';

        let aiAction = l.assunto && l.copy 
            ? `<button class="btn-icon btn-ai" title="Ver Copy (AI)" data-nome="${encodeURIComponent(l.nome)}" data-assunto="${encodeURIComponent(l.assunto)}" data-copy="${encodeURIComponent(l.copy)}" data-diagnostico="${encodeURIComponent(l.diagnostico || '')}" onclick="openCopyModal(this)">🤖</button>`
            : '';

        let phoneText = l.telefone !== "Não encontrado" ? l.telefone : "Sem Telefone";

        rowsHtml += `
            <tr>
                <td>
                    <span class="lead-name">${l.nome} <span class="lead-niche">${l.nicho}</span></span>
                    <span class="lead-phone">📞 ${phoneText}</span>
                </td>
                <td>${emailBadge}</td>
                <td>${socialBadge}</td>
                <td>${l.cidade} <br><span style="font-size:11px;color:var(--text-muted)">${l.area}</span></td>
                <td>
                    <span class="rating-stars">⭐ ${l.avaliacao || "-"}</span> 
                    <span class="review-count">(${l.reviews || "0"} avs)</span>
                </td>
                <td class="action-row">
                    ${aiAction}
                    ${wppAction}
                    ${mailAction}
                    ${siteAction}
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = rowsHtml;
}

// --- Email Marketing Logic ---
const btnEmailStart = document.getElementById("btnEmailStart");
const btnEmailPause = document.getElementById("btnEmailPause");
const btnEmailStop = document.getElementById("btnEmailStop");
const emailTerminal = document.getElementById("email-terminal");

socket.on("email-log", (data) => {
    appendEmailLog(data.message, data.type, data.time);
    loadEmailStatus();
});

function appendEmailLog(msg, type = "info", manualTime = null) {
    const time = manualTime || new Date().toLocaleTimeString("pt-BR");
    const div = document.createElement("div");
    div.className = `log-line ${type}`;
    div.innerHTML = `<span class="time">[${time}]</span> <span class="msg">${escapeHtml(msg)}</span>`;
    const isAtBottom = emailTerminal.scrollHeight - emailTerminal.clientHeight <= emailTerminal.scrollTop + 10;
    emailTerminal.appendChild(div);
    if (isAtBottom) emailTerminal.scrollTop = emailTerminal.scrollHeight;
}

async function loadEmailStatus() {
    try {
        const res = await fetch("/api/email/status");
        const data = await res.json();
        document.getElementById("email-stat-sent").textContent = data.dailyCount;
        document.getElementById("email-stat-limit").textContent = data.dailyLimit;
        updateEmailUI(data.isRunning, data.isPaused);
    } catch (e) {}
}

async function loadEmailLeadStats() {
    try {
        const res = await fetch("/api/leads");
        const data = await res.json();
        if (!data.success) return;
        const withEmail = data.leads.filter(l => l.email && l.email !== "Não encontrado" && l.email.includes("@") && l.status !== "Email Sent");
        const withAI = withEmail.filter(l => l.assunto && l.copy);
        document.getElementById("email-stat-leads").textContent = withEmail.length;
        document.getElementById("email-stat-ai").textContent = withAI.length;
    } catch (e) {}
}

function updateEmailUI(isRunning, isPaused) {
    btnEmailStart.disabled = isRunning;
    btnEmailPause.disabled = !isRunning;
    btnEmailStop.disabled = !isRunning;
    if (isRunning && isPaused) {
        btnEmailPause.textContent = "▶ Retomar";
    } else {
        btnEmailPause.textContent = "⏸ Pausar";
    }
}

btnEmailStart.addEventListener("click", async () => {
    const subject = document.getElementById("email-subject").value.trim();
    const body = document.getElementById("email-body").value.trim();
    try {
        btnEmailStart.disabled = true;
        const res = await fetch("/api/email/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject: subject || null, body: body || null })
        });
        const d = await res.json();
        if (!res.ok) {
            btnEmailStart.disabled = false;
            appendEmailLog(d.error || "Erro ao iniciar", "error");
        } else {
            appendEmailLog(d.message, "success");
            updateEmailUI(true, false);
        }
    } catch (e) {
        btnEmailStart.disabled = false;
        appendEmailLog(e.message, "error");
    }
});

btnEmailPause.addEventListener("click", async () => {
    try {
        const res = await fetch("/api/email/pause", { method: "POST" });
        const d = await res.json();
        appendEmailLog(d.message, "warning");
        loadEmailStatus();
    } catch (e) {
        appendEmailLog("Erro de rede", "error");
    }
});

btnEmailStop.addEventListener("click", async () => {
    if (!confirm("Parar o envio de emails?")) return;
    try {
        await fetch("/api/email/stop", { method: "POST" });
        appendEmailLog("Envio interrompido.", "error");
        updateEmailUI(false, false);
    } catch (e) {
        appendEmailLog("Erro de rede", "error");
    }
});

// Modal Functions
function openCopyModal(btn) {
    const nome = decodeURIComponent(btn.getAttribute('data-nome'));
    const assunto = decodeURIComponent(btn.getAttribute('data-assunto'));
    const copy = decodeURIComponent(btn.getAttribute('data-copy'));
    const diagnostico = decodeURIComponent(btn.getAttribute('data-diagnostico') || "");
    
    document.getElementById('modal-lead-name').textContent = nome;
    document.getElementById('modal-assunto').value = assunto;
    document.getElementById('modal-copy').value = copy;
    
    const diagContainer = document.getElementById('modal-diagnostico-container');
    const diagText = document.getElementById('modal-diagnostico');
    if (diagnostico && diagnostico.length > 5 && diagnostico.includes("❌")) {
        diagText.innerHTML = diagnostico.split(" | ").join("<br>");
        diagContainer.style.display = 'block';
    } else {
        diagContainer.style.display = 'none';
    }

    document.getElementById('copyModal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('copyModal').style.display = 'none';
}

function copyToClipboard() {
    const assunto = document.getElementById('modal-assunto').value;
    const copy = document.getElementById('modal-copy').value;
    const fullText = `Assunto: ${assunto}\n\n${copy}`;
    
    navigator.clipboard.writeText(fullText).then(() => {
        alert("Copy e Assunto copiados para a Área de Transferência!");
    });
}
