import { useId, useMemo, useState } from 'react';
import { MultiSelect } from './MultiSelect.js';
import { api } from './backend.js';
import { useLoad } from './useLoad.js';

/** Every tag in use, for suggestions. A failed load just means no suggestions. */
function useKnownTags(): string[] {
  const { data } = useLoad(() => api.tags(), []);
  return useMemo(() => data?.map((t) => t.tag) ?? [], [data]);
}

/** Free-text tags as removable chips; Enter or a comma adds one, and existing tags are suggested. `locked` tags are shown beside them and cannot be removed. */
export function TagInput({ value, onChange, locked = [] }: { value: string[]; onChange: (tags: string[]) => void; locked?: { tag: string; title: string }[] }) {
  const [text, setText] = useState('');
  const listId = useId();
  const known = useKnownTags();

  function add(raw: string) {
    const tag = raw.trim().replace(/\s+/g, ' ');
    setText('');
    if (tag && !value.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
  }

  return (
    <div className="field">
      <span className="field-caption">Tags</span>
      <div className="tags">
        {locked.map(({ tag, title }) => (
          <span key={tag} className="badge tag" title={title}>
            {tag}
          </span>
        ))}
        {value.map((tag) => (
          <span key={tag} className="badge tag">
            {tag}
            <button type="button" className="tag-remove" aria-label={`Remove tag ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
              ×
            </button>
          </span>
        ))}
        <input
          aria-label={'Add tag'}
          list={listId}
          placeholder={'Add tag'}
          value={text}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(text);
            }
          }}
          onBlur={() => add(text)}
        />
        <datalist id={listId}>
          {known.filter((t) => !value.includes(t)).map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
    </div>
  );
}

/** A single choice among the tags in use, for what must name exactly one tag (Cleanup, which deletes); an empty value means every record. */
export function TagSelect({ value, onChange }: { value: string; onChange: (tag: string) => void }) {
  const known = useKnownTags();
  return (
    <select aria-label="Tag" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All tags</option>
      {known.map((t) => (
        <option key={t}>{t}</option>
      ))}
    </select>
  );
}

/** A filter over the tags in use: a record matches when it has any of the chosen tags, and no choice means every record. */
export function TagFilter({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const known = useKnownTags();
  return <MultiSelect label="Tag" options={known} value={value} onChange={onChange} />;
}

/** Tags as badges. */
export function TagBadges({ tags }: { tags: string[] }) {
  return (
    <>
      {tags.map((t) => (
        <span key={t} className="badge tag">
          {t}
        </span>
      ))}
    </>
  );
}
