import { describe, it, expect } from 'vitest';
import { addSubtree } from '../src/domains/site/builder.js';
import { emptyDoc } from './helpers/doc.js';

/**
 * SATELLITES ON THE MAP.
 *
 * A satellite is a real node holding a real look — the variant option's box, the
 * quantity stepper's buttons — but it hangs off `config[key]` instead of
 * `data.nodes`, so a walk of the child lists misses it. A whole storefront
 * shipped with platform-default grey selects on a rose-and-ink page because the
 * outline never showed they existed.
 */
describe('outline() and the satellites', () => {
  function pageWithStepper() {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'quantity-dataset' }],
    });
    doc.apply(patches);
    return { doc, ids };
  }

  it('lists a satellite and names the config key it hangs off', () => {
    const { doc } = pageWithStepper();
    const flat: Array<{ type: string; satellite?: string }> = [];
    const walk = (ns: ReturnType<typeof doc.outline>) => {
      for (const n of ns) {
        flat.push(n);
        if (n.kids) walk(n.kids);
      }
    };
    walk(doc.outline({ depth: 6 }));
    const btn = flat.find((n) => n.type === 'quantity-button');
    const input = flat.find((n) => n.type === 'quantity-input');
    expect(btn?.satellite).toBe('quantityButtonId');
    expect(input?.satellite).toBe('quantityInputId');
  });

  it('keeps `children` counting data.nodes only, so an index still means what it meant', () => {
    const { doc, ids } = pageWithStepper();
    const stepper = doc.outline({ depth: 6 })[0].kids!.find((k) => k.type === 'quantity-dataset')!;
    // Two satellites are listed under it, and it still holds no content children.
    expect(stepper.children).toBe(0);
    expect(stepper.kids?.every((k) => !!k.satellite)).toBe(true);
    expect(ids).toContain(stepper.id);
  });

  it('says nothing about an element that owns none', () => {
    const doc = emptyDoc();
    const { patches } = addSubtree(doc, 'ROOT', { type: 'heading' });
    doc.apply(patches);
    expect(doc.outline({ depth: 4 })[0].satellite).toBeUndefined();
    expect(doc.outline({ depth: 4 })[0].kids).toBeUndefined();
  });
});
