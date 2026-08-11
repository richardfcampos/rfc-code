import { useEffect, useState } from 'react';

interface ImageAttachmentProps {
  file: File;
  onRemove: () => void;
  uploadProgress?: number;
  error?: string;
}

const ImageAttachment = ({ file, onRemove, uploadProgress, error }: ImageAttachmentProps) => {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  
  return (
    <div className="group relative">
      <div className="overflow-hidden rounded-card border border-border">
        <img src={preview} alt={file.name} className="h-20 w-20 object-cover" />
      </div>
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <div className="absolute inset-0 flex items-center justify-center rounded-card bg-[var(--scrim)]">
          <div className="font-mono text-[11px] tracking-wide text-foreground">{uploadProgress}%</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center rounded-card border border-[var(--danger-line)] bg-[var(--danger-tint)]">
          <svg className="h-6 w-6 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 rounded-full border border-border bg-card p-1 text-muted-foreground shadow-[var(--shadow-pop)] transition-opacity duration-150 ease-out hover:text-foreground focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove image"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export default ImageAttachment;


