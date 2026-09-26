import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, participantsTable, roomsTable } from "@workspace/db";
import {
  GetRoomSuggestionsHeader, GetRoomSuggestionsParams, GetRoomSuggestionsResponse,
  SearchRoomSuggestionsBody, SearchRoomSuggestionsHeader, SearchRoomSuggestionsParams,
  SearchRoomSuggestionsResponse, UpdateParticipantLocationBody,
  UpdateParticipantLocationHeader, UpdateParticipantLocationParams, UpdateParticipantLocationResponse,
} from "@workspace/api-zod";
import {
  getRoomSuggestions, requestSuggestionRun, saveParticipantLocation,
} from "../lib/room-suggestions";

const router: IRouter = Router();

router.patch("/rooms/:id/participants/:participantId/location", async (req, res): Promise<void> => {
  const params = UpdateParticipantLocationParams.safeParse(req.params);
  const header = UpdateParticipantLocationHeader.safeParse({
    "X-Milo-Browser-Identity": req.get("X-Milo-Browser-Identity"),
  });
  const body = UpdateParticipantLocationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Enter an approximate city, neighborhood or landmark (100 characters or fewer)." });
    return;
  }
  if (!header.success) {
    res.status(403).json({ error: "Join this room in this browser before updating your location." });
    return;
  }
  const [room] = await db.select({ id: roomsTable.id }).from(roomsTable)
    .where(eq(roomsTable.id, params.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  const result = await saveParticipantLocation(room.id, params.data.participantId,
    header.data["X-Milo-Browser-Identity"], body.data.originLabel,
    body.data.sourceInsightId ?? null);
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.status === 403
      ? "This browser cannot update that participant's location."
      : result.status === 404 ? "Participant not found in this room."
        : "Choose a current location note of your own or enter an approximate area." });
    return;
  }
  res.json(UpdateParticipantLocationResponse.parse(result.participant));
});

router.post("/rooms/:id/suggestions/search", async (req, res): Promise<void> => {
  const params = SearchRoomSuggestionsParams.safeParse(req.params);
  const body = SearchRoomSuggestionsBody.safeParse(req.body);
  const header = SearchRoomSuggestionsHeader.safeParse({
    "X-Milo-Browser-Identity": req.get("X-Milo-Browser-Identity"),
  });
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid room or participant." });
    return;
  }
  if (!header.success) {
    res.status(403).json({ error: "Join the room in this browser before finding options." });
    return;
  }
  const [room] = await db.select({ id: roomsTable.id }).from(roomsTable)
    .where(eq(roomsTable.id, params.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  const result = await requestSuggestionRun(room.id, body.data.participantId,
    header.data["X-Milo-Browser-Identity"]);
  if (result.status !== 202) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(202).json(SearchRoomSuggestionsResponse.parse({ runId: result.runId, status: result.runStatus }));
});

router.get("/rooms/:id/suggestions", async (req, res): Promise<void> => {
  const params = GetRoomSuggestionsParams.safeParse(req.params);
  const header = GetRoomSuggestionsHeader.safeParse({
    "X-Milo-Browser-Identity": req.get("X-Milo-Browser-Identity"),
  });
  if (!params.success) {
    res.status(400).json({ error: "Invalid room link." });
    return;
  }
  const [room] = await db.select({ id: roomsTable.id }).from(roomsTable)
    .where(eq(roomsTable.id, params.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  if (!header.success) {
    res.status(403).json({ error: "Join this room to see options." });
    return;
  }
  const [member] = await db.select({ id: participantsTable.id }).from(participantsTable).where(and(
    eq(participantsTable.roomId, room.id),
    eq(participantsTable.browserIdentity, header.data["X-Milo-Browser-Identity"]),
  )).limit(1);
  if (!member) {
    res.status(403).json({ error: "Join this room to see options." });
    return;
  }
  res.json(GetRoomSuggestionsResponse.parse(await getRoomSuggestions(room.id)));
});

export default router;