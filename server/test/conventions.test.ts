// ADR-002, checked against every registered tool. A new tool gets these checks
// for free by being added to src/tools/index.ts.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool, isStrict, TOOL_NAME_PATTERN } from '../src/tools/define.js';
import { registerTools, tools } from '../src/tools/index.js';
import { testConfig } from './helpers.js';

const FORBIDDEN_VERBS = /^(create|update|delete|run|set|put|post|patch|remove|write|start|stop|restart|deploy)_/;

function sentences(text: string): number {
  return text.split(/[.!?](?:\s|$)/).filter((s) => s.trim() !== '').length;
}

let client: Client;

beforeAll(async () => {
  const server = new McpServer({ name: 'frank-test', version: '0.0.0' });
  registerTools(server, { config: testConfig(), startedAt: new Date(), azure: null });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: 'conventions-test', version: '0.0.0' });
  await client.connect(clientSide);
});

afterAll(async () => {
  await client?.close();
});

it('has at least one tool, starting with get_status', () => {
  expect(tools.map((t) => t.name)).toContain('get_status');
});

it('has no duplicate tool names', () => {
  const names = tools.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
});

describe.each(tools.map((t) => [t.name, t] as const))('%s', (name, tool) => {
  it('is named verb_noun with a verb from get|list|search|summarize', () => {
    expect(name).toMatch(TOOL_NAME_PATTERN);
    expect(name).not.toMatch(FORBIDDEN_VERBS);
  });

  it('has a one- or two-sentence description', () => {
    expect(tool.description.trim()).not.toBe('');
    expect(sentences(tool.description)).toBeLessThanOrEqual(2);
  });

  it('describes every input parameter', () => {
    for (const [param, schema] of Object.entries(tool.input.shape)) {
      expect(schema.description, `parameter '${param}' needs .describe()`).toBeTruthy();
    }
  });

  it('takes no scope-changing parameter', () => {
    const params = Object.keys(tool.input.shape).map((p) => p.toLowerCase());
    for (const p of params) expect(p).not.toMatch(/resource_?group|subscription|tenant/);
  });

  it('has a strict input schema', () => {
    expect(isStrict(tool.input)).toBe(true);
  });

  it('outputs a top-level summary string and describes every output field', () => {
    expect(tool.output.shape.summary).toBeInstanceOf(z.ZodString);
    for (const [field, schema] of Object.entries(tool.output.shape)) {
      expect((schema as z.ZodType).description, `output field '${field}' needs .describe()`).toBeTruthy();
    }
  });

  it('rejects an unknown field through the real MCP server', async () => {
    const result = await client.callTool({ name, arguments: { not_a_real_parameter: 1 } });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? '';
    expect(text).toMatch(/not_a_real_parameter/);
    expect(text).not.toMatch(/\n\s+at /);
  });

  it('advertises additionalProperties: false in tools/list', async () => {
    const { tools: listed } = await client.listTools();
    expect(listed.find((t) => t.name === name)?.inputSchema.additionalProperties).toBe(false);
  });
});

describe('defineTool refuses out-of-policy tools', () => {
  const output = z.object({ summary: z.string().describe('s') });

  it('rejects a verb outside the closed set', () => {
    expect(() =>
      defineTool({
        // @ts-expect-error delete_ is not a permitted verb, and the type says so too
        name: 'delete_resource_group',
        description: 'x',
        input: z.object({}).strict(),
        output,
        handler: () => ({ summary: '' }),
      }),
    ).toThrow(/ADR-002/);
  });

  it('rejects a non-strict input schema', () => {
    expect(() =>
      defineTool({ name: 'get_thing', description: 'x', input: z.object({}), output, handler: () => ({ summary: '' }) }),
    ).toThrow(/strict/);
  });
});
