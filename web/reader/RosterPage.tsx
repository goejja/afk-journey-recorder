import { useMemo, useState } from 'react';
import { HeroIcons } from '../HeroIcons.js';
import { RankText } from '../RankText.js';
import { HeroStateButtons } from '../ui/HeroStateButtons.js';
import { api, type Hero, type Profile, type Rules } from '../backend.js';
import { distinct, heroMatches, TIER_ORDER } from '../heroFilter.js';
import { MultiSelect } from '../MultiSelect.js';
import { Portrait } from '../Portrait.js';
import { RosterImport } from './RosterImport.js';
import { useAction } from '../hooks/action.js';
import { useLoad } from '../hooks/load.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { MasterDetail } from '../ui/MasterDetail.js';
import { Icon } from '../ui/Icon.js';
import { Notice } from '../ui/Notice.js';

const NO_PROFILES: Profile[] = [];
const NO_HEROES: Hero[] = [];

export function RosterPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [faction, setFaction] = useState<string[]>([]);
  const [heroClass, setHeroClass] = useState<string[]>([]);
  const [tier, setTier] = useState<string[]>([]);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [form, setForm] = useState<'new' | 'edit' | 'import' | 'merge' | null>(null);
  const { error: actionError, run: act } = useAction({ when: 'queue' });
  const { confirm, confirmRun, dialog } = useConfirmActions(act);

  // the profiles and the heroes of the one on show; asked again when another is picked, and patched in place by a change to one hero
  const loaded = useLoad(async () => {
    const profiles = await api.profiles();
    const current = profiles.find((p) => p.id === selectedId) ?? profiles.find((p) => p.isDefault);
    return { profiles, heroes: await api.heroes(current?.id) };
  }, [selectedId]);
  const profiles = loaded.data?.profiles ?? NO_PROFILES;
  const heroes = loaded.data?.heroes ?? NO_HEROES;
  const reload = loaded.reload;
  const setProfiles = (change: (old: Profile[]) => Profile[]) => loaded.setData((old) => ({ ...old, profiles: change(old.profiles) }));
  const setHeroes = (change: (old: Hero[]) => Hero[]) => loaded.setData((old) => ({ ...old, heroes: change(old.heroes) }));

  // The rules do not change while the page is open.
  const loadedRules = useLoad(() => api.rules(), []);
  const rules: Rules | null = loadedRules.data ?? null;
  const error = loaded.error ?? loadedRules.error ?? actionError;

  // The profile on show: the one picked, else the default (also when the picked one has just been deleted).
  const selected = profiles.find((p) => p.id === selectedId) ?? profiles.find((p) => p.isDefault) ?? null;

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

  const shownProfiles = useMemo(() => {
    const wanted = profileSearch.trim().toLowerCase();
    return profiles.filter((p) => wanted === '' || p.name.toLowerCase().includes(wanted) || (p.playerId ?? '').toLowerCase().includes(wanted));
  }, [profiles, profileSearch]);
  const factions = useMemo(() => distinct(heroes.map((h) => h.faction)), [heroes]);
  const classes = useMemo(() => distinct(heroes.map((h) => h.class)), [heroes]);
  const visible = heroes.filter((h) => heroMatches(h, { search, faction, heroClass, tier }) && (!ownedOnly || h.owned));
  const ownedCount = heroes.filter((h) => h.owned).length;

  const reset = () =>
    selected &&
    confirmRun({ title: `Remove all ${ownedCount} heroes from the roster of ${selected.name}?`, message: 'This cannot be undone.', confirmLabel: 'Remove' }, () => api.resetRoster(selected.id), reload);

  const merge = (into: Profile) =>
    selected &&
    confirmRun(
      {
        title: `Merge ${selected.name} into ${into.name}?`,
        message: `Their heroes are combined at the stronger state of each, ${selected.name} is deleted and ${into.name} keeps its name. This cannot be undone.`,
        confirmLabel: 'Merge',
      },
      async () => {
        await api.mergeProfile(selected.id, into.id);
        setSelectedId(into.id);
        setForm(null);
      },
      reload,
    );

  const remove = () =>
    selected &&
    confirmRun(
      { title: `Delete the profile ${selected.name} and its ${selected.heroCount} heroes?`, message: "Saved records keep their own copy of every hero's state.", confirmLabel: 'Delete' },
      async () => {
        await api.deleteProfile(selected.id);
        setSelectedId(null);
      },
      reload,
    );

  return (
    <>
      <MasterDetail
        sidebarLabel="Profiles"
        sidebarHeader={
          <div className="profile-sidebar-actions">
            <button className="profile-new" onClick={() => setForm(form === 'new' ? null : 'new')}>New profile</button>
            <button className="profile-new" onClick={() => setForm(form === 'import' ? null : 'import')} aria-expanded={form === 'import'} title="Read the heroes of a screenshot of the game">
              Import from a picture
            </button>
            <input placeholder="Search profiles" aria-label="Search profiles" value={profileSearch} onChange={(e) => setProfileSearch(e.target.value)} />
          </div>
        }
        sidebar={
          <ul className="profile-list" aria-label="Profiles">
            {shownProfiles.map((p) => (
              <li key={p.id}>
                <button
                  className={p.id === selected?.id ? 'profile active' : 'profile'}
                  aria-current={p.id === selected?.id}
                  title={`${p.name}: ${p.heroCount} heroes${p.playerId ? ` · ID ${p.playerId}` : ''}`}
                  onClick={() => (setSelectedId(p.id), setForm(null))}
                >
                  <span className="profile-name">
                    {p.isDefault && <span title="Default profile" aria-label="Default"><Icon name="star" /> </span>}
                    {p.name}
                  </span>
                  <span className="muted profile-meta">
                    {p.heroCount} heroes{p.playerId ? ` · ID ${p.playerId}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {profiles.length > 0 && shownProfiles.length === 0 && <li className="muted">No profile matches.</li>}
          </ul>
        }
        detailHeader={
          <>
            {error && (
              <Notice kind="error">
                {error}
              </Notice>
            )}
            {selected && (
              <div className="roster-head">
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
  const starting = hero.tier === 'R'; // the starting heroes are on every roster, at Rare

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
          <HeroStateButtons name={hero.name} tier={hero.tier} rank={hero.rank} level={hero.equipmentLevel} rules={rules} onChange={props.onChange} />
        </div>
      )}
    </article>
  );
}
