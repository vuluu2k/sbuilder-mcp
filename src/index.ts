#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel. Every log line in this repo is console.error.
  console.error('[sbuilder-mcp] ready on stdio');
}

main().catch((err) => {
  console.error('[sbuilder-mcp] fatal:', err);
  process.exit(1);
});
