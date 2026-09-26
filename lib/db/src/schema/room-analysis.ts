import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";

export const roomAnalysisTable = pgTable("room_analysis", {
  roomId: uuid("room_id").primaryKey().references(() => roomsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<"idle" | "pending" | "processing" | "failed">().notNull().default("idle"),
  pendingMessageId: uuid("pending_message_id"),
  processingMessageId: uuid("processing_message_id"),
  cursorMessageId: uuid("cursor_message_id"),
  cursorCreatedAt: timestamp("cursor_created_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  attemptWindowStart: timestamp("attempt_window_start", { withTimezone: true }),
  attemptsInWindow: integer("attempts_in_window").notNull().default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  errorCode: text("error_code"),
});

export const insertRoomAnalysisSchema = createInsertSchema(roomAnalysisTable);
export type InsertRoomAnalysis = z.infer<typeof insertRoomAnalysisSchema>;
export type RoomAnalysisRecord = typeof roomAnalysisTable.$inferSelect;