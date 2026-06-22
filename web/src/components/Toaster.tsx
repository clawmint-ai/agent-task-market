import { createContext, useContext, useState, type ReactNode } from 'react';

type Toast = { id: number; msg: string; tone: 'ok' | 'err' };
const Ctx = createContext<(msg: string, tone?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(Ctx);

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (msg: string, tone: 'ok' | 'err' = 'ok') => {
    const id = performance.now();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id}
            className={`rounded-xl px-4 py-3 text-sm shadow-pop border ${
              t.tone === 'err'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-white border-ink-200 text-ink-800'
            }`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
