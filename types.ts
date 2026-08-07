export type AIMessageRole = "system" | "user" | "assistant";

export type AIMessage = {
  role: AIMessageRole;
  content: string;
};

export type AIUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type AICompletion = {
  content: string;
  usage?: AIUsage;
};

export type AIProviderOptions = {
  timeoutMs: number;
  maxTokens: number;
  temperature: number;
  baseUrl?: string;
};

export interface AIProvider {
  readonly name: string;
  complete(messages: AIMessage[]): Promise<AICompletion>;
}

export class AIProviderError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly provider?: string;
  readonly code?: string;

  constructor(message: string, options: { retryable?: boolean; status?: number; provider?: string; code?: string } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.provider = options.provider;
    this.code = options.code;
  }
}