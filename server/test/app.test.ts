import { mkdtempSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { testConfig } from './helpers.js';

// Host-header tests must use supertest (or node:http): fetch silently drops a
// caller-set Host header and would pass for the wrong reason.
const LIST_TOOLS = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const MCP_ACCEPT = 'application/json, text/event-stream';

describe('over real HTTP with the SDK client', () => {
  let listener: Server;
  let client: Client;

  beforeAll(async () => {
    listener = createApp(testConfig()).listen(0, '127.0.0.1');
    await new Promise((resolve) => listener.once('listening', resolve));
    const { port } = listener.address() as AddressInfo;
    client = new Client({ name: 'app-test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
  });

  afterAll(async () => {
    await client?.close();
    await new Promise((resolve) => listener.close(resolve));
  });

  it('lists get_status', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('get_status');
  });

  it('calls get_status and returns structured content', async () => {
    const result = await client.callTool({ name: 'get_status', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ name: 'frank', summary: expect.any(String) });
  });

  it('serves several requests in a row (stateless, fresh server each time)', async () => {
    for (let i = 0; i < 3; i++) {
      const result = await client.callTool({ name: 'get_status', arguments: {} });
      expect(result.isError).toBeFalsy();
    }
  });

  it('rejects an unknown argument', async () => {
    const result = await client.callTool({ name: 'get_status', arguments: { resource_group: 'someone-elses' } });
    expect(result.isError).toBe(true);
  });
});

describe('routes', () => {
  const app = createApp(testConfig());

  it('GET /healthz is 200', async () => {
    await request(app).get('/healthz').expect(200, { status: 'ok' });
  });

  it('GET / answers even with no console built', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('No console has been built yet');
  });

  it('GET and DELETE /mcp are 405', async () => {
    await request(app).get('/mcp').expect(405);
    await request(app).delete('/mcp').expect(405);
  });

  it('answers malformed JSON with a plain 400, no stack', async () => {
    const res = await request(app)
      .post('/mcp')
      .set('Content-Type', 'application/json')
      .set('Accept', MCP_ACCEPT)
      .send('{not json')
      .expect(400);
    expect(JSON.stringify(res.body)).not.toMatch(/\bat .*\.(ts|js):\d+/);
  });

  it('sends no CORS headers (ADR-006: same-origin only)', async () => {
    const res = await request(app).get('/healthz').set('Origin', 'https://elsewhere.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('console serving', () => {
  const publicDir = mkdtempSync(join(tmpdir(), 'frank-console-'));
  writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>console</title>');
  writeFileSync(join(publicDir, 'app.js'), 'console.log(1)');
  const app = createApp(testConfig({ publicDir }));

  it('serves the built console at /', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.text).toContain('<title>console</title>');
  });

  it('serves console assets', async () => {
    await request(app).get('/app.js').expect(200);
  });

  it('falls back to the console for client-side routes', async () => {
    const res = await request(app).get('/tools').expect(200);
    expect(res.text).toContain('<title>console</title>');
  });

  it('still routes /healthz and /mcp to Frank', async () => {
    await request(app).get('/healthz').expect(200, { status: 'ok' });
    await request(app).get('/mcp').expect(405);
  });
});

describe('DNS-rebinding protection on /mcp', () => {
  const fqdn = 'frank-octocat.happy-hill-123.eastus.azurecontainerapps.io';
  const base = testConfig();
  const app = createApp({ ...base, allowedHosts: [...base.allowedHosts, fqdn] });
  const post = (host: string) =>
    request(app).post('/mcp').set('Host', host).set('Accept', MCP_ACCEPT).send(LIST_TOOLS);

  it('rejects a foreign Host with 403', async () => {
    await post('evil.example').expect(403);
  });

  it.each(['localhost:3000', 'localhost:5173', '127.0.0.1:3000', '[::1]:3000'])('allows %s', async (host) => {
    await post(host).expect(200);
  });

  it('allows the Container Apps FQDN', async () => {
    await post(fqdn).expect(200);
  });

  it('leaves /healthz and / open to any Host', async () => {
    await request(app).get('/healthz').set('Host', 'evil.example').expect(200);
    await request(app).get('/').set('Host', 'evil.example').expect(200);
  });
});
