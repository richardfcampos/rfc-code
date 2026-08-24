import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Paperclip, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../lib/utils';
import { Button } from '../../../shared/view/ui';
import { validateAttachmentSize } from '../utils/attachmentFormatting';
import type { TaskAttachment } from '../types';

import TaskAttachmentRow from './TaskAttachmentRow';

type TaskDetailAttachmentsProps = {
  taskId: string;
  attachments: TaskAttachment[];
  onUpload: (file: File) => Promise<void>;
  onDelete: (attachmentId: string) => Promise<void>;
};

export default function TaskDetailAttachments({ taskId, attachments, onUpload, onDelete }: TaskDetailAttachmentsProps) {
  const { t } = useTranslation('taskBoard');
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    const validation = validateAttachmentSize(file.size, file.name);
    if (!validation.ok) {
      setUploadError(validation.reason);
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      await onUpload(file);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      void upload(file);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void upload(file);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Paperclip className="h-4 w-4" />
          {t('attachments.title', { defaultValue: 'Attachments' })}
        </h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          <Upload className="h-3.5 w-3.5" />
          {t('attachments.upload', { defaultValue: 'Upload' })}
        </Button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInputChange} />
      </div>

      {/* Drop target wraps the whole list — trivial single-file drop, no folder support
          (mirrors the instruction to keep drag-drop simple, unlike the full recursive
          file-tree uploader). */}
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={cn(
          'space-y-2 rounded-card border border-dashed border-border p-2 transition-colors',
          isDragOver && 'border-primary bg-primary/5',
        )}
      >
        {uploadError && <p className="text-xs text-danger">{uploadError}</p>}
        {isUploading && (
          <p className="text-xs text-muted-foreground">{t('attachments.uploading', { defaultValue: 'Uploading…' })}</p>
        )}
        {attachments.length === 0 ? (
          <p className="px-1 py-3 text-center text-xs text-muted-foreground">
            {t('attachments.empty', { defaultValue: 'No attachments yet — drop a file here or use Upload.' })}
          </p>
        ) : (
          attachments.map((attachment) => (
            <TaskAttachmentRow
              key={attachment.attachment_id}
              taskId={taskId}
              attachment={attachment}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </section>
  );
}
