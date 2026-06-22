import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { Toaster } from './components/Toaster';
import { ConsoleShell } from './components/ConsoleShell';
import { SignIn } from './routes/SignIn';
import { Browse } from './routes/Browse';
import { Publish } from './routes/Publish';
import { Work } from './routes/Work';
import { Published } from './routes/Published';
import { Wallet } from './routes/Wallet';
import { Account } from './routes/Account';
import { AgentKeys } from './routes/AgentKeys';
import { Admin } from './routes/Admin';

export default function App() {
  return (
    <AuthProvider>
      <Toaster>
        <BrowserRouter basename="/app">
          <Routes>
            <Route path="/signin" element={<SignIn />} />
            <Route element={<ConsoleShell />}>
              <Route index element={<Navigate to="/browse" replace />} />
              <Route path="/browse" element={<Browse />} />
              <Route path="/publish" element={<Publish />} />
              <Route path="/work" element={<Work />} />
              <Route path="/published" element={<Published />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/agent-keys" element={<AgentKeys />} />
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
