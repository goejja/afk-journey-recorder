import { useEffect, useState } from 'react';
import { ARENA_MODES, TEAMS_PER_MODE } from '../../src/domain/arena.js';
import { api, type ArenaBattle } from '../backend.js';
import { RecordToolbar, useGroupedList, type ListItem as GroupedItem } from '../records/GroupedList.js';
import { FightRow } from '../records/FightRow.js';
import { GroupCard } from '../records/GroupCard.js';
import { RecordListView } from '../records/RecordListView.js';
import { useRecordList } from '../records/useRecordList.js';
import { toPayload } from '../FormationEditor.js';
import { toOpponentPayload } from './OpponentEditor.js';
import { BattleMapPreview } from './BattleMapPreview.js';
import { TeamOverview } from '../stats/TeamOverview.js';
import { BattleImport, type ImportStart } from '../reader/BattleImport.js';
import { type Round } from '../../src/domain/tournament.js';
import { applyTeamChange } from './round-deployment.js';
import { feedbackOf, type ImportGroup } from '../reader/battle-import.js';
import { sendFeedback, useParkedToast, type FeedbackAnswer } from '../reader/parked-toast.js';
import { recordedHeroes, useRosterSync } from '../reader/RosterSync.js';
import { useConfirmActions } from '../hooks/confirm.js';
import { MultiSelect } from '../MultiSelect.js';
import { FormationIdBadge } from '../FormationIdField.js';
import { TagBadges, TagFilter } from '../Tags.js';
import { toggled } from '../format.js';
import { joinNotices, stepAfterSave } from '../hooks/saved.js';
import { type PatchReference, type Reference, toInput, type Clone, cloneOf, savedOfMode, rostersOf, pairOf, loadRoundDeployments, fillSavedDeploymentTiles, cloneFromImport, type Side } from './draft.js';
import { ModeChip, Players } from './BoardParts.js';
import { NewBattles } from './NewBattles.js';
import { EditBattle } from './EditBattle.js';
import { Notice } from '../ui/Notice.js';

type ListItem = GroupedItem<ArenaBattle>;

interface FightRowProps {
  fight: ArenaBattle;
  reference: Reference;
  shown: Set<number>;
  onToggleMap: (id: number) => void;
  onEdit: (fight: ArenaBattle) => void;
  onDelete: (fight: ArenaBattle) => void;
  onClone: (fights: ArenaBattle[], side?: Side) => void;
  /** Inside a battle's card: it shows the team number, and leaves the date and tags to the battle. */
  inBattle?: boolean;
}

/** The Union Level of each side of a Guild Duel fight, as shown in the recap; empty when neither is known. */
function UnionRecap({ fight }: { fight: ArenaBattle }) {
  if (fight.unionLevel == null && fight.opponentUnionLevel == null) return null;
  return (
    <span className="muted" title="Union Level of each side">
      Union A {fight.unionLevel ?? '?'} · B {fight.opponentUnionLevel ?? '?'}
    </span>
  );
}

/** One fight of the list: what it was, the buttons, the two teams and, on request, the map. */
function ArenaFightRow({ fight: b, reference, shown, onToggleMap, onEdit, onDelete, onClone, inBattle = false }: FightRowProps) {
  return (
    <FightRow
      infoClassName={inBattle ? undefined : 'one-line'}
      info={
        <>
          {inBattle ? <strong>Team {b.battlePosition}</strong> : <ModeChip mode={b.mode} />}
          {!inBattle && <Players fight={b} profiles={reference.profiles} />}
          <span className="muted">
            {b.mapName}
            {b.rule ? ` · ${b.rule}` : ''}
          </span>
          {!inBattle && (
            <>
              <span className="muted">{b.createdAt}</span>
              <span className="badge" title="The season the record was played in">S{b.season}</span>
              <UnionRecap fight={b} />
              <TagBadges tags={b.tags} />
              <FormationIdBadge code={b.formation.formationId} side="A" />
              <FormationIdBadge code={b.opponent.formationId} side="B" />
            </>
          )}
        </>
      }
      leading={
        <button aria-expanded={shown.has(b.id)} onClick={() => onToggleMap(b.id)}>
          {shown.has(b.id) ? 'Hide map' : 'Show map'}
        </button>
      }
      cloneTitle="Start a new battle from this fight"
      cloneVariants={
        <>
          <button title="Start a new battle with only the heroes of Side A" onClick={() => onClone([b], 'A')}>Clone A</button>
          <button title="Start a new battle with only the heroes of Side B" onClick={() => onClone([b], 'B')}>Clone B</button>
        </>
      }
      onEdit={() => onEdit(b)}
      onClone={() => onClone([b])}
      onDelete={() => onDelete(b)}
      note={b.note}
      noteClassName="battle-note"
    >
      <div className="attempt-head">
        <TeamOverview label="Side A" side="a" outcome={b.outcome === 'Win' ? 'won' : 'lost'} heroes={b.formation.heroes} phantimal={b.formation.phantimal} artifact={b.formation.artifact} size={36} />
        <span className="muted">vs</span>
        <TeamOverview label="Side B" side="b" outcome={b.outcome === 'Win' ? 'lost' : 'won'} heroes={b.opponent.heroes} phantimal={b.opponent.phantimal} artifact={b.opponent.artifact} size={36} />
      </div>
      {shown.has(b.id) && <BattleMapPreview battle={b} map={reference.maps.find((m) => m.name === b.mapName)} />}
    </FightRow>
  );
}

const NO_BATTLES: ArenaBattle[] = [];

export function Battles({ reference, patchReference }: { reference: Reference; patchReference: PatchReference }) {
  const [mode, setMode] = useState<string[]>([]);
  const [tag, setTag] = useState<string[]>([]);
  const [player, setPlayer] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  /** The import a form was opened from: where the wizard stands, and the pictures of the battle in the form, which stay in the queue until it is saved. */
  const [fromImport, setFromImport] = useState<{ start: ImportStart; dismiss: number[] } | null>(null);
  /** How many pictures wait in the import queue, to resume the import after leaving it. */
  const [waiting, setWaiting] = useState(0);
  const [cloning, setCloning] = useState<Clone | null>(null);
  const [editing, setEditing] = useState<ArenaBattle | null>(null);
  const [editingBattle, setEditingBattle] = useState<{ id: number; clone: Clone; round: Round | null; tournamentId: number | null } | null>(null);
  /** The roster sync a batch save offers, as the form does for one side (ADR 0021). */
  const sync = useRosterSync();
  const [shownMaps, setShownMaps] = useState<Set<number>>(new Set()); // battles whose map is open
  const reportParked = useParkedToast();
  const toggleMap = (id: number) => setShownMaps((old) => toggled(old, id));

  const { loaded, limit, showMore, notice, setNotice, run, error } = useRecordList({
    load: (page) => api.arenaBattles({ limit: String(page), mode, tag, player: player.trim() }),
    deps: [mode, tag, player],
    formOpen: adding || editing !== null || editingBattle !== null,
  });
  const { confirmRun, dialog } = useConfirmActions(run);
  const battles = loaded.data ?? NO_BATTLES;
  const reload = loaded.reload;

  const remove = (battle: ArenaBattle) => confirmRun({ title: `Delete this ${battle.mode} fight?`, confirmLabel: 'Delete' }, () => api.deleteArenaBattle(battle.id), reload);
  const removeBattle = (id: number, fights: number) => confirmRun({ title: `Delete this battle and its ${fights} fights?`, confirmLabel: 'Delete' }, () => api.deleteBattleGroup(id, true), reload);

  const list = useGroupedList(battles);
  const rowProps = { reference, shown: shownMaps, onToggleMap: toggleMap, onEdit: (f: ArenaBattle) => (setAdding(false), setEditing(f)), onDelete: (f: ArenaBattle) => void remove(f), onClone: (fights: ArenaBattle[], side?: Side) => (setEditing(null), setCloning(cloneOf(reference, fights, false, side)), setAdding(true)) };

  useEffect(() => {
    if (importing || adding) return;
    let live = true; // a read that a later one overtook must not set the count
    api.battleImport().then(
      (state) => live && setWaiting(state.queue.filter((q) => q.state === 'done' || q.state === 'running' || q.state === 'queued').length),
      () => live && setWaiting(0),
    );
    return () => void (live = false);
  }, [importing, adding]);

  /** Back to the wizard from the form it opened: saved (the next battle that needs a look opens) or not. */
  const backToImport = async (saved: boolean, left?: string | null) => {
    if (!fromImport) return;
    const { start, dismiss } = fromImport;
    if (saved) await api.dismissBattleImport(dismiss).catch(() => undefined);
    setFromImport({ start: { ...start, openNext: saved }, dismiss: [] });
    setAdding(false);
    setCloning(null);
    if (saved) void reload();
    setImporting(true);
    if (left) setNotice(`Saved. ${left}`);
  };

  const done = (left?: string | null) => {
    setFromImport(null);
    setAdding(false);
    setEditing(null);
    setEditingBattle(null);
    setCloning(null);
    void reload();
    if (left) setNotice(`Saved. ${left}`);
  };

  const renderItem = (item: ListItem) =>
    item.kind === 'fight' ? (
      <li key={`fight-${item.fight.id}`} className="attempt">
        <ArenaFightRow fight={item.fight} {...rowProps} />
      </li>
    ) : (
      <GroupCard
        key={`battle-${item.id}`}
        label={`${item.fights[0]!.mode} battle`}
        fightsLabel="Fights of the battle"
        header={
          <>
        <div className="attempt-info battle-info one-line">
          <ModeChip mode={item.fights[0]!.mode} />
          <Players fight={item.fights[0]!} profiles={reference.profiles} keepCell />
          <span className="badge" title="Fights won by Side A">{item.fights.filter((f) => f.outcome === 'Win').length}-{item.fights.filter((f) => f.outcome === 'Loss').length}</span>
          <span className="muted">{item.fights[0]!.createdAt}</span>
          <span className="badge" title="The season the record was played in">S{item.fights[0]!.season}</span>
          <span className="tags-cell">
            <UnionRecap fight={item.fights[0]!} />
            <FormationIdBadge code={item.fights[0]!.battleFormationId} side="A" />
            <FormationIdBadge code={item.fights[0]!.battleOpponentFormationId} side="B" />
          </span>
        </div>
        <div className="battle-teams">
          <span className="team-pips" aria-label="Teams">
            {item.fights.map((f) => (
              <span key={f.id} className={`team-pip ${f.outcome === 'Win' ? 'win' : 'loss'}`} title={`Team ${f.battlePosition}: Side A ${f.outcome === 'Win' ? 'won' : 'lost'}`}>
                T{f.battlePosition} · {f.mapName}{f.rule ? ` · ${f.rule}` : ''}
              </span>
            ))}
          </span>
          <span className="tags-cell">
            <TagBadges tags={item.fights[0]!.tags} />
          </span>
        </div>
          </>
        }
        fights={item.fights}
        open={list.open.has(item.id)}
        onToggle={() => list.toggle(item.id)}
        editTitle="Edit all the teams of this battle"
        onEdit={() => (setAdding(false), setEditingBattle({ id: item.id, clone: cloneOf(reference, item.fights, true), round: item.fights[0]?.round ?? null, tournamentId: item.fights[0]?.tournamentId ?? null }))}
        cloneTitle="Start a new battle from this one"
        onClone={() => rowProps.onClone(item.fights)}
        cloneVariants={
          <>
            <button title="Start a new battle with only the heroes of Side A" onClick={() => rowProps.onClone(item.fights, 'A')}>Clone A</button>
            <button title="Start a new battle with only the heroes of Side B" onClick={() => rowProps.onClone(item.fights, 'B')}>Clone B</button>
          </>
        }
        onDelete={() => void removeBattle(item.id, item.fights.length)}
        renderFight={(fight) => <ArenaFightRow fight={fight} inBattle {...rowProps} />}
      />
    );

  /** After a Battle is saved from the batch: offer the roster update of each side, as the form does (ADR 0021). */
  async function syncSavedBattle(clone: Clone, attemptIds: number[]) {
    for (const side of ['A', 'B'] as const) {
      const profile = reference.profiles.find((p) => p.id === clone.profiles?.[side]);
      if (!profile) continue;
      const roster = await api.heroes(profile.id);
      const recorded = clone.drafts.flatMap((d) => recordedHeroes(side === 'A' ? toPayload(d.formation) : toOpponentPayload(d.opponent)));
      await sync.ask(recorded, roster, reference.heroRules, profile, { attemptIds, side });
    }
  }

  if (importing)
    return (
      <>
      {notice && (
        <Notice kind="error">
          {notice}
        </Notice>
      )}
      <BattleImport
        start={fromImport?.start}
        onClose={() => (setFromImport(null), setImporting(false))}
        teamEditing={{
          maps: reference.maps,
          heroes: reference.heroes,
          artifacts: reference.artifacts,
          phantimals: reference.phantimals,
          rules: reference.heroRules,
          onSave: async (round, profileId, teams) => {
            await api.saveRoundDeployment(round.tournamentId, round.round, profileId, teams);
          },
        }}
        onProfileCreated={(profile) => {
          patchReference((old) => ({ profiles: [...old.profiles, profile] }));
        }}
        onReview={async (groups, options) => {
          const saved = await savedOfMode();
          const deployments = await loadRoundDeployments(options.round, reference.profiles, saved);
          const rosters = await rostersOf(groups);
          // two groups of the same two Players in one import are the same Battle seen from both sides (or a rematch): the first one only
          const firstOf = new Map<string, number>();
          const problems: Record<string, string[]> = {};
          const info: Record<string, string[]> = {};
          const changes: Record<string, NonNullable<Clone['teamChanges']>> = {};
          groups.forEach((g, index) => {
            const clone = cloneFromImport(reference, g, saved, options.reuse, options.groups, options.round, deployments, rosters);
            const found = clone.problems ?? [];
            const pair = pairOf(g);
            const earlier = pair ? firstOf.get(pair) : undefined;
            if (pair && earlier === undefined) firstOf.set(pair, index);
            problems[g.key] = earlier === undefined ? found : [...found, `the same two Players as battle ${earlier + 1} of this import: save one, then open this one`];
            info[g.key] = clone.reused ?? [];
            changes[g.key] = clone.teamChanges ?? [];
          });
          return { problems, info, deployments, changes };
        }}
        onSaveBatch={async (ready, options) => {
          const saved = await savedOfMode();
          const deployments = await loadRoundDeployments(options.round, reference.profiles, saved);
          const rosters = await rostersOf(ready);
          const done: string[] = [];
          const errors: string[] = [];
          const sends: Promise<FeedbackAnswer | null>[] = [];
          const who = (group: ImportGroup) => `${group.pictures[0]!.draft.sideA.name ?? '?'} against ${group.pictures[0]!.draft.sideB.name ?? '?'}`;
          for (const group of ready) {
            try {
              const clone = cloneFromImport(reference, group, saved, options.reuse, options.groups, options.round, deployments, rosters);
              if ((clone.problems ?? []).length > 0) throw new Error(clone.problems!.join('; '));
              const filled = clone.drafts.map((d, index) => ({ d, index })).filter(({ d }) => d.formation.placed.length > 0 || d.opponent.placed.length > 0);
              // a Super League Battle is all five fights (ADR 0021): a partial one is opened in the form and saved there by hand
              if (options.round && filled.length !== TEAMS_PER_MODE[group.mode]) throw new Error(`only ${filled.length} of ${TEAMS_PER_MODE[group.mode]} fights have a team`);
              const result = await api.createArenaBattleGroup(group.mode, filled.map(({ d, index }) => ({ ...toInput(group.mode, d), position: index + 1 })), { formationId: '', opponentFormationId: '' }, { tournamentId: options.round.tournamentId, round: options.round.round });
              done.push(group.key);
              // The Battle is saved from here on, so a step that fails is told after "saved" and never makes the Battle a failed one.
              const left: (string | null)[] = [];
              // the tiles the Battle was saved with go to the confirmed Round Deployment teams that had none (ADR 0021)
              left.push(await stepAfterSave(() => fillSavedDeploymentTiles(options.round, clone.drafts, clone.profiles ?? { A: null, B: null }, deployments), 'The Round Deployment could not be given the tiles'));
              // offer the roster update of each side, as the form does after a save
              left.push(await stepAfterSave(() => syncSavedBattle(clone, result.fights.map((fight) => fight.id))));
              // what the pictures said against what was kept (ADR 0016): reported outside the app, a failure changes nothing and stays silent
              const feedback = feedbackOf(filled.map(({ d }) => d));
              if (feedback.length > 0) sends.push(sendFeedback(group.mode, feedback));
              const pictures = filled.flatMap(({ d }, i) => (d.imported?.picture && result.fights[i] ? [{ attemptId: result.fights[i]!.id, ...d.imported.picture }] : []));
              if (pictures.length > 0) left.push(await stepAfterSave(() => pictures.reduce((all, p) => all.then(() => api.keepPicture(p.attemptId, p.label, p.data)).then(() => undefined), Promise.resolve()), 'The pictures could not be kept'));
              const problems = joinNotices(left);
              if (problems) errors.push(`${who(group)}: saved. ${problems}`);
            } catch (e) {
              errors.push(`${who(group)}: ${(e as Error).message}`);
            }
          }
          // one toast for the whole batch, once every answer is in; the batch does not wait for it
          reportParked(sends);
          if (done.length > 0) void reload();
          return { saved: done, errors };
        }}
        onOpen={async (group, options) => {
          // the saved fights of the mode, to put a known player's heroes where they stood
          const saved = await savedOfMode(group.mode === 'Super League' && options.round ? 'Super League' : group.mode);
          const deployments = options.round ? await loadRoundDeployments(options.round, reference.profiles, saved) : [];
          const rosters = await rostersOf([group]);
          setFromImport({ start: { mode: group.mode, tournamentId: options.round?.tournamentId ?? null, round: options.round?.round ?? null, openNext: false }, dismiss: options.dismiss });
          setImporting(false);
          setEditing(null);
          setCloning(cloneFromImport(reference, group, saved, options.reuse, options.groups, options.round, deployments, rosters));
          setAdding(true);
        }}
        onRepair={async (action, round) => {
          if (action.kind === 'delete') await api.deleteRoundDeployment(round.tournamentId, round.round, action.profileId);
          else await api.moveRoundDeployment(round.tournamentId, round.round, action.profileId, action.to);
        }}
        onTeamChange={async (change, round) => {
          // the Team change replaces one team of the Deployment for the rest of the Round (ADR 0021)
          const current = await loadRoundDeployments(round, reference.profiles);
          const entry = current.find((e) => e.profileId === change.profileId);
          if (!entry) return;
          await api.saveRoundDeployment(round.tournamentId, round.round, change.profileId, applyTeamChange(entry.teams, change.slot, change.team));
        }}
      />
      {sync.dialog}
      </>
    );
  if (adding)
    return (
      <NewBattles
        reference={reference}
        patchReference={patchReference}
        initial={cloning}
        onSaved={fromImport ? (left) => void backToImport(true, left) : done}
        onRecorded={() => void reload()}
        onCancel={fromImport ? () => void backToImport(false) : () => (setAdding(false), setCloning(null))}
        cancelLabel={fromImport ? 'Back to the import' : undefined}
      />
    );
  if (editingBattle) return <NewBattles key={`battle-${editingBattle.id}`} reference={reference} patchReference={patchReference} initial={editingBattle.clone} editing={editingBattle.id} savedRound={editingBattle.tournamentId != null && editingBattle.round ? { tournamentId: editingBattle.tournamentId, round: editingBattle.round } : null} onSaved={done} onRecorded={() => undefined} onCancel={() => setEditingBattle(null)} />;
  if (editing) return <EditBattle key={editing.id} battle={editing} reference={reference} patchReference={patchReference} onSaved={done} onCancel={() => setEditing(null)} />;

  return (
    <div>
      <RecordToolbar list={list} group="battle" newLabel="New battles" onNew={() => (setEditing(null), setCloning(null), setAdding(true))}>
        <button onClick={() => (setFromImport(null), setImporting(true))} title={waiting > 0 ? `${waiting} pictures wait in the import queue: open to carry on` : 'Read battle reports from screenshots and start the records from them'}>
          Import from pictures
          {waiting > 0 && <span className="badge"> {waiting} waiting</span>}
        </button>
        <MultiSelect label="Mode" options={[...ARENA_MODES]} value={mode} onChange={setMode} />
        <TagFilter value={tag} onChange={setTag} />
        <label className="field">
          Player
          <input type="search" value={player} placeholder="Name or Player ID" onChange={(e) => setPlayer(e.target.value)} />
        </label>
      </RecordToolbar>
      <RecordListView
        list={list}
        loaded={loaded}
        error={error}
        notice={notice}
        label="Battles"
        battle="battle"
        fight="fight"
        renderItem={renderItem}
        older={battles.length >= limit}
        olderLabel="Show older battles"
        onOlder={showMore}
        empty={battles.length === 0}
        filtered={mode.length > 0 || tag.length > 0 || player.trim() !== ''}
        none="No battles recorded yet."
        noMatch="No battles match these filters."
      />
      {dialog}
    </div>
  );
}
