import { useEffect, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';

type TaskAttachmentImagePreviewProps = {
  downloadUrl: string;
  fileName: string;
};

/**
 * Inline thumbnail for image attachments. The download route sits behind
 * `authenticateToken`, so a plain `<img src>` can't hit it directly — same
 * blob + object URL pattern as `file-tree/view/ImageViewer.tsx`.
 */
export default function TaskAttachmentImagePreview({ downloadUrl, fileName }: TaskAttachmentImagePreviewProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    const controller = new AbortController();
    setImageUrl(null);
    setFailed(false);

    authenticatedFetch(downloadUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setFailed(true);
      });

    return () => {
      controller.abort();
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [downloadUrl]);

  if (failed) {
    return null;
  }

  if (!imageUrl) {
    return <div className="h-16 w-16 flex-shrink-0 animate-pulse rounded-ctl bg-muted" aria-hidden />;
  }

  return (
    <img
      src={imageUrl}
      alt={fileName}
      className="h-16 w-16 flex-shrink-0 rounded-ctl border border-border object-cover"
    />
  );
}
