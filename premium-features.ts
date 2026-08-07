import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type GuildMember,
  type Message,
  type MessageReaction,
  type ModalSubmitInteraction,
  type PartialGuildMember,
  type Role,
  type StringSelectMenuInteraction,
} from "discord.js";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  premiumAfkTable,
  premiumBackupsTable,
  premiumEmbedTemplatesTable,
  premiumGuildSettingsTable,
  premiumReactionRolesTable,
  premiumScheduledTasksTable,
  premiumStarboardEntriesTable,
  premiumStickyMessagesTable,
  premiumTemporaryRolesTable,
  type PremiumGuildSettings,
  type PremiumReactionRole,
  type PremiumScheduledTask,
} from "@workspace/db";
import { registerCommands } from "./command-registry";
import { notifyOwnerDMLog } from "./owner-dm-logger";
import { logger } from "./logger";
import { withRecovery } from "./recovery";

const COLOR = 0x5865f2;
const settingsCache = new Map<string, { value: PremiumGuildSettings; expiresAt: number }>();
const statsUpdateAt = new Map<string, number>();

type PremiumFeature =
  | "autoroles"
  | "reactionroles"
  | "verification"
  | "automod"
  | "starboard"
  | "boost"
  | "stats"
  | "logging";

const FEATURE_LABELS: Record<PremiumFeature, string> = {
  autoroles: "Auto Roles",
  reactionroles: "Reaction Roles",
  verification: "Verification",
  automod: "Auto Moderation",
  starboard: "Starboard",
  boost: "Boost",
  stats: "Server Statistics",
  logging: "Advanced Logging",
};

function isAdmin(message: Message): boolean {
  return Boolean(message.member?.permissions.has(PermissionFlagsBits.ManageGuild) || message.member?.permissions.has(PermissionFlagsBits.Administrator));
}

function textChannel(channel: unknown): channel is { send: (...args: any[]) => Promise<any>; id: string; type: ChannelType } {
  return Boolean(channel && typeof channel === "object" && "send" in channel && typeof (channel as { send?: unknown }).send === "function");
}

function parseId(value?: string): string | undefined {
  return value?.match(/\d{15,25}/)?.[0];
}

function parsePairs(input: string): Record<string, string> {
  return Object.fromEntries(input.split("|").map((part) => {
    const separator = part.indexOf("=");
    return separator > 0 ? [part.slice(0, separator).trim().toLowerCase(), part.slice(separator + 1).trim()] : ["", ""];
  }).filter(([key, value]) => key && value));
}

async function getSettings(guildId: string): Promise<PremiumGuildSettings> {
  const cached = settingsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await withRecovery("load premium guild settings", async () => {
    const [existing] = await db.select().from(premiumGuildSettingsTable).where(eq(premiumGuildSettingsTable.guildId, guildId)).limit(1);
    if (existing) return existing;
    const [created] = await db.insert(premiumGuildSettingsTable).values({ guildId }).returning();
    if (!created) throw new Error(`Premium settings could not be created for ${guildId}.`);
    return created;
  }, { guildId });
  settingsCache.set(guildId, { value, expiresAt: Date.now() + 30_000 });
  return value;
}

async function saveSettings(guildId: string, values: Partial<typeof premiumGuildSettingsTable.$inferInsert>): Promise<PremiumGuildSettings> {
  const [updated] = await withRecovery("save premium guild settings", () => db.update(premiumGuildSettingsTable).set(values).where(eq(premiumGuildSettingsTable.guildId, guildId)).returning(), { guildId });
  settingsCache.delete(guildId);
  return updated ?? getSettings(guildId);
}

async function audit(guild: Guild, actorId: string, action: string, targetId?: string, oldValue?: unknown, newValue?: unknown): Promise<void> {
  notifyOwnerDMLog({
    category: "command",
    event: `Premium: ${action}`,
    guild: `${guild.name} (${guild.id})`,
    user: actorId,
    details: targetId ? `Target: ${targetId}` : undefined,
  });
  logger.info({ guildId: guild.id, actorId, action, targetId, oldValue, newValue }, "BH SHIELD premium action");
}

async function premiumLog(guild: Guild, category: string, title: string, description: string, color = COLOR): Promise<void> {
  const settings = await getSettings(guild.id);
  const channelId = settings.logging?.channels?.[category] ?? settings.logging?.channels?.server;
  if (!settings.logging?.enabled || settings.logging.categories?.[category] === false || !channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (textChannel(channel)) await channel.send({ embeds: [new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp().setFooter({ text: "BH SHIELD advanced logs" })] }).catch(() => undefined);
}

function featureConfig(feature: PremiumFeature, settings: PremiumGuildSettings): Record<string, unknown> {
  if (feature === "autoroles") return (settings.autoRoles ?? {}) as Record<string, unknown>;
  if (feature === "reactionroles") return (settings.setup?.reactionroles ?? {}) as Record<string, unknown>;
  return ((settings[feature] ?? {}) as Record<string, unknown>);
}

function featurePanel(feature: PremiumFeature, settings: PremiumGuildSettings): { embeds: EmbedBuilder[]; components: ActionRowBuilder<any>[] } {
  const config = featureConfig(feature, settings);
  const enabled = config.enabled === true;
  const select = new StringSelectMenuBuilder()
    .setCustomId(`premium:setup-select:${feature}`)
    .setPlaceholder(`Configure ${FEATURE_LABELS[feature]}`)
    .addOptions(
      { label: "Open configuration modal", value: "modal" },
      { label: "Preview current settings", value: "preview" },
      { label: enabled ? "Disable feature" : "Enable feature", value: enabled ? "disable" : "enable" },
    );
  return {
    embeds: [new EmbedBuilder().setColor(enabled ? 0x57f287 : COLOR).setTitle(`BH SHIELD · ${FEATURE_LABELS[feature]}`).setDescription(`${enabled ? "✅ Enabled" : "⚪ Disabled"}\n\nUse the select menu to configure, preview, or toggle this feature. Changes are saved to PostgreSQL and audited.`).addFields({ name: "Current configuration", value: JSON.stringify(config).slice(0, 900) || "No configuration saved." }).setFooter({ text: "Premium setup panel · Cancel closes this message" })],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`premium:setup-preview:${feature}`).setLabel("Preview").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`premium:setup-toggle:${feature}`).setLabel(enabled ? "Disable" : "Enable").setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder().setCustomId("premium:setup-cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function openFeaturePanel(message: Message, feature: PremiumFeature): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const settings = await getSettings(message.guild.id);
  await message.reply(featurePanel(feature, settings));
}

function setupModal(feature: PremiumFeature): ModalBuilder {
  const modal = new ModalBuilder().setCustomId(`premium:setup-modal:${feature}`).setTitle(`${FEATURE_LABELS[feature]} configuration`);
  const configuration = new TextInputBuilder().setCustomId("configuration").setLabel("Configuration").setPlaceholder("enabled=true | channel=#channel | role=@role | message=...").setStyle(TextInputStyle.Paragraph).setRequired(false);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(configuration));
  return modal;
}

async function configureFeature(interaction: ModalSubmitInteraction, feature: PremiumFeature): Promise<void> {
  if (!interaction.guild) return;
  const values = parsePairs(interaction.fields.getTextInputValue("configuration"));
  const settings = await getSettings(interaction.guild.id);
  const key = feature === "autoroles" ? "autoRoles" : feature === "reactionroles" ? "setup" : feature;
  const oldValue = featureConfig(feature, settings);
  const current = (oldValue && typeof oldValue === "object" ? oldValue : {}) as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...current };
  for (const [keyName, value] of Object.entries(values)) {
    const canonical = ({
      channel: "channelId",
      logchannel: "logChannelId",
      verifiedrole: "verifiedRoleId",
      boosterrole: "boosterRoleId",
      humanroles: "humanRoleIds",
      botroles: "botRoleIds",
      welcomeroles: "welcomeRoleIds",
      temporaryroles: "temporaryRoleIds",
      removeroles: "removeRoleIds",
      roleids: "roleIds",
      minimumstars: "minimumStars",
      joindelayseconds: "joinDelaySeconds",
      autotimeoutseconds: "autoTimeoutSeconds",
      rewardcoins: "rewardCoins",
      ignorebots: "ignoreBots",
      ignoresfw: "ignoreNsfw",
      autoupdate: "autoUpdate",
      singlerolemode: "singleRoleMode",
      toggleroles: "toggleRoles",
      removerolesmode: "removeRoles",
      autoverify: "autoVerify",
      welcomeafterverification: "welcomeAfterVerification",
      autowarn: "autoWarn",
      autodelete: "autoDelete",
    } as Record<string, string>)[keyName] ?? keyName;
    if (["enabled", "ignoreBots", "ignoreNsfw", "autoUpdate", "singleRoleMode", "toggleRoles", "removeRoles", "autoVerify", "autoWarn", "autoDelete"].includes(canonical)) normalized[canonical] = value === "true";
    else if (["minimumStars", "joinDelaySeconds", "autoTimeoutSeconds", "rewardCoins"].includes(canonical)) normalized[canonical] = Number(value) || 0;
    else if (canonical.endsWith("RoleId") || canonical.endsWith("ChannelId")) normalized[canonical] = parseId(value) ?? value;
    else if (["humanRoleIds", "botRoleIds", "welcomeRoleIds", "temporaryRoleIds", "removeRoleIds", "roleIds"].includes(canonical)) normalized[canonical] = value.split(",").map((item) => parseId(item) ?? item).filter(Boolean);
    else normalized[canonical] = value;
  }
  if (feature === "reactionroles" && interaction.guild) {
    const channelId = parseId(values.channel ?? values.channelid);
    const messageId = parseId(values.message ?? values.messageid);
    const roleIds = (values.roles ?? values.roleids ?? "").split(",").map((item) => parseId(item) ?? item).filter(Boolean);
    const emojiRoles = Object.fromEntries((values.emojis ?? "").split(",").map((item) => item.split(":")).filter(([emoji, role]) => emoji && role).map(([emoji, role]) => [emoji.trim(), parseId(role.trim()) ?? role.trim()]));
    if (channelId && roleIds.length) {
      const [row] = await db.insert(premiumReactionRolesTable).values({
        id: randomUUID(),
        guildId: interaction.guild.id,
        channelId,
        messageId,
        mode: values.mode ?? "button",
        roleIds,
        emojiRoles,
        singleRoleMode: values.singlerolemode === "true",
        toggleRoles: values.toggleroles !== "false",
        removeRoles: values.removeroles !== "false",
        label: values.label ?? "Choose your roles",
      }).returning();
      const channel = interaction.guild.channels.cache.get(channelId);
      if (!messageId && textChannel(channel)) {
        const buttons = roleIds.slice(0, 5).map((roleId, index) => new ButtonBuilder().setCustomId(`premium:role:${row?.id}:${roleId}`).setLabel(interaction.guild!.roles.cache.get(roleId)?.name ?? `Role ${index + 1}`).setStyle(ButtonStyle.Secondary));
        const sent = await channel.send({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle(values.label ?? "Choose your roles").setDescription("Use the buttons below to manage your server roles.")], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(buttons)] }).catch(() => null);
        if (sent && row) await db.update(premiumReactionRolesTable).set({ messageId: sent.id }).where(eq(premiumReactionRolesTable.id, row.id));
      }
    }
  }
  if (feature === "verification" && interaction.guild) {
    const verification = normalized as { enabled?: boolean; channelId?: string; verifiedRoleId?: string; messageId?: string };
    if (verification.enabled && verification.channelId && verification.verifiedRoleId && !verification.messageId) {
      const channel = interaction.guild.channels.cache.get(verification.channelId);
      if (textChannel(channel)) {
        const sent = await channel.send({
          embeds: [new EmbedBuilder().setColor(COLOR).setTitle("BH SHIELD Verification").setDescription("Click the button below to verify your membership and receive access.")],
          components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("premium:verify").setLabel("Verify").setStyle(ButtonStyle.Success))],
        }).catch(() => null);
        if (sent) normalized.messageId = sent.id;
      }
    }
  }
  const nextValue = feature === "reactionroles"
    ? { ...(settings.setup ?? {}), reactionroles: normalized }
    : normalized;
  await saveSettings(interaction.guild.id, { [key]: nextValue } as never);
  await audit(interaction.guild, interaction.user.id, `${feature}_configured`, interaction.guild.id, oldValue, normalized);
  await interaction.reply({ content: `✅ ${FEATURE_LABELS[feature]} configuration saved.`, ephemeral: true });
}

async function toggleFeature(interaction: ButtonInteraction, feature: PremiumFeature): Promise<void> {
  if (!interaction.guild) return;
  const settings = await getSettings(interaction.guild.id);
  const key = feature === "autoroles" ? "autoRoles" : feature === "reactionroles" ? "setup" : feature;
  const current = featureConfig(feature, settings);
  const enabled = current.enabled !== true;
  const next = { ...current, enabled };
  const nextValue = feature === "reactionroles"
    ? { ...(settings.setup ?? {}), reactionroles: next }
    : next;
  await saveSettings(interaction.guild.id, { [key]: nextValue } as never);
  await audit(interaction.guild, interaction.user.id, `${feature}_${enabled ? "enabled" : "disabled"}`, interaction.guild.id, current, next);
  await interaction.update(featurePanel(feature, { ...settings, [key]: next } as PremiumGuildSettings));
}

async function commandSetup(message: Message): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const settings = await getSettings(message.guild.id);
  const entries: [string, string][] = [
    ["Welcome / Leave", "&welcomesetup · &setleave"],
    ["Auto Roles", "&autorolesetup"],
    ["Ticket Setup", "&panel create"],
    ["Giveaways / Polls / Announcements", "&giveawaysetup · &pollsetup · &announcementsetup"],
    ["AI Setup", "&ai on|off|status"],
    ["Logging", "&log add · &setup logging"],
    ["Auto Moderation", "&automodsetup"],
    ["Verification", "&verifysetup"],
    ["Reaction Roles", "&reactionrolesetup"],
    ["Invite Tracking", "&invites · &inviteleaderboard"],
    ["Economy / Leveling", "&shop · &xpstatus"],
  ];
  const select = new StringSelectMenuBuilder().setCustomId("premium:dashboard-select").setPlaceholder("Choose a setup area").addOptions(entries.map(([label, value]) => ({ label, value: label.toLowerCase().split(" ")[0] })));
  await message.reply({
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle("BH SHIELD · Premium Setup Dashboard").setDescription("One central control surface for community, protection, engagement, and operations. Choose a setup area below; existing legacy commands remain available.").addFields({ name: "Configured systems", value: `${Object.keys(settings.setup ?? {}).length} premium sections have saved state.` }).setFooter({ text: "Manage Server required · PostgreSQL-backed configuration" })],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

async function commandAfk(message: Message, args: string[]): Promise<void> {
  if (!message.guild) return;
  if (args[0]?.toLowerCase() === "remove" || args[0]?.toLowerCase() === "off") {
    await db.delete(premiumAfkTable).where(and(eq(premiumAfkTable.guildId, message.guild.id), eq(premiumAfkTable.userId, message.author.id)));
    return void await message.reply("✅ Your AFK status has been removed.");
  }
  const scope = args[0]?.toLowerCase() === "global" ? "global" : "server";
  if (scope === "global") args.shift();
  const reason = args.join(" ").trim() || "AFK";
  await db.insert(premiumAfkTable).values({ id: randomUUID(), guildId: scope === "global" ? "*" : message.guild.id, userId: message.author.id, scope, reason: reason.slice(0, 500) }).onConflictDoUpdate({ target: [premiumAfkTable.guildId, premiumAfkTable.userId, premiumAfkTable.scope], set: { reason: reason.slice(0, 500), createdAt: new Date() } });
  await message.reply(`💤 You are now AFK: **${reason.slice(0, 200)}**`);
}

async function commandSticky(message: Message, args: string[], remove = false): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  if (remove) {
    await db.delete(premiumStickyMessagesTable).where(and(eq(premiumStickyMessagesTable.guildId, message.guild.id), eq(premiumStickyMessagesTable.channelId, message.channel.id)));
    return void await message.reply("✅ Sticky messages removed from this channel.");
  }
  const content = args.join(" ").trim();
  if (!content) return void await message.reply("Usage: `&sticky <message>`.");
  await db.insert(premiumStickyMessagesTable).values({ id: randomUUID(), guildId: message.guild.id, channelId: message.channel.id, content: content.slice(0, 2_000), createdById: message.author.id }).onConflictDoNothing();
  await message.reply("✅ Sticky message saved for this channel.");
}

async function commandEmbedBuilder(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const values = parsePairs(args.join(" "));
  const payload = {
    title: values.title ?? "BH SHIELD Embed",
    description: values.description ?? "Edit this embed with `key=value` pairs.",
    color: values.color ?? "#5865F2",
    image: values.image,
    thumbnail: values.thumbnail,
    footer: values.footer,
    author: values.author,
  };
  const embed = new EmbedBuilder().setColor(payload.color as `#${string}`).setTitle(payload.title).setDescription(payload.description).setTimestamp();
  if (payload.image) embed.setImage(payload.image);
  if (payload.thumbnail) embed.setThumbnail(payload.thumbnail);
  if (payload.footer) embed.setFooter({ text: payload.footer });
  if (payload.author) embed.setAuthor({ name: payload.author });
  await message.reply({ embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId("premium:embed-save").setLabel("Save template").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId("premium:setup-cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary))] });
}

async function commandBackup(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const guild = message.guild;
  const action = args.shift()?.toLowerCase();
  if (action === "list") {
    const rows = await db.select().from(premiumBackupsTable).where(eq(premiumBackupsTable.guildId, message.guild.id)).orderBy(desc(premiumBackupsTable.createdAt)).limit(20);
    return void await message.reply(rows.length ? rows.map((row) => `\`${row.id.slice(0, 8)}\` · **${row.label}** · <t:${Math.floor(row.createdAt.getTime() / 1000)}:R>`).join("\n") : "No backups exist.");
  }
  if (action === "delete") {
    const id = args[0];
    if (!id) return void await message.reply("Usage: `&backup delete <id>`.");
    await db.delete(premiumBackupsTable).where(and(eq(premiumBackupsTable.guildId, message.guild.id), sql`${premiumBackupsTable.id} like ${`${id}%`}`));
    return void await message.reply("✅ Backup deleted.");
  }
  if (action === "load") {
    const id = args[0];
    if (!id || args[1]?.toLowerCase() !== "confirm") return void await message.reply("Restore is destructive. Use `&backup load <id> confirm` after reviewing the backup.");
    const [backup] = await db.select().from(premiumBackupsTable).where(and(eq(premiumBackupsTable.guildId, message.guild.id), sql`${premiumBackupsTable.id} like ${`${id}%`}`)).limit(1);
    if (!backup) return void await message.reply("Backup not found.");
    const payload = backup.payload as { settings?: PremiumGuildSettings };
    if (payload.settings) await saveSettings(message.guild.id, { autoRoles: payload.settings.autoRoles, verification: payload.settings.verification, automod: payload.settings.automod, starboard: payload.settings.starboard, boost: payload.settings.boost, stats: payload.settings.stats, logging: payload.settings.logging, setup: payload.settings.setup });
    await audit(message.guild, message.author.id, "backup_settings_restored", backup.id, undefined, { backupId: backup.id });
    return void await message.reply(`✅ Backup settings restored from \`${backup.id.slice(0, 8)}\`. Channels and roles are preserved for safety; review them manually before applying changes.`);
  }
  if (action !== "create") return void await message.reply("Usage: `&backup create|list|load <id> confirm|delete <id>`.");
  const payload = {
    guild: { name: message.guild.name, icon: message.guild.iconURL() },
    roles: guild.roles.cache.filter((role) => role.id !== guild.id).map((role) => ({ name: role.name, color: role.color, permissions: role.permissions.bitfield.toString(), hoist: role.hoist, mentionable: role.mentionable })),
    channels: guild.channels.cache.map((channel) => ({ name: "name" in channel ? channel.name : "channel", type: channel.type, parentId: "parentId" in channel ? channel.parentId : null })),
    settings: await getSettings(guild.id),
  };
  const [backup] = await db.insert(premiumBackupsTable).values({ id: randomUUID(), guildId: message.guild.id, createdById: message.author.id, label: args.join(" ").trim() || "Server backup", payload }).returning();
  await message.reply(`✅ Backup created: \`${backup?.id.slice(0, 8)}\``);
}

async function commandSchedule(message: Message, args: string[]): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const [duration, ...rest] = args;
  const runAt = duration?.match(/^(\d+)(s|m|h|d)$/i);
  const content = rest.join(" ").trim();
  if (!runAt || !content) return void await message.reply("Usage: `&schedule <10m|2h|1d> <message>`.");
  const multiplier = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[runAt[2].toLowerCase() as "s" | "m" | "h" | "d"];
  const date = new Date(Date.now() + Number(runAt[1]) * multiplier);
  const [task] = await db.insert(premiumScheduledTasksTable).values({ id: randomUUID(), guildId: message.guild.id, channelId: message.channel.id, taskType: "message", payload: { content }, runAt: date, nextRunAt: date, createdById: message.author.id }).returning();
  await message.reply(`✅ Scheduled task \`${task?.id.slice(0, 8)}\` for <t:${Math.floor(date.getTime() / 1000)}:R>.`);
}

async function commandStatsSetup(message: Message): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const values = parsePairs(message.content.split(/\s+/).slice(1).join(" "));
  const settings = await getSettings(message.guild.id);
  const statsChannelId = values.channel ? parseId(values.channel) : undefined;
  const stats = { ...(settings.stats ?? {}), enabled: true, channels: { ...(settings.stats?.channels ?? {}), ...(statsChannelId ? { members: statsChannelId } : {}) }, templates: settings.stats?.templates ?? {} };
  await saveSettings(message.guild.id, { stats });
  await message.reply("✅ Statistics configuration saved. Use `&statssetup channel=#channel` to route member counts.");
}

async function commandLoggingSetup(message: Message): Promise<void> {
  if (!message.guild || !isAdmin(message)) return void await message.reply("You need Manage Server permission.");
  const values = parsePairs(message.content.split(/\s+/).slice(1).join(" "));
  const settings = await getSettings(message.guild.id);
  const logChannelId = values.channel ? parseId(values.channel) : undefined;
  const logging = { enabled: true, categories: { ...(settings.logging?.categories ?? {}), ...(values.category ? { [values.category]: values.enabled !== "false" } : {}) }, channels: { ...(settings.logging?.channels ?? {}), ...(logChannelId ? { [values.category ?? "server"]: logChannelId } : {}) } };
  await saveSettings(message.guild.id, { logging });
  await message.reply("✅ Advanced logging configuration saved.");
}

export async function handlePremiumButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("premium:")) return false;
  const [, action, feature] = interaction.customId.split(":");
  if (action === "verify" && interaction.guild) {
    const settings = await getSettings(interaction.guild.id);
    const verification = settings.verification ?? {};
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (member && verification.verifiedRoleId) {
      await member.roles.add(verification.verifiedRoleId).catch(() => undefined);
      await premiumLog(interaction.guild, "verification", "Member verified", `${member} completed button verification.`);
      await interaction.reply({ content: verification.welcomeAfterVerification ?? "✅ You are verified.", ephemeral: true });
    } else await interaction.reply({ content: "Verification is not configured yet.", ephemeral: true });
    return true;
  }
  if (action === "role" && interaction.guild) {
    const [, , configId, roleId] = interaction.customId.split(":");
    const row = await db.select().from(premiumReactionRolesTable).where(and(eq(premiumReactionRolesTable.id, configId), eq(premiumReactionRolesTable.guildId, interaction.guild.id), eq(premiumReactionRolesTable.enabled, true))).limit(1);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const role = interaction.guild.roles.cache.get(roleId);
    if (row[0] && member && role) {
      if (row[0].singleRoleMode) for (const otherId of row[0].roleIds) if (otherId !== roleId) await member.roles.remove(otherId).catch(() => undefined);
      if (member.roles.cache.has(roleId) && row[0].toggleRoles) await member.roles.remove(role);
      else await member.roles.add(role);
      await interaction.reply({ content: `✅ ${member.roles.cache.has(roleId) ? "Role added" : "Role updated"}.`, ephemeral: true });
    } else await interaction.reply({ content: "That role panel is no longer available.", ephemeral: true });
    return true;
  }
  if (action === "setup-cancel") {
    if (interaction.isRepliable() && interaction.message.editable) await interaction.update({ content: "Setup closed.", embeds: [], components: [] });
    return true;
  }
  if (action === "setup-preview" && feature) {
    const settings = interaction.guild ? await getSettings(interaction.guild.id) : null;
    if (settings) await interaction.reply({ ephemeral: true, ...featurePanel(feature as PremiumFeature, settings) });
    return true;
  }
  if (action === "setup-toggle" && feature && interaction.guild) {
    await toggleFeature(interaction, feature as PremiumFeature);
    return true;
  }
  if (action === "embed-save" && interaction.guild) {
    await interaction.reply({ content: "Use `&embedbuilder name=template ...` to save a reusable template from the current embed configuration.", ephemeral: true });
    return true;
  }
  return true;
}

export async function handlePremiumSelect(interaction: StringSelectMenuInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("premium:")) return false;
  const [, type, feature] = interaction.customId.split(":");
  if (type === "setup-select" && feature && interaction.values[0] === "modal") {
    await interaction.showModal(setupModal(feature as PremiumFeature));
    return true;
  }
  if (type === "setup-select" && feature && interaction.values[0] === "preview") {
    const settings = interaction.guild ? await getSettings(interaction.guild.id) : null;
    if (settings) await interaction.reply({ ephemeral: true, ...featurePanel(feature as PremiumFeature, settings) });
    return true;
  }
  if (type === "setup-select" && feature && interaction.guild && (interaction.values[0] === "enable" || interaction.values[0] === "disable")) {
    await toggleFeature(interaction as unknown as ButtonInteraction, feature as PremiumFeature);
    return true;
  }
  if (type === "dashboard-select") {
    const value = interaction.values[0];
    const featureMap: Record<string, PremiumFeature> = {
      autoroles: "autoroles",
      automod: "automod",
      verification: "verification",
      reaction: "reactionroles",
      starboard: "starboard",
      boost: "boost",
    };
    if (featureMap[value] && interaction.guild) {
      await interaction.reply({ ephemeral: true, ...featurePanel(featureMap[value], await getSettings(interaction.guild.id)) });
      return true;
    }
    const map: Record<string, string> = { welcome: "welcomesetup", autoroles: "autorolesetup", ticket: "panel create", giveaways: "giveawaysetup", ai: "ai status", logging: "logsetup", automod: "automodsetup", verification: "verifysetup", reaction: "reactionrolesetup", invite: "invites", economy: "shop" };
    await interaction.reply({ content: `Use \`&${map[value] ?? "setup"}\` to open this setup area.`, ephemeral: true });
    return true;
  }
  return true;
}

export async function handlePremiumModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith("premium:setup-modal:")) return false;
  const feature = interaction.customId.split(":").at(-1) as PremiumFeature;
  await configureFeature(interaction, feature);
  return true;
}

export async function handlePremiumMessage(message: Message, prefix: string): Promise<void> {
  if (!message.guild || message.author.bot) return;
  const settings = await getSettings(message.guild.id);
  const afk = await db.select().from(premiumAfkTable).where(and(sql`${premiumAfkTable.guildId} in (${message.guild.id}, '*')`, eq(premiumAfkTable.userId, message.author.id))).limit(2);
  if (afk.length) {
    await db.delete(premiumAfkTable).where(sql`${premiumAfkTable.id} in (${sql.join(afk.map((row) => sql`${row.id}`), sql`, `)})`);
    await message.reply(`Welcome back — your AFK status was removed automatically.`).catch(() => undefined);
  }
  for (const user of message.mentions.users.values()) {
    const mentioned = await db.select().from(premiumAfkTable).where(and(sql`${premiumAfkTable.guildId} in (${message.guild.id}, '*')`, eq(premiumAfkTable.userId, user.id))).limit(2);
    if (mentioned[0]) await message.reply(`💤 **${user.username}** is AFK: ${mentioned[0].reason}`).catch(() => undefined);
  }
  if (message.content.trim().startsWith(prefix)) return;
  const automod = settings.automod ?? {};
  const lower = message.content.toLowerCase();
  const hasInvite = /discord(?:\.gg|\.com\/invite)\//i.test(message.content);
  const hasLink = /https?:\/\/\S+/i.test(message.content);
  const caps = message.content.replace(/[^A-Za-z]/g, "").length >= 8 && message.content.replace(/[^A-Z]/g, "").length / Math.max(1, message.content.replace(/[^A-Za-z]/g, "").length) > 0.75;
  const emojiSpam = (message.content.match(/\p{Extended_Pictographic}/gu) ?? []).length > 12;
  const badWord = (automod.badWords ?? []).some((word) => lower.includes(word.toLowerCase()) && !(automod.whitelistWords ?? []).some((allowed) => lower.includes(allowed.toLowerCase())));
  const violation = automod.enabled && ((automod.antiInvite && hasInvite) || (automod.antiLink && hasLink) || (automod.antiCaps && caps) || (automod.antiEmojiSpam && emojiSpam) || badWord);
  if (violation) {
    if (automod.autoDelete !== false) await message.delete().catch(() => undefined);
    if (automod.autoWarn) await premiumLog(message.guild, "moderation", "Auto moderation action", `<@${message.author.id}> triggered the configured filters in <#${message.channel.id}>.`, 0xed4245);
    if (automod.autoTimeoutSeconds && message.member?.moderatable) await message.member.timeout(automod.autoTimeoutSeconds * 1000, "BH SHIELD premium automod").catch(() => undefined);
  }
  const stickyRows = await db.select().from(premiumStickyMessagesTable).where(and(eq(premiumStickyMessagesTable.guildId, message.guild.id), eq(premiumStickyMessagesTable.channelId, message.channel.id), eq(premiumStickyMessagesTable.enabled, true)));
  for (const sticky of stickyRows) {
    const nextCount = sticky.messageCount + 1;
    if (nextCount >= sticky.repostEveryMessages) {
      if (sticky.messageId && "messages" in message.channel) await message.channel.messages.delete(sticky.messageId).catch(() => undefined);
      if (textChannel(message.channel)) {
        const sent = await message.channel.send({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(sticky.content).setFooter({ text: "Sticky message" })] }).catch(() => null);
        await db.update(premiumStickyMessagesTable).set({ messageId: sent?.id ?? sticky.messageId, messageCount: 0 }).where(eq(premiumStickyMessagesTable.id, sticky.id));
      }
    } else await db.update(premiumStickyMessagesTable).set({ messageCount: nextCount }).where(eq(premiumStickyMessagesTable.id, sticky.id));
  }
}

export async function handlePremiumMemberAdd(member: GuildMember): Promise<void> {
  const settings = await getSettings(member.guild.id);
  const config = settings.autoRoles ?? {};
  const roles = member.user.bot ? config.botRoleIds ?? [] : config.humanRoleIds ?? [];
  const welcomeRoles = config.welcomeRoleIds ?? [];
  const allRoles = [...new Set([...roles, ...welcomeRoles])];
  if (config.enabled && allRoles.length) {
    const apply = async () => {
      for (const roleId of allRoles) await member.roles.add(roleId).catch(() => undefined);
      for (const roleId of config.temporaryRoleIds ?? []) {
        const removeAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await db.insert(premiumTemporaryRolesTable).values({ id: randomUUID(), guildId: member.guild.id, userId: member.id, roleId, removeAt }).onConflictDoUpdate({ target: [premiumTemporaryRolesTable.guildId, premiumTemporaryRolesTable.userId, premiumTemporaryRolesTable.roleId], set: { removeAt } });
      }
      await premiumLog(member.guild, "member", "Auto roles applied", `${member} received ${allRoles.map((id) => `<@&${id}>`).join(", ")}.`);
    };
    if (config.joinDelaySeconds) setTimeout(() => void apply(), Math.min(86_400, config.joinDelaySeconds) * 1000);
    else await apply();
  }
  const verification = settings.verification ?? {};
  if (verification.enabled && verification.autoVerify && verification.verifiedRoleId) await member.roles.add(verification.verifiedRoleId).catch(() => undefined);
}

export async function handlePremiumMemberUpdate(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember): Promise<void> {
  if (!oldMember.premiumSince && newMember.premiumSince) {
    const settings = await getSettings(newMember.guild.id);
    const config = settings.boost ?? {};
    if (config.boosterRoleId) await newMember.roles.add(config.boosterRoleId).catch(() => undefined);
    const channel = config.channelId ? newMember.guild.channels.cache.get(config.channelId) : null;
    if (config.enabled && textChannel(channel)) await channel.send({ content: (config.message ?? "Thank you {user} for boosting {server}!").replaceAll("{user}", `${newMember}`).replaceAll("{server}", newMember.guild.name) }).catch(() => undefined);
    await premiumLog(newMember.guild, "boost", "Server boost", `${newMember} boosted the server.`, 0xff73fa);
  }
}

export async function handlePremiumReaction(reaction: MessageReaction, userId: string, operation: "add" | "remove" = "add"): Promise<void> {
  const message = reaction.message;
  if (!message.guild) return;
  const settings = await getSettings(message.guild.id);
  const starboard = settings.starboard ?? {};
  if (starboard.enabled && reaction.emoji.name === (starboard.emoji ?? "⭐") && (reaction.count >= (starboard.minimumStars ?? 3) || operation === "remove")) {
    if (starboard.ignoreBots && message.author?.bot) return;
    if (starboard.ignoreNsfw && message.channel && "nsfw" in message.channel && message.channel.nsfw) return;
    const channel = starboard.channelId ? message.guild.channels.cache.get(starboard.channelId) : null;
    if (textChannel(channel)) {
      const [entry] = await db.select().from(premiumStarboardEntriesTable).where(and(eq(premiumStarboardEntriesTable.guildId, message.guild.id), eq(premiumStarboardEntriesTable.messageId, message.id))).limit(1);
      if (operation === "remove" && reaction.count < (starboard.minimumStars ?? 3)) {
        if (entry?.starboardMessageId && "messages" in channel) await channel.messages.delete(entry.starboardMessageId).catch(() => undefined);
        if (entry) await db.delete(premiumStarboardEntriesTable).where(eq(premiumStarboardEntriesTable.id, entry.id));
      } else {
        const embed = new EmbedBuilder().setColor(0xffd166).setAuthor({ name: message.author?.tag ?? "Member" }).setDescription((message.content ?? "").slice(0, 4_000) || "Attachment-only message").setFooter({ text: `${starboard.emoji ?? "⭐"} ${reaction.count} · #${"name" in message.channel ? message.channel.name : "channel"}` }).setTimestamp();
        if (entry?.starboardMessageId && "messages" in channel) await channel.messages.edit(entry.starboardMessageId, { embeds: [embed] }).catch(() => undefined);
        else {
          const sent = await channel.send({ content: `[Jump to message](${message.url})`, embeds: [embed] }).catch(() => null);
          if (sent) await db.insert(premiumStarboardEntriesTable).values({ id: randomUUID(), guildId: message.guild.id, messageId: message.id, sourceChannelId: message.channel.id, starboardMessageId: sent.id, starCount: reaction.count }).onConflictDoUpdate({ target: [premiumStarboardEntriesTable.guildId, premiumStarboardEntriesTable.messageId], set: { starboardMessageId: sent.id, starCount: reaction.count } });
        }
      }
    }
  }
  const roleRows = await db.select().from(premiumReactionRolesTable).where(and(eq(premiumReactionRolesTable.guildId, message.guild.id), eq(premiumReactionRolesTable.messageId, message.id), eq(premiumReactionRolesTable.enabled, true)));
  for (const row of roleRows) {
    const roleId = row.emojiRoles?.[reaction.emoji.name ?? reaction.emoji.id ?? ""];
    const member = await message.guild.members.fetch(userId).catch(() => null);
    const role = roleId ? message.guild.roles.cache.get(roleId) : null;
    if (member && role) {
      if (operation === "remove" && row.removeRoles) await member.roles.remove(role).catch(() => undefined);
      else if (operation === "add") await member.roles.add(role).catch(() => undefined);
    }
  }
}

async function runScheduledTask(client: Client, task: PremiumScheduledTask): Promise<void> {
  const channel = await client.channels.fetch(task.channelId).catch(() => null);
  if (!textChannel(channel)) return;
  const content = typeof task.payload.content === "string" ? task.payload.content : "Scheduled BH SHIELD task.";
  await channel.send({ content });
  if (task.repeatSeconds && task.repeatSeconds > 0) await db.update(premiumScheduledTasksTable).set({ nextRunAt: new Date(Date.now() + task.repeatSeconds * 1000) }).where(eq(premiumScheduledTasksTable.id, task.id));
  else await db.update(premiumScheduledTasksTable).set({ enabled: false }).where(eq(premiumScheduledTasksTable.id, task.id));
}

export async function runPremiumMaintenance(client: Client): Promise<void> {
  const now = new Date();
  const tasks = await db.select().from(premiumScheduledTasksTable).where(and(eq(premiumScheduledTasksTable.enabled, true), lte(premiumScheduledTasksTable.nextRunAt, now))).limit(100);
  for (const task of tasks) await runScheduledTask(client, task).catch((error) => logger.warn({ error: error instanceof Error ? error.message : String(error), taskId: task.id }, "Scheduled premium task failed"));
  const temporaryRoles = await db.select().from(premiumTemporaryRolesTable).where(lte(premiumTemporaryRolesTable.removeAt, now)).limit(200);
  for (const temporary of temporaryRoles) {
    const guild = client.guilds.cache.get(temporary.guildId);
    const member = guild ? await guild.members.fetch(temporary.userId).catch(() => null) : null;
    if (member) await member.roles.remove(temporary.roleId).catch(() => undefined);
    await db.delete(premiumTemporaryRolesTable).where(eq(premiumTemporaryRolesTable.id, temporary.id));
  }
  for (const guild of client.guilds.cache.values()) {
    const settings = await getSettings(guild.id);
    if (!settings.stats?.enabled || Date.now() - (statsUpdateAt.get(guild.id) ?? 0) < 60_000) continue;
    statsUpdateAt.set(guild.id, Date.now());
    const values: Record<string, number> = { members: guild.memberCount, bots: guild.members.cache.filter((member) => member.user.bot).size, boosts: guild.premiumSubscriptionCount ?? 0, voice: guild.voiceStates.cache.size, online: guild.members.cache.filter((member) => member.presence?.status && member.presence.status !== "offline").size };
    for (const [key, channelId] of Object.entries(settings.stats.channels ?? {})) {
      const channel = guild.channels.cache.get(channelId);
      if (channel && "setName" in channel && typeof channel.setName === "function" && values[key] !== undefined) await channel.setName(`${settings.stats.templates?.[key] ?? key}: ${values[key]}`).catch(() => undefined);
    }
  }
}

export async function handlePremiumCommand(message: Message, command: string, args: string[]): Promise<boolean> {
  const setupMap: Partial<Record<string, PremiumFeature>> = { autorolesetup: "autoroles", reactionrolesetup: "reactionroles", verifysetup: "verification", automodsetup: "automod", starboardsetup: "starboard", boostsetup: "boost" };
  if (setupMap[command]) return await openFeaturePanel(message, setupMap[command]!), true;
  if (command === "setup") return await commandSetup(message), true;
  if (command === "afk") return await commandAfk(message, args), true;
  if (command === "sticky") return await commandSticky(message, args), true;
  if (command === "unsticky") return await commandSticky(message, args, true), true;
  if (command === "embedbuilder") return await commandEmbedBuilder(message, args), true;
  if (command === "backup") return await commandBackup(message, args), true;
  if (command === "schedule") return await commandSchedule(message, args), true;
  if (command === "statssetup") return await commandStatsSetup(message), true;
  if (command === "logsetup") return await commandLoggingSetup(message), true;
  return false;
}

export function registerPremiumCommands(): void {
  const admin = ["autorolesetup", "reactionrolesetup", "verifysetup", "automodsetup", "starboardsetup", "boostsetup", "setup", "sticky", "unsticky", "embedbuilder", "backup", "schedule", "statssetup", "logsetup"];
  registerCommands([
    ...admin.map((name) => ({ name, guildOnly: true, category: "Premium Setup", permissions: ["Manage Server"], execute: async (message: Message, args: string[]) => handlePremiumCommand(message, name, args) })),
    { name: "afk", guildOnly: true, category: "Community", execute: async (message: Message, args: string[]) => handlePremiumCommand(message, "afk", args) },
  ]);
}