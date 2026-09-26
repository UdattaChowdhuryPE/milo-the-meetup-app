import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { roomsTable } from "./rooms";

export const participantRole = pgEnum("participant_role", ["creator", "member"]);

export const participantsTable = pgTable(
  "participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    roomId: uuid("room_id").notNull().references(() => roomsTable.id, { onDelete: "cascade" }),
    browserIdentity: uuid("browser_identity"),
    name: text("name").notNull(),
    role: participantRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("participants_room_id_idx").on(table.roomId),
    uniqueIndex("participants_room_browser_identity_unique").on(table.roomId, table.browserIdentity),
  ],
);

export const insertParticipantSchema = createInsertSchema(participantsTable).omit({ id: true, joinedAt: true });
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type ParticipantRecord = typeof participantsTable.$inferSelect;