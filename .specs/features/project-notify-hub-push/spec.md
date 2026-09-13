# Project Notify-Hub Push — Specification

## Problem Statement

O canal webhook do notify-hub já existe (`webhook-notify-channel.service.js`, T18 do MVP), mas é **global e só por env** (`NOTIFY_URL`/`NOTIFY_TOKEN`), hoje comentado em `~/.rfc-code/env` — logo nada chega no celular. O payload atual (`"<sessão>" / "Claude: Run Stopped: completed"`) não diz **projeto** nem **horário**, e não dá pra ligar só nos projetos que importam. Quem instala o app em outro lugar não tem como apontar pro próprio notify-hub sem editar env e reiniciar.

## Goals

- [x] Botão por projeto (sino) na sidebar liga/desliga o push do notify-hub só pra aquele projeto
- [x] Mensagem com resumo simples: status, **projeto**, **horário** (fuso configurado), sessão, duração quando houver
- [x] Configurador em Settings > Notifications: URL, token, fuso, botão "Testar"; sem restart
- [x] Instância do usuário já sai configurada (credenciais semeadas por env, fora do repo)
- [x] Falha do notify-hub nunca afeta a sessão (mantém HUB-09)

## Out of Scope

| Item | Motivo |
| --- | --- |
| Texto da notificação i18n por idioma do usuário | Servidor não conhece o idioma; texto segue o hook `notify-hook.mjs` (PT-BR) que o usuário já recebe. Débito registrado. |
| Escolher canais do notify-hub (ntfy/telegram…) por projeto | Roteamento é do perfil do token no notify-hub. Um token = um conjunto de canais. |
| Toggle por sessão ou por usuário | Segue o padrão de `isStarred`: flag na linha do projeto. |
| Resumo do que o agente respondeu (headline) | Orquestrador não vê o texto final; sessão + status + duração bastam pro MVP. |
| Migrar web-push/desktop pro mesmo configurador | Canais existentes intocados. |

---

## User Stories

### P1: Ligar push por projeto ⭐ MVP

1. WHEN a linha do projeto renderiza no seletor da sidebar THEN SHALL exibir um botão sino ao lado da estrela, sempre visível, com estado (`aria-pressed`)
2. WHEN o usuário clica no sino THEN o sistema SHALL alternar `projects.notifyEnabled` via `POST /api/projects/:projectId/toggle-notify`, com atualização otimista e rollback em erro (mesmo comportamento da estrela)
3. WHEN a lista de projetos é carregada (ativos e arquivados) THEN cada item SHALL trazer `notifyEnabled`
4. WHEN o projeto tem `notifyEnabled = 0` THEN nenhum evento dele SHALL ser enviado ao notify-hub, mesmo com URL/token configurados
5. WHEN o evento não resolve pra nenhum projeto (ex.: `provider = system`, sem `projectPath` nem sessão) THEN NÃO SHALL enviar

### P2: Mensagem com projeto e horário

1. WHEN uma run termina (`run.stopped`) THEN título SHALL ser `✅ <projeto> — concluído` (ou `⏹ <projeto> — interrompido` se `stopReason = aborted`)
2. WHEN uma run falha (`run.failed`) THEN título SHALL ser `❌ <projeto> — falhou`, prioridade `high`, corpo com o erro (máx. 200 chars)
3. WHEN uma aprovação fica pendente > 60s (`permission.required`) THEN título SHALL ser `🙋 <projeto> — precisa de você`, prioridade `high`, corpo com a ferramenta aguardando
4. WHEN o corpo é montado THEN SHALL conter `Fim HH:MM` no fuso configurado; com `startedAt` disponível SHALL ser `Início HH:MM · Fim HH:MM (<duração>)`; sessão em linha própria quando houver nome
5. WHEN `<projeto>` é resolvido THEN SHALL usar `custom_project_name` do projeto, senão `basename(project_path)`
6. WHEN o payload é enviado THEN `metadata` SHALL conter `{ event, project, projectPath, provider, sessionId, timestamp }`

### P3: Configurador

1. WHEN o usuário abre Settings > Notifications THEN SHALL ver o card "notify-hub" com URL, token (campo senha, nunca devolvido em claro — só `hasToken` + últimos 4), fuso e status "configurado / não configurado / origem env"
2. WHEN salva THEN `PUT /api/notifications/notify-hub` SHALL gravar em `app_config` (`notify_hub_url`, `notify_hub_token`, `notify_hub_timezone`); token vazio no PUT mantém o atual; URL SHALL ser http(s) válida; fuso SHALL ser IANA válido (`Intl` aceita)
3. WHEN não há valor em `app_config` THEN o servidor SHALL cair pra `NOTIFY_URL`/`NOTIFY_TOKEN`/`NOTIFY_TIMEZONE` do env (é assim que a instância do usuário nasce configurada)
4. WHEN clica "Testar" THEN `POST /api/notifications/notify-hub/test` SHALL enviar um push real com a config vigente e devolver `{ ok, status, error? }`; 401 do hub SHALL virar mensagem "token inválido"
5. WHEN o fuso está vazio na primeira abertura THEN o formulário SHALL pré-preencher com o fuso do navegador
6. WHEN a config muda THEN o próximo evento SHALL já usar a nova (leitura a cada envio, sem cache de processo)

---

## Edge Cases

- WHEN `notifyEnabled` liga num worktree-projeto THEN só sessões daquele path recebem (worktree é projeto próprio, AD-018)
- WHEN o `sessionId` do evento é id de provider e não da app THEN a resolução SHALL passar por `sessions.project_path` (fallback quando `meta.projectPath` falta)
- WHEN notify-hub responde não-2xx ou estoura 5s THEN log + swallow; sessão segue (HUB-09)
- WHEN o fuso gravado é inválido THEN formata no fuso do servidor e loga uma vez
- WHEN aprovação é resolvida antes de 60s THEN `cancelPendingPermissionWebhook` cancela como hoje
- WHEN `NOTIFY_URL` está no env mas nenhum projeto tem o sino ligado THEN nada é enviado — **mudança de comportamento** vs. hoje (era global); sem impacto real: env estava comentado em prod

---

## Traceability

| ID | Story | Status |
| --- | --- | --- |
| PNH-01 | P1.1 sino na linha do projeto | ✅ |
| PNH-02 | P1.2 toggle + rota + otimista | ✅ |
| PNH-03 | P1.3 `notifyEnabled` na lista | ✅ |
| PNH-04 | P1.4/P1.5 gate por projeto | ✅ |
| PNH-05 | P2.1–P2.3 títulos/prioridade | ✅ |
| PNH-06 | P2.4 horário/duração/fuso | ✅ |
| PNH-07 | P2.5/P2.6 nome do projeto + metadata | ✅ |
| PNH-08 | P3.1/P3.2 GET/PUT config + máscara | ✅ |
| PNH-09 | P3.3 fallback env | ✅ |
| PNH-10 | P3.4 teste de envio | ✅ |
| PNH-11 | P3.5/P3.6 fuso do navegador + hot config | ✅ |
| PNH-12 | Edge: falha nunca afeta sessão | ✅ |
| PNH-13 | Seed das credenciais do usuário (env prod+dev) | ✅ |
