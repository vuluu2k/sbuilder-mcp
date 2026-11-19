import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { text } from '../mcp/response.js';
import { ApiError, request } from '../transport/http.js';
import { siteToken } from './credentialpick.js';
import { siteFor, type ToolContext } from './context.js';

/**
 * A site's CODE COMPONENTS — its own React components (`components/<Name>.tsx`
 * in the site repo, uploaded by `sb site push`), stored as immutable numbered
 * versions (`server/internal/codecomponents`). The MCP never writes one: it
 * lists them, and places and configures the `code-component` element that pins
 * one (`specials: { component, version, props }`).
 *
 * The SITE route, not `/api/v1/code-components`: the same rows, but it takes
 * either credential (the v1 one refuses a session), and it is the surface the
 * page save that renders the node is made on.
 */
export const CODE_COMPONENT = 'code-component';
/** Server-owned on every save (internal/page/codecomponents.go): a sent value is discarded. */
export const DERIVED_KEYS = ['html', 'clientUrl'] as const;
const CONTENT_KEYS = ['component', 'version', 'props'];

export type PropSpec = { kind?: string; default?: unknown; options?: unknown[] };
type Version = { name: string; version: number; propsSchema?: Record<string, PropSpec> };

const base = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/code-components`;

const get = (ctx: ToolContext, path: string, query?: Record<string, number>) =>
  request({ base: ctx.base, method: 'GET', path, token: siteToken(ctx), query, fetchImpl: ctx.fetchImpl });

/** Each component's LATEST version. */
async function latest(ctx: ToolContext, siteId: string): Promise<Version[]> {
  const out = (await get(ctx, base(siteId))) as { codeComponents?: Version[] };
  return out.codeComponents ?? [];
}

/** Every version of one component, newest first; null when the site has no such component. */
async function versionsOf(ctx: ToolContext, siteId: string, name: string): Promise<Version[] | null> {
  try {
    // ponytail: one page of 200, the platform's per-component version cap.
    const out = (await get(ctx, `${base(siteId)}/${encodeURIComponent(name)}/versions`, { limit: 200 })) as { versions?: Version[] };
    return out.versions ?? [];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

const PLACE_NOTICE =
  'Place one with sb_add {type:"code-component", specials:{component, version, props}}. props are the ' +
  'content props; a kind:"css" prop is a style key "--<name>" (per breakpoint), never a prop. html and ' +
  'clientUrl are rendered by the platform on save — never send them. A component is written in the site ' +
  'repo (components/<Name>.tsx) and uploaded with `sb site push`; this server only places it.';

const KIND_OK: Record<string, (v: unknown, p: PropSpec) => boolean> = {
  text: (v) => typeof v === 'string',
  richtext: (v) => typeof v === 'string',
  link: (v) => typeof v === 'string',
  image: (v) => typeof v === 'string',
  enum: (v, p) => typeof v === 'string' && (!Array.isArray(p.options) || p.options.includes(v)),
  boolean: (v) => typeof v === 'boolean',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
};

/**
 * Refuse a code-component pin the platform would store as a blank box: an
 * unknown component or version, or props its version's `propsSchema` does not
 * declare (or declares with another kind). `specials` is the node's specials
 * AS THEY WILL BE. Throws; returns nothing when the pin is good.
 */
export async function checkPin(ctx: ToolContext, siteId: string, specials: Record<string, unknown>, at: string): Promise<void> {
  const { component, version, props = {} } = specials;
  const fail = (msg: string): never => {
    throw new Error(`sbuilder: ${at}: ${msg}`);
  };
  if (typeof component !== 'string' || !component) {
    fail('a code-component needs specials.component — sb_components lists this site\'s components');
  }
  const name = component as string;
  const vs = await versionsOf(ctx, siteId, name);
  if (!vs) {
    const names = (await latest(ctx, siteId)).map((v) => v.name);
    fail(
      `this site has no code component "${name}" (it has: ${names.join(', ') || 'none'}). Write ` +
        `components/${name}.tsx in the site repo and upload it with \`sb site push\` first.`,
    );
  }
  const found = vs!.find((v) => v.version === version);
  if (!found) {
    fail(`"${name}" has no version ${JSON.stringify(version)} — versions: ${vs!.map((v) => v.version).join(', ') || 'none'}`);
  }
  if (!props || typeof props !== 'object' || Array.isArray(props)) fail('specials.props must be an object');
  const schema = found!.propsSchema ?? {};
  const content = Object.keys(schema).filter((k) => schema[k]?.kind !== 'css');
  const where = `${name} v${found!.version}`;
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    const p = schema[k];
    if (!p) fail(`unknown prop "${k}" — ${where} takes: ${content.join(', ') || 'no props'}`);
    if (p!.kind === 'css') fail(`"${k}" is a css prop — set it as style "--${k}" (per breakpoint), not in props`);
    const ok = KIND_OK[p!.kind ?? ''];
    if (ok && !ok(v, p!)) {
      const opts = p!.kind === 'enum' && Array.isArray(p!.options) ? ` (one of ${p!.options.join(', ')})` : '';
      fail(`prop "${k}" of ${where} is kind ${p!.kind}${opts}; got ${JSON.stringify(v)}`);
    }
  }
}

/**
 * Drop any `html` / `clientUrl` a caller put in a code-component's specials,
 * IN PLACE, and say so. The platform overwrites both on every save, so a sent
 * value would only make the caller believe it set the markup.
 */
export function stripDerived(specials: Record<string, unknown> | undefined): string[] {
  if (!specials) return [];
  const dropped = DERIVED_KEYS.filter((k) => k in specials);
  for (const k of dropped) delete specials[k];
  return dropped;
}

export const derivedNote = (keys: string[]): string =>
  `specials ${keys.join(' / ')} dropped: the platform renders them from component + version + props on save.`;

/** A specials write on a code-component that needs the pin re-checked. */
export const touchesPin = (keys: Record<string, unknown>): boolean => CONTENT_KEYS.some((k) => k in keys);

export function registerComponentTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_components',
    {
      description:
        "The site's code components (its own React, pushed by `sb site push`): name, latest, and " +
        "each version's props schema — what a code-component node may pin and set.",
      inputSchema: {
        site_id: z.string().optional(),
        name: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ site_id: given, name }) => {
      const siteId = siteFor(ctx, given);
      const names = name ? [name] : (await latest(ctx, siteId)).map((v) => v.name);
      const components = [];
      for (const n of names) {
        const vs = await versionsOf(ctx, siteId, n);
        if (!vs) throw new Error(`sbuilder: this site has no code component "${n}"`);
        components.push({
          name: n,
          latest: vs[0]?.version,
          versions: vs.map((v) => ({ version: v.version, props: v.propsSchema ?? {} })),
        });
      }
      const note = ctx.notices.once('components:place', PLACE_NOTICE);
      return text({ components, ...(note ? { note } : {}) });
    },
  );
}
