/**
 * Attachments Hook - Image/File Attachment Management
 */

import { useState, useCallback } from 'react';
import type { ImageAttachment, ChatMessageContent } from '../types';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function useAttachments() {
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const addImage = useCallback((file: File): ImageAttachment | null => {
    // Validate file type
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError('Unsupported image format. Use JPEG, PNG, WebP, or GIF.');
      return null;
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setError(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
      return null;
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const previewUrl = URL.createObjectURL(file);

    const attachment: ImageAttachment = {
      id,
      file,
      previewUrl,
      mimeType: file.type,
      size: file.size,
      uploadedAt: new Date().toISOString(),
    };

    setAttachments((prev) => [...prev, attachment]);
    setError(null);
    return attachment;
  }, []);

  const removeImage = useCallback((id: string) => {
    setAttachments((prev) => {
      const attachment = prev.find((a) => a.id === id);
      if (attachment) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const clearAttachments = useCallback(() => {
    attachments.forEach((a) => URL.revokeObjectURL(a.previewUrl));
    setAttachments([]);
  }, [attachments]);

  const getAttachmentContent = useCallback((attachment: ImageAttachment): ChatMessageContent => {
    // Convert file to base64 data URL for API
    return {
      type: 'image_url',
      image_url: {
        url: attachment.previewUrl,
        detail: 'auto',
      },
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    attachments,
    error,
    addImage,
    removeImage,
    clearAttachments,
    getAttachmentContent,
    clearError,
  };
}