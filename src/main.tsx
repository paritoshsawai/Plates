import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './state/store';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element.');

if (import.meta.env.DEV) {
  // Handy for poking at plan state from the console or an automated run.
  (window as unknown as { panelStudio: unknown }).panelStudio = useStore;
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
