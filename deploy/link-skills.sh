#!/bin/sh
# Linka as skills espalhadas pelo disco no config dir default do Claude Code
# (~/.claude/skills), que é persistido em ${DATA_ROOT}/default/claude e portanto
# sobrevive a `docker compose up -d --build`.
#
# Duas fontes:
#   1. /host-claude  — o ~/.claude do Mac montado read-only (docker-compose.override.yml).
#      É onde vivem as skills globais e as dos plugins (ck:*/ClaudeKit). Só existe
#      depois de recriar o container com o override.
#   2. /projects     — skills versionadas dentro dos repos (.claude/skills, .ai/skills…).
#
# Idempotente: symlink já existente e válido é mantido; dangling é refeito.
# Skill sem frontmatter YAML (`name:` + `description:`) é pulada — o Claude Code
# não carrega arquivo sem isso, então linká-la só criaria ruído silencioso.
#
# Uso:  sh deploy/link-skills.sh [--dry-run]
set -u

DEST="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# Raízes varridas em ordem de prioridade: a primeira ocorrência de um `name:`
# vence, as demais são reportadas como dup. As do host vêm primeiro porque são
# a cópia que o usuário mantém de fato.
ROOTS='
/host-claude/skills
/host-claude/plugins
/projects/ai/skills/skills
/projects/jetsales/jetsales-ai-first/.claude/skills
/projects/jetsales/jetsales-ai-first/agents/data-team/skills
/projects/jetsales/jetsales-ai-first/agents/pi-team/skills
/projects/rAIcruited/raicruited-beta/.claude/skills
/projects/gdcgroup/wordpress/bookies copy 2/.claude/skills
/projects/gdcgroup/oddsjam/fetcher/.ai/skills
/projects/barbersystem/knowledge-base/.claude/skills/gitnexus
'

mkdir -p "$DEST"
linked=0; dup=0; bad=0

echo "$ROOTS" | while IFS= read -r root; do
  [ -z "$root" ] && continue
  [ -d "$root" ] || { echo "-- ausente (pulando): $root"; continue; }

  # Worktrees e node_modules replicam as mesmas skills dezenas de vezes; sem o
  # prune o dedup por nome funcionaria, mas a varredura ficaria ordens de
  # grandeza mais lenta e a origem escolhida viraria loteria.
  find "$root" \( -name node_modules -o -name worktrees -o -name .git \) -prune -o \
       -name SKILL.md -print 2>/dev/null | sort | while IFS= read -r f; do
    d=$(dirname "$f")
    name=$(sed -n 's/^name:[[:space:]]*//p' "$f" | head -1 | tr -d '"'"'" | sed 's/[[:space:]]*$//')
    desc=$(sed -n '/^description:/p' "$f" | head -1)

    if [ -z "$name" ] || [ -z "$desc" ]; then
      echo "SKIP sem-frontmatter  $d"; bad=$((bad+1)); continue
    fi
    # `ck:ck-help` e afins: `/` e `:` não sobrevivem a um nome de diretório.
    link_name=$(printf '%s' "$name" | tr '/:' '--')

    if [ -L "$DEST/$link_name" ]; then
      cur=$(readlink "$DEST/$link_name")
      [ "$cur" = "$d" ] && continue                    # já linkada para cá
      if [ -e "$DEST/$link_name" ]; then
        echo "SKIP dup             $name  (mantido: $cur)"; dup=$((dup+1)); continue
      fi
      [ "$DRY" = 1 ] || rm -f "$DEST/$link_name"       # dangling: refaz
    elif [ -e "$DEST/$link_name" ]; then
      echo "SKIP dir-real        $name  ($DEST/$link_name não é symlink)"; dup=$((dup+1)); continue
    fi

    if [ "$DRY" = 1 ]; then
      echo "DRY  $link_name -> $d"
    else
      ln -s "$d" "$DEST/$link_name" && echo "OK   $link_name -> $d"
    fi
    linked=$((linked+1))
  done
done

echo
echo "Total em $DEST: $(ls -1 "$DEST" 2>/dev/null | wc -l | tr -d ' ') skills"
echo "Reinicie a sessão do Claude Code para que sejam carregadas."
