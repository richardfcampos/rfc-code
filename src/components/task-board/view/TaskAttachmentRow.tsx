import { useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../shared/view/ui';
import { authenticatedFetch } from '../../../utils/api';
import { formatFileSize, isImageMimeType } from '../utils/attachmentFormatting';
import { triggerBrowserDownload } from '../utils/downloadBlob';
import type { TaskAttachment } from '../types';

import TaskAttachmentImagePreview from './TaskAttachmentImagePreview';

type TaskAttachmentRowProps = {
  taskId: string;
  attachment: TaskAttachment;
  onDelete: (attachmentId: string) => Promise<void>;
};

export default function TaskAttachmentRow({ taskId, attachment, onDelete }: TaskAttachmentRowProps) {
  const { t } = useTranslation('taskBoard');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const downloadUrl = `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachment.attachment_id)}/download`;

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const response = await authenticatedFetch(downloadUrl);
      if (!response.ok) {
        throw new Error('Download failed');
      }
      const blob = await response.blob();
      triggerBrowserDownload(blob, attachment.file_name);
    } catch {
      window.alert(t('attachments.downloadFailed', { defaultValue: 'Failed to download attachment.' }));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(
      t('attachments.confirmDelete', { defaultValue: 'Delete this attachment?' }),
    );
    if (!confirmed) {
      return;
    }
    setIsDeleting(true);
    try {
      await onDelete(attachment.attachment_id);
    } catch {
      window.alert(t('attachments.deleteFailed', { defaultValue: 'Failed to delete attachment.' }));
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-ctl border border-border bg-card p-2">
      {isImageMimeType(attachment.mime_type) ? (
        <TaskAttachmentImagePreview downloadUrl={downloadUrl} fileName={attachment.file_name} />
      ) : null}

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={attachment.file_name}>
          {attachment.file_name}
        </p>
        <p className="text-xs text-muted-foreground">{formatFileSize(attachment.size_bytes)}</p>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void handleDownload()}
          disabled={isDownloading}
          title={t('attachments.download', { defaultValue: 'Download' })}
          aria-label={t('attachments.download', { defaultValue: 'Download' })}
          className="h-8 w-8"
        >
          <Download className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void handleDelete()}
          disabled={isDeleting}
          title={t('attachments.delete', { defaultValue: 'Delete' })}
          aria-label={t('attachments.delete', { defaultValue: 'Delete' })}
          className="h-8 w-8 text-muted-foreground hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
