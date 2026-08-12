import { PromptInputHeader } from '../../../../shared/view/ui';

import ImageAttachment from './ImageAttachment';
import FileAttachment from './FileAttachment';
import type { ChatComposerProps } from './composerTypes';

type ComposerAttachmentTrayProps = Pick<
  ChatComposerProps,
  'attachedImages' | 'onRemoveImage' | 'attachedFiles' | 'onRemoveFile' | 'uploadingImages' | 'imageErrors'
>;

/** Pending image/file attachments, shown above the textarea while any is staged. */
export default function ComposerAttachmentTray({
  attachedImages,
  onRemoveImage,
  attachedFiles,
  onRemoveFile,
  uploadingImages,
  imageErrors,
}: ComposerAttachmentTrayProps) {
  if (attachedImages.length === 0 && attachedFiles.length === 0) {
    return null;
  }

  return (
    <PromptInputHeader>
      <div className="rounded-card bg-[var(--hover-soft)] p-2">
        <div className="flex flex-wrap gap-2">
          {attachedImages.map((file, index) => (
            <ImageAttachment
              key={`image-${index}`}
              file={file}
              onRemove={() => onRemoveImage(index)}
              uploadProgress={uploadingImages.get(file.name)}
              error={imageErrors.get(file.name)}
            />
          ))}
          {attachedFiles.map((file, index) => (
            <FileAttachment
              key={`file-${index}`}
              file={file}
              onRemove={() => onRemoveFile(index)}
              error={imageErrors.get(file.name)}
            />
          ))}
        </div>
      </div>
    </PromptInputHeader>
  );
}
