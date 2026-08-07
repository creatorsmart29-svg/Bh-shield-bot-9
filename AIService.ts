import { logger } from "../../lib/logger";
import { ClaudeProvider } from "./providers/ClaudeProvider";
import { GeminiProvider } from "./providers/GeminiProvider";
import { GroqProvider } from "./providers/GroqProvider";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import type { AICompletion, AIMessage, AIProvider } from "./providers/types";
import { AIProviderError } from "./providers/types";

const OWNER_AI_SYSTEM_PROMPT = [
  "You are BH SHIELD's private owner AI assistant, available only in the bot owner's direct messages.",
  "Have a natural, warm, intelligent conversation. Respond directly to what the owner said and adapt your tone: be friendly for greetings and casual conversation, and precise and structured for technical work.",
  "For greetings, thanks, goodbyes, and short casual messages, answer naturally and briefly instead of forcing a technical answer or repeating a generic script.",
  "Act as a professional assistant for JavaScript, TypeScript, Node.js, Discord.js, SQL, MongoDB, PostgreSQL, Railway, GitHub, Replit, APIs, security, performance, JSON, Markdown, prompt engineering, planning, documentation, debugging, and technical writing.",
  "Maintain continuity using the recent conversation. Ask a useful follow-up question only when the request is ambiguous or a next step would genuinely help.",
  "Give clear, accurate, maintainable answers. Explain important decisions step by step when useful, and provide complete code when requested. Use Markdown code fences for code.",
  "Never claim to be ChatGPT or pretend to be human staff. Do not claim to have run code, accessed files, or changed deployments unless that happened in the current conversation.",
  "Never reveal, repeat, guess, or transform API keys, tokens, passwords, cookies, private keys, or other secrets. If a user message contains a secret, refer to it only as [REDACTED SECRET].",
  "Do not overuse emojis, filler, disclaimers, or repetitive headings.",
].join(" ");

export class AIServiceError extends Error {
  readonly code: "not_configured" | "rate_limited" | "busy" | "provider";
  readonly provider?: string;
  readonly status?: number;

  constructor(code: AIServiceError["code"], message: string, details: { provider?: string; status?: number } = {}) {
    super(message);
    this.name = "AIServiceError";
    this.code = code;
    this.provider = details.provider;
    this.status = details.status;
  }
}

type ConversationMessage = AIMessage & { createdAt: number };

export type AIServiceResult = AICompletion & {
  provider: string;
  responseTimeMs: number;
};

export type AIServiceOptions = {
  maxRequestsPerMinute: number;
  maxMemoryMessages: number;
  memoryTtlMs: number;
  maxPendingRequests: number;
  providerTimeoutMs: number;
  maxTokens: number;
  temperature: number;
};

export class AIService {
  private readonly history = new Map<string, ConversationMessage[]>();
  private readonly requestTimes = new Map<string, number[]>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly provider: AIProvider,
    private readonly options: AIServiceOptions = {
      maxRequestsPerMinute: 10,
      maxMemoryMessages: 20,
      memoryTtlMs: 30 * 60_000,
      maxPendingRequests: 3,
      providerTimeoutMs: 30_000,
      maxTokens: 4_096,
      temperature: 0.7,
    },
  ) {}

  initialize(): void {
    this.cleanupTimer = setInterval(() => this.cleanAllState(), 5 * 60_000);
    this.cleanupTimer.unref?.();
  }

  get providerName(): string {
    return this.provider.name;
  }

  async complete(scopeId: string, prompt: string, systemPrompt = OWNER_AI_SYSTEM_PROMPT): Promise<AIServiceResult> {
    const cleanPrompt = prompt.trim().slice(0, 8_000);
    if (!cleanPrompt) throw new AIServiceError("provider", "Please send a text message for the AI assistant.");
    return this.completeConversation(scopeId, [
      { role: "system", content: systemPrompt },
      { role: "user", content: cleanPrompt },
    ]);
  }

  async completeConversation(scopeId: string, messages: AIMessage[]): Promise<AIServiceResult> {
    const cleanMessages = messages
      .filter((message) => message.content.trim())
      .map((message) => ({ ...message, content: redactSecretLikeText(message.content).slice(0, 8_000) }));
    if (!cleanMessages.some((message) => message.role === "user")) {
      throw new AIServiceError("provider", "Please send a text question for the AI assistant.");
    }
    this.cleanMemory(scopeId);
    this.checkRateLimit(scopeId);
    if (this.pending >= this.options.maxPendingRequests) {
      throw new AIServiceError("busy", "The AI assistant is processing other requests. Please try again in a moment.");
    }
    logger.info({ provider: this.provider.name, pending: this.pending, scope: scopeId.startsWith("owner:") ? "owner" : "server" }, "AI request started");
    this.pending += 1;
    const task = this.queue.then(() => this.run(scopeId, cleanMessages), () => this.run(scopeId, cleanMessages));
    this.queue = task.then(() => undefined, () => undefined);
    try {
      return await task;
    } finally {
      this.pending -= 1;
    }
  }

  private async run(scopeId: string, inputMessages: AIMessage[]): Promise<AIServiceResult> {
    const startedAt = Date.now();
    const conversation = this.history.get(scopeId) ?? [];
    const systemMessage = inputMessages.find((message) => message.role === "system");
    const newMessages = inputMessages.filter((message) => message.role !== "system");
    const messages: AIMessage[] = [
      ...(systemMessage ? [systemMessage] : []),
      ...conversation.map(({ role, content }) => ({ role, content })),
      ...newMessages,
    ];
    let completion: AICompletion | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        completion = await withTimeout(
          this.provider.complete(messages),
          this.options.providerTimeoutMs,
          "The AI provider took too long to respond.",
        );
        break;
      } catch (error) {
        lastError = error;
        if (!(error instanceof AIProviderError) || !error.retryable || attempt === 1) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!completion) {
      const providerError = lastError instanceof AIProviderError ? lastError : undefined;
      const exactMessage = lastError instanceof Error ? lastError.message : "Unknown provider error.";
      const safeMessage = exactMessage.replace(/(?:api[_ -]?key|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
      logger.error({
        provider: this.provider.name,
        status: providerError?.status,
        code: providerError?.code,
        error: exactMessage,
        responseTimeMs: Date.now() - startedAt,
      }, "AI request failed");
      const statusText = providerError?.status ? ` (HTTP ${providerError.status})` : "";
      throw new AIServiceError(
        providerError?.status === 429 ? "rate_limited" : "provider",
        `${this.provider.name}${statusText}: ${safeMessage}`,
        { provider: this.provider.name, status: providerError?.status },
      );
    }
    const content = completion.content.trim().slice(0, 7_500) || "The AI provider returned an empty response.";
    const nextHistory = [
      ...conversation,
      ...newMessages.map((message) => ({ ...message, createdAt: Date.now() })),
      { role: "assistant" as const, content, createdAt: Date.now() },
    ].slice(-this.options.maxMemoryMessages);
    this.history.set(scopeId, nextHistory);
    const responseTimeMs = Date.now() - startedAt;
    logger.info({ provider: this.provider.name, responseTimeMs, totalTokens: completion.usage?.totalTokens }, "AI request completed");
    return { ...completion, content, provider: this.provider.name, responseTimeMs };
  }

  private checkRateLimit(ownerId: string): void {
    const now = Date.now();
    const recent = (this.requestTimes.get(ownerId) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= this.options.maxRequestsPerMinute) throw new AIServiceError("rate_limited", "Owner AI rate limit reached. Please wait a little before sending another request.");
    recent.push(now);
    this.requestTimes.set(ownerId, recent);
  }

  private cleanMemory(ownerId: string): void {
    const cutoff = Date.now() - this.options.memoryTtlMs;
    const history = (this.history.get(ownerId) ?? []).filter((message) => message.createdAt > cutoff).slice(-this.options.maxMemoryMessages);
    if (history.length) this.history.set(ownerId, history);
    else this.history.delete(ownerId);
  }

  private cleanAllState(): void {
    const cutoff = Date.now() - this.options.memoryTtlMs;
    for (const [ownerId, history] of this.history) {
      const active = history.filter((message) => message.createdAt > cutoff).slice(-this.options.maxMemoryMessages);
      if (active.length) this.history.set(ownerId, active);
      else this.history.delete(ownerId);
    }
    const now = Date.now();
    for (const [ownerId, requestTimes] of this.requestTimes) {
      const active = requestTimes.filter((time) => now - time < 60_000);
      if (active.length) this.requestTimes.set(ownerId, active);
      else this.requestTimes.delete(ownerId);
    }
  }
}

export function createConfiguredAIService(): AIService | null {
  const providerName = (process.env.AI_PROVIDER?.trim().toLowerCase() || (process.env.OPENAI_API_KEY ? "openai" : "")).trim();
  const apiKey = process.env.AI_API_KEY?.trim() || (providerName === "openai" ? process.env.OPENAI_API_KEY?.trim() : undefined);
  if (!providerName || !apiKey) return null;
  const model = process.env.AI_MODEL?.trim() || (providerName === "openai" ? "gpt-4o-mini" : providerName === "gemini" ? "gemini-2.0-flash" : providerName === "claude" ? "claude-3-5-sonnet-latest" : "llama-3.3-70b-versatile");
  const maxRequestsPerMinute = Math.max(1, Math.min(60, Number(process.env.AI_MAX_REQUESTS_PER_MINUTE) || 10));
  const maxPendingRequests = Math.max(1, Math.min(10, Number(process.env.AI_MAX_PENDING_REQUESTS) || 3));
  const providerTimeoutMs = Math.max(10_000, Math.min(120_000, readNumberEnv(["AI_TIMEOUT", "AI_TIMEOUT_MS"], 30_000)));
  const maxMemoryMessages = Math.max(4, Math.min(40, readNumberEnv(["AI_MAX_HISTORY"], 20)));
  const maxTokens = Math.max(256, Math.min(16_384, readNumberEnv(["AI_MAX_TOKENS"], 4_096)));
  const temperature = Math.max(0, Math.min(2, readNumberEnv(["AI_TEMPERATURE"], 0.7)));
  const options: AIServiceOptions = {
    maxRequestsPerMinute,
    maxMemoryMessages,
    memoryTtlMs: 30 * 60_000,
    maxPendingRequests,
    providerTimeoutMs,
    maxTokens,
    temperature,
  };
  const providerOptions = {
    timeoutMs: providerTimeoutMs,
    maxTokens,
    temperature,
    baseUrl: process.env.AI_BASE_URL?.trim() || undefined,
  };
  if (providerName === "openai") return createService(new OpenAIProvider(apiKey, model, { ...providerOptions, baseUrl: process.env.AI_OPENAI_BASE_URL?.trim() || providerOptions.baseUrl }), options);
  if (providerName === "gemini") return createService(new GeminiProvider(apiKey, model, { ...providerOptions, baseUrl: process.env.AI_GEMINI_BASE_URL?.trim() || providerOptions.baseUrl }), options);
  if (providerName === "claude") return createService(new ClaudeProvider(apiKey, model, { ...providerOptions, baseUrl: process.env.AI_CLAUDE_BASE_URL?.trim() || providerOptions.baseUrl }), options);
  if (providerName === "groq") return createService(new GroqProvider(apiKey, model, { ...providerOptions, baseUrl: process.env.AI_GROQ_BASE_URL?.trim() || providerOptions.baseUrl }), options);
  logger.warn({ provider: providerName }, "Owner AI provider is not supported");
  return null;
}

export const createOwnerAIService = createConfiguredAIService;

function readNumberEnv(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name]?.trim();
    if (!raw) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function createService(provider: AIProvider, options: AIServiceOptions): AIService {
  const service = new AIService(provider, options);
  service.initialize();
  return service;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new AIProviderError(message, { retryable: true })), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function redactSecretLikeText(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED SECRET]")
    .replace(/\b(?:AIza|ghp_|github_pat_)[A-Za-z0-9_-]{20,}\b/g, "[REDACTED SECRET]")
    .replace(/(token|api[_ -]?key|password|secret|private[_ -]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED SECRET]");
}