// The console's only way to reach Frank: MCP over Streamable HTTP at /mcp,
// resolved against the page's own origin (ADR-006). The console holds no
// secrets (ADR-003) — it can only do what Frank's read-only tools allow.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface FrankTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  description?: string;
  additionalProperties?: boolean | JsonSchema;
}

export interface ToolResult {
  isError: boolean;
  /** structuredContent when the tool returned it, else the text content. */
  data: unknown;
  /** Plain text from the result, e.g. an error message. */
  text: string;
}

let connecting: Promise<Client> | null = null;

function connect(): Promise<Client> {
  connecting ??= (async () => {
    const client = new Client({ name: 'frank-console', version: '0.1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', window.location.origin)));
    return client;
  })().catch((err: unknown) => {
    connecting = null; // let the next call retry
    throw err;
  });
  return connecting;
}

export async function listTools(): Promise<FrankTool[]> {
  const client = await connect();
  const { tools } = await client.listTools();
  return tools as FrankTool[];
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const client = await connect();
  const result = await client.callTool({ name, arguments: args });
  const text = ((result.content ?? []) as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
  let data: unknown = result.structuredContent;
  if (data === undefined) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { isError: result.isError === true, data, text };
}

/** Turn anything thrown while talking to Frank into one plain sentence. */
export function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)) {
    return "Can't reach Frank at /mcp. Is he running?";
  }
  return message;
}
