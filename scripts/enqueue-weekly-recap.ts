import { prisma } from "../src/lib/db";
import {
  enqueueWeeklyRecapSweep,
  recapWeekKey,
} from "../src/lib/recap/weekly-recap";

// IMP-070: queues this ISO week's recap sweep by hand. The maintenance cron
// does the same on its first run of the week; repeats are one job per week.
const now = new Date();
await enqueueWeeklyRecapSweep(prisma, now);
console.warn(`Queued the weekly recap for the week of ${recapWeekKey(now)}.`);
await prisma.$disconnect();
