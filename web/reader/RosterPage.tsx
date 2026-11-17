import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WeaponStars, weaponOptionText } from '../WeaponStars.js';
import { weaponLabel } from '../../src/domain/exclusive-weapon.js';
import { HeroIcons } from '../HeroIcons.js';
import { RankText } from '../RankText.js';
import { Popover } from '../ui/Popover.js';
import { allowedEquipmentLevels, allowedRanks, equipmentForRank } from '../../src/domain/hero-state.js';
import { api, type Hero, type Profile, type Rules } from '../backend.js';
import { distinct, heroMatches, TIER_ORDER } from '../heroFilter.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { RosterImport } from './RosterImport.js';
import { useCrud } from '../useCrud.js';
import { MasterDetail } from '../ui/MasterDetail.js';

export function RosterPage() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [rules, setRules] = useState<Rules | null>(null);
  const [search, setSearch] = useState('');
  const [faction, setFaction] = useState<string[]>([]);
  const [heroClass, setHeroClass] = useState<string[]>([]);
  const [tier, setTier] = useState<string[]>([]);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [form, setForm] = useState<'new' | 'edit' | 'import' | 'merge' | null>(null);
  const { error, run: act, confirm, dialog } = useCrud();

  // The profile on show: the one picked, else the default (also when the picked one has just been deleted).
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles.find((p) => p.isDefault) ?? null;

  const asked = useRef(0); // the newest reload wins: answers arriving out of order are dropped
  const reload = useCallback(async () => {
    const request = ++asked.current;
    const loadedProfiles = await api.profiles();
    const current = loadedProfiles.find((p) => p.id === selectedId) ?? loadedProfiles.find((p) => p.isDefault);
    const loadedHeroes = await api.heroes(current?.id);
    if (request !== asked.current) return;
    setProfiles(loadedProfiles);
    setHeroes(loadedHeroes);
  }, [selectedId]);

  useEffect(() => {
    void act(reload);
  }, [act, reload]);

  // The rules do not change while the page is open.
  useEffect(() => {
    void act(() => api.rules(), setRules);
  }, [act]);

  /** Does a change to the profiles, then reads the page again. */
  const run = (action: () => Promise<unknown>) =>
    act(async () => {
      await action();
      await reload();
    });

  // Removing a hero deletes its rank and equipment, so a hero that has either is asked about first; adding, and removing a bare hero, are one click.
  const toggleHero = async (profileId: number, hero: Hero) => {
    if (hero.owned) {
      const lost = [hero.rank !== null && 'rank', hero.equipmentLevel !== null && 'equipment level'].filter(Boolean).join(' and ');
      if (lost && !(await confirm({ title: `Remove ${hero.name} from the roster?`, message: `Its ${lost} will be lost.`, confirmLabel: 'Remove', danger: true }))) return;
    }
    await changeHero(profileId, hero.name, async () => (hero.owned ? (await api.removeHero(hero.name, profileId), null) : api.saveHero(hero.name, null, null, profileId)));
  };

  /** A change to one hero of the profile on show: the answer says its new state, so the page patches that hero and the profile's count instead of reading everything again. */
  const changeHero = (profileId: number, name: string, action: () => Promise<{ rank: string | null; equipmentLevel: number | null } | null>) =>
    act(async () => {
      const wasOwned = heroes.find((h) => h.name === name)?.owned ?? false;
      const saved = await action();
      setHeroes((old) => old.map((h) => (h.name === name ? { ...h, owned: saved !== null, rank: saved?.rank ?? null, equipmentLevel: saved?.equipmentLevel ?? null } : h)));
      if (wasOwned !== (saved !== null)) setProfiles((old) => old.map((p) => (p.id === profileId ? { ...p, heroCount: p.heroCount + (saved !== null ? 1 : -1) } : p)));
    });

  const factions = useMemo(() => distinct(heroes.map((h) => h.faction)), [heroes]);
  const classes = useMemo(() => distinct(heroes.map((h) => h.class)), [heroes]);
  const visible = heroes.filter((h) => heroMatches(h, { search, faction, heroClass, tier }) && (!ownedOnly || h.owned));
  const ownedCount = heroes.filter((h) => h.owned).length;

  async function reset() {
    if (
      selected &&
      (await confirm({
        title: `Remove all ${ownedCount} heroes from the roster of ${selected.name}?`,
        message: 'This cannot be undone.',
        confirmLabel: 'Remove',
        danger: true,
      }))
    ) {
      void run(() => api.resetRoster(selected.id));
    }
  }

  async function merge(into: Profile) {
    if (
      selected &&
      (await confirm({
        title: `Merge ${selected.name} into ${into.name}?`,
        message: `Their heroes are combined at the stronger state of each, ${selected.name} is deleted and ${into.name} keeps its name. This cannot be undone.`,
        confirmLabel: 'Merge',
        danger: true,
      }))
    ) {
      void run(async () => {
        await api.mergeProfile(selected.id, into.id);
        setSelectedId(into.id);
        setForm(null);
      });
    }
  }

  async function remove() {
    if (
      selected &&
      (await confirm({
        title: `Delete the profile ${selected.name} and its ${selected.heroCount} heroes?`,
        message: "Saved records keep their own copy of every hero's state.",
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      void run(async () => {
        await api.deleteProfile(selected.id);
        setSelectedId(null);
      });
    }
  }

  return (
    <>
      <MasterDetail
        header={
          <>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {selected && (
              <div className="panel roster-top-panel">
                <div className="toolbar roster-profile-toolbar">
                  <h2>
                    {selected.name} <span className="muted">{ownedCount} / {heroes.length} owned{selected.playerId ? ` · ID ${selected.playerId}` : ''}</span>
                  </h2>
                  <div className="profile-actions">
                    <button onClick={() => setForm(form === 'edit' ? null : 'edit')}>Edit profile</button>
                    <button onClick={() => void run(() => api.setDefaultProfile(selected.id))} disabled={selected.isDefault} title={selected.isDefault ? 'This is the default profile' : 'Use this profile in the Stage and Dream Hunt forms'}>
                      Set as default
                    </button>
                    <button onClick={() => setForm(form === 'merge' ? null : 'merge')} disabled={profiles.length < 2} aria-expanded={form === 'merge'} title="Combine this profile's heroes into another profile">
                      Merge into…
                    </button>
                    <button className="danger" onClick={() => void remove()} disabled={selected.isDefault} title={selected.isDefault ? 'Make another profile the default first' : undefined}>
                      Delete profile
                    </button>
                    <button className="danger" onClick={() => void reset()} disabled={ownedCount === 0}>
                      Reset roster
                    </button>
                  </div>
                </div>
                <div className="filters roster-filters">
                  <input placeholder="Search heroes" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <MultiSelect label="Faction" value={faction} options={factions} onChange={setFaction} />
                  <MultiSelect label="Class" value={heroClass} options={classes} onChange={setHeroClass} />
                  <MultiSelect label="Tier" value={tier} options={TIER_ORDER} onChange={setTier} />
                  <label className="check">
                    <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} /> Owned only
                  </label>
                </div>
              </div>
            )}
          </>
        }
        sidebarLabel="Profiles"
        sidebarHeader={
          <div className="profile-sidebar-actions">
            <button className="profile-new" onClick={() => setForm(form === 'new' ? null : 'new')}>New profile</button>
            <button className="profile-new" onClick={() => setForm(form === 'import' ? null : 'import')} aria-expanded={form === 'import'} title="Read the heroes of a screenshot of the game">
              Import from a picture
            </button>
          </div>
        }
        sidebar={
          <ul className="profile-list" aria-label="Profiles">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  className={p.id === selected?.id ? 'profile active' : 'profile'}
                  aria-current={p.id === selected?.id}
                  title={`${p.name}: ${p.heroCount} heroes${p.playerId ? ` · ID ${p.playerId}` : ''}`}
                  onClick={() => (setSelectedId(p.id), setForm(null))}
                >
                  <span className="profile-name">
                    {p.isDefault && <span title="Default profile" aria-label="Default">★ </span>}
                    {p.name}
                  </span>
                  <span className="muted profile-meta">
                    {p.heroCount} heroes{p.playerId ? ` · ID ${p.playerId}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        }
        detailLabel={selected ? `Heroes of ${selected.name}` : 'Profile details'}
        detailKey={`${selected?.id ?? 'none'}:${form ?? ''}`}
        detail={
          <>
            {form === 'new' && <ProfileForm key="new" profiles={profiles} onCancel={() => setForm(null)} onSave={(value) => run(async () => {
              const created = await api.createProfile(value);
              setSelectedId(created.id);
              setForm(null);
            })} />}
            {form === 'import' && rules && <RosterImport profile={selected} profiles={profiles} heroes={heroes} rules={rules} onClose={() => setForm(null)} onApplied={() => void reload()} />}
            {selected && (
              <>
                {form === 'merge' && (
                  <form className="profile-merge" onSubmit={(e) => { e.preventDefault(); const into = profiles.find((p) => p.id === Number(new FormData(e.currentTarget).get('into'))); if (into) void merge(into); }}>
                    <label>
                      Merge {selected.name} into{' '}
                      <select name="into" defaultValue="">
                        <option value="" disabled>Choose a profile</option>
                        {profiles.filter((p) => p.id !== selected.id).map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.heroCount} heroes)</option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Merge</button>
                    <button type="button" onClick={() => setForm(null)}>Cancel</button>
                  </form>
                )}
                {form === 'edit' && <ProfileForm key={selected.id} profile={selected} profiles={profiles} onCancel={() => setForm(null)} onSave={(value) => run(async () => {
                  await api.updateProfile(selected.id, { name: value.name, playerId: value.playerId ?? null });
                  setForm(null);
                })} />}
                <div className="grid">
                  {rules &&
                    visible.map((hero) => (
                      <HeroCard
                        key={hero.name}
                        hero={hero}
                        rules={rules}
                        onToggle={() => toggleHero(selected.id, hero)}
                        onChange={(rank, level) => changeHero(selected.id, hero.name, () => api.saveHero(hero.name, rank, level, selected.id))}
                      />
                    ))}
                </div>
                {visible.length === 0 && <p className="muted">No heroes match the filters.</p>}
              </>
            )}
          </>
        }
      />
      {dialog}
    </>
  );
}

/** Name and player ID of a profile, for a new one (optionally with the heroes of another) or to edit one. */
function ProfileForm(props: {
  profile?: Profile;
  profiles: Profile[];
  onSave: (value: { name: string; playerId?: string | null; copyFrom?: number }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.profile?.name ?? '');
  const [playerId, setPlayerId] = useState(props.profile?.playerId ?? '');
  const [copyFrom, setCopyFrom] = useState('');
  return (
    <form
      className="panel profile-form"
      aria-label={props.profile ? 'Edit profile' : 'New profile'}
      onSubmit={(e) => {
        e.preventDefault();
        props.onSave({ name, playerId: playerId.trim() === '' ? null : playerId.trim(), ...(copyFrom ? { copyFrom: Number(copyFrom) } : {}) });
      }}
    >
      <label className="field">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field" title="The player's id in the game: it stays when the player's name changes">
        Player ID
        <input value={playerId} onChange={(e) => setPlayerId(e.target.value)} placeholder="optional" />
      </label>
      {!props.profile && (
        <label className="field">
          Copy heroes from
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            <option value="">Nobody: start empty</option>
            {props.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="primary" type="submit" disabled={name.trim() === ''}>
        {props.profile ? 'Save profile' : 'Create profile'}
      </button>
      <button type="button" onClick={props.onCancel}>
        Cancel
      </button>
    </form>
  );
}

function HeroCard(props: {
  hero: Hero;
  rules: Rules;
  onToggle: () => void;
  onChange: (rank: string | null, level: number | null) => void;
}) {
  const { hero, rules } = props;
  // The value whose list is open, and the button it hangs under; a press anywhere else closes it.
  const [editing, setEditing] = useState<'rank' | 'equipment' | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const starting = hero.tier === 'R'; // the starting heroes are on every roster, at Rare
  const levels = allowedEquipmentLevels(hero.rank, rules);
  // Only the ranks the hero's tier allows, highest first so the strongest options are at the top of the list.
  const ranks = [...allowedRanks(hero.tier, rules.ranks)].reverse();

  const close = useCallback(() => setEditing(null), []);
  const toggle = (field: 'rank' | 'equipment', button: HTMLElement) => {
    setAnchor(button);
    setEditing(editing === field ? null : field);
  };
  const pick = (change: () => void) => {
    change();
    setEditing(null);
  };

  function changeRank(rank: string) {
    props.onChange(rank, equipmentForRank(hero.equipmentLevel, rank, rules));
  }

  return (
    <article className={hero.owned ? 'card owned' : 'card'}>
      <div className="card-top">
        <HeroIcons tier={hero.tier} heroClass={hero.class} faction={hero.faction} />
        <button className="card-main" onClick={props.onToggle} aria-pressed={hero.owned} disabled={starting} title={starting ? 'Starting hero: always on the roster' : hero.owned ? 'Remove from roster' : 'Add to roster'}>
          <Portrait kind="hero" name={hero.name} size={72} />
          <span className="name">{hero.name}</span>
        </button>
      </div>
      {hero.owned && starting && (
        <div className="state state-fixed">
          <RankText rank={hero.rank} />
        </div>
      )}
      {hero.owned && !starting && (
        <div className="state">
          <button type="button" className="state-value" aria-expanded={editing === 'rank'} aria-label={`Rank of ${hero.name}: ${hero.rank ?? 'not set'}`} title="Change the rank" onClick={(e) => toggle('rank', e.currentTarget)}>
            <RankText rank={hero.rank} />
          </button>
          {levels.length > 0 && (
            <button type="button" className="state-value weapon-line" aria-expanded={editing === 'equipment'} aria-label={`Equipment of ${hero.name}: ${hero.equipmentLevel === null ? 'none' : weaponLabel(hero.equipmentLevel)}`} title="Change the equipment" onClick={(e) => toggle('equipment', e.currentTarget)}>
              {hero.equipmentLevel === null ? <span className="muted">No equipment</span> : <><WeaponStars level={hero.equipmentLevel} /> <span>{weaponLabel(hero.equipmentLevel)}</span></>}
            </button>
          )}
        </div>
      )}
      {editing && anchor && (
        <Popover anchor={anchor} label={editing === 'rank' ? `Rank of ${hero.name}` : `Equipment of ${hero.name}`} onClose={close}>
          {editing === 'rank' ? (
            <>
              {hero.rank === null && (
                <button type="button" aria-pressed disabled>
                  Not set
                </button>
              )}
              {ranks.map((r) => (
                <button key={r} type="button" aria-pressed={r === hero.rank} onClick={() => pick(() => changeRank(r))}>
                  <RankText rank={r} />
                </button>
              ))}
            </>
          ) : (
            <>
              {[...levels].reverse().map((l) => (
                <button key={l} type="button" aria-pressed={l === hero.equipmentLevel} onClick={() => pick(() => props.onChange(hero.rank, l))}>
                  {weaponOptionText(l)}
                </button>
              ))}
              <button type="button" aria-pressed={hero.equipmentLevel === null} onClick={() => pick(() => props.onChange(hero.rank, null))}>
                None
              </button>
            </>
          )}
        </Popover>
      )}
    </article>
  );
}
