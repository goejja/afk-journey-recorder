import { useState } from 'react';
import { HeroAdminPage } from './HeroAdminPage.js';
import { PhantimalsPage } from './PhantimalsPage.js';

const VIEWS = [
  { key: 'heroes', label: 'Heroes', component: HeroAdminPage },
  { key: 'phantimals', label: 'Phantimals', component: PhantimalsPage },
] as const;

/** Admin > Units: what the game has, kept by the player: the standard heroes and the phantimals, with the units they bring. Images are on the Images tab. */
export function UnitsPage() {
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('heroes');
  const View = VIEWS.find((v) => v.key === view)!.component;
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Units">
        {VIEWS.map(({ key, label }) => (
          <button key={key} role="tab" aria-selected={view === key} className={view === key ? 'active' : undefined} onClick={() => setView(key)}>
            {label}
          </button>
        ))}
      </div>
      <View />
    </>
  );
}
