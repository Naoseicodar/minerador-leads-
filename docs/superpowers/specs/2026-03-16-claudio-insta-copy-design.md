# Claudio Insta — Copy Design (AIDA + Autoridade)
Data: 2026-03-16

## Objetivo
Gerar DMs personalizadas de alta conversão para empresários de saúde sem site,
usando o framework AIDA com apresentação de autoridade, inferência de sub-nicho
e personalização via Claude API.

## Estrutura da Mensagem

```
[Autoridade] → [Atenção] → [Interesse] → [Desejo] → [Ação]
```

### 0. Autoridade (2 linhas)
- Nome + especialidade + nicho específico
- "negócios de saúde" cria pertencimento imediato

### A. Atenção
- Cena real: paciente buscando o serviço no Google agora
- Menciona nome da empresa + bairro

### I. Interesse
- Revela que esse paciente não encontrou a clínica
- Concorrente com site capturou o lead

### D. Desejo
- Solução clara: site + SEO local + GMN
- Remove 3 objeções: tempo (48h), complexidade (simples), preço (acessível)

### A. Ação
- Pergunta de baixíssimo compromisso
- Não cita preço, não manda link, só pede permissão

## Dores por Sub-nicho

| Sub-nicho | Cenário | Dor primária |
|---|---|---|
| Dentista | Dor de dente às 22h, pesquisa urgente | Urgência — perde paciente na hora |
| Estética | Pesquisa "harmonização em [bairro]" | Tem Instagram mas invisível no Google |
| Implante capilar | Pesquisa semanas antes de decidir | Sem site = sem credibilidade p/ ticket alto |
| Psicólogo | Momento vulnerável, busca confiança | Site = segurança antes de ligar |
| Fisioterapeuta | Sem indicação, abre Google | Depende de indicação, perde busca ativa |
| Nutricionista | Competitivo no Instagram, invisível no Google local | Precisa de confiança alta para pagar |

## Regras de Copy
1. Tom: conversa, direto, confiante — nunca corporativo
2. Máximo 5 parágrafos curtos
3. Emojis: zero ou 1 no máximo
4. Nunca citar preço na primeira mensagem
5. CTA sempre como pergunta, nunca como ordem
6. Variar estrutura de frase a cada geração

## Funil
- Bot: envia msg 1 (toda a AIDA)
- Empresário responde → Luan assume manualmente (Desejo + Ação)
