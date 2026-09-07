/**
 * A directive is said ONCE per process.
 *
 * REVIEW_NOTICE, RESPONSIVE_NOTICE and MEASURE_NOTICE are instructions, not
 * data, and an instruction repeated on every call is skimmed by the third one.
 * Measured: three notices at ~300 chars each rode along on most page results.
 * Each is returned the first time a tool asks for it and never again, so the
 * result field is simply absent afterwards. `reset()` exists for tests.
 */
export class Notices {
  private readonly said = new Set<string>();

  once(key: string, body: string): string | undefined {
    if (this.said.has(key)) return undefined;
    this.said.add(key);
    return body;
  }

  reset(): void {
    this.said.clear();
  }
}
