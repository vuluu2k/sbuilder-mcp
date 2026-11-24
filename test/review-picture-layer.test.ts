import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { reviewDesign } from '../src/domains/site/review.js';

/**
 * THE BANNER PATTERN (measured 2026-11-24, Basix home): a card holds an EMPTY,
 * absolutely-positioned block carrying the photo, and a sibling with white copy
 * above it. Review called the photo layer an empty band ("remove it with
 * sb_remove") and the white copy invisible on the section's white.
 */
const N = (id: string, type: string, parent: string | null, nodes: string[], style: Record<string, unknown> = {}, specials: Record<string, unknown> = {}) => ({
  id, data: { type, parent, nodes }, style, config: {}, specials,
});
function banner(layer: 'photo' | 'none' | 'bare' | 'beside') {
  const kids = layer === 'none' ? ['copy'] : ['bg', 'copy'];
  return PageDoc.from({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: N('ROOT', 'root', null, ['sec']),
      sec: N('sec', 'flex-section', 'ROOT', ['card'], { backgroundColor: '#FFFFFF' }),
      card: N('card', 'flex-block', 'sec', kids, { position: 'relative', height: '443px' }),
      bg: N('bg', 'flex-block', 'card', [], layer === 'beside'
        ? { height: '200px', backgroundImage: 'url(https://x/p.jpg)' }
        : layer === 'photo'
        ? { position: 'absolute', top: '0px', left: '0px', right: '0px', bottom: '0px', backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,.55), rgba(0,0,0,0)), url(https://x/p.jpg)' }
        : { position: 'absolute' }),
      copy: N('copy', 'flex-block', 'card', ['h'], { position: 'relative', zIndex: '1' }),
      h: N('h', 'heading', 'copy', [], { color: '#FFFFFF' }, { text: 'Đồ thường ngày', htmlTag: 'h3' }),
    },
  } as never);
}
const at = (d: PageDoc, code: string) => reviewDesign(d).filter((f) => f.code === code).map((f) => f.nodeId);

describe('a picture layer is a ground, not an empty band', () => {
  it('white copy over an absolute photo layer is not invisible', () => {
    expect(at(banner('photo'), 'invisible_text'), 'flagged over a photo').toEqual([]);
  });
  it('liveness: the same copy with no photo layer IS invisible on the white section', () => {
    expect(at(banner('none'), 'invisible_text'), 'rule no longer fires at all').toEqual(['h']);
  });
  it('liveness: an absolute layer that paints NOTHING does not hide the white ground', () => {
    expect(at(banner('bare'), 'invisible_text'), 'a bare absolute block was read as a picture').toEqual(['h']);
  });
  it('an empty block painting the photo is not an empty container', () => {
    expect(at(banner('photo'), 'empty_container'), 'photo layer called empty').toEqual([]);
  });
  it('liveness: an empty block painting nothing still is', () => {
    expect(at(banner('bare'), 'empty_container'), 'rule no longer fires at all').toEqual(['bg']);
  });
  it('liveness: a photo BESIDE the copy (not laid over it) leaves the white ground', () => {
    expect(at(banner('beside'), 'invisible_text'), 'a static sibling photo was read as the ground').toEqual(['h']);
  });
});
