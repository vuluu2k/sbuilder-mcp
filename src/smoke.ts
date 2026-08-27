/**
 * Offline self-test. No network, no MCP transport — just the pure logic, so a
 * broken build fails before anything is published. Must end with ALL GOOD.
 */
import { text } from './mcp/response.js';
import { createServer, pkgVersion } from './server.js';
import { API_OPERATIONS } from './catalog/api.generated.js';
import { searchOperations, describeOperation } from './catalog/search.js';
import { credentialFor } from './transport/credential.js';

function check(label: string, ok: boolean): void {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.error(`ok: ${label}`);
}

export async function runSmoke(): Promise<void> {
  check('text() wraps a string', text('x').content[0].text === 'x');
  check('pkgVersion() is not empty', pkgVersion().length > 0);
  check('createServer() builds', createServer() !== null);

  check('API index has 300+ operations', API_OPERATIONS.length > 300);
  check(
    'every operation has a credential',
    API_OPERATIONS.every((o) => ['apiKey', 'session', 'none'].includes(o.credential)),
  );
  check(
    'every credential matches the routing rule',
    API_OPERATIONS.every((o) => o.credential === credentialFor(o.path)),
  );
  check('search finds menu operations', searchOperations('menu').length > 0);
  check('search returns nothing for nonsense', searchOperations('zzzzqqqq').length === 0);
  check(
    'no operation reports both body verdicts at once',
    API_OPERATIONS.every((o) => {
      const d = describeOperation(o) as Record<string, unknown>;
      return !(d.body_warning !== undefined && d.body_note !== undefined);
    }),
  );

  console.error('ALL GOOD');
}

runSmoke().catch((err) => {
  console.error('smoke threw:', err);
  process.exit(1);
});
