import type { AICompletion, AIMessage, AIProvider, AIProviderOptions } from "./types";
import { AIProviderError } from "./types";

export class GroqProvider implements AIProvider {
  readonly name = "groq";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string, private readonly options: AIProviderOptions) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(messages: AIMessage[]): Promise<AICompletion> {
    const baseUrl = this.options.baseUrl ?? process.env.AI_GROQ_BASE_URL;
    if (!baseUrl) throw new AIProviderError("Groq base URL is not configured. Set AI_GROQ_BASE_URL.", { provider: this.name, code: "missing_base_url" });
    return completeOpenAICompatible(`${baseUrl.replace(/\/+$/, "")}/openai/v1/chat/completions`, this.apiKey, this.model, messages, this.options);
  }
}

async function completeOpenAICompatible(url: string, apiKey: string, model: string, messages: AIMessage[], options: AIProviderOptions): Promise<AICompletion> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: options.maxTokens, temperature: options.temperature }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      error?: { message?: string };
    };
    if (!response.ok) throw new AIProviderError(body.error?.message ?? `AI provider returned HTTP ${response.status}.`, { provider: "groq", status: response.status, retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500 });
    return {
      content: body.choices?.[0]?.message?.content?.trim() ?? "",
      usage: body.usage ? { promptTokens: body.usage.prompt_tokens, completionTokens: body.usage.completion_tokens, totalTokens: body.usage.total_tokens } : undefined,
    };
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError(error instanceof Error ? error.message : "The AI provider request failed.", { retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}