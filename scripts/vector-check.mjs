import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const result = await prisma.$queryRaw`
    SELECT extname
    FROM pg_extension
    WHERE extname = 'vector'
  `;

  if (!Array.isArray(result) || result.length === 0) {
    throw new Error('pgvector extension is not installed in the target database.');
  }

  console.log('pgvector extension is available.');
} finally {
  await prisma.$disconnect();
}
