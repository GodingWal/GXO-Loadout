import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { runResetIfNeeded } from './services/appReset';
import { preloadOCR } from './services/ml';

// Wipe stale data from prior versions before app loads. Once this resolves,
// IndexedDB and localStorage are guaranteed to be at the current schema.
runResetIfNeeded().then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // Preload Tesseract worker after first render. Model (~10MB) is fetched and
  // cached in IndexedDB; subsequent app launches are instant. Failures are
  // silent — OCR will just retry on first real use.
  preloadOCR().catch((err) => {
    console.warn('[loadout] Tesseract preload failed; will retry on first use:', err);
  });
});
