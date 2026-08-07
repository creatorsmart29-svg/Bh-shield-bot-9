import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { notifyOwnerDMLog } from "./owner-dm-logger";

export type RecoveryContext = {
  guildId?: string;
  userId?: string;
  channelId?: string;
  event?: string;
};

export type RecoveryCategory =
  | "database_connection"
  | "database_transient"
  | "database_schema"
  | "database_query"
  | "command"
  | "event"
  | "maintenance"
  | "unknown";

type RecoveryReport = {
  category: RecoveryCategory;
  operation: string;
  message: string;
  stack?: string;
  code?: string;
  context: RecoveryContext;
  recoveryAction: string;
  recoveryResult: "Success" | "Failed" | "Not attempted";
  attempt: number;
  timestamp: string;
};

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [250, 750, 1_750];
const recoveryInFlight = new Map<string, Promise<unknown>>();
const recentFailureReports = new Map<string, number>();
const FAILURE_REPORT_COOLDOWN_MS = 30_000;
const transientCodes = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "40001",
  "40P01",
  "55P03",
  "57P01",
  "57P02",
  "57P03",
  "53300",
]);
const schemaCodes = new Set(["42P01", "42703", "42704", "42883"]);

function errorDetails(error: unknown): { message: string; stack?: string; code?: string } {
  if (error instanceof Error) {
    const candidate = error as Error & { code?: string };
    return { message: error.message, stack: error.stack, code: candidate.code };
  }
  return { message: String(error) };
}

function classifyError(error: unknown): RecoveryCategory {
  const details = errorDetails(error);
  if (details.code && schemaCodes.has(details.code)) return "database_schema";
  if (details.code && transientCodes.has(details.code)) return "database_transient";
  if (details.code?.startsWith("08")) return "database_connection";
  if (/connection|socket|timeout|temporarily unavailable|pool/i.test(details.message)) return "database_connection";
  if (/column .* does not exist|relation .* does not exist|undefined table|undefined column/i.test(details.message)) return "database_schema";
  if (/query|database|postgres|drizzle|sql/i.test(details.message)) return "database_query";
  return "unknown";
}

function reportPayload(
  error: unknown,
  operation: string,
  context: RecoveryContext,
  action: string,
  result: RecoveryReport["recoveryResult"],
  attempt: number,
): RecoveryReport {
  const details = errorDetails(error);
  return {
    category: classifyError(error),
    operation,
    message: details.message,
    stack: details.stack,
    code: details.code,
    context,
    recoveryAction: action,
    recoveryResult: result,
    attempt,
    timestamp: new Date().toISOString(),
  };
}

function logRecovery(report: RecoveryReport, level: "warn" | "error" = "error"): void {
  const reportKey = `${report.operation}:${report.category}:${report.context.guildId ?? ""}:${report.context.userId ?? ""}:${report.context.channelId ?? ""}:${report.message}`;
  const now = Date.now();
  const previous = recentFailureReports.get(reportKey) ?? 0;
  if (level === "error" && now - previous < FAILURE_REPORT_COOLDOWN_MS) {
    logger.debug({
      category: report.category,
      operation: report.operation,
      recoveryAction: report.recoveryAction,
      recoveryResult: report.recoveryResult,
      attempt: report.attempt,
      timestamp: report.timestamp,
    }, "BH SHIELD duplicate recovery report suppressed");
    return;
  }
  recentFailureReports.set(reportKey, now);
  if (recentFailureReports.size > 500) {
    for (const [key, timestamp] of recentFailureReports) {
      if (now - timestamp > FAILURE_REPORT_COOLDOWN_MS) recentFailureReports.delete(key);
    }
  }
  const fields = {
    category: report.category,
    operation: report.operation,
    error: report.message,
    stack: report.stack,
    code: report.code,
    guildId: report.context.guildId,
    userId: report.context.userId,
    channelId: report.context.channelId,
    event: report.context.event,
    recoveryAction: report.recoveryAction,
    recoveryResult: report.recoveryResult,
    attempt: report.attempt,
    timestamp: report.timestamp,
  };
  if (level === "warn") logger.warn(fields, "BH SHIELD recoverable failure");
  else logger.error(fields, "BH SHIELD recovery failed");
  notifyOwnerDMLog({
    category: report.category.startsWith("database") ? "database" : "error",
    event: `Recovery ${report.recoveryResult}: ${report.operation}`,
    guild: report.context.guildId,
    channel: report.context.channelId,
    user: report.context.userId,
    details: [
      `Category: ${report.category}`,
      `Recovery action: ${report.recoveryAction}`,
      `Recovery result: ${report.recoveryResult}`,
      `Attempt: ${report.attempt}`,
      `Timestamp: ${report.timestamp}`,
      report.context.event ? `Event: ${report.context.event}` : "",
      report.stack ? `Stack: ${report.stack}` : "",
    ].filter(Boolean).join("\n"),
    error: report.message,
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function databaseHealthProbe(): Promise<void> {
  await pool.query("SELECT 1");
}

/**
 * Runs an operation with bounded, deduplicated retries. Only errors classified
 * as transient connection/database failures are retried. Schema errors are
 * reported as actionable drift and are never repaired with runtime DDL.
 */
export async function withRecovery<T>(
  operation: string,
  action: () => Promise<T>,
  context: RecoveryContext = {},
  options: { category?: RecoveryCategory; retry?: boolean } = {},
): Promise<T> {
  const key = `${operation}:${context.guildId ?? ""}:${context.userId ?? ""}:${context.channelId ?? ""}`;
  const running = recoveryInFlight.get(key);
  if (running) return running as Promise<T>;

  const work = (async () => {
    let attempt = 0;
    while (true) {
      try {
        return await action();
      } catch (error) {
        attempt += 1;
        const detectedCategory = classifyError(error);
        const category = options.category ?? detectedCategory;
        const retryable = options.retry !== false
          && (detectedCategory === "database_connection" || detectedCategory === "database_transient")
          && attempt < MAX_ATTEMPTS;
        if (!retryable) {
          const report = reportPayload(error, operation, context, category === "database_schema" ? "Schema verification required; no automatic DDL attempted." : "No safe automatic recovery available.", "Failed", attempt);
          report.category = category;
          logRecovery(report);
          throw error;
        }

        const actionDescription = `Database health probe and retry after ${BACKOFF_MS[attempt - 1]}ms backoff`;
        const initial = reportPayload(error, operation, context, actionDescription, "Not attempted", attempt);
        initial.category = category;
        logRecovery(initial, "warn");
        await sleep(BACKOFF_MS[attempt - 1]);
        try {
          await databaseHealthProbe();
          const success = reportPayload(error, operation, context, actionDescription, "Success", attempt);
          success.category = category;
          logRecovery(success, "warn");
        } catch (probeError) {
          const failedProbe = reportPayload(probeError, `${operation} database health probe`, context, "Health probe failed; bounded retry continues.", "Failed", attempt);
          failedProbe.category = "database_connection";
          logRecovery(failedProbe);
        }
      }
    }
  })();
  recoveryInFlight.set(key, work);
  try {
    return await work;
  } finally {
    recoveryInFlight.delete(key);
  }
}

export async function reportRuntimeError(
  operation: string,
  error: unknown,
  context: RecoveryContext = {},
  category: RecoveryCategory = "unknown",
): Promise<void> {
  const report = reportPayload(error, operation, context, "Error isolated; unrelated modules remain active.", "Failed", 1);
  report.category = category;
  logRecovery(report);
}

type ExpectedTable = {
  name: string;
  columns: Set<string>;
  indexes: Set<string>;
  foreignKeys: Set<string>;
};

function expectedTables(): ExpectedTable[] {
  const tables: ExpectedTable[] = [];
  for (const value of Object.values(schema)) {
    try {
      const config = getTableConfig(value as never);
      if (!config?.name || !config.columns?.length) continue;
      tables.push({
        name: config.name,
        columns: new Set(config.columns.map((column) => column.name)),
        indexes: new Set(config.indexes.map((index) => {
          const candidate = index as unknown as { config?: { name?: string } };
          return candidate.config?.name ?? "";
        }).filter(Boolean)),
        foreignKeys: new Set(config.foreignKeys.map((foreignKey) => {
          const candidate = foreignKey as unknown as { reference?: () => unknown };
          return candidate.reference ? JSON.stringify(candidate.reference()) : "";
        }).filter(Boolean)),
      });
    } catch {
      // Non-table exports are expected in the schema module.
    }
  }
  return tables;
}

export type SchemaVerification = {
  ok: boolean;
  tablesChecked: number;
  columnsChecked: number;
  indexesFound: number;
  foreignKeysFound: number;
  missingTables: string[];
  missingColumns: string[];
  message: string;
};

/**
 * Read-only catalog verification. This intentionally never creates or alters
 * database objects; production schema changes belong to the Publish flow.
 */
export async function verifyDatabaseSchema(): Promise<SchemaVerification> {
  const expected = expectedTables();
  const [tablesResult, columnsResult, indexesResult, foreignKeysResult] = await Promise.all([
    pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"),
    pool.query<{ table_name: string; column_name: string }>("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"),
    pool.query<{ tablename: string; indexname: string }>("SELECT tablename, indexname FROM pg_indexes WHERE schemaname = 'public'"),
    pool.query<{ table_name: string; constraint_name: string }>("SELECT table_name, constraint_name FROM information_schema.table_constraints WHERE table_schema = 'public' AND constraint_type = 'FOREIGN KEY'"),
  ]);
  const tables = new Set(tablesResult.rows.map((row) => row.table_name));
  const columns = new Set(columnsResult.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const indexes = new Set(indexesResult.rows.map((row) => `${row.tablename}.${row.indexname}`));
  const foreignKeys = new Set(foreignKeysResult.rows.map((row) => `${row.table_name}.${row.constraint_name}`));
  const missingTables: string[] = [];
  const missingColumns: string[] = [];
  let columnsChecked = 0;
  let expectedIndexCount = 0;
  let expectedForeignKeyCount = 0;
  for (const table of expected) {
    if (!tables.has(table.name)) {
      missingTables.push(table.name);
      continue;
    }
    for (const column of table.columns) {
      columnsChecked += 1;
      if (!columns.has(`${table.name}.${column}`)) missingColumns.push(`${table.name}.${column}`);
    }
    expectedIndexCount += table.indexes.size;
    expectedForeignKeyCount += table.foreignKeys.size;
  }
  const missingIndexes = expected.flatMap((table) => [...table.indexes]
    .filter((index) => !indexes.has(`${table.name}.${index}`))
    .map((index) => `${table.name}.${index}`));
  const missingForeignKeys = expected.flatMap((table) => [...table.foreignKeys]
    .filter((foreignKey) => !foreignKeys.has(`${table.name}.${foreignKey}`))
    .map((foreignKey) => `${table.name}.${foreignKey}`));
  const ok = missingTables.length === 0 && missingColumns.length === 0 && missingIndexes.length === 0 && missingForeignKeys.length === 0;
  const message = ok
    ? "Database schema verification passed."
    : `Database schema drift detected. Missing tables: ${missingTables.join(", ") || "none"}; missing columns: ${missingColumns.join(", ") || "none"}; missing indexes: ${missingIndexes.join(", ") || "none"}; missing foreign keys: ${missingForeignKeys.join(", ") || "none"}.`;
  return {
    ok,
    tablesChecked: expected.length,
    columnsChecked,
    indexesFound: indexes.size,
    foreignKeysFound: foreignKeys.size,
    missingTables: [...missingTables, ...missingIndexes, ...missingForeignKeys],
    missingColumns,
    message: `${message} Expected indexes: ${expectedIndexCount}; expected foreign keys: ${expectedForeignKeyCount}.`,
  };
}