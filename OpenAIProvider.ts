import OpenAI from "openai";
import type { AICompletion, AIMessage, AIProvider, AIProviderOptions } from "./types";
import { AIProviderError } from "./types";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string, options: AIProviderOptions) {
    this.client = new OpenAI({ apiKey, timeout: options.timeoutMs, maxRetries: 0, ...(options.baseUrl ? { baseURL: options.baseUrl } : {}) });
    this.model = model;
    this.options = options;
  }
  private readonly options: AIProviderOptions;

  async complete(messages: AIMessage[]): Promise<AICompletion> {
    try {
      const modernModel = /^(gpt-5|o[134])(?:[-.]|$)/i.test(this.model);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        ...(modernModel
          ? { max_completion_tokens: this.options.maxTokens }
          : { max_tokens: this.options.maxTokens, temperature: this.options.temperature }),
      });
      return {
        content: response.choices[0]?.message.content?.trim() ?? "",
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error && typeof error.status === "number"
        ? error.status
        : undefined;
      const message = error instanceof Error ? error.message : "The OpenAI provider failed.";
      const code = typeof error === "object" && error && "code" in error && typeof error.code === "string" ? error.code : undefined;
      const retryable = status === 408 || status === 409 || (status === 429 && code !== "insufficient_quota") || Boolean(status && status >= 500);
      throw new AIProviderError(message, { provider: this.name, code, status, retryable });
    }
  }
}