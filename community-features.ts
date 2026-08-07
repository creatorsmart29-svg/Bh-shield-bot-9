import { and, desc, eq, sql } from "drizzle-orm";
import {
  ChannelType,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type PartialGuildMember,
  type TextChannel,
} from "discord.js";
import { randomUUID } from "node:crypto";
import {
  db,
  guildSettingsTable,
  inviteStatsTable,
  inviteUsesTable,
} from "@workspace/db";
import { getGuildSettings } from "./bh-ticket";
import { registerCommands } from "./command-registry";

type CachedInvite = { uses: number; inviterId: string | null };
type CommunitySettings = Awaited<ReturnType<typeof getGuildSettings>>;
type CommunityMember = Pick<GuildMember, "id" | "guild" | "user">;

const inviteCache = new Map<string, Map<string, CachedInvite>>();
const afkUsers = new Map<string, { reason: string; since: number }>();
const reminderTimers = new Set<NodeJS.Timeout>();

function isAdmin(message: Message): boolean {
  return Boolean(message.member?.permissions.has(PermissionFlagsBits.ManageGuild) || message.member?.permissions.has(PermissionFlagsBits.Administrator));
}

function textChannel(channel: unknown): channel is TextChannel {
  return Boolean(channel && typeof channel === "object" && "send" in channel && "isTextBased" in channel);
}

function channelFromMention(message: Message, value?: string): TextChannel | null {
  const mentioned = message.mentions.channels.first();
  if (mentioned && mentioned.type === ChannelType.GuildText) return mentioned as TextChannel;
  const id = value?.match(/\d{15,25}/)?.[0];
  const channel = id ? message.guild?.channels.cache.get(id) : null;
  return channel?.type === ChannelType.GuildText ? channel as TextChannel : null;
}

function replaceVariables(template: string, member: CommunityMember): string {
  return template
    .replaceAll("{user}", member.user.tag)
    .replaceAll("{mention}", `<@${member.id}>`)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{memberCount}", String(member.guild.memberCount))
    .replaceAll("{username}", member.user.username);
}

async function updateSettings(guildId: string, values: Partial<typeof guildSettingsTable.$inferInsert>): Promise<void> {
  await db.update(guildSettingsTable).set(values).where(eq(guildSettingsTable.guildId, guildId));
}

async function sendToConfiguredChannel(guild: Guild, channelId: string | null | undefined, payload: Parameters<TextChannel["send"]>[0]): Promise<boolean> {
  if (!channelId) return false;
  const channel = guild.channels.cache.get(channelId);
  if (!textChannel(channel)) return false;
  try {
    await channel.send(payload);
    return true;
  } catch {
    return false;
  }
}

export async function sendCommunityLog(
  guild: Guild,
  event: string,
  description: string,
  color = 0x5865f2,
): Promise<void> {
  const settings = await getGuildSettings(guild.id);
  if (!settings.logChannelId) return;
  await sendToConfiguredChannel(guild, settings.logChannelId, {
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle(`Server log · ${event}`)
      .setDescription(description)
      .setFooter({ text: "BH SHIELD centralized logs" })
      .setTimestamp()],
  });
}

async function ensureInviteStats(guildId: string, userId: string): Promise<void> {
  await db.insert(inviteStatsTable)
    .values({ id: randomUUID(), guildId, userId })
    .onConflictDoNothing({ target: [inviteStatsTable.guildId, inviteStatsTable.userId] });
}

async function incrementInviteStats(
  guildId: string,
  userId: string,
  field: "regularInvites" | "fakeInvites" | "leftMembers" | "rejoinedMembers" | "bonusInvites",
): Promise<void> {
  await ensureInviteStats(guildId, userId);
  await db.update(inviteStatsTable)
    .set({ [field]: sql`${inviteStatsTable[field]} + 1` } as never)
    .where(and(eq(inviteStatsTable.guildId, guildId), eq(inviteStatsTable.userId, userId)));
}

export async function initializeInviteCache(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      inviteCache.set(guild.id, new Map(invites.map((invite) => [
        invite.code,
        { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null },
      ])));
    } catch {
      inviteCache.set(guild.id, new Map());
    }
  }
}

async function detectUsedInvite(guild: Guild): Promise<{ code: string | null; inviterId: string | null }> {
  const previous = inviteCache.get(guild.id) ?? new Map<string, CachedInvite>();
  try {
    const current = await guild.invites.fetch();
    let used: { code: string | null; inviterId: string | null } = { code: null, inviterId: null };
    for (const invite of current.values()) {
      const old = previous.get(invite.code);
      if ((invite.uses ?? 0) > (old?.uses ?? 0)) {
        used = { code: invite.code, inviterId: invite.inviter?.id ?? old?.inviterId ?? null };
        break;
      }
    }
    inviteCache.set(guild.id, new Map(current.map((invite) => [
      invite.code,
      { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null },
    ])));
    return used;
  } catch {
    return { code: null, inviterId: null };
  }
}

async function trackMemberJoin(member: GuildMember): Promise<{ inviterId: string | null }> {
  const used = await detectUsedInvite(member.guild);
  const prior = await db.select().from(inviteUsesTable)
    .where(and(eq(inviteUsesTable.guildId, member.guild.id), eq(inviteUsesTable.memberId, member.id)))
    .limit(1);
  if (used.inviterId && used.inviterId !== member.id) {
    await incrementInviteStats(member.guild.id, used.inviterId, prior[0] ? "rejoinedMembers" : "regularInvites");
  }
  await db.insert(inviteUsesTable).values({
    id: randomUUID(),
    guildId: member.guild.id,
    inviteCode: used.code,
    inviterId: used.inviterId,
    memberId: member.id,
    rejoined: Boolean(prior[0]),
  });
  if (prior[0]) {
    await db.update(inviteUsesTable).set({ leftAt: null, rejoined: true }).where(eq(inviteUsesTable.id, prior[0].id));
  }
  return used;
}

export async function handleCommunityMemberAdd(member: GuildMember): Promise<void> {
  const settings = await getGuildSettings(member.guild.id);
  const used = await trackMemberJoin(member);
  if (settings.welcomeEnabled && settings.welcomeChannelId) {
    const content = replaceVariables(settings.welcomeMessage, member);
    const embed = new EmbedBuilder()
      .setColor(settings.welcomeColor as `#${string}`)
      .setTitle(replaceVariables(settings.welcomeEmbedTitle, member))
      .setDescription(content)
      .setThumbnail(settings.welcomeImageUrl || member.user.displayAvatarURL())
      .setTimestamp();
    if (settings.welcomeBannerUrl) embed.setImage(settings.welcomeBannerUrl);
    await sendToConfiguredChannel(member.guild, settings.welcomeChannelId, {
      content: settings.welcomeMention ? `<@${member.id}>` : undefined,
      embeds: [embed],
    });
  }
  await sendCommunityLog(member.guild, "Member joined", `${member} joined the server.${used.inviterId ? ` Invited by <@${used.inviterId}>.` : ""}`, 0x57f287);
}

export async function handleCommunityMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
  const settings = await getGuildSettings(member.guild.id);
  const active = await db.select().from(inviteUsesTable)
    .where(and(eq(inviteUsesTable.guildId, member.guild.id), eq(inviteUsesTable.memberId, member.id)))
    .orderBy(desc(inviteUsesTable.joinedAt))
    .limit(1);
  if (active[0]) {
    await db.update(inviteUsesTable).set({ leftAt: new Date() }).where(eq(inviteUsesTable.id, active[0].id));
    if (active[0].inviterId) await incrementInviteStats(member.guild.id, active[0].inviterId, "leftMembers");
  }
  if (settings.leaveEnabled && settings.leaveChannelId) {
    const embed = new EmbedBuilder()
      .setColor(settings.leaveColor as `#${string}`)
      .setTitle(replaceVariables(settings.leaveEmbedTitle, member))
      .setDescription(replaceVariables(settings.leaveMessage, member))
      .setThumbnail(settings.leaveImageUrl || member.user.displayAvatarURL())
      .setTimestamp();
    if (settings.leaveBannerUrl) embed.setImage(settings.leaveBannerUrl);
    await sendToConfiguredChannel(member.guild, settings.leaveChannelId, { embeds: [embed] });
  }
  await sendCommunityLog(member.guild, "Member left", `${member.user.tag} left the server.`, 0xed4245);
}

async function commandInvites(message: Message, args: string[]): Promise<void> {
  const userId = message.mentions.users.first()?.id ?? args[0]?.match(/\d{15,25}/)?.[0] ?? message.author.id;
  const [row] = await db.select().from(inviteStatsTable)
    .where(and(eq(inviteStatsTable.guildId, message.guild!.id), eq(inviteStatsTable.userId, userId)))
    .limit(1);
  const user = await message.client.users.fetch(userId).catch(() => null);
  if (!row) return void await message.reply(`${user?.tag ?? "That user"} has no recorded invites.`);
  await message.reply(`**${user?.tag ?? userId}** has **${row.regularInvites + row.bonusInvites - row.leftMembers}** active invites (${row.regularInvites} regular, ${row.leftMembers} left, ${row.rejoinedMembers} rejoined).`);
}

async function commandInviteLeaderboard(message: Message): Promise<void> {
  const rows = await db.select().from(inviteStatsTable)
    .where(eq(inviteStatsTable.guildId, message.guild!.id))
    .orderBy(desc(sql`${inviteStatsTable.regularInvites} + ${inviteStatsTable.bonusInvites} - ${inviteStatsTable.leftMembers}`))
    .limit(10);
  if (!rows.length) return void await message.reply("No invite activity has been recorded yet.");
  const lines = await Promise.all(rows.map(async (row, index) => {
    const user = await message.client.users.fetch(row.userId).catch(() => null);
    return `**${index + 1}.** ${user ? user.tag : row.userId} — ${Math.max(0, row.regularInvites + row.bonusInvites - row.leftMembers)} active`;
  }));
  await message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("Invite leaderboard").setDescription(lines.join("\n"))] });
}

async function commandInviteInfo(message: Message, args: string[]): Promise<void> {
  const code = args[0]?.replace(/^https?:\/\/discord\.gg\//, "");
  if (!code) return void await message.reply("Usage: `&inviteinfo <invite-code>`.");
  try {
    const invite = await message.client.fetchInvite(code);
    await message.reply(`**${invite.code}** · ${invite.guild?.name ?? "unknown server"} · ${invite.uses ?? 0} uses · created by ${invite.inviter?.tag ?? "unknown"}`);
  } catch {
    await message.reply("That invite could not be found or is no longer accessible.");
  }
}

async function setWelcomeOrLeave(message: Message, kind: "welcome" | "leave", args: string[]): Promise<void> {
  if (!isAdmin(message)) return void await message.reply("You need Manage Server permission to change community settings.");
  const settings = await getGuildSettings(message.guild!.id);
  const action = args.shift()?.toLowerCase();
  const prefix = kind === "welcome" ? "welcome" : "leave";
  if (action === "on" || action === "off") {
    await updateSettings(message.guild!.id, { [`${prefix}Enabled`]: action === "on" } as never);
    return void await message.reply(`${kind[0].toUpperCase() + kind.slice(1)} messages are now **${action}**.`);
  }
  if (action === "preview") {
    const member = message.member!;
    const template = kind === "welcome" ? settings.welcomeMessage : settings.leaveMessage;
    return void await message.reply({ embeds: [new EmbedBuilder().setColor(kind === "welcome" ? 0x57f287 : 0xed4245).setTitle(`${kind} preview`).setDescription(replaceVariables(template, member))] });
  }
  const channel = channelFromMention(message, action);
  if (channel) {
    await updateSettings(message.guild!.id, { [`${prefix}ChannelId`]: channel.id } as never);
    args.shift();
  }
  const option = args.shift()?.toLowerCase();
  const text = args.join(" ").trim();
  const field = option === "message" ? `${prefix}Message` : option === "title" ? `${prefix}EmbedTitle` : null;
  if (field && text) await updateSettings(message.guild!.id, { [field]: text } as never);
  if (!channel && !field) return void await message.reply(`Usage: \`&set${kind} #channel\`, \`&set${kind} message <text>\`, \`&${kind} on|off|preview\`.`);
  await message.reply(`${kind[0].toUpperCase() + kind.slice(1)} settings updated.`);
}

async function communityUtility(message: Message, command: string, args: string[]): Promise<void> {
  const guild = message.guild!;
  if (command === "membercount") return void await message.reply(`This server has **${guild.memberCount}** members.`);
  if (command === "boosters") return void await message.reply(`This server has **${guild.premiumSubscriptionCount ?? 0}** boosts and **${guild.premiumTier}** boost level.`);
  if (command === "uptime") return void await message.reply(`BH SHIELD has been online for <t:${Math.floor((Date.now() - message.client.uptime) / 1000)}:R>.`);
  if (command === "stats") return void await message.reply(`**${guild.name}** · ${guild.memberCount} members · ${guild.channels.cache.size} channels · ${guild.roles.cache.size} roles · ${guild.emojis.cache.size} emojis`);
  if (command === "avatar") {
    const user = message.mentions.users.first() ?? message.author;
    return void await message.reply(user.displayAvatarURL({ size: 1024 }));
  }
  if (command === "roleinfo") {
    const role = message.mentions.roles.first() ?? guild.roles.cache.get(args[0] ?? "");
    return void await message.reply(role ? `**${role.name}** · ${role.id} · ${role.members.size} members · ${role.position} position` : "Mention a role or provide its ID.");
  }
  if (command === "channelinfo") {
    const channel = message.mentions.channels.first() ?? guild.channels.cache.get(args[0] ?? "") ?? message.channel;
    return void await message.reply(`**${"name" in channel ? channel.name : "channel"}** · ${channel.id} · ${channel.type}`);
  }
  if (command === "emojiinfo") {
    const emoji = message.guild?.emojis.cache.get(args[0] ?? "") ?? message.guild?.emojis.cache.find((item) => item.name === args[0]);
    return void await message.reply(emoji ? `**${emoji.name}** · ${emoji.id} · ${emoji.animated ? "animated" : "static"}` : "Provide an emoji ID or name.");
  }
  if (command === "permissions") {
    const target = message.mentions.members?.first() ?? message.member!;
    return void await message.reply(`**${target.user.tag}** permissions: ${target.permissions.toArray().join(", ") || "none"}`);
  }
  if (command === "calculator") {
    const expression = args.join(" ");
    if (!expression || !/^[0-9+\-*/().%\s]+$/.test(expression)) return void await message.reply("Use a basic arithmetic expression, for example `&calculator (12 + 4) / 2`.");
    try {
      const result = Function(`"use strict"; return (${expression})`)();
      return void await message.reply(`Result: **${String(result).slice(0, 100)}**`);
    } catch {
      return void await message.reply("That expression could not be calculated.");
    }
  }
  if (command === "timestamp") {
    const parsed = args.length ? Date.parse(args.join(" ")) : Date.now();
    return void await message.reply(Number.isNaN(parsed) ? "I could not parse that date." : `<t:${Math.floor(parsed / 1000)}:F> · \`<t:${Math.floor(parsed / 1000)}:R>\``);
  }
  if (command === "remind") {
    const seconds = Math.min(86400, Math.max(1, Number(args.shift()) || 0));
    const text = args.join(" ").trim() || "Reminder";
    if (!seconds) return void await message.reply("Usage: `&remind <seconds> <message>`.");
    const timer = setTimeout(() => {
      reminderTimers.delete(timer);
      void message.author.send(`Reminder from **${guild.name}**: ${text}`).catch(() => undefined);
    }, seconds * 1000);
    reminderTimers.add(timer);
    return void await message.reply(`Reminder set for <t:${Math.floor((Date.now() + seconds * 1000) / 1000)}:R>.`);
  }
  if (command === "afk") {
    const key = `${guild.id}:${message.author.id}`;
    const reason = args.join(" ").trim() || "AFK";
    afkUsers.set(key, { reason, since: Date.now() });
    return void await message.reply(`You are now AFK: ${reason}`);
  }
  if (command === "translate") return void await message.reply(args.length > 1 ? `Translation request received for **${args[0]}**: ${args.slice(1).join(" ")}` : "Usage: `&translate <language> <text>`.");
}

async function communityFun(message: Message, command: string, args: string[]): Promise<void> {
  if (command === "coinflip") return void await message.reply(Math.random() < 0.5 ? "Heads." : "Tails.");
  if (command === "8ball") return void await message.reply(["It is certain.", "Probably.", "Ask again later.", "Unlikely.", "Absolutely not."][Math.floor(Math.random() * 5)]);
  if (command === "roll") {
    const sides = Math.min(1000, Math.max(2, Number(args[0]) || 6));
    return void await message.reply(`You rolled **${Math.floor(Math.random() * sides) + 1}** (d${sides}).`);
  }
  if (command === "choose") {
    const choices = args.join(" ").split("|").map((value) => value.trim()).filter(Boolean);
    return void await message.reply(choices.length > 1 ? `I choose **${choices[Math.floor(Math.random() * choices.length)]}**.` : "Separate choices with `|`.");
  }
  if (command === "rate") return void await message.reply(`I rate **${args.join(" ") || "that"}** ${Math.floor(Math.random() * 101)}/100.`);
  if (command === "ship") {
    const users = message.mentions.users;
    return void await message.reply(`Compatibility: **${Math.floor(Math.random() * 101)}%**.`);
  }
  if (command === "meme") return void await message.reply(["When the bot passes every typecheck but the database is asleep.", "Me: one small feature. Also me: another command registry.", "Production is just development with an audience."][Math.floor(Math.random() * 3)]);
}

export function registerCommunityCommands(): void {
  registerCommands([
    { name: "invites", aliases: ["invitecount"], guildOnly: true, category: "Community", description: "Show invite statistics.", usage: "invites [@user]", execute: commandInvites },
    { name: "inviteleaderboard", aliases: ["invitetop"], guildOnly: true, category: "Community", execute: commandInviteLeaderboard },
    { name: "inviteinfo", guildOnly: true, category: "Information", execute: commandInviteInfo },
    { name: "resetinvites", guildOnly: true, category: "Community", permissions: ["Manage Server"], execute: async (message) => {
      if (!isAdmin(message)) return void await message.reply("You need Manage Server permission.");
      await db.delete(inviteStatsTable).where(eq(inviteStatsTable.guildId, message.guild!.id));
      await db.delete(inviteUsesTable).where(eq(inviteUsesTable.guildId, message.guild!.id));
      await message.reply("Invite statistics reset for this server.");
    } },
    { name: "setwelcome", guildOnly: true, category: "Community", execute: async (message, args) => setWelcomeOrLeave(message, "welcome", args) },
    { name: "welcome", guildOnly: true, category: "Community", execute: async (message, args) => setWelcomeOrLeave(message, "welcome", args) },
    { name: "setleave", guildOnly: true, category: "Community", execute: async (message, args) => setWelcomeOrLeave(message, "leave", args) },
    { name: "leave", guildOnly: true, category: "Community", execute: async (message, args) => setWelcomeOrLeave(message, "leave", args) },
    ...["membercount", "boosters", "uptime", "stats", "roleinfo", "channelinfo", "emojiinfo", "permissions", "calculator", "timestamp", "remind", "afk", "translate"].map((name) => ({
      name, guildOnly: true, category: "Information", execute: async (message: Message, args: string[]) => communityUtility(message, name, args),
    })),
    ...["8ball", "coinflip", "roll", "choose", "ship", "rate", "meme"].map((name) => ({
      name, guildOnly: true, category: "Fun", execute: async (message: Message, args: string[]) => communityFun(message, name, args),
    })),
  ]);
}

export function handleCommunityMessage(message: Message): void {
  if (!message.guild || message.author.bot) return;
  const key = `${message.guild.id}:${message.author.id}`;
  const afk = afkUsers.get(key);
  if (afk) {
    afkUsers.delete(key);
    void message.reply(`Welcome back — your AFK lasted ${Math.max(1, Math.round((Date.now() - afk.since) / 60000))} minutes.`).catch(() => undefined);
  }
  for (const user of message.mentions.users.values()) {
    const mentioned = afkUsers.get(`${message.guild.id}:${user.id}`);
    if (mentioned) void message.reply(`**${user.username}** is AFK: ${mentioned.reason}`).catch(() => undefined);
  }
}

export const communityEvents = {
  GuildMemberAdd: Events.GuildMemberAdd,
  GuildMemberRemove: Events.GuildMemberRemove,
};