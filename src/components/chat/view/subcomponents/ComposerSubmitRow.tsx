import type { MouseEvent } from 'react';
import { Loader2, ArrowUpIcon } from 'lucide-react';

import { PromptInputSubmit } from '../../../../shared/view/ui';

type ComposerSubmitRowProps = {
  submitHint: string;
  submitAriaLabel: string;
  /** True while the textarea holds trimmed text. */
  hasText: boolean;
  canQueueDraft: boolean;
  isLoading: boolean;
  isRecording: boolean;
  isTranscribing: boolean;
  onSubmit: (event: MouseEvent<HTMLButtonElement>) => void;
  onAbortSession: () => void;
  onStopRecordingAndSend: () => void;
};

/** Send hint plus the one solid action in the composer footer. */
export default function ComposerSubmitRow({
  submitHint,
  submitAriaLabel,
  hasText,
  canQueueDraft,
  isLoading,
  isRecording,
  isTranscribing,
  onSubmit,
  onAbortSession,
  onStopRecordingAndSend,
}: ComposerSubmitRowProps) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2">
      {/* The hint is the first thing to give up room: it truncates rather than
          pushing into the chip row, which scrolls on its own side. The
          breakpoint is the viewport, not the composer, so a narrowed chat
          column still shows it — acceptable because the chip row scrolls
          instead of colliding. */}
      <div
        className={`hidden max-w-[22rem] truncate text-[11px] text-faint transition-opacity duration-150 ease-out lg:block ${
          hasText && !canQueueDraft ? 'opacity-0' : 'opacity-100'
        }`}
        title={submitHint}
      >
        {submitHint}
      </div>
      <PromptInputSubmit
        onClick={
          canQueueDraft
            ? (event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                onSubmit(event);
              }
            : isLoading
              ? onAbortSession
              : isRecording
                ? (event: MouseEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    onStopRecordingAndSend();
                  }
                : undefined
        }
        disabled={isLoading ? false : isRecording ? false : isTranscribing ? true : !hasText}
        aria-label={submitAriaLabel}
        title={submitAriaLabel}
        className="h-11 w-11 rounded-full sm:h-8 sm:w-8"
      >
        {isTranscribing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : canQueueDraft ? (
          <ArrowUpIcon className="h-4 w-4" />
        ) : undefined}
      </PromptInputSubmit>
    </div>
  );
}
