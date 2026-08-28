#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { runInstallCli } from './install/index.js';

async function main(): Promise<void> {
  // `sbuilder-mcp install` writes this server into the agent clients on this
  // machine and exits. Checked BEFORE the transport opens: an installer that
  // also spoke MCP on stdout would corrupt the protocol for whatever ran it.
  if (process.argv[2] === 'install') {
    process.exit(runInstallCli(process.argv.slice(3)));
  }
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel. Every log line in this repo is console.error.
  console.error('[sbuilder-mcp] ready on stdio');
}

main().catch((err) => {
  console.error('[sbuilder-mcp] fatal:', err);
  process.exit(1);
});
