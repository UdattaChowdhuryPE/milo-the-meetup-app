import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suggestionRunsTable } from "./suggestion-runs";

export type SuggestionVerdict = "met" | "failed" | "unknown" | "not_applicable";
export type StoredEvaluation = {
  insightId: string;
  verdict: SuggestionVerdict;
  strength: "hard_constraint" | "strong_preference" | "preference";
};

export const roomSuggestionsTable = pgTable("room_suggestions", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => suggestionRunsTable.id, { onDelete: "cascade" }),
  providerPlaceId: text("provider_place_id").notNull(),
  rank: integer("rank").notNull(),
  evaluations: jsonb("evaluations").$type<StoredEvaluation[]>().notNull().default([]),
}, (table) => [index("room_suggestions_run_rank_idx").on(table.runId, table.rank)]);

export const insertRoomSuggestionSchema = createInsertSchema(roomSuggestionsTable).omit({ id: true });
export type InsertRoomSuggestion = z.infer<typeof insertRoomSuggestionSchema>;
export type RoomSuggestionRecord = typeof roomSuggestionsTable.$inferSelect;