import { describe, it, expect } from 'vitest';
import { presentOnlyFrom } from '../scripts/presentonly.js';
import { PRESENT_ONLY_SOURCES } from '../src/catalog/elements.generated.js';

/**
 * PRESENT_ONLY_SOURCES is read off binding.ts AND cross-checked against scope.go
 * (review of v0.100.5): the TS side is a hand-mirror, so a key the two disagree
 * on is a drift that must stop codegen, and a Go-only key (site.money,
 * site.timezone) is present-only all the same.
 */
const TS = `
export function productContext(p) {
  const ctx = { 'product.title': p.title, 'product.price2x': p.price2x };
  if (p.id) ctx['product.id'] = p.id;
  if (p.tags) ctx['product.tags'] = p.tags;
  if (p.summary) ctx['product.summary'] = p.summary;
  ctx['product.ratingCount'] = String(n);
  if (p.x) ctx['product.extra_2'] = p.x;
  return ctx;
}`;
const GO = `
func ProductContext() map[string]string {
	ctx := map[string]string{ "product.title": t, "product.price2x": x }
	if id != "" {
		ctx["product.id"] = id
	}
	return ctx
}
func Tags(ctx map[string]string) { ctx["product.tags"] = t }
func Sum(ctx map[string]string) { ctx["product.summary"] = s }
func Rate(ctx map[string]string) { ctx["product.ratingCount"] = c }
func Site() { if tz != "" { ctx["site.timezone"] = tz } }
`;
const SOURCES = ['product.title', 'product.price2x', 'product.id', 'product.tags', 'product.summary', 'product.ratingCount', 'product.extra_2', 'site.timezone'];

describe('presentOnlyFrom()', () => {
  it('reads keys with digits and underscores, and takes a Go-only statement too', () => {
    const r = presentOnlyFrom(TS, GO, SOURCES);
    expect(r.error).toBeUndefined();
    expect(r.keys).toEqual(['product.extra_2', 'product.id', 'product.ratingCount', 'product.summary', 'product.tags', 'site.timezone']);
  });

  it('refuses a key binding.ts adds as a statement while scope.go builds it always-present', () => {
    const go = GO.replace('"product.price2x": x }', '"product.price2x": x, "product.summary": s }').replace('func Sum(ctx map[string]string) { ctx["product.summary"] = s }', '');
    expect(presentOnlyFrom(TS, go, SOURCES).error).toMatch(/product\.summary/);
  });

  it('refuses the mirror case: a Go statement for a key binding.ts builds in its literal', () => {
    const go = GO.replace('func Site()', 'func More(ctx map[string]string) { if v != "" { ctx["product.price2x"] = v } }\nfunc Site()');
    expect(presentOnlyFrom(TS, go, SOURCES).error).toMatch(/product\.price2x/);
  });

  it('ignores a disagreement on a key outside BINDING_SOURCES', () => {
    const go = GO + '\nfunc Z() { if a { ctx["internal.flag"] = a } }';
    const ts = TS.replace("'product.price2x': p.price2x", "'product.price2x': p.price2x, 'internal.flag': f");
    expect(presentOnlyFrom(ts, go, SOURCES).error).toBeUndefined();
  });

  it('the committed table carries the Go-only present-only keys', () => {
    expect(PRESENT_ONLY_SOURCES).toEqual(expect.arrayContaining(['site.money', 'site.timezone', 'product.tags']));
  });
});
