/**
 * The document patch primitive, mirrored from the editor's live-edit channel
 * (editor/src/history/patchRecorder.ts + features/liveedit/ops.ts).
 *
 * The shape has to match exactly: these patches go on the wire to peers running
 * the editor's own code, and a shape it does not recognise is dropped silently.
 */
export type Path = (string | number)[];

export type Patch =
  | { op: 'set'; path: Path; value: unknown }
  | { op: 'unset'; path: Path }
  | { op: 'insert'; path: Path; index: number; value: unknown }
  | { op: 'remove'; path: Path; index: number };

/** Segments that must never appear in a path we apply or send. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Is this path part of the shared DOCUMENT?
 *
 * An allowlist, not a denylist, and three rules rather than one — each closing a
 * real door:
 *
 *  - `path.length < 2` also rejects the bare `['nodes']`. A write there does not
 *    touch one node, it REPLACES THE ENTIRE MAP. No legitimate edit produces it
 *    (every real one is `nodes.<id>.…`, at least three segments), so refusing it
 *    costs nothing and closes a one-frame whole-document takeover.
 *  - The path must start at `nodes`. Everything else in a store is per-viewer
 *    state or local bookkeeping — syncing a selection would yank every peer's
 *    cursor about.
 *  - Segments are compared AFTER stringifying. A segment shaped `['__proto__']`
 *    stringifies to `'__proto__'` — a one-element array becomes its single
 *    element — so a `typeof seg === 'string'` guard lets it through and it lands
 *    on Object.prototype anyway.
 */
export function isSyncablePath(path: Path): boolean {
  if (!Array.isArray(path) || path.length < 2 || path[0] !== 'nodes') return false;
  return path.every((seg) => !FORBIDDEN.has(`${seg}`));
}

/**
 * Is this whole patch admissible — path and, for a splice, its index?
 *
 * The index rule exists because a NEGATIVE index splices from the END: `remove`
 * at -1 deletes the last child of an array the sender never named, and `insert`
 * at -1 lands one slot in from the end of somebody else's parent. A fractional
 * index is the same class — splice truncates it, so the write addresses a
 * different element than the one described.
 *
 * An index PAST the end is deliberately allowed: splice clamps it, an append is
 * a legitimate thing to describe, and a remove past the end removes nothing.
 */
export function isSyncablePatch(p: Patch): boolean {
  if (!isSyncablePath(p.path)) return false;
  if (p.op !== 'insert' && p.op !== 'remove') return true;
  return Number.isInteger(p.index) && p.index >= 0;
}

/**
 * Keep only the patches that belong on the wire.
 *
 * FILTERS rather than throws, unlike applyPatches below, and the asymmetry is
 * deliberate: a peer must never be able to halt this process by sending one bad
 * frame, while a patch WE built that fails admission is a bug in our own builder
 * and must be loud.
 */
export function syncable(patches: Patch[]): Patch[] {
  return patches.filter(isSyncablePatch);
}

function parentOf(state: object, path: Path): { holder: Record<string, unknown>; key: string } {
  let cur = state as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) {
    const k = `${path[i]}`;
    if (FORBIDDEN.has(k)) throw new Error(`patch: inadmissible segment "${k}"`);
    const next = cur[k];
    if (next === undefined || next === null || typeof next !== 'object') {
      cur[k] = {};
    }
    cur = cur[k] as Record<string, unknown>;
  }
  const key = `${path[path.length - 1]}`;
  if (FORBIDDEN.has(key)) throw new Error(`patch: inadmissible segment "${key}"`);
  return { holder: cur, key };
}

/**
 * Apply patches left to right, in place.
 *
 * An inadmissible patch THROWS rather than being skipped. Skipping is right for
 * the wire (see `syncable`), but locally a silent skip would leave the document
 * half-edited with nothing anywhere to say so — which is the exact failure shape
 * this whole repo exists to rule out.
 */
/**
 * A patch's value, detached from whatever the caller still holds.
 *
 * Primitives are returned as they are — a style key is a string, and cloning
 * one on every `sb_set` would be pure cost. Only a structure can be aliased,
 * and only an alias can be mutated behind the batch's back.
 */
function clone<T>(value: T): T {
  return value !== null && typeof value === 'object' ? (structuredClone(value) as T) : value;
}

export function applyPatches(state: object, patches: Patch[]): void {
  for (const p of patches) {
    if (!isSyncablePatch(p)) {
      throw new Error(`patch: inadmissible patch ${JSON.stringify(p)}`);
    }
    const { holder, key } = parentOf(state, p.path);
    switch (p.op) {
      case 'set':
        // THE VALUE IS NEVER ALIASED INTO THE DOCUMENT.
        //
        // `addSubtree` builds a node, emits `set nodes/<id>` carrying THAT
        // object, and then emits `insert` patches that push child ids into
        // `data.nodes`. Assigning the reference means the first apply MUTATES
        // the patch's own value, so the batch is no longer the thing it was: a
        // second apply re-establishes a node that already holds its children and
        // then inserts them again.
        //
        // Applying a batch twice is not hypothetical — `applyAndSave` does it by
        // design, once through `preview` to judge the write and once for real.
        // Between v0.16.1 (which introduced that check) and this fix, EVERY
        // nested `sb_add` stored each child twice, and `sb_import` three times.
        // It is silent: the tree is well-formed, every id resolves, the save is
        // accepted, and the page simply renders its content twice. Measured on
        // a real import — 106 of 231 containers listing one child id three
        // times.
        //
        // A copy makes the batch idempotent for this shape: the re-`set` puts a
        // pristine node back, and the inserts that follow rebuild the same list.
        holder[key] = clone(p.value);
        break;
      case 'unset':
        delete holder[key];
        break;
      case 'insert': {
        const arr = holder[key];
        if (!Array.isArray(arr)) break;
        arr.splice(p.index, 0, clone(p.value));
        break;
      }
      case 'remove': {
        const arr = holder[key];
        if (!Array.isArray(arr)) break;
        arr.splice(p.index, 1);
        break;
      }
    }
  }
}
