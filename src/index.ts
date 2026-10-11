#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildContext, createServer } from './server.js';
import { runInstallCli } from './install/index.js';
import { closeBrowser } from './vision/shoot.js';

async function main(): Promise<void> {
  // `sbuilder-mcp install` writes this server into the agent clients on this
  // machine and exits. Checked BEFORE the transport opens: an installer that
  // also spoke MCP on stdout would corrupt the protocol for whatever ran it.
  if (process.argv[2] === 'install') {
    process.exit(runInstallCli(process.argv.slice(3)));
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
