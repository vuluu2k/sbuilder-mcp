import { describe, it, expect } from 'vitest';
import { bindingsForConfig, createNode } from '../src/domains/site/node.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { bindNode } from '../src/tools/live.js';
import { traitsFor } from '../src/catalog/element-search.js';
import { BASE_ONLY_CONFIG, RECORD_BINDING_PROBES } from '../src/catalog/elements.generated.js';
import { PageDoc } from '../src/domains/site/document.js';
import { emptyDoc } from './helpers/doc.js';

/**
 * COLLECTIONS RECORD LISTS (web_builder PR #117). A `list-dataset` with
 * `datasetSource: 'record'` repeats a merchant collection's published records;
 * its tiles name a FIELD ID in `config.recordField`, and the binding is derived
 * from that — a dynamic value the `${source}|${kind}` table cannot hold.
 */

const FID = 'fld_0123456789abcdef';
const FID2 = 'fld_fedcba9876543210';
type B = { id: string; source: string; field: string; target?: { type: string; kind: string } };
const first = (n: { bindings: unknown[] }) => (n.bindings as B[])[0];

describe('record tile bindings are derived from recordField / recordFieldType', () => {
  it('a text tile binds record.<fid> into boundText', () => {
    const b = bindingsForConfig('text-dataset', { datasetSource: 'record', recordField: FID, recordFieldType: 'text' }) as B[];
    expect(b[0]).toMatchObject({ id: 'bind-text', source: `record.${FID}`, field: 'specials.boundText' });
    expect(b[0].target).toMatchObject({ type: 'record' });
  });

  it('a richtext tile binds record.html.<fid> into boundHtml', () => {
    const b = bindingsForConfig('text-dataset', { datasetSource: 'record', recordField: FID, recordFieldType: 'richtext' }) as B[];
    expect(b[0]).toMatchObject({ source: `record.html.${FID}`, field: 'specials.boundHtml' });
  });

  it('an image tile binds record.<fid> into boundImage', () => {
    const b = bindingsForConfig('collection-media', { datasetSource: 'record', recordField: FID }) as B[];
    expect(b[0]).toMatchObject({ id: 'bind-image', source: `record.${FID}`, field: 'specials.boundImage' });
  });

  it('a field KEY (not an id) binds nothing rather than a guess', () => {
    const b = bindingsForConfig('text-dataset', { datasetSource: 'record', recordField: 'title' }) as B[];
    expect(b[0].source).toBe('');
  });

  it('a record list is a record_list repeater', () => {
    const b = bindingsForConfig('list-dataset', { datasetSource: 'record' }) as B[];
    expect(b[0].target).toMatchObject({ type: 'record', kind: 'record_list' });
  });

  // THE MIRROR IS PINNED TO THE PLATFORM: codegen runs the schema's own
  // `datasetBindings` over these configs, and the runtime must agree on each.
  it('agrees with every probe codegen ran through the schema factory', () => {
    expect(RECORD_BINDING_PROBES.length).toBeGreaterThanOrEqual(6);
    for (const p of RECORD_BINDING_PROBES) {
      expect(bindingsForConfig(p.type, p.config), JSON.stringify(p.config)).toEqual(p.bindings);
    }
  });

  it('createNode seeds them from the spec config', () => {
    const n = createNode('text-dataset', { config: { datasetSource: 'record', recordField: FID, recordFieldType: 'text' } });
    expect(first(n).source).toBe(`record.${FID}`);
  });
});

function recordList(collection = 'col_1', tile: Record<string, unknown> = { datasetSource: 'record', recordField: FID, recordFieldType: 'text' }) {
  const doc = emptyDoc();
  const { patches, ids } = addSubtree(doc, 'ROOT', {
    type: 'flex-section',
    children: [
      {
        type: 'list-dataset',
        config: { datasetSource: 'record', recordCollectionId: collection },
        children: [{ type: 'dataset-block', children: [{ type: 'text-dataset', config: tile }] }],
      },
    ],
  });
  doc.apply(patches);
  const list = ids.find((i) => doc.node(i).data.type === 'list-dataset')!;
  const tile_ = ids.find((i) => doc.node(i).data.type === 'text-dataset')!;
  return { doc, list, tile: tile_ };
}

describe('sb_set re-derives a record tile when its field moves', () => {
  it('recordField', () => {
    const { doc, tile } = recordList();
    doc.apply(setKeys(doc, tile, { recordField: FID2 }, { namespace: 'config' }));
    expect(first(doc.node(tile) as never).source).toBe(`record.${FID2}`);
  });

  it('recordFieldType', () => {
    const { doc, tile } = recordList();
    doc.apply(setKeys(doc, tile, { recordFieldType: 'richtext' }, { namespace: 'config' }));
    expect(first(doc.node(tile) as never)).toMatchObject({ source: `record.html.${FID}`, field: 'specials.boundHtml' });
  });

  it('datasetSource into record', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'flex-section', children: [{ type: 'collection-media', config: { recordField: FID } }] });
    doc.apply(patches);
    const id = ids.find((i) => doc.node(i).data.type === 'collection-media')!;
    doc.apply(setKeys(doc, id, { datasetSource: 'record' }, { namespace: 'config' }));
    expect(first(doc.node(id) as never).source).toBe(`record.${FID}`);
  });

  // recordfeed.go reads `n.Config[...]` raw; datasetBindings reads base config.
  it('routes the record keys to base, where the platform reads them', () => {
    for (const k of ['recordCollectionId', 'recordSortField', 'recordSortDesc', 'recordFilterField', 'recordFilterValue', 'recordField', 'recordFieldType']) {
      expect(BASE_ONLY_CONFIG, k).toContain(k);
    }
    const { doc, list } = recordList();
    doc.apply(setKeys(doc, list, { recordCollectionId: 'col_2' }, { namespace: 'config', breakpoint: 'mobile' }));
    const n = doc.node(list) as unknown as { config: Record<string, unknown>; responsive?: Record<string, { config?: Record<string, unknown> }> };
    expect(n.config.recordCollectionId).toBe('col_2');
    expect(n.responsive?.mobile?.config?.recordCollectionId).toBeUndefined();
  });
});

describe('sb_bind and record sources', () => {
  function heading() {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    d.apply(addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] }).patches);
    return { d, id: d.node(d.node('ROOT').data.nodes[0]).data.nodes[0] };
  }

  it('accepts record.<fid> and record.html.<fid>', () => {
    const { d, id } = heading();
    expect(() => bindNode(d, id, `record.${FID}`, 'specials.text')).not.toThrow();
    const { doc: d2, tile } = recordList();
    expect(() => bindNode(d2, tile, `record.html.${FID}`, 'specials.boundHtml')).not.toThrow();
  });

  it('refuses a record source that is not a field id', () => {
    const { d, id } = heading();
    expect(() => bindNode(d, id, 'record.title', 'specials.text')).toThrow(/fld_/);
    expect(() => bindNode(d, id, 'record.html.title', 'specials.text')).toThrow(/fld_/);
  });

  // rawSinkBindings.ts:102 — boundHtml takes record.* ONLY as record.html.<fid>.
  it('refuses record.<fid> into boundHtml', () => {
    const { doc, tile } = recordList();
    expect(() => bindNode(doc, tile, `record.${FID}`, 'specials.boundHtml')).toThrow(/record\.html\./);
  });

  it('refuses record.html.<fid> into boundText — its tags would print as text', () => {
    const { doc, tile } = recordList();
    expect(() => bindNode(doc, tile, `record.html.${FID}`, 'specials.boundText')).toThrow(/boundHtml/);
  });
});

describe('sb_review on a record list', () => {
  const codes = (d: PageDoc, id?: string) =>
    reviewDesign(d, {}).filter((f) => !id || f.nodeId === id).map((f) => f.code);

  it('a correct record list is clean of record findings', () => {
    const { doc, tile, list } = recordList();
    expect(codes(doc, tile)).not.toContain('dead_binding_source');
    expect(codes(doc, tile)).not.toContain('no_data_context');
    expect(codes(doc, tile)).not.toContain('record_field_unset');
    expect(codes(doc, list)).not.toContain('record_list_unsourced');
  });

  it('a record list with no collection renders nothing', () => {
    const { doc, list } = recordList('');
    expect(codes(doc, list)).toContain('record_list_unsourced');
  });

  it('a record tile with no field, or a key for a field, is flagged', () => {
    for (const recordField of ['', 'title']) {
      const { doc, tile } = recordList('col_1', { datasetSource: 'record', recordField, recordFieldType: 'text' });
      expect(codes(doc, tile), recordField).toContain('record_field_unset');
    }
  });

  it('a record binding outside a record list has no data context', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [
        { type: 'text-dataset', config: { datasetSource: 'record', recordField: FID } },
        { type: 'list-dataset', children: [{ type: 'dataset-block', children: [{ type: 'text-dataset', config: { datasetSource: 'record', recordField: FID } }] }] },
      ],
    });
    doc.apply(patches);
    const tiles = ids.filter((i) => doc.node(i).data.type === 'text-dataset');
    expect(tiles).toHaveLength(2);
    for (const t of tiles) expect(codes(doc, t)).toContain('no_data_context');
  });
});

describe('sb_traits_for list-dataset stays inside its budget', () => {
  // The record source added a seventh layout group with the same control list;
  // a repeat is named, not re-sent.
  it('a group repeating an earlier group says so instead of listing it again', () => {
    const t = traitsFor('list-dataset') as { inspector: Array<{ groups: Array<{ group: string; controls?: string[]; same_as?: string }> }> };
    const groups = t.inspector.flatMap((x) => x.groups);
    expect(groups.some((g) => g.same_as)).toBe(true);
    expect(JSON.stringify(t).length).toBeLessThan(16_000);
  });
});
