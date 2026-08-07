import type { AICompletion, AIMessage, AIProvider, AIProviderOptions } from "./types";
import { AIProviderError } from "./types";

export class ClaudeProvider implements AIProvider {
  readonly name = "claude";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string, private readonly options: AIProviderOptions) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(messages: AIMessage[]): Promise<AICompletion> {
    const system = messages.find((message) => message.role === "system")?.content;
    const conversation = messages.filter((message) => message.role !== "system").map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const baseUrl = this.options.baseUrl ?? process.env.AI_CLAUDE_BASE_URL;
      if (!baseUrl) throw new AIProviderError("Claude base URL is not configured. Set AI_CLAUDE_BASE_URL.", { provider: this.name, code: "missing_base_url" });
      const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model: this.model, max_tokens: this.options.maxTokens, system, messages: conversation }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as {
        content?: Array<{ type?: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new AIProviderError(body.error?.message ?? `Claude returned HTTP ${response.status}.`, { provider: this.name, status: response.status, retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500 });
      const promptTokens = body.usage?.input_tokens;
      const completionTokens = body.usage?.output_tokens;
      return {
        content: body.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("").trim() ?? "",
        usage: promptTokens === undefined && completionTokens === undefined ? undefined : { promptTokens, completionTokens, totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0) },
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(error instanceof Error ? error.message : "The Claude provider request failed.", { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }
}