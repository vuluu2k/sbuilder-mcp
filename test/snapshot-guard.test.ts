import { describe, it, expect } from 'vitest';
import { connect } from 'node:net';
import { egressProxy, publicAddress, resolvePublic } from '../src/vision/egress.js';
import { blockedUrl, snapshot } from '../src/vision/shoot.js';

// site_template photographs a URL whose host a site owner controls (a custom
// domain) and whose markup an author controls. Neither may steer the operator's
// headless browser into their own network.
describe('egress policy', () => {
  it('passes global unicast only — every tunnelled or mapped form is refused', () => {
    const refused = [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
      '::', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::7f00:1', '64:ff9b::7f00:1',
      '2002:7f00:1::1', '2001:0:4136:e378::1', '2001:db8::1', 'not-an-ip', '1::2::3',
    ];
    for (const ip of refused) expect(publicAddress(ip), ip).toBe(false);
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '2a00:1450:4001::1']) {
      expect(publicAddress(ip), ip).toBe(true);
    }
  });

  it('resolves literals without the network and names localhost as private', async () => {
    expect(await resolvePublic('8.8.8.8')).toEqual({ address: '8.8.8.8' });
    expect(await resolvePublic('[::1]')).toEqual({ refused: expect.stringMatching(/private address ::1/) });
    expect(await resolvePublic('shop.localhost')).toEqual({ refused: expect.stringMatching(/private host/) });
  });

  it('the proxy refuses a CONNECT to a private address and any plain-http request', async () => {
    const { port } = new URL(await egressProxy());
    const ask = (line: string) =>
      new Promise<string>((resolve, reject) => {
        const s = connect(Number(port), '127.0.0.1', () => s.write(line));
        let got = '';
        s.on('data', (d) => (got += d));
        s.on('end', () => resolve(got));
        s.on('error', reject);
      });
    expect(await ask('CONNECT 127.0.0.1:22 HTTP/1.1\r\nHost: 127.0.0.1:22\r\n\r\n')).toMatch(/^HTTP\/1\.1 403[\s\S]*private address 127\.0\.0\.1/);
    expect(await ask('GET http://127.0.0.1/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')).toMatch(/^HTTP\/1\.1 403/);
  });

  it('snapshot refuses up front: a private host, and anything but https', async () => {
    expect(await blockedUrl('https://8.8.8.8/')).toBeUndefined();
    expect(await blockedUrl('http://8.8.8.8/')).toMatch(/only https/);
    expect(await blockedUrl('file:///etc/passwd')).toMatch(/scheme file:/);
    await expect(snapshot('https://127.0.0.1:9/')).rejects.toThrow(/refusing to photograph private address/);
  });
});
