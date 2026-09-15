import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { missingUsualPages, USUAL_PAGES } from '../src/domains/site/inventory.js';
import { connectedClient } from './harness.js';
import { Session } from '../src/transport/auth.js';
import { Notices } from '../src/mcp/notices.js';
import { UndoLog } from '../src/tools/undo.js';

const keys = (pages: Parameters<typeof missingUsualPages>[0]) =>
  missingUsualPages(pages).map((u) => u.key);

const p = (name: string, slug: string, type = 'page') => ({ name, slug, type });

describe('missingUsualPages', () => {
  // THE MEASURED SHOP. A store built with these tools: a home page, a product
  // list and a category grid, and nothing else a website has.
  it('names every unconditional page a bare storefront lacks', () => {
    expect(keys([p('Home', ''), p('Tất cả sản phẩm', 'san-pham', 'category')])).toEqual(
      USUAL_PAGES.filter((u) => !u.when).map((u) => u.key),
    );
  });

  // THE LIVENESS ANCHOR, and the one that matters most here: a site that HAS
  // these must come back empty, or this is a list that always fires.
  it('says nothing about a site that has them, in Vietnamese', () => {
    expect(
      keys([
        p('Đăng nhập', 'dang-nhap'),
        p('Đăng ký', 'dang-ky'),
        p('Quên mật khẩu', 'quen-mat-khau'),
        p('Liên hệ', 'lien-he'),
        p('Giới thiệu', 'gioi-thieu'),
        p('Chính sách giao hàng & đổi trả', 'chinh-sach-giao-hang'),
        p('Chính sách bảo mật', 'chinh-sach-bao-mat'),
        p('Câu hỏi thường gặp', 'cau-hoi-thuong-gap'),
      ]),
    ).toEqual([]);
  });

  it('says nothing about the same site in English', () => {
    expect(
      keys([
        p('Log in', 'login'),
        p('Register', 'register'),
        p('Forgot password', 'forgot-password'),
        p('Contact', 'contact'),
        p('About us', 'about'),
        p('Shipping and returns', 'shipping-policy'),
        p('Privacy policy', 'privacy'),
        p('FAQ', 'faq'),
      ]),
    ).toEqual([]);
  });

  // A TEMPLATE IS NOT A PAGE. "Chi tiết sản phẩm" answers /products/{slug} and
  // is not an about page; letting a typed template satisfy one of these would
  // report a site complete on the strength of a page at a different address.
  it('does not let a typed template stand in for a content page', () => {
    expect(keys([p('Giới thiệu sản phẩm', 'gioi-thieu-sp', 'product')])).toContain('about');
  });

  // ONE POLICY PAGE IS NOT ALL OF THEM. These were a single bucket entry, and
  // the measured shop — carrying "Chính sách giao hàng & đổi trả" and no privacy
  // terms at all — read as complete.
  it('still asks for privacy terms when only the delivery policy exists', () => {
    const got = keys([p('Chính sách giao hàng & đổi trả', 'chinh-sach-giao-hang')]);
    expect(got).toContain('policy-privacy');
    expect(got).not.toContain('policy-delivery');
  });

  it('still asks for delivery terms when only the privacy policy exists', () => {
    const got = keys([p('Chính sách bảo mật', 'chinh-sach-bao-mat')]);
    expect(got).toContain('policy-delivery');
    expect(got).not.toContain('policy-privacy');
  });

  // CONDITIONAL, AND BOTH SIDES OF IT. A blog listing matters once there is an
  // article template to list, and advising it before that is advice about a
  // section the site never asked for.
  it('asks for a blog listing only once an article template exists', () => {
    expect(keys([p('Home', '')])).not.toContain('blog');
    expect(keys([p('Home', ''), p('Bài viết', 'bai-viet', 'post')])).toContain('blog');
  });

  it('is satisfied by a listing page under any of its names', () => {
    for (const listing of [p('Tin tức', 'tin-tuc'), p('Blog', 'blog'), p('Cẩm nang', 'cam-nang')]) {
      expect(keys([listing, p('Bài viết', 'bai-viet', 'post')])).not.toContain('blog');
    }
  });

  it('is silent when the page list could not be read, rather than inventing a bare site', () => {
    expect(keys(null)).toEqual([]);
  });
});

describe('sb_page_list carries the advice', () => {
  let client: Awaited<ReturnType<typeof connectedClient>>['client'];
  let close: () => Promise<void>;
  const pages = [{ id: 'pg_1', name: 'Home', slug: '', path: '/', type: 'page', status: 'draft' }];

  beforeAll(async () => {
    const f = (async () =>
      new Response(JSON.stringify({ pages }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    const session = new Session('http://x', f);
    (session as unknown as { access: string }).access = 'jwt';
    ({ client, close } = await connectedClient({
      base: 'http://x', session, fetchImpl: f,
      notices: new Notices(), undo: new UndoLog(), siteId: 's1',
    }));
  });
  afterAll(async () => {
    await close();
  });

  // PROVING THE WIRING. missingUsualPages' own tests pass whether or not the
  // tool ever calls it.
  it('reports them on a one-page site, and still returns the pages', async () => {
    const res = (await client.callTool({
      name: 'sb_page_list',
      arguments: { site_id: 's1' },
    })) as { content: Array<{ text: string }> };
    const body = JSON.parse(res.content[0].text) as {
      pages: unknown[];
      usually_also: Record<string, string>;
      usually_also_note: string;
    };
    expect(body.pages).toHaveLength(1);
    expect(Object.keys(body.usually_also).sort()).toEqual(
      USUAL_PAGES.filter((u) => !u.when).map((u) => u.key).sort(),
    );
    expect(body.usually_also_note).toMatch(/Advice, not/);
  });
});
