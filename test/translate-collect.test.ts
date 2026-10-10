import { describe, it, expect } from 'vitest';
import { collectPageEntries, sourceHash, translationField, rowStatus } from '../src/domains/site/translate.js';

/**
 * PARITY with the editor's `collectPageEntries`
 * (editor/src/features/translations/pageFill.ts): the same rows, the same field
 * grammar, the same skips. A row the editor would not produce is a row its
 * applier cannot address; a row it would produce and this does not is copy
 * that stays in the base language with nothing saying so.
 */
const node = (id: string, type: string, specials: Record<string, unknown> = {}, config: Record<string, unknown> = {}) => ({
  id,
  data: { type, parent: 'ROOT', nodes: [] },
  specials,
  config,
  style: {},
});

const NODES = {
  h1: node('h1', 'heading', { text: 'Hello', textHtml: '<b>Hello</b>', htmlTag: 'h1' }),
  sel: node('sel', 'form-select', { label: 'Size', options: ['S', 'M'], name: 'size' }),
  menu: node('menu', 'menu', {
    menuItems: [
      { id: 'a', label: 'Home', href: '/' },
      { id: 'b', label: 'Shop', items: [{ id: 'b1', label: 'Shirts' }] },
      { id: '', label: 'no id' },
    ],
  }),
  qrText: node('qrText', 'qr-code', { source: 'text', value: 'Scan me', alt: 'QR' }),
  qrUrl: node('qrUrl', 'qr-code', { source: 'url', value: 'https://x.y' }),
  td: node('td', 'text-dataset', {}, { textValue: 'Fallback', moreText: ' ' }),
  icon: node('icon', 'icon', { name: 'star' }),
  blank: node('blank', 'heading', { text: '   ' }),
};

const fields = (opts?: { machine?: boolean }) =>
  collectPageEntries(NODES, opts).map((e) => `${e.entityId}:${e.field}=${e.text}`);

describe('sb_translate collector', () => {
  it('mirrors collectPageEntries row for row', () => {
    expect(fields().sort()).toEqual(
      [
        'h1:text=Hello',
        'h1:textHtml=<b>Hello</b>',
        'sel:label=Size',
        'sel:options.S=S',
        'sel:options.M=M',
        'menu:menuItems.a.label=Home',
        'menu:menuItems.b.label=Shop',
        'menu:menuItems.b1.label=Shirts',
        'qrText:alt=QR',
        'qrText:value=Scan me',
        'td:config.textValue=Fallback',
      ].sort(),
    );
  });

  it('a machine fill drops html fields and nothing else', () => {
    expect(fields({ machine: true })).not.toContain('h1:textHtml=<b>Hello</b>');
    expect(fields({ machine: true })).toHaveLength(fields().length - 1);
  });

  it('hashes with FNV-1a 32-bit, hex, padded to 8', () => {
    expect(sourceHash('')).toBe('811c9dc5');
    expect(sourceHash('a')).toBe('e40c292c');
    expect(sourceHash('Hello')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('resolves a write target to its source text, or says why not', () => {
    expect(translationField(NODES, 'h1', 'text')).toEqual({ text: 'Hello' });
    expect(translationField(NODES, 'menu', 'menuItems.b1.label')).toEqual({ text: 'Shirts' });
    expect(translationField(NODES, 'h1', 'htmlTag')).toMatchObject({ error: expect.stringMatching(/not translatable.*heading/) });
    expect(translationField(NODES, 'icon', 'name')).toMatchObject({ error: expect.stringMatching(/not translatable/) });
    expect(translationField(NODES, 'menu', 'menuItems.zz.label')).toMatchObject({ error: expect.stringMatching(/no item|empty/) });
    expect(translationField(NODES, 'qrUrl', 'value')).toMatchObject({ error: expect.any(String) });
    expect(translationField(NODES, 'nope', 'text')).toMatchObject({ error: expect.stringMatching(/no node/) });
  });

  it('marks rows missing, done, or outdated against the stored hash', () => {
    const rows = collectPageEntries({ h1: NODES.h1, sel: NODES.sel });
    const st = rowStatus(rows, { h1: { text: 'Xin chào', textHtml: 'x' }, sel: { label: 'Cỡ' } }, {
      h1: { text: sourceHash('Hello'), textHtml: 'deadbeef' },
    });
    const by = Object.fromEntries(st.map((r) => [`${r.entityId}:${r.field}`, r.status]));
    expect(by).toEqual({
      'h1:text': 'done',
      'h1:textHtml': 'outdated',
      'sel:label': 'done', // no stored hash is never outdated
      'sel:options.S': 'missing',
      'sel:options.M': 'missing',
    });
  });
});
