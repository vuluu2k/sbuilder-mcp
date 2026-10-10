import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { connectedClient } from './harness.js';
import { ICON_KEYS, ICON_NAMES } from '../src/catalog/icons.generated.js';
import { ELEMENTS } from '../src/catalog/elements.generated.js';
import { writeCheck, specCheck } from '../src/domains/site/writecheck.js';
import { iconNote, nearestIcons, searchIcons } from '../src/domains/site/icons.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { traitsFor } from '../src/catalog/element-search.js';

/**
 * AN ICON NAME OUTSIDE THE MANIFEST IS STORED, SAVED AND PUBLISHED, then drawn
 * as the default star (`RenderIconSVG` falls back to `DefaultIcon`) or as
 * nothing (`button`'s `HasIcon` guard). ICON_KEYS says which keys hold one,
 * read off the editor's own IconPicker.
 */
describe('ICON_KEYS (codegen reader)', () => {
  const has = (type: string, ns: string, key: string) => ICON_KEYS[type]?.some((k) => k.ns === ns && k.key === key);

  it('reads the direct pickers, the widget props and the composite rows', () => {
    expect(has('icon', 'specials', 'name')).toBe(true); // IconPicker defaults
    expect(has('button', 'specials', 'icon')).toBe(true); // specialKey prop
    expect(has('divider', 'specials', 'iconName')).toBe(true);
    expect(has('form-text', 'specials', 'iconName')).toBe(true); // FieldIconRow.vue
    expect(has('popup', 'specials', 'closeIcon')).toBe(true); // PopupCloseRow.vue
    expect(has('list-dataset', 'config', 'listNavIcon')).toBe(true); // namespace="config", gate 'icon'
  });

  it('honours the gate and the hidden controls', () => {
    // ImageNavRows' picker is v-if gate === 'icon'; feature/image-list default to 'switch'.
    expect(ICON_KEYS['product-image-feature']).toBeUndefined();
    expect(ICON_KEYS['product-image-list']).toBeUndefined();
    // text-dataset lists the `icon` control as visible:false — no picker ever writes there.
    expect(ICON_KEYS['text-dataset']).toBeUndefined();
  });

  it('carries allowNone exactly where the picker offers "None"', () => {
    expect(ICON_KEYS.breadcrumb.find((k) => k.key === 'icon')?.allowNone).toBe(true);
    expect(ICON_KEYS.button.find((k) => k.key === 'icon')?.allowNone).toBeUndefined();
  });

  it('every element seed holding an icon key is a real name (or "")', () => {
    const bad: string[] = [];
    for (const [type, keys] of Object.entries(ICON_KEYS)) {
      const d = ELEMENTS[type].defaults as Record<string, Record<string, unknown> | undefined>;
      for (const k of keys) {
        const v = d[k.ns]?.[k.key];
        if (typeof v === 'string' && v && !ICON_NAMES.has(v)) bad.push(`${type} ${k.ns}.${k.key}=${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('icon write check', () => {
  it('flags a name outside the manifest with nearby real names', () => {
    const [n] = writeCheck('button', 'specials', { icon: 'ShoppingCart' }).map((c) => c.note);
    expect(n.code).toBe('unknown_icon');
    expect(n.key).toBe('specials.icon');
    expect(n.fix).toMatch(/ShoppingCart\dFill|ShoppingCartFill|ShoppingCartLine/);
    for (const s of nearestIcons('ShoppingCart')) expect(ICON_NAMES.has(s)).toBe(true);
    expect(nearestIcons('ShoppingCart').length).toBeLessThanOrEqual(5);
  });

  it('is silent on a real name, on "", and on a key that holds no icon', () => {
    expect(writeCheck('icon', 'specials', { name: 'StarFill' })).toEqual([]);
    expect(writeCheck('icon', 'specials', { name: '' })).toEqual([]);
    expect(iconNote('heading', 'specials', 'name', 'Nope')).toBeNull();
  });

  it('reaches config-namespace icon keys and nested sb_add specs', () => {
    expect(writeCheck('list-dataset', 'config', { listNavIcon: 'arrow-left' }).map((c) => c.note.code)).toContain('unknown_icon');
    const spec = { type: 'flex-section', children: [{ type: 'icon', specials: { name: 'cart' } }] };
    expect(specCheck(spec as never).map((c) => c.note.code)).toContain('unknown_icon');
  });

  it('suggests by stem: kebab and lower-case inputs still find the name', () => {
    expect(nearestIcons('arrow-right')).toContain('ArrowRightLine');
    expect(nearestIcons('heart')[0]).toMatch(/^Heart/);
  });
});

describe('unknown_icon review finding', () => {
  it('reports a stored bad name, and nothing for a good one', () => {
    const d = PageDoc.from({
      schema_version: 2,
      root_node_id: 'rt',
      nodes: { rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {}, responsive: {} } },
    });
    const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section', children: [{ type: 'icon' }, { type: 'icon' }] });
    d.apply(patches);
    (d.doc.nodes[ids[1]] as unknown as { specials: Record<string, unknown> }).specials.name = 'shopping-bag';
    const found = reviewDesign(d).filter((f) => f.code === 'unknown_icon');
    expect(found).toHaveLength(1);
    expect(found[0].nodeId).toBe(ids[1]);
    expect(found[0].key).toBe('specials.name');
    expect(found[0].problem).toMatch(/ShoppingBag/);
  });
});

describe('icon discovery', () => {
  it('searchIcons caps at 30 and returns only real names', () => {
    const hits = searchIcons('arrow');
    expect(hits.length).toBe(30);
    for (const h of hits) expect(ICON_NAMES.has(h)).toBe(true);
    expect(searchIcons('zzzqqq')).toEqual([]);
  });

  it('sb_traits_for names the icon keys', () => {
    expect(traitsFor('button').icon_keys).toEqual(['specials.icon']);
    expect(traitsFor('heading').icon_keys).toBeUndefined();
  });

  let client: Awaited<ReturnType<typeof connectedClient>>['client'];
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ client, close } = await connectedClient());
  });
  afterAll(async () => close());

  it('sb_catalog_search "icon:<word>" answers icon names', async () => {
    const res = (await client.callTool({ name: 'sb_catalog_search', arguments: { query: 'icon:cart' } })) as {
      content: Array<{ text: string }>;
    };
    const body = JSON.parse(res.content[0].text) as { icons: string[] };
    expect(body.icons.length).toBeGreaterThan(0);
    expect(body.icons.every((n) => /cart/i.test(n))).toBe(true);
  });
});
