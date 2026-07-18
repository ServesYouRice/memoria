/**
 * Database Seed Script
 * Populates the database with sample data for development and testing
 */

import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";

const prisma = new PrismaClient();

async function main() {
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

  const alice = await prisma.user.create({
    data: {
      email: "alice@example.com",
      name: "Alice Johnson",
      passwordHash: testPassword,
    },
  });

  const bob = await prisma.user.create({
    data: {
      email: "bob@example.com",
      name: "Bob Smith",
      passwordHash: testPassword,
    },
  });

  console.log(`Created users: ${alice.email}, ${bob.email}`);

  // Create canvases for Alice
  console.log("Creating canvases...");

  const aliceCanvas1 = await prisma.canvas.create({
    data: {
      name: "Project Planning",
      userId: alice.id,
      zoomLevel: 1.0,
      panX: 0,
      panY: 0,
    },
  });

  const aliceCanvas2 = await prisma.canvas.create({
    data: {
      name: "Research Notes",
      userId: alice.id,
      zoomLevel: 1.2,
      panX: 100,
      panY: 50,
    },
  });

  // Create a canvas for Bob
  const bobCanvas = await prisma.canvas.create({
    data: {
      name: "Ideas Board",
      userId: bob.id,
      zoomLevel: 1.0,
      panX: 0,
      panY: 0,
    },
  });

  console.log(`Created ${3} canvases`);

  // Create canvas items for Alice's first canvas
  console.log("Creating canvas items...");

  await prisma.canvasItem.create({
    data: {
      canvasId: aliceCanvas1.id,
      type: "NOTE",
      positionX: 100,
      positionY: 100,
      width: 300,
      height: 200,
      zIndex: 1,
      content: {
        text: "Welcome to Memoria! This is a sample note item.",
      },
      createdById: alice.id,
      version: 1,
    },
  });

  await prisma.canvasItem.create({
    data: {
      canvasId: aliceCanvas1.id,
      type: "NOTE",
      positionX: 450,
      positionY: 100,
      width: 300,
      height: 200,
      zIndex: 2,
      content: {
        text: "Phase 1: Research\n- Gather requirements\n- Analyze competitors\n- Create user personas",
      },
      createdById: alice.id,
      version: 1,
    },
  });

  await prisma.canvasItem.create({
    data: {
      canvasId: aliceCanvas1.id,
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
      createdById: alice.id,
      version: 1,
    },
  });

  // Create items for Alice's second canvas
  await prisma.canvasItem.create({
    data: {
      canvasId: aliceCanvas2.id,
      type: "NOTE",
      positionX: 200,
      positionY: 200,
      width: 400,
      height: 250,
      zIndex: 1,
      content: {
        text: "Research Findings:\n\n1. Users prefer visual organization\n2. Drag-and-drop is essential\n3. Real-time collaboration is highly requested",
      },
      createdById: alice.id,
      version: 1,
    },
  });

  await prisma.canvasItem.create({
    data: {
      canvasId: aliceCanvas2.id,
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
      createdById: alice.id,
      version: 1,
    },
  });

  // Create items for Bob's canvas
  await prisma.canvasItem.create({
    data: {
      canvasId: bobCanvas.id,
      type: "NOTE",
      positionX: 150,
      positionY: 150,
      width: 350,
      height: 200,
      zIndex: 1,
      content: {
        text: "Brainstorming Session:\n- Feature ideas\n- UI improvements\n- Performance optimizations",
      },
      createdById: bob.id,
      version: 1,
    },
  });

  const itemCount = await prisma.canvasItem.count();
  console.log(`Created ${itemCount} canvas items`);

  console.log("\n✅ Database seed completed successfully!");
  console.log("\nTest Credentials:");
  console.log("Email: alice@example.com or bob@example.com");
  console.log("Password: TestPassword123!");
}

main()
  .catch((error) => {
    console.error("Error seeding database:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
