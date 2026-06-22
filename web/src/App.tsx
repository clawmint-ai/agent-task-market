import { HashRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
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
      <header className="sticky top-0 z-20 bg-white/80 backdrop-blur border-b border-ink-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-semibold text-h2">Agent Task <span className="text-brand-600">Market</span></span>
          <button onClick={() => { setApiKey(null); nav('/signin'); }}
            className="text-sm text-ink-400 hover:text-ink-700">Sign out</button>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-2"><Nav /></div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8"><Outlet /></main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster>
        <HashRouter>
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
        </HashRouter>
      </Toaster>
    </AuthProvider>
  );
}
