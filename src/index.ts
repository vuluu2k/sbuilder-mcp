#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildContext, createServer } from './server.js';
import { runInstall } from './install/index.js';
import { pickLang } from './install/guided.js';
import { pkgVersion } from './server.js';
import { closeBrowser } from './vision/shoot.js';

async function main(): Promise<void> {
  // `sbuilder-mcp install` writes this server into the agent clients on this
  // machine and exits. Checked BEFORE the transport opens: an installer that
  // also spoke MCP on stdout would corrupt the protocol for whatever ran it.
  // RUN BY HAND, NOT BY AN AGENT. A client always talks over a pipe; a person
  // who typed `npx sbuilder-mcp` in a terminal would otherwise stare at a cursor
  // that never moves. Tell them the one command they wanted.
  if (process.stdin.isTTY && !process.argv[2]) {
    const vi = pickLang() === 'vi';
    console.error(
      vi
        ? 'sbuilder-mcp là máy chủ MCP — agent AI (Claude Code, Cursor…) tự chạy nó.\n' +
            'Để kết nối máy này với Store Builder, chạy:\n\n  npx -y sbuilder-mcp@latest install\n'
        : 'sbuilder-mcp is an MCP server — your AI agent (Claude Code, Cursor…) runs it.\n' +
            'To connect this machine to Store Builder, run:\n\n  npx -y sbuilder-mcp@latest install\n',
    );
    process.exit(0);
  }
  if (process.argv[2] === 'install') {
    process.exit(await runInstall(process.argv.slice(3), { version: pkgVersion() }));
  }
  const ctx = buildContext();
  const server = createServer(ctx);
  await server.connect(new StdioServerTransport());
  // THE CLIENT CLOSED STDIN, SO THIS PROCESS IS DONE. The SDK does not exit on
  // its own, and the live-room socket (plus its reconnect timer) keeps the event
  // loop alive — an orphaned process that answers the server's pings, so the
  // agent's avatar stays in the room indefinitely. Exiting closes the socket and
  // the server publishes the leave.
  // Sign the device session out (see Session.logout) and close a pooled Chrome
  // first, bounded so a dead platform cannot keep the process alive. A signal is
  // re-raised once that is done, so the exit status is the one it would have had.
  let exiting = false;
  const done = (signal?: NodeJS.Signals) => () => {
    if (exiting) return;
    exiting = true;
    const leave = () => (signal ? process.kill(process.pid, signal) : process.exit(0));
    setTimeout(leave, 3000).unref();
    void Promise.allSettled([ctx.session.logout(), closeBrowser()]).then(leave);
  };
  process.stdin.once('end', done());
  process.stdin.once('close', done());
  process.once('SIGTERM', done('SIGTERM'));
  process.once('SIGINT', done('SIGINT'));
  // stdout is the MCP channel. Every log line in this repo is console.error.
  console.error('[sbuilder-mcp] ready on stdio');
}

main().catch((err) => {
  console.error('[sbuilder-mcp] fatal:', err);
  process.exit(1);
});
