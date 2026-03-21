const { OpenAI } = require("openai");

class AICopywriter {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || "dummy"
        });
        this.hasKey = !!process.env.OPENAI_API_KEY;
    }

    async generateCopy(lead) {
        if (!this.hasKey) {
            return {
                assunto: "pergunta rápida sobre o " + lead.nome,
                copy: "Configure OPENAI_API_KEY no .env para gerar copy com IA."
            };
        }

        const website = process.env.NOXTECH_WEBSITE || "noxtech.io";

        const promptSystem = `És um especialista em cold email B2B para o mercado português (Portugal). A tua única função é escrever emails que geram respostas — não vendas, respostas.

REGRAS ABSOLUTAS DO ASSUNTO (viola = falha):
- Máximo 5 palavras, tudo em minúsculas
- Parece um email de colega, não de vendedor
- Cria curiosidade sem revelar o conteúdo
- PROIBIDO: "grátis", "oferta", "promoção", "incrível", "oportunidade", "urgente", exclamações, RE:/FWD: falso
- Exemplos válidos: "reparei numa coisa", "pergunta rápida", "tentei encontrar-vos online", "[NomeEmpresa] no Google"

REGRAS ABSOLUTAS DO CORPO (viola = falha):
- 80 a 110 palavras. Nem mais, nem menos.
- NUNCA começas com "O meu nome é", "Somos a", "Espero que"
- PRIMEIRA FRASE: facto verificável sobre o negócio DELES, não sobre ti
- Estrutura obrigatória:
  1. Observação específica sobre o negócio (1 frase)
  2. Problema concreto que isso causa (1-2 frases)
  3. UMA prova social real com número (ex: "uma clínica em Lisboa começou a receber 4-6 contactos novos por semana via Google em menos de 30 dias")
  4. Solução em 1 frase — site + SEO local entregue em 48h, sem mensalidade
  5. CTA único de baixo esforço — "Faz sentido trocarmos 10 minutos esta semana?"
- Português de Portugal OBRIGATÓRIO: "vocês" → "a vossa clínica", "você" → "o senhor/a"
- Sem links no corpo, sem anexos, sem múltiplos CTAs, sem emojis
- Tom: directo, entre pares, pessoal
- Parágrafos curtos, 1-2 frases cada

AUTORIDADE DISPONÍVEL (usa UMA por email, a mais relevante):
- Clínica de estética em Lisboa: passou de 0 para 4-6 novos contactos/semana via Google em 28 dias
- Restaurante no Porto: começou a receber reservas directas pelo site em menos de 3 semanas
- Empresa de serviços ao domicílio em Braga: triplicou os pedidos de orçamento em 45 dias
- Prazo real: 48 horas da aprovação à entrega (não é marketing, é contrato)
- Portfolio verificável: ${website}

NÃO incluas assinatura — ela é adicionada automaticamente de forma visual.

Devolve APENAS este JSON, sem texto extra:
{"assunto": "...", "copy": "... (usa \\n para quebras de parágrafo)"}`;

        let promptUser = "";
        const temDiagnostico = lead.diagnostico && lead.diagnostico.includes("❌");

        if (lead.website && lead.website !== "Não encontrado" && lead.website.startsWith("http")) {
            const seccaoDiagnostico = temDiagnostico
                ? `\nFalhas técnicas detectadas no site: ${lead.diagnostico}\nCita estas falhas como argumento concreto.`
                : "";

            promptUser = `Lead:
- Empresa: "${lead.nome}"
- Sector: "${lead.nicho}"
- Cidade: ${lead.cidade}
- Site actual: ${lead.website}
- Google: ${lead.avaliacao}★ · ${lead.reviews} avaliações${seccaoDiagnostico}

Estratégia: TÊM site mas perdem visibilidade para concorrentes com melhor SEO local.
Primeira frase: comenta que analisaste o site ou tentaste encontrá-los no Google para "${lead.nicho} ${lead.cidade}" e o que encontraste. Liga directamente à perda de clientes para concorrentes que aparecem à frente. Com ${lead.reviews} avaliações a reputação existe — mas está invisível para quem pesquisa agora.`;

        } else {
            promptUser = `Lead:
- Empresa: "${lead.nome}"
- Sector: "${lead.nicho}"
- Cidade: ${lead.cidade}
- Site: não têm
- Google: ${lead.avaliacao}★ · ${lead.reviews} avaliações

Estratégia: SEM site — invisíveis online enquanto os concorrentes captam os clientes que os procuram.
Primeira frase: diz que pesquisaste "${lead.nicho} ${lead.cidade}" e não encontraste o "${lead.nome}" — só a concorrência. Com ${lead.reviews} avaliações a reputação já existe offline — mas é invisível para quem ainda não os conhece e pesquisa online agora.`;
        }

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: promptSystem },
                    { role: "user", content: promptUser }
                ],
                temperature: 0.7,
                response_format: { type: "json_object" }
            });

            const data = JSON.parse(response.choices[0].message.content);
            return {
                assunto: data.assunto || "pergunta rápida",
                copy: data.copy || "Erro no formato da resposta."
            };
        } catch (err) {
            console.error("[AI Copywriter Error]", err.message);
            return { assunto: "reparei numa coisa", copy: "Falha de comunicação com a API." };
        }
    }
}

module.exports = AICopywriter;
