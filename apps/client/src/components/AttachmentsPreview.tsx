import type { ImageAttachment } from '../types';

interface AttachmentsPreviewProps {
  attachments: ImageAttachment[];
  onRemove: (id: string) => void;
}

export function AttachmentsPreview({ attachments, onRemove }: AttachmentsPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="attachments-preview">
      {attachments.map((att) => (
        <div key={att.id} className="attachment-item">
          <img src={att.previewUrl} alt="Attachment" />
          <button
            className="remove-attachment"
            onClick={() => onRemove(att.id)}
            aria-label="Remove attachment"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}