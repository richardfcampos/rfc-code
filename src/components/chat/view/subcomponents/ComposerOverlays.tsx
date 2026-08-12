import type { ChatComposerProps } from './composerTypes';

type ComposerFileMentionsProps = Pick<
  ChatComposerProps,
  'showFileDropdown' | 'filteredFiles' | 'selectedFileIndex' | 'onSelectFile'
>;

/**
 * `@`-mention file picker, floated above the composer. Rendered outside the
 * PromptInput so it can overflow the composer's rounded shell.
 */
export function ComposerFileMentions({
  showFileDropdown,
  filteredFiles,
  selectedFileIndex,
  onSelectFile,
}: ComposerFileMentionsProps) {
  if (!showFileDropdown || filteredFiles.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-full left-0 right-0 z-50 mb-2 max-h-48 overflow-y-auto rounded-card border border-border bg-popover shadow-[var(--shadow-pop)]">
      {filteredFiles.map((file, index) => (
        <div
          key={file.path}
          className={`cursor-pointer touch-manipulation border-b border-border px-4 py-3 transition-colors duration-150 ease-out last:border-b-0 ${
            index === selectedFileIndex
              ? 'bg-[var(--accent-tint)] text-primary'
              : 'text-foreground hover:bg-[var(--hover)]'
          }`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectFile(file);
          }}
        >
          <div className="text-[13px] font-medium">{file.name}</div>
          <div className="font-mono text-[10px] tracking-wide text-muted-foreground">{file.path}</div>
        </div>
      ))}
    </div>
  );
}

/** Drop-target wash shown while files are dragged over the composer. */
export function ComposerDropOverlay({ isDragActive }: Pick<ChatComposerProps, 'isDragActive'>) {
  if (!isDragActive) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-composer border border-dashed border-[var(--accent-line)] bg-[var(--accent-tint)]">
      <div className="rounded-card border border-border bg-card p-4 shadow-[var(--shadow-pop)]">
        <svg className="mx-auto mb-2 h-8 w-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-[13px] font-medium text-foreground">Drop files here</p>
      </div>
    </div>
  );
}
