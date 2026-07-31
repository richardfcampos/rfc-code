# Native Install — context (decisões do usuário)

**Gathered:** 2026-07-30

| # | Gray area | Decisão do usuário | Nota |
| --- | --- | --- | --- |
| 1 | Mecanismo de auto-start no macOS | **LaunchAgent no login** | "Ligar = rodar" via auto-login do macOS. LaunchDaemon rejeitado (sem sessão/keychain, volume externo pode não estar montado, FileVault segura o disco até o login). |
| 2 | Rede/auth no nativo | **Estender o guard: bind tailnet nativo** (`AUTH_TRUSTED_NATIVE_BIND=1`) | Mantém `http://m1:7789` sem login, perímetro = tailnet. Contrato nativo mais estrito que o do container: exige interface específica, recusa `0.0.0.0`. |
| 3 | Dados do container | **Migrar** DB + perfis de `/Volumes/External Code/Docker/rfc-code-data` | Mantém perfil "Pessoal" logado e histórico. `project_path` precisa de rewrite (`/projects/...` → path real). Chromium linux/arm64 não migra. |
| 4 | Destino do deploy Docker | **Remover `deploy/` do repo** | Contra a recomendação do agente (que era manter p/ intel) — decisão explícita do usuário. Implicação aceita: intel (macOS) migra pro instalador nativo quando voltar; o container que roda lá hoje segue até alguém rodar `docker compose down` no checkout antigo. |

Motivação da feature (verbatim do pedido): container "só tem acesso aos diretórios do container, deixa o aplicativo muito restrito, sem poder"; quer app "sempre rodando, que inicie quando o mac ligar", com "opção pra isso no linux tb".
