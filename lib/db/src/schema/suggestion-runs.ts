import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";
import { participantsTable } from "./participants";

export const suggestionRunsTable = pgTable("suggestion_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id").notNull().references(() => roomsTable.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").notNull().references(() => participantsTable.id),
  status: text("status").$type<"pending" | "processing" | "ready" | "failed">().notNull().default("pending"),
  fingerprint: text("fingerprint").notNull(),
  insightIds: jsonb("insight_ids").$type<string[]>().notNull().default([]),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  detailsReadCount: integer("details_read_count").notNull().default(0),
  errorCode: text("error_code"),
}, (table) => [
  index("suggestion_runs_room_requested_idx").on(table.roomId, table.requestedAt),
  uniqueIndex("suggestion_runs_one_active_per_room").on(table.roomId)
    .where(sql`${table.status} IN ('pending', 'processing')`),
]);

export const insertSuggestionRunSchema = createInsertSchema(suggestionRunsTable).omit({ id: true, requestedAt: true });
export type InsertSuggestionRun = z.infer<typeof insertSuggestionRunSchema>;
export type SuggestionRunRecord = typeof suggestionRunsTable.$inferSelect;