import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys, setMany, removeNode, moveNode, duplicateNode } from '../src/domains/site/builder.js';
import { bindNode, setEvent } from '../src/tools/live.js';
import { SPEC_APP_BLOCK_ID } from '../src/core/tree.js';
import { FORCE_HINT, type GuardOpts } from '../src/domains/site/guard.js';

// `inner` is used both as a target ("set", "remove", "duplicate", "bind", "move
// out") and as the destination of a nested "add under inner" — so it has to be
// a CONTAINER, unlike the brief's `heading`, which trips the hard, force-blind
// `requireContainer` guard before force ever gets a say. `evtNode` carries the
// "event" case instead, since no element type in this catalog is both a
// container and a declared click-action host.
function withAppBlock() {
  const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
  const first = addSubtree(d, 'ROOT', {
    type: 'flex-section',
    children: [{ type: 'flex-block', children: [{ type: 'flex-block' }, { type: 'button' }] }],
  });
  d.apply(first.patches);
  d.apply([{ op: 'set', path: ['nodes', first.ids[1], 'specials', SPEC_APP_BLOCK_ID], value: 'inst_1/hero' }]);
  d.apply(addSubtree(d, 'ROOT', { type: 'flex-section' }).patches);
  const [section, block, inner, evtNode] = first.ids;
  return { d, section, block, inner, evtNode };
}

const forced = (): GuardOpts => ({ force: true, forced: [] });

describe('soft guards under force', () => {
  it('app-block interior: every write goes through and is reported', () => {
    const { d, inner, block, evtNode } = withAppBlock();
    const other = d.outline()[1].id;
    const cases: Array<[string, (g: GuardOpts) => unknown]> = [
      ['set', (g) => setKeys(d, inner, { text: 'x' }, { namespace: 'specials', base: true, ...g })],
      ['add under root', (g) => addSubtree(d, block, { type: 'heading' }, undefined, g)],
      ['add under inner', (g) => addSubtree(d, inner, { type: 'heading' }, undefined, g)],
      ['remove', (g) => removeNode(d, inner, g)],
      ['duplicate', (g) => duplicateNode(d, inner, g)],
      ['bind', (g) => bindNode(d, inner, 'product.title', 'specials.text', undefined, g)],
      ['event', (g) => setEvent(d, evtNode, 'click', 'open_cart', undefined, g)],
      ['move into', (g) => moveNode(d, other, block, 0, g)],
      ['move out', (g) => moveNode(d, inner, other, 0, g)],
    ];
    for (const [name, run] of cases) {
      expect(() => run({ force: false }), name).toThrow(FORCE_HINT);
      const g = forced();
      expect(() => run(g), name).not.toThrow();
      expect(g.forced.join(' '), name).toMatch(/app block/i);
    }
  });

  it('childAllows and root-only: forced through, unknown type still refused', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-block' }] });
    d.apply(sec.patches);
    const block = sec.ids[1];
    // flex-section is root-only; under a flex-block it is refused, softly.
    expect(() => addSubtree(d, block, { type: 'flex-section' }, undefined, {})).toThrow(/root-only.*force:true/s);
    const g = forced();
    expect(() => addSubtree(d, block, { type: 'flex-section' }, undefined, g)).not.toThrow();
    expect(g.forced[0]).toMatch(/root-only/);
    // Unknown type is hard: force changes nothing.
    expect(() => addSubtree(d, block, { type: 'no-such-element' }, undefined, forced())).toThrow(/unknown element/);
  });

  it('second template under list-dataset: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', {
      type: 'flex-section',
      children: [{ type: 'list-dataset', children: [{ type: 'dataset-block' }] }],
    });
    d.apply(sec.patches);
    const list = sec.ids[1];
    expect(() => addSubtree(d, list, { type: 'dataset-block' }, undefined, {})).toThrow(/FIRST child.*force:true/s);
    const g = forced();
    expect(() => addSubtree(d, list, { type: 'dataset-block' }, undefined, g)).not.toThrow();
    expect(g.forced[0]).toMatch(/FIRST child/);
  });

  it('stuck-after on a node that cannot pin: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] });
    d.apply(sec.patches);
    const h = sec.ids[1];
    expect(() => setKeys(d, h, { stuckAfter: 40 }, { namespace: 'config', force: false })).toThrow(/cannot pin.*force:true/s);
    const g = forced();
    expect(() => setKeys(d, h, { stuckAfter: 40 }, { namespace: 'config', ...g })).not.toThrow();
    expect(g.forced[0]).toMatch(/cannot pin/);
  });

  it('stuck state with no host, and stuck config beyond hidden: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'heading' }] });
    d.apply(sec.patches);
    const h = sec.ids[1];
    expect(() => setKeys(d, h, { color: 'red' }, { namespace: 'style', state: 'stuck', force: false })).toThrow(FORCE_HINT);
    const g = forced();
    expect(() => setKeys(d, h, { color: 'red' }, { namespace: 'style', state: 'stuck', ...g })).not.toThrow();
    expect(g.forced.length).toBeGreaterThan(0);
    const g2 = forced();
    expect(() => setKeys(d, h, { foo: 1 }, { namespace: 'config', state: 'stuck', ...g2 })).not.toThrow();
    expect(g2.forced.join(' ')).toMatch(/hidden/);
  });

  it('hover config beyond hidden, and reveal with no host: forced through', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-block', children: [{ type: 'text' }] }] });
    d.apply(sec.patches);
    const section = sec.ids[0];
    const t = sec.ids[2];
    expect(() => setKeys(d, t, { foo: 1 }, { namespace: 'config', state: 'hover', force: false })).toThrow(FORCE_HINT);
    const g = forced();
    expect(() => setKeys(d, t, { foo: 1 }, { namespace: 'config', state: 'hover', ...g })).not.toThrow();
    expect(g.forced.join(' ')).toMatch(/hidden/);
    // A direct child of ROOT has no box around it to hover.
    expect(() => setKeys(d, section, { revealOnHover: true }, { namespace: 'config', force: false })).toThrow(FORCE_HINT);
    const g2 = forced();
    expect(() => setKeys(d, section, { revealOnHover: true }, { namespace: 'config', ...g2 })).not.toThrow();
    expect(g2.forced.join(' ')).toMatch(/hover/i);
  });

  // ELEVEN CALL SITES REACH THESE BUILDERS WITH NO GUARD — `sb_import`,
  // `sb_import_site`, `sb_template_use`, `sb_store` — and none of those tools
  // has a `force` argument. Telling their caller to pass one names an argument
  // that is refused.
  it('a call with no guard carries no hint', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-block' }] });
    d.apply(sec.patches);
    const block = sec.ids[1];
    const add = (() => { try { addSubtree(d, block, { type: 'flex-section' }); } catch (e) { return (e as Error).message; } })();
    expect(add).toMatch(/root-only/);
    expect(add).not.toContain(FORCE_HINT);

    const { d: ad, inner } = withAppBlock();
    const set = (() => { try { setKeys(ad, inner, { text: 'x' }, { namespace: 'specials', base: true }); } catch (e) { return (e as Error).message; } })();
    expect(set).toMatch(/app block/i);
    expect(set).not.toContain(FORCE_HINT);
  });

  it('setMany carries force to every edit', () => {
    const { d, inner } = withAppBlock();
    const g = forced();
    const out = setMany(d, [{ id: inner, namespace: 'specials', keys: { text: 'a' } }, { id: inner, namespace: 'specials', keys: { text: 'b' } }], g);
    expect(out.patches.length).toBeGreaterThan(0);
    expect(g.forced).toHaveLength(2);
  });
});

describe('hard guards ignore force', () => {
  it('ROOT cannot be removed or duplicated', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    expect(() => removeNode(d, 'ROOT', forced())).toThrow(/cannot remove ROOT/);
    expect(() => duplicateNode(d, 'ROOT', forced())).toThrow(/cannot duplicate ROOT/);
  });

  it('a composed stamp is refused even under force, and carries no hint', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section' });
    d.apply(sec.patches);
    const err = (() => { try { setKeys(d, sec.ids[0], { globalId: 'g1' }, { namespace: 'specials', ...forced() }); } catch (e) { return (e as Error).message; } })();
    expect(err).toMatch(/stamp the SERVER writes/);
    expect(err).not.toContain(FORCE_HINT);
    expect(() => addSubtree(d, 'ROOT', { type: 'flex-section', specials: { appBlockId: 'x' } }, undefined, forced())).toThrow(/stamp the SERVER writes/);
  });

  it('a node moved into its own subtree is refused even under force', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section', children: [{ type: 'flex-block' }] });
    d.apply(sec.patches);
    expect(() => moveNode(d, sec.ids[0], sec.ids[1], 0, forced())).toThrow();
  });

  it('specials with a state is refused even under force', () => {
    const d = PageDoc.from({ schema_version: 2, root_node_id: '', nodes: {} });
    const sec = addSubtree(d, 'ROOT', { type: 'flex-section' });
    d.apply(sec.patches);
    expect(() => setKeys(d, sec.ids[0], { text: 'x' }, { namespace: 'specials', state: 'hover', ...forced() })).toThrow(/takes no interaction state/);
  });
});
