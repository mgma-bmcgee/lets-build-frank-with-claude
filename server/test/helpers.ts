import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AzureGateway } from '../src/azure.js';
import { type Config, loadConfig } from '../src/config.js';

/** A config with no Azure variables and an empty console directory. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const emptyPublic = mkdtempSync(join(tmpdir(), 'frank-public-'));
  return { ...loadConfig({}), publicDir: emptyPublic, ...overrides };
}

/** A stand-in for Azure that tools can be tested against; override what a test needs. */
export function fakeGateway(overrides: Partial<AzureGateway> = {}): AzureGateway {
  const unused = async (): Promise<never> => {
    throw new Error('not faked in this test');
  };
  return {
    resourceGroup: 'rg-frank-class',
    listResources: unused,
    listContainerApps: unused,
    getContainerApp: unused,
    ...overrides,
  };
}

/** A connected MCP client talking to Frank's real tool registry, with Azure faked. */
export async function mcpClientWith(azure: AzureGateway | null, config: Config = testConfig()) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { registerTools } = await import('../src/tools/index.js');
  const server = new McpServer({ name: 'frank-test', version: '0.0.0' });
  registerTools(server, { config, startedAt: new Date(), azure });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}
