/**
 * The one way a tool answers.
 *
 * COMPACT, not pretty: the reader is a model, and a two-space indent was measured
 * at ~15 % of every structured result. A string passes through untouched.
 *
 * Every tool returns through here so the content shape is decided in a single
 * place — a hand-built content array is the shape that drifts, and a drifted one
 * fails inside the client rather than here.
 */
export function text(value: unknown) {
  // `JSON.stringify(undefined)` is undefined, not "undefined" — and a content
  // block whose text is undefined is REFUSED by the client's own schema, so the
  // tool call fails with a validation error instead of returning. A DELETE that
  // answers 204 with no body reaches here as undefined, which is how a perfectly
  // successful call became "Invalid tools/call result" on a live run.
  const body = typeof value === 'string' ? value : (JSON.stringify(value) ?? 'null');
  return { content: [{ type: 'text' as const, text: body }] };
}

/** A base64 image, optionally followed by a note the model should read. */
export function image(dataBase64: string, mimeType = 'image/png', note?: unknown) {
  const content: Array<
    { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
  > = [{ type: 'image' as const, data: dataBase64, mimeType }];
  if (note !== undefined) {
    content.push({
      type: 'text' as const,
      text: typeof note === 'string' ? note : JSON.stringify(note),
    });
  }
  return { content };
}

/**
 * Several images (one per breakpoint, say), optionally followed by a note.
 * Separate blocks rather than one tiled sheet so each is seen at a readable size.
 */
export function images(items: Array<{ dataBase64: string; mimeType?: string }>, note?: unknown) {
  const content: Array<
    { type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string }
  > = items.map((it) => ({
    type: 'image' as const,
    data: it.dataBase64,
    mimeType: it.mimeType ?? 'image/png',
  }));
  if (note !== undefined) {
    content.push({
      type: 'text' as const,
      text: typeof note === 'string' ? note : JSON.stringify(note),
    });
  }
  return { content };
}
