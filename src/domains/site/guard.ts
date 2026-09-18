/**
 * A SOFT guard is one that asserts what a renderer does — "this key compiles
 * to nothing", "this element takes no such child" — against the catalog's
 * copy of the platform, which can be older than the deployment. A caller who
 * knows better can override it per call; the write goes through and the
 * message is reported instead of thrown.
 *
 * A HARD guard protects an invariant the platform itself enforces or a write
 * that destroys data with no way back (band order, a composed stamp, ROOT).
 * Those are called directly, never through here, so `force` cannot reach them.
 */
export interface GuardOpts {
  force?: boolean;
  /** The messages force overrode, for the tool to report. Owned by the caller. */
  forced?: string[];
}

export const FORCE_HINT = ' Pass force:true to write anyway.';

export function soft(g: GuardOpts | undefined, check: () => void): void {
  try {
    check();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (g?.force) {
      // A caller that passed `force` without an array still gets the override,
      // and the record must not be dropped on the floor: minting the array is
      // cheaper than a force whose message nobody can report.
      (g.forced ??= []).push(msg);
      return;
    }
    // THE HINT IS ONLY TRUE FOR A CALLER THAT CAN PASS `force`. A builder
    // reached with NO guard sits behind a tool whose schema has no such
    // argument — `sb_import`, `sb_import_site`, `sb_template_use`, `sb_store`
    // all do this — so the hint would name an argument that is refused.
    if (g === undefined) throw e instanceof Error ? e : new Error(msg);
    throw new Error(msg.endsWith(FORCE_HINT) ? msg : msg + FORCE_HINT);
  }
}
