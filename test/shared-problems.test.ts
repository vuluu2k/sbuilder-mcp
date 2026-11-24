import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';
import { shareProblems } from '../src/domains/site/findings.js';

/** Three empty containers: one sentence, three ids — over the real transport. */
function page() {
  const kids = ['b1', 'b2', 'b3'];
  return {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: {
      ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: ['sec'] }, specials: {}, style: {}, config: {} },
      sec: { id: 'sec', data: { type: 'flex-section', parent: 'ROOT', nodes: kids }, specials: {}, style: {}, config: {} },
      ...Object.fromEntries(kids.map((k) => [k, { id: k, data: { type: 'flex-block', parent: 'sec', nodes: [] }, specials: {}, style: {}, config: {} }])),
    },
  };
}

describe('a problem every finding of its code repeats is said once', () => {
  it('sb_review: empty_container ids each, its sentence once under problems', async () => {
    const p = fakePlatform();
    p.pages.set('pg', { document: page(), rev: 1 });
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg' });
    const r = (await call('sb_review', {})).json as {
      findings: Array<{ code: string; nodeId: string; problem?: string }>;
      problems?: Record<string, string>;
    };
    const empties = r.findings.filter((f) => f.code === 'empty_container');
    // Liveness: the fixture really produces the repeated finding.
    expect(empties.map((f) => f.nodeId).sort(), 'fixture yields three empty containers').toEqual(['b1', 'b2', 'b3']);
    expect(r.problems?.empty_container, 'shared sentence missing').toMatch(/holds nothing/);
    expect(empties.filter((f) => 'problem' in f), 'sentence repeated per finding').toHaveLength(0);
    await close();
  });

  it('a sentence that differs from its code\'s first one stays on its finding', () => {
    const { findings, problems } = shareProblems([
      { code: 'm', problem: '4 buttons' },
      { code: 'm', problem: '4 buttons' },
      { code: 'm', problem: '5 buttons' },
      { code: 'solo', problem: 'once' },
    ]);
    expect(problems).toEqual({ m: '4 buttons' });
    expect(findings).toEqual([{ code: 'm' }, { code: 'm' }, { code: 'm', problem: '5 buttons' }, { code: 'solo', problem: 'once' }]);
  });
});
