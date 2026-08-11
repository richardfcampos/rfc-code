import { FileTextIcon } from 'lucide-react';

interface FileAttachmentProps {
  file: File;
  onRemove: () => void;
  error?: string;
}

const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
};

const FileAttachment = ({ file, onRemove, error }: FileAttachmentProps) => {
  return (
    <div className="group relative flex h-20 w-40 flex-col justify-between overflow-hidden rounded-card border border-border bg-card p-2.5">
      <div className="flex items-start gap-2">
        <FileTextIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="line-clamp-2 break-all font-mono text-[11px] font-medium leading-snug tracking-wide text-foreground" title={file.name}>
          {file.name}
        </span>
      </div>
      <span className="font-mono text-[10px] tracking-wide text-faint">
        {error ?? formatFileSize(file.size)}
      </span>
      {error && <div className="absolute inset-0 rounded-card border border-[var(--danger-line)]" />}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-1 text-muted-foreground shadow-[var(--shadow-pop)] transition-opacity duration-150 ease-out hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove file"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default FileAttachment;
