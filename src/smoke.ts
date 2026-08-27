/**
 * Offline self-test. No network, no MCP transport — just the pure logic, so a
 * broken build fails before anything is published. Must end with ALL GOOD.
 */
import { text } from './mcp/response.js';
import { createServer, pkgVersion } from './server.js';

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
  console.error('ALL GOOD');
}

runSmoke().catch((err) => {
  console.error('smoke threw:', err);
  process.exit(1);
});
