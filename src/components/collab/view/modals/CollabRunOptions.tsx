// Mode and round-count controls for a new collaboration. Both answer "how does
// this run execute", and both are rendered as large tap targets because the app
// is driven from a tablet.

import { useTranslation } from 'react-i18next';

import { COLLAB_MODES, MAX_ROUNDS, type CollabMode } from '../../types';

const ROUND_OPTIONS = Array.from({ length: MAX_ROUNDS }, (_, index) => index + 1);

const MODE_HINTS: Record<CollabMode, string> = {
  debate: 'Both accounts see the whole transcript and argue until they agree.',
  review: 'One account writes, the other critiques — exactly two participants.',
  vote: 'Everyone answers the same question blind; a single round, then a verdict.',
  council: 'Every answer must state its evidence, risks, tests and confidence; the run ends with a summary of what was agreed and what is still disputed.',
};

type CollabRunOptionsProps = {
  mode: CollabMode;
  maxRounds: number;
  onModeChange: (mode: CollabMode) => void;
  onMaxRoundsChange: (maxRounds: number) => void;
};

export default function CollabRunOptions({
  mode, maxRounds, onModeChange, onMaxRoundsChange,
}: CollabRunOptionsProps) {
  const { t } = useTranslation('collab');

  return (
    <>
      <div>
        <span className="mb-2 block text-sm font-medium text-foreground">
          {t('form.mode', { defaultValue: 'Mode' })}
        </span>
        <div className="space-y-2">
          {COLLAB_MODES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onModeChange(option)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                mode === option
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-border bg-card/50 hover:bg-muted'
              }`}
            >
              <span className="block text-sm font-medium capitalize text-foreground">{option}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(`form.modeHint.${option}`, { defaultValue: MODE_HINTS[option] })}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-sm font-medium text-foreground">
          {t('form.rounds', { defaultValue: 'Max rounds' })}
        </span>
        <div className="flex gap-2">
          {ROUND_OPTIONS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onMaxRoundsChange(value)}
              disabled={mode === 'vote'}
              className={`min-h-[44px] flex-1 rounded-lg border text-sm font-medium transition-colors disabled:opacity-40 ${
                maxRounds === value
                  ? 'border-blue-500 bg-blue-600 text-white'
                  : 'border-border bg-card/50 text-foreground hover:bg-muted'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        {mode === 'vote' && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {t('form.voteSingleRound', { defaultValue: 'Vote mode always runs a single round.' })}
          </p>
        )}
      </div>
    </>
  );
}
