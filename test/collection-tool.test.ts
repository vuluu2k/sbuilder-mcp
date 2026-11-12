import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/** sb_collection — the site's data tables (web_builder internal/collections, editor REST). */
const B = '/api/sites/s1/collections';
const COL = { id: 'col_a', siteId: 's1', name: 'Rooms', slug: 'rooms', publicRead: false };
const HOTELS = { id: 'col_h', siteId: 's1', name: 'Hotels', slug: 'hotels', publicRead: true };
const FIELD = { id: 'fld_1', key: 'title', label: 'Title', type: 'text', required: true, options: [], position: 0, refCollectionId: '' };
const REC = { id: 'rec_1', collectionId: 'col_a', siteId: 's1', values: { title: 'A', beds: 2 }, published: true, externalId: 'x1', rev: 3 };

function platform(opts: { inUse?: boolean; stale?: boolean } = {}) {
  const writes: Array<{ method: string; path: string; query: string; body: any }> = [];
  const fake = fakePlatform((method, path, body, query) => {
    if (method !== 'GET') writes.push({ method, path, query, body });
    if (path === B) return method === 'POST' ? { collection: { ...COL, id: 'col_n', ...(body as object), publicRead: false } } : { collections: [COL, HOTELS], total: 2 };
    if (path === `${B}/col_a` || path === `${B}/col_n`) {
      if (method === 'DELETE' && opts.inUse) {
        return { __status: 409, error: 'a page or form still uses this collection', code: 'in_use', details: { pages: [{ id: 'p1', name: 'Home' }], forms: [], collections: [], records: 0 } };
      }
      return method === 'DELETE' ? {} : { collection: { ...COL, ...(body as object) } };
    }
    if (path === `${B}/col_a/fields`) return method === 'POST' ? { field: { ...(body as object), id: 'fld_2' } } : { fields: [FIELD], total: 1 };
    if (path === `${B}/col_a/fields/fld_1`) return method === 'DELETE' ? {} : { field: { ...FIELD, ...(body as object) } };
    if (path === `${B}/col_a/records` && method === 'GET') return { records: [REC], total: 1 };
    if (path === `${B}/col_a/records`) return { record: { ...REC, id: 'rec_2', ...(body as object) } };
    if (path === `${B}/records/rec_1`) return { record: REC };
    if (path === `${B}/col_a/records/rec_1`) {
      if (opts.stale) return { __status: 409, error: 'the record was changed elsewhere; reload it and try again', code: 'stale_record' };
      return method === 'DELETE' ? {} : { record: { ...REC, ...(body as object), rev: 4 } };
    }
    if (path === `${B}/col_a/records.csv`) return new Response('title,beds\nA,2\n', { headers: { 'content-type': 'text/csv' } });
    if (path === `${B}/col_a/records/import`) return { imported: 1 };
    if (path === `${B}/col_a/records/upsert`) {
      if ((body as any).records.length > 1) return { __status: 400, error: 'invalid rows', code: 'invalid_rows', details: { rows: [{ row: 1, field: 'beds', message: 'must be a number' }] } };
      return { records: [{ externalId: 'x1', id: 'rec_1', created: false, changed: true, rev: 4 }], created: 0, updated: 1, unchanged: 0 };
    }
    return undefined;
  });
  return { fake, writes };
}

async function withCall(p: ReturnType<typeof platform>, fn: (call: Awaited<ReturnType<ReturnType<typeof platform>['fake']['connect']>>['call']) => Promise<void>) {
  const { call, close } = await p.fake.connect();
  try {
    await fn(call);
  } finally {
    await close();
  }
}

const S = { site_id: 's1' };

describe('sb_collection', () => {
  it('list is compact; a slug resolves to the id on every route', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_collection', { ...S, action: 'list' });
      expect(r.json.collections).toEqual([{ id: 'col_a', name: 'Rooms', slug: 'rooms' }, { id: 'col_h', name: 'Hotels', slug: 'hotels', publicRead: true }]);
      const f = await call('sb_collection', { ...S, action: 'fields', collection: 'rooms' });
      expect(f.json.fields).toEqual([{ id: 'fld_1', key: 'title', label: 'Title', type: 'text', required: true }]);
      const miss = await call('sb_collection', { ...S, action: 'fields', collection: 'nope' });
      expect(miss.isError).toBe(true);
      expect(miss.text).toMatch(/no collection "nope"/);
    });
  });

  it('every write is a dry run by default and sends nothing', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const cases: Record<string, unknown>[] = [
        { action: 'create', name: 'X' },
        { action: 'update', collection: 'rooms', name: 'Y' },
        { action: 'delete', collection: 'rooms' },
        { action: 'field_add', collection: 'rooms', key: 'beds', type: 'integer' },
        { action: 'field_update', collection: 'rooms', field: 'title', name: 'Name' },
        { action: 'field_delete', collection: 'rooms', field: 'title' },
        { action: 'field_order', collection: 'rooms', ids: ['title'] },
        { action: 'add', collection: 'rooms', values: { title: 'B' } },
        { action: 'edit', id: 'rec_1', values: { beds: 3 } },
        { action: 'remove', id: 'rec_1' },
        { action: 'move', id: 'rec_1', delta: 1 },
        { action: 'order', collection: 'rooms', ids: ['rec_1'] },
        { action: 'import', collection: 'rooms', csv: 'title\nC\n' },
        { action: 'upsert', collection: 'rooms', records: [{ external_id: 'x1', values: { title: 'A' } }] },
      ];
      for (const c of cases) {
        const r = await call('sb_collection', { ...S, ...c });
        expect(r.isError, `${c.action}: ${r.text}`).toBe(false);
        expect(r.json.dry_run, String(c.action)).toBe(true);
      }
      expect(p.writes).toEqual([]);
    });
  });

  it('create sends name and slug, then publicRead through a PUT (create ignores it)', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_collection', { ...S, action: 'create', name: 'News', slug: 'news', public_read: true, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(p.writes.map((w) => [w.method, w.path])).toEqual([['POST', B], ['PUT', `${B}/col_n`]]);
      expect(p.writes[1].body).toEqual({ name: 'News', slug: 'news', publicRead: true });
    });
  });

  it('update keeps the stored name/slug and leaves publicRead out unless given', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      await call('sb_collection', { ...S, action: 'update', collection: 'col_a', slug: 'room', dry_run: false });
      expect(p.writes[0]).toMatchObject({ method: 'PUT', path: `${B}/col_a`, body: { name: 'Rooms', slug: 'room' } });
      expect(p.writes[0].body).not.toHaveProperty('publicRead');
    });
  });

  it('field_add refuses a key the platform refuses, before any request, with its sentence', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      for (const key of ['Beds', '1x', 'a-b', 'a'.repeat(41)]) {
        const r = await call('sb_collection', { ...S, action: 'field_add', collection: 'rooms', key, type: 'text', dry_run: false });
        expect(r.isError, key).toBe(true);
        expect(r.text).toMatch(/must start with a lowercase letter and use a-z, 0-9, _ \(max 40\)/);
      }
      const bad = await call('sb_collection', { ...S, action: 'field_add', collection: 'rooms', key: 'x', type: 'money' });
      expect(bad.isError).toBe(true);
      expect(p.writes).toEqual([]);
    });
  });

  it('field_add resolves a reference target by slug; label defaults to key', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_collection', { ...S, action: 'field_add', collection: 'rooms', key: 'hotel', type: 'reference', ref: 'hotels', dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(p.writes[0].body).toEqual({ key: 'hotel', label: 'hotel', type: 'reference', required: false, options: [], refCollectionId: 'col_h' });
      expect(r.json.created).toMatchObject({ id: 'fld_2', ref: 'col_h' });
    });
  });

  it('field_update is a FULL replace: every stored property goes back with the change', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      await call('sb_collection', { ...S, action: 'field_update', collection: 'rooms', field: 'title', name: 'Name', dry_run: false });
      expect(p.writes[0]).toMatchObject({ method: 'PUT', path: `${B}/col_a/fields/fld_1` });
      expect(p.writes[0].body).toEqual({ key: 'title', label: 'Name', type: 'text', required: true, options: [], refCollectionId: '' });
      await call('sb_collection', { ...S, action: 'field_order', collection: 'rooms', ids: ['title'], dry_run: false });
      expect(p.writes[1]).toMatchObject({ method: 'PUT', path: `${B}/col_a/fields/order`, body: { ids: ['fld_1'] } });
    });
  });

  it('records passes the query through and answers compact rows', async () => {
    const p = platform();
    let q = '';
    const fake = fakePlatform((m, path, _b, query) => {
      if (path === B) return { collections: [COL] };
      if (path === `${B}/col_a/records`) {
        q = query;
        return { records: [REC, { ...REC, id: 'rec_2', published: false, externalId: '' }], total: 9 };
      }
      return undefined;
    });
    void p;
    const { call, close } = await fake.connect();
    const r = await call('sb_collection', { ...S, action: 'records', collection: 'rooms', sort: '-beds', filter: { title: 'A' }, published: true, offset: 50, limit: 50 });
    await close();
    expect(new URLSearchParams(q).toString()).toBe('sort=beds&desc=true&filterKey=title&filterValue=A&published=true&offset=50&limit=50');
    expect(r.json).toEqual({
      records: [
        { id: 'rec_1', values: { title: 'A', beds: 2 }, rev: 3, externalId: 'x1' },
        { id: 'rec_2', values: { title: 'A', beds: 2 }, rev: 3, published: false },
      ],
      total: 9,
    });
  });

  it('edit merges values, keeps published (an omitted one would unpublish), sends rev; null clears a key', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_collection', { ...S, action: 'edit', id: 'rec_1', values: { beds: 3, title: null }, dry_run: false });
      expect(r.isError, r.text).toBe(false);
      expect(p.writes[0]).toMatchObject({ method: 'PUT', path: `${B}/col_a/records/rec_1` });
      expect(p.writes[0].body).toEqual({ values: { beds: 3 }, published: true, rev: 3 });
    });
  });

  it('a stale record says to re-run', async () => {
    await withCall(platform({ stale: true }), async (call) => {
      const r = await call('sb_collection', { ...S, action: 'edit', id: 'rec_1', values: { beds: 3 }, dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/stale_record.*re-run/);
    });
  });

  it('delete previews what goes; an in-use refusal names the pages', async () => {
    const p = platform({ inUse: true });
    await withCall(p, async (call) => {
      const dry = await call('sb_collection', { ...S, action: 'delete', collection: 'rooms' });
      expect(dry.json.removes).toMatchObject({ id: 'col_a', records: 1 });
      const r = await call('sb_collection', { ...S, action: 'delete', collection: 'rooms', dry_run: false });
      expect(r.isError).toBe(true);
      expect(r.text).toMatch(/in_use.*"Home"/);
    });
  });

  it('remove and move address the record under its own collection', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      await call('sb_collection', { ...S, action: 'remove', id: 'rec_1', dry_run: false });
      await call('sb_collection', { ...S, action: 'move', id: 'rec_1', delta: -1, dry_run: false });
      expect(p.writes.map((w) => [w.method, w.path, w.body])).toEqual([
        ['DELETE', `${B}/col_a/records/rec_1`, undefined],
        ['POST', `${B}/col_a/records/rec_1/move`, { delta: -1 }],
      ]);
    });
  });

  it('export returns the CSV text; import sends the raw CSV, not JSON', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const e = await call('sb_collection', { ...S, action: 'export', collection: 'rooms' });
      expect(e.json).toEqual({ csv: 'title,beds\nA,2\n' });
      const i = await call('sb_collection', { ...S, action: 'import', collection: 'rooms', csv: 'title,beds\nC,1\n', dry_run: false });
      expect(i.json).toEqual({ imported: 1 });
      const sent = p.writes[0].body as Blob;
      expect(sent).toBeInstanceOf(Blob);
      expect(sent.type).toBe('text/csv');
      expect(await sent.text()).toBe('title,beds\nC,1\n');
    });
  });

  it('upsert maps external_id → externalId and answers counts; invalid rows say which', async () => {
    const p = platform();
    await withCall(p, async (call) => {
      const r = await call('sb_collection', { ...S, action: 'upsert', collection: 'rooms', records: [{ external_id: 'x1', values: { beds: 3 } }], dry_run: false });
      expect(p.writes[0].body).toEqual({ records: [{ externalId: 'x1', values: { beds: 3 } }] });
      expect(r.json).toEqual({ created: 0, updated: 1, unchanged: 0 });
      const bad = await call('sb_collection', {
        ...S, action: 'upsert', collection: 'rooms', dry_run: false,
        records: [{ external_id: 'a', values: {} }, { external_id: 'b', values: { beds: 'x' } }],
      });
      expect(bad.isError).toBe(true);
      expect(bad.text).toMatch(/invalid_rows.*must be a number/);
    });
  });
});
