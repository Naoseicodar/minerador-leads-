# Design: Painel Web para Disparar o Minerador de Leads

**Data:** 2026-03-10
**Status:** Aprovado

## Objetivo

Criar um painel web simples hospedado no GitHub Pages para disparar o workflow do minerador de leads via GitHub API, sem necessidade de acessar a interface do GitHub Actions diretamente.

## Arquitetura

- **Um único arquivo:** `index.html` adicionado na raiz do repositório `Naoseicodar/minerador-leads-`
- **Hospedagem:** GitHub Pages (gratuito, habilitado via configurações do repo)
- **Comunicação:** Chamada `fetch` à API REST do GitHub — `POST /repos/Naoseicodar/minerador-leads-/actions/workflows/minerador.yml/dispatches`
- **Autenticação:** GitHub Personal Access Token (PAT) com permissão `workflow`, armazenado no `localStorage` do navegador

## Componentes do Painel

1. **Campo PAT** — Input tipo password, salvo no localStorage. Não é enviado a nenhum servidor externo.
2. **Formulário de disparo** — Campos: cidade, termo de busca, bairros (opcional), limite de leads
3. **Botão "Disparar Minerador"** — Faz o POST para a API do GitHub
4. **Área de status** — Exibe: aguardando, disparando, sucesso (com link para o Actions) ou erro

## Fluxo de Dados

```
Usuário preenche formulário
  → Clica em "Disparar"
    → JS faz POST para api.github.com com PAT no header Authorization
      → GitHub inicia o workflow
        → Painel exibe mensagem de sucesso + link para acompanhar
```

## Deploy

1. Adicionar `index.html` ao repositório
2. No GitHub: Settings → Pages → Source: Deploy from branch → `master` / `/(root)`
3. URL final: `https://naoseicodar.github.io/minerador-leads-/`

## Fora do escopo

- Login/autenticação de usuários
- Histórico de execuções
- Visualização dos leads gerados
