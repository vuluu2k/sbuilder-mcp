import { describe, it, expect } from 'vitest';
import { text } from '../src/mcp/response.js';

describe('text()', () => {
  it('passes a string through unchanged', () => {
    expect(text('hello')).toEqual({ content: [{ type: 'text', text: 'hello' }] });
  });

  it('pretty-prints a non-string', () => {
    expect(text({ a: 1 })).toEqual({ content: [{ type: 'text', text: '{\n  "a": 1\n}' }] });
  });
});
