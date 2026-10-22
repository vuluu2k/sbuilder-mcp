import { describe, it, expect } from 'vitest';
import { bindingsForConfig, createNode } from '../src/domains/site/node.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { bindNode } from '../src/tools/live.js';
import { traitsFor } from '../src/catalog/element-search.js';
import { BASE_ONLY_CONFIG, RECORD_BINDING_PROBES } from '../src/catalog/elements.generated.js';
import { PageDoc } from '../src/domains/site/document.js';
import { emptyDoc } from './helpers/doc.js';
import { recordFieldProblem, recordScope } from '../src/domains/site/record.js';
import { describeOperation, findOperation } from '../src/catalog/search.js';
import { REQUEST_SHAPES } from '../src/catalog/shapes.generated.js';

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

  // recordContext.ts (web_builder 986c96a96): the row's own id, for a relation or a link.
  it('accepts record.id', () => {
    const { doc, tile } = recordList();
    expect(() => bindNode(doc, tile, 'record.id', 'specials.boundText')).not.toThrow();
    expect(() => bindNode(doc, tile, 'record.id', 'specials.boundHtml')).toThrow(/record\.html\./);
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

/** hotels (col_h) → rooms (col_r, relation on FID_HOTEL): the AURA shape. */
const FID_NAME = 'fld_000000000000aaaa';
const FID_HOTEL = 'fld_000000000000bbbb';
const FID_ROOM = 'fld_000000000000cccc';
function nested(inner: Record<string, unknown>, emptyState = true) {
  const doc = emptyDoc();
  const { patches, ids } = addSubtree(doc, 'ROOT', {
    type: 'flex-section',
    children: [
      {
        type: 'list-dataset',
        config: { datasetSource: 'record', recordCollectionId: 'col_h' },
        children: [
          {
            type: 'dataset-block',
            children: [
              {
                type: 'list-dataset',
                config: { datasetSource: 'record', recordCollectionId: 'col_r', ...inner },
                children: [{ type: 'dataset-block', children: [{ type: 'text-dataset', config: { datasetSource: 'record', recordField: FID_ROOM } }] }],
              },
            ],
          },
        ],
      },
    ],
  });
  doc.apply(patches);
  const lists = ids.filter((i) => doc.node(i).data.type === 'list-dataset');
  const tile = ids.find((i) => doc.node(i).data.type === 'text-dataset')!;
  // sb_add seeds a list-empty on every list; a document from elsewhere may lack it.
  if (!emptyState) (doc.node(lists[1]) as unknown as { config: Record<string, unknown> }).config.emptyStateId = '';
  return { doc, outer: lists[0], inner: lists[1], tile };
}
const at = (doc: PageDoc) => (x: string) => (doc.has(x) ? (doc.node(x) as never) : undefined);

describe('relation lists (web_builder 1b6c07a91)', () => {
  it('recordRelationField is base-only and documented on list-dataset', () => {
    expect(BASE_ONLY_CONFIG).toContain('recordRelationField');
    expect(JSON.stringify(traitsFor('list-dataset'))).toContain('recordRelationField');
  });

  it('a relation row reads its own collection, then the parent row', () => {
    const { doc, tile } = nested({ recordRelationField: FID_HOTEL });
    expect(recordScope(at(doc), tile)).toEqual(['col_r', 'col_h']);
  });

  it('a plain nested list reads only its own row', () => {
    const { doc, tile } = nested({});
    expect(recordScope(at(doc), tile)).toEqual(['col_r']);
  });

  it('outside any record list there is no scope', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] });
    doc.apply(patches);
    expect(recordScope(at(doc), ids[1])).toEqual([]);
  });

  it('sb_review flags an unlinked nested list, an orphan relation, and a missing empty state', () => {
    const codes = (d: PageDoc, id: string) => reviewDesign(d, {}).filter((f) => f.nodeId === id).map((f) => f.code);
    const a = nested({});
    expect(codes(a.doc, a.inner)).toContain('record_relation_unset');
    const b = nested({ recordRelationField: FID_HOTEL });
    expect(codes(b.doc, b.inner)).not.toContain('record_relation_unset');
    expect(codes(b.doc, b.inner)).not.toContain('record_relation_no_empty');
    const c = nested({ recordRelationField: FID_HOTEL }, false);
    expect(codes(c.doc, c.inner)).toContain('record_relation_no_empty');
    // an id that names no list-empty renders ghost cards just the same (html.go emptyStateID)
    const g = nested({ recordRelationField: FID_HOTEL });
    (g.doc.node(g.inner) as unknown as { config: Record<string, unknown> }).config.emptyStateId = 'gone';
    expect(codes(g.doc, g.inner)).toContain('record_relation_no_empty');
    const e = nested({ recordRelationField: 'hotel' });
    expect(codes(e.doc, e.inner)).toContain('record_relation_orphan');
    // the outer list itself is not nested: a relation key there has no parent row
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'list-dataset', config: { datasetSource: 'record', recordCollectionId: 'col_r', recordRelationField: FID_HOTEL } }],
    });
    doc.apply(patches);
    expect(codes(doc, ids.find((i) => doc.node(i).data.type === 'list-dataset')!)).toContain('record_relation_orphan');
  });
});

describe('sb_bind checks a record field against the collections in scope', () => {
  const rooms = { collectionId: 'col_r', fields: [{ id: FID_ROOM, key: 'name', type: 'text' }, { id: FID, key: 'photos', type: 'gallery' }, { id: FID2, key: 'body', type: 'richtext' }] };
  const hotels = { collectionId: 'col_h', fields: [{ id: FID_NAME, key: 'name', type: 'text' }] };

  it('resolves own fields, parent fields and record.id', () => {
    expect(recordFieldProblem(`record.${FID_ROOM}`, [rooms, hotels])).toBeUndefined();
    expect(recordFieldProblem(`record.${FID_NAME}`, [rooms, hotels])).toBeUndefined();
    expect(recordFieldProblem('record.id', [rooms])).toBeUndefined();
    expect(recordFieldProblem(`record.html.${FID2}`, [rooms])).toBeUndefined();
  });

  it('names the fields when the id is not in scope', () => {
    expect(recordFieldProblem(`record.${FID_NAME}`, [rooms])).toMatch(/not a field.*fld_000000000000cccc \(name, text\)/);
  });

  it('refuses gallery, and the wrong richtext spelling either way', () => {
    expect(recordFieldProblem(`record.${FID}`, [rooms])).toMatch(/gallery/);
    expect(recordFieldProblem(`record.${FID2}`, [rooms])).toMatch(/record\.html\./);
    expect(recordFieldProblem(`record.html.${FID_ROOM}`, [rooms])).toMatch(/not richtext/);
  });

  it('no record row means no data', () => {
    expect(recordFieldProblem('record.id', [])).toMatch(/no record-list row/);
  });
});

describe('the Collections call sheet', () => {
  it('names the field-type vocabulary instead of the Go type name', () => {
    const t = REQUEST_SHAPES['post:/api/sites/{siteId}/collections/{id}/fields'].fields.find((f) => f.name === 'type')!.type;
    for (const v of ['text', 'integer', 'reference', 'gallery']) expect(t).toContain(`"${v}"`);
  });

  it('carries rev, money unit, upsert and publication facts', () => {
    const sheet = JSON.stringify(describeOperation(findOperation('post:/api/sites/{siteId}/collections/{id}/records/upsert')!));
    for (const s of ['stale_record', 'WHOLE currency units', 'externalId', 'in_use', 'NO page publish']) expect(sheet).toContain(s);
  });
});

describe('sb_review flags a data table kept in a custom-code script', () => {
  const rows = (n: number) =>
    JSON.stringify({ hotels: Array.from({ length: n }, (_, i) => ({ id: `h${i}`, name: `Hotel ${i}`, price: 1000 * i, area: 'x' })) });

  it('four or more same-shaped records are a table', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'custom-code', specials: { code: `<script>const DATA=${rows(8)};</script>` } }],
    });
    doc.apply(patches);
    const f = reviewDesign(doc, {}).find((x) => x.code === 'hardcoded_dataset');
    expect(f?.nodeId).toBe(ids.find((i) => doc.node(i).data.type === 'custom-code'));
    expect(f?.problem).toMatch(/8 records/);
  });

  it('a config object or three rows is not', async () => {
    const { hardcodedRecords } = await import('../src/domains/site/review.js');
    expect(hardcodedRecords(`<script>const DATA=${rows(3)};</script>`)).toBeNull();
    expect(hardcodedRecords('<script>init({a:1,b:2,c:3})</script>')).toBeNull();
    expect(hardcodedRecords(`<div>${rows(8)}</div>`)).toBeNull();
  });

  // Review round: the same literal repeated (a minified bundle, listener options) is not rows,
  // and JSON-LD is data the page declares; Vietnamese keys are rows like any other.
  it('repeats of one literal and JSON-LD are not a table; Unicode keys are', async () => {
    const { hardcodedRecords } = await import('../src/domains/site/review.js');
    const def = 'Object.defineProperty(e,"a",{enumerable:!0,configurable:!0,writable:!0});';
    expect(hardcodedRecords(`<script>${def.repeat(6)}</script>`)).toBeNull();
    expect(hardcodedRecords(`<script type="application/ld+json">${rows(8)}</script>`)).toBeNull();
    const vi = Array.from({ length: 5 }, (_, i) => `{tên:"KS ${i}",giá:${i},sao:5}`).join(',');
    expect(hardcodedRecords(`<script>const D=[${vi}]</script>`)?.count).toBe(5);
    expect(hardcodedRecords(`<script type="module">const D=${rows(5)}</script>`)?.count).toBe(5);
  });
});

describe('sb_bind and sb_page_state against the platform (end to end)', () => {
  const node = (id: string, type: string, parent: string | null, nodes: string[], config: Record<string, unknown> = {}) => ({
    id, data: { type, parent, nodes }, specials: {}, style: {}, config, bindings: [], events: [],
  });
  const page = () => ({
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: node('ROOT', 'root', null, ['sec']),
      sec: node('sec', 'flex-section', 'ROOT', ['lh']),
      lh: node('lh', 'list-dataset', 'sec', ['bh'], { datasetSource: 'record', recordCollectionId: 'col_h' }),
      bh: node('bh', 'dataset-block', 'lh', ['lr']),
      lr: node('lr', 'list-dataset', 'bh', ['br'], { datasetSource: 'record', recordCollectionId: 'col_r', recordRelationField: FID_HOTEL }),
      br: node('br', 'dataset-block', 'lr', ['hd']),
      hd: node('hd', 'heading', 'br', []),
    },
  });
  async function open() {
    const { fakePlatform } = await import('./helpers/platform.js');
    const reads: string[] = [];
    const p = fakePlatform((method, path) => {
      const m = /\/collections\/(col_[a-z])\/fields$/.exec(path);
      if (method !== 'GET' || !m) return undefined;
      reads.push(m[1]);
      return {
        fields:
          m[1] === 'col_r'
            ? [{ id: FID_ROOM, key: 'name', type: 'text' }, { id: FID, key: 'photos', type: 'gallery' }]
            : [{ id: FID_NAME, key: 'name', type: 'text' }],
      };
    });
    p.pages.set('pg_1', { document: page(), rev: 1 });
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    return { call, close, reads };
  }

  it('reads the row scope, binds a parent field, refuses a gallery and an unknown id', async () => {
    const { call, close, reads } = await open();
    const ok = await call('sb_bind', { id: 'hd', source: `record.${FID_NAME}`, field: 'specials.text' });
    expect(ok.isError, ok.text).toBe(false);
    expect(reads.sort()).toEqual(['col_h', 'col_r']);
    const gallery = await call('sb_bind', { id: 'hd', source: `record.${FID}`, field: 'specials.text' });
    expect(gallery.isError).toBe(true);
    expect(gallery.text).toMatch(/gallery/);
    const unknown = await call('sb_bind', { id: 'hd', source: `record.${FID2}`, field: 'specials.text' });
    expect(unknown.text).toMatch(/not a field.*col_r/);
    const forced = await call('sb_bind', { id: 'hd', source: `record.${FID2}`, field: 'specials.text', force: true });
    expect(forced.isError).toBe(false);
    expect(JSON.stringify(forced.json.forced)).toMatch(/not a field/);
    await close();
  });

  it('sb_page_state lists the record lists and says once that data is not the document', async () => {
    const { call, close } = await open();
    const first = (await call('sb_page_state', {})).json as { data?: { record_lists: unknown[]; note?: string } };
    expect(first.data?.record_lists).toEqual([
      { id: 'lh', collection: 'col_h' },
      { id: 'lr', collection: 'col_r', relation: FID_HOTEL },
    ]);
    expect(first.data?.note).toMatch(/NO page publish/);
    const second = (await call('sb_page_state', {})).json as { data?: { note?: string } };
    expect(second.data?.note).toBeUndefined();
    await close();
  });
});
