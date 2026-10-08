import { describe, it, expect } from 'vitest';
import { STORE_PAGE_SEEDS, PAGE_LAYOUT_SEEDS } from '../src/catalog/storepages.generated.js';
import { OVERLAY_SEEDS, CART_SEEDS } from '../src/catalog/overlays.generated.js';
import { CHECKOUT_FORM_DOCUMENT, CHECKOUT_PAGE_DOCUMENT, FORM_TEMPLATES } from '../src/catalog/checkout.generated.js';
import { APP_SCAFFOLDS } from '../src/catalog/appscaffolds.generated.js';
import { LAYOUT_PATTERNS, THEME_TOKENS } from '../src/domains/site/patterns.js';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign } from '../src/domains/site/review.js';
import { writeCheck } from '../src/domains/site/writecheck.js';

/**
 * THE PLATFORM'S OWN SEEDS ARE THE CONTROL. Every document below is one the
 * platform itself hands a merchant (or this server hands an agent, captured
 * from the platform at codegen) — so a finding or a write warning on one of
 * them is a false positive by definition, and a check that cries wolf on the
 * platform's own pop-up is a check callers learn to skip.
 */
type Doc = { root_node_id: string; nodes: Record<string, unknown> };

function seeds(): Array<[string, Doc]> {
  const out: Array<[string, Doc]> = [];
  for (const [k, d] of Object.entries(STORE_PAGE_SEEDS)) out.push([`store:${k}`, d]);
  for (const [k, d] of Object.entries(PAGE_LAYOUT_SEEDS)) out.push([`layout:${k}`, d]);
  for (const [k, d] of Object.entries(OVERLAY_SEEDS)) out.push([`overlay:${k}`, d as Doc]);
  for (const [k, d] of Object.entries(CART_SEEDS)) out.push([`cart:${k}`, d as Doc]);
  out.push(['checkout:form', CHECKOUT_FORM_DOCUMENT as unknown as Doc]);
  out.push(['checkout:page', CHECKOUT_PAGE_DOCUMENT as unknown as Doc]);
  for (const [k, t] of Object.entries(FORM_TEMPLATES)) out.push([`form:${k}`, (t as { document: Doc }).document]);
  for (const [k, list] of Object.entries(APP_SCAFFOLDS)) list.forEach((p, i) => out.push([`app:${k}:${i}`, p.document]));
  for (const p of LAYOUT_PATTERNS) {
    const spec = p.build(THEME_TOKENS);
    if (!spec) continue;
    const doc = PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {} } },
    });
    doc.apply(addSubtree(doc, 'ROOT', spec).patches);
    out.push([`pattern:${p.id}`, doc.doc as unknown as Doc]);
  }
  return out;
}

const FALSE_POSITIVES = new Set(['invalid_action', 'action_missing_target', 'no_data_context', 'unread_value']);

describe('the platform seeds review clean', () => {
  it('no seed raises invalid_action / action_missing_target / no_data_context / unread_value', () => {
    const hits: string[] = [];
    for (const [name, raw] of seeds()) {
      const doc = PageDoc.from(JSON.parse(JSON.stringify(raw)));
      const pageType = name.startsWith('store:') ? name.slice(6) : undefined;
      for (const f of reviewDesign(doc, { pageType })) {
        if (FALSE_POSITIVES.has(f.code)) hits.push(`${name} ${f.nodeId} ${f.type} ${f.code}: ${f.problem.slice(0, 120)}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('no node of any seed raises unknown_key', () => {
    const hits = new Set<string>();
    for (const [name, raw] of seeds()) {
      for (const n of Object.values(raw.nodes) as Array<{
        data: { type: string };
        config?: Record<string, unknown>;
        specials?: Record<string, unknown>;
        responsive?: Record<string, { config?: Record<string, unknown>; specials?: Record<string, unknown> }>;
      }>) {
        const layers: Array<['config' | 'specials', Record<string, unknown> | undefined]> = [
          ['config', n.config],
          ['specials', n.specials],
          ...Object.values(n.responsive ?? {}).flatMap(
            (r) => [['config', r?.config], ['specials', r?.specials]] as Array<['config' | 'specials', Record<string, unknown> | undefined]>,
          ),
        ];
        for (const [ns, keys] of layers) {
          for (const c of writeCheck(n.data.type, ns, keys ?? {}, { specials: n.specials })) {
            if (c.note.code === 'unknown_key') hits.add(`${n.data.type} ${c.note.key} (${name.split(':')[0]})`);
          }
        }
      }
    }
    expect([...hits].sort()).toEqual([]);
  });
});

describe('sb_event agrees with review on the pop-up close', () => {
  it('close_popup is accepted on a button inside a pop-up and refused outside one', async () => {
    const { setEvent } = await import('../src/tools/live.js');
    const doc = PageDoc.from(JSON.parse(JSON.stringify(OVERLAY_SEEDS.popup)));
    const btn = Object.values(doc.doc.nodes).find((n) => n.data.type === 'button')!;
    expect(setEvent(doc, btn.id, 'click', 'close_popup', {}).length).toBeGreaterThan(0);
    const page = PageDoc.from({
      schema_version: 2,
      root_node_id: 'ROOT',
      nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {} } },
    });
    const { patches, ids } = addSubtree(page, 'ROOT', { type: 'flex-section', children: [{ type: 'button' }] });
    page.apply(patches);
    const outside = ids.find((i) => page.doc.nodes[i].data.type === 'button')!;
    expect(() => setEvent(page, outside, 'click', 'close_popup', {})).toThrow(/not an action a button offers/);
  });
});
