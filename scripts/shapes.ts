/**
 * REQUEST SHAPES — what a write operation's body actually looks like.
 *
 * `swagger.json` describes 46 of 211 write bodies. The other 165 are not
 * undiscoverable; they are merely absent from that document. The handler decodes
 * into a named struct:
 *
 *     case http.MethodPost:
 *         var m shipping.Method
 *         if err := json.NewDecoder(r.Body).Decode(&m); err != nil {
 *
 * So the shape is readable, and reading it is the same move CLAUDE.md already
 * records for `PUT /pages/{id}/source`: copy the working client, never guess a
 * body.
 *
 * IT IS ALSO MORE ACCURATE THAN SWAGGER, not merely more complete. One doc
 * comment block serves several `@Router` lines — `products/rest/rest.go:206`
 * attaches `@Param product body products.Product` to the GET as well as the POST,
 * so the call sheet for a listing currently claims a body. A decode site sits
 * inside one `case http.Method*` and is per-method by construction.
 *
 * THE PARSER NEVER GUESSES. A reference that resolves to two structs, a struct
 * whose braces never close, a decode whose method arm is ambiguous — each is
 * dropped and counted rather than approximated. That is the reasoning
 * `searchOperations` already records: a confident wrong answer is the expensive
 * failure, an absent one is cheap and recoverable.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ShapeField {
  name: string;
  type: string;
  note?: string;
}

export interface RequestShape {
  fields: ShapeField[];
  /** Fields the platform owns and a caller must not send. */
  readOnly?: string[];
  source: 'go';
  /** The Go type, for a reader who wants to go and look. */
  goType: string;
}

interface GoStruct {
  /** Repo-relative directory, which is what actually identifies a package. */
  dir: string;
  name: string;
  fields: RawField[];
  embeds: string[];
}

interface RawField {
  goName: string;
  goType: string;
  /** The json tag's name, `-` for skip, or null when there is no tag. */
  jsonName: string | null;
  doc: string[];
}

/**
 * Structs keyed `<dir>::<Name>`.
 *
 * DIRECTORY, NOT PACKAGE NAME. Every `internal/<x>/rest/*.go` file declares
 * `package rest`, so `products/rest` and `loyalty/rest` both define
 * `adjustRequest` — keying on the package name silently gave one of them the
 * other's fields, which is exactly the wrong-but-confident answer this generator
 * exists to avoid.
 */
type StructIndex = Map<string, GoStruct>;
/** Last path segment -> the directories declaring it, for qualified references. */
type PackageIndex = Map<string, string[]>;

// ---------------------------------------------------------------------------
// Walking the tree
// ---------------------------------------------------------------------------

function goFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Fixtures declare structs under the same names as the real ones.
      if (name === 'tests' || name === 'testdata' || name === 'node_modules') continue;
      goFiles(full, out);
    } else if (name.endsWith('.go') && !name.endsWith('_test.go')) {
      out.push(full);
    }
  }
  return out;
}

function dirOf(file: string, root: string): string {
  const rel = file.slice(root.length).replace(/^\/+/, '');
  const parts = rel.split('/');
  parts.pop();
  return parts.join('/');
}

// ---------------------------------------------------------------------------
// Struct index
// ---------------------------------------------------------------------------

const TYPE_OPEN = /^type\s+([A-Za-z_]\w*)\s+struct\s*\{\s*$/;
/**
 * The one-line form, used for a struct that is nothing but an embed:
 * `type ProductCategory struct{ CategoryBase }`. Four operations — both category
 * surfaces — resolved to nothing until this was read.
 */
const TYPE_ONELINE = /^type\s+([A-Za-z_]\w*)\s+struct\s*\{(.*)\}\s*$/;
/** `Name Type `tag`` — the tag is optional, the two columns are not. */
const FIELD = /^\s+([A-Z]\w*(?:,\s*[A-Z]\w*)*)\s+([^`]+?)\s*(?:`([^`]*)`)?\s*$/;
/** An embedded type carries no name column: `products.Product` or `*Foo`. */
const EMBED = /^\s+\*?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)\s*(?:`([^`]*)`)?\s*$/;

function jsonNameOf(tag: string | undefined): string | null {
  if (!tag) return null;
  const m = /json:"([^"]*)"/.exec(tag);
  if (!m) return null;
  const name = m[1].split(',')[0];
  return name === '' ? null : name;
}

/**
 * Read every top-level struct in one file.
 *
 * Brace counting rather than a Go parser, on the precedent this repo already set
 * for `BOUND_SPECIALS` and `DOC_SCHEMA_VERSION`, and bounded by the same
 * discipline: a struct whose braces do not balance before the file ends is
 * dropped rather than half-read.
 */
function readStructs(file: string, root: string, index: StructIndex): void {
  const dir = dirOf(file, root);
  if (!dir) return;
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const oneLine = TYPE_ONELINE.exec(lines[i]);
    if (oneLine) {
      const inner = oneLine[2].split(';').map((part) => `\t${part.trim()}`);
      index.set(`${dir}::${oneLine[1]}`, parseStructBody(dir, oneLine[1], inner));
      continue;
    }
    const open = TYPE_OPEN.exec(lines[i]);
    if (!open) continue;
    const body: string[] = [];
    let closed = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (/^\}/.test(lines[j])) {
        closed = true;
        break;
      }
      body.push(lines[j]);
    }
    if (!closed) continue;
    index.set(`${dir}::${open[1]}`, parseStructBody(dir, open[1], body));
    i = j;
  }
}

function parseStructBody(dir: string, name: string, body: string[]): GoStruct {
  const fields: RawField[] = [];
  const embeds: string[] = [];
  let doc: string[] = [];
  let skipDepth = 0;

  for (const raw of body) {
    const line = raw.replace(/\r$/, '');
    if (skipDepth > 0) {
      // Inside a nested anonymous struct. Its fields belong to that field, not to
      // this one, so they are stepped over; the field's type still says `object`.
      skipDepth += (line.match(/\{/g) ?? []).length;
      skipDepth -= (line.match(/\}/g) ?? []).length;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed === '') {
      doc = [];
      continue;
    }
    if (trimmed.startsWith('//')) {
      doc.push(trimmed.replace(/^\/\/\s?/, ''));
      continue;
    }
    if (/\bstruct\s*\{\s*$/.test(trimmed)) {
      const fieldName = trimmed.split(/\s+/)[0];
      const tag = /`([^`]*)`/.exec(trimmed)?.[1];
      fields.push({ goName: fieldName, goType: 'object', jsonName: jsonNameOf(tag), doc });
      doc = [];
      skipDepth = 1;
      continue;
    }
    const f = FIELD.exec(line);
    if (f) {
      const names = f[1].split(',').map((s) => s.trim());
      const goType = f[2].trim();
      const jsonName = jsonNameOf(f[3]);
      for (const goName of names) {
        // An `A, B string` pair shares one tag, which cannot name both; the Go
        // field name is then the JSON name for each.
        fields.push({ goName, goType, jsonName: names.length > 1 ? null : jsonName, doc });
      }
      doc = [];
      continue;
    }
    const e = EMBED.exec(line);
    if (e) {
      embeds.push(e[1]);
      doc = [];
      continue;
    }
    doc = [];
  }
  return { dir, name, fields, embeds };
}

function packageIndexOf(index: StructIndex): PackageIndex {
  const pkgs: PackageIndex = new Map();
  for (const s of index.values()) {
    const last = s.dir.split('/').pop() ?? '';
    const key = `${last}.${s.name}`;
    const dirs = pkgs.get(key) ?? [];
    if (!dirs.includes(s.dir)) dirs.push(s.dir);
    pkgs.set(key, dirs);
  }
  return pkgs;
}

/**
 * Turn a Go type reference into an index key.
 *
 * A bare name is this directory's own. A qualified one is resolved by package
 * name and MUST be unambiguous: two directories declaring the same `pkg.Type`
 * yields null, because picking either would be a guess.
 */
function resolveRef(
  ref: string,
  fromDir: string,
  index: StructIndex,
  pkgs: PackageIndex,
): string | null {
  if (!ref.includes('.')) {
    const key = `${fromDir}::${ref}`;
    return index.has(key) ? key : null;
  }
  const dirs = pkgs.get(ref);
  if (!dirs || dirs.length !== 1) return null;
  return `${dirs[0]}::${ref.split('.')[1]}`;
}

// ---------------------------------------------------------------------------
// Field notes
// ---------------------------------------------------------------------------

const NOTE_CAP = 240;
/** Two capitalised words near each other — this repo's own way of marking a trap. */
const SHOUTED = /\b[A-Z][A-Z]+\b(?:\s+(?:\w+\s+){0,2}\b[A-Z][A-Z]+\b)/;

/**
 * The first sentence, plus any sentence that shouts.
 *
 * The shouting is load-bearing, not decoration. `shipping.Method` documents
 * `FreeOverCents` as "ZERO MEANS 'never free', not 'always free'" and `Disabled`
 * as "NEGATIVE, so the zero value is the enabled default" — a shape without those
 * two sentences produces a store that ships everything for nothing, and a
 * delivery option that is switched off while looking configured. Keeping only the
 * first sentence would have dropped both.
 */
export function noteFrom(doc: string[]): string | undefined {
  const prose = doc.join(' ').replace(/\s+/g, ' ').trim();
  if (!prose) return undefined;
  const sentences = prose.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [prose];
  const keep = sentences.filter((s, i) => i === 0 || SHOUTED.test(s)).map((s) => s.trim());
  let note = keep.join(' ');
  if (note.length > NOTE_CAP) note = note.slice(0, NOTE_CAP - 1).replace(/\s+\S*$/, '') + '…';
  return note || undefined;
}

// ---------------------------------------------------------------------------
// Go type -> something a caller can act on
// ---------------------------------------------------------------------------

const SCALARS: Record<string, string> = {
  string: 'string',
  bool: 'boolean',
  int: 'number',
  int8: 'number',
  int16: 'number',
  int32: 'number',
  int64: 'number',
  uint: 'number',
  uint8: 'number',
  uint16: 'number',
  uint32: 'number',
  uint64: 'number',
  float32: 'number',
  float64: 'number',
  byte: 'number',
  'time.Time': 'string (RFC3339)',
  'time.Duration': 'number (ns)',
  'json.RawMessage': 'object',
  any: 'any',
  'interface{}': 'any',
};

function renderType(goType: string): string {
  let t = goType.trim();
  const nullable = t.startsWith('*');
  if (nullable) t = t.slice(1);
  let out: string;
  if (t.startsWith('[]')) {
    out = `${renderType(t.slice(2))}[]`;
  } else if (t.startsWith('map[')) {
    const close = t.indexOf(']');
    out = `{ [${renderType(t.slice(4, close))}]: ${renderType(t.slice(close + 1))} }`;
  } else {
    out = SCALARS[t] ?? t;
  }
  // A pointer is how this platform spells "absent differs from zero", and that
  // distinction decides bodies: `SetStock *int` absent means "no count was
  // taken", 0 means "there are none left".
  return nullable ? `${out} | null` : out;
}

// ---------------------------------------------------------------------------
// Flattening a struct into the fields a body carries
// ---------------------------------------------------------------------------

const MAX_EMBED_DEPTH = 3;

function flatten(
  key: string,
  index: StructIndex,
  pkgs: PackageIndex,
  depth = 0,
  seen: Set<string> = new Set(),
): ShapeField[] | null {
  if (seen.has(key)) return [];
  const s = index.get(key);
  if (!s) return null;
  seen.add(key);

  const out: ShapeField[] = [];
  if (depth < MAX_EMBED_DEPTH) {
    for (const embed of s.embeds) {
      const resolved = resolveRef(embed, s.dir, index, pkgs);
      if (!resolved) continue;
      const inner = flatten(resolved, index, pkgs, depth + 1, seen);
      if (inner) out.push(...inner);
    }
  }
  for (const f of s.fields) {
    if (f.jsonName === '-') continue;
    if (!/^[A-Z]/.test(f.goName)) continue; // unexported never reaches JSON
    const note = noteFrom(f.doc);
    out.push({ name: f.jsonName ?? f.goName, type: renderType(f.goType), ...(note ? { note } : {}) });
  }
  // Later wins, as Go's own embedding-shadowing does.
  const byName = new Map<string, ShapeField>();
  for (const f of out) byName.set(f.name, f);
  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Decode sites
// ---------------------------------------------------------------------------

const ROUTER = /@Router\s+(\S+)\s+\[(\w+)\]/;
const CASE_METHOD = /case\s+http\.Method([A-Z]\w*)\s*:/;
const IF_METHOD = /r\.Method\s*==\s*http\.Method([A-Z]\w*)/;
const VAR_TYPED = /^\s*var\s+(\w+)\s+(\*?\[?\]?[\w.[\]]+)\s*$/;
const VAR_ANON = /^\s*var\s+(\w+)\s+struct\s*\{\s*$/;
/**
 * Both decode spellings the platform uses. The private surface writes
 * `json.NewDecoder(r.Body).Decode(&x)`; `/api/v1` writes `decode(w, r, &x)`
 * through a package-local helper. Reading only the first left the PARTNER
 * surface — the one an API key opens — entirely unshaped.
 */
const DECODE = /\b[dD]ecode\w*\([^()]*&(\w+)\s*\)/;
/**
 * A third spelling, and the narrowest: a handler that needs the raw bytes for a
 * size check reads them first and then unmarshals.
 *
 *     raw, err := io.ReadAll(r.Body)
 *     var body documentBody
 *     if err := json.Unmarshal(raw, &body); err != nil {
 *
 * `json.Unmarshal` is also how this platform re-reads STORED json, so it counts
 * only inside a handler that was seen reading the request body — otherwise a
 * blob unpacked mid-handler would be published as the request shape.
 * `PUT /forms/{id}/document`, the one write that dresses a checkout's fields,
 * is written this way and this way only.
 */
const UNMARSHAL = /json\.Unmarshal\([^()]*&(\w+)\s*\)/;
const READS_RAW_BODY = /(?:ReadAll|Copy)\(\s*\w*\.?\w*,?\s*r\.Body|r\.Body\s*\)/;

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);
/** Decode targets that are plainly not bodies, so a miss on them is not news. */
const NOT_A_BODY = new Set(['err', 'error', 'string', 'bool', 'int', 'int64', 'buf', 'b']);

interface DecodeSite {
  path: string;
  method: string;
  /** A raw Go type reference, resolved later against the index. */
  ref: string | null;
  /** The directory the reference was written in, for a bare name. */
  fromDir: string;
  inline: GoStruct | null;
}

/**
 * Read one file into decode sites.
 *
 * A handler is a `func` plus the contiguous `//` block above it, which is where
 * the `@Router` lines live. Inside the body, the enclosing `case http.Method*`
 * says which of that handler's routes a decode belongs to — a handler serving GET
 * and POST from one doc comment decodes only in the POST arm.
 */
function readDecodeSites(file: string, dir: string): DecodeSite[] {
  const lines = readFileSync(file, 'utf8').split('\n');
  const sites: DecodeSite[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!/^func\s/.test(lines[i])) {
      i++;
      continue;
    }
    const routes: Array<{ path: string; method: string }> = [];
    for (let k = i - 1; k >= 0 && /^\s*\/\//.test(lines[k]); k--) {
      const r = ROUTER.exec(lines[k]);
      if (r) routes.push({ path: r[1], method: r[2].toUpperCase() });
    }
    const start = i;
    let end = i + 1;
    for (; end < lines.length && !/^\}/.test(lines[end]); end++);
    const body = lines.slice(start, end);
    i = end + 1;

    const writeRoutes = routes.filter((r) => WRITE_METHODS.has(r.method));
    if (writeRoutes.length === 0) continue;

    const readsRawBody = body.some((l) => READS_RAW_BODY.test(l));
    const decls = new Map<string, { ref: string | null; inline: GoStruct | null }>();
    let arm: string | null = null;
    for (let n = 0; n < body.length; n++) {
      const line = body[n];
      const c = CASE_METHOD.exec(line) ?? IF_METHOD.exec(line);
      if (c) arm = c[1].toUpperCase();

      const anon = VAR_ANON.exec(line);
      if (anon) {
        const inner: string[] = [];
        let depth = 1;
        let m = n + 1;
        for (; m < body.length; m++) {
          depth += (body[m].match(/\{/g) ?? []).length;
          depth -= (body[m].match(/\}/g) ?? []).length;
          if (depth === 0) break;
          inner.push(body[m]);
        }
        decls.set(anon[1], { ref: null, inline: parseStructBody(dir, '(inline)', inner) });
        n = m;
        continue;
      }
      const typed = VAR_TYPED.exec(line);
      if (typed) {
        const ref = typed[2].replace(/^[*[\]]+/, '');
        if (!NOT_A_BODY.has(ref)) decls.set(typed[1], { ref, inline: null });
        continue;
      }

      const dec = DECODE.exec(line) ?? (readsRawBody ? UNMARSHAL.exec(line) : null);
      if (!dec) continue;
      const found = decls.get(dec[1]);
      if (!found) continue;
      // Which route? The arm if one is in scope; otherwise attribution is only
      // unambiguous when the handler has exactly one write route.
      const method = arm && WRITE_METHODS.has(arm) ? arm : null;
      const targets = method
        ? writeRoutes.filter((r) => r.method === method)
        : writeRoutes.length === 1
          ? writeRoutes
          : [];
      for (const t of targets) {
        sites.push({
          path: t.path,
          method: t.method,
          ref: found.ref,
          fromDir: dir,
          inline: found.inline,
        });
      }
    }
  }
  return sites;
}

// ---------------------------------------------------------------------------
// What the platform owns — read off the editor
// ---------------------------------------------------------------------------

/**
 * `Omit<Product, 'id' | 'siteId' | 'createdAt' | …>` — spread over several lines
 * as often as not, hence the `[\s\S]` and the non-greedy tail.
 */
const OMIT = /Omit<\s*([A-Za-z_]\w*)\s*,([\s\S]*?)>/g;

/**
 * Which fields a caller must NOT send.
 *
 * The Go struct is the whole row, identity and derived columns included, so a
 * shape read from it alone invites a model to supply `id`, `siteId` and
 * `createdAt` on a create — and, worse, `priceCents` or `availableStock`, which
 * the platform computes and a caller cannot set at all. The editor says which
 * half is writable, in the one place it has to be exact:
 *
 *     export type CatalogProductInput =
 *       Partial<Omit<CatalogProduct, 'id' | 'siteId' | 'priceCents' | …>>
 *
 * Keyed by the TS interface name, matched to a Go type below.
 */
export function readEditorOmits(repo: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const featureDir = join(repo, 'editor', 'src', 'features');
  let features: string[];
  try {
    features = readdirSync(featureDir);
  } catch {
    return out;
  }
  for (const feature of features) {
    const file = join(featureDir, feature, 'types.ts');
    let src: string;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const m of src.matchAll(OMIT)) {
      const names = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
      if (names.length === 0) continue;
      // A type omitted from twice is a union of both lists: either mention is a
      // field the platform owns.
      const prev = out.get(m[1]) ?? [];
      out.set(m[1], [...new Set([...prev, ...names])]);
    }
  }
  return out;
}

/**
 * Attach the omit list to a Go type, or attach nothing.
 *
 * An exact name match wins. Otherwise the TS name must END with the Go name
 * (`ShippingMethod` for `shipping.Method`) and be the ONLY such candidate, and
 * every omitted field must actually be in the shape — two conditions rather than
 * one because `PaymentMethod` also ends with `Method`, and giving a delivery
 * option a gateway's read-only list would be the confident wrong answer.
 */
function readOnlyFor(
  goType: string,
  fields: ShapeField[],
  omits: Map<string, string[]>,
): string[] | undefined {
  const simple = goType.includes('.') ? goType.split('.')[1] : goType;
  // INTERSECTED, not required whole. The editor omits what its own richer view
  // carries — `CatalogProduct` hides `priceCents`, `totalStock` and
  // `availableStock`, none of which are columns on `products.Product` at all,
  // because price lives on the variant. Demanding every omitted name be present
  // threw the whole list away over fields the Go struct never had, and products —
  // the surface that matters most — lost its read-only list to that.
  const overlap = (names: string[]) => names.filter((n) => fields.some((f) => f.name === n));

  const exact = omits.get(simple);
  if (exact) {
    const hit = overlap(exact);
    return hit.length > 0 ? hit : undefined;
  }

  const candidates = [...omits.entries()].filter(([name]) => name.endsWith(simple));
  if (candidates.length !== 1) return undefined;
  const hit = overlap(candidates[0][1]);
  // Two, not one, for a match made on a name SUFFIX: `ShippingMethod` is the only
  // editor type ending in `Method` today, and the day a second one lands the
  // uniqueness check above catches it — but a single shared `id` is too thin a
  // thread to hang a claim on either way.
  return hit.length >= 2 ? hit : undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ShapeResult {
  shapes: Record<string, RequestShape>;
  stats: {
    structs: number;
    decodeSites: number;
    matched: number;
    /** Decode sites whose type could not be resolved to exactly one struct. */
    unresolved: string[];
    /** Shapes that also carry a read-only list read off the editor. */
    withReadOnly: number;
  };
}

/**
 * Build the shape table.
 *
 * `operationIds` is the set the catalog actually carries; a decode site whose
 * route is missing from it describes an operation nobody can reach through this
 * server, and emitting it would only grow the file.
 */
export function buildRequestShapes(repo: string, operationIds: Set<string>): ShapeResult {
  const root = join(repo, 'server', 'internal');
  const index: StructIndex = new Map();
  const files = goFiles(root);
  for (const file of files) readStructs(file, root, index);
  const pkgs = packageIndexOf(index);

  const omits = readEditorOmits(repo);
  const shapes: Record<string, RequestShape> = {};
  const unresolved: string[] = [];
  let decodeSites = 0;

  // EVERY file, not only `<x>/rest/`: the `/api/v1` handlers live directly in
  // `internal/publicapi`, and that is the surface an agent key opens. A file with
  // no `@Router` contributes nothing regardless, so the wider net costs a read
  // and no precision.
  for (const file of files) {
    const dir = dirOf(file, root);
    for (const site of readDecodeSites(file, dir)) {
      decodeSites++;
      const id = `${site.method.toLowerCase()}:${site.path}`;
      if (!operationIds.has(id)) continue;
      if (shapes[id]) continue; // a handler decodes once per arm; first wins

      let fields: ShapeField[] | null = null;
      let goType = '(inline)';
      if (site.inline) {
        const key = `${site.fromDir}::(inline)`;
        fields = flatten(key, new Map([[key, site.inline]]), pkgs);
      } else if (site.ref) {
        goType = site.ref;
        const key = resolveRef(site.ref, site.fromDir, index, pkgs);
        fields = key ? flatten(key, index, pkgs) : null;
        if (!fields) unresolved.push(`${id} -> ${site.ref}`);
      }
      if (!fields || fields.length === 0) continue;
      const readOnly = site.inline ? undefined : readOnlyFor(goType, fields, omits);
      shapes[id] = { fields, source: 'go', goType, ...(readOnly ? { readOnly } : {}) };
    }
  }

  return {
    shapes,
    stats: {
      structs: index.size,
      decodeSites,
      matched: Object.keys(shapes).length,
      unresolved,
      withReadOnly: Object.values(shapes).filter((s) => s.readOnly).length,
    },
  };
}
