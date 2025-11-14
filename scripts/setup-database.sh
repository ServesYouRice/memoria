#!/bin/bash

# Database Setup Script for CanvasCollect
# This script helps set up the database and Prisma client

set -e  # Exit on error

echo "🎨 CanvasCollect Database Setup"
echo "================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  No .env file found. Creating from .env.example...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✅ Created .env file${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANT: Edit .env and set your DATABASE_URL and NEXTAUTH_SECRET${NC}"
    echo ""
    echo "Generate a secret with: openssl rand -base64 32"
    echo ""
    read -p "Press enter when you've updated .env..."
fi

# Check if DATABASE_URL is set
if ! grep -q "^DATABASE_URL=" .env || grep -q "^DATABASE_URL=\"postgresql://user:password@localhost:5432" .env; then
    echo -e "${RED}❌ DATABASE_URL not properly configured in .env${NC}"
    echo ""
    echo "Please set DATABASE_URL to your PostgreSQL connection string."
    echo "Example: postgresql://username:password@localhost:5432/canvas_collect"
    echo ""
    exit 1
fi

# Check if NEXTAUTH_SECRET is set
if ! grep -q "^NEXTAUTH_SECRET=" .env || grep -q "^NEXTAUTH_SECRET=\"your-secret-key" .env; then
    echo -e "${RED}❌ NEXTAUTH_SECRET not properly configured in .env${NC}"
    echo ""
    echo "Generate a secret with: openssl rand -base64 32"
    echo "Then add it to .env as NEXTAUTH_SECRET"
    echo ""
    exit 1
fi

echo -e "${GREEN}✅ Environment variables configured${NC}"
echo ""

# Test database connection
echo "🔍 Testing database connection..."
if pnpm prisma db execute --stdin <<< "SELECT 1;" >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Database connection successful${NC}"
else
    echo -e "${RED}❌ Cannot connect to database${NC}"
    echo ""
    echo "Please verify:"
    echo "  1. PostgreSQL is running"
    echo "  2. DATABASE_URL in .env is correct"
    echo "  3. Database user has proper permissions"
    echo ""
    exit 1
fi

echo ""

# Generate Prisma Client
echo "📦 Generating Prisma Client..."
if pnpm prisma generate; then
    echo -e "${GREEN}✅ Prisma Client generated${NC}"
else
    echo -e "${YELLOW}⚠️  Prisma Client generation failed${NC}"
    echo ""
    echo "If you're in an offline environment, try:"
    echo "  PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1 pnpm prisma generate"
    echo ""
    exit 1
fi

echo ""

# Run migrations
echo "🔄 Running database migrations..."
read -p "Do you want to run migrations? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if pnpm prisma migrate deploy; then
        echo -e "${GREEN}✅ Migrations completed${NC}"
    else
        echo -e "${RED}❌ Migration failed${NC}"
        echo ""
        echo "For development, try:"
        echo "  pnpm run db:migrate:dev"
        echo ""
        exit 1
    fi
fi

echo ""

# Seed database (optional)
echo "🌱 Seed database with sample data?"
read -p "Do you want to seed the database? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ -f prisma/seed.ts ]; then
        if pnpm run db:seed; then
            echo -e "${GREEN}✅ Database seeded${NC}"
        else
            echo -e "${YELLOW}⚠️  Seeding failed${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  No seed file found${NC}"
    fi
fi

echo ""
echo -e "${GREEN}🎉 Database setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Run: pnpm run dev"
echo "  2. Open: http://localhost:3000"
echo "  3. Start building! 🚀"
echo ""
