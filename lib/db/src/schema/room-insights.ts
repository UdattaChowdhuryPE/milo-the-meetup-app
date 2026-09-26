import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";
import { participantsTable } from "./participants";

export const roomInsightsTable = pgTable("room_insights", {
  id: uuid("id").defaultRandom().primaryKey(),
  roomId: uuid("room_id").notNull().references(() => roomsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  value: text("value").notNull(),
  normalizedValue: jsonb("normalized_value").$type<Record<string, string | number | null> | null>(),
  scope: text("scope").$type<"group" | "participant">().notNull(),
  participantId: uuid("participant_id").references(() => participantsTable.id),
  strength: text("strength").$type<"hard_constraint" | "strong_preference" | "preference">().notNull(),
  confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
  status: text("status").$type<"active" | "superseded" | "conflicting" | "uncertain">().notNull(),
  supersedesInsightId: uuid("supersedes_insight_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("room_insights_room_idx").on(table.roomId, table.createdAt)]);

export const insertRoomInsightSchema = createInsertSchema(roomInsightsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertRoomInsight = z.infer<typeof insertRoomInsightSchema>;
export type RoomInsightRecord = typeof roomInsightsTable.$inferSelect;