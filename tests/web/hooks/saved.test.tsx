// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { joinNotices, stepAfterSave } from '../../../web/hooks/saved.js';

describe('stepAfterSave', () => {
  it('says nothing when the step works, and a sentence, not an error, when it fails', async () => {
    expect(await stepAfterSave(async () => undefined)).toBeNull();
    expect(await stepAfterSave(() => Promise.reject(new Error('Network down')))).toBe('The roster could not be updated: Network down.');
  });

  it('names what could not be done, and joins the sentences of several steps, or none', async () => {
    const pictures = await stepAfterSave(() => Promise.reject(new Error('Too big')), 'The pictures could not be kept');
    expect(pictures).toBe('The pictures could not be kept: Too big.');
    const roster = await stepAfterSave(() => Promise.reject(new Error('Network down')));
    expect(joinNotices([null, pictures, roster])).toBe('The pictures could not be kept: Too big. The roster could not be updated: Network down.');
    expect(joinNotices([null, null])).toBeNull();
  });
});
