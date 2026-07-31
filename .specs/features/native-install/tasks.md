# Native Install — tasks

**Status:** EXECUTE — OK do usuário 2026-07-30. Orquestração AD-012: Fable coordena; workers Opus (N1/N3/N5), Sonnet (N2/N4/N6).

| Task | Estado |
| --- | --- |
| N1 | DONE (Opus) — contrato nativo em auth.js:41-84; 256/256 testes; nativo vence com os dois contratos setados. Nota: hostname (MagicDNS) passa no guard — aceito, wildcard é o que importa |
| N3 | DONE (Opus) — install.sh bash3.2-safe, dry-run exit 0; env single-quoted (paths com espaço!), wildcard rejeitado, porta ocupada aborta antes de mutar. Achado do probe: `opencode` AUSENTE no host — avisar usuário. uninstall.sh referenciado já existe (N4) |
| N4 | DONE (Sonnet) — uninstall idempotente, dry-run + execução real contra HOME fake; preserva env/data/caveman. Consistência conferida: wrapper extensionless `run/rfc-code-server` nos dois lados (prompt do N3 já fixa o mesmo path) |
| N5 | DONE (Opus) — migrate testado contra fixture: rewrite com prefix-match (não LIKE), VACUUM INTO, fk_check, links de skills reparados, caveman path reescrito em installed_plugins.json. Nota N6: mensagens citam deploy/ — conferir na remoção |
| — | EXECUÇÃO REAL (orquestrador): commit → merge no checkout principal → docker down → migrate → install → verificação |
| N2 | DONE (Sonnet) — 4 templates em install/templates/; plutil OK, sh -n OK; shellcheck ausente na máquina. Nota p/ N3: gravar CAVEMAN_PLUGIN_PATH explicitamente no env (default do código é path Docker) |
| N3–N8 | pendentes |

| # | Task | Depende | Done when | Verificação |
| --- | --- | --- | --- | --- |
| N1 | Guard `AUTH_TRUSTED_NATIVE_BIND` em `server/middleware/auth.js` | — | contrato nativo aceita IP específico, recusa `0.0.0.0`/`::`; sem contrato = comportamento atual byte a byte | testes novos no padrão dos existentes do guard; suíte completa verde |
| N2 | `install/templates/` (plist + unit) e geração do wrapper + `~/.rfc-code/env` | — | wrapper sources env, compõe PATH, exec node | shellcheck; execução manual do wrapper fora do serviço |
| N3 | `install/install.sh` (detecta SO, build, caveman pinado, rtk, registro do serviço, health check) | N1, N2 | rodar no M1 → serviço ativo, `/health` 200 em `http://m1:7789` | install real no M1 (Execute inclui UAT) |
| N4 | `install/uninstall.sh` | N2 | serviço some do launchctl/systemctl; `~/.rfc-code/data` intacto | install → uninstall → reinstall no M1 |
| N5 | `install/migrate-from-docker.sh` (DB+perfis, rewrite `/projects`) | N3 | perfil "Pessoal" autenticado no nativo; sessões antigas abrem com paths reais | conferir `sessions.project_path` no SQLite pós-migração; abrir sessão antiga na UI |
| N6 | Remover `deploy/` + `.github/workflows/docker.yml`; README aponta `install/` | N3 validado | repo sem referência a deploy Docker | grep por `deploy/` em docs/CI |
| N7 | STATE.md: AD-015 (nativo supersede AD-014), heartbeat | N6 | registrado | — |
| N8 | UAT: reboot do Mac → login → serviço volta sozinho; crash kill -9 → KeepAlive ressuscita | N3, N5 | os dois cenários passam | usuário confirma |

Ordem: N1+N2 paralelos → N3 → N4/N5 → N6 → N7 → N8.
Container atual (`rfc-code` na 7789) só é derrubado no N3, com aviso, após backup do data-root pro N5.
