import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Toaster } from './components/Toaster';
import { Nav } from './components/Nav';
import { SignIn } from './routes/SignIn';
import { Browse } from './routes/Browse';
import { Publish } from './routes/Publish';
import { Work } from './routes/Work';
import { Published } from './routes/Published';
import { Wallet } from './routes/Wallet';
import { Account } from './routes/Account';
import { Admin } from './routes/Admin';

function Shell() {
  const { apiKey, setApiKey } = useAuth();
  const nav = useNavigate();
  if (!apiKey) return <Navigate to="/signin" replace />;
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-ink-100">
        <div className="max-w-6xl mx-auto px-6">
          {/* single-row header: wordmark left, nav centre-ish, sign-out right */}
          <div className="h-14 flex items-center gap-6">
            <span className="font-semibold text-sm tracking-tight text-ink-900 shrink-0 select-none">
              <span className="text-brand-500">▲</span> Task Market
            </span>
            <div className="flex-1 min-w-0"><Nav /></div>
            <button
              onClick={() => { setApiKey(null); nav('/signin'); }}
              className="shrink-0 text-xs text-ink-400 hover:text-ink-700 transition-colors px-2 py-1 rounded hover:bg-ink-100">
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8"><Outlet /></main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster>
        <BrowserRouter basename="/app">
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route element={<Shell />}>
              <Route index element={<Navigate to="/browse" replace />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/publish" element={<Publish />} />
              <Route path="/work" element={<Work />} />
              <Route path="/published" element={<Published />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/account" element={<Account />} />
              <Route path="/admin" element={<Admin />} />
            </Route>
            <Route path="*" element={<Navigate to="/browse" replace />} />
          </Routes>
        </BrowserRouter>
      </Toaster>
    </AuthProvider>
  );
}
