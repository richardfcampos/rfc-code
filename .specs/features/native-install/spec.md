# Native Install — spec

**Status:** Specified 2026-07-30
**Supersedes:** AD-014 (deploy via Docker) — decisão do usuário 2026-07-30: o container restringe o filesystem ("só tem acesso aos diretórios do container"); o app deve rodar nativo, sempre ligado, iniciando com a máquina.

## Feature Boundary

Instalação nativa do RFC Code no macOS (primário) e Linux (opção), substituindo o deploy Docker. Serviço sempre rodando, auto-start, com acesso pleno ao filesystem, aos CLIs de agente já instalados no host e às credenciais reais do usuário.

## Requirements

| ID | Requirement |
| --- | --- |
| NAT-1 | Instalador único (`install/install.sh`) que builda o checkout e registra o serviço do SO — macOS: LaunchAgent (`~/Library/LaunchAgents`), Linux: systemd user unit + `loginctl enable-linger` |
| NAT-2 | Serviço inicia no login (Mac) / boot com linger (Linux) e reinicia sozinho em crash (`KeepAlive` / `Restart=on-failure`) |
| NAT-3 | Config em `~/.rfc-code/env` (arquivo de env carregado por wrapper); dados em `~/.rfc-code/data` (DB `db/auth.db`, perfis `profiles/`) |
| NAT-4 | Trusted mode com bind direto no IP tailnet exige novo contrato explícito `AUTH_TRUSTED_NATIVE_BIND=1`; o guard continua recusando qualquer bind não-loopback sem contrato, e o contrato nativo NÃO aceita `0.0.0.0` (interface específica obrigatória) |
| NAT-5 | Skills empacotadas e plugin caveman resolvem para o checkout/`~/.rfc-code` via envs já existentes (`BUNDLED_SKILLS_ROOT`, `CAVEMAN_PLUGIN_PATH`) — sem paths de imagem Docker |
| NAT-6 | Migração dos dados do container: DB + perfis (credenciais JSON, portáveis), com rewrite de `project_path` `/projects/...` → path real do host. Chromium do container NÃO migra (binário linux/arm64, inútil no Mac; re-download nativo) |
| NAT-7 | `deploy/` e `.github/workflows/docker.yml` removidos do repo (decisão do usuário; nativo é o único caminho suportado) |
| NAT-8 | Uninstall documentado e scriptado (`install/uninstall.sh`): para o serviço, remove plist/unit; dados preservados |
| NAT-9 | Acesso mantém `http://<host>:7789` no tailnet (M1: `http://m1:7789`) |

## Out of scope

- Homebrew formula / pacote assinado / notarização
- LaunchDaemon pré-login (rejeitado: sem keychain, volume externo não montado, FileVault bloqueia antes do login de qualquer forma)
- Auto-update do serviço (update = `git pull` + re-run install)

## Traceability

Decisões do usuário em `context.md`. Design em `design.md`. Tasks em `tasks.md`.
