import { useState } from 'react';
import { TabbedPage } from '../ui/Tabs.js';
import { TitanReaverPage } from './titan-reaver/TitanReaverPage.js';

type EventKey = 'titanReaver';

const EVENTS: { key: EventKey; label: string }[] = [{ key: 'titanReaver', label: 'Titan Reaver' }];

/** The Events page: one tab for each event. Titan Reaver is the first; Clashfronts (#163) adds its own. */
export function EventsPage() {
  const [event, setEvent] = useState<EventKey>('titanReaver');
  return (
    <TabbedPage id="events" label="Events" tabs={EVENTS} value={event} onChange={setEvent}>
      {(onForm) => event === 'titanReaver' && <TitanReaverPage onForm={onForm} />}
    </TabbedPage>
  );
}
