# RFC Code MVP Context

**Gathered:** 2026-07-23
**Spec:** `.specs/features/mvp-web-harness/spec.md`
**Status:** Ready for design (pendente confirmação do spec)

---

## Feature Boundary

Harness web self-hosted (Docker no servidor intel) estilo Claude Code Desktop: sessões de coding agent (Claude Code, Codex, OpenCode, Cursor) sobre os projetos do host, com múltiplas contas por provider e troca fácil, acessível via Tailscale de qualquer dispositivo do usuário sem login no app.

---

## Implementation Decisions

### Deploy
- Servidor local **intel** (mesma máquina dos projetos e do notify-hub). Zero custo mensal.

### Acesso / Auth
- **Tailscale, sem login no app** — resposta literal do usuário: "E se eu tiver no Tailscale, sem precisar logar".
- Perímetro de segurança = tailnet. Serviço nunca exposto em interface pública.
- HTTPS via `tailscale serve` (decisão de design, dentro da direção dada).
- URL pública real (Funnel/Cloudflare) = fora de escopo por ora.

### Agents no MVP
- Usuário selecionou **Codex CLI + OpenCode + Cursor CLI** (Claude Code sempre incluído). Os 4 entram no MVP.
- Cursor com risco sinalizado (headless experimental) e degradação explícita permitida.

### Dispositivos
- "Precisa ter modo tablet tb" → **tablet é obrigatório no MVP** (P1), phone é P2, desktop é base.

### Agent's Discretion
- Stack interna, protocolo de streaming (WS/SSE), formato de armazenamento de sessões, estrutura dos volumes de perfil — decisões de Design.
- Nome do projeto: **RFC Code** (dir `rfc-code`) — confirmado pelo usuário em 2026-07-23.

### Declined / Undiscussed Gray Areas → Assumptions
- Base fork vs zero: usuário delegou à pesquisa → registrado como assumption "fork claudecodeui" no spec, pendente confirmação.
- Raiz de projetos no intel: path exato definido no deploy (assumption no spec).

---

## Specific References

- "Quero um harness bem parecido com o Claude Code Desktop" — visual e funcionalidades (sessões, skills, MCPs, permissões) são a referência de UX.
- Múltiplas subscriptions por provider (ex.: 2+ Claude, 2+ Codex) com troca fácil é o diferencial central.

---

## Deferred Ideas

- Tracking de custo/quota por conta/perfil
- Exposição pública real (Funnel/Cloudflare + auth na borda)
- Apps nativos mobile
- UX (achado do UAT 2026-07-24): o painel upstream "Account/Connection Status" por provider mostra a conta DEFAULT do container (sempre vazia no nosso desenho) e confunde — torná-lo profile-aware ou linkar pra aba Profiles
