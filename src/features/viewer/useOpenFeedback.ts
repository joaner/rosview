import { useCallback, useState } from 'react';
import { toast } from 'sonner';

/**
 * Shared "open a recording" feedback state: an error message and/or a
 * "here's how to open this manually" hint. Used by nearly every
 * open-a-source flow (drag-drop, remote URL, tar, history replay, SPA
 * bootstrap, the player itself) so it's a standalone hook rather than
 * bundled into any one of them.
 */
export function useOpenFeedback() {
  const [lastLoadError, setLastLoadError] = useState<string | null>(null);
  const [manualOpenHint, setManualOpenHint] = useState<string | null>(null);

  const clearOpenFeedback = useCallback(() => {
    setLastLoadError(null);
    setManualOpenHint(null);
  }, []);

  const showOpenError = useCallback((message: string) => {
    setLastLoadError(message);
    setManualOpenHint(null);
    toast.error(message);
  }, []);

  return {
    lastLoadError,
    manualOpenHint,
    setLastLoadError,
    setManualOpenHint,
    clearOpenFeedback,
    showOpenError,
  };
}
