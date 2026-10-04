import { describe, expect, it, vi } from 'vitest';

import { api } from './api';

describe('MCP gateway API', () => {
  it('lists sanitized MCP servers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          servers: [
            {
              id: 'github',
              transport: 'stdio',
              enabled: true,
              permission: 'read',
              configured: true,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.listMCPServers()).resolves.toEqual([
      {
        id: 'github',
        transport: 'stdio',
        enabled: true,
        permission: 'read',
        configured: true,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/mcp/servers',
    );
  });

  it('calls an MCP tool through the gateway', async () => {
    const response = {
      tool: 'deterministic.deterministic_echo',
      is_error: false,
      content: [{ type: 'text', text: 'deterministic:hello' }],
      structured_content: null,
      arguments_sha256: 'a'.repeat(64),
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api.callMCPTool({
        tool: 'deterministic__deterministic_echo',
        arguments: { value: 'hello' },
      }),
    ).resolves.toEqual(response);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/mcp/call',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('parses streamed agent SSE events', async () => {
    const body = [
      'data: {"type":"content_delta","text":"hello","turn":1}\n\n',
      'data: {"type":"done","turns":1,"response":{"choices":[]}}\n\n',
    ].join('');

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const events = [];
    for await (const event of api.agentStream({
      model: 'test-model',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: 'content_delta', text: 'hello', turn: 1 },
      { type: 'done', turns: 1, response: { choices: [] } },
    ]);
  });
});
