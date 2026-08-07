import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export type RankCardConfig = {
  background?: string;
  color?: string;
  accent?: string;
  theme?: "midnight" | "ocean" | "sunset" | "forest";
};

export type EngagementPanelConfig = {
  welcome?: Record<string, unknown>;
  giveaway?: Record<string, unknown>;
  poll?: Record<string, unknown>;
  announcement?: Record<string, unknown>;
};

export const engagementGuildSettingsTable = pgTable("bh_engagement_guild_settings", {
  guildId: text("guild_id").primaryKey(),
  xpEnabled: boolean("xp_enabled").notNull().default(true),
  xpPerMessage: integer("xp_per_message").notNull().default(15),
  xpCooldownSeconds: integer("xp_cooldown_seconds").notNull().default(60),
  xpDailyLimit: integer("xp_daily_limit").notNull().default(3_000),
  voiceXpPerMinute: integer("voice_xp_per_minute").notNull().default(5),
  xpMultiplier: integer("xp_multiplier").notNull().default(100),
  multiplierEndsAt: timestamp("multiplier_ends_at", { withTimezone: true }),
  roleXpBonuses: jsonb("role_xp_bonuses").$type<Record<string, number>>().notNull().default({}),
  levelRoles: jsonb("level_roles").$type<Record<string, string>>().notNull().default({}),
  rankCard: jsonb("rank_card").$type<RankCardConfig>().notNull().default({}),
  birthdayChannelId: text("birthday_channel_id"),
  birthdayRoleId: text("birthday_role_id"),
  birthdayAgeDisplay: boolean("birthday_age_display").notNull().default(false),
  suggestionsChannelId: text("suggestions_channel_id"),
  anonymousSuggestions: boolean("anonymous_suggestions").notNull().default(false),
  panelConfig: jsonb("panel_config").$type<EngagementPanelConfig>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const engagementProfilesTable = pgTable("bh_engagement_profiles", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  xp: integer("xp").notNull().default(0),
  xpToday: integer("xp_today").notNull().default(0),
  level: integer("level").notNull().default(0),
  reputation: integer("reputation").notNull().default(0),
  wallet: integer("wallet").notNull().default(0),
  bank: integer("bank").notNull().default(0),
  totalEarned: integer("total_earned").notNull().default(0),
  dailyStreak: integer("daily_streak").notNull().default(0),
  weeklyStreak: integer("weekly_streak").notNull().default(0),
  monthlyStreak: integer("monthly_streak").notNull().default(0),
  lastXpAt: timestamp("last_xp_at", { withTimezone: true }),
  lastXpDay: text("last_xp_day"),
  lastVoiceXpAt: timestamp("last_voice_xp_at", { withTimezone: true }),
  lastRepAt: timestamp("last_rep_at", { withTimezone: true }),
  lastDailyAt: timestamp("last_daily_at", { withTimezone: true }),
  lastWeeklyAt: timestamp("last_weekly_at", { withTimezone: true }),
  lastMonthlyAt: timestamp("last_monthly_at", { withTimezone: true }),
  lastWorkAt: timestamp("last_work_at", { withTimezone: true }),
  lastBegAt: timestamp("last_beg_at", { withTimezone: true }),
  lastCrimeAt: timestamp("last_crime_at", { withTimezone: true }),
  lastRobAt: timestamp("last_rob_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildUserIdx: uniqueIndex("bh_engagement_profiles_guild_user_idx").on(table.guildId, table.userId),
  xpIdx: index("bh_engagement_profiles_guild_xp_idx").on(table.guildId, table.xp),
  globalXpIdx: index("bh_engagement_profiles_global_xp_idx").on(table.xp),
}));

export const engagementItemsTable = pgTable("bh_engagement_items", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("general"),
  price: integer("price").notNull().default(0),
  sellPrice: integer("sell_price").notNull().default(0),
  stock: integer("stock").notNull().default(-1),
  imageUrl: text("image_url"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildNameIdx: uniqueIndex("bh_engagement_items_guild_name_idx").on(table.guildId, table.name),
  guildCategoryIdx: index("bh_engagement_items_guild_category_idx").on(table.guildId, table.category),
}));

export const engagementInventoryTable = pgTable("bh_engagement_inventory", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  itemId: text("item_id").notNull(),
  quantity: integer("quantity").notNull().default(1),
  equipped: boolean("equipped").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  userItemIdx: uniqueIndex("bh_engagement_inventory_user_item_idx").on(table.guildId, table.userId, table.itemId),
}));

export const engagementAchievementsTable = pgTable("bh_engagement_achievements", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  metric: text("metric").notNull(),
  target: integer("target").notNull(),
  rewardCoins: integer("reward_coins").notNull().default(0),
  rewardXp: integer("reward_xp").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  guildNameIdx: uniqueIndex("bh_engagement_achievements_guild_name_idx").on(table.guildId, table.name),
}));

export const engagementUserAchievementsTable = pgTable("bh_engagement_user_achievements", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  achievementId: text("achievement_id").notNull(),
  progress: integer("progress").notNull().default(0),
  unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userAchievementIdx: uniqueIndex("bh_engagement_user_achievement_idx").on(table.guildId, table.userId, table.achievementId),
}));

export const engagementBirthdaysTable = pgTable("bh_engagement_birthdays", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  month: integer("month").notNull(),
  day: integer("day").notNull(),
  year: integer("year"),
  lastWishedYear: integer("last_wished_year"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildUserIdx: uniqueIndex("bh_engagement_birthdays_guild_user_idx").on(table.guildId, table.userId),
  birthdayIdx: index("bh_engagement_birthdays_month_day_idx").on(table.guildId, table.month, table.day),
}));

export const engagementSuggestionsTable = pgTable("bh_engagement_suggestions", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  authorId: text("author_id").notNull(),
  content: text("content").notNull(),
  status: text("status").notNull().default("pending"),
  anonymous: boolean("anonymous").notNull().default(false),
  upvotes: integer("upvotes").notNull().default(0),
  downvotes: integer("downvotes").notNull().default(0),
  staffComment: text("staff_comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildStatusIdx: index("bh_engagement_suggestions_guild_status_idx").on(table.guildId, table.status),
}));

export const engagementSuggestionVotesTable = pgTable("bh_engagement_suggestion_votes", {
  id: text("id").primaryKey(),
  suggestionId: text("suggestion_id").notNull(),
  userId: text("user_id").notNull(),
  vote: integer("vote").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  suggestionUserIdx: uniqueIndex("bh_engagement_suggestion_votes_user_idx").on(table.suggestionId, table.userId),
}));

export const engagementAuditLogsTable = pgTable("bh_engagement_audit_logs", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  actorId: text("actor_id").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id"),
  oldValue: jsonb("old_value").$type<unknown>(),
  newValue: jsonb("new_value").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  guildCreatedIdx: index("bh_engagement_audit_guild_created_idx").on(table.guildId, table.createdAt),
}));

export type EngagementGuildSettings = typeof engagementGuildSettingsTable.$inferSelect;
export type EngagementProfile = typeof engagementProfilesTable.$inferSelect;
export type EngagementItem = typeof engagementItemsTable.$inferSelect;
export type EngagementInventory = typeof engagementInventoryTable.$inferSelect;
export type EngagementAchievement = typeof engagementAchievementsTable.$inferSelect;
export type EngagementUserAchievement = typeof engagementUserAchievementsTable.$inferSelect;
export type EngagementBirthday = typeof engagementBirthdaysTable.$inferSelect;
export type EngagementSuggestion = typeof engagementSuggestionsTable.$inferSelect;