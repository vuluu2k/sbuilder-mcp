/**
 * The binding sources a context holds ONLY WHEN THE ENTITY HAS ONE.
 *
 * `ApplyBindings` (render/scope/scope.go) skips a binding whose source the
 * context lacks, so on one field the LAST source THE CONTEXT RESOLVES renders —
 * and an earlier binding under a later present-only source (`product.tags`,
 * `product.summary`, the rating keys) is a FALLBACK, not dead weight. Both sides
 * mark them the same way: the always-present keys are an object/map LITERAL and
 * the present-only ones are STATEMENTS — `ctx['k'] = …` behind a guard, or
 * `put('k', v)` that drops an empty value. `record.*` is dynamic and omitted
 * when empty too (scope/record.go), so `sb_review` treats that namespace whole.
 *
 * `binding.ts` is a HAND-mirror of `scope.go`, so each is read and checked
 * against the other (review of v0.100.5): a key one side adds as a statement
 * while the other names it outside one is drift, and only a key `sb_bind` can
 * write (BINDING_SOURCES) is worth stopping codegen over. A key only one side
 * mentions is that side's answer — `site.money` / `site.timezone` are Go-only,
 * and the product extras `pagerender.go` stamps are TS-only here (that file also
 * RE-stamps always-present keys like `product.price`, so it is not read).
 */
const KEY = String.raw`([a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*)`;
const STATEMENT = new RegExp(String.raw`\bctx\[\s*['"]${KEY}['"]\s*\]\s*=(?!=)`, 'g');
const PUT = new RegExp(String.raw`\bput\(\s*['"]${KEY}['"]`, 'g');

function statements(src: string): Set<string> {
  const found = new Set<string>();
  for (const m of src.matchAll(STATEMENT)) found.add(m[1]);
  for (const m of src.matchAll(PUT)) found.add(m[1]);
  return found;
}

const mentions = (src: string, k: string) => src.includes(`'${k}'`) || src.includes(`"${k}"`);
const uncomment = (src: string) => src.replace(/^\s*\/\/[^\n]*$/gm, '');

export function presentOnlyFrom(
  bindingTs: string,
  scopeGo: string,
  bindingSources: readonly string[],
): { keys: string[]; error?: string } {
  const ts = uncomment(bindingTs);
  const go = uncomment(scopeGo);
  const t = statements(ts);
  const g = statements(go);
  const disagree = [
    ...[...t].filter((k) => !g.has(k) && mentions(go, k)).map((k) => `${k} (statement in binding.ts, not in scope.go)`),
    ...[...g].filter((k) => !t.has(k) && mentions(ts, k)).map((k) => `${k} (statement in scope.go, not in binding.ts)`),
  ].filter((s) => bindingSources.includes(s.split(' ')[0]));
  const keys = [...new Set([...t, ...g])].sort();
  if (disagree.length) {
    return { keys, error: `present-only sources: binding.ts and scope.go disagree on ${disagree.join(', ')}` };
  }
  return { keys };
}
