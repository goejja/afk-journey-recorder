import { useCallback, useEffect, useMemo, useState } from 'react';
import { DAMAGE_TYPES, HERO_CLASSES, HERO_FACTIONS, HERO_TIERS, MAX_SUMMONS, PVP_ROLES, PVP_TIERS } from '../../src/domain/hero-admin.js';
import { api, type HeroAdmin, type HeroUsage, type TierCheck } from '../backend.js';
import { HeroIcons } from '../HeroIcons.js';
import { MultiSelect } from '../MultiSelect.js';
import { PlacementRulesAdmin } from '../advisor/index.js';
import { Portrait } from '../Portrait.js';
import { refreshUnitRules } from '../unit-rules.js';
import { useCatalogEditor } from '../hooks/catalogEditor.js';
import { useLoad } from '../hooks/load.js';
import { CatalogAdmin } from './CatalogAdmin.js';

type Stands = 'alone' | 'pair' | 'summoner';

interface Draft {
  name: string;
  tier: string;
  class: string;
  faction: string;
  damageType: string;
  stands: Stands;
  part1: string;
  part2: string;
  summon: string;
  count: string;
}

const blank = (): Draft => ({ name: '', tier: '', class: '', faction: '', damageType: '', stands: 'alone', part1: '', part2: '', summon: '', count: '1' });
const toDraft = (h: HeroAdmin): Draft => ({
  name: h.name,
  tier: h.tier ?? '',
  class: h.class ?? '',
  faction: h.faction ?? '',
  damageType: h.damageType ?? '',
  stands: h.pair ? 'pair' : h.summon ? 'summoner' : 'alone',
  part1: h.pair?.part1 ?? '',
  part2: h.pair?.part2 ?? '',
  summon: h.summon?.part ?? '',
  count: String(h.summon?.count ?? 1),
});
/** What the range, energy and tag fields hold: text, so a half-typed list does not fight the player. */
const attributesDraft = (h: HeroAdmin | null) => ({
  range: String(h?.attributes?.range ?? ''),
  energy: h?.attributes?.energy.join(', ') ?? '',
  mechanics: h?.attributes?.mechanics.join(', ') ?? '',
  season: String(h?.attributes?.releasedInSeason ?? ''),
});
const listOf = (text: string) => text.split(',').map((part) => part.trim()).filter(Boolean);
const numberOf = (text: string) => (text.trim() === '' ? null : Number(text));

const toBody = (d: Draft) => ({
  name: d.name,
  tier: (d.tier || null) as HeroAdmin['tier'],
  class: (d.class || null) as HeroAdmin['class'],
  faction: (d.faction || null) as HeroAdmin['faction'],
  damageType: (d.damageType || null) as HeroAdmin['damageType'],
  pair: d.stands === 'pair' ? { part1: d.part1, part2: d.part2 } : null,
  summon: d.stands === 'summoner' ? { part: d.summon, count: Number(d.count) } : null,
});

/** What uses a hero, as a sentence the player can read before deleting it. */
const usageText = (u: HeroUsage) =>
  [
    [u.roster, 'roster entries'],
    [u.records, 'records'],
    [u.assists, 'records as assist hero'],
    [u.scenarios, 'scenarios'],
    [u.deployments, 'Formation IDs and Round Deployments'],
    [u.stageEnemies, 'stages'],
    [u.pictures, 'reader pictures'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, what]) => `${n} ${what}`)
    .join(', ');

const standsText = (h: HeroAdmin) => (h.pair ? `${h.pair.part1} & ${h.pair.part2}` : h.summon ? `${h.summon.count} × ${h.summon.part}` : '');

const NO_ITEMS: HeroAdmin[] = [];
const NO_TIER_CHECKS: TierCheck[] = [];

/** Admin > Units > Heroes: the information of every standard hero and the units it brings. Pictures are the Images tab's. */
export function HeroAdminPage() {
  const loaded = useLoad(async () => {
    const items = await api.adminHeroes();
    const tierChecks = await api.tierCheck();
    await refreshUnitRules();
    return { items, tierChecks };
  }, []);
  const items = loaded.data?.items ?? NO_ITEMS;
  const tierChecks = loaded.data?.tierChecks ?? NO_TIER_CHECKS;
  const [usage, setUsage] = useState<HeroUsage | null>(null);
  const [search, setSearch] = useState('');
  const [tiers, setTiers] = useState<string[]>([]);
  const [factions, setFactions] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [pvpTiers, setPvpTiers] = useState<string[]>([]);
  const [hint, setHint] = useState({ pvpTier: '', pvpRole: '' });
  const [attributes, setAttributes] = useState(attributesDraft(null));
  const [departing, setDeparting] = useState(false);
  const hintOf = (h: HeroAdmin | null) => ({ pvpTier: h?.pvpTier ?? '', pvpRole: h?.pvpRole ?? '' });
  const reloadHeroes = loaded.reload;
  const reloadItems = useCallback(async () => (await reloadHeroes())?.items, [reloadHeroes]);
  const editor = useCatalogEditor<HeroAdmin, Draft>({
    items,
    reloadItems,
    keyOf: (h) => h.name,
    toDraft,
    blank,
    // the PVP hint and the attributes are saved apart from the draft, but an unsaved one is as unsaved as a typed name
    extra: {
      dirty: (h) => h !== null && (JSON.stringify(hint) !== JSON.stringify(hintOf(h)) || JSON.stringify(attributes) !== JSON.stringify(attributesDraft(h))),
      show: (h) => {
        setHint(hintOf(h ?? null));
        setAttributes(attributesDraft(h ?? null));
      },
    },
  });
  const { draft, setDraft, current, dirty, busy, selected, run } = editor;
  const error = loaded.error ?? editor.error;
  const hintDirty = current !== null && JSON.stringify(hint) !== JSON.stringify(hintOf(current));
  const attributesDirty = current !== null && JSON.stringify(attributes) !== JSON.stringify(attributesDraft(current));

  // What uses the selected hero decides whether its units can change and whether it can be deleted.
  useEffect(() => {
    setUsage(null);
    if (selected === null) return;
    let stale = false;
    api.heroUsage(selected).then((u) => !stale && setUsage(u), () => undefined);
    return () => {
      stale = true;
    };
  }, [selected, items]);

  const saveHint = () => run(async () => (await api.savePvpHint(current!.name, { pvpTier: (hint.pvpTier || null) as HeroAdmin['pvpTier'], pvpRole: (hint.pvpRole || null) as HeroAdmin['pvpRole'] })).name);
  const saveAttributes = () =>
    run(async () =>
      (
        await api.saveHeroAttributes(current!.name, {
          range: numberOf(attributes.range),
          energy: listOf(attributes.energy).map(Number),
          mechanics: listOf(attributes.mechanics),
          releasedInSeason: numberOf(attributes.season),
        })
      ).name,
    );
  const markBack = (mark: HeroAdmin['backMark']) => run(async () => (await api.saveBackMark(current!.name, mark)).name);
  const save = () => editor.save(() => (current ? api.saveAdminHero(current.name, toBody(draft)) : api.createHero(toBody(draft))));

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter(
      (h) =>
        (needle === '' || h.name.toLowerCase().includes(needle)) &&
        (tiers.length === 0 || tiers.includes(h.tier ?? 'none')) &&
        (factions.length === 0 || factions.includes(h.faction ?? 'none')) &&
        (classes.length === 0 || classes.includes(h.class ?? 'none')) &&
        (pvpTiers.length === 0 || pvpTiers.includes(h.pvpTier ?? 'none')) &&
        (!departing || tierChecks.some((c) => c.hero === h.name && c.flag !== null && !c.anecdote)),
    );
  }, [items, search, tiers, factions, classes, pvpTiers, departing, tierChecks]);

  const locked = usage !== null && usage.placements > 0;
  const set = (change: Partial<Draft>) => setDraft({ ...draft, ...change });
  const select = (label: string, value: string, options: readonly string[], key: keyof Draft, empty: string) => (
    <select aria-label={label} value={value} onChange={(e) => set({ [key]: e.target.value })}>
      <option value="">{empty}</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );

  return (
    <>
      <CatalogAdmin
        label="Heroes"
        noun="hero"
        total={items.length}
        items={visible}
        keyOf={(h) => h.name}
        selected={selected}
        open={editor.open}
        search={{ value: search, onChange: setSearch }}
        filters={
          <>
            <MultiSelect label="Tier" options={[...HERO_TIERS]} value={tiers} onChange={setTiers} />
            <MultiSelect label="Faction" options={[...HERO_FACTIONS]} value={factions} onChange={setFactions} />
            <MultiSelect label="Class" options={[...HERO_CLASSES]} value={classes} onChange={setClasses} />
            <MultiSelect label="PVP tier" options={[...PVP_TIERS, 'none']} value={pvpTiers} onChange={setPvpTiers} />
            <label className="field">
              <input type="checkbox" aria-label="Departs from tier" checked={departing} onChange={(e) => setDeparting(e.target.checked)} /> Departs from tier
            </label>
          </>
        }
        row={(h) => (
          <span className="catalog-row" title={[h.pvpTier && `PVP ${h.pvpTier}${h.pvpRole ? ` · ${h.pvpRole}` : ''}`, standsText(h)].filter(Boolean).join(' · ') || undefined}>
            <Portrait kind="hero" name={h.name} size={32} />
            <span className="catalog-name">
              <span>{h.name}</span>
            </span>
            <HeroIcons row tier={h.tier} heroClass={h.class} faction={h.faction} />
          </span>
        )}
        title={current ? current.name : 'New hero'}
        error={error}
      >
        <div className="filters">
          <input placeholder="Name" aria-label="Name" value={draft.name} disabled={current !== null} onChange={(e) => set({ name: e.target.value })} />
          {select('Tier', draft.tier, HERO_TIERS, 'tier', 'No tier')}
          {select('Class', draft.class, HERO_CLASSES, 'class', 'No class')}
          {select('Faction', draft.faction, HERO_FACTIONS, 'faction', 'No faction')}
          {select('Damage type', draft.damageType, DAMAGE_TYPES, 'damageType', 'No damage type')}
        </div>
        {current ? (
          <p className="muted">
                {current.handMade
                  ? 'Not on Yaphalla yet: the next import takes over its tier, class, faction and damage type. '
                  : current.source === 'manual'
                    ? 'Edited by you: an import leaves it alone. '
                    : 'A change you save is kept: an import then leaves it alone. '}
                A hero keeps its name: records, rosters and scenarios refer to it.
              </p>
        ) : (
          <p className="muted">A new hero has no picture until you add one on the Images tab.</p>
        )}

        <h3>Units it brings</h3>
        <div className="filters">
          <select aria-label="Stands" value={draft.stands} disabled={locked} onChange={(e) => set({ stands: e.target.value as Stands })}>
            <option value="alone">One unit</option>
            <option value="pair">Two tiles, like Elijah &amp; Lailah</option>
            <option value="summoner">Summons, like Zanie</option>
          </select>
          {draft.stands === 'pair' && (
            <>
              <input placeholder="First part" aria-label="First part" value={draft.part1} disabled={locked} onChange={(e) => set({ part1: e.target.value })} />
              <input placeholder="Second part" aria-label="Second part" value={draft.part2} disabled={locked} onChange={(e) => set({ part2: e.target.value })} />
            </>
          )}
          {draft.stands === 'summoner' && (
            <>
              <input placeholder="Summon name" aria-label="Summon name" value={draft.summon} disabled={locked} onChange={(e) => set({ summon: e.target.value })} />
              <input type="number" min={1} max={MAX_SUMMONS} aria-label="Summon count" value={draft.count} disabled={locked} onChange={(e) => set({ count: e.target.value })} />
            </>
          )}
        </div>
        {locked && (
          <p className="muted">
            This hero is placed on a map in {usage.records} records, {usage.scenarios} scenarios and {usage.deployments} Formation IDs and Round Deployments, so the units it brings cannot change.
          </p>
        )}

        {current && (
          <>
            <h3>PVP tier hint</h3>
            <div className="filters">
              <select aria-label="PVP tier" value={hint.pvpTier} onChange={(e) => setHint({ ...hint, pvpTier: e.target.value })}>
                <option value="">No PVP tier</option>
                {PVP_TIERS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select aria-label="PvP role" value={hint.pvpRole} onChange={(e) => setHint({ ...hint, pvpRole: e.target.value })}>
                <option value="">No PvP role</option>
                {PVP_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <button onClick={() => void saveHint()} disabled={busy || !hintDirty}>
                Save hint
              </button>
            </div>
            <p className="muted">
              {current.pvpSetOn
                ? `Set ${current.pvpSetOn}${current.pvpSource === 'prydwen' ? ' from the Prydwen PvP tier list' : ' by you'}. `
                : 'No hint yet. '}
              An outside opinion, not a result of your battles and not the hero's own tier. It never changes a score or the heroes a formation is built from, and saving it leaves the hero as imported.
            </p>
            {tierChecks.find((c) => c.hero === current.name) && <p className="muted">{tierChecks.find((c) => c.hero === current.name)!.text}</p>}
          </>
        )}

        {current && (
          <>
            <h3>Range, energy and mechanic tags</h3>
            <div className="filters">
              <input type="number" min={0} placeholder="Range" aria-label="Range" value={attributes.range} onChange={(e) => setAttributes({ ...attributes, range: e.target.value })} />
              <input placeholder="Energy, like 0, 200" aria-label="Energy" value={attributes.energy} onChange={(e) => setAttributes({ ...attributes, energy: e.target.value })} />
              <input type="number" min={0} placeholder="Released in season" aria-label="Released in season" value={attributes.season} onChange={(e) => setAttributes({ ...attributes, season: e.target.value })} />
            </div>
            <input className="wide" placeholder="Mechanic tags, separated by commas" aria-label="Mechanic tags" value={attributes.mechanics} onChange={(e) => setAttributes({ ...attributes, mechanics: e.target.value })} />
            <div className="actions">
              <button onClick={() => void saveAttributes()} disabled={busy || !attributesDirty}>
                Save attributes
              </button>
            </div>
            <p className="muted">
              {current.attributes
                ? `${current.attributes.source === 'external' ? 'Copied from an outside source' : 'Set by you'} on ${current.attributes.setOn}. `
                : 'None yet. '}
              Facts about the hero, not a result of your battles: they place a hero on the Lean side of the map and are in no score or sample size. Saving them leaves the hero as imported.
            </p>
          </>
        )}

        {current && (
          <>
            <h3>Placement check</h3>
            <div className="filters">
              <select aria-label="Stands at the back" value={current.backMark ?? ''} disabled={busy} onChange={(e) => void markBack((e.target.value || null) as HeroAdmin['backMark'])}>
                <option value="">By range and PvP role</option>
                <option value="back">Always stands at the back</option>
                <option value="free">Never checked</option>
              </select>
            </div>
            <p className="muted">
              The placement check in Statistics lists records where a hero that stands at the back has another hero behind it. By default that is a Damage dealer (its PvP role) with range 5 or more and no Placement Rule toward the front; your choice here adds a hero or removes it. It is your own judgement and
              not a result of your battles. It saves at once.
            </p>
          </>
        )}

        {current && <PlacementRulesAdmin hero={current.name} />}

        {current && usage && (
          <>
            <h3>Used by</h3>
            <p className="muted">{usageText(usage) || 'Nothing: it can be deleted.'}</p>
          </>
        )}

        <div className="actions">
          <button className="primary" onClick={() => void save()} disabled={busy || !dirty || draft.name.trim() === ''}>
            {current ? 'Save' : 'Create hero'}
          </button>
          {current && (
            <button className="danger" disabled={busy} onClick={() => void editor.remove(`Delete the hero "${current.name}"?`, () => api.deleteHero(current.name))}>
              Delete
            </button>
          )}
        </div>
      </CatalogAdmin>
      {editor.dialog}
    </>
  );
}
