import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type Message,
  type ModalSubmitInteraction,
} from "discord.js";
import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  engagementAchievementsTable,
  engagementAuditLogsTable,
  engagementBirthdaysTable,
  engagementGuildSettingsTable,
  engagementInventoryTable,
  engagementItemsTable,
  engagementProfilesTable,
  engagementSuggestionsTable,
  engagementSuggestionVotesTable,
  engagementUserAchievementsTable,
  type EngagementGuildSettings,
  type EngagementItem,
  type EngagementProfile,
} from "@workspace/db";
import { registerCommands } from "./command-registry";
import { notifyOwnerDMLog } from "./owner-dm-logger";
import { logger } from "./logger";
import { withRecovery } from "./recovery";

const COLOR = 0x5865f2;
const DAY = 86_400_000;
const settingsCache = new Map<string, { value: EngagementGuildSettings; expiresAt: number }>();
const voiceSessions = new Map<string, { guildId: string; userId: string; startedAt: number }>();

function isAdmin(message: Message): boolean {
  return Boolean(message.member?.permissions.has(PermissionFlagsBits.ManageGuild) || message.member?.permissions.has(PermissionFlagsBits.Administrator));
}

function memberFromMessage(message: Message, args: string[] = []): GuildMember | null {
  return message.mentions.members?.first() ?? message.guild?.members.cache.get(args.find((value) => /^\d{15,25}$/.test(value)) ?? message.author.id) ?? message.member;
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function levelForXp(xp: number): number {
  return Math.max(0, Math.floor(Math.sqrt(Math.max(0, xp) / 100)));
}

function xpForLevel(level: number): number {
  return level * level * 100;
}

function nextLevelXp(level: number): number {
  return xpForLevel(level + 1) * 100;
}

function cooldownReady(last: Date | null, durationMs: number): boolean {
  return !last || Date.now() - last.getTime() >= durationMs;
}

function cooldownText(last: Date | null, durationMs: number): string {
  return last ? `<t:${Math.ceil((last.getTime() + durationMs) / 1000)}:R>` : "now";
}

async function getSettings(guildId: string): Promise<EngagementGuildSettings> {
  const cached = settingsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await withRecovery("load engagement guild settings", async () => {
    const [existing] = await db.select().from(engagementGuildSettingsTable).where(eq(engagementGuildSettingsTable.guildId, guildId)).limit(1);
    if (existing) return existing;
    const [created] = await db.insert(engagementGuildSettingsTable).values({ guildId }).returning();
    if (!created) throw new Error(`Engagement settings could not be created for ${guildId}.`);
    return created;
  }, { guildId });
  settingsCache.set(guildId, { value, expiresAt: Date.now() + 30_000 });
  return value;
}

async function getProfile(guildId: string, userId: string): Promise<EngagementProfile> {
  return withRecovery("load engagement profile", async () => {
    const [existing] = await db.select().from(engagementProfilesTable).where(and(eq(engagementProfilesTable.guildId, guildId), eq(engagementProfilesTable.userId, userId))).limit(1);
    if (existing) return existing;
    const [created] = await db.insert(engagementProfilesTable).values({ id: randomUUID(), guildId, userId }).returning();
    if (!created) throw new Error(`Engagement profile could not be created for ${guildId}/${userId}.`);
    return created;
  }, { guildId, userId });
}

async function audit(message: Message, action: string, targetId?: string, oldValue?: unknown, newValue?: unknown): Promise<void> {
  if (!message.guild) return;
  await db.insert(engagementAuditLogsTable).values({
    id: randomUUID(),
    guildId: message.guild.id,
    actorId: message.author.id,
    action,
    targetId,
    oldValue,
    newValue,
  }).catch(() => undefined);
  notifyOwnerDMLog({
    category: "command",
    event: `Engagement: ${action}`,
    guild: `${message.guild.name} (${message.guild.id})`,
    channel: message.channel.id,
    user: `${message.author.tag} (${message.author.id})`,
    details: targetId ? `Target: ${targetId}` : undefined,
  });
}

async function updateProfile(guildId: string, userId: string, values: Partial<typeof engagementProfilesTable.$inferInsert>): Promise<EngagementProfile> {
  const [updated] = await withRecovery("update engagement profile", () => db.update(engagementProfilesTable)
    .set(values)
    .where(and(eq(engagementProfilesTable.guildId, guildId), eq(engagementProfilesTable.userId, userId)))
    .returning(), { guildId, userId });
  if (!updated) return getProfile(guildId, userId);
  return updated;
}

async function grantXp(message: Message, amount = 0): Promise<void> {
  if (!message.guild || message.author.bot || !message.content.trim()) return;
  const settings = await getSettings(message.guild.id);
  if (!settings.xpEnabled || message.content.trim().startsWith("&")) return;
  const profile = await getProfile(message.guild.id, message.author.id);
  const today = dayKey();
  const dailyXp = profile.lastXpDay === today ? profile.xpToday : 0;
  if (!cooldownReady(profile.lastXpAt, settings.xpCooldownSeconds * 1000) || dailyXp >= settings.xpDailyLimit) return;
  const roleBonus = message.member?.roles.cache.reduce((total, role) => total + (settings.roleXpBonuses?.[role.id] ?? 0), 0) ?? 0;
  const multiplier = settings.multiplierEndsAt && settings.multiplierEndsAt > new Date() ? settings.xpMultiplier : 100;
  const earned = Math.max(1, Math.floor((amount || settings.xpPerMessage + Math.floor(Math.random() * 8) + roleBonus) * multiplier / 100));
  const oldLevel = profile.level;
  const xpToday = Math.min(settings.xpDailyLimit, dailyXp + earned);
  const totalXp = profile.xp + earned;
  const level = levelForXp(totalXp);
  await updateProfile(message.guild.id, message.author.id, { xp: totalXp, xpToday, level, lastXpAt: new Date(), lastXpDay: today });
  if (level > oldLevel) {
    if ("send" in message.channel && typeof message.channel.send === "function") {
      await message.channel.send({ content: `🎉 <@${message.author.id}> reached **level ${level}**!`, allowedMentions: { users: [message.author.id] } }).catch(() => undefined);
    }
    const roleId = settings.levelRoles?.[String(level)];
    if (roleId && message.member?.roles.cache.has(roleId) === false) await message.member.roles.add(roleId).catch(() => undefined);
  }
  await updateAchievementProgress(message.guild.id, message.author.id, "messages", 1);
  await updateAchievementProgress(message.guild.id, message.author.id, "level", level);
}

async function commandRank(message: Message, args: string[]): Promise<void> {
  const member = memberFromMessage(message, args);
  if (!message.guild || !member) return void await message.reply("That member could not be found.");
  const profile = await getProfile(message.guild.id, member.id);
  const [ahead] = await db.select({ count: sql<number>`count(*)` }).from(engagementProfilesTable).where(and(eq(engagementProfilesTable.guildId, message.guild.id), gte(engagementProfilesTable.xp, profile.xp)));
  const rank = Math.max(1, Number(ahead?.count ?? 1));
  const current = profile.xp - xpForLevel(profile.level);
  const needed = Math.max(1, xpForLevel(profile.level + 1) - xpForLevel(profile.level));
  const config = (await getSettings(message.guild.id)).rankCard ?? {};
  const svg = rankCardSvg({
    avatar: member.user.displayAvatarURL({ extension: "png", size: 128 }),
    username: member.user.username,
    level: profile.level,
    xp: profile.xp,
    current,
    needed,
    rank,
    server: message.guild.name,
    color: config.color ?? "#5865F2",
    accent: config.accent ?? "#57F287",
    background: config.background ?? "#161A2B",
  });
  await message.reply({
    embeds: [new EmbedBuilder().setColor(config.color as `#${string}` ?? COLOR).setTitle(`${member.user.username}'s rank`).setImage("attachment://rank-card.svg").setFooter({ text: `Rank #${rank} · ${message.guild.name}` })],
    files: [new AttachmentBuilder(Buffer.from(svg), { name: "rank-card.svg" })],
  });
}

async function commandLeaderboard(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const global = args[0]?.toLowerCase() === "global";
  const rows = await db.select().from(engagementProfilesTable).where(global ? undefined : eq(engagementProfilesTable.guildId, message.guild.id)).orderBy(desc(engagementProfilesTable.xp)).limit(10);
  const lines = await Promise.all(rows.map(async (row, index) => {
    const user = await message.client.users.fetch(row.userId).catch(() => null);
    return `**${index + 1}.** ${user?.tag ?? row.userId} — Level ${row.level} · ${row.xp.toLocaleString()} XP`;
  }));
  await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(global ? "Global leaderboard" : `${message.guild.name} leaderboard`).setDescription(lines.join("\n") || "No XP has been earned yet.").setFooter({ text: "BH SHIELD community engagement" })] });
}

async function commandSetXp(message: Message, args: string[], mode: "xp" | "level" | "reset"): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const member = memberFromMessage(message, args);
  if (!member) return void await message.reply("Mention a member or provide their ID.");
  const value = mode === "reset" ? 0 : Math.max(0, Math.floor(Number(args.find((item) => /^\d+$/.test(item))) || 0));
  const profile = await getProfile(message.guild.id, member.id);
  const old = { xp: profile.xp, level: profile.level };
  const values = mode === "level" ? { level: value, xp: xpForLevel(value) } : { xp: value, level: levelForXp(value) };
  await updateProfile(message.guild.id, member.id, values);
  await audit(message, `set${mode}`, member.id, old, values);
  await message.reply(`✅ ${member.user.tag} now has **level ${values.level}** and **${values.xp.toLocaleString()} XP**.`);
}

async function commandXpMultiplier(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const multiplier = Math.max(100, Math.min(1_000, Number(args[0]) || 100));
  const durationMinutes = Math.max(0, Math.min(43_200, Number(args[1]) || 60));
  const old = await getSettings(message.guild.id);
  const [updated] = await db.update(engagementGuildSettingsTable).set({ xpMultiplier: multiplier, multiplierEndsAt: multiplier === 100 ? null : new Date(Date.now() + durationMinutes * 60_000) }).where(eq(engagementGuildSettingsTable.guildId, message.guild.id)).returning();
  settingsCache.delete(message.guild.id);
  await audit(message, "xp_multiplier", message.guild.id, { multiplier: old.xpMultiplier }, { multiplier, durationMinutes });
  await message.reply(multiplier === 100 ? "✅ XP multiplier reset to **1x**." : `✅ XP multiplier set to **${(multiplier / 100).toFixed(2)}x** for **${durationMinutes} minutes**.`);
  void updated;
}

async function commandXpStatus(message: Message): Promise<void> {
  if (!message.guild) return;
  const settings = await getSettings(message.guild.id);
  const profile = await getProfile(message.guild.id, message.author.id);
  await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("XP status").addFields(
    { name: "Your progress", value: `Level **${profile.level}** · **${profile.xp.toLocaleString()} XP**`, inline: true },
    { name: "Today", value: `${profile.lastXpDay === dayKey() ? profile.xpToday : 0}/${settings.xpDailyLimit} XP`, inline: true },
    { name: "Server settings", value: `${settings.xpEnabled ? "Enabled" : "Disabled"} · ${settings.xpCooldownSeconds}s cooldown · ${settings.xpMultiplier / 100}x multiplier`, inline: false },
  )] });
}

async function commandRep(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const member = memberFromMessage(message, args);
  if (!member || member.id === message.author.id) return void await message.reply("Mention another member to give reputation.");
  const giver = await getProfile(message.guild.id, message.author.id);
  if (!cooldownReady(giver.lastRepAt, DAY)) return void await message.reply(`You can give reputation again ${cooldownText(giver.lastRepAt, DAY)}.`);
  await updateProfile(message.guild.id, member.id, { reputation: sql`${engagementProfilesTable.reputation} + 1` } as never);
  await updateProfile(message.guild.id, message.author.id, { lastRepAt: new Date() });
  await updateAchievementProgress(message.guild.id, member.id, "reputation", 1);
  await message.reply(`⭐ ${member} received **+1 reputation** from ${message.author}.`);
}

async function commandRepLeaderboard(message: Message): Promise<void> {
  if (!message.guild) return;
  const rows = await db.select().from(engagementProfilesTable).where(eq(engagementProfilesTable.guildId, message.guild.id)).orderBy(desc(engagementProfilesTable.reputation)).limit(10);
  const lines = await Promise.all(rows.map(async (row, index) => `${index + 1}. **${(await message.client.users.fetch(row.userId).catch(() => null))?.tag ?? row.userId}** — ${row.reputation}`));
  await message.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle("Reputation leaderboard").setDescription(lines.join("\n") || "No reputation has been recorded yet.")] });
}

async function commandReputation(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const member = memberFromMessage(message, args);
  if (!member) return void await message.reply("That member could not be found.");
  const profile = await getProfile(message.guild.id, member.id);
  await message.reply(`⭐ **${member.user.tag}** has **${profile.reputation} reputation**.`);
}

async function commandReward(message: Message, kind: "daily" | "weekly" | "monthly"): Promise<void> {
  if (!message.guild) return;
  const profile = await getProfile(message.guild.id, message.author.id);
  const field = kind === "daily" ? "lastDailyAt" : kind === "weekly" ? "lastWeeklyAt" : "lastMonthlyAt";
  const streakField = kind === "daily" ? "dailyStreak" : kind === "weekly" ? "weeklyStreak" : "monthlyStreak";
  const cooldown = kind === "daily" ? DAY : kind === "weekly" ? DAY * 7 : DAY * 30;
  const last = profile[field];
  if (!cooldownReady(last, cooldown)) return void await message.reply(`Your ${kind} reward is ready ${cooldownText(last, cooldown)}.`);
  const streak = (profile[streakField] ?? 0) + 1;
  const base = kind === "daily" ? 250 : kind === "weekly" ? 1_500 : 5_000;
  const coins = base + Math.min(10, streak) * (kind === "daily" ? 25 : 100);
  await updateProfile(message.guild.id, message.author.id, { [field]: new Date(), [streakField]: streak, wallet: sql`${engagementProfilesTable.wallet} + ${coins}`, totalEarned: sql`${engagementProfilesTable.totalEarned} + ${coins}` } as never);
  await audit(message, `${kind}_reward`, message.author.id, { streak: streak - 1 }, { streak, coins });
  await message.reply(`🎁 You claimed **${kind} reward**: **${coins.toLocaleString()} coins**. Streak: **${streak}**.`);
}

async function economyProfile(message: Message): Promise<EngagementProfile> {
  return getProfile(message.guild!.id, message.author.id);
}

async function commandBalance(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const target = memberFromMessage(message, args) ?? message.member;
  if (!target) return;
  const profile = await getProfile(message.guild.id, target.id);
  await message.reply({ embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`${target.user.username}'s wallet`).addFields(
    { name: "Wallet", value: `${profile.wallet.toLocaleString()} coins`, inline: true },
    { name: "Bank", value: `${profile.bank.toLocaleString()} coins`, inline: true },
    { name: "Total earned", value: `${profile.totalEarned.toLocaleString()} coins`, inline: true },
  )] });
}

async function commandTransfer(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const target = memberFromMessage(message, args);
  const amount = Math.max(1, Math.floor(Number(args.find((value) => /^\d+$/.test(value))) || 0));
  if (!target || target.id === message.author.id || !amount) return void await message.reply("Usage: `&pay @user <amount>`.");
  const sender = await getProfile(message.guild.id, message.author.id);
  if (sender.wallet < amount) return void await message.reply("You do not have enough wallet coins.");
  const [updated] = await db.update(engagementProfilesTable).set({ wallet: sql`${engagementProfilesTable.wallet} - ${amount}` }).where(and(eq(engagementProfilesTable.guildId, message.guild.id), eq(engagementProfilesTable.userId, message.author.id), gte(engagementProfilesTable.wallet, amount))).returning();
  if (!updated) return void await message.reply("Your balance changed before the transfer completed. Try again.");
  await updateProfile(message.guild.id, target.id, { wallet: sql`${engagementProfilesTable.wallet} + ${amount}`, totalEarned: sql`${engagementProfilesTable.totalEarned} + ${amount}` } as never);
  await message.reply(`💸 ${message.author} paid **${amount.toLocaleString()} coins** to ${target}.`);
}

async function commandBank(message: Message, args: string[], action: "deposit" | "withdraw"): Promise<void> {
  if (!message.guild) return;
  const amount = Math.max(0, Math.floor(Number(args[0]) || 0));
  const profile = await economyProfile(message);
  const source = action === "deposit" ? profile.wallet : profile.bank;
  if (!amount || source < amount) return void await message.reply(`You do not have enough ${action === "deposit" ? "wallet" : "bank"} coins.`);
  await updateProfile(message.guild.id, message.author.id, action === "deposit"
    ? { wallet: sql`${engagementProfilesTable.wallet} - ${amount}`, bank: sql`${engagementProfilesTable.bank} + ${amount}` } as never
    : { wallet: sql`${engagementProfilesTable.wallet} + ${amount}`, bank: sql`${engagementProfilesTable.bank} - ${amount}` } as never);
  await message.reply(`✅ **${amount.toLocaleString()} coins** ${action === "deposit" ? "deposited into" : "withdrawn from"} your bank.`);
}

async function commandEarning(message: Message, kind: "work" | "beg" | "crime" | "rob"): Promise<void> {
  if (!message.guild) return;
  const profile = await economyProfile(message);
  const field = kind === "work" ? "lastWorkAt" : kind === "beg" ? "lastBegAt" : kind === "crime" ? "lastCrimeAt" : "lastRobAt";
  const cooldown = kind === "work" ? 3_600_000 : kind === "beg" ? 60_000 : kind === "crime" ? 300_000 : 600_000;
  if (!cooldownReady(profile[field], cooldown)) return void await message.reply(`Try again ${cooldownText(profile[field], cooldown)}.`);
  if (kind === "rob") {
    const target = memberFromMessage(message);
    if (!target || target.id === message.author.id) return void await message.reply("Mention someone to rob.");
    const targetProfile = await getProfile(message.guild.id, target.id);
    if (targetProfile.wallet < 50) return void await message.reply("That member does not have enough wallet coins.");
    if (Math.random() > 0.45) {
      await updateProfile(message.guild.id, message.author.id, { lastRobAt: new Date(), wallet: sql`${engagementProfilesTable.wallet} - 100` } as never);
      return void await message.reply("🚓 The robbery failed and you paid a **100 coin** fine.");
    }
    const amount = Math.max(25, Math.floor(targetProfile.wallet * 0.15));
    await updateProfile(message.guild.id, target.id, { wallet: sql`${engagementProfilesTable.wallet} - ${amount}` } as never);
    await updateProfile(message.guild.id, message.author.id, { lastRobAt: new Date(), wallet: sql`${engagementProfilesTable.wallet} + ${amount}`, totalEarned: sql`${engagementProfilesTable.totalEarned} + ${amount}` } as never);
    return void await message.reply(`🕵️ You robbed **${amount.toLocaleString()} coins** from ${target}.`);
  }
  const ranges = { work: [150, 450], beg: [10, 80], crime: [250, 900] } as const;
  const [min, max] = ranges[kind as "work" | "beg" | "crime"];
  const amount = min + Math.floor(Math.random() * (max - min + 1));
  await updateProfile(message.guild.id, message.author.id, { [field]: new Date(), wallet: sql`${engagementProfilesTable.wallet} + ${amount}`, totalEarned: sql`${engagementProfilesTable.totalEarned} + ${amount}` } as never);
  await message.reply(`${kind === "work" ? "💼" : kind === "beg" ? "🥺" : "🎭"} You earned **${amount.toLocaleString()} coins**.`);
}

async function commandShop(message: Message): Promise<void> {
  if (!message.guild) return;
  const rows = await db.select().from(engagementItemsTable).where(eq(engagementItemsTable.guildId, message.guild.id)).orderBy(engagementItemsTable.category, engagementItemsTable.price).limit(50);
  await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`${message.guild.name} shop`).setDescription(rows.length ? rows.map((item) => `**${item.name}** · ${item.price.toLocaleString()} coins · ${item.stock < 0 ? "∞" : `${item.stock} in stock`}\n${item.description || "No description."}`).join("\n\n").slice(0, 4_000) : "The shop is empty. An administrator can add items with `&additem <name> | <price> | <category> | <description>`.")] });
}

async function findItem(guildId: string, name?: string): Promise<EngagementItem | undefined> {
  if (!name) return undefined;
  const rows = await db.select().from(engagementItemsTable).where(eq(engagementItemsTable.guildId, guildId)).limit(100);
  return rows.find((item) => item.name.toLowerCase() === name.toLowerCase() || item.id.startsWith(name));
}

async function commandBuy(message: Message, args: string[], action: "buy" | "sell"): Promise<void> {
  if (!message.guild) return;
  const item = await findItem(message.guild.id, args[0]);
  const quantity = Math.max(1, Math.min(100, Number(args[1]) || 1));
  if (!item) return void await message.reply("That item is not in the shop.");
  const profile = await economyProfile(message);
  if (action === "buy") {
    if (item.stock >= 0 && item.stock < quantity) return void await message.reply("That item does not have enough stock.");
    const cost = item.price * quantity;
    if (profile.wallet < cost) return void await message.reply("You do not have enough wallet coins.");
    await updateProfile(message.guild.id, message.author.id, { wallet: sql`${engagementProfilesTable.wallet} - ${cost}` } as never);
    await db.insert(engagementInventoryTable).values({ id: randomUUID(), guildId: message.guild.id, userId: message.author.id, itemId: item.id, quantity }).onConflictDoUpdate({ target: [engagementInventoryTable.guildId, engagementInventoryTable.userId, engagementInventoryTable.itemId], set: { quantity: sql`${engagementInventoryTable.quantity} + ${quantity}` } });
    if (item.stock >= 0) await db.update(engagementItemsTable).set({ stock: sql`${engagementItemsTable.stock} - ${quantity}` }).where(eq(engagementItemsTable.id, item.id));
    return void await message.reply(`✅ You bought **${quantity}× ${item.name}** for **${cost.toLocaleString()} coins**.`);
  }
  const [inventory] = await db.select().from(engagementInventoryTable).where(and(eq(engagementInventoryTable.guildId, message.guild.id), eq(engagementInventoryTable.userId, message.author.id), eq(engagementInventoryTable.itemId, item.id))).limit(1);
  if (!inventory || inventory.quantity < quantity) return void await message.reply("You do not own enough of that item.");
  const value = item.sellPrice * quantity;
  await db.update(engagementInventoryTable).set({ quantity: sql`${engagementInventoryTable.quantity} - ${quantity}` }).where(eq(engagementInventoryTable.id, inventory.id));
  await updateProfile(message.guild.id, message.author.id, { wallet: sql`${engagementProfilesTable.wallet} + ${value}`, totalEarned: sql`${engagementProfilesTable.totalEarned} + ${value}` } as never);
  if (item.stock >= 0) await db.update(engagementItemsTable).set({ stock: sql`${engagementItemsTable.stock} + ${quantity}` }).where(eq(engagementItemsTable.id, item.id));
  await message.reply(`✅ You sold **${quantity}× ${item.name}** for **${value.toLocaleString()} coins**.`);
}

async function commandInventory(message: Message): Promise<void> {
  if (!message.guild) return;
  const rows = await db.select({ inventory: engagementInventoryTable, item: engagementItemsTable }).from(engagementInventoryTable).innerJoin(engagementItemsTable, eq(engagementInventoryTable.itemId, engagementItemsTable.id)).where(and(eq(engagementInventoryTable.guildId, message.guild.id), eq(engagementInventoryTable.userId, message.author.id), gte(engagementInventoryTable.quantity, 1)));
  await message.reply({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`${message.author.username}'s inventory`).setDescription(rows.length ? rows.map(({ inventory, item }) => `${inventory.equipped ? "🟢" : "▫️"} **${item.name}** ×${inventory.quantity} · ${item.category}`).join("\n") : "Your inventory is empty.")] });
}

async function commandInventoryAction(message: Message, args: string[], action: "use" | "equip" | "unequip"): Promise<void> {
  if (!message.guild || !args[0]) return void await message.reply(`Usage: \`&${action} <item>\`.`);
  const item = await findItem(message.guild.id, args[0]);
  if (!item) return void await message.reply("Item not found.");
  const [inventory] = await db.select().from(engagementInventoryTable).where(and(eq(engagementInventoryTable.guildId, message.guild.id), eq(engagementInventoryTable.userId, message.author.id), eq(engagementInventoryTable.itemId, item.id))).limit(1);
  if (!inventory || inventory.quantity < 1) return void await message.reply("You do not own that item.");
  if (action === "use") {
    if (item.category !== "consumable") return void await message.reply("That item cannot be consumed.");
    await db.update(engagementInventoryTable).set({ quantity: sql`${engagementInventoryTable.quantity} - 1` }).where(eq(engagementInventoryTable.id, inventory.id));
    return void await message.reply(`✨ You used **${item.name}**.`);
  }
  await db.update(engagementInventoryTable).set({ equipped: action === "equip" }).where(eq(engagementInventoryTable.id, inventory.id));
  await message.reply(`✅ **${item.name}** ${action === "equip" ? "equipped" : "unequipped"}.`);
}

async function ensureDefaultAchievements(guildId: string): Promise<void> {
  const defaults = [
    ["First message", "Send your first message.", "messages", 1, 100, 25],
    ["Chat regular", "Send 100 messages.", "messages", 100, 500, 100],
    ["Rising star", "Reach level 5.", "level", 5, 750, 250],
    ["Community voice", "Earn 10 reputation.", "reputation", 10, 1_000, 300],
  ] as const;
  for (const [name, description, metric, target, coins, xp] of defaults) await db.insert(engagementAchievementsTable).values({ id: `${guildId}:${name.toLowerCase().replace(/\s+/g, "-")}`, guildId, name, description, metric, target, rewardCoins: coins, rewardXp: xp }).onConflictDoNothing({ target: [engagementAchievementsTable.guildId, engagementAchievementsTable.name] });
}

async function updateAchievementProgress(guildId: string, userId: string, metric: string, progress: number): Promise<void> {
  await ensureDefaultAchievements(guildId);
  const achievements = await db.select().from(engagementAchievementsTable).where(and(eq(engagementAchievementsTable.guildId, guildId), eq(engagementAchievementsTable.metric, metric)));
  for (const achievement of achievements) {
    const [current] = await db.select().from(engagementUserAchievementsTable).where(and(eq(engagementUserAchievementsTable.guildId, guildId), eq(engagementUserAchievementsTable.userId, userId), eq(engagementUserAchievementsTable.achievementId, achievement.id))).limit(1);
    const next = Math.min(achievement.target, metric === "level" ? progress : (current?.progress ?? 0) + progress);
    if (!current) await db.insert(engagementUserAchievementsTable).values({ id: randomUUID(), guildId, userId, achievementId: achievement.id, progress: next, unlockedAt: next >= achievement.target ? new Date() : null });
    else if (!current.unlockedAt) await db.update(engagementUserAchievementsTable).set({ progress: next, unlockedAt: next >= achievement.target ? new Date() : null }).where(eq(engagementUserAchievementsTable.id, current.id));
    if (next >= achievement.target && !current?.unlockedAt) await updateProfile(guildId, userId, { wallet: sql`${engagementProfilesTable.wallet} + ${achievement.rewardCoins}`, xp: sql`${engagementProfilesTable.xp} + ${achievement.rewardXp}` } as never);
  }
}

async function commandAchievements(message: Message, action: "list" | "one" | "leaderboard", args: string[]): Promise<void> {
  if (!message.guild) return;
  await ensureDefaultAchievements(message.guild.id);
  if (action === "leaderboard") {
    const rows = await db.select({ userId: engagementUserAchievementsTable.userId, count: sql<number>`count(*)` }).from(engagementUserAchievementsTable).where(and(eq(engagementUserAchievementsTable.guildId, message.guild.id), sql`${engagementUserAchievementsTable.unlockedAt} is not null`)).groupBy(engagementUserAchievementsTable.userId).orderBy(desc(sql`count(*)`)).limit(10);
    await message.reply(rows.length ? rows.map((row, index) => `${index + 1}. <@${row.userId}> — **${row.count}** unlocked`).join("\n") : "No achievements unlocked yet.");
    return;
  }
  const achievements = await db.select().from(engagementAchievementsTable).where(eq(engagementAchievementsTable.guildId, message.guild.id));
  if (action === "one") {
    const query = args.join(" ").toLowerCase();
    const achievement = achievements.find((item) => item.name.toLowerCase().includes(query));
    return void await message.reply(achievement ? `**${achievement.name}** — ${achievement.description}\nProgress target: **${achievement.target} ${achievement.metric}**\nRewards: **${achievement.rewardCoins} coins**, **${achievement.rewardXp} XP**` : "Achievement not found.");
  }
  const [unlocked] = await db.select({ count: sql<number>`count(*)` }).from(engagementUserAchievementsTable).where(and(eq(engagementUserAchievementsTable.guildId, message.guild.id), eq(engagementUserAchievementsTable.userId, message.author.id), sql`${engagementUserAchievementsTable.unlockedAt} is not null`));
  await message.reply({ embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle("Achievements").setDescription(achievements.map((item) => `🏆 **${item.name}** — ${item.description}`).join("\n")).setFooter({ text: `${Number(unlocked?.count ?? 0)}/${achievements.length} unlocked` })] });
}

async function commandBirthday(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const action = args.shift()?.toLowerCase();
  if (action === "set") {
    const match = args.join(" ").match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/);
    if (!match || Number(match[1]) > 12 || Number(match[2]) > 31) return void await message.reply("Usage: `&birthday set MM-DD` or `&birthday set MM-DD-YYYY`.");
    await db.insert(engagementBirthdaysTable).values({ id: randomUUID(), guildId: message.guild.id, userId: message.author.id, month: Number(match[1]), day: Number(match[2]), year: match[3] ? Number(match[3]) : null }).onConflictDoUpdate({ target: [engagementBirthdaysTable.guildId, engagementBirthdaysTable.userId], set: { month: Number(match[1]), day: Number(match[2]), year: match[3] ? Number(match[3]) : null } });
    return void await message.reply(`🎂 Birthday saved for **${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}**.`);
  }
  if (action === "remove") {
    await db.delete(engagementBirthdaysTable).where(and(eq(engagementBirthdaysTable.guildId, message.guild.id), eq(engagementBirthdaysTable.userId, message.author.id)));
    return void await message.reply("✅ Birthday removed.");
  }
  const member = memberFromMessage(message, args);
  const [birthday] = await db.select().from(engagementBirthdaysTable).where(and(eq(engagementBirthdaysTable.guildId, message.guild.id), eq(engagementBirthdaysTable.userId, member?.id ?? message.author.id))).limit(1);
  await message.reply(birthday ? `🎂 ${member?.user.username ?? message.author.username}'s birthday is **${birthday.month.toString().padStart(2, "0")}-${birthday.day.toString().padStart(2, "0")}**.` : "No birthday is set.");
}

async function commandSuggest(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  const settings = await getSettings(message.guild.id);
  const channelId = settings.suggestionsChannelId ?? message.channel.id;
  const channel = message.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased() || !("send" in channel)) return void await message.reply("The suggestions channel is not available.");
  const content = args.join(" ").trim();
  if (!content) return void await message.reply("Usage: `&suggest <idea>`.");
  const suggestion = { id: randomUUID(), guildId: message.guild.id, channelId, authorId: message.author.id, content: content.slice(0, 2_000), anonymous: settings.anonymousSuggestions, status: "pending" as const, upvotes: 0, downvotes: 0 };
  const sent = await channel.send({
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle("💡 New suggestion").setDescription(suggestion.content).setFooter({ text: settings.anonymousSuggestions ? "Anonymous suggestion" : `Suggested by ${message.author.tag}` }).setTimestamp()],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`engagement:suggestion:up:${suggestion.id}`).setLabel("Upvote").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`engagement:suggestion:down:${suggestion.id}`).setLabel("Downvote").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`engagement:suggestion:comment:${suggestion.id}`).setLabel("Staff decision").setStyle(ButtonStyle.Secondary),
    )],
  });
  await db.insert(engagementSuggestionsTable).values({ ...suggestion, messageId: sent.id });
  await message.reply(`✅ Suggestion submitted in <#${channelId}>.`);
}

async function commandSuggestionSetup(message: Message): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  await message.reply({
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle("Suggestion setup").setDescription("Use the panel to configure the current server's suggestion channel and privacy.")],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("engagement:setup:suggestions:open").setLabel("Configure").setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId("engagement:setup:cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger))],
  });
}

async function commandSuggestionDecision(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const status = args.shift()?.toLowerCase();
  const id = args.shift();
  const comment = args.join(" ").replace(/^\|\s*/, "").trim();
  if (!status || !["accept", "reject", "consider"].includes(status) || !id) {
    return void await message.reply("Usage: `&suggestion accept|reject|consider <suggestion-id> | comment`.");
  }
  const rows = await db.select().from(engagementSuggestionsTable).where(eq(engagementSuggestionsTable.guildId, message.guild.id));
  const suggestion = rows.find((row) => row.id === id || row.id.startsWith(id));
  if (!suggestion) return void await message.reply("Suggestion not found.");
  await db.update(engagementSuggestionsTable).set({ status, staffComment: comment || null }).where(eq(engagementSuggestionsTable.id, suggestion.id));
  await audit(message, `suggestion_${status}`, suggestion.id, { status: suggestion.status, staffComment: suggestion.staffComment }, { status, staffComment: comment || null });
  const channel = await message.client.channels.fetch(suggestion.channelId).catch(() => null);
  if (channel?.isTextBased() && "messages" in channel && suggestion.messageId) {
    const original = await channel.messages.fetch(suggestion.messageId).catch(() => null);
    if (original) {
      const color = status === "accept" ? 0x57f287 : status === "reject" ? 0xed4245 : 0xf1c40f;
      await original.edit({
        embeds: [new EmbedBuilder().setColor(color).setTitle(`💡 Suggestion · ${status}`).setDescription(suggestion.content).addFields({ name: "Staff decision", value: comment || "No comment provided." }).setFooter({ text: `Suggestion ${suggestion.id.slice(0, 8)}` }).setTimestamp()],
      }).catch(() => undefined);
    }
  }
  await message.reply(`✅ Suggestion marked **${status}**.`);
}

async function commandAdminItem(message: Message, args: string[], action: "add" | "remove" | "edit"): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const parts = args.join(" ").split("|").map((value) => value.trim());
  const name = parts.shift();
  if (!name) return void await message.reply(`Usage: &${action}item Name | price | category | description`);
  const item = await findItem(message.guild.id, name);
  if (action === "remove") {
    if (!item) return void await message.reply("Item not found.");
    await db.delete(engagementItemsTable).where(eq(engagementItemsTable.id, item.id));
    await audit(message, "shop_item_removed", item.id, item, null);
    return void await message.reply(`✅ Removed **${item.name}**.`);
  }
  const price = Math.max(0, Number(parts[0]) || 0);
  const category = parts[1] || "general";
  const description = parts.slice(2).join(" | ");
  if (action === "edit" && item) {
    await db.update(engagementItemsTable).set({ price, category, description, sellPrice: Math.floor(price * 0.5) }).where(eq(engagementItemsTable.id, item.id));
    await audit(message, "shop_item_edited", item.id, item, { price, category, description });
    return void await message.reply(`✅ Updated **${item.name}**.`);
  }
  if (action === "edit") return void await message.reply("Item not found.");
  const [created] = await db.insert(engagementItemsTable).values({ id: randomUUID(), guildId: message.guild.id, name, price, sellPrice: Math.floor(price * 0.5), category, description }).returning();
  await audit(message, "shop_item_added", created?.id, null, created);
  await message.reply(`✅ Added **${name}** to the shop.`);
}

async function commandRankCard(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const values = Object.fromEntries(args.join(" ").split("|").map((part) => part.split("=").map((value) => value.trim())).filter(([key, value]) => key && value));
  const old = await getSettings(message.guild.id);
  const rankCard = { ...(old.rankCard ?? {}), ...values };
  await db.update(engagementGuildSettingsTable).set({ rankCard }).where(eq(engagementGuildSettingsTable.guildId, message.guild.id));
  settingsCache.delete(message.guild.id);
  await audit(message, "rank_card_updated", message.guild.id, old.rankCard, rankCard);
  await message.reply("✅ Rank card customization saved. Use `&rank` to preview it.");
}

async function commandLevelRole(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const level = Number(args[0]);
  const role = message.mentions.roles.first() ?? message.guild.roles.cache.get(args[1]);
  if (!Number.isInteger(level) || level < 1 || !role) return void await message.reply("Usage: `&levelrole <level> @role`.");
  const settings = await getSettings(message.guild.id);
  const levelRoles = { ...(settings.levelRoles ?? {}), [String(level)]: role.id };
  await db.update(engagementGuildSettingsTable).set({ levelRoles }).where(eq(engagementGuildSettingsTable.guildId, message.guild.id));
  settingsCache.delete(message.guild.id);
  await audit(message, "level_role_updated", role.id, settings.levelRoles?.[String(level)], role.id);
  await message.reply(`✅ Level **${level}** will grant ${role}.`);
}

async function setupPanel(message: Message, type: "welcome" | "giveaway" | "poll" | "announcement"): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  await message.reply({
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle(`${type[0].toUpperCase()}${type.slice(1)} setup`).setDescription("Configure this feature with the modal, preview before saving, or cancel without changes.")],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`engagement:setup:${type}:open`).setLabel("Configure").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`engagement:setup:${type}:preview`).setLabel("Preview").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("engagement:setup:cancel").setLabel("Cancel").setStyle(ButtonStyle.Danger),
    )],
  });
}

export async function handleEngagementButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("engagement:")) return false;
  const [, type, feature, action] = interaction.customId.split(":");
  if (type === "suggestion") {
    const id = action;
    const [suggestion] = await db.select().from(engagementSuggestionsTable).where(eq(engagementSuggestionsTable.id, id)).limit(1);
    if (!suggestion || !interaction.guild) return void await interaction.reply({ content: "Suggestion not found.", ephemeral: true }), true;
    if (feature === "up" || feature === "down") {
      const vote = feature === "up" ? 1 : -1;
      await db.insert(engagementSuggestionVotesTable).values({ id: randomUUID(), suggestionId: id, userId: interaction.user.id, vote }).onConflictDoUpdate({ target: [engagementSuggestionVotesTable.suggestionId, engagementSuggestionVotesTable.userId], set: { vote } });
      const [counts] = await db.select({ up: sql<number>`sum(case when ${engagementSuggestionVotesTable.vote} = 1 then 1 else 0 end)`, down: sql<number>`sum(case when ${engagementSuggestionVotesTable.vote} = -1 then 1 else 0 end)` }).from(engagementSuggestionVotesTable).where(eq(engagementSuggestionVotesTable.suggestionId, id));
      await db.update(engagementSuggestionsTable).set({ upvotes: Number(counts?.up ?? 0), downvotes: Number(counts?.down ?? 0) }).where(eq(engagementSuggestionsTable.id, id));
      return void await interaction.reply({ content: `Vote recorded. Upvotes: ${Number(counts?.up ?? 0)} · Downvotes: ${Number(counts?.down ?? 0)}`, ephemeral: true }), true;
    }
    if (feature === "comment") {
      const member = interaction.guild ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null) : null;
      if (!member || !member.permissions.has(PermissionFlagsBits.ManageGuild) && !member.permissions.has(PermissionFlagsBits.Administrator)) return void await interaction.reply({ content: "Only staff can make suggestion decisions.", ephemeral: true }), true;
      return void await interaction.reply({ content: "Use `&suggestion accept|reject|consider <id> | comment` to record a staff decision.", ephemeral: true }), true;
    }
  }
  if (type === "setup" && feature === "cancel") return void await interaction.update({ content: "Setup cancelled.", embeds: [], components: [] }), true;
  if (type === "setup" && action === "preview") return void await interaction.reply({ content: "Preview generated from the current saved configuration.", ephemeral: true }), true;
  if (type === "setup" && action === "open") {
    const modal = new (await import("discord.js")).ModalBuilder().setCustomId(`engagement:setup-modal:${feature}`).setTitle("BH SHIELD setup");
    const input = new (await import("discord.js")).TextInputBuilder().setCustomId("configuration").setLabel("Configuration").setPlaceholder("channel=#channel | message=... | color=#5865F2").setStyle((await import("discord.js")).TextInputStyle.Paragraph).setRequired(false);
    modal.addComponents(new ActionRowBuilder<(typeof input)>().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }
  return true;
}

export async function handleEngagementModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("engagement:setup-modal:") || !interaction.guild) return false;
  const configuration = interaction.fields.getTextInputValue("configuration");
  const values = Object.fromEntries(configuration.split("|").map((part) => part.split("=").map((value) => value.trim())).filter(([key, value]) => key && value));
  const type = interaction.customId.split(":").at(-1) ?? "feature";
  if (type === "suggestions") {
    const channelId = values.channel?.match(/\d{15,25}/)?.[0] ?? null;
    const old = await getSettings(interaction.guild.id);
    await db.update(engagementGuildSettingsTable).set({ suggestionsChannelId: channelId ?? old.suggestionsChannelId, anonymousSuggestions: values.anonymous === "true" }).where(eq(engagementGuildSettingsTable.guildId, interaction.guild.id));
    settingsCache.delete(interaction.guild.id);
  } else {
    const old = await getSettings(interaction.guild.id);
    const panelConfig = { ...(old.panelConfig ?? {}), [type]: values };
    await db.update(engagementGuildSettingsTable).set({ panelConfig }).where(eq(engagementGuildSettingsTable.guildId, interaction.guild.id));
    settingsCache.delete(interaction.guild.id);
  }
  await interaction.reply({ content: `✅ ${type} setup saved.`, ephemeral: true });
  return true;
}

export async function handleEngagementCommand(message: Message, command: string, args: string[]): Promise<boolean> {
  const handlers: Record<string, () => Promise<void>> = {
    rank: () => commandRank(message, args),
    level: () => commandRank(message, args),
    leaderboard: () => commandLeaderboard(message, args),
    setlevel: () => commandSetXp(message, args, "level"),
    setxp: () => commandSetXp(message, args, "xp"),
    resetxp: () => commandSetXp(message, args, "reset"),
    xpmultiplier: () => commandXpMultiplier(message, args),
    xpstatus: () => commandXpStatus(message),
    rep: () => commandRep(message, args),
    reputation: () => commandReputation(message, args),
    repleaderboard: () => commandRepLeaderboard(message),
    daily: () => commandReward(message, "daily"),
    weekly: () => commandReward(message, "weekly"),
    monthly: () => commandReward(message, "monthly"),
    balance: () => commandBalance(message, args),
    pay: () => commandTransfer(message, args),
    deposit: () => commandBank(message, args, "deposit"),
    withdraw: () => commandBank(message, args, "withdraw"),
    work: () => commandEarning(message, "work"),
    beg: () => commandEarning(message, "beg"),
    crime: () => commandEarning(message, "crime"),
    rob: () => commandEarning(message, "rob"),
    shop: () => commandShop(message),
    buy: () => commandBuy(message, args, "buy"),
    sell: () => commandBuy(message, args, "sell"),
    inventory: () => commandInventory(message),
    use: () => commandInventoryAction(message, args, "use"),
    equip: () => commandInventoryAction(message, args, "equip"),
    unequip: () => commandInventoryAction(message, args, "unequip"),
    achievements: () => commandAchievements(message, "list", args),
    achievement: () => commandAchievements(message, "one", args),
    achievementleaderboard: () => commandAchievements(message, "leaderboard", args),
    birthday: () => commandBirthday(message, args),
    suggest: () => commandSuggest(message, args),
    suggestion: () => commandSuggestionDecision(message, args),
    suggestionsetup: () => commandSuggestionSetup(message),
    rankcard: () => commandRankCard(message, args),
    levelrole: () => commandLevelRole(message, args),
    additem: () => commandAdminItem(message, args, "add"),
    removeitem: () => commandAdminItem(message, args, "remove"),
    edititem: () => commandAdminItem(message, args, "edit"),
    welcomesetup: () => setupPanel(message, "welcome"),
    giveawaysetup: () => setupPanel(message, "giveaway"),
    pollsetup: () => setupPanel(message, "poll"),
    announcementsetup: () => setupPanel(message, "announcement"),
  };
  const handler = handlers[command];
  if (!handler) return false;
  await handler();
  return true;
}

export async function handleEngagementMessage(message: Message, prefix: string): Promise<void> {
  if (!message.guild || message.author.bot || message.content.trim().startsWith(prefix)) return;
  await grantXp(message).catch((error) => logger.warn({ error: error instanceof Error ? error.message : String(error) }, "Engagement XP award failed"));
}

export function handleEngagementVoiceState(oldState: { channelId: string | null; member?: GuildMember | null; guild: { id: string } }, newState: { channelId: string | null; member?: GuildMember | null; guild: { id: string } }): void {
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;
  const key = `${newState.guild.id}:${member.id}`;
  if (newState.channelId && !oldState.channelId) voiceSessions.set(key, { guildId: newState.guild.id, userId: member.id, startedAt: Date.now() });
  if (!newState.channelId && oldState.channelId) voiceSessions.delete(key);
}

export async function runEngagementMaintenance(client: Client): Promise<void> {
  const now = new Date();
  for (const [key, session] of voiceSessions) {
    if (Date.now() - session.startedAt < 60_000) continue;
    const settings = await getSettings(session.guildId);
    const profile = await getProfile(session.guildId, session.userId);
    const minutes = Math.floor((Date.now() - session.startedAt) / 60_000);
    if (minutes > 0 && cooldownReady(profile.lastVoiceXpAt, 60_000)) await updateProfile(session.guildId, session.userId, { xp: sql`${engagementProfilesTable.xp} + ${minutes * settings.voiceXpPerMinute}`, lastVoiceXpAt: now } as never);
    session.startedAt = Date.now();
  }
  for (const guild of client.guilds.cache.values()) {
    const settings = await getSettings(guild.id);
    const birthdays = await db.select().from(engagementBirthdaysTable).where(and(eq(engagementBirthdaysTable.guildId, guild.id), eq(engagementBirthdaysTable.month, now.getMonth() + 1), eq(engagementBirthdaysTable.day, now.getDate()), or(sql`${engagementBirthdaysTable.lastWishedYear} is null`, lt(engagementBirthdaysTable.lastWishedYear, now.getFullYear()))));
    for (const birthday of birthdays) {
      const channel = settings.birthdayChannelId ? guild.channels.cache.get(settings.birthdayChannelId) : null;
      const member = await guild.members.fetch(birthday.userId).catch(() => null);
      if (channel?.isTextBased() && "send" in channel) await channel.send({ content: `🎂 Happy birthday ${member ?? `<@${birthday.userId}>`}!`, embeds: [new EmbedBuilder().setColor(0xf1c40f).setTitle("Happy birthday!").setDescription(`${member?.user.username ?? "A community member"} is celebrating today.`).setTimestamp()] }).catch(() => undefined);
      if (settings.birthdayRoleId && member) await member.roles.add(settings.birthdayRoleId).catch(() => undefined);
      await db.update(engagementBirthdaysTable).set({ lastWishedYear: now.getFullYear() }).where(eq(engagementBirthdaysTable.id, birthday.id));
    }
  }
}

function rankCardSvg(input: { avatar: string; username: string; level: number; xp: number; current: number; needed: number; rank: number; server: string; color: string; accent: string; background: string }): string {
  const progress = Math.max(0, Math.min(1, input.current / input.needed));
  const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[char] ?? char));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420"><defs><linearGradient id="bg" x1="0" x2="1"><stop stop-color="${esc(input.background)}"/><stop offset="1" stop-color="${esc(input.color)}" stop-opacity=".72"/></linearGradient></defs><rect width="1200" height="420" rx="32" fill="url(#bg)"/><circle cx="155" cy="170" r="92" fill="#0b1020" stroke="${esc(input.accent)}" stroke-width="8"/><image href="${esc(input.avatar)}" x="70" y="85" width="170" height="170" preserveAspectRatio="xMidYMid slice" clip-path="circle(85px at 85px 85px)"/><text x="290" y="110" fill="#fff" font-family="Arial,sans-serif" font-size="38" font-weight="700">${esc(input.username)}</text><text x="290" y="155" fill="#b8c1dc" font-family="Arial,sans-serif" font-size="22">${esc(input.server)}</text><text x="940" y="105" fill="#fff" font-family="Arial,sans-serif" font-size="24">RANK</text><text x="940" y="155" fill="${esc(input.accent)}" font-family="Arial,sans-serif" font-size="48" font-weight="700">#${input.rank}</text><text x="290" y="245" fill="#fff" font-family="Arial,sans-serif" font-size="28">LEVEL ${input.level}</text><text x="940" y="245" fill="#fff" font-family="Arial,sans-serif" font-size="28" text-anchor="end">${input.xp.toLocaleString()} XP</text><rect x="290" y="280" width="740" height="28" rx="14" fill="#0b1020" fill-opacity=".7"/><rect x="290" y="280" width="${740 * progress}" height="28" rx="14" fill="${esc(input.accent)}"/><text x="290" y="350" fill="#dbe4ff" font-family="Arial,sans-serif" font-size="20">${input.current.toLocaleString()} / ${input.needed.toLocaleString()} XP to next level</text></svg>`;
}

export function registerEngagementCommands(): void {
  const names = ["rank", "level", "leaderboard", "setlevel", "setxp", "resetxp", "xpmultiplier", "xpstatus", "rep", "reputation", "repleaderboard", "daily", "weekly", "monthly", "balance", "pay", "deposit", "withdraw", "work", "beg", "crime", "rob", "shop", "buy", "sell", "additem", "removeitem", "edititem", "inventory", "use", "equip", "unequip", "achievements", "achievement", "achievementleaderboard", "birthday", "suggest", "suggestion", "suggestionsetup", "rankcard", "levelrole", "welcomesetup", "giveawaysetup", "pollsetup", "announcementsetup"];
  registerCommands(names.map((name) => ({
    name,
    guildOnly: true,
    category: ["rank", "level", "leaderboard", "setlevel", "setxp", "resetxp", "xpmultiplier", "xpstatus"].includes(name) ? "Leveling" : ["balance", "pay", "deposit", "withdraw", "work", "beg", "crime", "rob", "shop", "buy", "sell", "additem", "removeitem", "edititem", "inventory", "use", "equip", "unequip", "daily", "weekly", "monthly"].includes(name) ? "Economy" : "Community",
    permissions: ["setlevel", "setxp", "resetxp", "xpmultiplier", "additem", "removeitem", "edititem", "rankcard", "levelrole", "welcomesetup", "giveawaysetup", "pollsetup", "announcementsetup", "suggestionsetup", "suggestion"].includes(name) ? ["Manage Server"] : undefined,
    execute: async (message: Message, args: string[]) => handleEngagementCommand(message, name, args),
  })));
}