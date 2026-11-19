import { useEffect, useState } from 'react';
import { matchFiles } from '../../src/domain/image-match.js';
import { api, type ImageSource } from '../backend.js';
import { CropEditor } from './CropEditor.js';
import { bumpImageVersion, Portrait, type ImageKind } from '../Portrait.js';
import { useLoad } from '../useLoad.js';
import { ListStatus } from '../ui/ListStatus.js';

const KINDS: { kind: ImageKind; label: string }[] = [
  { kind: 'hero', label: 'Heroes' },
  { kind: 'enemy', label: 'Enemies' },
  { kind: 'phantimal', label: 'Phantimals' },
  { kind: 'boss', label: 'Bosses' },
  { kind: 'artifact', label: 'Artifacts' },
];

const SOURCE_LABEL: Record<ImageSource, string> = { custom: 'your image', imported: 'imported', none: 'no image' };

const NO_UNITS: { name: string; source: ImageSource }[] = [];

export function ImagesPage() {
  const [kind, setKind] = useState<ImageKind>('hero');
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [cropping, setCropping] = useState<{ name: string; file: File } | null>(null);

  const loaded = useLoad(() => api.images(kind), [kind]);
  const units = loaded.data ?? NO_UNITS;
  const reload = loaded.reload;
  // an answer clears what an action here failed to do, as the answer of the list did before
  useEffect(() => {
    if (loaded.data) setError(null);
  }, [loaded.data]);

  async function change(action: () => Promise<void>) {
    try {
      await action();
      bumpImageVersion(); // every portrait on screen reloads
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Uploads picked files to the units their file names match, and says what it could not place. */
  async function uploadMany(files: File[]) {
    const { matched, unmatched, ambiguous } = matchFiles(files, units.map((u) => u.name));
    let uploaded = 0;
    const failed: string[] = [];
    for (const { name, file } of matched) {
      try {
        await api.uploadImage(kind, name, file);
        uploaded += 1;
      } catch (e) {
        failed.push(`${file.name} (${(e as Error).message})`);
      }
    }
    if (uploaded > 0) bumpImageVersion();
    await reload();
    const parts = [`Uploaded ${uploaded} image${uploaded === 1 ? '' : 's'}.`];
    if (unmatched.length) parts.push(`No unit matches: ${unmatched.join(', ')}.`);
    if (ambiguous.length) parts.push(`Skipped, more than one file for the same unit: ${ambiguous.join(', ')}.`);
    if (failed.length) parts.push(`Failed: ${failed.join(', ')}.`);
    setReport(parts.join(' '));
  }

  const visible = units.filter(
    (u) => (!search || u.name.toLowerCase().includes(search.toLowerCase())) && (!missingOnly || u.source === 'none'),
  );
  const missing = units.filter((u) => u.source === 'none').length;

  return (
    <section>
      <div className="toolbar">
        <span className="muted">{missing} of {units.length} have none</span>
      </div>
      {(error ?? loaded.error) && (
        <p className="error" role="alert">
          {error ?? loaded.error}
        </p>
      )}
      <div className="filters">
        <select aria-label="Kind" value={kind} onChange={(e) => (setKind(e.target.value as ImageKind), setReport(null))}>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
        <input placeholder="Search" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="upload">
          <input
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            aria-label="Upload several images"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              if (files.length) void uploadMany(files);
            }}
          />
          Upload several images
        </label>
        <label className="check">
          <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Missing only
        </label>
      </div>
      {report && <p role="status">{report}</p>}
      <p className="muted">Name the files after the units (for example Bladestorm.png) to upload many at once; "Item Bladestorm Spell (Veil of Memories).png" works too. PNG, JPEG, WebP or GIF, up to 2 MB. Your image replaces the imported one; removing it brings the imported one back. "Crop and frame" lets you drag and zoom a picture into the hexagonal frame the imported portraits have; "Upload image" keeps the file as it is.</p>

      {cropping && (
        <CropEditor
          key={cropping.name}
          name={cropping.name}
          file={cropping.file}
          onCancel={() => setCropping(null)}
          onSave={(file) => {
            const name = cropping.name;
            setCropping(null);
            void change(() => api.uploadImage(kind, name, file));
          }}
        />
      )}

      <div className={`grid${loaded.loading && loaded.data ? ' refreshing' : ''}`} aria-busy={loaded.loading}>
        {visible.map((u) => (
          <article key={u.name} className="card owned">
            <div className="card-main static">
              <Portrait kind={kind} name={u.name} size={72} />
              <span className="name">{u.name}</span>
              <span className="meta">{SOURCE_LABEL[u.source]}</span>
            </div>
            <div className="state">
              <label className="upload">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label={`Upload image for ${u.name}`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void change(() => api.uploadImage(kind, u.name, file));
                  }}
                />
                {u.source === 'custom' ? 'Replace image' : 'Upload image'}
              </label>
              {kind !== 'artifact' && (
                <label className="upload">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    aria-label={`Crop and frame image for ${u.name}`}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) setCropping({ name: u.name, file });
                    }}
                  />
                  Crop and frame…
                </label>
              )}
              {u.source === 'custom' && (
                <button onClick={() => void change(() => api.removeImage(kind, u.name))}>Remove mine</button>
              )}
            </div>
          </article>
        ))}
      </div>
      <ListStatus loaded={loaded.data !== undefined} failed={loaded.error !== null} empty={visible.length === 0} filtered={search !== '' || missingOnly} none="Nothing to show." noMatch="No image matches these filters." />
    </section>
  );
}
