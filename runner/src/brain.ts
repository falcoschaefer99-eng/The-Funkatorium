import type Anthropic from "@anthropic-ai/sdk";

// MCP tool definition shape returned by the brain
interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// MCP JSON-RPC response shape
interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string };
}

interface ToolsListResult {
  tools: McpTool[];
}

interface ToolCallResult {
  content: Array<{ type: string; text: string }>;
}

export class BrainClient {
  private url: string;
  private apiKey: string;
  private tenant: string;
  private requestId = 0;

  constructor(url: string, apiKey: string, tenant: string) {
    this.url = url;
    this.apiKey = apiKey;
    this.tenant = tenant;
  }

  private async post<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = ++this.requestId;
    const body: Record<string, unknown> = { jsonrpc: "2.0", method, params, id };

    let response: Response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
          "X-Brain-Tenant": this.tenant,
        },
        body: JSON.stringify(body),
        // Node 22 fetch supports signal for timeout
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Brain network error: ${msg}`);
    }

    if (response.status === 401) throw new Error("Brain auth failed — check BRAIN_API_KEY");
    if (response.status === 429) throw new Error("Brain rate limited");
    if (!response.ok) throw new Error(`Brain HTTP ${response.status}: ${response.statusText}`);

    const json = (await response.json()) as JsonRpcResponse<T>;

    if (json.error) {
      throw new Error(`Brain RPC error ${json.error.code}: ${json.error.message}`);
    }

    if (json.result === undefined) {
      throw new Error("Brain returned empty result");
    }

    return json.result;
  }

  // Fetch tools from brain and convert MCP inputSchema → Anthropic input_schema
  async listTools(): Promise<Anthropic.Tool[]> {
    const result = await this.post<ToolsListResult>("tools/list", {});

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: (tool.inputSchema ?? { type: "object", properties: {} }) as Anthropic.Tool["input_schema"],
    }));
  }

  // Proxy a tool call to the brain, returns the text content of the result
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.post<ToolCallResult>("tools/call", {
      name,
      arguments: args,
    });

    // Concatenate all text blocks from the MCP content array
    return result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }

  async callToolJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const raw = await this.callTool(name, args);

    try {
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Tool ${name} returned non-JSON content: ${reason}`);
    }
  }
}
