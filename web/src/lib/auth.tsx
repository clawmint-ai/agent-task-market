import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

const KEY_STORAGE = 'atm.apiKey';

interface AuthCtx {
  apiKey: string | null;
  setApiKey: (k: string | null) => void;
}

const Ctx = createContext<AuthCtx>({ apiKey: null, setApiKey: () => {} });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setKey] = useState<string | null>(() => localStorage.getItem(KEY_STORAGE));
  useEffect(() => {
    if (apiKey) localStorage.setItem(KEY_STORAGE, apiKey);
    else localStorage.removeItem(KEY_STORAGE);
  }, [apiKey]);
  return <Ctx.Provider value={{ apiKey, setApiKey: setKey }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
