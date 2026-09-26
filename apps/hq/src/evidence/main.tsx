import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VerifiedRun } from './VerifiedRun.tsx';

createRoot(document.getElementById('root')!).render(<StrictMode><VerifiedRun /></StrictMode>);
