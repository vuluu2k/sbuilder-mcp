import { Session } from '../../src/transport/auth.js';
import { connectedClient } from '../harness.js';

/**
 * A SMALL STATEFUL PLATFORM: page sources that a PUT really changes, so a
 * fixture can add, save, re-open and review through the public tools. Every
 * other path answers `{}` — the harness default — unless `extra` claims it.
 */
export function fakePlatform(extra: (method: string, path: string, body: unknown) => unknown | undefined = () => undefined) {
  const pages = new Map<string, { document: unknown; rev: number }>();
  /** Form FIELD documents: GET answers `{ document }` (null when never saved), PUT `{ schema }`. */
  const forms = new Map<string, unknown>();
  const FORM_DOC = /^\/api\/sites\/[^/]+\/forms\/([^/]+)\/document$/;
  const writes: Array<{ method: string; path: string }> = [];
  const SOURCE = /^\/api\/sites\/([^/]+)\/pages\/([^/]+)\/source$/;
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (method !== 'GET') writes.push({ method, path: url.pathname });
    const own = extra(method, url.pathname, body);
    if (own !== undefined) return json(own);
    const f = FORM_DOC.exec(url.pathname);
    if (f) {
      if (method === 'PUT') {
        forms.set(f[1], body.document);
        return json({ schema: {} });
      }
      return json({ document: forms.get(f[1]) ?? null });
    }
    const m = SOURCE.exec(url.pathname);
    if (m) {
      const key = m[2];
      if (method === 'PUT') {
        const prev = pages.get(key);
        pages.set(key, { document: body.document, rev: (prev?.rev ?? 0) + 1 });
      }
      const p = pages.get(key) ?? { document: blank(), rev: 1 };
      if (!pages.has(key)) pages.set(key, p);
      return json({ source: { pageId: key, siteId: m[1], document: p.document, schemaVersion: 2, updatedAt: 'now', rev: p.rev } });
    }
    return json({});
  }) as unknown as typeof fetch;

  return {
    pages,
    forms,
    writes,
    async connect() {
      const session = new Session('http://x', fetchImpl);
      (session as unknown as { access: string }).access = 'jwt';
      const { client, close } = await connectedClient({ fetchImpl, session });
      const call = async (name: string, args: Record<string, unknown>) => {
        const res = (await client.callTool({ name, arguments: args })) as {
          isError?: boolean;
          content: Array<{ type: string; text?: string }>;
        };
        const text = res.content.map((c) => c.text ?? '').join('');
        let parsed: unknown = text;
        try {
          parsed = JSON.parse(text);
        } catch {
          /* a plain-text refusal stays text */
        }
        return { isError: !!res.isError, text, json: parsed as Record<string, unknown> };
      };
      return { call, close };
    },
  };
}

export function blank() {
  return {
    schema_version: 2,
    root_node_id: 'ROOT',
    nodes: { ROOT: { id: 'ROOT', data: { type: 'root', parent: null, nodes: [] }, specials: {}, style: {}, config: {} } },
  };
}
