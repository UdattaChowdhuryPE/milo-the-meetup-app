import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";

export const participantRole = pgEnum("participant_role", ["creator", "member"]);

export const participantsTable = pgTable(
  "participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id").notNull().references(() => roomsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    role: participantRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("participants_room_id_idx").on(table.roomId)],
);

export const insertParticipantSchema = createInsertSchema(participantsTable).omit({ id: true, joinedAt: true });
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type ParticipantRecord = typeof participantsTable.$inferSelect;