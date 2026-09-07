import { describe, it, expect } from 'vitest';
import { text } from '../src/mcp/response.js';

describe('text()', () => {
  it('passes a string through unchanged', () => {
    expect(text('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('serialises a non-string compactly — the reader is a model, and indentation is 15 % of nothing', () => {
    expect(text({ a: 1, b: [1, 2] })).toEqual({ content: [{ type: 'text', text: '{"a":1,"b":[1,2]}' }] });
  });
});

describe('text() on an empty body', () => {
  it('never emits an undefined text block — a 204 is a success, not a schema error', () => {
    expect(text(undefined)).toEqual({ content: [{ type: 'text', text: 'null' }] });
    expect(typeof text(undefined).content[0].text).toBe('string');
  });
});
