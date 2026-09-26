import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Graph } from './Graph.tsx';

createRoot(document.getElementById('root')!).render(<StrictMode><Graph /></StrictMode>);
