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

  it('lists sanitized MCP tool metadata', async () => {
    const tools = [
      {
        server_id: 'deterministic',
        name: 'deterministic_echo',
        qualified_name: 'deterministic.deterministic_echo',
        model_name: 'deterministic__deterministic_echo',
        description: 'Echo a value.',
        read_only: true,
        destructive: false,
        idempotent: true,
        open_world: false,
        permission: 'read',
        requires_approval: false,
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tools }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.listMCPTools()).resolves.toEqual(tools);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/mcp/tools',
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

  it('parses a final SSE frame without a trailing newline', async () => {
    const body = 'data: {"type":"done","turns":2,"response":{"choices":[]}}';

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
      { type: 'done', turns: 2, response: { choices: [] } },
    ]);
  });

  it('passes the AbortSignal to the agent stream request', async () => {
    const body = 'data: {"type":"done","turns":1,"response":{"choices":[]}}\n\n';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    for await (const _event of api.agentStream(
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
      },
      controller.signal,
    )) {
      break;
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/agent',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
      }),
    );
  });
});
