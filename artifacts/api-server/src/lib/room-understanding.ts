import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, messagesTable, participantsTable, roomAnalysisTable,
  roomInsightsTable, roomInsightSourcesTable,
} from "@workspace/db";
import { extractUnderstanding, type AnalysisMessage, type Extraction, type ExistingInsight } from "./understanding-model";

type Claim = {
  room_id: string;
  cursor_message_id: string | null;
  pending_message_id: string | null;
  lease_until: Date;
  attempts: number;
};

async function insightRows(roomId: string) {
  const insights = await db.select().from(roomInsightsTable)
    .where(eq(roomInsightsTable.roomId, roomId))
    .orderBy(asc(roomInsightsTable.createdAt), asc(roomInsightsTable.id));
  const sources = insights.length
    ? await db.select().from(roomInsightSourcesTable)
      .where(inArray(roomInsightSourcesTable.insightId, insights.map((insight) => insight.id)))
    : [];
  const byInsight = new Map<string, string[]>();
  for (const source of sources) {
    const ids = byInsight.get(source.insightId) ?? [];
    ids.push(source.messageId);
    byInsight.set(source.insightId, ids);
  }
  return insights.map((insight) => ({ ...insight, sourceMessageIds: byInsight.get(insight.id) ?? [] }));
}

export async function getRoomUnderstanding(roomId: string) {
  // Rooms created before this feature get their first analysis only when visited.
  const [state] = await db.select().from(roomAnalysisTable).where(eq(roomAnalysisTable.roomId, roomId));
  if (!state) {
    const [latest] = await db.select({ id: messagesTable.id }).from(messagesTable)
      .where(eq(messagesTable.roomId, roomId))
      .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id)).limit(1);
    if (latest) {
      await db.insert(roomAnalysisTable).values({
        roomId, status: "pending", pendingMessageId: latest.id,
        dueAt: new Date(Date.now() + 5000),
      }).onConflictDoNothing();
    }
  }
  const [[analysis], insights] = await Promise.all([
    db.select().from(roomAnalysisTable).where(eq(roomAnalysisTable.roomId, roomId)),
    insightRows(roomId),
  ]);
  return {
    insights: insights.map((insight) => ({
      id: insight.id, kind: insight.kind, value: insight.value, normalizedValue: insight.normalizedValue,
      scope: insight.scope, participantId: insight.participantId,
      strength: insight.strength, confidence: insight.confidence, status: insight.status,
      sourceMessageIds: insight.sourceMessageIds, supersedesInsightId: insight.supersedesInsightId,
    })),
    analysisStatus: analysis?.status ?? "idle",
    updatedAt: analysis?.lastSuccessAt ?? null,
  };
}

export async function retryRoomUnderstanding(roomId: string) {
  const [latest] = await db.select({ id: messagesTable.id }).from(messagesTable)
    .where(eq(messagesTable.roomId, roomId))
    .orderBy(desc(messagesTable.createdAt), desc(messagesTable.id)).limit(1);
  if (!latest) return getRoomUnderstanding(roomId);
  const [state] = await db.select().from(roomAnalysisTable).where(eq(roomAnalysisTable.roomId, roomId));
  if (!state) {
    await db.insert(roomAnalysisTable).values({
      roomId, pendingMessageId: latest.id, status: "pending", dueAt: new Date(Date.now() + 5000),
    }).onConflictDoNothing();
  } else if (state.status === "failed") {
    const earliest = (state.lastAttemptAt?.getTime() ?? 0) + 15000;
    await db.update(roomAnalysisTable).set({
      status: "pending", attempts: 0, errorCode: null, pendingMessageId: latest.id,
      dueAt: new Date(Math.max(Date.now() + 5000, earliest)),
    }).where(and(eq(roomAnalysisTable.roomId, roomId), eq(roomAnalysisTable.status, "failed")));
  }
  return getRoomUnderstanding(roomId);
}

async function claimNext(): Promise<Claim | undefined> {
  // SKIP LOCKED, a persisted lease and a per-room minute window prevent duplicate or runaway calls.
  await pool.query(`
    UPDATE room_analysis SET status = 'pending', lease_until = NULL, attempts = 0,
      due_at = greatest(coalesce(due_at, now()), now() + interval '15 seconds'),
      error_code = 'analysis_timeout'
    WHERE status = 'processing' AND lease_until < now() AND attempts >= 3
      AND pending_message_id IS DISTINCT FROM processing_message_id
  `);
  await pool.query(`
    UPDATE room_analysis SET status = 'failed', lease_until = NULL, error_code = 'analysis_timeout'
    WHERE status = 'processing' AND lease_until < now() AND attempts >= 3
  `);
  const result = await pool.query<Claim>(`
    WITH candidate AS (
      SELECT room_id FROM room_analysis
      WHERE due_at <= now()
        AND (status = 'pending' OR (status = 'processing' AND lease_until < now()))
        AND (last_attempt_at IS NULL OR last_attempt_at <= now() - interval '15 seconds')
        AND (attempt_window_start IS NULL OR attempt_window_start <= now() - interval '1 minute' OR attempts_in_window < 4)
        AND attempts < 3
      ORDER BY due_at
      LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE room_analysis AS analysis SET
      status = 'processing',
      processing_message_id = analysis.pending_message_id,
      lease_until = now() + interval '90 seconds',
      last_attempt_at = now(),
      attempts = analysis.attempts + 1,
      attempt_window_start = CASE WHEN analysis.attempt_window_start IS NULL OR analysis.attempt_window_start <= now() - interval '1 minute' THEN now() ELSE analysis.attempt_window_start END,
      attempts_in_window = CASE WHEN analysis.attempt_window_start IS NULL OR analysis.attempt_window_start <= now() - interval '1 minute' THEN 1 ELSE analysis.attempts_in_window + 1 END
    FROM candidate WHERE analysis.room_id = candidate.room_id
    RETURNING analysis.room_id, analysis.cursor_message_id, analysis.pending_message_id, analysis.lease_until, analysis.attempts
  `);
  return result.rows[0];
}

async function loadBatch(claim: Claim) {
  // Compare timestamps inside Postgres: JS Date truncates microseconds and would replay the cursor.
  const cursorFilter = claim.cursor_message_id
    ? sql`(${messagesTable.createdAt}, ${messagesTable.id}) > (
        SELECT created_at, id FROM messages WHERE id = ${claim.cursor_message_id}
      )`
    : undefined;
  const rows = await db.select({
    id: messagesTable.id, participantId: messagesTable.participantId,
    senderName: participantsTable.name, content: messagesTable.content,
    createdAt: messagesTable.createdAt,
  }).from(messagesTable)
    .innerJoin(participantsTable, eq(messagesTable.participantId, participantsTable.id))
    .where(cursorFilter ? and(eq(messagesTable.roomId, claim.room_id), cursorFilter) : eq(messagesTable.roomId, claim.room_id))
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id)).limit(31);
  let characters = 0;
  const batch: typeof rows = [];
  for (const row of rows.slice(0, 30)) {
    if (batch.length && characters + row.content.length > 8000) break;
    batch.push(row);
    characters += row.content.length;
  }
  return { batch, hasMore: rows.length > batch.length };
}

function validateExtraction(
  output: Extraction,
  batch: AnalysisMessage[],
  existing: Awaited<ReturnType<typeof insightRows>>,
  participantIds: Set<string>,
) {
  const suppliedIds = new Set(batch.map((message) => message.id));
  const messagesById = new Map(batch.map((message) => [message.id, message]));
  const current = new Map(existing.filter((item) => item.status !== "superseded").map((item) => [item.id, item]));
  const replaced = new Set<string>();
  const conflicted = new Set<string>();
  for (const change of output.changes) {
    if (change.scope.type === "participant" && (!change.scope.participantId || !participantIds.has(change.scope.participantId))) {
      throw new Error("unsupported_participant");
    }
    if (change.scope.type === "group" && change.scope.participantId !== null) throw new Error("invalid_group_scope");
    if (change.action !== "set_status" && change.scope.type === "participant"
      && change.sourceMessageIds.some((id) => {
        const source = messagesById.get(id);
        return source && source.participantId !== change.scope.participantId;
      })) throw new Error("source_speaker_mismatch");
    if (change.action === "add" && change.scope.type === "group"
      && !change.sourceMessageIds.some((id) => {
        const message = messagesById.get(id)?.content ?? "";
        return /\b(we all|everyone|all of us|whole group|we(?:'ve| have)? agreed|we(?:'re| are) all|both of us|all three of us)\b/i.test(message);
      })) throw new Error("unsupported_group_claim");
    if (change.normalizedValue && (!Number.isFinite(change.normalizedValue.amount) && change.normalizedValue.amount !== null)) {
      throw new Error("invalid_normalized_value");
    }
    const target = change.insightId ? current.get(change.insightId) : undefined;
    if (change.action === "add") {
      if (change.insightId) throw new Error("new_insight_has_id");
      if (change.sourceMessageIds.some((id) => !suppliedIds.has(id))) throw new Error("unsupported_source");
      if (change.supersedesInsightIds.some((id) => {
        const old = current.get(id);
        return !old || old.scope !== change.scope.type || old.participantId !== change.scope.participantId || replaced.has(id);
      })) throw new Error("unsupported_supersession");
      if (change.conflictsWithInsightIds.some((id) => {
        const old = current.get(id);
        return !old || old.kind !== change.kind || old.participantId === change.scope.participantId
          || change.supersedesInsightIds.includes(id);
      })) throw new Error("unsupported_conflict");
      change.supersedesInsightIds.forEach((id) => replaced.add(id));
      change.conflictsWithInsightIds.forEach((id) => conflicted.add(id));
    } else {
      if (!target) throw new Error("unsupported_insight");
      if (target.scope !== change.scope.type || target.participantId !== change.scope.participantId || target.kind !== change.kind) {
        throw new Error("invalid_insight_scope");
      }
      if (change.supersedesInsightIds.length || change.conflictsWithInsightIds.length) throw new Error("invalid_reference");
      const linked = new Set(target.sourceMessageIds);
      if (change.sourceMessageIds.some((id) => !suppliedIds.has(id) && !linked.has(id))) {
        throw new Error("unsupported_source");
      }
      if (change.action === "set_status" && change.value !== target.value) throw new Error("invalid_status_change");
      if (replaced.has(target.id) && (change.action !== "set_status" || change.status !== "superseded")) {
        throw new Error("invalid_insight_update");
      }
      if (conflicted.has(target.id) && change.status !== "conflicting") throw new Error("invalid_insight_update");
    }
  }
}

async function processClaim(claim: Claim) {
  const { batch, hasMore } = await loadBatch(claim);
  if (!batch.length) {
    await db.transaction(async (tx) => {
      const [state] = await tx.select().from(roomAnalysisTable)
        .where(eq(roomAnalysisTable.roomId, claim.room_id)).for("update");
      if (!state || state.leaseUntil?.getTime() !== claim.lease_until.getTime()) return;
      const newMessageArrived = state.pendingMessageId !== state.cursorMessageId;
      await tx.update(roomAnalysisTable).set({
        status: newMessageArrived ? "pending" : "idle",
        dueAt: newMessageArrived ? new Date(Math.max(state.dueAt?.getTime() ?? 0, Date.now() + 5000)) : null,
        leaseUntil: null, processingMessageId: null, attempts: 0,
      }).where(eq(roomAnalysisTable.roomId, claim.room_id));
    });
    return;
  }
  const [existing, participants] = await Promise.all([
    insightRows(claim.room_id),
    db.select({ id: participantsTable.id }).from(participantsTable).where(eq(participantsTable.roomId, claim.room_id)),
  ]);
  const current: ExistingInsight[] = existing.filter((item) => item.status !== "superseded").map((item) => ({
    id: item.id, kind: item.kind, value: item.value, scope: item.scope, participantId: item.participantId,
    strength: item.strength, confidence: item.confidence, status: item.status, sourceMessageIds: item.sourceMessageIds,
  }));
  const output = await extractUnderstanding(batch, current);
  validateExtraction(output, batch, existing, new Set(participants.map((person) => person.id)));
  const last = batch[batch.length - 1]!;

  await db.transaction(async (tx) => {
    const [state] = await tx.select().from(roomAnalysisTable)
      .where(eq(roomAnalysisTable.roomId, claim.room_id)).for("update");
    if (!state || state.status !== "processing" || state.leaseUntil?.getTime() !== claim.lease_until.getTime()) return;

    for (const change of output.changes) {
      if (change.action === "add") {
        for (const oldId of change.supersedesInsightIds) {
          await tx.update(roomInsightsTable).set({ status: "superseded", updatedAt: new Date() })
            .where(and(eq(roomInsightsTable.id, oldId), eq(roomInsightsTable.roomId, claim.room_id)));
        }
        for (const opposingId of change.conflictsWithInsightIds) {
          await tx.update(roomInsightsTable).set({ status: "conflicting", updatedAt: new Date() })
            .where(and(eq(roomInsightsTable.id, opposingId), eq(roomInsightsTable.roomId, claim.room_id)));
        }
        const [created] = await tx.insert(roomInsightsTable).values({
          roomId: claim.room_id, kind: change.kind, value: change.value,
          normalizedValue: change.normalizedValue,
          scope: change.scope.type, participantId: change.scope.participantId,
          strength: change.strength, confidence: change.confidence,
          status: change.conflictsWithInsightIds.length ? "conflicting" : change.status,
          supersedesInsightId: change.supersedesInsightIds[0] ?? null,
        }).returning({ id: roomInsightsTable.id });
        if (!created) throw new Error("insight_insert_failed");
        await tx.insert(roomInsightSourcesTable).values(
          [...new Set(change.sourceMessageIds)].map((messageId) => ({ insightId: created.id, messageId })),
        ).onConflictDoNothing();
      } else {
        const target = existing.find((item) => item.id === change.insightId)!;
        // A correction must not turn a superseded note back into a current note.
        if (target.status === "superseded" || change.status === "superseded" && change.action === "update") {
          throw new Error("invalid_insight_update");
        }
        await tx.update(roomInsightsTable).set(change.action === "set_status"
          ? { status: change.status, updatedAt: new Date() }
          : {
            value: change.value, normalizedValue: change.normalizedValue,
            strength: change.strength, confidence: change.confidence, status: change.status, updatedAt: new Date(),
          }).where(and(eq(roomInsightsTable.id, target.id), eq(roomInsightsTable.roomId, claim.room_id)));
        await tx.insert(roomInsightSourcesTable).values(
          [...new Set(change.sourceMessageIds)].map((messageId) => ({ insightId: target.id, messageId })),
        ).onConflictDoNothing();
      }
    }

    // If another message arrived during the AI call, leave its five-second debounce intact.
    const needsMore = hasMore || Boolean(state.pendingMessageId && !batch.some((message) => message.id === state.pendingMessageId));
    await tx.update(roomAnalysisTable).set({
      cursorMessageId: last.id,
      cursorCreatedAt: sql`(SELECT created_at FROM messages WHERE id = ${last.id})`,
      status: needsMore ? "pending" : "idle",
      dueAt: needsMore ? new Date(Math.max(state.dueAt?.getTime() ?? 0, Date.now() + 15000)) : null,
      leaseUntil: null, processingMessageId: null, attempts: 0, errorCode: null, lastSuccessAt: new Date(),
    }).where(eq(roomAnalysisTable.roomId, claim.room_id));
  });
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const claim = await claimNext();
    if (!claim) return;
    try {
      await processClaim(claim);
    } catch (error) {
      // Never log message content, model output, credentials, or the provider error payload.
      const code = error instanceof Error && [
        "unsupported_participant", "invalid_group_scope", "invalid_normalized_value",
        "new_insight_has_id", "unsupported_source", "unsupported_supersession",
        "unsupported_insight", "invalid_insight_scope", "invalid_supersession",
        "invalid_status_change", "invalid_insight_update", "unsupported_conflict", "invalid_reference",
        "source_speaker_mismatch", "unsupported_group_claim",
      ].includes(error.message) ? "invalid_output" : "analysis_unavailable";
      console.error("Room understanding failed", { roomId: claim.room_id, code });
      await db.transaction(async (tx) => {
        const [state] = await tx.select().from(roomAnalysisTable)
          .where(eq(roomAnalysisTable.roomId, claim.room_id)).for("update");
        if (!state || state.leaseUntil?.getTime() !== claim.lease_until.getTime()) return;
        const newerMessageQueued = state.pendingMessageId !== claim.pending_message_id;
        const willRetry = newerMessageQueued || claim.attempts < 3;
        await tx.update(roomAnalysisTable).set({
          status: willRetry ? "pending" : "failed",
          attempts: newerMessageQueued ? 0 : claim.attempts,
          dueAt: willRetry ? new Date(Math.max(
            state.dueAt?.getTime() ?? 0,
            Date.now() + Math.max(15000, 5000 * 2 ** claim.attempts),
          )) : null,
          leaseUntil: null, processingMessageId: null, errorCode: code,
        }).where(eq(roomAnalysisTable.roomId, claim.room_id));
      });
    }
  } catch {
    console.error("Room understanding worker could not check pending rooms");
  } finally {
    running = false;
  }
}

export function startRoomUnderstanding() {
  void tick();
  setInterval(() => { void tick(); }, 2000).unref();
}