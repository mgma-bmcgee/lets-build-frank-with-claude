// Pre-implementation spike (see docs/plans/preflight.sh). Proves the plan's
// load-bearing SDK assumptions against the exact pinned versions. Exits 1 on any failure.
import express from 'express';
import http from 'node:http';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { hostHeaderValidation } from '@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

function buildServer() {
  const server = new McpServer({ name: 'frank-spike', version: '0.0.0' });
  server.registerTool('get_status', {
    description: 'Returns status.',
    inputSchema: z.object({}).strict(),
  }, async () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { summary: 'ok' } }));
  server.registerTool('get_echo', {
    description: 'Echoes a word.',
    inputSchema: z.object({ word: z.string().describe('A word') }).strict(),
  }, async ({ word }) => ({ content: [{ type: 'text', text: word }], structuredContent: { summary: word } }));
  return server;
}

const app = express();
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
const mcp = express.Router();
mcp.use(hostHeaderValidation(['localhost', '127.0.0.1', '[::1]']));
mcp.use(express.json());
mcp.post('/', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
mcp.all('/', (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
app.use('/mcp', mcp);

const listener = app.listen(0, '127.0.0.1');
await new Promise(r => listener.once('listening', r));
const port = listener.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  const client = new Client({ name: 'spike-client', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', base)));
  check('SDK client connects to stateless server (initialize)', true);

  const { tools } = await client.listTools();
  check('tools/list returns both tools', tools.length === 2, tools.map(t => t.name).join(','));
  const echo = tools.find(t => t.name === 'get_echo');
  check('strict schema exported as additionalProperties:false', echo?.inputSchema?.additionalProperties === false, JSON.stringify(echo?.inputSchema));
  check('param description survives to JSON Schema', echo?.inputSchema?.properties?.word?.description === 'A word');

  const good = await client.callTool({ name: 'get_echo', arguments: { word: 'hi' } });
  check('valid call succeeds (2nd request on fresh server)', !good.isError && good.structuredContent?.summary === 'hi');

  const extra = await client.callTool({ name: 'get_echo', arguments: { word: 'hi', sneaky: 1 } });
  const msg = extra.content?.[0]?.text ?? '';
  check('extra field REJECTED with isError', extra.isError === true, msg.replace(/\s+/g, ' ').slice(0, 120));
  check('error message has no stack trace', !/\bat .*\.(m?js|ts):\d+/.test(msg));

  const extraEmpty = await client.callTool({ name: 'get_status', arguments: { sneaky: 1 } });
  check('extra field rejected on EMPTY strict schema', extraEmpty.isError === true);

  // node:http, not fetch: undici silently drops a caller-set Host header.
  const post = (host) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const r = http.request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(body) } }, res => { res.resume(); resolve({ status: res.statusCode }); });
    r.on('error', reject); r.end(body);
  });
  const evil = await post('evil.example');
  check('foreign Host on /mcp → 403', evil.status === 403, String(evil.status));
  const lh = await post(`localhost:${port}`);
  check('localhost:<port> on /mcp allowed (port-agnostic)', lh.status !== 403, String(lh.status));
  const hz = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: '/healthz', headers: { host: 'evil.example' } }, r => { r.resume(); res({ status: r.statusCode }); }).on('error', rej));
  check('/healthz with foreign Host → 200 (unguarded)', hz.status === 200);
  const get = await fetch(`${base}/mcp`);
  check('GET /mcp → 405', get.status === 405);

  await client.close();
} catch (e) {
  check('spike ran without throwing', false, e.message);
} finally {
  listener.close();
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed on node ${process.version}`);
process.exit(failed ? 1 : 0);
