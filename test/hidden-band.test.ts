import { describe, it, expect } from 'vitest';
import { fakePlatform, blank } from './helpers/platform.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';

/**
 * `config.hidden` IS PER BAND AND DOES NOT CASCADE (render/css.go hiddenAt,
 * editor trait/display.ts isHiddenAt): desktop reads the BASE config, every
 * narrower breakpoint reads only its own responsive slot, and
 * `responsive.desktop.config.hidden` is read by neither. So base hidden:true
 * hides the node at ≥1440px alone, and the per-breakpoint DEFAULT of sb_set
 * (desktop) stored the flag where nothing looks.
 */
function page() {
  const d = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: { rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {}, responsive: {} } },
  });
  const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section' });
  d.apply(patches);
  return { d, id: ids[0] };
}

describe('config.hidden lands where each band reads it', () => {
  it('a desktop write (the default) goes to BASE — responsive.desktop.config.hidden is read by nothing', () => {
    const { d, id } = page();
    const paths = setKeys(d, id, { hidden: true }, { namespace: 'config' }).map((p) => p.path.join('.'));
    expect(paths).toContain(`nodes.${id}.config.hidden`);
    expect(paths).not.toContain(`nodes.${id}.responsive.desktop.config.hidden`);
    const un = setKeys(d, id, {}, { namespace: 'config', unset: ['hidden'] }).map((p) => p.path.join('.'));
    expect(un).toEqual([`nodes.${id}.config.hidden`]);
  });

  it('a desktop (or base) write of hidden also clears a dead responsive.desktop.config.hidden left by sb_set before 0.98.6', () => {
    const { d, id } = page();
    // What an older sb_set stored: the desktop slot, read by nothing.
    d.apply([{ op: 'set', path: ['nodes', id, 'responsive', 'desktop', 'config', 'hidden'], value: true }]);
    const un = setKeys(d, id, {}, { namespace: 'config', unset: ['hidden'] }).map((p) => p.path.join('.'));
    expect(un.sort()).toEqual([`nodes.${id}.config.hidden`, `nodes.${id}.responsive.desktop.config.hidden`].sort());
    const set = setKeys(d, id, { hidden: true }, { namespace: 'config', base: true }).map((p) => `${p.op}:${p.path.join('.')}`);
    expect(set).toContain(`unset:nodes.${id}.responsive.desktop.config.hidden`);
    // A narrower write leaves it alone — it is not that band's slot.
    const mob = setKeys(d, id, { hidden: true }, { namespace: 'config', breakpoint: 'mobile' }).map((p) => p.path.join('.'));
    expect(mob).toEqual([`nodes.${id}.responsive.mobile.config.hidden`]);
  });

  it('sb_review reports a dead responsive.desktop.config.hidden, and the fix clears it', () => {
    const { d, id } = page();
    d.apply([{ op: 'set', path: ['nodes', id, 'responsive', 'desktop', 'config', 'hidden'], value: true }]);
    const f = reviewDesign(d).find((x) => x.code === 'hidden_desktop_dead');
    expect(f?.nodeId).toBe(id);
    expect(f?.problem).toMatch(/1440/);
    expect(f?.fix).toMatch(/unset/);
    d.apply(setKeys(d, id, {}, { namespace: 'config', unset: ['hidden'] }));
    expect(reviewDesign(d).some((x) => x.code === 'hidden_desktop_dead')).toBe(false);
  });

  it('a narrower breakpoint keeps its own slot', () => {
    const { d, id } = page();
    const paths = setKeys(d, id, { hidden: true }, { namespace: 'config', breakpoint: 'mobile' }).map((p) => p.path.join('.'));
    expect(paths).toEqual([`nodes.${id}.responsive.mobile.config.hidden`]);
  });

  it('sb_add routes a spec\'s responsive.desktop.config.hidden to base too', () => {
    const { d, id } = page();
    const { patches, ids } = addSubtree(d, id, { type: 'flex-block', responsive: { desktop: { config: { hidden: true } } } });
    d.apply(patches);
    const n = d.doc.nodes[ids[0]] as unknown as { config: Record<string, unknown>; responsive?: Record<string, { config?: Record<string, unknown> }> };
    expect(n.config.hidden).toBe(true);
    expect(n.responsive?.desktop?.config?.hidden).toBeUndefined();
  });
});

type Check = { code: string; fix: string; problem: string };
const band = (r: { json: Record<string, unknown> }) => ((r.json.checks ?? []) as Check[]).filter((c) => c.code === 'hidden_band');

async function open() {
  const p = fakePlatform();
  const { call, close } = await p.connect();
  await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
  const add = await call('sb_add', { parent_id: 'ROOT', spec: { type: 'flex-section' }, dry_run: false });
  return { call, close, id: Object.keys(add.json.added as Record<string, string>)[0] };
}

describe('hiding at base says it hides only the desktop band, once', () => {
  it('sb_set base hidden:true warns and names the three narrower writes; a second call is silent', async () => {
    const { call, close, id } = await open();
    try {
      // A dry run peeks without spending the notice; the real write spends it.
      expect(band(await call('sb_set', { id, namespace: 'config', keys: { hidden: true }, base: true }))).toHaveLength(1);
      const r = await call('sb_set', { id, namespace: 'config', keys: { hidden: true }, base: true, dry_run: false });
      const [c] = band(r);
      expect(c.problem).toMatch(/1440/);
      expect(c.fix).toMatch(/laptop/);
      expect(c.fix).toMatch(/tablet/);
      expect(c.fix).toMatch(/mobile/);
      const again = await call('sb_set', { id, namespace: 'config', keys: { hidden: true } });
      expect(band(again)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('is silent when the write hides every band, or only a narrower one', async () => {
    const { call, close, id } = await open();
    try {
      const all = await call('sb_set', {
        edits: [
          { id, namespace: 'config', keys: { hidden: true }, base: true },
          ...(['laptop', 'tablet', 'mobile'] as const).map((breakpoint) => ({ id, namespace: 'config', keys: { hidden: true }, breakpoint })),
        ],
      });
      expect(band(all)).toEqual([]);
      const phone = await call('sb_set', { id, namespace: 'config', keys: { hidden: true }, breakpoint: 'mobile' });
      expect(band(phone)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('sb_add warns for a spec hidden at base alone', async () => {
    const { call, close, id } = await open();
    try {
      const r = await call('sb_add', { parent_id: id, spec: { type: 'flex-block', config: { hidden: true } } });
      expect(band(r)).toHaveLength(1);
      const all = await call('sb_add', {
        parent_id: id,
        spec: {
          type: 'flex-block',
          config: { hidden: true },
          responsive: { laptop: { config: { hidden: true } }, tablet: { config: { hidden: true } }, mobile: { config: { hidden: true } } },
        },
      });
      expect(band(all)).toEqual([]);
    } finally {
      await close();
    }
  });
});

const NARROW = ['laptop', 'tablet', 'mobile'] as const;
const hideAt = (id: string, bps: readonly string[]) => ({
  edits: bps.map((breakpoint) => ({ id, namespace: 'config', keys: { hidden: true }, breakpoint })),
  dry_run: false,
});

describe('hidden_band counts a band as showing only when no ancestor hides it there', () => {
  it('sb_set: an ancestor hidden at the narrow bands makes a child\'s base hide complete', async () => {
    const { call, close, id } = await open();
    try {
      await call('sb_set', hideAt(id, NARROW));
      const kid = Object.keys((await call('sb_add', { parent_id: id, spec: { type: 'flex-block' }, dry_run: false })).json.added as Record<string, string>)[0];
      expect(band(await call('sb_set', { id: kid, namespace: 'config', keys: { hidden: true } }))).toEqual([]);
    } finally {
      await close();
    }
  });

  it('sb_set: an ancestor hidden at mobile alone leaves laptop and tablet named, mobile not', async () => {
    const { call, close, id } = await open();
    try {
      await call('sb_set', hideAt(id, ['mobile']));
      const kid = Object.keys((await call('sb_add', { parent_id: id, spec: { type: 'flex-block' }, dry_run: false })).json.added as Record<string, string>)[0];
      const [c] = band(await call('sb_set', { id: kid, namespace: 'config', keys: { hidden: true } }));
      expect(c.problem).toMatch(/laptop, tablet still show/);
      expect(c.fix).not.toMatch(/mobile/);
    } finally {
      await close();
    }
  });

  it('sb_add: parent_id\'s ancestors count', async () => {
    const { call, close, id } = await open();
    try {
      await call('sb_set', hideAt(id, NARROW));
      const mid = Object.keys((await call('sb_add', { parent_id: id, spec: { type: 'flex-block' }, dry_run: false })).json.added as Record<string, string>)[0];
      expect(band(await call('sb_add', { parent_id: mid, spec: { type: 'flex-block', config: { hidden: true } } }))).toEqual([]);
    } finally {
      await close();
    }
  });

  it('sb_add: an outer spec node hidden at the narrow bands covers its hidden child', async () => {
    const { call, close, id } = await open();
    try {
      const r = await call('sb_add', {
        parent_id: id,
        spec: {
          type: 'flex-block',
          responsive: { laptop: { config: { hidden: true } }, tablet: { config: { hidden: true } }, mobile: { config: { hidden: true } } },
          children: [{ type: 'flex-block', config: { hidden: true } }],
        },
      });
      expect(band(r)).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe('hidden_band judges the ancestors as the WHOLE batch leaves them', () => {
  it('one edits[] that hides the parent at the narrow bands and the child at base is silent', async () => {
    const { call, close, id } = await open();
    try {
      const kid = Object.keys((await call('sb_add', { parent_id: id, spec: { type: 'flex-block' }, dry_run: false })).json.added as Record<string, string>)[0];
      const r = await call('sb_set', {
        edits: [
          ...NARROW.map((breakpoint) => ({ id, namespace: 'config', keys: { hidden: true }, breakpoint })),
          { id: kid, namespace: 'config', keys: { hidden: true } },
        ],
      });
      expect(band(r)).toEqual([]);
    } finally {
      await close();
    }
  });

  it('and one that un-hides the parent there while hiding the child at base warns', async () => {
    const { call, close, id } = await open();
    try {
      await call('sb_set', hideAt(id, NARROW));
      const kid = Object.keys((await call('sb_add', { parent_id: id, spec: { type: 'flex-block' }, dry_run: false })).json.added as Record<string, string>)[0];
      const r = await call('sb_set', {
        edits: [
          ...NARROW.map((breakpoint) => ({ id, namespace: 'config', keys: { hidden: false }, breakpoint })),
          { id: kid, namespace: 'config', keys: { hidden: true } },
        ],
      });
      expect(band(r)).toHaveLength(1);
    } finally {
      await close();
    }
  });
});

describe('a node whose parent pointer dangles', () => {
  const dangling = () => {
    const p = fakePlatform();
    const doc = blank();
    doc.nodes.ROOT.data.nodes = ['sec1'];
    (doc.nodes as Record<string, unknown>).sec1 = {
      id: 'sec1',
      data: { type: 'flex-section', parent: 'gone', nodes: [] },
      style: {},
      config: {},
      specials: {},
    };
    p.pages.set('pg_1', { document: doc, rev: 1 });
    return p;
  };

  it('sb_set hidden:true still answers, and still names the bands', async () => {
    const { call, close } = await dangling().connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const r = await call('sb_set', { id: 'sec1', namespace: 'config', keys: { hidden: true } });
      expect(r.isError, r.text).toBe(false);
      expect(band(r)).toHaveLength(1);
    } finally {
      await close();
    }
  });

  it('sb_add of a hidden child under it still answers', async () => {
    const { call, close } = await dangling().connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      const r = await call('sb_add', { parent_id: 'sec1', spec: { type: 'flex-block', config: { hidden: true } } });
      expect(r.isError, r.text).toBe(false);
      expect(band(r)).toHaveLength(1);
    } finally {
      await close();
    }
  });
});
