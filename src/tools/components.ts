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
export const DERIVED_KEYS = ['html', 'clientUrl', 'hydrateProps'] as const;
const CONTENT_KEYS = ['component', 'version', 'props'];

export type PropSpec = { kind?: string; default?: unknown; options?: unknown[] };
type Version = { name: string; version: number; propsSchema?: Record<string, PropSpec> };

const base = (siteId: string) => `/api/sites/${encodeURIComponent(siteId)}/code-components`;

const get = (ctx: ToolContext, path: string, query?: Record<string, number>) =>
  request({ base: ctx.base, method: 'GET', path, token: siteToken(ctx), query, fetchImpl: ctx.fetchImpl });

/** Each component's LATEST version, with that version's propsSchema. */
async function latest(ctx: ToolContext, siteId: string): Promise<Version[]> {
  const out = (await get(ctx, base(siteId))) as { codeComponents?: Version[] };
  return out.codeComponents ?? [];
}

/** Every version of one component, newest first; null when the platform says there is no such component. */
async function versionsOf(ctx: ToolContext, siteId: string, name: string): Promise<Version[] | null> {
  try {
    // ponytail: one page of 200, the platform's per-component version cap.
    const out = (await get(ctx, `${base(siteId)}/${encodeURIComponent(name)}/versions`, { limit: 200 })) as { versions?: Version[] };
    return out.versions ?? [];
  } catch (e) {
    // Only the platform's own "no such component": a 404 from a proxy or an
    // unwired route is a failure to report, not an answer about the site.
    if (e instanceof ApiError && e.status === 404 && e.code === 'not_found') return null;
    throw e;
  }
}

const PLACE_NOTICE =
  'Place one with sb_add {type:"code-component", specials:{component, version, props}}. props are the ' +
  'content props; a kind:"css" prop is a style key "--<name>" (per breakpoint), never a prop. html, ' +
  'clientUrl and hydrateProps are rendered by the platform on save — never send them. A component is ' +
  'written in the site repo (components/<Name>.tsx) and uploaded with `sb site push`; this server only places it.';

// Mirrors codecomponents.SanitizeProps / PropDef.value (props.go): what the
// platform refuses with ErrInvalidProps, which stores the node blank.
const MAX_TEXT_BYTES = 64 << 10;
const MAX_URL_BYTES = 2048;

/** Mirror of props.go `safeURL`: "", http(s)://, or site-relative. */
export function safeURL(s: string): boolean {
  if (s === '') return true;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  const t = s.trim();
  if (t.startsWith('//') || t.startsWith('/\\') || t.startsWith('\\')) return false;
  const colon = t.indexOf(':');
  if (colon < 0) return true;
  const i = t.search(/[/?#]/);
  if (i >= 0 && i < colon) return true; // the ':' is in the path or query, not a scheme
  return ['http', 'https'].includes(t.slice(0, colon).toLowerCase());
}

const STRING_KINDS = new Set(['text', 'richtext', 'link', 'image', 'enum']);

/** Why `v` is not a valid value of `p`, or undefined when it is (or the kind is one this build does not know). */
function invalid(v: unknown, p: PropSpec): string | undefined {
  const kind = p.kind ?? '';
  if (STRING_KINDS.has(kind)) {
    if (typeof v !== 'string') return 'expected a string';
    const limit = kind === 'link' || kind === 'image' ? MAX_URL_BYTES : MAX_TEXT_BYTES;
    // A lone surrogate is the only invalid UTF-8 a JS string can carry.
    if (Buffer.byteLength(v, 'utf8') > limit || !(v as string & { isWellFormed(): boolean }).isWellFormed()) return `longer than ${limit} bytes or not valid UTF-8`;
    if ((kind === 'link' || kind === 'image') && !safeURL(v)) return 'must be an http(s) or site-relative URL';
    if (kind === 'enum' && Array.isArray(p.options) && !p.options.includes(v)) return `not one of ${p.options.join(', ')}`;
    return undefined;
  }
  if (kind === 'boolean') return typeof v === 'boolean' ? undefined : 'expected true or false';
  if (kind === 'number') return typeof v === 'number' && Number.isFinite(v) ? undefined : 'expected a finite number';
  return undefined;
}

/**
 * A pin checker for ONE tool call: the versions of each component are read
 * once, however many nodes of the call pin it.
 *
 * It refuses what the platform would get wrong without saying so. An unknown
 * component or version, or a prop value of the wrong kind, stores the node
 * BLANK (a render warning is the only trace); a prop the version does not
 * declare, or a css prop, is DROPPED in silence by SanitizeProps. `specials`
 * is the node's specials AS THEY WILL BE STORED. Throws; resolves when good.
 */
export function pinChecker(ctx: ToolContext, siteId: string) {
  const cache = new Map<string, Promise<Version[] | null>>();
  const versions = (name: string) => {
    if (!cache.has(name)) cache.set(name, versionsOf(ctx, siteId, name));
    return cache.get(name)!;
  };
  return async (specials: Record<string, unknown>, at: string): Promise<void> => {
    const { component, version } = specials;
    const props = specials.props ?? {}; // null is "no props", as the platform reads it
    const fail = (msg: string): never => {
      throw new Error(`sbuilder: ${at}: ${msg}`);
    };
    if (typeof component !== 'string' || !component) {
      fail("a code-component needs specials.component — sb_components lists this site's components");
    }
    if (version === undefined || version === null) fail('a code-component needs specials.version — sb_components lists them');
    const name = component as string;
    const vs = await versions(name);
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
    if (typeof props !== 'object' || Array.isArray(props)) fail('specials.props must be an object');
    const schema = found!.propsSchema ?? {};
    const content = Object.keys(schema).filter((k) => schema[k]?.kind !== 'css');
    const where = `${name} v${found!.version}`;
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      const p = schema[k];
      if (!p) fail(`unknown prop "${k}" — ${where} takes: ${content.join(', ') || 'no props'}`);
      if (p!.kind === 'css') fail(`"${k}" is a css prop — set it as style "--${k}" (per breakpoint), not in props`);
      if (v === null) continue; // null is "use the default"
      const why = invalid(v, p!);
      if (why) fail(`prop "${k}" of ${where} is kind ${p!.kind}: ${why}; got ${JSON.stringify(v).slice(0, 80)}`);
    }
  };
}

/**
 * Drop any server-derived key a caller put in a code-component's specials,
 * IN PLACE, and say so. The platform overwrites them on every save, so a sent
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

/** A specials write (keys or unset) on a code-component that needs the pin re-checked. */
export const touchesPin = (keys: Record<string, unknown>, unset: string[] = []): boolean =>
  CONTENT_KEYS.some((k) => k in keys || unset.includes(k));

export function registerComponentTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'sb_components',
    {
      description:
        "The site's code components (its own React, pushed by `sb site push`): name, latest and its props " +
        'schema; with name, every version and its schema — what a code-component node may pin and set.',
      inputSchema: {
        site_id: z.string().optional(),
        name: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ site_id: given, name }) => {
      const siteId = siteFor(ctx, given);
      const note = ctx.notices.once('components:place', PLACE_NOTICE);
      const said = note ? { note } : {};
      if (!name) {
        const components = (await latest(ctx, siteId)).map((v) => ({ name: v.name, latest: v.version, props: v.propsSchema ?? {} }));
        return text({ components, ...said });
      }
      const vs = await versionsOf(ctx, siteId, name);
      if (!vs) throw new Error(`sbuilder: this site has no code component "${name}" — sb_components without name lists them`);
      return text({
        name,
        latest: vs[0]?.version,
        versions: vs.map((v) => ({ version: v.version, props: v.propsSchema ?? {} })),
        ...said,
      });
    },
  );
}
