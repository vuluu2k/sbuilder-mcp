import { describe, it, expect } from 'vitest';
import { PageDoc } from '../src/domains/site/document.js';
import { addSubtree } from '../src/domains/site/builder.js';
import { reviewDesign, type Finding } from '../src/domains/site/review.js';
import { compactFindings, FIX } from '../src/domains/site/findings.js';
import { STORE_PAGE_SEEDS, PAGE_LAYOUT_SEEDS } from '../src/catalog/storepages.generated.js';

/** A page holding one finished section with `spec` inside it. */
function page(spec: Parameters<typeof addSubtree>[2]) {
  const d = PageDoc.from({
    schema_version: 2,
    root_node_id: 'rt',
    nodes: {
      rt: { id: 'rt', data: { type: 'root', parent: null, nodes: [] }, style: {}, config: {}, specials: {}, responsive: {} },
    },
  });
  const { patches, ids } = addSubtree(d, 'rt', { type: 'flex-section', children: [spec] });
  d.apply(patches);
  const node = (id: string) => d.doc.nodes[id] as unknown as Record<string, any>;
  return { d, id: ids[1], node };
}

const codes = (fs: Finding[], code: string) => fs.filter((f) => f.code === code);

describe('invalid_action', () => {
  it('reports an event on an element that declares no events', () => {
    const { d, id, node } = page({ type: 'heading', specials: { text: 'Hi' } });
    node(id).events = [{ id: 'e', name: 'click', action: 'open_cart', payload: {} }];
    const [f] = codes(reviewDesign(d), 'invalid_action');
    expect(f?.nodeId).toBe(id);
    expect(f.severity).toBeUndefined(); // absent = error
  });

  it('reports an action the trigger does not offer, and a purchase-bound button reads bindingEvents', () => {
    const { d, id, node } = page({ type: 'button', specials: { text: 'Buy' } });
    node(id).events = [{ id: 'e', name: 'click', action: 'add_to_cart', payload: {} }];
    expect(codes(reviewDesign(d), 'invalid_action')).toHaveLength(1);
    node(id).events = [{ id: 'e', name: 'click', action: 'open_cart', payload: {} }];
    expect(codes(reviewDesign(d), 'invalid_action')).toHaveLength(0);
    // Bound to a purchase: go_to_url is not in bindingEvents.
    node(id).bindings = [{ id: 'bind-product-action', source: 'product.id', field: 'specials.x' }];
    node(id).events = [{ id: 'e', name: 'click', action: 'go_to_url', payload: { url: '/a' } }];
    expect(codes(reviewDesign(d), 'invalid_action')).toHaveLength(1);
  });

  it('reports a trigger the element does not offer', () => {
    const { d, id, node } = page({ type: 'button', specials: { text: 'x' } });
    node(id).events = [{ id: 'e', name: 'form:success', action: 'open_cart', payload: {} }];
    expect(codes(reviewDesign(d), 'invalid_action')).toHaveLength(1);
  });
});

describe('action_missing_target', () => {
  it('flags go_to_url / open_page without a url and popup without an id', () => {
    for (const [action, payload] of [
      ['go_to_url', {}],
      ['open_page', { id: 'pg_1' }],
      ['popup', {}],
    ] as const) {
      const { d, id, node } = page({ type: 'button', specials: { text: 'x' } });
      node(id).events = [{ id: 'e', name: 'click', action, payload }];
      const fs = reviewDesign(d);
      expect(codes(fs, 'action_missing_target'), action).toHaveLength(1);
      expect(codes(fs, 'invalid_action'), action).toHaveLength(0);
    }
  });

  it('is quiet for a complete payload and for actions with an AUTO target', () => {
    for (const [action, payload] of [
      ['go_to_url', { url: '/a' }],
      ['popup', { id: 'pp_1' }],
      ['open_cart', {}],
      ['open_menu', { menuId: '' }],
    ] as const) {
      const { d, id, node } = page({ type: 'button', specials: { text: 'x', href: '/a' } });
      node(id).events = [{ id: 'e', name: 'click', action, payload }];
      expect(codes(reviewDesign(d), 'action_missing_target'), action).toHaveLength(0);
    }
  });
});

describe('no_data_context', () => {
  it('flags a product-bound element outside any repeater on a plain page', () => {
    const { d, id } = page({ type: 'text-dataset' });
    const [f] = codes(reviewDesign(d, { pageType: 'page' }), 'no_data_context');
    expect(f?.nodeId).toBe(id);
  });

  it('is quiet on the page type that supplies the entity, inside a repeater, pinned, or with no page type', () => {
    const { d } = page({ type: 'text-dataset' });
    expect(codes(reviewDesign(d, { pageType: 'product' }), 'no_data_context')).toHaveLength(0);
    expect(codes(reviewDesign(d), 'no_data_context')).toHaveLength(0);

    const inList = page({ type: 'list-dataset', children: [{ type: 'dataset-block', children: [{ type: 'text-dataset' }] }] });
    expect(codes(reviewDesign(inList.d, { pageType: 'page' }), 'no_data_context')).toHaveLength(0);

    const pinned = page({ type: 'text-dataset' });
    pinned.node(pinned.id).bindings[0].target = { type: 'product', id: 'p_1', kind: 'title' };
    expect(codes(reviewDesign(pinned.d, { pageType: 'page' }), 'no_data_context')).toHaveLength(0);
  });
});

describe('unread_value', () => {
  it('flags a config value outside the element vocabulary', () => {
    const { d, id } = page({ type: 'media-dataset', config: { layout: 'carousel' } });
    const [f] = codes(reviewDesign(d), 'unread_value');
    expect(f?.nodeId).toBe(id);
    expect(f.key).toBe('config.layout');
  });

  it('flags a per-breakpoint value too, and leaves a legal / open value alone', () => {
    const { d, id, node } = page({ type: 'media-dataset', config: { layout: 'bottom', mediaImageRatio: '4 / 5' } });
    expect(codes(reviewDesign(d), 'unread_value')).toHaveLength(0);
    node(id).responsive = { mobile: { config: { layout: 'carousel' } } };
    expect(codes(reviewDesign(d), 'unread_value')).toHaveLength(1);
  });

  it('reads the global config vocabulary (collectionType) and honours its aliases', () => {
    const { d, node, id } = page({ type: 'list-dataset', children: [{ type: 'dataset-block' }] });
    node(id).config.collectionType = 'bestseller';
    expect(codes(reviewDesign(d), 'unread_value')).toHaveLength(1);
    node(id).config.collectionType = 'category';
    expect(codes(reviewDesign(d), 'unread_value')).toHaveLength(0);
  });
});

describe('custom_code_native', () => {
  const flagged: Array<[string, string]> = [
    ['form', '<form action="/x"><input name="email"><button>Send</button></form>'],
    ['heading', '<div class="hero"><h1>Big sale</h1><p>Everything 50% off</p></div>'],
    ['image', '<img src="https://cdn.x/a.jpg" alt="a">'],
    ['youtube', '<iframe src="https://www.youtube.com/embed/abc" width="560"></iframe>'],
    ['vimeo', '<iframe src="https://player.vimeo.com/video/1"></iframe>'],
    ['google-map', '<iframe src="https://www.google.com/maps/embed?pb=x"></iframe>'],
    ['menu', '<nav><a href="/a">A</a><a href="/b">B</a></nav>'],
    ['menu', '<ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul>'],
  ];
  for (const [native, code] of flagged) {
    it(`advises ${native} for ${code.slice(0, 30)}…`, () => {
      const { d, id } = page({ type: 'custom-code', specials: { code } });
      const [f] = codes(reviewDesign(d), 'custom_code_native');
      expect(f?.nodeId).toBe(id);
      expect(f.severity).toBe('maintenance');
      expect(f.problem).toContain(native);
    });
  }

  const quiet: Array<[string, string]> = [
    ['analytics', '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script><script>window.dataLayer=[];gtag("config","G-1")</script>'],
    ['chat widget', '<div id="chat-root"></div><script src="https://widget.example.com/chat.js"></script>'],
    ['unknown iframe', '<iframe src="https://forms.example.com/embed/9"></iframe>'],
    ['markup inside a script', '<script>document.body.insertAdjacentHTML("beforeend","<form><h1>x</h1></form>")</script>'],
    ['a single link', '<a href="https://partner.example.com">Partner</a>'],
    ['empty', ''],
    [
      'a third-party form posting to an external service',
      '<div id="mc_embed"><h2>Join our list</h2><form action="https://x.us1.list-manage.com/subscribe/post?u=1" method="post"><input type="email" name="EMAIL"><button>Subscribe</button></form></div>',
    ],
    ['a protocol-relative external form', '<form action="//manage.kmail-lists.com/subscriptions/subscribe"><input name="email"></form>'],
  ];
  for (const [what, code] of quiet) {
    it(`does not flag ${what}`, () => {
      const { d } = page({ type: 'custom-code', specials: { code } });
      expect(codes(reviewDesign(d), 'custom_code_native')).toHaveLength(0);
    });
  }
});

describe('the new findings and the platform seeds', () => {
  it('has a fix template for every new code', () => {
    for (const c of ['invalid_action', 'action_missing_target', 'no_data_context', 'unread_value', 'custom_code_native']) {
      expect(FIX[c], c).toBeTruthy();
    }
  });

  it('passes severity through the compact shape', () => {
    const { d } = page({ type: 'custom-code', specials: { code: '<h2>x</h2>' } });
    const { findings } = compactFindings(reviewDesign(d));
    expect(findings.find((f) => f.code === 'custom_code_native')?.severity).toBe('maintenance');
  });

  // Every page the platform itself seeds must review clean on these rules for
  // the type it is seeded for — a false positive on the editor's own starting
  // document is the one that teaches a reader to ignore the list.
  it('raises none of them on the platform seed for each page type', () => {
    const seeds = { ...STORE_PAGE_SEEDS, ...PAGE_LAYOUT_SEEDS } as Record<string, unknown>;
    const types: Record<string, string> = { articles: 'page', about: 'page', policy: 'page', faq: 'page' };
    for (const [k, seed] of Object.entries(seeds)) {
      const doc = PageDoc.from(structuredClone(seed));
      const fs = reviewDesign(doc, { pageType: types[k] ?? k });
      const ours = fs.filter((f) =>
        ['invalid_action', 'action_missing_target', 'no_data_context', 'unread_value', 'custom_code_native'].includes(f.code),
      );
      expect(ours, k).toEqual([]);
    }
  });
});

describe('sb_review: maintenance advice does not withhold the clean verdict', () => {
  it('a page whose only finding is custom_code_native reviews clean, with the advice beside it', async () => {
    const { fakePlatform } = await import('./helpers/platform.js');
    const p = fakePlatform();
    const { call, close } = await p.connect();
    try {
      await call('sb_page_open', { site_id: 's1', page_id: 'pg_1' });
      await call('sb_add', {
        parent_id: 'ROOT',
        dry_run: false,
        spec: { type: 'flex-section', children: [{ type: 'custom-code', specials: { code: '<h2>Big sale</h2>' } }] },
      });
      const r = await call('sb_review', {});
      expect(r.json.findings).toEqual([]);
      expect(r.json.verdict).toBeTruthy();
      expect((r.json.advice as Array<{ code: string }>).map((f) => f.code)).toEqual(['custom_code_native']);
      expect((r.json.fixes as Record<string, string>).custom_code_native).toBeTruthy();
    } finally {
      await close();
    }
  });
});
