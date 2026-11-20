// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisclosureMark, Icon, IconButton } from '../../web/ui/Icon.js';

afterEach(cleanup);

describe('Icon', () => {
  it('is an inline SVG that is hidden from the accessibility tree', () => {
    const { container } = render(<Icon name="info" />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.classList.contains('icon')).toBe(true);
  });

  it('draws the chevrons solid and the other shapes as strokes', () => {
    const { container } = render(
      <>
        <Icon name="chevron-right" />
        <Icon name="close" />
      </>,
    );
    const [solid, stroke] = [...container.querySelectorAll('svg')];
    expect(solid!.classList.contains('icon-solid')).toBe(true);
    expect(stroke!.classList.contains('icon-solid')).toBe(false);
  });
});

describe('DisclosureMark', () => {
  it('points right when closed and down when open', () => {
    const closed = render(<DisclosureMark open={false} />).container.querySelector('path')!.getAttribute('d');
    cleanup();
    const open = render(<DisclosureMark open />).container.querySelector('path')!.getAttribute('d');
    expect(closed).not.toBe(open);
    expect(closed).toBe('M5 2.8 12 8l-7 5.2z');
    expect(open).toBe('M2.8 5 8 12l5.2-7z');
  });
});

describe('IconButton', () => {
  it('is named by its label, shows it as the tooltip, and is not a submit button', () => {
    render(<IconButton icon="close" label="Remove tag Arena" onClick={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Remove tag Arena' });
    expect(button.getAttribute('title')).toBe('Remove tag Arena');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.textContent).toBe('');
  });

  it('calls onClick and passes its class', () => {
    const onClick = vi.fn();
    render(<IconButton icon="minus" className="tag-remove" label="One fewer Grunt" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'One fewer Grunt' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.className).toBe('tag-remove');
  });
});
