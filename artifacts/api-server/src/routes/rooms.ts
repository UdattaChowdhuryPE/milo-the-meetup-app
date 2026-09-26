import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, messagesTable, participantsTable, roomsTable } from "@workspace/db";
import {
  CreateRoomBody,
  CreateRoomResponse,
  GetRoomParams,
  GetRoomResponse,
  JoinRoomBody,
  JoinRoomParams,
  JoinRoomResponse,
  GetRoomMessagesParams,
  GetRoomMessagesResponse,
  SendRoomMessageParams,
  SendRoomMessageHeader,
  SendRoomMessageBody,
  SendRoomMessageResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/rooms", async (req, res): Promise<void> => {
  const parsed = CreateRoomBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Check the room details and try again." });
    return;
  }

  const name = parsed.data.name.trim();
  const creatorName = parsed.data.creatorName.trim();
  const description = parsed.data.description?.trim() || null;
  if (!name || !creatorName) {
    res.status(400).json({ error: "Room name and your name are required." });
    return;
  }

  const created = await db.transaction(async (tx) => {
    const [room] = await tx.insert(roomsTable).values({ name, description }).returning();
    if (!room) throw new Error("Room creation did not return a room");
    const [creator] = await tx.insert(participantsTable).values({
      roomId: room.id,
      name: creatorName,
      role: "creator",
      browserIdentity: parsed.data.browserIdentity ?? null,
    }).returning();
    if (!creator) throw new Error("Room creation did not return its creator");
    return { ...room, participants: [creator] };
  });

  res.status(201).json(CreateRoomResponse.parse(created));
});

router.get("/rooms/:id", async (req, res): Promise<void> => {
  const parsed = GetRoomParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid room link." });
    return;
  }

  const [room] = await db.select().from(roomsTable).where(eq(roomsTable.id, parsed.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const participants = await db.select().from(participantsTable)
    .where(eq(participantsTable.roomId, room.id))
    .orderBy(participantsTable.joinedAt);

  res.json(GetRoomResponse.parse({ ...room, participants }));
});

router.post("/rooms/:id/participants", async (req, res): Promise<void> => {
  const params = JoinRoomParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid room link." });
    return;
  }

  const parsed = JoinRoomBody.safeParse(req.body);
  const name = parsed.success ? parsed.data.name.trim() : "";
  if (!parsed.success || !name) {
    res.status(400).json({ error: "Enter a name of 40 characters or fewer to join." });
    return;
  }

  const [room] = await db.select({ id: roomsTable.id })
    .from(roomsTable).where(eq(roomsTable.id, params.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const [created] = await db.insert(participantsTable).values({
    roomId: room.id,
    browserIdentity: parsed.data.browserIdentity,
    name,
    role: "member",
  }).onConflictDoNothing({
    target: [participantsTable.roomId, participantsTable.browserIdentity],
  }).returning();

  if (created) {
    res.status(201).json(JoinRoomResponse.parse(created));
    return;
  }

  const [existing] = await db.select().from(participantsTable).where(and(
    eq(participantsTable.roomId, room.id),
    eq(participantsTable.browserIdentity, parsed.data.browserIdentity),
  ));
  if (!existing) throw new Error("Room participant conflict did not return a participant");
  res.status(200).json(JoinRoomResponse.parse(existing));
});

router.get("/rooms/:id/messages", async (req, res): Promise<void> => {
  const params = GetRoomMessagesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid room link." });
    return;
  }
  const [room] = await db.select({ id: roomsTable.id })
    .from(roomsTable).where(eq(roomsTable.id, params.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }

  const messages = await db.select({
    id: messagesTable.id,
    roomId: messagesTable.roomId,
    participantId: messagesTable.participantId,
    senderName: participantsTable.name,
    content: messagesTable.content,
    createdAt: messagesTable.createdAt,
  }).from(messagesTable)
    .innerJoin(participantsTable, eq(messagesTable.participantId, participantsTable.id))
    .where(eq(messagesTable.roomId, room.id))
    .orderBy(asc(messagesTable.createdAt), asc(messagesTable.id));

  res.json(GetRoomMessagesResponse.parse(messages));
});

router.post("/rooms/:id/messages", async (req, res): Promise<void> => {
  const params = SendRoomMessageParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid room link." });
    return;
  }
  const body = SendRoomMessageBody.safeParse(req.body);
  const content = body.success ? body.data.content.trim() : "";
  if (!body.success || !content) {
    res.status(400).json({ error: "Write a message of 1 to 2000 characters." });
    return;
  }
  const identity = SendRoomMessageHeader.safeParse({
    "X-Milo-Browser-Identity": req.get("X-Milo-Browser-Identity"),
  });
  if (!identity.success) {
    res.status(403).json({ error: "Your browser identity is unavailable. Please join this room first." });
    return;
  }

  const [room] = await db.select({ id: roomsTable.id })
    .from(roomsTable).where(eq(roomsTable.id, params.data.id));
  if (!room) {
    res.status(404).json({ error: "Room not found." });
    return;
  }
  const [participant] = await db.select().from(participantsTable)
    .where(and(eq(participantsTable.id, body.data.participantId), eq(participantsTable.roomId, room.id)));
  if (!participant) {
    res.status(404).json({ error: "Participant not found in this room." });
    return;
  }
  if (!participant.browserIdentity || participant.browserIdentity !== identity.data["X-Milo-Browser-Identity"]) {
    res.status(403).json({ error: "This browser cannot send as that participant." });
    return;
  }

  const [message] = await db.insert(messagesTable).values({
    roomId: room.id,
    participantId: participant.id,
    content,
  }).returning();
  if (!message) throw new Error("Message creation did not return a message");
  res.status(201).json(SendRoomMessageResponse.parse({ ...message, senderName: participant.name }));
});

export default router;