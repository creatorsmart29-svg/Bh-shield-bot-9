import { EmbedBuilder, version as discordJsVersion, type Client } from "discord.js";
import { logger } from "./logger";

export type OwnerStatusKind = "started" | "online" | "restarted" | "reconnected" | "disconnected" | "resumed" | "shutdown" | "error";

const STATUS_CONFIG: Record<OwnerStatusKind, { label: string; color: number; emoji: string }> = {
  started: { label: "Bot Started", color: 0x57f287, emoji: "🟢" },
  online: { label: "Bot Online", color: 0x57f287, emoji: "🟢" },
  restarted: { label: "Bot Restarted", color: 0xf1c40f, emoji: "🟡" },
  reconnected: { label: "Bot Reconnected", color: 0xe67e22, emoji: "🟠" },
  disconnected: { label: "Bot Disconnected", color: 0x2b2d31, emoji: "⚫" },
  resumed: { label: "Bot Resumed", color: 0x3498db, emoji: "🔵" },
  shutdown: { label: "Bot Shutting Down", color: 0x2b2d31, emoji: "⚫" },
  error: { label: "Unexpected Error", color: 0xed4245, emoji: "🔴" },
};

let activeNotifier: OwnerStatusNotifier | null = null;

export class OwnerStatusNotifier {
  private readonly queued: Array<{ kind: OwnerStatusKind; error?: unknown }> = [];
  private delivery: Promise<void> = Promise.resolve();
  private ready = false;
  private lastCpu = process.cpuUsage();
  private lastCpuAt = Date.now();

  constructor(private readonly client: Client, private readonly ownerId: string, private readonly botVersion: string) {}

  markReady(): void {
    this.ready = true;
    const pending = this.queued.splice(0);
    for (const item of pending) void this.notify(item.kind, item.error);
  }

  notify(kind: OwnerStatusKind, error?: unknown): Promise<void> {
    if (!this.ready && (kind === "started" || kind === "restarted" || kind === "online")) {
      this.queued.push({ kind, error });
      return Promise.resolve();
    }
    const task = this.delivery.then(() => this.send(kind, error), () => this.send(kind, error));
    this.delivery = task.then(() => undefined, () => undefined);
    return task;
  }

  private async send(kind: OwnerStatusKind, error?: unknown): Promise<void> {
    try {
      const owner = await this.client.users.fetch(this.ownerId);
      const config = STATUS_CONFIG[kind];
      const cpu = process.cpuUsage(this.lastCpu);
      const elapsedMs = Math.max(1, Date.now() - this.lastCpuAt);
      this.lastCpu = process.cpuUsage();
      this.lastCpuAt = Date.now();
      const cpuPercent = Math.min(999, ((cpu.user + cpu.system) / 1_000 / elapsedMs) * 100);
      const memory = process.memoryUsage();
      const guildCount = this.client.guilds.cache.size;
      const userCount = this.client.guilds.cache.reduce((total, guild) => total + guild.memberCount, 0);
      const railway = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || (process.env.RAILWAY_PROJECT_ID ? "Railway" : "Not detected");
      const embed = new EmbedBuilder()
        .setColor(config.color)
        .setTitle(`${config.emoji} ${config.label}`)
        .setDescription(kind === "error" ? "BH SHIELD detected an unexpected runtime failure." : "BH SHIELD owner status notification.")
        .addFields(
          { name: "Status", value: config.label, inline: true },
          { name: "Date & time", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
          { name: "Uptime", value: formatDuration(process.uptime()), inline: true },
          { name: "Ping", value: `${this.client.ws.ping >= 0 ? this.client.ws.ping : "N/A"}ms`, inline: true },
          { name: "Memory", value: `${Math.round(memory.rss / 1024 / 1024)}MB RSS`, inline: true },
          { name: "CPU", value: `${cpuPercent.toFixed(1)}%`, inline: true },
          { name: "Guilds / users", value: `${guildCount} / ${userCount}`, inline: true },
          { name: "Node.js", value: process.version, inline: true },
          { name: "discord.js", value: discordJsVersion, inline: true },
          { name: "Railway", value: railway, inline: true },
          { name: "Bot version", value: this.botVersion, inline: true },
          ...(error ? [{ name: "Error details", value: errorText(error).slice(0, 1024), inline: false }] : []),
        )
        .setFooter({ text: "BH SHIELD · owner monitoring" })
        .setTimestamp();
      await owner.send({ embeds: [embed] });
    } catch (deliveryError) {
      logger.warn({ error: errorText(deliveryError), status: kind }, "Owner status notification could not be delivered");
    }
  }
}

export function configureOwnerStatusNotifier(notifier: OwnerStatusNotifier): void {
  activeNotifier = notifier;
}

export function notifyOwnerStatus(kind: OwnerStatusKind, error?: unknown): Promise<void> {
  return activeNotifier?.notify(kind, error) ?? Promise.resolve();
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const secs = total % 60;
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}