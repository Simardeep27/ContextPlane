import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Diagram } from './Diagram.tsx';
import { Results } from './Results.tsx';
import { Loop } from './Loop.tsx';
import { BrandMark } from '../ui/BrandMark.tsx';
import { AppNav } from '../ui/AppNav.tsx';
import './architecture.css';

const tabs = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'results', label: 'Results' },
  { id: 'loop', label: 'Recursive harness' },
] as const;
type Tab = (typeof tabs)[number]['id'];
const fromHash = (): Tab => (tabs.find((t) => `#${t.id}` === window.location.hash)?.id ?? 'architecture');

function App() {
  const [tab, setTab] = useState<Tab>(fromHash);
  useEffect(() => { const on = () => setTab(fromHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const pick = (t: Tab) => { setTab(t); history.replaceState(null, '', `#${t}`); };
  return <div className="arch-shell">
    <header className="arch-mast">
      <a className="arch-brand" href="/"><BrandMark size={28}/>Company Harness <span>/ Architecture</span></a>
      <AppNav current="/architecture.html" className="app-nav arch-nav"/>
      <nav className="arch-tabs" role="tablist" aria-label="Sections">
        {tabs.map((t) => <button key={t.id} role="tab" id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={tab === t.id} onClick={() => pick(t.id)}>{t.label}</button>)}
      </nav>
    </header>
    <main id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'architecture' && <Diagram />}
      {tab === 'results' && <Results />}
      {tab === 'loop' && <Loop />}
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
