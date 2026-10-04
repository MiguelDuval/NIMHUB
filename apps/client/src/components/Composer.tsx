import { useRef, useCallback } from 'react';
import type { ImageAttachment } from '../types';

interface ComposerProps {
  inputMessage: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onAddImage: (file: File) => void;
  onAbort: () => void;
  attachments: ImageAttachment[];
  onRemoveAttachment: (id: string) => void;
  disabled: boolean;
  streaming: boolean;
  canSend: boolean;
  visionEnabled: boolean;
  placeholder?: string;
}

export function Composer({
  inputMessage,
  onInputChange,
  onSend,
  onAddImage,
  onAbort,
  attachments,
  onRemoveAttachment,
  disabled,
  streaming,
  canSend,
  visionEnabled,
  placeholder = 'Ask NIM Hub anything…',
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (canSend) onSend();
      }
    },
    [canSend, onSend]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onAddImage(file);
      }
      e.target.value = '';
    },
    [onAddImage]
  );

  return (
    <div className="composer">
      <div className="composer-input-wrapper">
        <button
          className="attach-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || streaming || !visionEnabled}
          title={visionEnabled ? 'Attach image' : 'Selected model does not support image input'}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </button>
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <textarea
          ref={textareaRef}
          value={inputMessage}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled || streaming}
          className="composer-textarea"
        ></textarea>
      </div>

      {attachments.length > 0 && (
        <div className="attachments-preview-inline">
          {attachments.map((att) => (
            <div key={att.id} className="attachment-item-inline">
              <img src={att.previewUrl} alt="Attachment" />
              <button
                className="remove-attachment"
                onClick={() => onRemoveAttachment(att.id)}
                aria-label="Remove attachment"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="composer-actions">
        <div className="composer-hints">
          <span>Enter to send</span>
          <span>Shift+Enter for new line</span>
          {visionEnabled && <span className="vision-hint">👁️ Vision enabled</span>}
        </div>
        <div className="composer-buttons">
          {streaming && (
            <button className="btn-abort" onClick={onAbort} title="Cancel">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
              Cancel
            </button>
          )}
          <button className="btn-primary" onClick={onSend} disabled={!canSend}>
            {streaming ? 'Streaming…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}