/**
 * Database Seed Script
 * Populates the database with sample data for development and testing
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth/password";
import { createCredentialAccount } from "../src/lib/auth/credentials";
import { assertSeedAllowed } from "./seed-guard";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

type FixtureItem = {
  type: "NOTE" | "BOOKMARK";
  positionX: number;
  positionY: number;
  width: number;
  height: number;
  zIndex: number;
  content: Record<string, string>;
};

type FixtureUser = {
  email: string;
  name: string;
  canvases: Array<{
    name: string;
    zoomLevel: number;
    panX: number;
    panY: number;
    items: FixtureItem[];
  }>;
};

const fixtureUsers: FixtureUser[] = [
  {
    email: "alice@example.com",
    name: "Alice Johnson",
    canvases: [
      {
        name: "Project Planning",
        zoomLevel: 1.0,
        panX: 0,
        panY: 0,
        items: [
          {
            type: "NOTE",
            positionX: 100,
            positionY: 100,
            width: 300,
            height: 200,
            zIndex: 1,
            content: {
              text: "Welcome to Memoria! This is a sample note item.",
            },
          },
          {
            type: "NOTE",
            positionX: 450,
            positionY: 100,
            width: 300,
            height: 200,
            zIndex: 2,
            content: {
              text: "Phase 1: Research\n- Gather requirements\n- Analyze competitors\n- Create user personas",
            },
          },
          {
            type: "BOOKMARK",
            positionX: 100,
            positionY: 350,
            width: 300,
            height: 150,
            zIndex: 3,
            content: {
              url: "https://nextjs.org/docs",
              title: "Next.js Documentation",
              description: "Official Next.js documentation and guides",
            },
          },
        ],
      },
      {
        name: "Research Notes",
        zoomLevel: 1.2,
        panX: 100,
        panY: 50,
        items: [
          {
            type: "NOTE",
            positionX: 200,
            positionY: 200,
            width: 400,
            height: 250,
            zIndex: 1,
            content: {
              text: "Research Findings:\n\n1. Users prefer visual organization\n2. Drag-and-drop is essential\n3. Real-time collaboration is highly requested",
            },
          },
          {
            type: "BOOKMARK",
            positionX: 650,
            positionY: 200,
            width: 300,
            height: 150,
            zIndex: 2,
            content: {
              url: "https://mui.com",
              title: "Material-UI",
              description: "React components for faster web development",
            },
          },
        ],
      },
    ],
  },
  {
    email: "bob@example.com",
    name: "Bob Smith",
    canvases: [
      {
        name: "Ideas Board",
        zoomLevel: 1.0,
        panX: 0,
        panY: 0,
        items: [
          {
            type: "NOTE",
            positionX: 150,
            positionY: 150,
            width: 350,
            height: 200,
            zIndex: 1,
            content: {
              text: "Brainstorming Session:\n- Feature ideas\n- UI improvements\n- Performance optimizations",
            },
          },
        ],
      },
    ],
  },
];

async function seedFixtureUser(fixture: FixtureUser, passwordHash: string) {
  // Re-runs without the development cleanup (NODE_ENV unset, for example)
  // keep the fixtures already there instead of failing on User.email.
  const existing = await prisma.user.findUnique({
    where: { email: fixture.email },
    select: { id: true },
  });
  if (existing) {
    console.log(`Fixtures for ${fixture.email} are already seeded; skipping.`);
    return;
  }

  const user = await prisma.user.create({
    data: { email: fixture.email, name: fixture.name },
  });
  await createCredentialAccount(prisma, user.id, passwordHash);

  for (const { items, ...canvasData } of fixture.canvases) {
    const canvas = await prisma.canvas.create({
      data: { ...canvasData, userId: user.id },
    });
    for (const item of items) {
      await prisma.canvasItem.create({
        data: {
          ...item,
          canvasId: canvas.id,
          createdById: user.id,
          version: 1,
        },
      });
    }
  }
  console.log(
    `Created ${user.email} with ${fixture.canvases.length} canvas(es)`,
  );
}

async function main() {
  // Before any hashing, connection, cleanup or account creation.
  assertSeedAllowed(process.env);

  console.log("Starting database seed...");

  // Clean up existing data in development
  if (process.env.NODE_ENV === "development") {
    console.log("Cleaning up existing data...");
    await prisma.canvasItem.deleteMany();
    await prisma.canvas.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  }

  // Create test users
  console.log("Creating test users...");

  const testPassword = await hashPassword("TestPassword123!");

  for (const fixture of fixtureUsers) {
    await seedFixtureUser(fixture, testPassword);
  }

  const itemCount = await prisma.canvasItem.count();
  console.log(`Canvas items in database: ${itemCount}`);

  console.log("\n✅ Database seed completed successfully!");
  console.log("\nTest Credentials:");
  console.log("Email: alice@example.com or bob@example.com");
  console.log("Password: TestPassword123!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error("Error seeding database:", error);
    // Disconnect before exiting so Prisma is not left mid-connection.
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
