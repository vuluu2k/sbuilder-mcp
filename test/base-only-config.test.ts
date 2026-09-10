import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree, setKeys } from '../src/domains/site/builder.js';
import {
  isBaseOnlyConfig,
  splitBaseOnly,
  splitBaseOnlyKeys,
} from '../src/domains/site/baseonly.js';
import { BASE_ONLY_CONFIG, BASE_ONLY_EXCEPTIONS } from '../src/catalog/elements.generated.js';

/**
 * `html.go` indexes node.Config[key] with no responsive merge, and ONE html
 * document serves all three widths — so a key an html.go decides can only come
 * from base. `setKeys` writes config per breakpoint by default, which for those
 * keys means the value shows on the editor canvas and vanishes on publish, with
 * no error at any step.
 */
function page() {
  const d = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {}, responsive: {} },
    },
  });
  const { patches, ids } = addSubtree(d, 'rt', {
    type: 'flex-section',
    children: [{ type: 'list-dataset' }, { type: 'icon' }],
  });
  d.apply(patches);
  const [section, list, icon] = ids;
  return { d, section, list, icon };
}

const at = (patches: ReturnType<typeof setKeys>, path: string) =>
  patches.find((p) => p.path.join('.') === path);

describe('config keys the publish path reads from base only', () => {
  it('reads the platform ledger rather than a hand-kept copy', () => {
    // The platform maintains this as a MIGRATION ledger — its own comment says
    // the list may SHRINK as each key moves to a per-breakpoint CSS var. A copy
    // here would keep forcing a fixed key to base long after it was fixed.
    expect(BASE_ONLY_CONFIG).toContain('datasetSource');
    expect(BASE_ONLY_CONFIG).toContain('iconSize');
    expect(BASE_ONLY_CONFIG).toContain('collectionType');
    // Parsed keys, not the ledger's dense per-key prose. An earlier version of
    // the regex paired apostrophes across the comments and emitted whole
    // English sentences as keys.
    for (const k of BASE_ONLY_CONFIG) expect(k).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    expect(BASE_ONLY_EXCEPTIONS).toContain('quantity-button:iconSize');
  });

  it('exempts a type:key the platform compiles per breakpoint after all', () => {
    // quantity-button's iconSize becomes the --icon-size var through the
    // satellite CSS compiler, so forcing it to base would take a working
    // per-breakpoint control away.
    expect(isBaseOnlyConfig('icon', 'iconSize')).toBe(true);
    expect(isBaseOnlyConfig('quantity-button', 'iconSize')).toBe(false);
  });

  it('leaves every other config key on the breakpoint', () => {
    const { base, responsive } = splitBaseOnly('icon', { iconSize: 32, gap: '8px' });
    expect(base).toEqual({ iconSize: 32 });
    expect(responsive).toEqual({ gap: '8px' });
  });

  it('splits an unset the same way, so a removal lands where the write did', () => {
    const { base, responsive } = splitBaseOnlyKeys('icon', ['iconSize', 'gap']);
    expect(base).toEqual(['iconSize']);
    expect(responsive).toEqual(['gap']);
  });

  // THE DEFECT THIS EXISTS FOR. dataset-block/html.go reads base, so the config
  // half of a data-axis move landed where publish never looks while rebindPatch
  // wrote the bindings at NODE level: bindings said category, renderer said
  // product, and both halves reported success.
  it('keeps the data axis and its bindings in the same document layer', () => {
    const { d, list } = page();
    const patches = setKeys(d, list, { datasetSource: 'category' }, { namespace: 'config' });

    expect(at(patches, `nodes.${list}.config.datasetSource`)?.value).toBe('category');
    expect(at(patches, `nodes.${list}.responsive.desktop.config.datasetSource`)).toBeUndefined();
    // And the bindings the move derives are still written, at node level, which
    // is now the SAME layer the config went to.
    expect(at(patches, `nodes.${list}.bindings`)).toBeDefined();
  });

  it('still writes an ordinary config key per breakpoint', () => {
    const { d, list } = page();
    const patches = setKeys(d, list, { gap: '4px' }, { namespace: 'config', breakpoint: 'mobile' });
    expect(at(patches, `nodes.${list}.responsive.mobile.config.gap`)?.value).toBe('4px');
    expect(at(patches, `nodes.${list}.config.gap`)).toBeUndefined();
  });

  it('splits a mixed write across both layers in one call', () => {
    const { d, icon } = page();
    const patches = setKeys(
      d,
      icon,
      { iconSize: 24, opacity: '0.5' },
      { namespace: 'config', breakpoint: 'mobile' },
    );
    expect(at(patches, `nodes.${icon}.config.iconSize`)?.value).toBe(24);
    expect(at(patches, `nodes.${icon}.responsive.mobile.config.opacity`)?.value).toBe('0.5');
  });

  it('does not touch style, which the cascade resolves per breakpoint on both sides', () => {
    const { d, icon } = page();
    // `layout` is a base-only CONFIG key; as a style key it is nothing special,
    // and the rule must not follow the name across namespaces.
    const patches = setKeys(d, icon, { layout: 'grid' }, { namespace: 'style' });
    expect(at(patches, `nodes.${icon}.responsive.desktop.style.layout`)?.value).toBe('grid');
    expect(at(patches, `nodes.${icon}.style.layout`)).toBeUndefined();
  });

  it('leaves an explicit base write exactly where the caller asked', () => {
    const { d, icon } = page();
    const patches = setKeys(d, icon, { iconSize: 24 }, { namespace: 'config', base: true });
    expect(at(patches, `nodes.${icon}.config.iconSize`)?.value).toBe(24);
    expect(patches.filter((p) => p.path.includes('responsive'))).toEqual([]);
  });
});
