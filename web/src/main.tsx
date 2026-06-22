import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="p-8 text-display text-ink-900">Agent Task Market</div>
  </React.StrictMode>,
);
