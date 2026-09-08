import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';
import type { ToolContext } from '../src/tools/context.js';

/**
 * The server, end to end, over an in-memory transport.
 *
 * What a client sees — tools/list, instructions, a tool result's bytes — is
 * measured HERE rather than inferred from the registration code, because the
 * SDK is the thing that decides what crosses the wire.
 */
export async function connectedClient(over: Partial<ToolContext> = {}) {
  const f = (async () =>
    new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const session = new Session('http://x', f);
  const ctx: ToolContext = { base: 'http://x', session, fetchImpl: f, notices: new Notices(), undo: new UndoLog(), ...over };
  const server = createServer(ctx);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(b);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}
