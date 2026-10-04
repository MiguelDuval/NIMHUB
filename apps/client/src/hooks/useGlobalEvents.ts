import { useEffect } from 'react';
import { useAttachments } from './useAttachments';

/**
 * Hook to handle global events for file input and send
 * This allows the Composer component to trigger file selection
 */
export function useGlobalEvents() {
  const { addImage } = useAttachments();

  useEffect(() => {
    const handleAddImage = (e: CustomEvent<File>) => {
      addImage(e.detail);
    };

    window.addEventListener('nimhub:add-image', handleAddImage as EventListener);

    return () => {
      window.removeEventListener('nimhub:add-image', handleAddImage as EventListener);
    };
  }, [addImage]);
}