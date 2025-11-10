# CanvasCollect - Quick Start Guide

## Prerequisites
- Node.js >= 20.0.0
- PostgreSQL database
- pnpm >= 8.0.0

## Installation

### 1. Install pnpm
```bash
npm install -g pnpm@8.15.0
```

### 2. Install Dependencies
```bash
pnpm install
```

### 3. Setup Environment
```bash
cp .env.example .env
```

Edit `.env` and configure your database:
```env
DATABASE_URL="postgresql://user:password@localhost:5432/canvascollect"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="your-secret-key-here"
DEMO_USER_ID="demo-user-id"
```

### 4. Setup Database
```bash
# Generate Prisma Client
pnpm db:generate

# Push schema to database (development)
pnpm db:push
```

### 5. Seed Database (Manual - For Testing)

Connect to your PostgreSQL database and run:
```sql
-- Create demo user
INSERT INTO "User" (id, email, name, "createdAt", "updatedAt")
VALUES ('demo-user-id', 'demo@example.com', 'Demo User', NOW(), NOW());

-- Create demo canvas
INSERT INTO "Canvas" (id, name, "userId", "createdAt", "updatedAt")
VALUES ('demo-canvas-id', 'My First Canvas', 'demo-user-id', NOW(), NOW());
```

### 6. Run Development Server
```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000)

## Testing

### Unit Tests
```bash
pnpm test
```

### E2E Tests
```bash
# Make sure dev server is running first
pnpm dev

# In another terminal:
pnpm test:e2e
```

## Usage

### Creating a Note
1. Click "Add Note" button in the toolbar
2. A new yellow sticky note appears on the canvas
3. Changes are auto-saved after 300ms of inactivity

### Moving a Note
1. Click and drag the note to move it
2. Release to auto-save the new position

### Resizing a Note
1. Click on a note to select it
2. Drag the corner handles to resize
3. Minimum size: 100x100 pixels
4. Release to auto-save

### Deleting a Note
1. Hover over or select a note
2. Click the red X button in the top-right corner
3. Confirm deletion in the dialog

## API Examples

### Create a Note
```bash
curl -X POST http://localhost:3000/api/v1/canvases/demo-canvas-id/items \
  -H "Content-Type: application/json" \
  -d '{
    "type": "NOTE",
    "positionX": 100,
    "positionY": 100,
    "width": 200,
    "height": 150,
    "content": {
      "text": "My first note!"
    }
  }'
```

### Get All Items
```bash
curl http://localhost:3000/api/v1/canvases/demo-canvas-id/items
```

### Update a Note
```bash
curl -X PATCH http://localhost:3000/api/v1/canvases/demo-canvas-id/items/ITEM_ID \
  -H "Content-Type: application/json" \
  -d '{
    "positionX": 150,
    "positionY": 200,
    "version": 1
  }'
```

### Delete a Note
```bash
curl -X DELETE http://localhost:3000/api/v1/canvases/demo-canvas-id/items/ITEM_ID
```

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── api/v1/            # API routes
│   ├── canvas/            # Canvas pages
│   └── providers.tsx      # React providers
├── features/
│   └── canvas/            # Canvas feature
│       ├── components/    # React components
│       └── hooks/         # TanStack Query hooks
├── lib/                   # Shared utilities
│   ├── api-error.ts      # Error handling
│   ├── prisma.ts         # Database client
│   └── validation.ts     # Zod schemas
└── types/                 # TypeScript types
```

## Common Issues

### Database Connection Error
- Check DATABASE_URL in .env
- Ensure PostgreSQL is running
- Verify database exists

### Port Already in Use
```bash
# Kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Prisma Client Not Generated
```bash
pnpm db:generate
```

### Canvas Not Loading
- Check browser console for errors
- Verify demo-canvas-id exists in database
- Check network tab for API errors

## Next Steps

1. ✅ Create notes on canvas
2. ✅ Move and resize notes
3. ✅ Delete notes
4. 📋 Implement Bookmark items (Slice 5)
5. 📋 Add inline text editing
6. 📋 Implement authentication
7. 📋 Add real-time collaboration

## Resources

- [SENATE.md](./SENATE.md) - Full project specification
- [IMPLEMENTATION.md](./IMPLEMENTATION.md) - Implementation details
- [Next.js Docs](https://nextjs.org/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [TanStack Query](https://tanstack.com/query/latest)
- [Konva.js](https://konvajs.org/)

## Support

For issues or questions:
1. Check IMPLEMENTATION.md for details
2. Review relevant ADRs in docs/adr/
3. Inspect browser console and network tab
4. Check server logs in terminal

---

**Happy Coding!** 🎨
