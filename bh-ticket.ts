import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export type OwnerDMLogCategory =
  | "startup"
  | "error"
  | "command"
  | "moderation"
  | "ticket"
  | "ai"
  | "database"
  | "guild"
  | "voice"
  | "security";

export type OwnerDMLogRecord = {
  category: OwnerDMLogCategory;
  event: string;
  guild?: string;
  channel?: string;
  user?: string;
  command?: string;
  details?: string;
  error?: string;
  createdAt: string;
};

export type OwnerDMLogCategories = Record<OwnerDMLogCategory, boolean>;

export const ticketPanelsTable = pgTable(
  "bh_ticket_panels",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    name: text("name").notNull(),
    title: text("title").notNull().default("Contact support"),
    description: text("description").notNull().default("Choose a ticket type below and our team will be with you shortly."),
    color: text("color").notNull().default("#5865F2"),
    thumbnailUrl: text("thumbnail_url"),
    bannerUrl: text("banner_url"),
    footer: text("footer"),
    author: text("author"),
    authorIconUrl: text("author_icon_url"),
    showTimestamp: boolean("show_timestamp").notNull().default(true),
    welcomeMessage: text("welcome_message").notNull().default("Thanks for reaching out. A member of our team will be with you shortly."),
    supportRoleIds: jsonb("support_role_ids").$type<string[]>().notNull().default([]),
    managerRoleIds: jsonb("manager_role_ids").$type<string[]>().notNull().default([]),
    managerUserIds: jsonb("manager_user_ids").$type<string[]>().notNull().default([]),
    categoryId: text("category_id"),
    namingFormat: text("naming_format").notNull().default("ticket-{number}"),
    nextNumber: integer("next_number").notNull().default(1),
    buttonLabel: text("button_label").notNull().default("Create ticket"),
    buttonEmoji: text("button_emoji"),
    useDropdown: boolean("use_dropdown").notNull().default(true),
    published: boolean("published").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    guildNameIdx: uniqueIndex("bh_ticket_panels_guild_name_idx").on(table.guildId, table.name),
  }),
);

export const ticketSetupDraftsTable = pgTable(
  "bh_ticket_setup_drafts",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    ownerId: text("owner_id").notNull(),
    panelId: text("panel_id").notNull(),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    ownerStatusIdx: uniqueIndex("bh_ticket_setup_drafts_owner_status_idx").on(table.guildId, table.ownerId, table.status),
  }),
);

export const ticketTypesTable = pgTable("bh_ticket_types", {
  id: text("id").primaryKey(),
  panelId: text("panel_id").notNull(),
  guildId: text("guild_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  emoji: text("emoji"),
  categoryId: text("category_id"),
  welcomeMessage: text("welcome_message"),
  supportRoleIds: jsonb("support_role_ids").$type<string[]>().notNull().default([]),
  namingFormat: text("naming_format"),
  questions: jsonb("questions").$type<TicketQuestion[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticketsTable = pgTable("bh_tickets", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  panelId: text("panel_id").notNull(),
  typeId: text("type_id").notNull(),
  channelId: text("channel_id").notNull(),
  creatorId: text("creator_id").notNull(),
  number: integer("number").notNull(),
  status: text("status").notNull().default("open"),
  claimedById: text("claimed_by_id"),
  priority: text("priority").notNull().default("normal"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  formAnswers: jsonb("form_answers").$type<Record<string, string>>().notNull().default({}),
  internalNotes: jsonb("internal_notes").$type<InternalNote[]>().notNull().default([]),
  lastCreatorMessageAt: timestamp("last_creator_message_at", { withTimezone: true }),
  lastStaffMessageAt: timestamp("last_staff_message_at", { withTimezone: true }),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  responseTimeSeconds: integer("response_time_seconds"),
  lastStaffReminderAt: timestamp("last_staff_reminder_at", { withTimezone: true }),
  lastCustomerReminderAt: timestamp("last_customer_reminder_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticketMessagesTable = pgTable("bh_ticket_messages", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  messageId: text("message_id").notNull(),
  authorId: text("author_id").notNull(),
  authorName: text("author_name").notNull(),
  isStaff: boolean("is_staff").notNull().default(false),
  content: text("content").notNull().default(""),
  attachments: jsonb("attachments").$type<MessageAttachment[]>().notNull().default([]),
  embeds: jsonb("embeds").$type<unknown[]>().notNull().default([]),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticketReviewsTable = pgTable("bh_ticket_reviews", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id").notNull(),
  guildId: text("guild_id").notNull(),
  reviewerId: text("reviewer_id").notNull(),
  staffId: text("staff_id"),
  behavior: integer("behavior").notNull(),
  responseSpeed: integer("response_speed").notNull(),
  experience: integer("experience").notNull(),
  feedback: text("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ticketIdIdx: uniqueIndex("bh_ticket_reviews_ticket_id_idx").on(table.ticketId),
}));

export const ticketSavedRepliesTable = pgTable(
  "bh_ticket_saved_replies",
  {
    id: text("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdById: text("created_by_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => ({
    guildNameIdx: uniqueIndex("bh_ticket_saved_replies_guild_name_idx").on(table.guildId, table.name),
  }),
);

export const ticketEventsTable = pgTable("bh_ticket_events", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id"),
  guildId: text("guild_id").notNull(),
  actorId: text("actor_id"),
  type: text("type").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guildSettingsTable = pgTable("bh_guild_settings", {
  guildId: text("guild_id").primaryKey(),
  prefix: text("prefix").notNull().default("&"),
  ghostMode: boolean("ghost_mode").notNull().default(false),
  noPrefixMode: boolean("no_prefix_mode").notNull().default(false),
  maxOpenTickets: integer("max_open_tickets").notNull().default(3),
  ticketRateLimitCount: integer("ticket_rate_limit_count").notNull().default(3),
  ticketRateLimitWindow: text("ticket_rate_limit_window").notNull().default("day"),
  cooldownSeconds: integer("cooldown_seconds").notNull().default(60),
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  aiDelaySeconds: integer("ai_delay_seconds").notNull().default(120),
  aiBehavior: text("ai_behavior").notNull().default("Acknowledge users, answer simple general questions, and never override staff."),
  autoCloseEmptyMinutes: integer("auto_close_empty_minutes").notNull().default(0),
  htmlTranscripts: boolean("html_transcripts").notNull().default(true),
  pdfTranscripts: boolean("pdf_transcripts").notNull().default(true),
  reviewEnabled: boolean("review_enabled").notNull().default(true),
  reviewScale: integer("review_scale").notNull().default(5),
  transcriptChannelId: text("transcript_channel_id"),
  reviewChannelId: text("review_channel_id"),
  logChannelId: text("log_channel_id"),
  welcomeEnabled: boolean("welcome_enabled").notNull().default(false),
  welcomeChannelId: text("welcome_channel_id"),
  welcomeMessage: text("welcome_message").notNull().default("Welcome {mention} to {server}! You are member #{memberCount}."),
  welcomeEmbedTitle: text("welcome_embed_title").notNull().default("Welcome to {server}!"),
  welcomeColor: text("welcome_color").notNull().default("#5865F2"),
  welcomeImageUrl: text("welcome_image_url"),
  welcomeBannerUrl: text("welcome_banner_url"),
  welcomeMention: boolean("welcome_mention").notNull().default(true),
  leaveEnabled: boolean("leave_enabled").notNull().default(false),
  leaveChannelId: text("leave_channel_id"),
  leaveMessage: text("leave_message").notNull().default("{username} has left {server}."),
  leaveEmbedTitle: text("leave_embed_title").notNull().default("Member left"),
  leaveColor: text("leave_color").notNull().default("#ED4245"),
  leaveImageUrl: text("leave_image_url"),
  leaveBannerUrl: text("leave_banner_url"),
  ticketLogChannelId: text("ticket_log_channel_id"),
  reviewLogChannelId: text("review_log_channel_id"),
  transcriptLogChannelId: text("transcript_log_channel_id"),
  modLogChannelId: text("mod_log_channel_id"),
  modRoleId: text("mod_role_id"),
  muteRoleId: text("mute_role_id"),
  moderationConfig: jsonb("moderation_config").$type<ModerationConfig>().notNull().default({}),
  staffSlaMinutes: integer("staff_sla_minutes").notNull().default(30),
  customerSlaMinutes: integer("customer_sla_minutes").notNull().default(1440),
  blacklistUserIds: jsonb("blacklist_user_ids").$type<string[]>().notNull().default([]),
  whitelistUserIds: jsonb("whitelist_user_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type AutoReply = typeof autoRepliesTable.$inferSelect;
export type Giveaway = typeof giveawaysTable.$inferSelect;
export type Poll = typeof pollsTable.$inferSelect;

export const autoRepliesTable = pgTable("bh_auto_replies", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  trigger: text("trigger").notNull(),
  reply: text("reply").notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  guildTriggerIdx: uniqueIndex("bh_auto_replies_guild_trigger_idx").on(table.guildId, table.trigger),
}));

export const giveawaysTable = pgTable("bh_giveaways", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  hostId: text("host_id").notNull(),
  prize: text("prize").notNull(),
  winnerCount: integer("winner_count").notNull().default(1),
  requiredRoleId: text("required_role_id"),
  entries: jsonb("entries").$type<string[]>().notNull().default([]),
  winners: jsonb("winners").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("active"),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pollsTable = pgTable("bh_polls", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  messageId: text("message_id"),
  question: text("question").notNull(),
  options: jsonb("options").$type<string[]>().notNull().default([]),
  votes: jsonb("votes").$type<Record<string, number>>().notNull().default({}),
  voters: jsonb("voters").$type<Record<string, number>>().notNull().default({}),
  anonymous: boolean("anonymous").notNull().default(false),
  status: text("status").notNull().default("active"),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const noPrefixAccessTable = pgTable("bh_no_prefix_access", {
  userId: text("user_id").primaryKey(),
  grantedById: text("granted_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inviteStatsTable = pgTable("bh_invite_stats", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  userId: text("user_id").notNull(),
  regularInvites: integer("regular_invites").notNull().default(0),
  fakeInvites: integer("fake_invites").notNull().default(0),
  leftMembers: integer("left_members").notNull().default(0),
  rejoinedMembers: integer("rejoined_members").notNull().default(0),
  bonusInvites: integer("bonus_invites").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildUserIdx: uniqueIndex("bh_invite_stats_guild_user_idx").on(table.guildId, table.userId),
}));

export const inviteUsesTable = pgTable("bh_invite_uses", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  inviteCode: text("invite_code"),
  inviterId: text("inviter_id"),
  memberId: text("member_id").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  rejoined: boolean("rejoined").notNull().default(false),
});

export const moderationCasesTable = pgTable("bh_moderation_cases", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  caseNumber: integer("case_number").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  moderatorId: text("moderator_id").notNull(),
  reason: text("reason"),
  durationSeconds: integer("duration_seconds"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => ({
  guildCaseIdx: uniqueIndex("bh_moderation_cases_guild_case_idx").on(table.guildId, table.caseNumber),
}));

export const ownerDmLogSettingsTable = pgTable("bh_owner_dm_log_settings", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  categories: jsonb("categories").$type<OwnerDMLogCategories>().notNull().default({
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
  }),
  queue: jsonb("queue").$type<OwnerDMLogRecord[]>().notNull().default([]),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const aiChannelSettingsTable = pgTable("bh_ai_channel_settings", {
  id: text("id").primaryKey(),
  guildId: text("guild_id").notNull(),
  channelId: text("channel_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  guildChannelIdx: uniqueIndex("bh_ai_channel_settings_guild_channel_idx").on(table.guildId, table.channelId),
}));

export const ticketQuestionSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(45),
  type: z.enum(["short", "long", "number", "email", "url"]),
  placeholder: z.string().max(100).optional(),
  required: z.boolean().default(true),
  maxLength: z.number().int().min(1).max(4000).optional(),
});

export type TicketQuestion = z.infer<typeof ticketQuestionSchema>;
export type InternalNote = { id: string; authorId: string; content: string; createdAt: string };
export type MessageAttachment = { name: string; url: string; contentType?: string | null };

export const insertTicketPanelSchema = createInsertSchema(ticketPanelsTable);
export const insertTicketTypeSchema = createInsertSchema(ticketTypesTable);
export const insertTicketSchema = createInsertSchema(ticketsTable);
export type TicketPanel = typeof ticketPanelsTable.$inferSelect;
export type TicketSetupDraft = typeof ticketSetupDraftsTable.$inferSelect;
export type TicketType = typeof ticketTypesTable.$inferSelect;
export type Ticket = typeof ticketsTable.$inferSelect;
export type TicketMessage = typeof ticketMessagesTable.$inferSelect;
export type TicketReview = typeof ticketReviewsTable.$inferSelect;
export type TicketSavedReply = typeof ticketSavedRepliesTable.$inferSelect;
export type GuildSettings = typeof guildSettingsTable.$inferSelect;
export type InviteStats = typeof inviteStatsTable.$inferSelect;
export type InviteUse = typeof inviteUsesTable.$inferSelect;
export type ModerationConfig = {
  antispam?: boolean;
  antilink?: boolean;
  antiinvite?: boolean;
  badwords?: string[];
  capsfilter?: boolean;
  mentionlimit?: number;
  raidmode?: boolean;
};
export type ModerationCase = typeof moderationCasesTable.$inferSelect;
export type AIChannelSetting = typeof aiChannelSettingsTable.$inferSelect;
export type OwnerDMLogSettings = typeof ownerDmLogSettingsTable.$inferSelect;