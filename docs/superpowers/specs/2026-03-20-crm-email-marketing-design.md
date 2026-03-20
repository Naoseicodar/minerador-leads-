# CRM + Email Marketing + AI Copywriter — Design Spec
**Data:** 2026-03-20
**Projeto:** minerador-leads / Portugal Premium

---

## Objetivo

Transformar o dashboard do minerador numa máquina de pré-vendas completa: extrair leads → gerar copy com IA → visualizar no CRM → disparar emails com logs ao vivo.

---

## Navegação

Sidebar com 4 itens separados:
- ⚡ Dashboard (existente)
- 👥 CRM de Leads (novo)
- 📧 Email Marketing (novo)
- ⚙️ Configurações (existente)

---

## Arquitetura

### Novos arquivos

**`portugal/ai-copywriter.js`**
Módulo responsável exclusivamente por gerar copy via OpenAI API (gpt-3.5-turbo).
- Exporta `generateCopy(lead)` → retorna `{ subject, body }`
- Estratégia A (com website): foco em conversão e qualidade da presença digital
- Estratégia B (sem website): foco em autoridade vs concorrentes com site
- Variáveis dinâmicas: `{nome}`, `{cidade}`, `{área}`, `{nicho}`
- Fallback silencioso: se API falhar, retorna `{ subject: "", body: "" }` sem travar o minerador

**`portugal/email-sender-pt.js`**
Módulo de disparo de emails via nodemailer (Gmail + app password).
- Lê leads da aba `Leads-Premium` do Google Sheets
- Filtra apenas linhas com email válido (≠ "Não encontrado")
- Usa a copy da coluna N/O se disponível, senão usa template padrão
- Após envio: marca coluna `Status` como `Email Sent`
- Delay aleatório 45–120s entre envios
- Limite de 40 emails/dia (contador em `portugal/email-count-pt-YYYY-MM-DD.json`, mesmo padrão do BR)
- Emite logs via Socket.IO no evento `email-log`

### Arquivos modificados

**`portugal/miner-engine-pt.js`**
Adiciona Layer 5 no final de `processLead()`:
- Chama `generateCopy(lead)` após todas as outras camadas
- Inclui `subject` e `body` no objeto `d` antes de chamar `leadsBuffer.push(d)`
- `flushBuffer()` já monta as linhas para append — adicionar colunas N e O ao array de valores existente (índices 13 e 14)

**`server.js`**
1 rota modificada + 3 novas:
- `GET /api/leads` — **já existe**, mas com range `A2:M`. Atualizar range para `A2:O` para incluir colunas N e O (copy da IA)
- `POST /api/email/start` — inicia o email-sender-pt.js; recebe `{ subject, body }` opcionais do compositor; se omitidos, usa colunas N/O da planilha por lead
- `POST /api/email/pause` — seta flag `isPaused = true`; o sender termina o delay atual e pausa antes do próximo envio; `POST /api/email/start` subsequente retoma da fila (não recomeça do zero)
- `POST /api/email/stop` — encerra completamente; próximo start recomeça do início da lista

**`public/index.html` + `public/app.js`**
- Sidebar: 2 novos itens de navegação
- Seção CRM: tabela densa com colunas Nome, Nicho, Telefone, Email, Ações (WPP + Site + botão ✨)
- Modal ✨: exibe Assunto e Copy gerados pela IA, com botão "Copiar"
- Seção Email Marketing: compositor (assunto + corpo) à esquerda — campos pré-preenchidos com copy genérica editável; se o usuário não editar, o sender usa a copy individual da IA por lead (coluna N/O); se editar, sobrescreve para todos os leads da campanha
- Botões: Disparar, Pausar, Parar — com estado gerenciado
- Contador: "X leads com email · Limite: 40/dia"

---

## Modelo de Dados

### Colunas da aba `Leads-Premium` (existentes + novas)

| Col | Campo |
|-----|-------|
| A | Status |
| B | Nome |
| C | Nicho |
| D | Telefone |
| E | Email |
| F | Facebook/Instagram |
| G | Website |
| H | Area |
| I | Cidade |
| J | Avaliação |
| K | Reviews |
| L | Map Link |
| M | Link WhatsApp |
| **N** | **Assunto Sugerido (novo)** |
| **O** | **Copy do Email (novo)** |

---

## Fluxo Completo

```
Minerador roda → processLead() → Layer 5 (ai-copywriter) → salva N/O na planilha
                                                                    ↓
CRM: GET /api/leads → tabela atualizada → botão ✨ → modal com copy
                                                                    ↓
Email Marketing: compor/usar copy da IA → POST /api/email/start → logs ao vivo via Socket.IO
```

---

## Dependências

- `openai` (npm) — para gpt-3.5-turbo
- `nodemailer` (já instalado) — para envio de emails
- Env vars necessárias: `OPENAI_API_KEY`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `SHEET_ID_PORTUGAL` (já existente no .env)
- `credentials.json` (já existente na raiz) — autenticação Google Sheets

---

## Fora de escopo (v1)

- Follow-ups automáticos (FU1/FU2) — próxima iteração
- Edição de copy diretamente no CRM
- Filtros avançados na tabela CRM
