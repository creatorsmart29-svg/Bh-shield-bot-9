import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export type PremiumAutoRoleConfig = {
  enabled?: boolean;
  humanRoleIds?: string[];
  botRoleIds?: string[];
  welcomeRoleIds?: string[];
  temporaryRoleIds?: string[];
  removeRoleIds?: string[];
  joinDelaySeconds?: number;
  priority?: string[];
  conditions?: Record<string, unknown>;
};

export type PremiumVerificationConfig = {
  enabled?: boolean;
  channelId?: string;
  verifiedRoleId?: string;
  logChannelId?: string;
  method?: "button" | "captcha" | "role";
  welcomeAfterVerification?: string;
  autoVerify?: boolean;
};

export type PremiumAutomodConfig = {
  enabled?: boolean;
  antiSpam?: boolean;
  antiLink?: boolean;
  antiInvite?: boolean;
  antiMentionSpam?: boolean;
  antiCaps?: boolean;
  antiEmojiSpam?: boolean;
  antiZalgo?: boolean;
  antiAdvertisement?: boolean;
  badWords?: string[];
  whitelistWords?: string[];
  autoTimeoutSeconds?: number;
  autoWarn?: boolean;
  autoDelete?: boolean;
};

export type PremiumStarboardConfig = {
  enabled?: boolean;
  channelId?: string;
  minimumStars?: number;
  ignoreBots?: boolean;
  ignoreNsfw?: boolean;
  emoji?: string;
  autoUpdate?: boolean;
};

export type PremiumBoostConfig = {
  enabled?: boolean;
  boosterRoleId?: string;
  channelId?: string;
  message?: string;
  rewardCoins?: number;
  logChannelId?: string;
};

export type PremiumStatsConfig = {
  enabled?: boolean;
  channels?: Record<string, string>;
  templates?: Record<string, string>;
};

export type PremiumLoggingConfig = {
  enabled?: boolean;
  categories?: Record<string, boolean>;
  channels?: Record<string, string>;
};

export type PremiumSetupConfig = Record<string, { enabled?: boolean; updatedAt?: string }>;

export const premiumGuildSettingsTable = pgTable("bh_premium_guild_settings", {
  guildId: text("guild_id").primaryKey(),
  autoRoles: jsonb("auto_roles").$type<PremiumAutoRoleConfig>().notNull().default({}),
  verification: jsonb("verification").$type<PremiumVerificationConfig>().notNull().default({}),
  automod: jsonb("automod").$type<PremiumAutomodConfig>().notNull().default({}),
  starboard: jsonb("starboard").$type<PremiumStarboardConfig>().notNull().default({}),
  boost: jsonb("boost").$type<PremiumBoostConfig>().notNull().default({}),
  stats: jsonb("stats").$type<PremiumStatsConfig>().notNull().default({}),
  logging: jsonb("logging").$type<PremiumLoggingConfig>().notNull().default({}),
  setup: jsonb("setup").$type<PremiumSetupConfig>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const premiumReactionRolesTable = pgTable("bh_premium_reaction_roles", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  mode: text("mode").notNull().default("button"),
  roleIds: jsonb("role_ids").$type<string[]>().notNull().default([]),
  emojiRoles: jsonb("emoji_roles").$type<Record<string, string>>().notNull().default({}),
  singleRoleMode: boolean("single_role_mode").notNull().default(false),
  toggleRoles: boolean("toggle_roles").notNull().default(true),
  removeRoles: boolean("remove_roles").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  label: text("label").notNull().default("Choose your roles"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildChannelIdx: index("bh_premium_reaction_roles_guild_channel_idx").on(table.guildId, table.channelId),
  messageIdx: uniqueIndex("bh_premium_reaction_roles_message_idx").on(table.messageId),
}));

export const premiumStickyMessagesTable = pgTable("bh_premium_sticky_messages", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  content: text("content").notNull(),
  messageId: text("message_id"),
  enabled: boolean("enabled").notNull().default(true),
  repostEveryMessages: integer("repost_every_messages").notNull().default(10),
  messageCount: integer("message_count").notNull().default(0),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildChannelIdx: index("bh_premium_sticky_guild_channel_idx").on(table.guildId, table.channelId),
}));

export const premiumEmbedTemplatesTable = pgTable("bh_premium_embed_templates", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildNameIdx: uniqueIndex("bh_premium_embed_templates_guild_name_idx").on(table.guildId, table.name),
}));

export const premiumScheduledTasksTable = pgTable("bh_premium_scheduled_tasks", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  taskType: text("task_type").notNull().default("message"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  runAt: timestamp("run_at", { withTimezone: true }).notNull(),
  repeatSeconds: integer("repeat_seconds"),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  dueIdx: index("bh_premium_scheduled_tasks_due_idx").on(table.enabled, table.nextRunAt),
  guildIdx: index("bh_premium_scheduled_tasks_guild_idx").on(table.guildId),
}));

export const premiumBackupsTable = pgTable("bh_premium_backups", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  createdById: text("created_by_id").notNull(),
  label: text("label").notNull().default("Server backup"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  guildCreatedIdx: index("bh_premium_backups_guild_created_idx").on(table.guildId, table.createdAt),
}));

export const premiumAfkTable = pgTable("bh_premium_afk", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  scope: text("scope").notNull().default("server"),
  reason: text("reason").notNull().default("AFK"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  guildUserScopeIdx: uniqueIndex("bh_premium_afk_guild_user_scope_idx").on(table.guildId, table.userId, table.scope),
  userIdx: index("bh_premium_afk_user_idx").on(table.userId),
}));

export const premiumTemporaryRolesTable = pgTable("bh_premium_temporary_roles", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  roleId: text("role_id").notNull(),
  removeAt: timestamp("remove_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dueIdx: index("bh_premium_temporary_roles_due_idx").on(table.removeAt),
  memberIdx: uniqueIndex("bh_premium_temporary_roles_member_role_idx").on(table.guildId, table.userId, table.roleId),
}));

export const premiumStarboardEntriesTable = pgTable("bh_premium_starboard_entries", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  messageId: text("message_id").notNull(),
  starboardMessageId: text("starboard_message_id"),
  sourceChannelId: text("source_channel_id").notNull(),
  starCount: integer("star_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildMessageIdx: uniqueIndex("bh_premium_starboard_guild_message_idx").on(table.guildId, table.messageId),
}));

export type PremiumGuildSettings = typeof premiumGuildSettingsTable.$inferSelect;
export type PremiumReactionRole = typeof premiumReactionRolesTable.$inferSelect;
export type PremiumStickyMessage = typeof premiumStickyMessagesTable.$inferSelect;
export type PremiumScheduledTask = typeof premiumScheduledTasksTable.$inferSelect;
export type PremiumBackup = typeof premiumBackupsTable.$inferSelect;
export type PremiumAfk = typeof premiumAfkTable.$inferSelect;
export type PremiumTemporaryRole = typeof premiumTemporaryRolesTable.$inferSelect;