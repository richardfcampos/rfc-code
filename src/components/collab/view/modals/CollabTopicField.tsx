// The topic input, plus the skill menu a `/` opens over it.
//
// Split out of the create modal because the field carries its own textarea ref,
// menu state and keyboard handling — the modal only cares about the string.

import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useCollabSkillAutocomplete } from '../../hooks/use-collab-skill-autocomplete';

type CollabTopicFieldProps = {
  value: string;
  onChange: (next: string) => void;
  projectPath: string;
  /** Claude seats currently picked; their config dirs define what a `/` offers. */
  claudeProfileIds: readonly string[];
};

export default function CollabTopicField({
  value, onChange, projectPath, claudeProfileIds,
}: CollabTopicFieldProps) {
  const { t } = useTranslation('collab');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    suggestions, isOpen, activeIndex, error, seatCount, close, handleValueChange, handleKeyDown, select,
  } = useCollabSkillAutocomplete({
    projectPath,
    profileIds: claudeProfileIds,
    value,
    onChange,
    textareaRef,
  });

  return (
    <div className="relative">
      <label htmlFor="collab-topic" className="mb-2 block text-sm font-medium text-foreground">
        {t('form.topic', { defaultValue: 'Topic' })} *
      </label>
      <textarea
        id="collab-topic"
        ref={textareaRef}
        value={value}
        onChange={(event) => handleValueChange(event.target.value, event.target.selectionStart ?? event.target.value.length)}
        onKeyDown={(event) => {
          if (handleKeyDown(event)) {
            event.stopPropagation();
          }
        }}
        onBlur={close}
        rows={4}
        autoComplete="off"
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-blue-500 focus:ring-blue-500"
        placeholder={t('form.topicPlaceholder', {
          defaultValue: 'e.g. Should the sync layer move to a queue? Weigh the trade-offs for this repo.',
        })}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        {t('form.skillHint', {
          defaultValue: 'Type / to invoke a skill one of the selected Claude accounts has.',
        })}
      </p>

      {isOpen && (
        <div
          className="absolute left-0 right-0 z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-background shadow-lg"
          // Keeps the textarea's blur from closing the menu before the click lands.
          onMouseDown={(event) => event.preventDefault()}
        >
          {error && (
            <p className="px-3 py-2 text-xs text-red-600 dark:text-red-300">
              {t('form.skillLoadFailed', {
                defaultValue: 'Skills could not be loaded for the selected accounts.',
              })}
            </p>
          )}
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.command}
              type="button"
              onClick={() => select(suggestion)}
              className={`flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left ${
                index === activeIndex ? 'bg-accent' : 'hover:bg-accent/60'
              }`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-mono text-sm text-foreground">{suggestion.command}</span>
                {suggestion.availableTo < seatCount && (
                  <span className="shrink-0 text-[11px] text-amber-600 dark:text-amber-400">
                    {t('form.skillPartial', {
                      available: suggestion.availableTo,
                      total: seatCount,
                      defaultValue: '{{available}} of {{total}} accounts',
                    })}
                  </span>
                )}
              </span>
              {suggestion.description && (
                <span className="line-clamp-2 text-xs text-muted-foreground">{suggestion.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
