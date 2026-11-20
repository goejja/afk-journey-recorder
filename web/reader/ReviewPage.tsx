import { memo, useCallback, useEffect, useState } from 'react';
import { api, learnedLookUrl, type ReviewFinding, type ReviewRun, type ThinningKind } from '../backend.js';
import { ReviewFindingsView } from './ReviewFindings.js';
import { useJobFinished, useJobs } from '../jobs/JobsProvider.js';
import { Notice } from '../ui/Notice.js';
import { useToast } from '../ui/Toast.js';

/** One picture of a Thinning group; it renders again only when its own tick changes, not each time another is ticked among the many. */
const ThinningTile = memo(function ThinningTile({ id, remove, ticked, onToggle }: { id: number; remove: boolean; ticked: boolean; onToggle: (id: number) => void }) {
  return (
    <li className="reader-tile">
      <img src={learnedLookUrl('rank', id)} alt={`Rank Look ${id} ${remove ? 'to remove' : 'stays'}`} loading="lazy" />
      {remove ? (
        <label className="check">
          <input type="checkbox" checked={ticked} onChange={() => onToggle(id)} aria-label={`Remove Rank Look ${id}`} /> Remove
        </label>
      ) : (
        <span className="muted">Stays</span>
      )}
    </li>
  );
});

/** The Reader review (ADR 0031): what the code finds in the reader's data, here the near-identical pictures Thinning would remove. */
export function ReviewPage() {
  const toast = useToast();
  // undefined while the last run is being fetched, null when there is none yet
  const [run, setRun] = useState<ReviewRun | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const { summary } = useJobs();
  const job = summary?.review ?? null;
  // undefined until the player asks: the proposal compares every Rank Look with the others, which keeps the server busy for seconds
  const [rank, setRank] = useState<ThinningKind | null | undefined>(undefined);
  const [looking, setLooking] = useState(false);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [distance, setDistance] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLooking(true);
    try {
      const found = (await api.thinningProposal()).kinds.find((k) => k.kind === 'rank') ?? null;
      setRank(found);
      // the whole offer is ticked: the player unticks what stays
      setTicked(new Set(found?.groups.flatMap((g) => g.remove) ?? []));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLooking(false);
    }
  }, []);

  const loadRun = useCallback(async () => {
    try {
      setRun(await api.latestReviewRun());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // only an explanation seen going and then done reloads the run; one found finished on arrival is already in it
  useJobFinished('review', (event) => event.state === 'done' && void loadRun());

  async function askAgent() {
    try {
      await api.askAgentAboutReview(run!.id);
      setError(null);
    } catch (e) {
      setError(`Could not ask the Agent: ${(e as Error).message}`);
    }
  }

  /** Looks again at the readers' data, which takes seconds, and keeps the result as a Review run. */
  async function startRun() {
    setRunning(true);
    try {
      setRun(await api.startReviewRun());
      setError(null);
    } catch (e) {
      setError(`Could not run the review: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void loadRun();
    api.thinningSettings().then((s) => setDistance(String(s.rank)), (e: Error) => setError(e.message));
  }, [loadRun]);

  async function saveDistance() {
    try {
      setDistance(String((await api.saveThinningSettings(Number(distance))).rank));
      if (rank !== undefined) await load();
    } catch (e) {
      setError(`Could not save the distance: ${(e as Error).message}`);
    }
  }

  async function apply() {
    try {
      const { deleted } = await api.applyThinning('rank', [...ticked].sort((a, b) => a - b));
      toast(`Removed ${deleted} Rank Looks.`);
      await load();
    } catch (e) {
      setError(`Could not remove the pictures: ${(e as Error).message}`);
    }
  }

  const toggle = useCallback(
    (id: number) =>
      setTicked((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  /** What the player did to some findings is done: they leave the run shown, and nothing is looked at again until the player asks. */
  function resolved(done: ReviewFinding[]) {
    const gone = new Set(done.map((f) => `${f.code}\u0000${f.subject}`));
    const without = (list: ReviewFinding[]) => list.filter((f) => !gone.has(`${f.code}\u0000${f.subject}`));
    setRun((current) => {
      if (!current) return current;
      const { wrong, obsolete, improve, kept } = current.findings;
      return { ...current, findings: { wrong: without(wrong), obsolete: without(obsolete), improve: without(improve), kept } };
    });
    if (rank !== undefined) void load();
  }

  const thinning = (
    <>
      <p className="muted">
        Thinning: Rank Looks that are almost identical add nothing to the rank reader. The ticked ones are proposed for removal; the one that stays in each group is the most typical, and a group never goes below 3.
        A removal is offered only if the reader reads no worse without it.
      </p>
      <div className="toolbar">
        <label>
          Rank Looks are alike closer than{' '}
          <input type="number" step="0.005" min="0" max="0.2" value={distance} onChange={(e) => setDistance(e.target.value)} />
        </label>
        <button onClick={() => void saveDistance()}>Save distance</button>
      </div>
      {rank === undefined && (
        <button disabled={looking} onClick={() => void load()}>
          {looking ? 'Looking…' : 'Look for pictures to remove'}
        </button>
      )}
      {rank && (
        <>
          <p>
            {rank.counts.looks} Rank Looks now, {rank.counts.looksAfter} after. Reading each look from the others, {rank.counts.wrong} read wrong now, {rank.counts.wrongAfter} after.
          </p>
          {rank.groups.map((g) => (
            <article key={g.group} className="panel reader-hero" aria-label={g.group}>
              <h4>
                {g.group} <span className="muted">{g.keep.length + g.remove.length}</span>
              </h4>
              <ul className="reader-tiles">
                {g.keep.map((id) => (
                  <ThinningTile key={id} id={id} remove={false} ticked={false} onToggle={toggle} />
                ))}
                {g.remove.map((id) => (
                  <ThinningTile key={id} id={id} remove ticked={ticked.has(id)} onToggle={toggle} />
                ))}
              </ul>
            </article>
          ))}
          {rank.groups.length === 0 ? (
            <p className="muted">No Rank Look can be removed.</p>
          ) : (
            <button className="danger" disabled={ticked.size === 0} onClick={() => void apply()}>
              Remove {ticked.size} ticked
            </button>
          )}
        </>
      )}
    </>
  );

  return (
    <section>
      {error && (
        <Notice kind="error">
          {error}
        </Notice>
      )}
      <div className="toolbar">
        <button disabled={running} onClick={() => void startRun()}>
          {running ? 'Running…' : 'Run review'}
        </button>
        {run && (
          <button disabled={running || job?.state === 'running'} onClick={() => void askAgent()}>
            {job?.state === 'running' ? 'Asking…' : 'Ask the Agent'}
          </button>
        )}
        {run && <span className="muted">Last run: {run.createdAt.slice(0, 16)}</span>}
      </div>
      {job?.state === 'failed' && job.runId === run?.id && (
        <Notice kind="error">
          Could not explain the run: {job.error}
        </Notice>
      )}
      {run?.explanation && (
        <section aria-label="Agent's explanation">
          <h3>Agent's explanation</h3>
          {run.explanation.at && <p className="muted">Written {run.explanation.at.slice(0, 16)}</p>}
          <pre className="estimate">{run.explanation.text}</pre>
        </section>
      )}
      <ReviewFindingsView
        findings={run?.findings ?? null}
        dismissed={run?.dismissed ?? []}
        placeholder={run === undefined ? 'Looking for the last run…' : 'No review has been run yet.'}
        onChanged={resolved}
        onDismissalChanged={() => void loadRun()}
        onError={setError}
      >
        {thinning}
      </ReviewFindingsView>
    </section>
  );
}
