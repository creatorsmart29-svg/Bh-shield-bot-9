import { and, count, desc, eq, gt, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  aiChannelSettingsTable,
  guildSettingsTable,
  ticketEventsTable,
  ticketMessagesTable,
  ticketPanelsTable,
  ticketReviewsTable,
  ticketSavedRepliesTable,
  ticketSetupDraftsTable,
  ticketTypesTable,
  ticketsTable,
  type GuildSettings,
  type AIChannelSetting,
  type Ticket,
  type TicketPanel,
  type TicketSavedReply,
  type TicketType,
} from "@workspace/db";
import { randomUUID } from "node:crypto";
import { withRecovery } from "./recovery";

export const DEFAULT_PREFIX = "&";

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  return withRecovery("load guild settings", async () => {
    const existing = await db
      .select()
      .from(guildSettingsTable)
      .where(eq(guildSettingsTable.guildId, guildId))
      .limit(1);
    if (existing[0]) return existing[0];
    const [created] = await db
      .insert(guildSettingsTable)
      .values({ guildId, prefix: DEFAULT_PREFIX })
      .onConflictDoNothing({ target: guildSettingsTable.guildId })
      .returning();
    if (created) return created;
    const [afterRace] = await db
      .select()
      .from(guildSettingsTable)
      .where(eq(guildSettingsTable.guildId, guildId))
      .limit(1);
    if (!afterRace) throw new Error(`Guild settings could not be created or loaded for guild ${guildId}.`);
    return afterRace;
  }, { guildId });
}

export async function getAIChannelSetting(guildId: string, channelId: string): Promise<AIChannelSetting | undefined> {
  return withRecovery("load AI channel setting", async () => (
    (await db.select().from(aiChannelSettingsTable).where(and(eq(aiChannelSettingsTable.guildId, guildId), eq(aiChannelSettingsTable.channelId, channelId))).limit(1))[0]
  ), { guildId, channelId });
}

export async function listAIChannelSettings(guildId: string): Promise<AIChannelSetting[]> {
  return withRecovery("list AI channel settings", () => db.select().from(aiChannelSettingsTable).where(eq(aiChannelSettingsTable.guildId, guildId)), { guildId });
}

export async function setAIChannelEnabled(guildId: string, channelId: string, enabled: boolean): Promise<AIChannelSetting> {
  return withRecovery("save AI channel setting", async () => {
    const id = `ai-channel-${guildId}-${channelId}`;
    const [setting] = await db.insert(aiChannelSettingsTable).values({ id, guildId, channelId, enabled }).onConflictDoUpdate({
      target: [aiChannelSettingsTable.guildId, aiChannelSettingsTable.channelId],
      set: { enabled, updatedAt: new Date() },
    }).returning();
    if (!setting) throw new Error(`AI channel setting could not be saved for ${guildId}/${channelId}.`);
    return setting;
  }, { guildId, channelId });
}

export async function getPanel(panelId: string): Promise<TicketPanel | undefined> {
  return (await db.select().from(ticketPanelsTable).where(eq(ticketPanelsTable.id, panelId)).limit(1))[0];
}

export async function getPanelByName(guildId: string, name: string): Promise<TicketPanel | undefined> {
  return (await db.select().from(ticketPanelsTable).where(and(eq(ticketPanelsTable.guildId, guildId), eq(ticketPanelsTable.name, name))).limit(1))[0];
}

export async function getPanels(guildId: string): Promise<TicketPanel[]> {
  return db.select().from(ticketPanelsTable).where(eq(ticketPanelsTable.guildId, guildId)).orderBy(desc(ticketPanelsTable.createdAt));
}

export async function getType(typeId: string): Promise<TicketType | undefined> {
  return (await db.select().from(ticketTypesTable).where(eq(ticketTypesTable.id, typeId)).limit(1))[0];
}

export async function getPanelTypes(panelId: string): Promise<TicketType[]> {
  return db.select().from(ticketTypesTable).where(and(eq(ticketTypesTable.panelId, panelId), eq(ticketTypesTable.enabled, true)));
}

export async function getActiveSetupDraft(guildId: string, ownerId: string) {
  return (await db.select().from(ticketSetupDraftsTable).where(and(eq(ticketSetupDraftsTable.guildId, guildId), eq(ticketSetupDraftsTable.ownerId, ownerId), eq(ticketSetupDraftsTable.status, "active"))).limit(1))[0];
}

export async function getSetupDraft(draftId: string) {
  return (await db.select().from(ticketSetupDraftsTable).where(eq(ticketSetupDraftsTable.id, draftId)).limit(1))[0];
}

export async function saveSetupDraft(input: {
  id: string;
  guildId: string;
  ownerId: string;
  panelId: string;
  channelId?: string | null;
  messageId?: string | null;
  config?: Record<string, unknown>;
}) {
  const [draft] = await db.insert(ticketSetupDraftsTable).values(input).onConflictDoUpdate({
    target: ticketSetupDraftsTable.id,
    set: {
      channelId: input.channelId,
      messageId: input.messageId,
      ...(input.config === undefined ? {} : { config: input.config }),
      updatedAt: new Date(),
    },
  }).returning();
  return draft;
}

export async function deleteSetupDraft(draftId: string): Promise<void> {
  await db.delete(ticketSetupDraftsTable).where(eq(ticketSetupDraftsTable.id, draftId));
}

export async function getTicketByChannel(channelId: string): Promise<Ticket | undefined> {
  return (await db.select().from(ticketsTable).where(eq(ticketsTable.channelId, channelId)).limit(1))[0];
}

export async function getTicket(ticketId: string): Promise<Ticket | undefined> {
  return (await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)).limit(1))[0];
}

export async function getRecentTickets(guildId: string, status?: Ticket["status"], limit = 20): Promise<Ticket[]> {
  const conditions = [eq(ticketsTable.guildId, guildId)];
  if (status) conditions.push(eq(ticketsTable.status, status));
  return db.select().from(ticketsTable).where(and(...conditions)).orderBy(desc(ticketsTable.createdAt)).limit(Math.max(1, Math.min(50, limit)));
}

export async function getTicketsByCreator(guildId: string, creatorId: string, limit = 20): Promise<Ticket[]> {
  return db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.creatorId, creatorId)))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(Math.max(1, Math.min(50, limit)));
}

export async function getOpenTicketForType(guildId: string, creatorId: string, typeId: string): Promise<Ticket | undefined> {
  return (await db
    .select()
    .from(ticketsTable)
    .where(and(
      eq(ticketsTable.guildId, guildId),
      eq(ticketsTable.creatorId, creatorId),
      eq(ticketsTable.typeId, typeId),
      or(eq(ticketsTable.status, "open"), eq(ticketsTable.status, "closing")),
    ))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(1))[0];
}

export async function isStaffForTicket(ticket: Ticket, userId: string, roleIds: string[], memberPermissions = false): Promise<boolean> {
  if (memberPermissions) return true;
  if (ticket.claimedById === userId) return true;
  const panel = await getPanel(ticket.panelId);
  const type = (await db.select().from(ticketTypesTable).where(eq(ticketTypesTable.id, ticket.typeId)).limit(1))[0];
  const allowed = new Set([...(panel?.supportRoleIds ?? []), ...(panel?.managerRoleIds ?? []), ...(type?.supportRoleIds ?? [])]);
  return roleIds.some((roleId) => allowed.has(roleId)) || (panel?.managerUserIds ?? []).includes(userId);
}

export async function createTicketRecord(input: {
  guildId: string;
  panel: TicketPanel;
  type: TicketType;
  channelId: string;
  creatorId: string;
  number: number;
}): Promise<Ticket> {
  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      id: randomUUID(),
      guildId: input.guildId,
      panelId: input.panel.id,
      typeId: input.type.id,
      channelId: input.channelId,
      creatorId: input.creatorId,
      number: input.number,
      status: "open",
    })
    .returning();
  await logTicketEvent(ticket.id, input.guildId, input.creatorId, "ticket_created", { number: input.number, panel: input.panel.name });
  return ticket;
}

/**
 * Reserve a panel number atomically before creating the Discord channel.
 * This prevents two simultaneous button clicks from receiving the same number.
 * A failed channel creation may leave a gap, which is preferable to duplicate
 * ticket identifiers and is harmless because numbers are only display labels.
 */
export async function reserveTicketNumber(panelId: string): Promise<number> {
  const [updated] = await db
    .update(ticketPanelsTable)
    .set({ nextNumber: sql`${ticketPanelsTable.nextNumber} + 1` })
    .where(eq(ticketPanelsTable.id, panelId))
    .returning({ nextNumber: ticketPanelsTable.nextNumber });
  if (!updated) throw new Error(`Ticket panel ${panelId} was not found while reserving a ticket number.`);
  return Math.max(1, updated.nextNumber - 1);
}

export async function countOpenTickets(guildId: string, creatorId: string): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.creatorId, creatorId), or(eq(ticketsTable.status, "open"), eq(ticketsTable.status, "closing"))));
  return Number(result?.value ?? 0);
}

export async function countTicketsCreatedSince(guildId: string, creatorId: string, since: Date): Promise<number> {
  const [result] = await db
    .select({ value: count() })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.creatorId, creatorId), gte(ticketsTable.createdAt, since)));
  return Number(result?.value ?? 0);
}

export async function wasRecentlyCreated(guildId: string, creatorId: string, seconds: number): Promise<boolean> {
  const since = new Date(Date.now() - seconds * 1000);
  const recent = await db
    .select({ id: ticketsTable.id })
    .from(ticketsTable)
    .where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.creatorId, creatorId), gt(ticketsTable.createdAt, since)))
    .limit(1);
  return Boolean(recent[0]);
}

export async function saveMessage(input: {
  ticketId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  isStaff: boolean;
  content: string;
  attachments: { name: string; url: string; contentType?: string | null }[];
  embeds?: unknown[];
  skipTicketActivity?: boolean;
}): Promise<void> {
  const { skipTicketActivity, ...message } = input;
  await db.insert(ticketMessagesTable).values({ id: randomUUID(), embeds: message.embeds ?? [], ...message });
  if (skipTicketActivity) return;
  if (input.isStaff) {
    const ticket = await getTicket(input.ticketId);
    const now = new Date();
    await db.update(ticketsTable).set({
      lastStaffMessageAt: now,
      status: "open",
      ...(ticket && !ticket.firstResponseAt && ticket.lastCreatorMessageAt
        ? { firstResponseAt: now, responseTimeSeconds: Math.max(0, Math.round((now.getTime() - ticket.lastCreatorMessageAt.getTime()) / 1000)) }
        : {}),
    }).where(eq(ticketsTable.id, input.ticketId));
  } else {
    await db.update(ticketsTable).set({ lastCreatorMessageAt: new Date(), status: "open" }).where(eq(ticketsTable.id, input.ticketId));
  }
}

export async function getEmptyOpenTickets(before: Date): Promise<Ticket[]> {
  return db
    .select()
    .from(ticketsTable)
    .where(and(eq(ticketsTable.status, "open"), isNull(ticketsTable.lastCreatorMessageAt), lt(ticketsTable.createdAt, before)));
}

export async function getOpenTicketsForSla(limit = 500): Promise<Ticket[]> {
  return db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.status, "open"))
    .orderBy(desc(ticketsTable.createdAt))
    .limit(Math.max(1, Math.min(1000, limit)));
}

export async function markTicketReminder(ticketId: string, kind: "staff" | "customer"): Promise<void> {
  await db
    .update(ticketsTable)
    .set(kind === "staff" ? { lastStaffReminderAt: new Date() } : { lastCustomerReminderAt: new Date() })
    .where(eq(ticketsTable.id, ticketId));
}

export async function archiveTicket(ticketId: string): Promise<Ticket | undefined> {
  const [ticket] = await db.update(ticketsTable).set({ status: "archived", archivedAt: new Date() }).where(eq(ticketsTable.id, ticketId)).returning();
  return ticket;
}

export async function restoreArchivedTicket(ticketId: string): Promise<Ticket | undefined> {
  const [ticket] = await db.update(ticketsTable).set({ status: "open", archivedAt: null }).where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.status, "archived"))).returning();
  return ticket;
}

export async function getRecentMessages(ticketId: string) {
  return db
    .select()
    .from(ticketMessagesTable)
    .where(eq(ticketMessagesTable.ticketId, ticketId))
    .orderBy(desc(ticketMessagesTable.createdAt))
    .limit(50);
}

export async function getAllMessages(ticketId: string) {
  return db
    .select()
    .from(ticketMessagesTable)
    .where(eq(ticketMessagesTable.ticketId, ticketId))
    .orderBy(desc(ticketMessagesTable.createdAt));
}

export async function logTicketEvent(ticketId: string | null, guildId: string, actorId: string | null, type: string, metadata: Record<string, unknown> = {}): Promise<void> {
  await db.insert(ticketEventsTable).values({ id: randomUUID(), ticketId, guildId, actorId, type, metadata });
}

export async function listSavedReplies(guildId: string): Promise<TicketSavedReply[]> {
  return db
    .select()
    .from(ticketSavedRepliesTable)
    .where(eq(ticketSavedRepliesTable.guildId, guildId))
    .orderBy(ticketSavedRepliesTable.name);
}

export async function getSavedReply(replyId: string): Promise<TicketSavedReply | undefined> {
  return (await db.select().from(ticketSavedRepliesTable).where(eq(ticketSavedRepliesTable.id, replyId)).limit(1))[0];
}

export async function saveSavedReply(input: { guildId: string; name: string; content: string; createdById: string }): Promise<TicketSavedReply> {
  const [reply] = await db
    .insert(ticketSavedRepliesTable)
    .values({ id: randomUUID(), ...input })
    .onConflictDoUpdate({
      target: [ticketSavedRepliesTable.guildId, ticketSavedRepliesTable.name],
      set: { content: input.content, createdById: input.createdById, updatedAt: new Date() },
    })
    .returning();
  return reply;
}

export async function deleteSavedReply(guildId: string, name: string): Promise<boolean> {
  const deleted = await db
    .delete(ticketSavedRepliesTable)
    .where(and(eq(ticketSavedRepliesTable.guildId, guildId), eq(ticketSavedRepliesTable.name, name)))
    .returning({ id: ticketSavedRepliesTable.id });
  return Boolean(deleted[0]);
}

export async function markMessageDeleted(messageId: string): Promise<void> {
  await db.update(ticketMessagesTable).set({ deletedAt: new Date() }).where(eq(ticketMessagesTable.messageId, messageId));
}

export async function markMessageEdited(messageId: string, content: string): Promise<void> {
  await db.update(ticketMessagesTable).set({ editedAt: new Date(), content }).where(eq(ticketMessagesTable.messageId, messageId));
}

export async function renderTranscript(ticket: Ticket, panel: TicketPanel, type: TicketType): Promise<{ html: string; messages: Awaited<ReturnType<typeof getRecentMessages>> }> {
  const messages = (await getAllMessages(ticket.id)).reverse();
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const rows = messages
    .map((message) => `<article class="message ${message.isStaff ? "staff" : "user"}"><header><strong>${escape(message.authorName)}</strong><time>${message.createdAt.toISOString()}${message.editedAt ? " · edited" : ""}</time></header><p>${escape(message.deletedAt ? "[message deleted]" : message.content).replaceAll("\n", "<br>")}</p>${message.attachments.map((file) => `<a href="${escape(file.url)}">${escape(file.name)}</a>`).join(" ")}${message.embeds.length ? `<pre class="embed">${escape(JSON.stringify(message.embeds))}</pre>` : ""}</article>`)
    .join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>BH SHIELD #${ticket.number}</title><style>body{font:14px Arial,sans-serif;max-width:900px;margin:32px auto;color:#1f2937}h1{margin-bottom:4px}.meta{color:#64748b;margin-bottom:24px}.message{padding:12px 16px;border-left:3px solid #cbd5e1;margin:10px 0;background:#f8fafc}.message.staff{border-color:#5865f2;background:#eef2ff}.message header{display:flex;justify-content:space-between;gap:16px}.message time{color:#64748b;font-size:12px}.message p{white-space:pre-wrap;line-height:1.5}</style></head><body><h1>${escape(panel.name)} · ${escape(type.name)} #${ticket.number}</h1><div class="meta">Creator: ${escape(ticket.creatorId)} · Status: ${escape(ticket.status)} · Created: ${ticket.createdAt.toISOString()}</div>${rows || "<p>No messages were captured.</p>"}</body></html>`;
  return { html, messages };
}

export async function getStaffLeaderboard(guildId: string) {
  return db
    .select({
      staffId: ticketReviewsTable.staffId,
      reviews: count(ticketReviewsTable.id),
    })
    .from(ticketReviewsTable)
    .where(eq(ticketReviewsTable.guildId, guildId))
    .groupBy(ticketReviewsTable.staffId);
}

export async function getReviewRecords(guildId: string, page = 0, pageSize = 10) {
  const safePage = Math.max(0, Math.floor(page));
  const [totalRow, rows] = await Promise.all([
    db
      .select({ value: count(ticketReviewsTable.id) })
      .from(ticketReviewsTable)
      .where(eq(ticketReviewsTable.guildId, guildId)),
    db
      .select({
        id: ticketReviewsTable.id,
        ticketId: ticketReviewsTable.ticketId,
        reviewerId: ticketReviewsTable.reviewerId,
        staffId: ticketReviewsTable.staffId,
        behavior: ticketReviewsTable.behavior,
        responseSpeed: ticketReviewsTable.responseSpeed,
        experience: ticketReviewsTable.experience,
        feedback: ticketReviewsTable.feedback,
        createdAt: ticketReviewsTable.createdAt,
        ticketNumber: ticketsTable.number,
        ticketCreatorId: ticketsTable.creatorId,
      })
      .from(ticketReviewsTable)
      .leftJoin(ticketsTable, eq(ticketReviewsTable.ticketId, ticketsTable.id))
      .where(eq(ticketReviewsTable.guildId, guildId))
      .orderBy(desc(ticketReviewsTable.createdAt))
      .limit(pageSize)
      .offset(safePage * pageSize),
  ]);
  return { total: Number(totalRow[0]?.value ?? 0), rows };
}

export async function saveReview(input: {
  ticketId: string;
  guildId: string;
  reviewerId: string;
  staffId: string | null;
  behavior: number;
  responseSpeed: number;
  experience: number;
  feedback?: string;
}): Promise<boolean> {
  const inserted = await db
    .insert(ticketReviewsTable)
    .values({ id: randomUUID(), ...input })
    .onConflictDoNothing({ target: ticketReviewsTable.ticketId })
    .returning({ id: ticketReviewsTable.id });
  return Boolean(inserted[0]);
}

export async function closeTicket(ticketId: string): Promise<Ticket | undefined> {
  const [ticket] = await db.update(ticketsTable).set({ status: "closed", closedAt: new Date() }).where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.status, "closing"))).returning();
  return ticket;
}

export async function startClosingTicket(ticketId: string): Promise<Ticket | undefined> {
  const [ticket] = await db.update(ticketsTable).set({ status: "closing" }).where(eq(ticketsTable.id, ticketId)).returning();
  return ticket;
}

export async function restoreOpenTicket(ticketId: string): Promise<void> {
  await db.update(ticketsTable).set({ status: "open" }).where(and(eq(ticketsTable.id, ticketId), eq(ticketsTable.status, "closing")));
}

export async function updateTicket(ticketId: string, values: Partial<Pick<Ticket, "claimedById" | "priority" | "tags" | "formAnswers" | "internalNotes">>): Promise<Ticket | undefined> {
  const [ticket] = await db.update(ticketsTable).set(values).where(eq(ticketsTable.id, ticketId)).returning();
  return ticket;
}

export async function searchTickets(guildId: string, query: string): Promise<Ticket[]> {
  return db.select().from(ticketsTable).where(and(eq(ticketsTable.guildId, guildId), or(ilike(ticketsTable.channelId, `%${query}%`), ilike(ticketsTable.creatorId, `%${query}%`), ilike(ticketsTable.status, `%${query}%`)))).orderBy(desc(ticketsTable.createdAt)).limit(25);
}

export async function getDashboard(guildId: string) {
  const [total] = await db.select({ value: count() }).from(ticketsTable).where(eq(ticketsTable.guildId, guildId));
  const [open] = await db.select({ value: count() }).from(ticketsTable).where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.status, "open")));
  const [closed] = await db.select({ value: count() }).from(ticketsTable).where(and(eq(ticketsTable.guildId, guildId), eq(ticketsTable.status, "closed")));
  const [response] = await db.select({ average: sql<number>`coalesce(avg(${ticketsTable.responseTimeSeconds}), 0)` }).from(ticketsTable).where(and(eq(ticketsTable.guildId, guildId), sql`${ticketsTable.responseTimeSeconds} is not null`));
  const now = new Date();
  const [daily] = await db.select({ value: count() }).from(ticketsTable).where(and(eq(ticketsTable.guildId, guildId), gte(ticketsTable.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000))));
  const [weekly] = await db.select({ value: count() }).from(ticketsTable).where(and(eq(ticketsTable.guildId, guildId), gte(ticketsTable.createdAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000))));
  const [monthly] = await db.select({ value: count() }).from(ticketsTable).where(and(eq(ticketsTable.guildId, guildId), gte(ticketsTable.createdAt, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))));
  const leaderboard = await getStaffLeaderboard(guildId);
  return { total: Number(total?.value ?? 0), open: Number(open?.value ?? 0), closed: Number(closed?.value ?? 0), averageResponseSeconds: Math.round(Number(response?.average ?? 0)), daily: Number(daily?.value ?? 0), weekly: Number(weekly?.value ?? 0), monthly: Number(monthly?.value ?? 0), leaderboard };
}