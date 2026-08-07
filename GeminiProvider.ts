import type { AICompletion, AIMessage, AIProvider, AIProviderOptions } from "./types";
import { AIProviderError } from "./types";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string, private readonly options: AIProviderOptions) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async complete(messages: AIMessage[]): Promise<AICompletion> {
    const system = messages.find((message) => message.role === "system")?.content;
    const contents = messages.filter((message) => message.role !== "system").map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const baseUrl = this.options.baseUrl ?? process.env.AI_GEMINI_BASE_URL;
      if (!baseUrl) throw new AIProviderError("Gemini base URL is not configured. Set AI_GEMINI_BASE_URL.", { provider: this.name, code: "missing_base_url" });
      const url = `${baseUrl.replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { maxOutputTokens: this.options.maxTokens, temperature: this.options.temperature } }),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
        error?: { message?: string };
      };
      if (!response.ok) throw new AIProviderError(body.error?.message ?? `Gemini returned HTTP ${response.status}.`, { provider: this.name, status: response.status, retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500 });
      return {
        content: body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "",
        usage: body.usageMetadata ? { promptTokens: body.usageMetadata.promptTokenCount, completionTokens: body.usageMetadata.candidatesTokenCount, totalTokens: body.usageMetadata.totalTokenCount } : undefined,
      };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(error instanceof Error ? error.message : "The Gemini provider request failed.", { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }
}