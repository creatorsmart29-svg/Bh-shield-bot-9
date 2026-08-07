import {
  EmbedBuilder,
  version as discordJsVersion,
  type Client,
  type User,
} from "discord.js";
import { eq } from "drizzle-orm";
import {
  db,
  ownerDmLogSettingsTable,
  type OwnerDMLogCategories,
  type OwnerDMLogCategory,
  type OwnerDMLogRecord,
} from "@workspace/db";
import { logger } from "./logger";

const SETTINGS_ID = "global";
const MAX_QUEUE_SIZE = 250;
const BATCH_SIZE = 8;
const RETRY_DELAY_MS = 30_000;
const SEND_INTERVAL_MS = 1_500;
const BOT_VERSION = "1.0.31";

const CATEGORY_CONFIG: Record<OwnerDMLogCategory, { label: string; color: number; emoji: string }> = {
  startup: { label: "Startup Logs", color: 0x57f287, emoji: "🟢" },
  error: { label: "Error Logs", color: 0xed4245, emoji: "🔴" },
  command: { label: "Command Logs", color: 0xf1c40f, emoji: "🟡" },
  moderation: { label: "Moderation Logs", color: 0x3498db, emoji: "🔵" },
  ticket: { label: "Ticket Logs", color: 0x9b59b6, emoji: "🟣" },
  ai: { label: "AI Logs", color: 0xe67e22, emoji: "🟠" },
  database: { label: "Database Logs", color: 0xf1f1f1, emoji: "⚪" },
  guild: { label: "Guild Logs", color: 0x8b5a2b, emoji: "🟤" },
  voice: { label: "Voice Logs", color: 0x00b0f4, emoji: "🔷" },
  security: { label: "Security Logs", color: 0x2b2d31, emoji: "⚫" },
};

const DEFAULT_CATEGORIES: OwnerDMLogCategories = {
  startup: true,
  error: true,
  command: true,
  moderation: true,
  ticket: true,
  ai: true,
  database: true,
  guild: true,
  voice: true,
  security: true,
};

let activeLogger: OwnerDMLogger | null = null;

export class OwnerDMLogger {
  private settings: Awaited<ReturnType<typeof loadSettings>> | null = null;
  private loadPromise: Promise<void> | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private nextSendAt = 0;

  constructor(
    private readonly client: Client,
    private readonly ownerId: string,
    private readonly botVersion = BOT_VERSION,
  ) {}

  async initialize(): Promise<void> {
    await this.ensureLoaded();
    void this.flush();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.ensureLoaded();
    if (!this.settings) return;
    this.settings.enabled = enabled;
    await this.persist();
    if (enabled) this.scheduleFlush(0);
  }

  async status(): Promise<{ enabled: boolean; queueSize: number; categories: OwnerDMLogCategories; lastSentAt: Date | null }> {
    await this.ensureLoaded();
    return {
      enabled: Boolean(this.settings?.enabled),
      queueSize: this.settings?.queue.length ?? 0,
      categories: { ...DEFAULT_CATEGORIES, ...(this.settings?.categories ?? {}) },
      lastSentAt: this.settings?.lastSentAt ?? null,
    };
  }

  async test(): Promise<void> {
    const record: OwnerDMLogRecord = {
      category: "startup",
      event: "Owner DM logging test",
      details: "The BH SHIELD live owner DM logging system is reachable.",
      createdAt: new Date().toISOString(),
    };
    await this.sendRecords([record]);
  }

  async log(input: Omit<OwnerDMLogRecord, "createdAt"> & { createdAt?: string }): Promise<void> {
    try {
      await this.ensureLoaded();
      if (!this.settings?.enabled || !this.settings.categories[input.category]) return;
      this.settings.queue.push({
        ...input,
        createdAt: input.createdAt ?? new Date().toISOString(),
      });
      if (this.settings.queue.length > MAX_QUEUE_SIZE) {
        this.settings.queue.splice(0, this.settings.queue.length - MAX_QUEUE_SIZE);
      }
      await this.persist();
      this.scheduleFlush();
    } catch (error) {
      logger.warn({ error: safeError(error), category: input.category }, "BH SHIELD owner DM log queue failed");
    }
  }

  private scheduleFlush(delay = SEND_INTERVAL_MS): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, Math.max(0, delay));
  }

  private async flush(): Promise<void> {
    if (this.flushing || !this.settings?.enabled || !this.settings.queue.length) return;
    const wait = this.nextSendAt - Date.now();
    if (wait > 0) {
      this.scheduleFlush(wait);
      return;
    }
    this.flushing = true;
    const records = this.settings.queue.splice(0, BATCH_SIZE);
    try {
      await this.persist();
      await this.sendRecords(records);
      this.nextSendAt = Date.now() + SEND_INTERVAL_MS;
      this.settings.lastSentAt = new Date();
      await this.persist().catch((error) => {
        logger.warn({ error: safeError(error) }, "BH SHIELD owner DM log delivery timestamp could not be persisted");
      });
    } catch (error) {
      this.settings.queue.unshift(...records);
      if (this.settings.queue.length > MAX_QUEUE_SIZE) this.settings.queue.splice(MAX_QUEUE_SIZE);
      await this.persist().catch(() => undefined);
      logger.warn({ error: safeError(error), queued: this.settings.queue.length }, "BH SHIELD owner DM log delivery failed; retrying");
      this.scheduleFlush(RETRY_DELAY_MS);
    } finally {
      this.flushing = false;
      if (this.settings.queue.length) this.scheduleFlush();
    }
  }

  private async sendRecords(records: OwnerDMLogRecord[]): Promise<void> {
    const owner = await this.client.users.fetch(this.ownerId);
    const embeds = records.map((record) => toEmbed(record, this.botVersion, this.client));
    await owner.send({ embeds });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.settings) return;
    if (!this.loadPromise) {
      this.loadPromise = loadSettings().then((settings) => {
        this.settings = settings;
      }).finally(() => {
        this.loadPromise = null;
      });
    }
    await this.loadPromise;
  }

  private async persist(): Promise<void> {
    if (!this.settings) return;
    await db.update(ownerDmLogSettingsTable).set({
      enabled: this.settings.enabled,
      categories: this.settings.categories,
      queue: this.settings.queue,
      lastSentAt: this.settings.lastSentAt,
    }).where(eq(ownerDmLogSettingsTable.id, SETTINGS_ID));
  }
}

async function loadSettings() {
  const [existing] = await db.select().from(ownerDmLogSettingsTable).where(eq(ownerDmLogSettingsTable.id, SETTINGS_ID)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(ownerDmLogSettingsTable).values({
    id: SETTINGS_ID,
    categories: DEFAULT_CATEGORIES,
    queue: [],
  }).onConflictDoNothing({ target: ownerDmLogSettingsTable.id }).returning();
  if (created) return created;
  const [afterRace] = await db.select().from(ownerDmLogSettingsTable).where(eq(ownerDmLogSettingsTable.id, SETTINGS_ID)).limit(1);
  if (!afterRace) throw new Error("Owner DM log settings could not be initialized.");
  return afterRace;
}

function toEmbed(record: OwnerDMLogRecord, botVersion: string, client: Client): EmbedBuilder {
  const config = CATEGORY_CONFIG[record.category];
  return new EmbedBuilder()
    .setColor(config.color)
    .setTitle(`${config.emoji} ${config.label} · ${record.event}`.slice(0, 256))
    .addFields(
      { name: "Category", value: config.label, inline: true },
      { name: "Event", value: record.event.slice(0, 1024), inline: true },
      { name: "Time", value: `<t:${Math.floor(new Date(record.createdAt).getTime() / 1000)}:F>`, inline: true },
      { name: "Guild", value: record.guild ?? "Not applicable", inline: true },
      { name: "Channel", value: record.channel ?? "Not applicable", inline: true },
      ...(record.user ? [{ name: "User", value: record.user, inline: true }] : []),
      ...(record.command ? [{ name: "Command", value: record.command, inline: true }] : []),
      ...(record.details ? [{ name: "Details", value: record.details.slice(0, 1024), inline: false }] : []),
      ...(record.error ? [{ name: "Error details", value: record.error.slice(0, 1024), inline: false }] : []),
      { name: "Bot health", value: `Uptime: ${formatDuration(process.uptime())}\nPing: ${client.ws.ping >= 0 ? `${client.ws.ping}ms` : "N/A"}\nNode: ${process.version}\ndiscord.js: ${discordJsVersion}\nVersion: ${botVersion}`, inline: false },
    )
    .setFooter({ text: "BH SHIELD · private owner DM logging" })
    .setTimestamp(new Date(record.createdAt));
}

export function configureOwnerDMLogger(value: OwnerDMLogger): void {
  activeLogger = value;
  void value.initialize().catch((error) => logger.warn({ error: safeError(error) }, "BH SHIELD owner DM logger initialization failed"));
}

export function notifyOwnerDMLog(input: Omit<OwnerDMLogRecord, "createdAt"> & { createdAt?: string }): void {
  void activeLogger?.log(input);
}

export async function handleOwnerDMLogsCommand(message: MessageLike, args: string[]): Promise<boolean> {
  const loggerInstance = activeLogger;
  if (!loggerInstance) {
    await message.reply("Owner DM logging is not available until the bot is online.");
    return true;
  }
  if (message.authorId !== process.env.OWNER_ID?.trim()) {
    notifyOwnerDMLog({
      category: "security",
      event: "Unauthorized owner DM logging command attempt",
      user: message.userMention,
      command: `&dmlogs ${args.join(" ")}`.trim(),
      guild: message.guildName,
      channel: message.channelName,
    });
    await message.reply("Only the configured bot owner can control live DM logs.");
    return true;
  }
  const action = args.shift()?.toLowerCase();
  if (action === "on" || action === "off") {
    await loggerInstance.setEnabled(action === "on");
    await message.reply(`Live owner DM logging is now **${action === "on" ? "enabled" : "disabled"}**.`);
    return true;
  }
  if (action === "test") {
    await loggerInstance.test();
    await message.reply("A test log embed was sent to your owner DM.");
    return true;
  }
  if (action === "status") {
    const status = await loggerInstance.status();
    await message.reply({
      embeds: [new EmbedBuilder()
        .setColor(status.enabled ? 0x57f287 : 0xed4245)
        .setTitle("📡 BH SHIELD Owner DM Logs")
        .addFields(
          { name: "Status", value: status.enabled ? "Enabled" : "Disabled", inline: true },
          { name: "Queued logs", value: String(status.queueSize), inline: true },
          { name: "Last sent", value: status.lastSentAt ? `<t:${Math.floor(status.lastSentAt.getTime() / 1000)}:R>` : "Never", inline: true },
          { name: "Categories", value: Object.entries(status.categories).filter(([, enabled]) => enabled).map(([category]) => CATEGORY_CONFIG[category as OwnerDMLogCategory].label).join(", ") || "None", inline: false },
        )
        .setTimestamp()],
    });
    return true;
  }
  await message.reply("Usage: `&dmlogs on`, `&dmlogs off`, `&dmlogs status`, or `&dmlogs test`.");
  return true;
}

export type MessageLike = {
  authorId: string;
  userMention: string;
  guildName?: string;
  channelName?: string;
  reply: (content: string | { embeds: EmbedBuilder[] }) => Promise<unknown>;
};

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 86_400)}d ${Math.floor((total % 86_400) / 3_600)}h ${Math.floor((total % 3_600) / 60)}m ${total % 60}s`;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}