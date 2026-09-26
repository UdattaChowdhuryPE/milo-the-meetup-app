import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { roomInsightsTable } from "./room-insights";
import { messagesTable } from "./messages";

export const roomInsightSourcesTable = pgTable("room_insight_sources", {
  insightId: uuid("insight_id").notNull().references(() => roomInsightsTable.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
}, (table) => [primaryKey({ columns: [table.insightId, table.messageId] })]);