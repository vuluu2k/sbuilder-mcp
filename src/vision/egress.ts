import { createServer, type Server } from 'node:http';
import { connect, isIP, BlockList, type AddressInfo } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * EGRESS POLICY for a headless browser pointed at a page someone else controls.
 *
 * A custom domain is DNS its owner controls and a page is markup its author
 * controls, so either can aim the operator's local Chrome at their own network
 * (127.0.0.1, 10.x, 169.254.169.254…) — and a screenshot of that would be
 * uploaded to the author's site. Checking a URL before navigating is not enough:
 * a redirect, a subresource, a service worker or a DNS answer that changes
 * between the check and the connect (rebinding) all walk past it.
 *
 * So the browser context talks ONLY to this proxy, and the proxy resolves the
 * name itself, checks the address it is about to dial, and dials THAT address.
 * Deny by default: only global unicast passes.
 */

const v4Reserved = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  v4Reserved.addSubnet(net, bits, 'ipv4');
}

/** The 8 hextets of an IPv6 address, or undefined when it does not parse. */
function hextets(ip: string): number[] | undefined {
  let s = ip.toLowerCase();
  // A dotted tail (::ffff:1.2.3.4) becomes two hextets.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const o = dotted[1].split('.').map(Number);
    s = s.slice(0, -dotted[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail];
  if (all.length !== 8) return undefined;
  const out = all.map((h) => parseInt(h, 16));
  return out.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? undefined : out;
}

/**
 * True only for a GLOBAL UNICAST address. IPv6 must be 2000::/3 and not one of
 * the prefixes that tunnel an IPv4 address (6to4, Teredo, NAT64) — those are
 * refused outright rather than unwrapped, as is every IPv4-mapped/compatible form
 * (they fall outside 2000::/3). Anything unparseable is refused.
 */
export function publicAddress(ip: string): boolean {
  if (isIP(ip) === 4) return !v4Reserved.check(ip, 'ipv4');
  if (isIP(ip) !== 6) return false;
  const h = hextets(ip);
  if (!h) return false;
  if ((h[0] & 0xe000) !== 0x2000) return false; // not 2000::/3
  if (h[0] === 0x2002) return false; // 6to4
  if (h[0] === 0x2001 && h[1] === 0x0000) return false; // Teredo
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false; // documentation
  if (h[0] === 0x0064 && h[1] === 0xff9b) return false; // NAT64 (outside 2000::/3 anyway)
  return true;
}

/** The address to dial for `host`, or why there is none. Resolves once; the caller dials exactly this. */
export async function resolvePublic(host: string): Promise<{ address: string } | { refused: string }> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (bare === 'localhost' || bare.endsWith('.localhost')) return { refused: `private host ${bare}` };
  const addrs = isIP(bare) ? [bare] : (await lookup(bare, { all: true }).catch(() => [])).map((a) => a.address);
  if (addrs.length === 0) return { refused: `unresolvable host ${bare}` };
  // EVERY answer must be public: a name that also resolves privately is one a
  // second lookup (Chrome's, a retry's) could land on.
  const bad = addrs.find((a) => !publicAddress(a));
  return bad ? { refused: `private address ${bad} (${bare})` } : { address: addrs[0] };
}

let proxy: Promise<{ server: Server; url: string }> | undefined;

/**
 * The process-wide egress proxy (lazy, loopback-bound). HTTPS goes through
 * CONNECT and is dialled to the checked address; a plain-HTTP request is
 * refused — a public storefront is served over https, and refusing http closes
 * the absolute-URI path a redirect to http://127.0.0.1 would take.
 */
export function egressProxy(): Promise<string> {
  proxy ??= new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('sbuilder snapshot: plain http is not fetched');
    });
    server.on('connect', (req, client, head) => {
      const m = /^(.+):(\d+)$/.exec(req.url ?? '');
      if (!m) {
        client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      void resolvePublic(m[1]).then((r) => {
        if ('refused' in r) {
          client.end(`HTTP/1.1 403 Forbidden\r\nX-Refused: ${r.refused}\r\n\r\n`);
          return;
        }
        const upstream = connect(Number(m[2]), r.address, () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          upstream.pipe(client);
          client.pipe(upstream);
        });
        const drop = () => {
          upstream.destroy();
          client.destroy();
        };
        upstream.on('error', drop);
        client.on('error', drop);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.unref();
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
  return proxy.then((p) => p.url);
}
