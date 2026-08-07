import type { Message } from "discord.js";
import { eq } from "drizzle-orm";
import { db, noPrefixAccessTable, type GuildSettings } from "@workspace/db";
import { logger } from "./logger";
import { isRegisteredCommand } from "./command-registry";

export const DEFAULT_PREFIX = "&";
export const MAX_PREFIX_LENGTH = 5;
type PrefixSettings = Pick<GuildSettings, "prefix">;

export type CommandInvocation = {
  command: string;
  args: string[];
  usedPrefix: string | null;
  noPrefix: boolean;
};

export function parseCommandInvocation(
  content: string,
  settings: PrefixSettings,
  hasNoPrefixAccess: boolean,
): CommandInvocation | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const prefix = settings.prefix || DEFAULT_PREFIX;
  if (trimmed.startsWith(prefix)) {
    return toInvocation(trimmed.slice(prefix.length), prefix, false);
  }
  if (hasNoPrefixAccess) {
    return toInvocation(trimmed, null, true);
  }
  return null;
}

export async function hasNoPrefixAccess(userId: string, ownerId?: string): Promise<boolean> {
  if (ownerId && userId === ownerId) return true;
  const [access] = await db.select({ userId: noPrefixAccessTable.userId })
    .from(noPrefixAccessTable)
    .where(eq(noPrefixAccessTable.userId, userId))
    .limit(1);
  return Boolean(access);
}

export async function grantNoPrefixAccess(userId: string, grantedById: string): Promise<void> {
  await db.insert(noPrefixAccessTable)
    .values({ userId, grantedById })
    .onConflictDoUpdate({ target: noPrefixAccessTable.userId, set: { grantedById } });
}

export async function revokeNoPrefixAccess(userId: string, permanentOwnerId?: string): Promise<void> {
  if (permanentOwnerId && userId === permanentOwnerId) return;
  await db.delete(noPrefixAccessTable).where(eq(noPrefixAccessTable.userId, userId));
}

export async function listNoPrefixAccess(permanentOwnerId?: string): Promise<string[]> {
  const rows = await db.select({ userId: noPrefixAccessTable.userId }).from(noPrefixAccessTable);
  return [...new Set([...(permanentOwnerId ? [permanentOwnerId] : []), ...rows.map((row) => row.userId)])];
}

export function validatePrefix(value: string): string | null {
  const prefix = value.trim();
  if (!prefix) return "Prefix cannot be empty.";
  if (prefix.length > MAX_PREFIX_LENGTH) return `Prefix must be ${MAX_PREFIX_LENGTH} characters or fewer.`;
  if (/\s/.test(prefix)) return "Prefix cannot contain spaces or line breaks.";
  if (prefix.includes("`") || prefix.includes("@everyone") || prefix.includes("@here")) return "That prefix cannot be used.";
  return null;
}

export async function proxyOwnerMessage(message: Message, ghostMode: boolean, ownerId: string | undefined, settings: PrefixSettings): Promise<boolean> {
  if (!ghostMode || !ownerId || message.author.id !== ownerId || message.author.bot || message.system || !message.guild) return false;
  const invocation = parseCommandInvocation(message.content, settings, true);
  if (invocation && (invocation.usedPrefix !== null || isRegisteredCommand(invocation.command))) return false;
  if (!message.content.trim() && !message.attachments.size && !message.stickers.size) return false;
  if (!message.channel.isTextBased() || !("send" in message.channel)) return false;

  const files = message.attachments.map((attachment) => ({
    attachment: attachment.url,
    name: attachment.name ?? "attachment",
  }));
  const stickers = message.stickers.map((sticker) => sticker.id);
  const replyTarget = message.reference?.messageId
    ? { messageReference: message.reference.messageId, failIfNotExists: false }
    : undefined;

  try {
    await message.delete();
    await message.channel.send({
      content: message.content,
      files,
      stickers,
      allowedMentions: { parse: ["users", "roles", "everyone"] },
      ...(replyTarget ? { reply: replyTarget } : {}),
    });
    return true;
  } catch (error) {
    logger.warn({ error: errorText(error), guildId: message.guild.id, channelId: message.channel.id }, "BH SHIELD Ghost Mode proxy failed");
    return false;
  }
}

function toInvocation(value: string, usedPrefix: string | null, noPrefix: boolean): CommandInvocation | null {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const command = parts.shift()?.toLowerCase();
  return command ? { command, args: parts, usedPrefix, noPrefix } : null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}