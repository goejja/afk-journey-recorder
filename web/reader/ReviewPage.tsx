import { useCallback, useEffect, useRef, useState } from 'react';
import { api, learnedLookUrl, type ReviewExplainJob, type ReviewRun, type ThinningKind } from '../backend.js';
import { ReviewFindingsView } from './ReviewFindings.js';
import { usePolling } from '../useLoad.js';

/** The Reader review (ADR 0031): what the code finds in the reader's data, here the near-identical pictures Thinning would remove. */
export function ReviewPage() {
  // undefined while the last run is being fetched, null when there is none yet
  const [run, setRun] = useState<ReviewRun | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<ReviewExplainJob | null>(null);
  // only an explanation seen going and then done reloads the run; one found finished on arrival is already in it
  const seenRunning = useRef(false);
  const [rank, setRank] = useState<ThinningKind | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [distance, setDistance] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const found = (await api.thinningProposal()).kinds.find((k) => k.kind === 'rank') ?? null;
      setRank(found);
      // the whole offer is ticked: the player unticks what stays
      setTicked(new Set(found?.groups.flatMap((g) => g.remove) ?? []));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
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

  const lookJob = useCallback(async () => {
    try {
      const next = await api.reviewExplainJob();
      const was = seenRunning.current;
      seenRunning.current = next?.state === 'running';
      setJob(next);
      if (was && next?.state === 'done') void loadRun();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [loadRun]);

  useEffect(() => {
    void lookJob();
  }, [lookJob]);
  usePolling(lookJob, job?.state === 'running');

  async function askAgent() {
    try {
      const next = await api.askAgentAboutReview(run!.id);
      seenRunning.current = next.state === 'running';
      setJob(next);
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
    void load();
    void loadRun();
    api.thinningSettings().then((s) => setDistance(String(s.rank)), (e: Error) => setError(e.message));
  }, [load, loadRun]);

  async function saveDistance() {
    try {
      setDistance(String((await api.saveThinningSettings(Number(distance))).rank));
      setMessage(null);
      await load();
    } catch (e) {
      setError(`Could not save the distance: ${(e as Error).message}`);
    }
  }

  async function apply() {
    try {
      const { deleted } = await api.applyThinning('rank', [...ticked].sort((a, b) => a - b));
      setMessage(`Removed ${deleted} Rank Looks.`);
      await load();
    } catch (e) {
      setError(`Could not remove the pictures: ${(e as Error).message}`);
    }
  }

  const toggle = (id: number) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
                  <li key={id} className="reader-tile">
                    <img src={learnedLookUrl('rank', id)} alt={`Rank Look ${id} stays`} loading="lazy" />
                    <span className="muted">Stays</span>
                  </li>
                ))}
                {g.remove.map((id) => (
                  <li key={id} className="reader-tile">
                    <img src={learnedLookUrl('rank', id)} alt={`Rank Look ${id} to remove`} loading="lazy" />
                    <label className="check">
                      <input type="checkbox" checked={ticked.has(id)} onChange={() => toggle(id)} aria-label={`Remove Rank Look ${id}`} /> Remove
                    </label>
                  </li>
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
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
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
        <p className="error" role="alert">
          Could not explain the run: {job.error}
        </p>
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
        onChanged={() => {
          setMessage(null);
          void startRun();
          void load();
        }}
        onDismissalChanged={() => void loadRun()}
        onError={setError}
      >
        {thinning}
      </ReviewFindingsView>
    </section>
  );
}
