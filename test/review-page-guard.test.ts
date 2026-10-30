import { describe, it, expect } from 'vitest';
import { fakePlatform } from './helpers/platform.js';

/** TTG, 2026-10-30: a batched sb_page_open reached the server after sb_review, which reviewed the previous page. */
describe('sb_review page_id', () => {
  it('names the page it reviewed and refuses a page that is not the open one', async () => {
    const p = fakePlatform(() => undefined);
    const { call, close } = await p.connect();
    await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
    const ok = await call('sb_review', { page_id: 'pg_1' });
    expect(ok.isError).toBe(false);
    expect(ok.json.page).toBe('pg_1');
    const wrong = await call('sb_review', { page_id: 'pg_2' });
    expect(wrong.isError).toBe(true);
    expect(wrong.text).toMatch(/open page is pg_1, not pg_2/);
    await close();
  });
});
