import { useEffect, useRef, useState } from 'react';
import { callIpc } from 'utils/common/ipc';

export default function useAiImport(setErrorMessage) {
  const activeRequest = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const cancel = () => {
    const requestId = activeRequest.current;
    activeRequest.current = null;
    if (requestId) {
      callIpc('renderer:ai-import-cancel', { requestId }).catch(() => {});
    }
    setBusy(false);
  };

  useEffect(() => () => {
    const requestId = activeRequest.current;
    activeRequest.current = null;
    if (requestId) {
      callIpc('renderer:ai-import-cancel', { requestId }).catch(() => {});
    }
  }, []);

  const generate = async (url, providerId) => {
    if (activeRequest.current) return;
    const requestId = `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    activeRequest.current = requestId;
    setResult(null);
    setErrorMessage('');
    setBusy(true);
    try {
      const next = await callIpc('renderer:ai-import-openapi', { url, providerId, requestId });
      if (activeRequest.current === requestId) setResult(next);
    } catch (error) {
      if (activeRequest.current === requestId) {
        setErrorMessage(error.message || 'Could not generate the collection. Please try again.');
      }
    } finally {
      if (activeRequest.current === requestId) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  };

  const reset = () => {
    setResult(null);
    setErrorMessage('');
  };

  return { busy, result, generate, cancel, reset };
}
