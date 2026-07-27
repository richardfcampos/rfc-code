import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Collapses long user turns behind a toggle.
 *
 * Invoking a skill sends its whole SKILL.md as the user turn — the CLI expands
 * it before the app ever sees it — so a one-word command can render as several
 * screens of instructions and push the actual conversation out of view. The
 * same applies to any large paste.
 *
 * Short turns are rendered untouched: collapsing them would add a control that
 * hides nothing.
 */

/** Preamble the CLI prepends when a skill is expanded into the turn. */
const SKILL_PREAMBLE = /^Base directory for this skill:\s*(.+)$/m;

/**
 * Thresholds above which a turn is collapsed. Chosen so a normal multi-line
 * message still shows in full, while an expanded skill (dozens of lines) does
 * not — a limit low enough to catch a paragraph would collapse ordinary use.
 */
const MAX_VISIBLE_LINES = 14;
const MAX_VISIBLE_CHARS = 1200;

type SkillInfo = { name: string; path: string } | null;

/** Reads the skill name out of the preamble path, if this is a skill turn. */
function detectSkill(content: string): SkillInfo {
  const match = content.match(SKILL_PREAMBLE);
  if (!match) {
    return null;
  }
  const skillPath = match[1].trim();
  const name = skillPath.split('/').filter(Boolean).pop() ?? skillPath;
  return { name, path: skillPath };
}

export default function CollapsibleUserContent({ content }: { content: string }) {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(false);

  const skill = useMemo(() => detectSkill(content), [content]);
  const isLong = useMemo(() => (
    content.length > MAX_VISIBLE_CHARS || content.split('\n').length > MAX_VISIBLE_LINES
  ), [content]);

  if (!isLong) {
    return (
      <div dir="auto" className="whitespace-pre-wrap break-words font-serif text-sm">
        {content}
      </div>
    );
  }

  const lineCount = content.split('\n').length;

  return (
    <div className="flex flex-col gap-1.5">
      {skill && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-blue-100">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="truncate">
            {t('userMessage.skillInvoked', {
              name: skill.name,
              defaultValue: 'Skill: {{name}}',
            })}
          </span>
        </div>
      )}

      <div className="relative">
        <div
          dir="auto"
          className={`whitespace-pre-wrap break-words font-serif text-sm ${
            isExpanded ? '' : 'max-h-40 overflow-hidden'
          }`}
        >
          {content}
        </div>
        {!isExpanded && (
          // Fades the clipped text into the bubble so the cut does not read as
          // the message ending mid-sentence.
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-blue-600"
          />
        )}
      </div>

      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        className="flex items-center gap-1 self-start rounded px-1 py-0.5 text-xs text-blue-100 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {isExpanded ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" />
            {t('userMessage.showLess', { defaultValue: 'Show less' })}
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" />
            {t('userMessage.showAll', {
              count: lineCount,
              defaultValue: 'Show all {{count}} lines',
            })}
          </>
        )}
      </button>
    </div>
  );
}
