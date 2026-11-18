import { useEffect, useState } from 'react';
import { ArenaPage } from './arena/ArenaPage.js';
import { AdminPage } from './admin/AdminPage.js';
import { DreamHuntPage } from './dream-hunt/DreamHuntPage.js';
import { RosterPage } from './reader/RosterPage.js';
import { ScenariosPage } from './scenarios/ScenariosPage.js';
import { StatsPage } from './stats/StatsPage.js';
import { StagesPage } from './stages/StagesPage.js';

const PAGES = {
  roster: { label: 'Roster', component: RosterPage },
  stages: { label: 'Stages', component: StagesPage },
  dreamHunt: { label: 'Dream Hunt', component: DreamHuntPage },
  arena: { label: 'PvP', component: ArenaPage },
  scenarios: { label: 'Scenarios', component: ScenariosPage },
  stats: { label: 'Statistics', component: StatsPage },
  admin: { label: 'Admin', component: AdminPage },
};
type PageKey = keyof typeof PAGES;

/** The page the address names; what follows a `?` belongs to the page (the Stages grid keeps its state there). */
const fromHash = (): PageKey => {
  const name = window.location.hash.slice(1).split('?')[0]!;
  return Object.hasOwn(PAGES, name) ? (name as PageKey) : 'roster';
};

export function App() {
  const [page, setPage] = useState<PageKey>(fromHash());
  useEffect(() => {
    const onHash = () => setPage(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const Page = PAGES[page].component;

  useEffect(() => {
    document.title = `${PAGES[page].label} · AFK Journey Recorder`;
  }, [page]);

  return (
    <>
      <header className="app-header">
        <div className="brand">AFK Journey Recorder</div>
        <nav>
          {(Object.keys(PAGES) as PageKey[]).map((key) => (
            <a key={key} href={`#${key}`} className={key === page ? 'active' : undefined}>
              {PAGES[key].label}
            </a>
          ))}
        </nav>
      </header>
      <main>
        <h1 className="sr-only">{PAGES[page].label}</h1>
        <Page />
      </main>
    </>
  );
}
