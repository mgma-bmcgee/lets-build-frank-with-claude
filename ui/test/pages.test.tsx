import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/mcp')>();
  return { ...actual, listTools: vi.fn(), callTool: vi.fn() };
});

import { callTool, type FrankTool, listTools } from '../src/mcp';
import { OverviewPage } from '../src/pages/Overview';
import { ToolsPage } from '../src/pages/Tools';

const status = {
  summary: 'Frank 0.1.0 is up (65s).',
  name: 'frank',
  version: '0.1.0',
  startedAt: '2026-09-23T21:33:48.056Z',
  uptimeSeconds: 65,
  greeting: "Hi, I'm Frank. I can look, but I don't touch.",
};

const tools: FrankTool[] = [
  {
    name: 'get_status',
    description: "Returns Frank's version, uptime and a greeting.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'search_things',
    description: 'Searches things.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: { query: { type: 'string', description: 'What to look for' } },
    },
  },
];

beforeEach(() => {
  vi.mocked(listTools).mockResolvedValue(tools);
  vi.mocked(callTool).mockResolvedValue({ isError: false, data: status, text: JSON.stringify(status) });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Overview', () => {
  it("shows get_status output and a healthy connection", async () => {
    render(<OverviewPage onError={vi.fn()} />);
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('1m 5s')).toBeTruthy();
    expect(screen.getByText(status.greeting)).toBeTruthy();
    expect(callTool).toHaveBeenCalledWith('get_status', {});
  });

  it('reports an unreachable Frank', async () => {
    vi.mocked(callTool).mockRejectedValue(new TypeError('Failed to fetch'));
    const onError = vi.fn();
    render(<OverviewPage onError={onError} />);
    expect(await screen.findByText('Unreachable')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith("Can't reach Frank at /mcp. Is he running?");
  });
});

describe('Tools', () => {
  it('lists discovered tools and invokes a parameterless one', async () => {
    render(<ToolsPage onError={vi.fn()} />);
    expect(await screen.findByText('search_things')).toBeTruthy();
    expect(screen.getByText('This tool takes no parameters.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    await waitFor(() => expect(callTool).toHaveBeenCalledWith('get_status', {}));
    const result = await screen.findByTestId('tool-result');
    expect(result.textContent).toContain('"version": "0.1.0"');
  });

  it('renders a form from the input schema and validates required fields', async () => {
    render(<ToolsPage onError={vi.fn()} />);
    const row = (await screen.findByText('search_things')).closest('tr')!;
    fireEvent.click(within(row).getByRole('radio'));

    expect(await screen.findByText('What to look for')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    expect(await screen.findByText('Required.')).toBeTruthy();
    expect(callTool).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'frank' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    await waitFor(() => expect(callTool).toHaveBeenCalledWith('search_things', { query: 'frank' }));
  });

  it('shows a tool error as an alert, not a result', async () => {
    vi.mocked(callTool).mockResolvedValue({ isError: true, data: 'nope', text: 'Azure is not configured.' });
    render(<ToolsPage onError={vi.fn()} />);
    await screen.findByText('search_things');
    fireEvent.click(screen.getByRole('button', { name: 'Invoke' }));
    expect(await screen.findByText('Azure is not configured.')).toBeTruthy();
    expect(screen.queryByTestId('tool-result')).toBeNull();
  });
});
