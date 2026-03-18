FROM node:20-slim

# Chromium + dependencias do sistema para whatsapp-web.js / Puppeteer
RUN apt-get update && apt-get install -y \
  chromium \
  fonts-ipafont-gothic \
  fonts-wqy-zenhei \
  libxss1 \
  libnss3 \
  libatk-bridge2.0-0 \
  libdrm2 \
  libxkbcommon0 \
  libgbm1 \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Aponta puppeteer para o Chromium do sistema (evita download duplicado)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
# Evita que playwright baixe browsers (dependencia indireta)
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN chmod +x start.sh

# Render injeta PORT automaticamente; dashboard usa essa variavel
EXPOSE 10000

CMD ["bash", "start.sh"]
