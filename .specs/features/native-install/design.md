# Native Install — design

## Layout no host

```
<checkout git>                     # código; build roda aqui (installMode 'git' já detectado por server/index.js:77)
~/.rfc-code/
├── env                            # config do serviço (KEY=VALUE), fonte única
├── run/rfc-code-server            # wrapper gerado pelo instalador
├── data/
│   ├── db/auth.db                 # DATABASE_PATH
│   └── profiles/<provider>/<slug> # PROFILES_ROOT
├── caveman-plugin/                # clone pinado (mesmo SHA que o Dockerfile usava) → CAVEMAN_PLUGIN_PATH
└── logs/{stdout,stderr}.log
```

Skills empacotadas: `BUNDLED_SKILLS_ROOT=<checkout>/skills` — sem cópia; o link-por-perfil e o non-clobber já existem (`server/modules/bundled-skills/`). No nativo, o config dir default é o `~/.claude` REAL do usuário: `ensureDefaultConfigDirSkills()` adiciona links do bundle lá, mas nunca substitui dir real nem link do usuário (testado). Opt-out documentado: `BUNDLED_SKILLS_ROOT=/nonexistent` no env.

## Wrapper (por quê)

launchd/systemd não carregam o shell do usuário: PATH mínimo, sem `~/.rfc-code/env`. O plist/unit executa `~/.rfc-code/run/rfc-code-server`, que:
1. `set -a; . ~/.rfc-code/env; set +a`
2. compõe PATH: dirs de `node`, `claude`, `codex`, `cursor-agent`, `opencode`, `rtk` detectados no install e gravados no env
3. `exec node <checkout>/dist-server/server/index.js`

Mesmo wrapper nos dois SOs — plist e unit ficam triviais e a config vive num lugar só (NAT-3).

## Serviço

**macOS** — `~/Library/LaunchAgents/ai.rfc-code.server.plist`: `RunAtLoad=true`, `KeepAlive=true`, `StandardOut/ErrorPath` → `~/.rfc-code/logs/`. Registro via `launchctl bootstrap gui/$UID` (moderno; `load` é legado). Auto-login do macOS = "inicia quando liga" (documentado no README do install; é ajuste manual do usuário em Ajustes > Usuários).

**Linux** — `~/.config/systemd/user/rfc-code.service`: `ExecStart=%h/.rfc-code/run/rfc-code-server`, `Restart=on-failure`, `WantedBy=default.target`; instalador roda `systemctl --user enable --now` + `loginctl enable-linger $USER` (linger = sobe no boot sem sessão aberta).

## Guard de bind (NAT-4)

`server/middleware/auth.js` — `assertTrustedModeBindIsSafe` ganha o contrato nativo:

| Contrato | Aceita | Recusa |
| --- | --- | --- |
| (nenhum) | loopback | resto (comportamento atual intacto) |
| `AUTH_TRUSTED_CONTAINER_BIND=1` (existente) | `0.0.0.0` dentro de container | — |
| `AUTH_TRUSTED_NATIVE_BIND=1` (novo) | IP específico não-loopback (ex.: `100.122.109.36`) | `0.0.0.0`, `::` — wildcard nativo exporia LAN |

## Instalador (`install/`)

```
install/
├── install.sh      # detecta SO → build → gera env+wrapper → registra serviço → health check
├── uninstall.sh    # para serviço, remove plist/unit e wrapper; dados intactos (NAT-8)
├── migrate-from-docker.sh   # NAT-6, opcional, roda uma vez
└── templates/{ai.rfc-code.server.plist,rfc-code.service}
```

`install.sh`: pergunta/aceita flags `--workspaces-root`, `--bind`, `--port` (defaults: `$HOME`, loopback, 7789 — trusted+tailnet só se `--bind <ip-tailnet>`, aí grava `AUTH_TRUSTED_NATIVE_BIND=1`); `npm ci && npm run build`; clona caveman pinado; instala rtk (Mac: usa o do host se existir; Linux: release GitHub com checksum, mesma lógica do Dockerfile); registra serviço; `curl /health` até 200.

## Migração (NAT-6)

`migrate-from-docker.sh --data-root <path> --projects-map "/projects=<real>"`:
1. serviço parado; copia `db/auth.db` e `profiles/` → `~/.rfc-code/data/`
2. rewrite no SQLite: `sessions.project_path`, `sessions.jsonl_path`, `projects.project_path` — prefixo `/projects` → path real (M1: `/Volumes/External Code/M1/Code`)
3. NÃO copia `default/playwright` (linux/arm64) nem `default/claude` (estado de conta do container; o nativo usa o `~/.claude` real)

## Remoções (NAT-7)

`deploy/` inteiro + `.github/workflows/docker.yml`. README: seção de deploy aponta pro `install/`.

## Riscos

- `ensureDefaultConfigDirSkills` no `~/.claude` real: mitigado pelo non-clobber; opt-out documentado
- PATH incompleto no wrapper → CLI "não encontrado" só em runtime: install faz probe de cada CLI e avisa na hora
- Porta 7789 ocupada pelo container ainda rodando: install checa e instrui `docker compose down` antes
- Node do host ≠ Node da imagem: `.nvmrc` existe; install valida versão mínima e falha cedo
