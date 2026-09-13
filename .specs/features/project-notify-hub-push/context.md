# Context — Project Notify-Hub Push

Sessão autônoma (usuário ausente). Áreas cinza decididas pelo orquestrador e registradas aqui; qualquer uma pode ser revertida no UAT.

| # | Área cinza | Decisão | Motivo |
| --- | --- | --- | --- |
| 1 | Onde fica o botão | Sino na `SidebarProjectMenuRow`, ao lado da estrela, sempre visível (não hover-only) | "Por projeto" = mesmo lugar da única flag por projeto que já existe; tablet-first (AD-004) exige visível sem hover |
| 2 | Escopo da flag | Coluna `projects.notifyEnabled` (global por projeto), não por usuário | Espelha `isStarred`; app é single-operator (AD-002) |
| 3 | Onde guardar URL/token | `app_config` (chave-valor já usado pro JWT secret), com fallback env | Configurador sem restart; env continua sendo o jeito de semear sem pôr segredo no repo |
| 4 | Como "já sair configurado" | Semear `NOTIFY_URL/NOTIFY_TOKEN/NOTIFY_TIMEZONE` em `~/.rfc-code/env` e `~/.rfc-code-dev/env` | Segredo fora do git; DB vazio cai no env; UI mostra "origem: env" |
| 5 | Idioma do texto | PT-BR fixo, mesmo formato do `notify-hook.mjs` do notify-hub | Usuário já recebe esse formato no celular; servidor não sabe idioma do usuário. Débito p/ i18n futura |
| 6 | Fuso | `notify_hub_timezone` (IANA); UI pré-preenche com fuso do navegador; seed `America/Sao_Paulo` | Servidor roda em UTC; horário no push precisa ser o do usuário |
| 7 | Semântica com env setado e nenhum projeto ligado | Não envia | Flag por projeto é o opt-in; antes era global. Sem regressão real: env estava comentado |
| 8 | Duração | `startedAt` opcional passado pelos providers | Barato e o hook já mostra; ausente → só `Fim HH:MM` |
| 9 | Tokens do usuário | Ler de `/srv/code/personal/notify-hub/.env` (`TOKENS=name:token:canais`), validar com `GET /channels` antes de semear | Evita semear token rotacionado no painel |
| 10 | Commit | Nada commita antes do UAT | Padrão do projeto (STATE.md) |
