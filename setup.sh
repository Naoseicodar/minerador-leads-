#!/bin/bash
# =============================================
# Setup Minerador de Leads — Oracle Cloud Ubuntu
# Uso: bash setup.sh
# =============================================

set -e
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   SETUP — MINERADOR DE LEADS         ║"
echo "  ║   Oracle Cloud Ubuntu                ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# Node.js 20
echo "  → Instalando Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - > /dev/null 2>&1
sudo apt-get install -y nodejs > /dev/null 2>&1
echo "  ✓ Node.js $(node -v)"

# Dependencias do sistema para Playwright/Chromium
echo "  → Instalando dependencias do Chromium..."
sudo apt-get install -y \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libasound2 libpango-1.0-0 libpangocairo-1.0-0 \
  libxshmfence1 libgles2 > /dev/null 2>&1
echo "  ✓ Dependencias instaladas"

# Instala pacotes npm
echo "  → Instalando pacotes npm..."
npm install > /dev/null 2>&1
echo "  ✓ Pacotes instalados"

# Instala Chromium via Playwright
echo "  → Instalando Chromium (pode demorar)..."
npx playwright install chromium > /dev/null 2>&1
echo "  ✓ Chromium instalado"

# PM2 para manter o painel rodando
echo "  → Instalando PM2..."
sudo npm install -g pm2 > /dev/null 2>&1
echo "  ✓ PM2 instalado"

# Libera porta 3000 no firewall Oracle
echo "  → Configurando firewall..."
sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
echo "  ✓ Porta 3000 liberada"

# Inicia painel com PM2
echo "  → Iniciando painel web..."
pm2 delete minerador 2>/dev/null || true
pm2 start painel.js --name minerador
pm2 save
pm2 startup 2>/dev/null | tail -1 | bash 2>/dev/null || true

IP=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

echo ""
echo "  ══════════════════════════════════════"
echo "  ✓ Setup concluido!"
echo ""
echo "  Acesse o painel em:"
echo "  http://$IP:3000"
echo ""
echo "  Lembre de abrir a porta 3000 no"
echo "  Security List do Oracle Cloud."
echo "  ══════════════════════════════════════"
echo ""
