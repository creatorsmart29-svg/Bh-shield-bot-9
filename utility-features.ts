import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type Message,
} from "discord.js";
import { and, eq, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  autoRepliesTable,
  db,
  giveawaysTable,
  pollsTable,
  type Giveaway,
  type Poll,
} from "@workspace/db";
import { logger } from "./logger";
import { notifyOwnerDMLog } from "./owner-dm-logger";

const COLOR = 0x5865f2;
const MAX_DM_RECIPIENTS = 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handleUtilityFeatureCommand(message: Message, command: string, args: string[]): Promise<boolean> {
  if (!message.guild) return false;
  if (["announce", "dmannounce", "autoreply", "gstart", "gend", "greroll", "gpause", "gresume", "gdelete", "glist"].includes(command)) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild) && !message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
      await message.reply("You need Manage Server permission to use this utility.");
      return true;
    }
  }
  if (command === "announce") return await announce(message, args);
  if (command === "dmannounce") return await dmAnnounce(message, args);
  if (command === "autoreply") return await autoReplyCommand(message, args);
  if (command === "gstart") return await giveawayStart(message, args);
  if (command === "gend") return await giveawayEnd(message, args[0]);
  if (command === "greroll") return await giveawayReroll(message, args[0]);
  if (command === "gpause" || command === "gresume") return await giveawayPause(message, args[0], command === "gresume");
  if (command === "gdelete") return await giveawayDelete(message, args[0]);
  if (command === "glist") return await giveawayList(message);
  if (command === "poll") return await pollCommand(message, args);
  return false;
}

export async function handleUtilityButton(interaction: ButtonInteraction): Promise<boolean> {
  const [, type, id] = interaction.customId.split(":");
  if (type === "giveaway") return giveawayEnter(interaction, id);
  if (type === "poll") return pollVote(interaction, id, Number(interaction.customId.split(":")[3]));
  return false;
}

export async function handleAutoReplyMessage(message: Message, prefix: string): Promise<void> {
  if (!message.guild || message.author.bot || !message.content.trim() || message.content.trim().startsWith(prefix)) return;
  const trigger = message.content.trim().toLocaleLowerCase();
  const [reply] = await db.select().from(autoRepliesTable).where(and(
    eq(autoRepliesTable.guildId, message.guild.id),
    eq(autoRepliesTable.trigger, trigger),
  )).limit(1);
  if (reply && "send" in message.channel && typeof message.channel.send === "function") {
    await message.channel.send(reply.reply).catch((error: unknown) => logger.warn({ error: errorText(error) }, "Auto reply delivery failed"));
  }
}

export async function runUtilityMaintenance(client: Client): Promise<void> {
  const due = await db.select().from(giveawaysTable).where(and(eq(giveawaysTable.status, "active"), lte(giveawaysTable.endsAt, new Date()))).limit(100);
  for (const giveaway of due) await finishGiveaway(client, giveaway);
  const polls = await db.select().from(pollsTable).where(and(eq(pollsTable.status, "active"), lte(pollsTable.endsAt, new Date()))).limit(100);
  for (const poll of polls) await finishPoll(client, poll);
}

async function announce(message: Message, args: string[]): Promise<boolean> {
  const channelMention = message.mentions.channels.first();
  const channel = channelMention?.isTextBased() ? channelMention : message.channel;
  const raw = args.filter((arg) => !arg.startsWith("<#")).join(" ").trim();
  const fields = parsePipeFields(raw);
  if (fields.plain === "true" || fields.mode === "text") {
    if (!channel || !("send" in channel) || typeof channel.send !== "function") return true;
    await channel.send({
      content: fields.description || fields.text || "No announcement content provided.",
      allowedMentions: { parse: fields.ping === "true" || fields.ping === "yes" ? ["everyone"] : [] },
    });
    await message.reply(`✅ Plain announcement sent to ${channelMention ? `<#${channelMention.id}>` : "this channel"}.`);
    logUtility(message, "Plain announcement sent", fields.description || fields.text);
    return true;
  }
  const embed = new EmbedBuilder()
    .setColor(parseColor(fields.color) ?? COLOR)
    .setTitle(fields.title?.slice(0, 256) || "📢 Announcement")
    .setDescription((fields.description || fields.text || "No announcement content provided.").slice(0, 4_000))
    .setTimestamp();
  if (fields.image) embed.setImage(fields.image);
  if (fields.thumbnail) embed.setThumbnail(fields.thumbnail);
  if (fields.footer) embed.setFooter({ text: fields.footer.slice(0, 2_048) });
  if (fields.timestamp === "false" || fields.timestamp === "no") embed.setTimestamp(null);
  if (!channel || !("send" in channel)) return true;
  const shouldPing = fields.ping === "true" || fields.ping === "yes";
  await channel.send({ content: shouldPing ? "@everyone" : undefined, embeds: [embed], allowedMentions: { parse: shouldPing ? ["everyone"] : [] } });
  await message.reply(`✅ Announcement sent to ${channelMention ? `<#${channelMention.id}>` : "this channel"}.`);
  logUtility(message, "Announcement sent", fields.title ?? fields.text);
  return true;
}

async function dmAnnounce(message: Message, args: string[]): Promise<boolean> {
  const targetIds = new Set<string>();
  const targetsEveryone = args.some((arg) => arg.toLowerCase() === "@everyone");
  const roleMentions = [...message.mentions.roles.values()];
  const members = targetsEveryone || roleMentions.length ? await message.guild!.members.fetch() : null;
  if (targetsEveryone && members) {
    for (const member of members.values()) targetIds.add(member.id);
  }
  for (const user of message.mentions.users.values()) targetIds.add(user.id);
  for (const role of roleMentions) {
    if (members) for (const member of members.values()) if (member.roles.cache.has(role.id)) targetIds.add(member.id);
  }
  const content = args.filter((arg) => arg.toLowerCase() !== "@everyone" && !/^<[@&!#]/.test(arg)).join(" ").trim();
  if (!content) {
    await message.reply("Usage: `&dmannounce @everyone|@user|@role <message>`");
    return true;
  }
  const ids = [...targetIds].slice(0, MAX_DM_RECIPIENTS);
  const started = Date.now();
  let successful = 0;
  let failed = 0;
  let skippedBots = 0;
  for (const id of ids) {
    const member = await message.guild!.members.fetch(id).catch(() => null);
    if (!member || member.user.bot) {
      skippedBots++;
      continue;
    }
    try {
      await member.send(content);
      successful++;
    } catch {
      failed++;
    }
    await sleep(550);
  }
  await message.reply(`📨 **DM announcement complete**\n**Total targets:** ${ids.length}\n**Successful:** ${successful}\n**Failed:** ${failed}\n**Skipped bots:** ${skippedBots}\n**Time taken:** ${((Date.now() - started) / 1000).toFixed(1)}s`);
  logUtility(message, "DM announcement completed", `Targets ${ids.length}; successful ${successful}; failed ${failed}`);
  return true;
}

async function autoReplyCommand(message: Message, args: string[]): Promise<boolean> {
  const action = args.shift()?.toLowerCase();
  if (action === "list") {
    const rows = await db.select().from(autoRepliesTable).where(eq(autoRepliesTable.guildId, message.guild!.id));
    await message.reply(rows.length ? rows.map((row) => `\`${row.trigger}\` → ${row.reply}`).join("\n").slice(0, 3_900) : "No auto replies configured.");
    return true;
  }
  if (action === "clear") {
    await db.delete(autoRepliesTable).where(eq(autoRepliesTable.guildId, message.guild!.id));
    await message.reply("✅ All auto replies were cleared.");
    logUtility(message, "Auto replies cleared");
    return true;
  }
  const parsed = parseQuoted(args.join(" "));
  const trigger = parsed[0]?.trim().toLocaleLowerCase();
  if (!trigger) {
    await message.reply("Usage: `&autoreply add \"trigger\" \"reply\"`, `remove \"trigger\"`, `list`, `clear`, or `info \"trigger\"`.");
    return true;
  }
  if (action === "remove") {
    await db.delete(autoRepliesTable).where(and(eq(autoRepliesTable.guildId, message.guild!.id), eq(autoRepliesTable.trigger, trigger)));
    await message.reply(`✅ Auto reply removed for \`${trigger}\`.`);
    logUtility(message, "Auto reply removed", trigger);
    return true;
  }
  if (action === "info") {
    const [row] = await db.select().from(autoRepliesTable).where(and(eq(autoRepliesTable.guildId, message.guild!.id), eq(autoRepliesTable.trigger, trigger))).limit(1);
    await message.reply(row ? `**Trigger:** \`${row.trigger}\`\n**Reply:** ${row.reply}` : "Auto reply not found.");
    return true;
  }
  if (action !== "add" || !parsed[1]?.trim()) {
    await message.reply("Usage: `&autoreply add \"trigger\" \"reply\"`.");
    return true;
  }
  await db.insert(autoRepliesTable).values({ id: randomUUID(), guildId: message.guild!.id, trigger, reply: parsed[1].trim().slice(0, 2_000), createdById: message.author.id }).onConflictDoUpdate({
    target: [autoRepliesTable.guildId, autoRepliesTable.trigger],
    set: { reply: parsed[1].trim().slice(0, 2_000), createdById: message.author.id },
  });
  await message.reply(`✅ Auto reply saved for \`${trigger}\`.`);
  logUtility(message, "Auto reply added", trigger);
  return true;
}

async function giveawayStart(message: Message, args: string[]): Promise<boolean> {
  const [durationText, prize, winnerText, roleMention] = args.join(" ").split("|").map((value) => value.trim());
  const duration = parseDuration(durationText);
  const winners = Math.max(1, Math.min(20, Number(winnerText) || 1));
  if (!duration || !prize) {
    await message.reply("Usage: `&gstart 1h | Prize | 1 | @RequiredRole`");
    return true;
  }
  const role = message.mentions.roles.first();
  const giveaway = { id: randomUUID(), guildId: message.guild!.id, channelId: message.channel.id, hostId: message.author.id, prize: prize.slice(0, 256), winnerCount: winners, requiredRoleId: role?.id ?? null, entries: [] as string[], winners: [] as string[], status: "active" as const, endsAt: new Date(Date.now() + duration) };
  if (!("send" in message.channel) || typeof message.channel.send !== "function") return true;
  const sent = await message.channel.send({
    embeds: [giveawayEmbed(giveaway as Giveaway)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`utility:giveaway:${giveaway.id}`).setLabel("🎉 Enter Giveaway").setStyle(ButtonStyle.Primary))],
  });
  await db.insert(giveawaysTable).values({ ...giveaway, messageId: sent.id });
  await message.reply(`✅ Giveaway started: ${sent.url}`);
  logUtility(message, "Giveaway started", `${giveaway.prize} · ${durationText}`);
  return true;
}

async function giveawayEnter(interaction: ButtonInteraction, id: string): Promise<boolean> {
  const [giveaway] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id)).limit(1);
  if (!giveaway || giveaway.status !== "active") {
    await interaction.reply({ content: "This giveaway is no longer active.", ephemeral: true });
    return true;
  }
  const member = interaction.member as GuildMember;
  if (giveaway.requiredRoleId && !member.roles.cache.has(giveaway.requiredRoleId)) {
    await interaction.reply({ content: "You do not have the required role for this giveaway.", ephemeral: true });
    return true;
  }
  const entries = [...new Set([...(giveaway.entries ?? []), interaction.user.id])];
  await db.update(giveawaysTable).set({ entries }).where(eq(giveawaysTable.id, id));
  await interaction.reply({ content: "You are entered. Good luck!", ephemeral: true });
  return true;
}

async function giveawayEnd(message: Message, id?: string): Promise<boolean> {
  const giveaway = await findGiveaway(message, id);
  if (giveaway) await finishGiveaway(message.client, giveaway);
  await message.reply(giveaway ? "✅ Giveaway ended." : "Giveaway not found.");
  if (giveaway) logUtility(message, "Giveaway ended", giveaway.id);
  return true;
}

async function giveawayReroll(message: Message, id?: string): Promise<boolean> {
  const giveaway = await findGiveaway(message, id);
  if (!giveaway || giveaway.status !== "ended") {
    await message.reply("Use `&greroll <giveaway-id>` after a giveaway ends.");
    return true;
  }
  const winner = pickWinners(giveaway.entries, 1);
  if (winner[0]) await db.update(giveawaysTable).set({ winners: winner }).where(eq(giveawaysTable.id, giveaway.id));
  await message.reply(winner.length ? `🎉 Rerolled winner: <@${winner[0]}> for **${giveaway.prize}**.` : "There are no eligible entries to reroll.");
  logUtility(message, "Giveaway rerolled", giveaway.id);
  return true;
}

async function giveawayPause(message: Message, id: string | undefined, resume: boolean): Promise<boolean> {
  const giveaway = await findGiveaway(message, id);
  if (!giveaway) await message.reply("Giveaway not found.");
  else {
    await db.update(giveawaysTable).set({ status: resume ? "active" : "paused" }).where(eq(giveawaysTable.id, giveaway.id));
    await message.reply(`✅ Giveaway ${resume ? "resumed" : "paused"}.`);
    logUtility(message, `Giveaway ${resume ? "resumed" : "paused"}`, giveaway.id);
  }
  return true;
}

async function giveawayDelete(message: Message, id: string | undefined): Promise<boolean> {
  const giveaway = await findGiveaway(message, id);
  if (!giveaway) await message.reply("Giveaway not found.");
  else {
    const channel = await message.client.channels.fetch(giveaway.channelId).catch(() => null);
    if (channel?.isTextBased() && "messages" in channel) await channel.messages.delete(giveaway.messageId ?? "").catch(() => undefined);
    await db.delete(giveawaysTable).where(eq(giveawaysTable.id, giveaway.id));
    await message.reply("✅ Giveaway deleted from the database.");
    logUtility(message, "Giveaway deleted", giveaway.id);
  }
  return true;
}

async function giveawayList(message: Message): Promise<boolean> {
  const rows = await db.select().from(giveawaysTable).where(and(eq(giveawaysTable.guildId, message.guild!.id), eq(giveawaysTable.status, "active")));
  await message.reply(rows.length ? rows.map((row) => `\`${row.id.slice(0, 8)}\` · **${row.prize}** · ${row.entries.length} entries · <t:${Math.floor(row.endsAt.getTime() / 1000)}:R>`).join("\n") : "No active giveaways.");
  return true;
}

async function pollCommand(message: Message, args: string[]): Promise<boolean> {
  const action = args[0]?.toLowerCase();
  if (action === "end" || action === "results") {
    const poll = await findPoll(message, args[1]);
    if (!poll) await message.reply("Poll not found.");
    else if (action === "end") {
      await finishPoll(message.client, poll);
      await message.reply("✅ Poll ended.");
      logUtility(message, "Poll ended", poll.id);
    } else await message.reply(pollResults(poll));
    return true;
  }
  const [question, ...rest] = args.join(" ").split("|").map((value) => value.trim()).filter(Boolean);
  const options = rest.slice(0, 10);
  if (!question || options.length < 2) {
    await message.reply("Usage: `&poll Question | Option 1 | Option 2 | timed:1h | anonymous`");
    return true;
  }
  const anonymous = options.some((value) => value.toLowerCase() === "anonymous");
  const timed = options.find((value) => value.toLowerCase().startsWith("timed:"));
  const cleanOptions = options.filter((value) => value !== "anonymous" && !value.toLowerCase().startsWith("timed:"));
  const poll = { id: randomUUID(), guildId: message.guild!.id, channelId: message.channel.id, question: question.slice(0, 256), options: cleanOptions, votes: {} as Record<string, number>, voters: {} as Record<string, number>, anonymous, status: "active" as const, endsAt: timed ? new Date(Date.now() + (parseDuration(timed.slice(6)) ?? 86_400_000)) : null };
  if (!("send" in message.channel) || typeof message.channel.send !== "function") return true;
  const sent = await message.channel.send({ embeds: [pollEmbed(poll as Poll)], components: pollRows(poll as Poll) });
  await db.insert(pollsTable).values({ ...poll, messageId: sent.id });
  await message.reply(`✅ Poll created: ${sent.url}`);
  logUtility(message, "Poll created", question);
  return true;
}

async function pollVote(interaction: ButtonInteraction, id: string, option: number): Promise<boolean> {
  const [poll] = await db.select().from(pollsTable).where(eq(pollsTable.id, id)).limit(1);
  if (!poll || poll.status !== "active" || !poll.options[option]) {
    await interaction.reply({ content: "This poll is no longer active.", ephemeral: true });
    return true;
  }
  const voters = { ...(poll.voters ?? {}) };
  const votes = { ...(poll.votes ?? {}) };
  const old = voters[interaction.user.id];
  if (old !== undefined) votes[String(old)] = Math.max(0, (votes[String(old)] ?? 1) - 1);
  voters[interaction.user.id] = option;
  votes[String(option)] = (votes[String(option)] ?? 0) + 1;
  await db.update(pollsTable).set({ votes, voters }).where(eq(pollsTable.id, id));
  await interaction.update({ embeds: [pollEmbed({ ...poll, votes, voters } as Poll)], components: pollRows(poll as Poll) });
  return true;
}

async function finishGiveaway(client: Client, giveaway: Giveaway): Promise<void> {
  if (giveaway.status === "ended") return;
  const winners = pickWinners(giveaway.entries ?? [], giveaway.winnerCount);
  await db.update(giveawaysTable).set({ status: "ended", winners }).where(eq(giveawaysTable.id, giveaway.id));
  const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
  if (channel?.isTextBased() && "messages" in channel && giveaway.messageId) {
    const original = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    await original?.edit({
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 Giveaway ended").setDescription(`**${giveaway.prize}**\n${winners.length ? winners.map((id) => `<@${id}>`).join(", ") : "No eligible winners."}`).setTimestamp()],
      components: [],
    }).catch(() => undefined);
  }
  if (channel?.isTextBased() && "send" in channel) await channel.send({ content: winners.length ? `🎉 Congratulations ${winners.map((id) => `<@${id}>`).join(", ")}!` : "No eligible winners.", embeds: [new EmbedBuilder().setColor(0x57f287).setTitle("🎉 Giveaway ended").setDescription(`**${giveaway.prize}**`).setTimestamp()] });
}

async function finishPoll(client: Client, poll: Poll): Promise<void> {
  if (poll.status === "ended") return;
  await db.update(pollsTable).set({ status: "ended" }).where(eq(pollsTable.id, poll.id));
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  if (channel?.isTextBased() && "messages" in channel && poll.messageId) {
    const original = await channel.messages.fetch(poll.messageId).catch(() => null);
    await original?.edit({ embeds: [pollEmbed(poll).setTitle(`📊 Poll ended · ${poll.question}`)], components: [] }).catch(() => undefined);
  }
  if (channel?.isTextBased() && "send" in channel) await channel.send({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle("📊 Poll ended").setDescription(pollResults(poll)).setTimestamp()] });
}

async function findGiveaway(message: Message, id?: string): Promise<Giveaway | undefined> {
  const rows = await db.select().from(giveawaysTable).where(eq(giveawaysTable.guildId, message.guild!.id));
  return rows.find((row) => !id || row.id === id || row.id.startsWith(id));
}

async function findPoll(message: Message, id?: string): Promise<Poll | undefined> {
  const rows = await db.select().from(pollsTable).where(eq(pollsTable.guildId, message.guild!.id));
  return rows.find((row) => !id || row.id === id || row.id.startsWith(id));
}

function pollRows(poll: Poll): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let index = 0; index < poll.options.length; index += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      poll.options.slice(index, index + 5).map((option, offset) => new ButtonBuilder()
        .setCustomId(`utility:poll:${poll.id}:${index + offset}`)
        .setLabel(`${String.fromCodePoint(0x1f1e6 + index + offset)} ${option}`.slice(0, 80))
        .setStyle(ButtonStyle.Secondary)),
    ));
  }
  return rows;
}

function pollEmbed(poll: Poll) {
  return new EmbedBuilder().setColor(COLOR).setTitle(`📊 ${poll.question}`).setDescription(poll.options.map((option, index) => `${String.fromCodePoint(0x1f1e6 + index)} **${option}** — ${poll.votes?.[String(index)] ?? 0} vote(s)`).join("\n")).setFooter({ text: poll.anonymous ? "Anonymous poll" : "Votes can be changed" }).setTimestamp();
}

function pollResults(poll: Poll): string {
  return `**${poll.question}**\n${poll.options.map((option, index) => `${String.fromCodePoint(0x1f1e6 + index)} ${option}: **${poll.votes?.[String(index)] ?? 0}**`).join("\n")}`;
}

function giveawayEmbed(giveaway: Giveaway) {
  return new EmbedBuilder().setColor(0xf1c40f).setTitle("🎉 Giveaway").setDescription(`**Prize:** ${giveaway.prize}\n**Winners:** ${giveaway.winnerCount}\n**Ends:** <t:${Math.floor(giveaway.endsAt.getTime() / 1000)}:R>\n**Hosted by:** <@${giveaway.hostId}>${giveaway.requiredRoleId ? `\n**Required role:** <@&${giveaway.requiredRoleId}>` : ""}`).setFooter({ text: `Giveaway ID: ${giveaway.id.slice(0, 8)}` }).setTimestamp();
}

function pickWinners(entries: string[], count: number): string[] {
  return [...entries].sort(() => Math.random() - 0.5).slice(0, count);
}

function parseDuration(value: string | undefined): number | null {
  const match = value?.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase() as "s" | "m" | "h" | "d" | "w"];
  return amount > 0 && amount <= 30 ? amount * multiplier : null;
}

function parseQuoted(input: string): string[] {
  const values: string[] = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(regex)) values.push(match[1] ?? match[2] ?? match[3]);
  return values;
}

function parsePipeFields(input: string): Record<string, string> {
  const values = input.split("|").map((value) => value.trim()).filter(Boolean);
  const fields: Record<string, string> = { text: values[0] ?? "" };
  for (const value of values.slice(1)) {
    const separator = value.indexOf("=");
    if (separator > 0) fields[value.slice(0, separator).trim().toLowerCase()] = value.slice(separator + 1).trim();
    else if (!fields.description) fields.description = value;
  }
  return fields;
}

function parseColor(value?: string): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/^#/, "");
  return /^[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : undefined;
}

function logUtility(message: Message, event: string, details?: string): void {
  notifyOwnerDMLog({ category: "command", event, guild: message.guild?.name, channel: message.channel.id, user: `${message.author.tag} (${message.author.id})`, command: message.content.split(/\s+/)[0], details });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}