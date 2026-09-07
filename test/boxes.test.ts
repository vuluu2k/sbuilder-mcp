import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { boxesForResponse } from '../src/vision/boxes.js';

function doc() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'flex-block', children: [{ type: 'heading' }] }],
  });
  d.apply(patches);
  return { d, ids }; // ids[0] section (depth 1), ids[1] box (depth 2), ids[2] heading (depth 3)
}

describe('boxesForResponse()', () => {
  it('keeps nodes at depth <= the limit, as tuples', () => {
    const { d, ids } = doc();
    const boxes = ids.map((id, i) => ({ id, type: 't', x: i, y: 0, w: 10, h: 10 }));
    const out = boxesForResponse(d.doc, boxes, 2);
    expect(out.map((t) => t[0])).toEqual([ids[0], ids[1]]);
    expect(out[0]).toEqual([ids[0], 't', 0, 0, 10, 10]);
  });

  it('drops boxes for ids the document does not know (an overlay interior)', () => {
    const { d } = doc();
    expect(boxesForResponse(d.doc, [{ id: 'ghost', type: 't', x: 0, y: 0, w: 1, h: 1 }], 6)).toEqual([]);
  });

  it('keeps ROOT', () => {
    const { d } = doc();
    const out = boxesForResponse(d.doc, [{ id: 'ROOT', type: 'root', x: 0, y: 0, w: 1, h: 1 }], 1);
    expect(out[0][0]).toBe('ROOT');
  });
});

describe('boxesForResponse() with a framed node', () => {
  it('counts depth from the framed node and keeps only its subtree', () => {
    const { d, ids } = doc();
    const boxes = [
      { id: 'ROOT', type: 'root', x: 0, y: 0, w: 1, h: 1 },
      ...ids.map((id, i) => ({ id, type: 't', x: i, y: 0, w: 10, h: 10 })),
    ];
    // Frame the flex-block (depth 2 in the page): it and its heading come back, ROOT and the section do not.
    const out = boxesForResponse(d.doc, boxes, 1, ids[1]);
    expect(out.map((t) => t[0])).toEqual([ids[1], ids[2]]);
  });
});
