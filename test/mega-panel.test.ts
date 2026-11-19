/**
 * A MEGA PANEL from sb_add — the editor's "Edit dropdown" (convertMenuRowToPanel):
 * a `menu-panel` appended to the MENU's data.nodes, and the row matched by id
 * (any depth) pointing at it through `panelId`, in one save. sb_remove undoes
 * both halves (removeMenuRowPanel); a re-bind keeps the pointer (preservePanels).
 */
import { describe, it, expect } from 'vitest';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, removeNode } from '../src/domains/site/builder.js';

type Row = { id: string; label: string; href: string; panelId?: string; items?: Row[] };
const ROWS: Row[] = [
  { id: 'r1', label: 'Shop', href: '', items: [{ id: 'r1a', label: 'New in', href: '' }] },
  { id: 'r2', label: 'Sale', href: '' },
];

/** A section holding one menu whose rows are ROWS (r1a nested one level down). */
function menuDoc(rows: Row[] = ROWS): { d: PageDoc; menu: string; section: string } {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const { patches, ids } = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'menu', specials: { menuItems: structuredClone(rows) } }],
  });
  d.apply(patches);
  return { d, section: ids[0], menu: ids[1] };
}
const rowsOf = (d: PageDoc, menu: string) => d.node(menu).specials.menuItems as Row[];
const PANEL = { type: 'menu-panel' };

describe('sb_add a menu-panel with menu_item_id', () => {
  it('appends the panel to the menu and points the NESTED row at it, in one batch', () => {
    const { d, menu } = menuDoc();
    // Liveness of the fixture: the target row really is nested, not top-level.
    expect(rowsOf(d, menu).some((r) => r.id === 'r1a'), 'r1a must not be a top-level row').toBe(false);
    const before = d.node(menu).data.nodes.length;
    const { patches, ids } = addSubtree(d, menu, PANEL, undefined, undefined, 'r1a');
    d.apply(patches);
    const panel = ids[0];
    expect(d.node(panel).data.type).toBe('menu-panel');
    expect(d.node(panel).data.parent).toBe(menu);
    expect(d.node(menu).data.nodes.length, 'one child added').toBe(before + 1);
    expect(d.node(menu).data.nodes.at(-1), 'panel appended to the menu').toBe(panel);
    expect(rowsOf(d, menu)[0].items![0].panelId, 'nested row bound').toBe(panel);
    expect(rowsOf(d, menu)[0].panelId, 'parent row untouched').toBeUndefined();
    expect(rowsOf(d, menu)[1].panelId, 'sibling row untouched').toBeUndefined();
  });

  it('is shown by sb_outline under its menu, with the row it serves', () => {
    const { d, menu } = menuDoc();
    const { patches, ids } = addSubtree(d, menu, PANEL, undefined, undefined, 'r2');
    d.apply(patches);
    const sec = d.outline({ depth: 3 })[0];
    const m = sec.kids!.find((k) => k.id === menu)!;
    const p = m.kids!.find((k) => k.id === ids[0]);
    expect(p, 'panel listed under the menu').toMatchObject({ type: 'menu-panel', menu_item: 'r2', label: 'Sale' });
  });

  it('without menu_item_id a menu-panel under a menu is refused, naming the argument', () => {
    const { d, menu } = menuDoc();
    expect(() => addSubtree(d, menu, PANEL)).toThrow(/not a container[\s\S]*menu_item_id/);
  });

  it('refuses a row id the menu does not have, listing the real ones', () => {
    const { d, menu } = menuDoc();
    expect(() => addSubtree(d, menu, PANEL, undefined, undefined, 'nope')).toThrow(
      /has no row "nope"\. Its rows: r1, r1a, r2\./,
    );
  });

  it('refuses a row that already has a LIVE panel, saying how to edit or remove it', () => {
    const { d, menu } = menuDoc();
    const first = addSubtree(d, menu, PANEL, undefined, undefined, 'r2');
    d.apply(first.patches);
    expect(() => addSubtree(d, menu, PANEL, undefined, undefined, 'r2')).toThrow(
      new RegExp(`already has a mega panel \\(${first.ids[0]}\\).*sb_add parent_id ${first.ids[0]}.*sb_remove ${first.ids[0]}`),
    );
  });

  it('a DANGLING panelId reads as no panel (as both renderers do), so the row converts', () => {
    const { d, menu } = menuDoc([{ id: 'r9', label: 'X', href: '', panelId: 'gone_1' }]);
    expect(d.has('gone_1'), 'fixture: the stale id names nothing').toBe(false);
    const { patches, ids } = addSubtree(d, menu, PANEL, undefined, undefined, 'r9');
    d.apply(patches);
    expect(rowsOf(d, menu)[0].panelId).toBe(ids[0]);
  });

  it('refuses menu_item_id on a menu parent with any other child', () => {
    const { d, menu } = menuDoc();
    expect(() => addSubtree(d, menu, { type: 'heading' }, undefined, undefined, 'r1')).toThrow(
      /menu_item_id .* applies only to a menu-panel added directly under a menu — not to a heading under a menu/,
    );
  });

  it('refuses menu_item_id for a menu-panel under any parent but a menu', () => {
    const { d, section } = menuDoc();
    // Liveness: the same placement WITHOUT the argument is accepted, so the
    // refusal below is the menu_item_id clause and nothing else.
    expect(() => addSubtree(d, section, PANEL)).not.toThrow();
    expect(() => addSubtree(d, section, PANEL, undefined, undefined, 'r1')).toThrow(
      /applies only to a menu-panel added directly under a menu — not to a menu-panel under a flex-section/,
    );
  });
});

describe('sb_remove of a mega panel', () => {
  it("clears its row's panelId and leaves another row's panel alone", () => {
    const { d, menu } = menuDoc();
    const a = addSubtree(d, menu, PANEL, undefined, undefined, 'r1a');
    d.apply(a.patches);
    const b = addSubtree(d, menu, PANEL, undefined, undefined, 'r2');
    d.apply(b.patches);
    d.apply(removeNode(d, a.ids[0]));
    expect(d.has(a.ids[0])).toBe(false);
    expect(rowsOf(d, menu)[0].items![0].panelId, 'removed panel unbound').toBeUndefined();
    expect(rowsOf(d, menu)[1].panelId, 'other panel still bound').toBe(b.ids[0]);
  });

  it('a menu-panel that is not a mega panel (not under a menu) touches no menu', () => {
    const { d, section, menu } = menuDoc();
    const p = addSubtree(d, section, PANEL);
    d.apply(p.patches);
    const patches = removeNode(d, p.ids[0]);
    expect(patches.some((x) => x.path.includes('menuItems'))).toBe(false);
    expect(rowsOf(d, menu)).toEqual(ROWS);
  });
});

describe('end to end through the tools: add, re-bind, remove', () => {
  it('one save each; the re-bind keeps the panel; sb_remove unbinds the row', async () => {
    const { d, menu } = menuDoc();
    let current: unknown = d.doc;
    const saved: Array<{ document: { nodes: Record<string, { data: { nodes: string[] }; specials: Record<string, unknown> }> } }> = [];
    const SITE_MENU = {
      id: 'mn_1',
      name: 'Main',
      items: [
        { id: 'r1', label: 'Shop!', link: { type: 'none' }, items: [{ id: 'r1a', label: 'New in', link: { type: 'none' } }] },
        { id: 'r2', label: 'Sale', link: { type: 'none' } },
      ],
    };
    const f = (async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      const method = init?.method ?? 'GET';
      const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/source')) {
        if (method === 'PUT') {
          const body = JSON.parse(String(init!.body));
          saved.push(body);
          current = body.document;
        }
        return json({ source: { pageId: 'pg_1', siteId: 's1', document: current, schemaVersion: 2, updatedAt: 'now' } });
      }
      if (path.endsWith('/menus')) return json({ menus: [SITE_MENU] });
      if (path.endsWith('/menus/mn_1')) return json({ menu: SITE_MENU });
      return json({});
    }) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    const { client, close } = await connectedClient({ base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), siteId: 's1' });
    const parse = (r: unknown) => JSON.parse((r as { content: Array<{ text: string }> }).content[0].text);
    const rows = (i: number) => saved[i].document.nodes[menu].specials.menuItems as Row[];

    await client.callTool({ name: 'sb_page_open', arguments: { site_id: 's1', page_id: 'pg_1' } });
    const add = await client.callTool({
      name: 'sb_add',
      arguments: { parent_id: menu, spec: PANEL, menu_item_id: 'r1a', dry_run: false },
    });
    expect((add as { isError?: boolean }).isError, JSON.stringify(add)).toBeFalsy();
    const panel = Object.keys(parse(add).added)[0];
    expect(saved.length, 'panel + row pointer in ONE save').toBe(1);
    expect(saved[0].document.nodes[menu].data.nodes).toContain(panel);
    expect(rows(0)[0].items![0].panelId).toBe(panel);

    await client.callTool({ name: 'sb_store', arguments: { action: 'menu', node_id: menu, dry_run: false } });
    expect(saved.length).toBe(2);
    // Liveness: the re-bind really rewrote the rows (the site's label won)…
    expect(rows(1)[0].label, 're-bind took the site rows').toBe('Shop!');
    // …and still carried the panel pointer across.
    expect(rows(1)[0].items![0].panelId, 'panelId preserved by re-bind').toBe(panel);

    await client.callTool({ name: 'sb_remove', arguments: { id: panel, dry_run: false } });
    expect(saved.length).toBe(3);
    expect(saved[2].document.nodes[panel]).toBeUndefined();
    expect(rows(2)[0].items![0].panelId, 'row unbound with the panel').toBeUndefined();
    await close();
  });
});
