// Frank's HTTP surface (ADR-001, ADR-006):
//   POST /mcp     MCP over Streamable HTTP, stateless
//   GET  /healthz 200 for health probes
//   /             the Cloudscape console, if one was built into <pkg root>/public
//
// No CORS (the console is same-origin, ADR-006) and no auth (ADR-007 was
// rejected: /mcp is deliberately public).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import type { Config } from './config.js';
import { registerTools } from './tools/index.js';

const NO_CONSOLE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Frank</title></head>
<body><p>Frank is running. MCP is at <code>POST /mcp</code>. No console has been built yet (ADR-003).</p></body></html>`;

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null });
}

export function createApp(config: Config, startedAt: Date = new Date()): express.Express {
  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const mcp = express.Router();
  // DNS-rebinding protection, guarding /mcp only (plan step 6, option C). It
  // matters for local dev, where Frank may run with the developer's own Azure
  // identity; the deployed /mcp is public anyway. Hostname-only, so any port
  // works. Known limitation: reaching a local Frank by LAN IP or another name
  // loads the console but its tool calls get 403 — that is expected.
  mcp.use(hostHeaderValidation(config.allowedHosts));
  mcp.use(express.json({ limit: '1mb' }));

  // Stateless: a fresh server and transport per request. The SDK refuses to
  // reuse a stateless transport, and no session state means any replica can
  // answer any request.
  mcp.post('/', async (req: Request, res: Response) => {
    const server = new McpServer({ name: 'frank', version: config.version });
    registerTools(server, { config, startedAt });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // No SSE stream and no sessions to delete; the SDK client expects this 405.
  mcp.all('/', (_req, res) => {
    res.setHeader('Allow', 'POST');
    jsonRpcError(res, 405, 'Method not allowed. Frank accepts POST /mcp only.');
  });
  app.use('/mcp', mcp);

  const indexHtml = join(config.publicDir, 'index.html');
  if (existsSync(indexHtml)) {
    app.use(express.static(config.publicDir, { index: 'index.html' }));
    // Client-side routes fall back to the console.
    app.get('/{*path}', (_req, res) => {
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (_req, res) => {
      res.type('html').send(NO_CONSOLE_PAGE);
    });
  }

  // Plain-language errors only; details go to the log, never to the caller.
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    if (res.headersSent) return;
    if (err?.type === 'entity.parse.failed') {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Request body is not valid JSON.' }, id: null });
      return;
    }
    console.error(`[frank] ${req.method} ${req.path} failed:`, err);
    const message = 'Frank hit an unexpected error handling this request.';
    if (req.path.startsWith('/mcp')) jsonRpcError(res, 500, message);
    else res.status(500).json({ error: message });
  };
  app.use(onError);

  return app;
}
