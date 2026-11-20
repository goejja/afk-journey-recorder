import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem<K extends string | number> {
  key: K;
  label: ReactNode;
}

const tabId = (id: string, key: string | number) => `${id}-tab-${key}`;
const panelId = (id: string) => `${id}-panel`;

/**
 * A strip of Tabs (docs/ui-conventions.md): `role="tablist"` named by `label`, each Tab a button that controls the one `TabPanel` of the
 * same `id`. Left and Right move the focus between Tabs (and wrap), Home and End go to the first and the last, and Enter or Space selects,
 * so going through a long strip does not load every view on the way. Only the selected Tab is in the Tab order.
 */
export function Tabs<K extends string | number>({ id, label, tabs, value, onChange }: { id: string; label: string; tabs: readonly TabItem<K>[]; value: K; onChange: (key: K) => void }) {
  const buttons = useRef(new Map<K, HTMLButtonElement>());

  const move = (e: KeyboardEvent, index: number) => {
    const last = tabs.length - 1;
    const target = e.key === 'ArrowRight' ? (index === last ? 0 : index + 1) : e.key === 'ArrowLeft' ? (index === 0 ? last : index - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (target === null) return;
    e.preventDefault();
    buttons.current.get(tabs[target]!.key)?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab, i) => (
        <button
          key={tab.key}
          ref={(el) => void (el ? buttons.current.set(tab.key, el) : buttons.current.delete(tab.key))}
          id={tabId(id, tab.key)}
          role="tab"
          aria-selected={tab.key === value}
          aria-controls={panelId(id)}
          tabIndex={tab.key === value ? 0 : -1}
          className={tab.key === value ? 'active' : undefined}
          onClick={() => onChange(tab.key)}
          onKeyDown={(e) => move(e, i)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The view of the selected Tab of the strip with the same `id`. With no `value` (the strip is hidden for now) it is a plain `div`, so the
 * views inside it are not mounted again when the strip comes back.
 */
export function TabPanel<K extends string | number>({ id, value, className, children }: { id: string; value: K | null; className?: string; children: ReactNode }) {
  return (
    <div role={value === null ? undefined : 'tabpanel'} id={value === null ? undefined : panelId(id)} aria-labelledby={value === null ? undefined : tabId(id, value)} className={className}>
      {children}
    </div>
  );
}
