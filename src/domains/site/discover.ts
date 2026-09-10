/**
 * WHICH PAGES A SITE HAS, starting from one URL.
 *
 * `sb_import` reads ONE page, and that is the right shape for "bring this
 * section over". It is the wrong shape for the thing people actually ask for —
 * hand over a link and get the site — because the missing half was never the
 * capture: it was knowing what the pages ARE, and creating one for each.
 *
 * Two sources, in that order, because they cost wildly different amounts:
 *
 *   1. The site's own sitemap. One HTTP fetch, no browser, and it is the
 *      publisher's own list rather than a guess — a page nothing links to is in
 *      it, and a link that goes nowhere is not.
 *   2. The links on the entry page. A browser navigation each, so it is bounded
 *      hard, and it is the fallback rather than the default for that reason.
 *
 * This module is PURE, for the same reason `importmap.ts` is: the rules about
 * what counts as a page are the half worth arguing over, and they can be argued
 * over offline. Fetching belongs to the caller.
 */

/** A page the discovery believes exists, and where the belief came from. */
export interface Found {
  url: string;
  from: 'entry' | 'sitemap' | 'links';
}

/** A page that survived the filters, with the identity it will take on this site. */
export interface Planned extends Found {
  slug: string;
  name: string;
  /** Path depth, so a report can show why the cap kept what it kept. */
  depth: number;
}

export interface ChooseOpts {
  maxPages?: number;
  /** The site's own robots.txt rules. The ENTRY is never dropped by them — the caller named it. */
  robots?: RobotsRules;
  /** Path substrings a URL must contain. An explicit include OUTRANKS the not-content list. */
  include?: string[];
  exclude?: string[];
}

export interface Chosen {
  pages: Planned[];
  skipped: Record<string, number>;
  /**
   * First path segment → how many URLs share it, for three or more.
   *
   * The one thing a page count cannot tell a caller: forty URLs under
   * `/products/` are not forty pages on this platform, they are ONE product
   * template plus a catalogue. Importing them as static pages would produce a
   * store where nothing is buyable and every price is a literal.
   */
  groups: Record<string, number>;
}

/** Anything whose extension says it is a file rather than a page. */
const ASSET =
  /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|avif|css|js|mjs|json|xml|rss|atom|zip|rar|gz|tgz|tar|mp3|mp4|m4a|webm|mov|avi|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|txt)$/i;

/**
 * Paths that are a SITE'S PLUMBING rather than its content.
 *
 * Every one of these is either somebody else's storefront machinery — a cart, a
 * login, an account page this platform serves at its own fixed path — or an
 * endless tail (`/tag/`, `/author/`) that would spend the whole page budget on
 * near-duplicates of pages already taken. A caller who genuinely wants one says
 * so through `include`, which is checked first.
 */
const NOT_CONTENT = [
  '/wp-admin', '/wp-login', '/wp-json', '/wp-content', '/xmlrpc', '/cdn-cgi',
  '/feed', '/rss', '/comments',
  '/cart', '/checkout', '/my-account', '/account', '/login', '/logout',
  '/register', '/signin', '/sign-in', '/signup', '/sign-up', '/password',
  '/search', '/wishlist', '/compare',
  // Trailing slash means "this segment, wherever it appears": a tag archive is
  // as often /blog/tag/x as /tag/x.
  '/tag/', '/tags/', '/author/', '/authors/',
];

/**
 * PAGE 2 OF A LIST IS NOT A PAGE.
 *
 * `/blog/page/2` is the same design as `/blog` holding the next twenty records,
 * and this platform renders a list from its own catalogue rather than from
 * somebody else's pagination. Importing them spends the page budget on repeats
 * of a layout already taken. Narrow on purpose: `/blog/2024` is a year archive
 * and a real page, so only an explicit `page` segment counts.
 */
const PAGINATION = /\/(?:page|pages|p)\/\d+(?:\/|$)/i;

/** A leading path segment that is a language tag: `/en`, `/vi`, `/en-us`, `/zh-hans`. */
const LOCALE_SEG = /^[a-z]{2}(?:-[a-z]{2,4})?$/i;

/** A path split into the language it is written in and the page it names. */
function localeOf(path: string): { lang: string; key: string } {
  const segs = path.split('/').filter(Boolean);
  if (segs.length > 0 && LOCALE_SEG.test(segs[0])) {
    return { lang: segs[0].toLowerCase(), key: `/${segs.slice(1).join('/')}` };
  }
  return { lang: '', key: path };
}

/**
 * ONE PAGE PER PAGE, not one per language.
 *
 * A multilingual site lists every translation in its sitemap, so `/about`,
 * `/en/about` and `/vi/about` all arrive and all describe the same page. Import
 * them and the merchant gets the same content three times under three slugs,
 * with the page budget spent on translations of a page already taken — and this
 * platform has a translations surface for exactly that job.
 *
 * FOLDED ONLY ON A CONFLICT. A rule that simply dropped every `/xx/` prefix
 * would empty the plan for a site that serves ALL its pages under one — which
 * nodejs.org does, everything under `/en`. So a group forms only when two URLs
 * name the same page in different languages, which means the list can never
 * come back shorter than the number of distinct pages.
 *
 * The entry's own language wins, because that is the one the caller pointed at.
 */
function foldLocales(kept: Found[], entry: string, skip: (why: string) => void): Found[] {
  const entryLang = localeOf(pathOf(entry)).lang;
  const groups = new Map<string, Found[]>();
  for (const f of kept) {
    const { key } = localeOf(pathOf(f.url));
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  const out: Found[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    const langs = group.map((f) => localeOf(pathOf(f.url)).lang);
    if (new Set(langs).size === 1) {
      // Same language, same key: not translations at all, so nothing to choose
      // between. `/en/a` and `/en/a` cannot both be here — `seen` dropped that —
      // so this is a key collision the fold has no opinion about.
      out.push(...group);
      continue;
    }
    const pick =
      group.find((f) => f.url === entry) ??
      group.find((f) => localeOf(pathOf(f.url)).lang === entryLang) ??
      group.find((f) => localeOf(pathOf(f.url)).lang === '') ??
      group[0];
    for (const f of group) if (f !== pick) skip('other-locale');
    out.push(pick);
  }
  return out;
}

/**
 * Is this path the site's plumbing rather than one of its pages?
 *
 * A SUBSTRING TEST IS THE WRONG TEST, and it drops real pages: `/feedback`
 * contains `/feed`, `/cartier-watches` contains `/cart`, `/comments-policy`
 * contains `/comments`. Each of those is an ordinary page a merchant would
 * expect to see imported, and the loss is reported only as a number.
 *
 * So a plain entry matches at a BOUNDARY — the end of the path, a `/`, or a `.`
 * so `/wp-login.php` is still caught — and an entry written with a trailing
 * slash matches that segment anywhere.
 *
 * ANCHORING IT AT THE START OF THE PATH WAS THE FIRST FIX AND IT WAS HALF ONE.
 * A locale prefix is the ordinary shape of the sites this tool is pointed at,
 * and this platform's own market is Vietnamese, so `/en/cart`, `/vi/account` and
 * `/shop/checkout` all sailed through — each one eating a page slot and handing
 * the merchant a junk draft. The needle already begins with `/`, so its own left
 * boundary comes free: scanning anywhere and testing only the RIGHT boundary
 * catches those without reopening `/cartier-watches`.
 */
function isPlumbing(path: string): boolean {
  return NOT_CONTENT.some((s) => {
    if (s.endsWith('/')) return path.includes(s);
    for (let at = path.indexOf(s); at !== -1; at = path.indexOf(s, at + 1)) {
      const next = path.charAt(at + s.length);
      if (next === '' || next === '/' || next === '.') return true;
    }
    return false;
  });
}

/**
 * One canonical spelling of a URL, or null if it is not a page address at all.
 *
 * The trailing slash, `index.html` and a fragment are the three ways the same
 * page arrives under different names, and a crawl that does not fold them
 * imports the home page four times. The query string is DELIBERATELY kept here
 * and dropped later, so the drop can be counted and reported rather than
 * happening invisibly.
 */
export function normalizeUrl(raw: string, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    // A NON-HIERARCHICAL BASE THROWS, and the throw is the whole reason this is
    // wrapped: `new URL('/a', 'data:text/html,…')` is a TypeError, and one bad
    // href on one page must not end a crawl.
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  u.username = '';
  u.password = '';
  let path = u.pathname.replace(/\/index\.[a-z]{2,5}$/i, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  u.pathname = path === '' ? '/' : path;
  return u.toString();
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/**
 * The path, as a human wrote it.
 *
 * `URL` percent-encodes `pathname`, so a Vietnamese path comes back as
 * `/trang-ch%E1%BB%A7` — which turns into `trang-ch-e1-bb-a7` the moment a slug
 * is derived from it, and makes an `include: ['/tin-tức']` match nothing. The
 * decode is guarded because a malformed sequence throws, and a path this cannot
 * read is better matched raw than not at all.
 */
function pathOf(url: string): string {
  let raw: string;
  try {
    raw = new URL(url).pathname;
  } catch {
    return '/';
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * The `<loc>` values in a sitemap, and the child sitemaps of an index.
 *
 * Read with a regex rather than an XML parser on purpose: the whole grammar
 * this needs is one element name, the file arrives from a stranger's server,
 * and a dependency that parses arbitrary XML from an untrusted origin is a
 * larger surface than the feature is worth. `<sitemapindex>` is the only
 * distinction that matters — its locs are more sitemaps, not pages.
 */
export function sitemapUrls(xml: string): { pages: string[]; sitemaps: string[] } {
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
    const v = m[1]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    locs.push(v);
  }
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

/** The `Sitemap:` lines of a robots.txt — where a site says its sitemap really lives. */
export function robotsSitemaps(txt: string): string[] {
  const out: string[] = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** What a site's robots.txt asks a general crawler not to fetch. */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/**
 * The `User-agent: *` group's rules.
 *
 * HONOURED, not read for interest. A merchant importing their own site is one
 * caller; the other points this at somebody else's server, and a tool that
 * fetches a dozen pages should obey the file that exists to say which. It is
 * also an accuracy win on its own terms — what a site disallows is almost always
 * its plumbing, and the plumbing list here is a guess where robots.txt is the
 * site's own answer.
 *
 * `Allow` is collected too, because the standard resolves a conflict by the
 * LONGEST match and a site that disallows `/blog/` and allows `/blog/public/`
 * means the second.
 */
export function robotsRules(txt: string): RobotsRules {
  const allow: string[] = [];
  const disallow: string[] = [];
  let applies = false;
  for (const line of txt.split(/\r?\n/)) {
    const clean = line.replace(/#.*$/, '').trim();
    if (!clean) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(clean);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      applies = value === '*';
      continue;
    }
    if (!applies || !value) continue;
    // AN EMPTY `Disallow:` MEANS ALLOW EVERYTHING, and treating it as the empty
    // prefix would block every path on the site — the one parsing mistake in
    // this file that turns a polite crawler into a crawler that finds nothing.
    if (field === 'disallow') disallow.push(value);
    else if (field === 'allow') allow.push(value);
  }
  return { allow, disallow };
}

/** Does the site ask a general crawler to leave this path alone? */
export function blockedByRobots(path: string, rules: RobotsRules): boolean {
  const match = (rule: string): number => {
    // `*` and `$` are the two wildcards every major crawler honours. Anything
    // else in a rule is a literal prefix.
    const pattern = rule
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\\\$$/, '$');
    let re: RegExp;
    try {
      re = new RegExp(`^${pattern}`);
    } catch {
      return path.startsWith(rule) ? rule.length : -1;
    }
    return re.test(path) ? rule.length : -1;
  };
  const deny = Math.max(-1, ...rules.disallow.map(match));
  if (deny < 0) return false;
  const permit = Math.max(-1, ...rules.allow.map(match));
  // LONGEST MATCH WINS, and a tie goes to the crawler — that is what the
  // standard says and what every implementation does.
  return deny > permit;
}

/** A slug this platform will accept, from a path. The root is the home page. */
export function slugFor(url: string, taken: Set<string>): string {
  const path = pathOf(url);
  const base =
    path === '/'
      ? 'home'
      : path
          .replace(/\.[a-z0-9]{1,5}$/i, '')
          .split('/')
          .filter(Boolean)
          .join('-');
  let slug = base
    .toLowerCase()
    // NFD does not decompose đ — it is a letter of its own, not a d with a
    // stroke — and this platform is Vietnamese first, so a path with one in it
    // would lose the character rather than transliterate it.
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  if (!slug) slug = 'page';
  // A COLLIDING SLUG IS RENAMED BY THE PLATFORM, NOT REFUSED (`uniqueSlug`
  // suffixes -1, -2 … and its own comment says it never errors), so a duplicate
  // inside one run would come back under a name the caller never asked for and
  // every link authored to the requested one would be dead. Settle it here,
  // where the caller can still see both names in the plan.
  let out = slug;
  for (let n = 2; taken.has(out); n += 1) out = `${slug.slice(0, 57)}-${n}`;
  taken.add(out);
  return out;
}

/** A human name from a slug, for a page whose own `<title>` is not known yet. */
export function nameFor(slug: string): string {
  if (slug === 'home') return 'Home';
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Decide which of the discovered URLs become pages, and in what order.
 *
 * ORDER IS PART OF THE ANSWER, not a detail. A sitemap can list five thousand
 * URLs and the cap will take a dozen; taking the first dozen in file order gives
 * a site made of whatever the generator happened to emit first, which on a shop
 * is twelve product pages and no home page. Shallowest first — the root, then
 * `/about`, then `/blog/a-post` — is the site's own outline, so the cap keeps
 * the pages a visitor would actually be shown.
 */
export function choosePages(entry: string, urls: Found[], opts: ChooseOpts = {}): Chosen {
  const maxPages = opts.maxPages ?? 12;
  const include = (opts.include ?? []).map((s) => s.toLowerCase());
  const exclude = (opts.exclude ?? []).map((s) => s.toLowerCase());
  const origin = originOf(entry);
  const skipped: Record<string, number> = {};
  const skip = (why: string) => {
    skipped[why] = (skipped[why] ?? 0) + 1;
  };

  const seen = new Set<string>();
  const kept: Found[] = [];
  // THE ENTRY IS PAGE ONE, whether or not the discovery handed it back. A
  // sitemap that omits the home page is ordinary — plenty of generators list
  // only what they manage — and a caller who pasted a link and got a site
  // without the page they pasted has been given the wrong site. It still passes
  // through `include` / `exclude` below: forcing it past the caller's own filter
  // would be a different kind of wrong.
  for (const f of [{ url: entry, from: 'entry' as const }, ...urls]) {
    const norm = normalizeUrl(f.url);
    if (!norm) {
      skip('unreadable');
      continue;
    }
    if (originOf(norm) !== origin) {
      skip('off-site');
      continue;
    }
    const path = pathOf(norm).toLowerCase();
    const wanted = include.length > 0 ? include.some((s) => path.includes(s)) : null;
    if (wanted === false) {
      skip('not-included');
      continue;
    }
    if (exclude.some((s) => path.includes(s))) {
      skip('excluded');
      continue;
    }
    // AN EXPLICIT include OUTRANKS THE PLUMBING LIST. The list is a heuristic
    // about a stranger's site, and a caller who names `/account` knows something
    // this module does not.
    if (!wanted && norm !== entry) {
      if (ASSET.test(path)) {
        skip('asset');
        continue;
      }
      if (isPlumbing(path)) {
        skip('not-content');
        continue;
      }
      if (PAGINATION.test(path)) {
        skip('pagination');
        continue;
      }
      // THE ENTRY IS EXEMPT. The caller typed that URL, and a merchant whose own
      // robots.txt disallows their own home page has still asked for it.
      if (opts.robots && norm !== entry && blockedByRobots(path, opts.robots)) {
        skip('robots-disallow');
        continue;
      }
    }
    if (new URL(norm).search) {
      // A query string is nearly always a filter, a sort or a page number over
      // content already taken, and following them is how a crawl of a shop
      // spends twelve pages on the same grid.
      skip('query');
      continue;
    }
    if (seen.has(norm)) {
      // A SECOND COPY OF THE ENTRY IS NOT A LOSS. It is injected above and the
      // discovery hands it back too — a sitemap lists it, a crawl seeds its
      // frontier with it — so counting that collision reports a page dropped
      // when none was.
      if (norm !== entry) skip('duplicate');
      continue;
    }
    seen.add(norm);
    kept.push({ url: norm, from: norm === entry ? 'entry' : f.from });
  }

  const folded = foldLocales(kept, entry, skip);

  // GROUPS ARE COUNTED BEFORE THE CAP, because the whole point of reporting them
  // is to say what the cap is about to hide.
  const groups: Record<string, number> = {};
  for (const f of folded) {
    const seg = pathOf(f.url).split('/').filter(Boolean)[0];
    if (seg) groups[seg] = (groups[seg] ?? 0) + 1;
  }
  for (const k of Object.keys(groups)) if (groups[k] < 3) delete groups[k];

  const depthOf = (u: string) => pathOf(u).split('/').filter(Boolean).length;
  folded.sort((a, b) => {
    if (a.url === entry) return -1;
    if (b.url === entry) return 1;
    const d = depthOf(a.url) - depthOf(b.url);
    return d !== 0 ? d : a.url.localeCompare(b.url);
  });

  const over = Math.max(0, folded.length - maxPages);
  if (over > 0) skipped['over-page-limit'] = over;

  const taken = new Set<string>();
  const pages = folded.slice(0, maxPages).map((f) => {
    const slug = slugFor(f.url, taken);
    return { ...f, slug, name: nameFor(slug), depth: depthOf(f.url) };
  });
  return { pages, skipped, groups };
}

/**
 * The filter a link crawl needs, as one function: a raw href in, its canonical
 * spelling out, or null.
 *
 * Shares the tables with `choosePages` on purpose — a crawl that queued the
 * links `choosePages` is about to throw away would spend its whole navigation
 * budget on a login page and a PDF. `include` / `exclude` are NOT applied here:
 * those are the caller's narrowing of the site, and a page excluded from the
 * import can still be the page that links to one that is not.
 */
export function canonFor(entry: string): (raw: string) => string | null {
  const origin = originOf(entry);
  return (raw: string) => {
    const norm = normalizeUrl(raw, entry);
    if (!norm || originOf(norm) !== origin) return null;
    const path = pathOf(norm).toLowerCase();
    if (ASSET.test(path)) return null;
    if (isPlumbing(path)) return null;
    if (PAGINATION.test(path)) return null;
    return norm;
  };
}
