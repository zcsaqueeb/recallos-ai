import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const [mem, dec, les, obs, settings] = await Promise.all([
  db.memoryRecord.count(),
  db.decision.count(),
  db.lesson.count(),
  db.chainObservation.count(),
  db.appSettings.count(),
]);

console.log({ memories: mem, decisions: dec, lessons: les, observations: obs, settingsRows: settings });

const samples = await db.memoryRecord.findMany({
  select: { id: true, sourceType: true, storageState: true, content: true },
  orderBy: { createdAt: "desc" },
  take: 10,
});
console.log(samples.map((m) => ({ ...m, content: m.content.slice(0, 70) })));

await db.$disconnect();
