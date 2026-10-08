import { describe, it, expect } from 'vitest';
import { eventHref, deadNavigation, PAYLOAD_NEEDS } from '../src/domains/site/navhref.js';

/**
 * `scroll_to` (web_builder feat/native-actions 4df4a0cd0): a sole click projects
 * `#<targetId>` onto `specials.href` — the platform's `eventHref` — and publish
 * emits `ScrollControl#to` beside it, so a missing href is not a dead click.
 */
describe('scroll_to', () => {
  it('projects a fragment link, and nothing without a target', () => {
    expect(eventHref({ name: 'click', action: 'scroll_to', payload: { targetId: 'fs_1a2b3c4d' } })).toBe('#fs_1a2b3c4d');
    expect(eventHref({ name: 'click', action: 'scroll_to', payload: {} })).toBeUndefined();
  });

  it('is never reported as dead navigation — the runtime call still scrolls', () => {
    const events = [{ name: 'click', action: 'scroll_to', payload: { targetId: 'fs_1a2b3c4d' } }];
    expect(deadNavigation({ events, specials: {} })).toBeNull();
  });

  it('needs a target, by the same table sb_event and sb_review share', () => {
    expect(PAYLOAD_NEEDS.scroll_to.key).toBe('targetId');
  });
});
