import { ChannelType, type Client, EmbedBuilder, PermissionFlagsBits, type GuildMember, type Message } from "discord.js";
import { and, desc, eq, lt } from "drizzle-orm";
import {
  db,
  guildSettingsTable,
  moderationCasesTable,
  type GuildSettings,
  type ModerationCase,
  type ModerationConfig,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { notifyOwnerDMLog } from "./owner-dm-logger";
import { withRecovery } from "./recovery";

const MAX_REASON_LENGTH = 500;
const durationPattern = /^(\d+)(s|m|h|d|w)$/i;
const durationMs = (value: string | undefined): number | null => {
  if (!value) return null;
  const match = value.match(durationPattern);
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase() as "s" | "m" | "h" | "d" | "w"];
  return amount > 0 && amount <= 30 ? amount * multiplier : null;
};

const cleanReason = (value: string) => value.trim().slice(0, MAX_REASON_LENGTH) || "No reason provided";
const getRoleMention = (id: string | null) => id ? `<@&${id}>` : "Not configured";
const getChannelMention = (id: string | null) => id ? `<#${id}>` : "Not configured";
const recentMessageTimes = new Map<string, number[]>();
const moderationSettingsCache = new Map<string, { settings: GuildSettings; expiresAt: number }>();
function formatDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

export async function getModerationSettings(guildId: string): Promise<GuildSettings> {
  const cached = moderationSettingsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;
  return withRecovery("load moderation settings", async () => {
    const existing = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guildId)).limit(1);
    if (existing[0]) {
      moderationSettingsCache.set(guildId, { settings: existing[0], expiresAt: Date.now() + 30_000 });
      return existing[0];
    }
    const [created] = await db.insert(guildSettingsTable).values({ guildId, prefix: "&" }).onConflictDoNothing({ target: guildSettingsTable.guildId }).returning();
    if (created) {
      moderationSettingsCache.set(guildId, { settings: created, expiresAt: Date.now() + 30_000 });
      return created;
    }
    const [afterRace] = await db.select().from(guildSettingsTable).where(eq(guildSettingsTable.guildId, guildId)).limit(1);
    if (!afterRace) throw new Error(`Moderation settings could not be loaded for guild ${guildId}.`);
    moderationSettingsCache.set(guildId, { settings: afterRace, expiresAt: Date.now() + 30_000 });
    return afterRace;
  }, { guildId });
}

export async function runModerationMaintenance(client: Client): Promise<void> {
  const expired = await db.select().from(moderationCasesTable).where(and(
    eq(moderationCasesTable.active, true),
    lt(moderationCasesTable.expiresAt, new Date()),
  )).limit(100);
  for (const item of expired) {
    if (item.action === "tempban") {
      const guild = client.guilds.cache.get(item.guildId);
      await guild?.members.unban(item.targetId, `BH SHIELD temporary ban expired · Case #${item.caseNumber}`).catch(() => undefined);
    }
    await db.update(moderationCasesTable).set({ active: false }).where(eq(moderationCasesTable.id, item.id));
  }
}

async function updateModerationSettings(guildId: string, updates: Partial<typeof guildSettingsTable.$inferInsert>) {
  await getModerationSettings(guildId);
  await db.update(guildSettingsTable).set(updates).where(eq(guildSettingsTable.guildId, guildId));
  moderationSettingsCache.delete(guildId);
}

function isModerator(message: Message, settings: GuildSettings): boolean {
  const member = message.member;
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild)
    || (settings.modRoleId ? member.roles.cache.has(settings.modRoleId) : false);
}

function canUse(message: Message, permission: bigint): boolean {
  return Boolean(message.member?.permissions.has(PermissionFlagsBits.Administrator) || message.member?.permissions.has(permission));
}

async function targetMember(message: Message, value: string | undefined): Promise<GuildMember | null> {
  if (!message.guild || !value) return null;
  const id = message.mentions.members?.first()?.id ?? value.replace(/[<@!>]/g, "");
  return message.guild.members.fetch(id).catch(() => null);
}

async function targetUserId(message: Message, value: string | undefined): Promise<string | null> {
  const member = await targetMember(message, value);
  return member?.id ?? (value?.replace(/[<@!>]/g, "") || null);
}

function hierarchyError(message: Message, target: GuildMember): string | null {
  const actor = message.member;
  const me = message.guild?.members.me;
  if (!actor || !me) return "The bot could not verify the server hierarchy.";
  if (target.id === message.guild?.ownerId) return "The server owner cannot be moderated.";
  if (target.id === actor.id) return "You cannot use this command on yourself.";
  if (!target.manageable || !me.roles.highest || target.roles.highest.comparePositionTo(me.roles.highest) >= 0) return "My highest role must be above the target member.";
  if (actor.id !== message.guild?.ownerId && target.roles.highest.comparePositionTo(actor.roles.highest) >= 0) return "Your highest role must be above the target member.";
  return null;
}

async function nextCaseNumber(guildId: string): Promise<number> {
  const [latest] = await db.select({ caseNumber: moderationCasesTable.caseNumber })
    .from(moderationCasesTable)
    .where(eq(moderationCasesTable.guildId, guildId))
    .orderBy(desc(moderationCasesTable.caseNumber))
    .limit(1);
  return (latest?.caseNumber ?? 0) + 1;
}

async function createCase(input: {
  guildId: string;
  action: string;
  targetId: string;
  moderatorId: string;
  reason?: string;
  durationSeconds?: number;
  expiresAt?: Date;
}): Promise<ModerationCase> {
  const [created] = await db.insert(moderationCasesTable).values({
    id: randomUUID(),
    caseNumber: await nextCaseNumber(input.guildId),
    ...input,
    reason: cleanReason(input.reason ?? ""),
  }).returning();
  if (!created) throw new Error("Moderation case could not be created.");
  return created;
}

async function sendModLog(message: Message, settings: GuildSettings, moderationCase: ModerationCase, targetLabel?: string): Promise<void> {
  if (!settings.modLogChannelId || !message.guild) return;
  const channel = await message.guild.channels.fetch(settings.modLogChannelId).catch(() => null);
  if (!channel || !channel.isTextBased() || !("send" in channel)) return;
  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`🛡️ Case #${moderationCase.caseNumber} · ${moderationCase.action}`)
        .addFields(
          { name: "Target", value: targetLabel ?? `<@${moderationCase.targetId}>`, inline: true },
          { name: "Moderator", value: `<@${moderationCase.moderatorId}>`, inline: true },
          { name: "Reason", value: moderationCase.reason ?? "No reason provided", inline: false },
        )
        .setTimestamp(moderationCase.createdAt),
    ],
  }).catch((error) => logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Moderation log delivery failed"));
}

async function announce(message: Message, text: string): Promise<void> {
  await message.reply(`✅ ${text}`);
}

async function applyMemberAction(message: Message, action: string, args: string[]): Promise<void> {
  if (!message.guild) return;
  const settings = await getModerationSettings(message.guild.id);
  if (!isModerator(message, settings)) return void message.reply("You need moderator permissions to use this command.");
  const target = await targetMember(message, args.shift());
  if (!target) return void message.reply("Mention a valid member or provide their user ID.");
  const hierarchy = hierarchyError(message, target);
  if (hierarchy) return void message.reply(`❌ ${hierarchy}`);
  const reason = cleanReason(args.join(" "));
  const me = message.guild.members.me;
  try {
    if (action === "ban" || action === "softban" || action === "tempban") {
      if (!me?.permissions.has(PermissionFlagsBits.BanMembers)) return void message.reply("I need the Ban Members permission.");
      const duration = action === "tempban" ? durationMs(args.shift()) : null;
      if (action === "tempban" && !duration) return void message.reply("Usage: `&tempban <member> <duration: 1h|1d|1w> [reason]`");
      const tempReason = cleanReason(args.join(" "));
      await target.ban({ deleteMessageSeconds: action === "softban" ? 86_400 : 0, reason: tempReason });
      if (action === "softban") await message.guild.members.unban(target.id, "BH SHIELD softban cleanup");
      const record = await createCase({ guildId: message.guild.id, action, targetId: target.id, moderatorId: message.author.id, reason: tempReason, durationSeconds: duration ? Math.floor(duration / 1000) : undefined, expiresAt: duration ? new Date(Date.now() + duration) : undefined });
      await sendModLog(message, settings, record);
      if (duration) setTimeout(() => message.guild?.members.unban(target.id, "BH SHIELD temporary ban expired").catch(() => undefined), duration);
      return void announce(message, `${action} completed for ${target.user.tag}${duration ? ` for ${formatDuration(duration)}` : ""} · Case #${record.caseNumber}.`);
    } else if (action === "kick") {
      if (!me?.permissions.has(PermissionFlagsBits.KickMembers)) return void message.reply("I need the Kick Members permission.");
      await target.kick(reason);
    } else if (action === "timeout" || action === "tempmute") {
      if (!me?.permissions.has(PermissionFlagsBits.ModerateMembers)) return void message.reply("I need the Moderate Members permission.");
      const duration = durationMs(args.shift()) ?? 10 * 60_000;
      const timeoutReason = cleanReason(args.join(" "));
      await target.timeout(duration, timeoutReason);
      const record = await createCase({ guildId: message.guild.id, action: "timeout", targetId: target.id, moderatorId: message.author.id, reason: timeoutReason, durationSeconds: Math.floor(duration / 1000), expiresAt: new Date(Date.now() + duration) });
      await sendModLog(message, settings, record);
      return void announce(message, `Timed out ${target.user.tag} for ${formatDuration(duration)} · Case #${record.caseNumber}.`);
    } else if (action === "mute") {
      if (!settings.muteRoleId) return void message.reply("Set a mute role first with `&setmuterole @role`.");
      const role = message.guild.roles.cache.get(settings.muteRoleId);
      if (!role || role.position >= (me?.roles.highest.position ?? 0)) return void message.reply("The configured mute role must be below my highest role.");
      await target.roles.add(role, reason);
    } else if (action === "unmute") {
      if (!settings.muteRoleId) return void message.reply("No mute role is configured.");
      await target.roles.remove(settings.muteRoleId, reason);
    } else if (action === "untimeout") {
      if (!me?.permissions.has(PermissionFlagsBits.ModerateMembers)) return void message.reply("I need the Moderate Members permission.");
      await target.timeout(null, reason);
    } else {
      return;
    }
    const record = await createCase({ guildId: message.guild.id, action, targetId: target.id, moderatorId: message.author.id, reason });
    await sendModLog(message, settings, record);
    await announce(message, `${action} completed for ${target.user.tag} · Case #${record.caseNumber}.`);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error), action }, "Moderation action failed");
    await message.reply("The moderation action failed. Check my permissions and role hierarchy.");
  }
}

async function handleWarning(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const settings = await getModerationSettings(message.guild.id);
  if (!isModerator(message, settings)) return void message.reply("You need moderator permissions to use warnings.");
  const target = await targetMember(message, args.shift());
  if (!target) return void message.reply("Mention a valid member or provide their user ID.");
  const hierarchy = hierarchyError(message, target);
  if (hierarchy) return void message.reply(`❌ ${hierarchy}`);
  const record = await createCase({ guildId: message.guild.id, action: "warn", targetId: target.id, moderatorId: message.author.id, reason: args.join(" ") });
  await sendModLog(message, settings, record);
  await target.send(`You received a warning in **${message.guild.name}**. Reason: ${record.reason}`).catch(() => undefined);
  await announce(message, `${target.user.tag} was warned · Case #${record.caseNumber}.`);
}

async function listWarnings(message: Message, targetValue: string | undefined): Promise<void> {
  if (!message.guild) return;
  const settings = await getModerationSettings(message.guild.id);
  if (!isModerator(message, settings)) return void message.reply("You need moderator permissions to view warnings.");
  const targetId = await targetUserId(message, targetValue);
  if (!targetId) return void message.reply("Mention a member or provide their user ID.");
  const cases = await db.select().from(moderationCasesTable).where(and(eq(moderationCasesTable.guildId, message.guild.id), eq(moderationCasesTable.targetId, targetId), eq(moderationCasesTable.action, "warn"), eq(moderationCasesTable.active, true))).orderBy(desc(moderationCasesTable.createdAt)).limit(25);
  await message.reply(cases.length ? cases.map((item) => `**Case #${item.caseNumber}** · ${item.reason} · <t:${Math.floor(item.createdAt.getTime() / 1000)}:R>`).join("\n") : "No active warnings found.");
}

async function clearWarnings(message: Message, targetValue: string | undefined): Promise<void> {
  if (!message.guild) return;
  const settings = await getModerationSettings(message.guild.id);
  if (!isModerator(message, settings)) return void message.reply("You need moderator permissions to clear warnings.");
  const targetId = await targetUserId(message, targetValue);
  if (!targetId) return void message.reply("Mention a member or provide their user ID.");
  await db.update(moderationCasesTable).set({ active: false }).where(and(eq(moderationCasesTable.guildId, message.guild.id), eq(moderationCasesTable.targetId, targetId), eq(moderationCasesTable.action, "warn"), eq(moderationCasesTable.active, true)));
  await announce(message, `Warnings cleared for <@${targetId}>.`);
}

async function unban(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !canUse(message, PermissionFlagsBits.BanMembers)) return void message.reply("You need the Ban Members permission.");
  const userId = args.shift()?.replace(/[<@!>]/g, "");
  if (!userId) return void message.reply("Usage: `&unban <user-id> [reason]`");
  try {
    await message.guild.members.unban(userId, cleanReason(args.join(" ")));
    await announce(message, `Unbanned <@${userId}>.`);
  } catch {
    await message.reply("That user is not banned or the ID is invalid.");
  }
}

async function configureRole(message: Message, kind: "mod" | "mute", value: string | undefined): Promise<void> {
  if (!message.guild || !canUse(message, PermissionFlagsBits.ManageGuild)) return void message.reply("You need Manage Server permission.");
  const role = message.mentions.roles.first() ?? message.guild.roles.cache.get(value?.replace(/[<@&>]/g, "") ?? "");
  if (!role) return void message.reply("Mention a valid role or provide its ID.");
  await updateModerationSettings(message.guild.id, kind === "mod" ? { modRoleId: role.id } : { muteRoleId: role.id });
  await announce(message, `${kind === "mod" ? "Moderator" : "Mute"} role set to ${role}.`);
}

async function configureLog(message: Message, value: string | undefined): Promise<void> {
  if (!message.guild || !canUse(message, PermissionFlagsBits.ManageGuild)) return void message.reply("You need Manage Server permission.");
  const channel = message.mentions.channels.first() ?? message.guild.channels.cache.get(value?.replace(/[<#>]/g, "") ?? "");
  if (!channel || !channel.isTextBased()) return void message.reply("Mention a text channel or provide its ID.");
  await updateModerationSettings(message.guild.id, { modLogChannelId: channel.id, logChannelId: channel.id });
  await announce(message, `Moderation and centralized server log channel set to ${channel}.`);
}

async function handleMessageModeration(message: Message): Promise<void> {
  if (!message.guild || message.author.bot) return;
  const settings = await getModerationSettings(message.guild.id);
  const config = settings.moderationConfig ?? {};
  const now = Date.now();
  const messageKey = `${message.guild.id}:${message.author.id}`;
  const recent = (recentMessageTimes.get(messageKey) ?? []).filter((time) => now - time < 8_000);
  recent.push(now);
  recentMessageTimes.set(messageKey, recent);
  const spam = Boolean(config.antispam && recent.length >= 6);
  const raid = Boolean(config.raidmode && recent.length >= 3);
  const content = message.content;
  const lower = content.toLowerCase();
  const badWord = (config.badwords ?? []).find((word) => word && lower.includes(word.toLowerCase()));
  const invite = /(discord\.gg|discord(?:app)?\.com\/invite)\//i.test(content);
  const link = /https?:\/\/\S+/i.test(content);
  const caps = content.length >= 10 && content.replace(/[^A-Za-z]/g, "").length >= 8 && content.replace(/[^A-Z]/g, "").length / Math.max(1, content.replace(/[^A-Za-z]/g, "").length) >= 0.8;
  const tooManyMentions = message.mentions.users.size + message.mentions.roles.size > (config.mentionlimit ?? 5);
  if (spam || raid || (config.badwords?.length && badWord) || (config.antiinvite && invite) || (config.antilink && link) || (config.capsfilter && caps) || (config.mentionlimit && tooManyMentions)) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) await message.delete().catch(() => undefined);
    const reason = spam ? "antispam" : raid ? "raid mode" : badWord ? "bad words" : invite ? "invite link" : link ? "external link" : caps ? "excessive caps" : "mention limit";
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send({ content: `<@${message.author.id}> message removed: ${reason}.`, allowedMentions: { users: [message.author.id] } }).then((sent) => setTimeout(() => sent.delete().catch(() => undefined), 5_000)).catch(() => undefined);
    }
    logger.info({ guildId: message.guild.id, userId: message.author.id, reason }, "Automod message removed");
    notifyOwnerDMLog({
      category: "security",
      event: "Automatic moderation action",
      guild: message.guild.name,
      channel: message.channel.id,
      user: `${message.author.tag} (${message.author.id})`,
      details: `Message removed: ${reason}`,
    });
  }
}

async function handleChannelModeration(message: Message, command: string, args: string[]): Promise<boolean> {
  if (!message.guild) return false;
  const needsManage = ["purge", "clear", "slowmode", "lock", "unlock", "lockdown", "unlockdown", "nuke", "clone"].includes(command);
  if (needsManage && !canUse(message, PermissionFlagsBits.ManageChannels) && !canUse(message, PermissionFlagsBits.ManageMessages)) {
    await message.reply("You need channel or message management permissions.");
    return true;
  }
  const channel = message.channel;
  if (command === "purge" || command === "clear") {
    if (!("bulkDelete" in channel)) return true;
    const amount = Math.max(1, Math.min(100, Number(args.shift()) || 10));
    const deleted = await channel.bulkDelete(amount, true).catch(() => null);
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send(`✅ Deleted ${deleted?.size ?? 0} messages.`).then((sent) => setTimeout(() => sent.delete().catch(() => undefined), 4_000)).catch(() => undefined);
    }
    return true;
  }
  if (command === "slowmode") {
    if (!("setRateLimitPerUser" in channel)) return true;
    const seconds = Math.max(0, Math.min(21_600, Number(args.shift()) || 0));
    await channel.setRateLimitPerUser(seconds, `Changed by ${message.author.tag}`);
    await announce(message, `Slowmode set to ${seconds} seconds.`);
    return true;
  }
  if (command === "lock" || command === "unlock") {
    if (!("permissionOverwrites" in channel) || !message.guild.roles.everyone) return true;
    await channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: command === "unlock" ? null : false });
    await announce(message, `${command === "lock" ? "Locked" : "Unlocked"} ${channel}.`);
    return true;
  }
  if (command === "lockdown" || command === "unlockdown") {
    const channels = message.guild.channels.cache.filter((item) => item.type === ChannelType.GuildText || item.type === ChannelType.GuildAnnouncement);
    let changed = 0;
    for (const item of channels.values()) {
      if (!("permissionOverwrites" in item)) continue;
      await item.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: command === "unlockdown" ? null : false }).catch(() => undefined);
      changed += 1;
    }
    await announce(message, `${command === "lockdown" ? "Locked" : "Unlocked"} ${changed} text channels.`);
    return true;
  }
  if (command === "clone") {
    if (!("clone" in channel)) return true;
    const cloned = await channel.clone({ name: args.join("-").slice(0, 90) || undefined, reason: `Cloned by ${message.author.tag}` });
    await announce(message, `Channel cloned: ${cloned}.`);
    return true;
  }
  if (command === "nuke") {
    if (!("clone" in channel) || !("delete" in channel)) return true;
    const cloned = await channel.clone({ reason: `Nuked by ${message.author.tag}` });
    await channel.delete(`Nuked by ${message.author.tag}`);
    await cloned.send("💥 Channel recreated.").catch(() => undefined);
    return true;
  }
  return false;
}

async function handleMemberManagement(message: Message, command: string, args: string[]): Promise<boolean> {
  if (!message.guild) return false;
  if (command === "nick" || command === "resetnick") {
    const target = await targetMember(message, args.shift());
    if (!canUse(message, PermissionFlagsBits.ManageNicknames)) {
      await message.reply("You need Manage Nicknames permission.");
      return true;
    }
    if (!target) {
      await message.reply("Mention a valid member or provide their user ID.");
      return true;
    }
    const hierarchy = hierarchyError(message, target);
    if (hierarchy) {
      await message.reply(`❌ ${hierarchy}`);
      return true;
    }
    await target.setNickname(command === "resetnick" ? null : args.join(" ").slice(0, 32), `Changed by ${message.author.tag}`);
    await announce(message, `${command === "resetnick" ? "Nickname reset for" : "Nickname changed for"} ${target.user.tag}.`);
    return true;
  }
  if (command === "avatar") {
    const user = message.mentions.users.first() ?? await message.client.users.fetch(args[0] ?? message.author.id).catch(() => message.author);
    await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🖼️ ${user.tag}'s avatar`).setImage(user.displayAvatarURL({ size: 4096 })).setTimestamp()] });
    return true;
  }
  if (command === "role" || command === "removerole") {
    const target = await targetMember(message, args.shift());
    if (!canUse(message, PermissionFlagsBits.ManageRoles)) {
      await message.reply("You need Manage Roles permission.");
      return true;
    }
    if (!target) {
      await message.reply("Mention a member first.");
      return true;
    }
    const role = message.mentions.roles.first() ?? message.guild.roles.cache.get(args.shift()?.replace(/[<@&>]/g, "") ?? "");
    if (!role) {
      await message.reply("Mention a role or provide its ID.");
      return true;
    }
    const hierarchy = hierarchyError(message, target);
    if (hierarchy || role.position >= (message.guild.members.me?.roles.highest.position ?? 0)) {
      await message.reply(hierarchy ?? "My highest role must be above the selected role.");
      return true;
    }
    if (command === "role") await target.roles.add(role, `Changed by ${message.author.tag}`);
    else await target.roles.remove(role, `Changed by ${message.author.tag}`);
    await announce(message, `${command === "role" ? "Added" : "Removed"} ${role} ${command === "role" ? "from" : "for"} ${target.user.tag}.`);
    return true;
  }
  return false;
}

async function handleVoiceModeration(message: Message, command: string, args: string[]): Promise<boolean> {
  if (!message.guild) return false;
  const requiredPermission = command === "voicemute" || command === "voiceunmute"
    ? PermissionFlagsBits.MuteMembers
    : command === "deafen" || command === "undeafen"
      ? PermissionFlagsBits.DeafenMembers
      : PermissionFlagsBits.MoveMembers;
  if (!canUse(message, requiredPermission)) {
    await message.reply(`You need the ${command === "move" || command === "voicekick" ? "Move Members" : command.includes("deafen") ? "Deafen Members" : "Mute Members"} permission.`);
    return true;
  }
  const target = await targetMember(message, args.shift());
  if (!target?.voice.channel) {
    await message.reply("Mention a member who is currently in a voice channel.");
    return true;
  }
  if (command === "voicekick") await target.voice.disconnect(`Voice kicked by ${message.author.tag}`);
  else if (command === "voicemute") await target.voice.setMute(true, `Muted by ${message.author.tag}`);
  else if (command === "voiceunmute") await target.voice.setMute(false, `Unmuted by ${message.author.tag}`);
  else if (command === "deafen") await target.voice.setDeaf(true, `Deafened by ${message.author.tag}`);
  else if (command === "undeafen") await target.voice.setDeaf(false, `Undeafened by ${message.author.tag}`);
  else if (command === "move") {
    const destination = message.mentions.channels.first() ?? message.guild.channels.cache.get(args.shift()?.replace(/[<#>]/g, "") ?? "");
    if (!destination || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(destination.type)) {
      await message.reply("Mention a destination voice channel.");
      return true;
    }
    await target.voice.setChannel(destination.id, `Moved by ${message.author.tag}`);
  }
  await announce(message, `${command} completed for ${target.user.tag}.`);
  return true;
}

async function configureAutomod(message: Message, command: string, args: string[]): Promise<void> {
  if (!message.guild || !canUse(message, PermissionFlagsBits.ManageGuild)) return void message.reply("You need Manage Server permission.");
  const settings = await getModerationSettings(message.guild.id);
  const current: ModerationConfig = { ...(settings.moderationConfig ?? {}) };
  const mode = args.shift()?.toLowerCase();
  if (command === "automod") {
    const rule = mode;
    const enabled = args.shift()?.toLowerCase();
    if (!rule || !["antispam", "antilink", "antiinvite", "capsfilter", "raidmode"].includes(rule) || !["on", "off", "enable", "disable"].includes(enabled ?? "")) {
      return void message.reply("Usage: `&automod <antispam|antilink|antiinvite|capsfilter|raidmode> <on|off>`.");
    }
    const value = enabled === "on" || enabled === "enable";
    if (rule === "antispam") current.antispam = value;
    else if (rule === "antilink") current.antilink = value;
    else if (rule === "antiinvite") current.antiinvite = value;
    else if (rule === "capsfilter") current.capsfilter = value;
    else current.raidmode = value;
    await updateModerationSettings(message.guild.id, { moderationConfig: current });
    return void announce(message, `${rule} ${value ? "enabled" : "disabled"}.`);
  } else if (command === "badwords") {
    if (mode === "list") return void message.reply(current.badwords?.length ? current.badwords.map((word) => `\`${word}\``).join(", ") : "No blocked words configured.");
    const word = args.join(" ").trim().toLowerCase();
    if (mode === "remove") current.badwords = (current.badwords ?? []).filter((item) => item !== word);
    else if (word) current.badwords = [...new Set([...(current.badwords ?? []), word])].slice(0, 100);
    else return void message.reply("Usage: `&badwords add <word>`, `&badwords remove <word>`, or `&badwords list`.");
  } else if (command === "mentionlimit") {
    const value = Math.max(0, Math.min(50, Number(mode)));
    if (!Number.isFinite(value)) return void message.reply("Usage: `&mentionlimit <number>`; use 0 to disable.");
    current.mentionlimit = value;
  } else {
    const enabled = mode === "on" || mode === "enable";
    if (!["on", "off", "enable", "disable"].includes(mode ?? "")) return void message.reply(`Usage: \`&${command} on|off\`.`);
    if (command === "antispam") current.antispam = enabled;
    else if (command === "antilink") current.antilink = enabled;
    else if (command === "antiinvite") current.antiinvite = enabled;
    else if (command === "capsfilter") current.capsfilter = enabled;
    else if (command === "raidmode") current.raidmode = enabled;
  }
  await updateModerationSettings(message.guild.id, { moderationConfig: current });
  await announce(message, `${command} configuration updated.`);
}

async function handleMessageUtility(message: Message, command: string, args: string[]): Promise<void> {
  if (!message.guild) return;
  if (command === "say") {
    if (!canUse(message, PermissionFlagsBits.ManageMessages)) return void message.reply("You need Manage Messages permission.");
    const text = args.join(" ").slice(0, 2_000);
    if (!text) return void message.reply("Usage: `&say <message>`");
    await message.delete().catch(() => undefined);
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send({ content: text, allowedMentions: { parse: [] } });
    }
    return;
  }
  if (command === "announce") {
    if (!canUse(message, PermissionFlagsBits.ManageMessages)) return void message.reply("You need Manage Messages permission.");
    const text = args.join(" ").slice(0, 4_000);
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📢 Announcement").setDescription(text || "No announcement content provided.").setTimestamp()] });
    }
    return;
  }
  if (command === "embed") {
    if (!canUse(message, PermissionFlagsBits.ManageMessages)) return void message.reply("You need Manage Messages permission.");
    const [title, ...description] = args.join(" ").split("|");
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title?.trim().slice(0, 256) || "Announcement").setDescription(description.join("|").trim().slice(0, 4_000) || "No content provided.").setTimestamp()] });
    }
    return;
  }
  if (command === "poll") {
    if (!canUse(message, PermissionFlagsBits.ManageMessages)) return void message.reply("You need Manage Messages permission.");
    const [question, ...options] = args.join(" ").split("|").map((value) => value.trim()).filter(Boolean);
    if (!question || options.length < 2) return void message.reply("Usage: `&poll Question | Option 1 | Option 2 | Option 3`");
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`📊 ${question.slice(0, 256)}`).setDescription(options.slice(0, 10).map((option, index) => `${String.fromCodePoint(regionalEmoji(index))} ${option}`).join("\n")).setTimestamp()] });
    }
    return;
  }
}

function regionalEmoji(index: number): number {
  return 0x1f1e6 + index;
}

async function handleOwnerCommand(message: Message, command: string, args: string[]): Promise<void> {
  if (message.author.id !== process.env.OWNER_ID?.trim()) return void message.reply("Only the bot owner can use this command.");
  if (command === "restart" || command === "reload") {
    await message.reply("Restart requested. Railway will bring BH SHIELD back online automatically.");
    setTimeout(() => process.exit(0), 500);
  } else if (command === "shutdown") {
    await message.reply("Shutdown requested.");
    setTimeout(() => process.exit(0), 500);
  } else if (command === "sync") {
    await message.reply("BH SHIELD uses prefix commands and interactive components; there are no slash commands to sync.");
  } else if (command === "eval") {
    const source = args.join(" ");
    if (!source) return void message.reply("Usage: `&eval <JavaScript>`");
    try {
      const result = await Function("message", "client", `"use strict"; return (async () => (${source}))();`)(message, message.client);
      await message.reply(`\`\`\`js\n${String(result).slice(0, 1_800)}\n\`\`\``);
    } catch (error) {
      await message.reply(`\`\`\`txt\n${error instanceof Error ? error.message : String(error)}\n\`\`\``);
    }
  }
}

export async function handleModerationCommand(message: Message, command: string, args: string[]): Promise<boolean> {
  const basic = ["ban", "kick", "softban", "tempban", "mute", "unmute", "timeout", "untimeout", "tempmute"];
  if (basic.includes(command)) {
    await applyMemberAction(message, command, args);
    return true;
  }
  if (command === "unban") { await unban(message, args); return true; }
  if (command === "warn") { await handleWarning(message, args); return true; }
  if (command === "warnings") { await listWarnings(message, args.shift()); return true; }
  if (command === "clearwarnings") { await clearWarnings(message, args.shift()); return true; }
  if (["setlog", "setmodrole", "setmuterole"].includes(command)) {
    if (command === "setlog") await configureLog(message, args.shift());
    else await configureRole(message, command === "setmodrole" ? "mod" : "mute", args.shift());
    return true;
  }
  if (["automod", "antispam", "antilink", "antiinvite", "badwords", "capsfilter", "mentionlimit", "raidmode"].includes(command)) {
    await configureAutomod(message, command, args);
    return true;
  }
  if (["say", "embed", "announce", "poll"].includes(command)) { await handleMessageUtility(message, command, args); return true; }
  if (command === "avatar") {
    if (!message.guild) return true;
    const user = message.mentions.users.first() ?? await message.client.users.fetch(args[0] ?? message.author.id).catch(() => message.author);
    await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`🖼️ ${user.tag}'s avatar`).setImage(user.displayAvatarURL({ size: 4096 })).setTimestamp()] });
    return true;
  }
  if (await handleChannelModeration(message, command, args)) return true;
  if (await handleMemberManagement(message, command, args)) return true;
  if (["voicekick", "voicemute", "voiceunmute", "deafen", "undeafen", "move"].includes(command)) {
    await handleVoiceModeration(message, command, args);
    return true;
  }
  if (["reload", "restart", "shutdown", "eval", "sync"].includes(command)) { await handleOwnerCommand(message, command, args); return true; }
  if (command === "modlogs" || command === "cases" || command === "case" || command === "history") {
    if (!message.guild || !isModerator(message, await getModerationSettings(message.guild.id))) {
      await message.reply("You need moderator permissions to view moderation history.");
      return true;
    }
    const settings = await getModerationSettings(message.guild.id);
    if (command === "case") {
      const number = Number(args.shift());
      const [item] = await db.select().from(moderationCasesTable).where(and(eq(moderationCasesTable.guildId, message.guild.id), eq(moderationCasesTable.caseNumber, number))).limit(1);
      await message.reply(item ? `**Case #${item.caseNumber}** · ${item.action} · target <@${item.targetId}> · moderator <@${item.moderatorId}> · ${item.reason}` : "Case not found.");
      return true;
    }
    const targetId = command === "history" ? await targetUserId(message, args.shift()) : null;
    const cases = await db.select().from(moderationCasesTable).where(targetId ? and(eq(moderationCasesTable.guildId, message.guild.id), eq(moderationCasesTable.targetId, targetId)) : eq(moderationCasesTable.guildId, message.guild.id)).orderBy(desc(moderationCasesTable.createdAt)).limit(25);
    await message.reply(cases.length ? cases.map((item) => `#${item.caseNumber} · **${item.action}** · <@${item.targetId}> · ${item.reason}`).join("\n") : "No moderation cases found.");
    return true;
  }
  if (command === "config") {
    if (!message.guild || !canUse(message, PermissionFlagsBits.ManageGuild)) {
      await message.reply("You need Manage Server permission.");
      return true;
    }
    const settings = await getModerationSettings(message.guild.id);
    const config = settings.moderationConfig ?? {};
    await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("🛡️ Moderation configuration").addFields(
      { name: "Mod log", value: getChannelMention(settings.modLogChannelId), inline: true },
      { name: "Moderator role", value: getRoleMention(settings.modRoleId), inline: true },
      { name: "Mute role", value: getRoleMention(settings.muteRoleId), inline: true },
      { name: "Automod", value: Object.entries(config).map(([key, value]) => `${key}: ${String(value)}`).join("\n") || "No automod rules configured.", inline: false },
    ).setTimestamp()] });
    return true;
  }
  return false;
}

export async function handleModerationMessage(message: Message): Promise<void> {
  await handleMessageModeration(message).catch((error) => logger.error({ error: error instanceof Error ? error.message : String(error) }, "Automod handler failed"));
}