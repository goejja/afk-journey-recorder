// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RankText } from '../../web/RankText.js';

afterEach(cleanup);

describe('RankText', () => {
  it('writes a plain rank in its own colour', () => {
    const { container } = render(<RankText rank="Epic" />);
    expect(container.querySelectorAll('.rank-colour')).toHaveLength(1);
    expect(container.querySelector('.rank-colour-epic')?.textContent).toBe('Epic');
  });

  it('writes the "+" of a "+" rank in the next rank colour', () => {
    const { container } = render(<RankText rank="Legendary+" />);
    expect(container.querySelector('.rank-colour-legendary')?.textContent).toBe('Legendary');
    expect(container.querySelector('.rank-colour-mythic')?.textContent).toBe('+');
  });

  it('shows Not set without a colour when the rank is missing', () => {
    const { container } = render(<RankText rank={null} />);
    expect(container.textContent).toBe('Not set');
    expect(container.querySelector('.rank-colour')).toBeNull();
  });
});
