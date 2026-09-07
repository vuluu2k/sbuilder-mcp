import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The MCP Registry's own limits, checked here rather than by a 422 at the end
 * of a release.
 *
 * A registry publish is the LAST step of the release workflow, after npm has
 * the package and the GitHub Release exists — so a manifest the registry
 * refuses fails a release that has already half happened, and the only way to
 * retry is another release. registry.modelcontextprotocol.io answered
 * `expected length <= 100` for `body.description` on 0.1.4.
 */
const manifest = JSON.parse(readFileSync(new URL('../server.json', import.meta.url), 'utf8')) as {
  name: string;
  description: string;
  version: string;
  packages?: Array<{ identifier: string; version: string }>;
};
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string;
  version: string;
  mcpName?: string;
};

describe('server.json', () => {
  it('keeps the description within the registry\'s 100-character limit', () => {
    expect(manifest.description.length).toBeLessThanOrEqual(100);
    expect(manifest.description.length).toBeGreaterThan(20);
  });

  it('carries the same version as package.json, and so does its package entry', () => {
    // The release workflow syncs these before it commits; at rest they agree,
    // and a hand-bump that forgets one would point the registry at a version
    // npm does not have, which 404s for whoever trusts it.
    expect(manifest.version).toBe(pkg.version);
    for (const p of manifest.packages ?? []) expect(p.version).toBe(pkg.version);
  });

  it('names the package npm actually publishes', () => {
    expect(manifest.name).toBe(pkg.mcpName);
    for (const p of manifest.packages ?? []) expect(p.identifier).toBe(pkg.name);
  });
});
