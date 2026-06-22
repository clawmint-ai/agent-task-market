import { useEffect, useRef, useState } from 'react';
import type { Task } from './types';

// EventSource cannot send Authorization headers, so the key rides as a query
// param. The market's /events accepts the API key; ?type filters by task type.
export function useTaskStream(apiKey: string | null, onNew: (t: Task) => void) {
  const [live, setLive] = useState(false);
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    if (!apiKey) return;
    let es: EventSource | null = null;
    let stopped = false;
    try {
      es = new EventSource(`/api/v1/events?api_key=${encodeURIComponent(apiKey)}`);
      es.onopen = () => !stopped && setLive(true);
      es.onerror = () => setLive(false); // browser auto-reconnects
      es.addEventListener('task.new', (ev) => {
        try { cb.current(JSON.parse((ev as MessageEvent).data) as Task); } catch { /* ignore */ }
      });
    } catch { setLive(false); }
    return () => { stopped = true; es?.close(); };
  }, [apiKey]);
  return live;
}
