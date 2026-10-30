import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CODE_EXT, CODE_DEFAULT_PLACEMENT } from '../src/tools/code.js';

/** One `export const NAME … = { key: 'value', … }` literal, read as text — the shape paths.ts promises to keep. */
function literal(src: string, name: string): Record<string, string> {
  const body = new RegExp(`export const ${name}\\b[^=]*=\\s*\\{([^}]*)\\}`).exec(src)?.[1];
  if (!body) throw new Error(`${name} is no longer one object literal in paths.ts`);
  return Object.fromEntries([...body.matchAll(/(\w+):\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
}

// sb_code mirrors the Code Dock's two tables; this keeps the mirror honest when a checkout is at hand.
describe.runIf(process.env.WB_REPO)('sb_code tables match the editor\'s Code Dock', () => {
  const src = () => readFileSync(join(process.env.WB_REPO!, 'editor/src/features/codedock/paths.ts'), 'utf8');
  it('EXT', () => expect(CODE_EXT).toEqual(literal(src(), 'EXT')));
  it('DEFAULT_PLACEMENT', () => expect(CODE_DEFAULT_PLACEMENT).toEqual(literal(src(), 'DEFAULT_PLACEMENT')));
});
