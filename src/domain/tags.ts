const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

/**
 * Cleans free-text tags: trimmed, inner whitespace collapsed, duplicates dropped ignoring case.
 * Absent input means "leave the tags alone" and gives `tags: undefined`.
 */
export function normalizeTags(input: unknown): { tags: string[] | undefined } | { error: string } {
  if (input === undefined) return { tags: undefined };
  if (!Array.isArray(input)) return { error: 'Tags must be a list of text' };
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return { error: 'Tags must be a list of text' };
    const tag = raw.trim().replace(/\s+/g, ' ');
    if (tag === '') continue;
    if (tag.length > MAX_TAG_LENGTH) return { error: `A tag is at most ${MAX_TAG_LENGTH} characters` };
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { error: `At most ${MAX_TAGS} tags per record` };
  return { tags };
}
