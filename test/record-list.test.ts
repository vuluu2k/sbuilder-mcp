import { describe, it, expect } from 'vitest';
import { bindingsForConfig, createNode } from '../src/domains/site/node.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { bindNode } from '../src/tools/live.js';
import { traitsFor } from '../src/catalog/element-search.js';
import { BASE_ONLY_CONFIG, ELEMENTS, RECORD_BINDING_PROBES } from '../src/catalog/elements.generated.js';
import { PageDoc } from '../src/domains/site/document.js';
import { emptyDoc } from './helpers/doc.js';
import { RECORD_SOURCE, recordFieldProblem, recordScope } from '../src/domains/site/record.js';
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

  it('a card naming no source in a record list is reported; stamped or in a product list, it is not', () => {
    const card = (listSrc: string, cardSrc?: string) => {
      const d = emptyDoc();
      d.apply([
        { op: 'set', path: ['nodes', 'li'], value: { id: 'li', data: { type: 'list-dataset', parent: 'ROOT', nodes: ['da'] }, config: { datasetSource: listSrc, recordCollectionId: 'col_x' }, specials: {} } },
        { op: 'set', path: ['nodes', 'da'], value: { id: 'da', data: { type: 'dataset-block', parent: 'li', nodes: [] }, config: cardSrc ? { datasetSource: cardSrc } : {}, specials: {} } },
        { op: 'set', path: ['nodes', 'ROOT', 'data', 'nodes'], value: ['li'] },
      ] as never);
      return codes(d, 'da');
    };
    expect(card('record')).toContain('card_source_unset');
    expect(card('record', 'record')).not.toContain('card_source_unset');
    expect(card('product')).not.toContain('card_source_unset');
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
            ? [{ id: FID_ROOM, key: 'name', type: 'text' }, { id: FID, key: 'photos', type: 'gallery' }, { id: FID_HOTEL, key: 'hotel', type: 'reference', refCollectionId: 'col_h' }]
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

  it('a referenced field is checked against the reference\'s own collection (§7.8)', async () => {
    const { call, close, reads } = await open();
    const ok = await call('sb_bind', { id: 'hd', source: `record.ref.${FID_HOTEL}.${FID_NAME}`, field: 'specials.text' });
    expect(ok.isError, ok.text).toBe(false);
    expect(reads.filter((r) => r === 'col_h').length).toBe(2);
    const wrong = await call('sb_bind', { id: 'hd', source: `record.ref.${FID_HOTEL}.${FID_ROOM}`, field: 'specials.text' });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/not a field of col_h/);
    const notRef = await call('sb_bind', { id: 'hd', source: `record.ref.${FID_ROOM}.${FID_NAME}`, field: 'specials.text' });
    expect(notRef.text).toMatch(/not a reference/);
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

describe('money on a record tile (web_builder PR #156)', () => {
  it('recordFormat money on a number/integer field binds record.money.<fid>; on text it is ignored', () => {
    const at = (t: string) =>
      first({ bindings: bindingsForConfig('text-dataset', { datasetSource: 'record', recordField: FID, recordFieldType: t, recordFormat: 'money' }) as unknown[] });
    expect(at('integer').source).toBe(`record.money.${FID}`);
    expect(at('number').source).toBe(`record.money.${FID}`);
    expect(at('text').source).toBe(`record.${FID}`);
  });

  it('sb_set recordFormat re-derives the binding, and back', () => {
    const { doc, tile } = recordList('col_1', { datasetSource: 'record', recordField: FID, recordFieldType: 'integer' });
    doc.apply(setKeys(doc, tile, { recordFormat: 'money' }, { namespace: 'config' }));
    expect(first(doc.node(tile) as never).source).toBe(`record.money.${FID}`);
    doc.apply(setKeys(doc, tile, { recordFormat: '' }, { namespace: 'config' }));
    expect(first(doc.node(tile) as never).source).toBe(`record.${FID}`);
    expect(BASE_ONLY_CONFIG).toContain('recordFormat');
  });

  it('sb_bind takes record.money.<fid> only for a number/integer field', () => {
    const { doc, tile } = recordList();
    expect(() => bindNode(doc, tile, `record.money.${FID}`, 'specials.boundText')).not.toThrow();
    const scope = [{ collectionId: 'c', fields: [{ id: FID, key: 'price', type: 'integer' }, { id: FID2, key: 'name', type: 'text' }] }];
    expect(recordFieldProblem(`record.money.${FID}`, scope)).toBeUndefined();
    expect(recordFieldProblem(`record.money.${FID2}`, scope)).toMatch(/number or integer/);
  });
});

describe('sb_review on a record filter or sort control (web_builder PR #157)', () => {
  function page(specials: Record<string, unknown>, relation = false) {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [
        { type: 'filter-checkbox' },
        { type: 'list-dataset', config: { datasetSource: 'record', recordCollectionId: 'col_h', ...(relation ? { recordRelationField: FID_HOTEL } : {}) } },
      ],
    });
    doc.apply(patches);
    const ctl = ids.find((i) => doc.node(i).data.type === 'filter-checkbox')!;
    const list = ids.find((i) => doc.node(i).data.type === 'list-dataset')!;
    Object.assign((doc.node(ctl) as unknown as { specials: Record<string, unknown> }).specials, specials, {
      filterTargets: (specials.filterTargets as string[] | undefined) ?? [list],
    });
    return { doc, ctl, list };
  }
  const flagged = (d: PageDoc, id: string) => reviewDesign(d, {}).find((f) => f.nodeId === id && f.code === 'record_filter_invalid');

  it('a correct record filter is clean', () => {
    const { doc, ctl } = page({ filterSource: 'record', filterAxis: FID, filterBehavior: 'filter' });
    expect(flagged(doc, ctl)).toBeUndefined();
  });

  it('a key for an axis, a relation-list target, or event mode is flagged', () => {
    const a = page({ filterSource: 'record', filterAxis: 'stars' });
    expect(flagged(a.doc, a.ctl)?.problem).toMatch(/not a field ID/);
    const b = page({ filterSource: 'record', filterAxis: FID }, true);
    expect(flagged(b.doc, b.ctl)?.problem).toMatch(/relation list/);
    const c = page({ filterSource: 'record', filterAxis: FID, filterBehavior: 'event' });
    expect(flagged(c.doc, c.ctl)?.problem).toMatch(/only narrows/);
  });

  it('a sort aimed at a record list needs <fieldId>_asc|desc values', () => {
    const ok = page({ filterSource: 'sort', filterValues: [{ value: `${FID}_desc`, label: 'x' }] });
    expect(flagged(ok.doc, ok.ctl)).toBeUndefined();
    const bad = page({ filterSource: 'sort', filterValues: [{ value: 'price_asc', label: 'x' }] });
    expect(flagged(bad.doc, bad.ctl)?.problem).toMatch(/price_asc/);
  });
});

describe('record detail pages (web_builder #160)', () => {
  const codesOn = (d: PageDoc, id: string, pageType?: string) =>
    reviewDesign(d, { pageType }).filter((f) => f.nodeId === id).map((f) => f.code);

  it('record.url is a record source', () => {
    const { doc, tile } = recordList();
    expect(() => bindNode(doc, tile, 'record.url', 'specials.boundText')).not.toThrow();
    expect(recordFieldProblem('record.url', [{ collectionId: 'c', fields: [] }])).toBeUndefined();
  });

  it('on a record page, a relation list and a record binding outside any list have the page record', () => {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [
        { type: 'heading' },
        { type: 'list-dataset', config: { datasetSource: 'record', recordCollectionId: 'col_r', recordRelationField: FID_HOTEL } },
      ],
    });
    doc.apply(patches);
    const h = ids.find((i) => doc.node(i).data.type === 'heading')!;
    doc.apply(bindNode(doc, h, `record.${FID_NAME}`, 'specials.text'));
    const rooms = ids.find((i) => doc.node(i).data.type === 'list-dataset')!;
    expect(codesOn(doc, rooms, 'record')).not.toContain('record_relation_orphan');
    expect(codesOn(doc, h, 'record')).not.toContain('no_data_context');
    // the same document on an ordinary page has no record above either
    expect(codesOn(doc, rooms, 'page')).toContain('record_relation_orphan');
    expect(codesOn(doc, h, 'page')).toContain('no_data_context');
  });
});

describe('form options from a collection (web_builder #159)', () => {
  function form(hotel: Record<string, unknown>, room: Record<string, unknown>) {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'form-select', config: hotel }, { type: 'form-select', config: room }],
    });
    doc.apply(patches);
    const [h, r] = ids.filter((i) => doc.node(i).data.type === 'form-select');
    return { doc, h, r };
  }
  const flagged = (d: PageDoc, id: string) => reviewDesign(d, {}).find((f) => f.nodeId === id && f.code === 'record_option_invalid');
  const hotel = { optionSource: 'record', recordCollectionId: 'col_h', recordLabelField: FID_NAME };

  it('the option keys are base-only, where formoptions reads them', () => {
    for (const k of ['optionSource', 'recordCollectionId', 'recordLabelField', 'recordParentField', 'recordParentNode']) {
      expect(BASE_ONLY_CONFIG, k).toContain(k);
    }
  });

  it('a hotel select and a room select following it are clean', () => {
    const { doc, h, r } = form(hotel, { optionSource: 'record', recordCollectionId: 'col_r', recordLabelField: FID_ROOM });
    (doc.node(r) as unknown as { config: Record<string, unknown> }).config.recordParentNode = h;
    (doc.node(r) as unknown as { config: Record<string, unknown> }).config.recordParentField = FID_HOTEL;
    expect(flagged(doc, h)).toBeUndefined();
    expect(flagged(doc, r)).toBeUndefined();
  });

  it('no collection, a key for a label, or a parent that is not a record select is flagged', () => {
    const a = form({ optionSource: 'record', recordLabelField: 'name' }, {});
    expect(flagged(a.doc, a.h)?.problem).toMatch(/names no collection.*not a field ID/);
    const b = form({ optionSource: 'manual' }, { ...hotel, recordParentField: FID_HOTEL });
    (b.doc.node(b.r) as unknown as { config: Record<string, unknown> }).config.recordParentNode = b.h;
    expect(flagged(b.doc, b.r)?.problem).toMatch(/not a record-sourced form-select/);
  });
});

describe('sb_bind on a record detail page (end to end)', () => {
  const node = (id: string, type: string, parent: string | null, nodes: string[]) => ({
    id, data: { type, parent, nodes }, specials: {}, style: {}, config: {}, bindings: [], events: [],
  });
  async function open(attachedForRooms: boolean) {
    const { fakePlatform } = await import('./helpers/platform.js');
    const p = fakePlatform((method, path) => {
      if (method !== 'GET') return undefined;
      if (path === '/api/sites/s1/page-links') return { links: [{ linkType: 'recordCollection', linkId: 'col_h', pageId: 'pg_rec' }] };
      if (path.endsWith('/collections/col_h/fields')) return { fields: [{ id: FID_NAME, key: 'name', type: 'text' }] };
      if (path.endsWith('/page-links/recordCollection/col_h')) return attachedForRooms ? { link: { pageId: 'pg_rec' } } : undefined;
      return undefined;
    });
    p.pages.set('pg_rec', {
      document: { schema_version: 2, root_node_id: 'ROOT', nodes: { ROOT: node('ROOT', 'root', null, ['sec']), sec: node('sec', 'flex-section', 'ROOT', ['hd']), hd: node('hd', 'heading', 'sec', []) } },
      rev: 1,
    });
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_rec' });
    return { call, close };
  }

  it('binds the page record outside any list, from the attached collection', async () => {
    const { call, close } = await open(true);
    const ok = await call('sb_bind', { id: 'hd', source: `record.${FID_NAME}`, field: 'specials.text' });
    expect(ok.isError, ok.text).toBe(false);
    const bad = await call('sb_bind', { id: 'hd', source: `record.${FID_ROOM}`, field: 'specials.text' });
    expect(bad.text).toMatch(/not a field.*col_h/);
    expect((await call('sb_bind', { id: 'hd', source: 'record.url', field: 'specials.href' })).isError).toBe(false);
    await close();
  });
});

describe('aggregates over a relation (web_builder #162)', () => {
  const agg = (over: Record<string, unknown> = {}) => ({
    key: 'startPrice', recordCollectionId: 'col_0123456789abcdef', recordRelationField: FID_HOTEL, op: 'min',
    recordField: FID, where: [{ recordField: FID2, op: 'gte', param: 'guests', per: 'rooms' }], whenNone: 'hide', ...over,
  });
  function list(aggs: unknown, tileField = 'agg.startPrice') {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [
        { type: 'filter-radio' },
        {
          type: 'list-dataset',
          config: { datasetSource: 'record', recordCollectionId: 'col_h', recordAggregates: aggs },
          children: [{ type: 'dataset-block', children: [{ type: 'text-dataset', config: { datasetSource: 'record', recordField: tileField, recordFieldType: 'number', recordFormat: 'money' } }] }],
        },
      ],
    });
    doc.apply(patches);
    const at = (t: string) => ids.find((i) => doc.node(i).data.type === t)!;
    return { doc, list: at('list-dataset'), tile: at('text-dataset'), ctl: at('filter-radio') };
  }
  const codes = (d: PageDoc, id: string) => reviewDesign(d, {}).filter((f) => f.nodeId === id).map((f) => f.code);

  it('an agg.<key> tile binds record.money.agg.<key>, pinned to the platform probe', () => {
    const { doc, tile } = list([agg()]);
    expect(first(doc.node(tile) as never).source).toBe('record.money.agg.startPrice');
    expect(BASE_ONLY_CONFIG).toContain('recordAggregates');
    expect(() => bindNode(doc, tile, 'record.agg.startPrice', 'specials.boundText')).not.toThrow();
  });

  it('a valid aggregate list with its empty state is clean; malformed or unknown key is flagged', () => {
    const ok = list([agg()]);
    expect(codes(ok.doc, ok.list)).not.toContain('record_aggregate_invalid');
    expect(codes(ok.doc, ok.tile)).not.toContain('record_field_unset');
    const bad = list([agg({ op: 'avg' })]);
    expect(codes(bad.doc, bad.list)).toContain('record_aggregate_invalid');
    const missing = list([agg()], 'agg.cheapest');
    expect(codes(missing.doc, missing.tile)).toContain('record_field_unset');
  });

  it('filter axes agg.<key> / param.<name> must exist on the target list; a param holds one value', () => {
    const set = (d: PageDoc, ctl: string, sp: Record<string, unknown>) => Object.assign((d.node(ctl) as unknown as { specials: Record<string, unknown> }).specials, sp);
    const a = list([agg()]);
    set(a.doc, a.ctl, { filterSource: 'record', filterAxis: 'param.guests', filterTargets: [a.list], filterBehavior: 'filter', filterArity: 'single' });
    expect(codes(a.doc, a.ctl)).not.toContain('record_filter_invalid');
    set(a.doc, a.ctl, { filterArity: 'multi' });
    expect(reviewDesign(a.doc, {}).find((f) => f.nodeId === a.ctl)?.problem).toMatch(/ONE value/);
    set(a.doc, a.ctl, { filterAxis: 'agg.cheapest', filterArity: 'single' });
    expect(codes(a.doc, a.ctl)).toContain('record_filter_invalid');
  });
});

describe('booking estimate (web_builder #161)', () => {
  function form(terms: unknown[], rules: unknown[] = []) {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [
        { type: 'form-select', config: { optionSource: 'record', recordCollectionId: 'col_r', recordLabelField: FID_ROOM } },
        { type: 'form-date' }, { type: 'form-date' }, { type: 'form-number' }, { type: 'form-estimate' },
      ],
    });
    doc.apply(patches);
    const of = (t: string) => ids.filter((i) => doc.node(i).data.type === t);
    const [room] = of('form-select'); const [cin, cout] = of('form-date'); const [rooms] = of('form-number'); const [est] = of('form-estimate');
    const n = { room, cin, cout, rooms };
    const fill = (o: unknown) => JSON.parse(JSON.stringify(o).replace(/"\$(\w+)"/g, (_, k) => JSON.stringify((n as Record<string, string>)[k])));
    Object.assign((doc.node(est) as unknown as { specials: Record<string, unknown> }).specials, { estimateTerms: fill(terms), estimateRules: fill(rules) });
    return { doc, est };
  }
  const flagged = (d: PageDoc, id: string) => reviewDesign(d, {}).find((f) => f.nodeId === id && f.code === 'estimate_invalid');

  it('price × nights × rooms with stay rules is clean', () => {
    const { doc, est } = form(
      [{ kind: 'record', node: '$room', field: FID }, { kind: 'nights', start: '$cin', end: '$cout', unit: 'đêm' }, { kind: 'number', node: '$rooms', unit: 'phòng' }],
      [{ kind: 'dateRange', start: '$cin', end: '$cout', notPast: true }, { kind: 'maxNights', start: '$cin', end: '$cout', max: 30 }],
    );
    expect(flagged(doc, est)).toBeUndefined();
  });

  it('no record term, or operands that are not this form\'s fields, is flagged', () => {
    const a = form([{ kind: 'nights', start: '$cin', end: '$cout' }]);
    expect(flagged(a.doc, a.est)?.problem).toMatch(/exactly ONE "record" term/);
    const b = form([{ kind: 'record', node: '$room', field: FID }, { kind: 'number', node: '$cin' }]);
    expect(flagged(b.doc, b.est)?.problem).toMatch(/is not a form-number/);
  });
});

describe('record link parameters — specials.hrefParams (web_builder v1.0.174, contract §7.6)', () => {
  // AURA: a hotel's rooms relation list; the room card's button passes the hotel and the room.
  function page(btn: Record<string, unknown> = {}, opts: { outside?: boolean; events?: unknown[]; bindings?: unknown[] } = {}) {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [
        { type: 'button' },
        {
          type: 'list-dataset',
          config: { datasetSource: 'record', recordCollectionId: 'col_h' },
          children: [{ type: 'dataset-block', children: [{
            type: 'list-dataset',
            config: { datasetSource: 'record', recordCollectionId: 'col_r', recordRelationField: FID_HOTEL },
            children: [{ type: 'dataset-block', children: [{ type: 'button' }] }],
          }] }],
        },
      ],
    });
    doc.apply(patches);
    const buttons = ids.filter((i) => doc.node(i).data.type === 'button');
    const id = opts.outside ? buttons[0] : buttons[1];
    const n = doc.node(id) as unknown as { specials: Record<string, unknown>; events: unknown[]; bindings: unknown[] };
    Object.assign(n.specials, {
      href: '/yeu-cau-dat-phong',
      hrefParams: [{ name: 'hotel', source: `record.${FID_HOTEL}` }, { name: 'room', source: 'record.id' }],
      ...btn,
    });
    n.events = (opts.events as unknown[]) ?? [{ id: 'e1', name: 'click', action: 'go_to_url', payload: { url: '/yeu-cau-dat-phong' } }];
    if (opts.bindings) n.bindings = opts.bindings;
    return { doc, id };
  }
  const found = (d: PageDoc, id: string, pageType?: string) =>
    reviewDesign(d, { pageType }).filter((f) => f.nodeId === id && f.code.startsWith('href_params'));

  it('the AURA room card is clean, and so is an href with no events', () => {
    expect(found(page().doc, page().id)).toEqual([]);
    const bare = page({}, { events: [] });
    expect(found(bare.doc, bare.id)).toEqual([]);
  });

  it('a bad name, a reserved one, a duplicate, a source outside the grammar, or too many entries is invalid', () => {
    const cases: Array<[unknown[], RegExp]> = [
      [[{ name: 'Hotel', source: 'record.id' }], /"Hotel"/],
      [[{ name: 'lang', source: 'record.id' }], /reserved/],
      [[{ name: 'room', source: 'record.id' }, { name: 'room', source: 'record.url' }], /twice/],
      [[{ name: 'room', source: `record.html.${FID}` }], /record\.html/],
      [[{ name: 'room', source: `record.money.${FID}` }], /record\.money/],
      [[{ name: 'room', source: 'product.title' }], /product\.title/],
      [Array.from({ length: 9 }, (_, i) => ({ name: `p${i}`, source: 'record.id' })), /8/],
    ];
    for (const [hrefParams, re] of cases) {
      const { doc, id } = page({ hrefParams });
      const f = found(doc, id).find((x) => x.code === 'href_params_invalid');
      expect(f?.problem, re.source).toMatch(re);
    }
  });

  it('a record-list filter key is a name (v1.0.175) — the destination card links to its filtered hotel list', () => {
    const ok = page({ href: '/', hrefParams: [{ name: `f.record.${FID_HOTEL}~li_875d61c3`, source: 'record.id' }, { name: `f.record.${FID}`, source: 'record.id' }] });
    expect(found(ok.doc, ok.id)).toEqual([]);
    for (const name of ['f.record.fld_xyz', `f.record.${FID}~`, `f.record.${FID}~a.b`, 'f.record.id~li_1', 'f.record.param.guests', `fm.record.${FID}`, 'f.search']) {
      const { doc, id } = page({ hrefParams: [{ name, source: 'record.id' }] });
      expect(found(doc, id).find((x) => x.code === 'href_params_invalid')?.problem, name).toMatch(/filter key/);
    }
  });

  it('an href that is not a same-site path gets no params', () => {
    for (const href of ['https://x.vn/a', '//x.vn', '#rooms', '', 'yeu-cau']) {
      const { doc, id } = page({ href }, { events: [] });
      expect(found(doc, id).map((f) => f.code), href).toContain('href_params_invalid');
    }
    // a bound path (record.url) is the platform's own same-site address
    const { doc, id } = page({ href: '' }, { events: [], bindings: [{ id: 'b', source: 'record.url', field: 'specials.href' }] });
    expect(found(doc, id)).toEqual([]);
  });

  it('outside any record row there is nothing to resolve — unless the page is a record page', () => {
    const { doc, id } = page({}, { outside: true });
    expect(found(doc, id).map((f) => f.code)).toContain('href_params_unresolved');
    expect(found(doc, id, 'record').map((f) => f.code)).not.toContain('href_params_unresolved');
  });

  it('a chained click, another action, or a purchase binding strands them', () => {
    const go = { id: 'e1', name: 'click', action: 'go_to_url', payload: { url: '/a' } };
    for (const events of [[go, { ...go, id: 'e2' }], [{ id: 'e1', name: 'click', action: 'open_cart', payload: {} }]]) {
      const { doc, id } = page({}, { events });
      expect(found(doc, id).map((f) => f.code), JSON.stringify(events)).toContain('href_params_stranded');
    }
    const bought = page({}, { bindings: [{ id: 'bind-product-action', source: 'product.id', field: 'specials.x' }] });
    expect(found(bought.doc, bought.id).map((f) => f.code)).toContain('href_params_stranded');
  });

  it('hrefParams is base specials and never translated', () => {
    const { doc, id } = page();
    const p = setKeys(doc, id, 'specials', { hrefParams: [{ name: 'room', source: 'record.id' }] }, { breakpoint: 'mobile' });
    expect(JSON.stringify(p)).not.toContain('mobile');
  });
});

describe('visitor favorites on a record list (web_builder v1.0.174, contract §7.7)', () => {
  function page(heart: { outside?: boolean; type?: string } = {}, tab: Record<string, unknown> = { view: 'favorites', showCount: true }, target?: 'product' | 'relation' | 'missing') {
    const doc = emptyDoc();
    const { patches, ids } = addSubtree(doc, 'ROOT', {
      type: 'flex-section',
      children: [
        { type: heart.type ?? 'button' },
        { type: 'button' },
        { type: 'list-dataset' },
        {
          type: 'list-dataset',
          config: { datasetSource: 'record', recordCollectionId: 'col_h' },
          children: [{ type: 'dataset-block', children: [
            { type: heart.type ?? 'button' },
            { type: 'list-dataset', config: { datasetSource: 'record', recordCollectionId: 'col_r', recordRelationField: FID_HOTEL } },
          ] }],
        },
      ],
    });
    doc.apply(patches);
    const of = (t: string) => ids.filter((i) => doc.node(i).data.type === t);
    const btns = of(heart.type ?? 'button');
    const lists = of('list-dataset');
    const heartId = heart.outside ? btns[0] : btns[btns.length - 1];
    const tabId = of('button').find((b) => b !== heartId && b !== btns[0] && b !== btns[btns.length - 1]) ?? of('button')[1];
    const targetId = target === 'product' ? lists[0] : target === 'relation' ? lists[2] : target === 'missing' ? 'nope' : lists[1];
    (doc.node(heartId) as unknown as { events: unknown[] }).events = [{ id: 'h', name: 'click', action: 'toggle_record_favorite', payload: {} }];
    (doc.node(tabId) as unknown as { events: unknown[] }).events = [{ id: 't', name: 'click', action: 'show_record_favorites', payload: { targetId, ...tab } }];
    return { doc, heartId, tabId };
  }
  const codes = (d: PageDoc, id: string, pageType?: string) =>
    reviewDesign(d, { pageType }).filter((f) => f.nodeId === id).map((f) => f.code);

  it('the catalog offers both actions on a button and not on an icon', () => {
    expect(ELEMENTS.button.events?.click).toEqual(expect.arrayContaining(['toggle_record_favorite', 'show_record_favorites']));
    expect(ELEMENTS.icon.events?.click ?? []).not.toContain('toggle_record_favorite');
  });

  it('a heart in a record row and a tab over the record list are clean', () => {
    const { doc, heartId, tabId } = page();
    expect(codes(doc, heartId)).not.toContain('record_favorite_invalid');
    expect(codes(doc, tabId)).not.toContain('record_favorite_invalid');
    expect(codes(doc, tabId)).not.toContain('action_missing_target');
  });

  it('a heart outside any record row publishes nothing — unless the page is a record page', () => {
    const { doc, heartId } = page({ outside: true });
    expect(codes(doc, heartId)).toContain('record_favorite_invalid');
    expect(codes(doc, heartId, 'record')).not.toContain('record_favorite_invalid');
  });

  it('a heart on an icon is an action the icon does not offer', () => {
    const { doc, heartId } = page({ type: 'icon' });
    expect(codes(doc, heartId)).toContain('invalid_action');
  });

  it('a tab aimed at a product list, a relation list or nothing, or with an unknown view, is flagged', () => {
    for (const t of ['product', 'relation', 'missing'] as const) {
      const { doc, tabId } = page({}, { view: 'favorites' }, t);
      expect(codes(doc, tabId), t).toContain('record_favorite_invalid');
    }
    const v = page({}, { view: 'saved' });
    expect(codes(v.doc, v.tabId)).toContain('record_favorite_invalid');
    const none = page({}, { view: 'all', targetId: '' });
    expect(codes(none.doc, none.tabId)).toContain('action_missing_target');
  });
});

describe('a referenced record\'s field on a row (web_builder v1.0.174, contract §7.8)', () => {
  const REF = `ref.${FID_HOTEL}.${FID_NAME}`;

  it('RECORD_SOURCE takes record.ref.<a>.<b> and its money form, never an html one', () => {
    expect(RECORD_SOURCE.test(`record.${REF}`)).toBe(true);
    expect(RECORD_SOURCE.test(`record.money.${REF}`)).toBe(true);
    expect(RECORD_SOURCE.test(`record.html.${REF}`)).toBe(false);
    expect(RECORD_SOURCE.test(`record.ref.${FID_HOTEL}`)).toBe(false);
  });

  it('a ref tile binds record.ref.… / record.money.ref.…, a richtext one nothing — pinned to the platform probes', () => {
    const at_ = (config: Record<string, unknown>) => first(createNode('text-dataset', { config: { datasetSource: 'record', ...config } }));
    expect(at_({ recordField: REF, recordFieldType: 'text' }).source).toBe(`record.${REF}`);
    expect(at_({ recordField: REF, recordFieldType: 'integer', recordFormat: 'money' }).source).toBe(`record.money.${REF}`);
    expect(at_({ recordField: REF, recordFieldType: 'richtext' }).source).toBe('');
    const probes = RECORD_BINDING_PROBES.filter((p) => String(p.config.recordField).startsWith('ref.'));
    expect(probes.length).toBeGreaterThanOrEqual(3);
  });

  it('sb_review takes a ref recordField as a field', () => {
    const { doc, tile } = recordList('col_1', { datasetSource: 'record', recordField: REF, recordFieldType: 'text' });
    expect(reviewDesign(doc, {}).filter((f) => f.nodeId === tile).map((f) => f.code)).not.toContain('record_field_unset');
    const bad = recordList('col_1', { datasetSource: 'record', recordField: `ref.${FID_HOTEL}.name`, recordFieldType: 'text' });
    expect(reviewDesign(bad.doc, {}).filter((f) => f.nodeId === bad.tile).map((f) => f.code)).toContain('record_field_unset');
  });

  it('recordFieldProblem checks the reference and the target field', () => {
    const rooms = { collectionId: 'col_r', fields: [{ id: FID_HOTEL, key: 'hotel', type: 'reference', refCollectionId: 'col_h' }, { id: FID_ROOM, key: 'name', type: 'text' }] };
    const refs = { col_h: [{ id: FID_NAME, key: 'name', type: 'text' }, { id: FID, key: 'stars', type: 'integer' }, { id: FID2, key: 'body', type: 'richtext' }] };
    expect(recordFieldProblem(`record.${REF}`, [rooms], refs)).toBeUndefined();
    expect(recordFieldProblem(`record.money.ref.${FID_HOTEL}.${FID}`, [rooms], refs)).toBeUndefined();
    expect(recordFieldProblem(`record.ref.${FID_ROOM}.${FID_NAME}`, [rooms], refs)).toMatch(/not a reference/);
    expect(recordFieldProblem(`record.ref.${FID_HOTEL}.${FID_ROOM}`, [rooms], refs)).toMatch(/not a field of col_h/);
    expect(recordFieldProblem(`record.ref.${FID_HOTEL}.${FID2}`, [rooms], refs)).toMatch(/richtext/);
    expect(recordFieldProblem(`record.money.${REF}`, [rooms], refs)).toMatch(/number or integer/);
  });
});

describe('tags fields (web_builder v1.0.174, contract §2 / §7.1)', () => {
  it('the field-type vocabulary and the call sheet carry tags', () => {
    const t = REQUEST_SHAPES['post:/api/sites/{siteId}/collections/{id}/fields'].fields.find((f) => f.name === 'type')!.type;
    expect(t).toContain('"tags"');
    const sheet = JSON.stringify(describeOperation(findOperation('post:/api/sites/{siteId}/collections/{id}/fields')!));
    for (const s of ['tags', 'no comma', 'fm.record.', 'filterMatch']) expect(sheet).toContain(s);
  });

  it('a tags field binds like any text field', () => {
    expect(recordFieldProblem(`record.${FID}`, [{ collectionId: 'c', fields: [{ id: FID, key: 'amenities', type: 'tags' }] }])).toBeUndefined();
  });
});
