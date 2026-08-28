import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setAgentClient, agentIdentity, identityHeaders } from '../src/transport/identity.js';
import { request } from '../src/transport/http.js';

/**
 * The MCP saying where it runs.
 *
 * Everything downstream of this — the connections table, the screen that lists
 * machines — is worthless if the headers do not actually leave. And they leave
 * from ONE place, so a test that only checks the header builder would pass
 * forever while `request()` quietly dropped them.
 */

function jsonOk() {
  return vi.fn(
    async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

function headersOf(f: typeof fetch): Record<string, string> {
  const calls = (f as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return (calls[0][1] as RequestInit).headers as Record<string, string>;
}

beforeEach(() => setAgentClient(undefined, ''));

describe('agent identity', () => {
  it('takes the client name from the MCP handshake', () => {
    setAgentClient({ name: 'cursor', version: '0.42.0' }, '0.1.2');
    const id = agentIdentity();
    expect(id.client).toBe('cursor');
    expect(id.clientVersion).toBe('0.42.0');
    expect(id.server).toBe('sbuilder-mcp/0.1.2');
    // The machine has to name itself, or "which laptop" stays unanswerable.
    expect(id.host.length).toBeGreaterThan(0);
  });

  it('invents nothing when the client sends no clientInfo', () => {
    setAgentClient(undefined, '0.1.2');
    expect(agentIdentity().client).toBe('');
    // A made-up name would be worse than none: it looks like a machine somebody
    // could go and check.
    expect(identityHeaders()['X-Agent-Client']).toBeUndefined();
  });

  it('OMITS an empty field rather than sending it blank', () => {
    const h = identityHeaders({ client: 'cursor', clientVersion: '', host: 'mac', server: '' });
    expect(h['X-Agent-Client']).toBe('cursor');
    expect(h['X-Agent-Host']).toBe('mac');
    expect('X-Agent-Client-Version' in h).toBe(false);
    expect('X-Agent-Server' in h).toBe(false);
  });

  it('actually reaches the wire — the half a header builder cannot prove', async () => {
    setAgentClient({ name: 'claude-code', version: '2.0' }, '0.1.2');
    const f = jsonOk();
    await request({ base: 'http://x', method: 'GET', path: '/api/sites/s1/products', fetchImpl: f });

    const h = headersOf(f);
    expect(h['X-Agent-Client']).toBe('claude-code');
    expect(h['X-Agent-Client-Version']).toBe('2.0');
    expect(h['X-Agent-Server']).toBe('sbuilder-mcp/0.1.2');
    expect(h['X-Agent-Host']).toBeTruthy();
  });

  it('does not disturb the headers the request already depended on', async () => {
    setAgentClient({ name: 'cursor' }, '0.1.2');
    const f = jsonOk();
    await request({
      base: 'http://x',
      method: 'POST',
      path: '/api/sites/s1/pages',
      token: 'wbk_k',
      body: { title: 'x' },
      fetchImpl: f,
    });

    const h = headersOf(f);
    expect(h.Authorization).toBe('Bearer wbk_k');
    expect(h['Content-Type']).toBe('application/json');
    expect(h.Accept).toBe('application/json');
  });
});
