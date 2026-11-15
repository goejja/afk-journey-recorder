import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyUnitRules } from '../src/domain/units.js';
import { App } from './App.js';
import { api } from './backend.js';
import './styles.css';

// The pairs, summons and second parts the player declared: the pure code reads them, so they are in place before the first screen.
await api.unitRules().then(applyUnitRules, (error) => console.error('Could not load the unit rules; using the defaults', error));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
