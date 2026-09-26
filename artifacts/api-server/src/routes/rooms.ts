import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, participantsTable, roomsTable } from "@workspace/db";
import { CreateRoomBody, CreateRoomResponse, GetRoomParams, GetRoomResponse } from "@workspace/api-zod";

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

export default router;