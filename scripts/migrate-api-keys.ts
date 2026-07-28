import "../src/lib/env";
import * as argon2 from "argon2";
import { prisma } from "../src/lib/db";

const legacyKeys = await prisma.apiKey.findMany({
  where: { NOT: { key: { startsWith: "$argon2" } } },
  select: { id: true, key: true },
});
for (const legacy of legacyKeys) {
  const key = await argon2.hash(legacy.key, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await prisma.apiKey.update({ where: { id: legacy.id }, data: { key } });
}
await prisma.$disconnect();
console.warn(`Migrated ${legacyKeys.length} legacy API keys`);
