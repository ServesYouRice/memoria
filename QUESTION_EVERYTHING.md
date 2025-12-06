# Question Everything: CanvasCollect Stack Analysis

> Deep analysis of the current tech stack, architecture decisions, and recommendations for a F2P → P2W trajectory.

---

## Executive Summary

| Aspect | Verdict | Action |
|--------|---------|--------|
| Core Stack | ✅ KEEP | Next.js 15 + React 19 + Prisma + PostgreSQL |
| UI Library | ⚠️ CLEANUP | MUI v6/v7 mixed versions, heavy bundle |
| State Management | ⚠️ CONSOLIDATE | 3 overlapping systems |
| Real-time | ❌ INCOMPLETE | Yjs installed but barely integrated |
| Redis | ❌ REDUNDANT | Both `ioredis` AND `redis` packages |
| Canvas Lib | ✅ KEEP | Konva.js is appropriate choice |
| Auth | ✅ KEEP | NextAuth v5 beta is fine |
| Testing | ⚠️ SPARSE | Good tooling, low coverage |

---

## 1. Dependency Analysis

### 🔴 RED FLAGS - Remove or Consolidate

#### 1.1 Dual Redis Packages
```json
"ioredis": "^5.8.2",
"redis": "^5.9.0"
```

**Problem**: Two different Redis clients installed. `ioredis` is used in `redis-client.ts`, `redis` appears unused.

**Recommendation**: Remove `redis` package, keep only `ioredis`.

```bash
pnpm remove redis
```

#### 1.2 Yjs + y-websocket - Incomplete Implementation
```json
"y-websocket": "^3.0.0",
"yjs": "^13.6.27"
```

**Current State**: 
- `yjs-provider.ts` exists but doesn't use `y-websocket`
- No WebSocket client integration in frontend
- Real-time collaboration is **scaffolded but not functional**

**Question**: Is real-time collaboration a launch requirement?
- **If YES**: Need 2-3 weeks to properly integrate
- **If NO**: Consider removing these packages (~50KB savings)

**Recommendation**: Either commit to full Yjs integration or remove for MVP. Current state is dead weight.

#### 1.3 MUI Version Inconsistency
```json
"@mui/icons-material": "^7.3.5",  // v7
"@mui/material": "^6.1.7",        // v6
"@mui/material-nextjs": "^7.3.5"  // v7
```

**Problem**: Icons and NextJS adapter are v7, core is v6. This can cause subtle bugs and bloats bundle.

**Recommendation**: Align all to v6 OR upgrade all to v7:
```bash
pnpm update @mui/material @mui/icons-material @mui/material-nextjs
```

---

### 🟡 YELLOW FLAGS - Evaluate Necessity

#### 1.4 Tiptap Rich Text Editor
```json
"@tiptap/extension-link": "^3.10.5",
"@tiptap/extension-placeholder": "^3.10.5",
"@tiptap/react": "^3.10.5",
"@tiptap/starter-kit": "^3.10.5"
```

**Current Usage**: Only in `RichTextEditor.tsx`

**Question**: Are notes rich text or plain text?
- If mostly plain text with occasional formatting: Tiptap is overkill
- If full rich text editing is core: Keep it

**Bundle Impact**: ~60KB gzipped

**Alternative**: For simple formatting, consider `react-markdown` + `textarea` (~5KB)

#### 1.5 jsPDF
```json
"jspdf": "^3.0.3"
```

**Question**: Is PDF export a launch feature?
- If YES: Keep
- If NO: Remove, add later when needed

**Bundle Impact**: ~90KB gzipped

#### 1.6 zxcvbn Password Strength
```json
"zxcvbn": "^4.4.2"
```

**Bundle Impact**: ~400KB uncompressed (huge!)

**Recommendation**: Use `zxcvbn-ts` instead (tree-shakable, ~20KB) or lazy-load:
```typescript
const zxcvbn = await import('zxcvbn');
```

---

### 🟢 GREEN FLAGS - Keep As-Is

| Package | Reason to Keep |
|---------|----------------|
| `next` 15 | Latest stable, App Router |
| `react` 19 | Necessary for Next 15 |
| `@prisma/client` | Excellent ORM, type-safe |
| `@tanstack/react-query` | Best server state management |
| `zustand` | Lightweight client state |
| `konva` + `react-konva` | Best canvas library for this use case |
| `zod` | Schema validation standard |
| `next-auth` | De facto Next.js auth |
| `pino` | Fast production logging |
| `date-fns` | Modular date utils |
| `argon2` | Best password hashing |

---

## 2. Architecture Analysis

### 2.1 State Management Overlap

Currently using **THREE** state management approaches:

| System | Purpose | Files |
|--------|---------|-------|
| TanStack Query | Server state | `use-canvas-items.ts`, `use-canvases.ts` |
| Zustand | Client UI state | `canvasStore.ts` |
| React useState | Local component state | Everywhere |

**Verdict**: This is actually **correct architecture** per industry best practices. No consolidation needed.

### 2.2 Real-Time Strategy Confusion

**What's Installed**:
- `yjs` + `y-websocket` for CRDT-based sync
- Custom `websocket-server.ts`
- Polling in `useCanvasItemsWithPolling`

**What's Actually Used**:
- Polling only. WebSocket server exists but isn't connected to frontend.

**Question**: What's the real-time strategy?
1. **Polling** (current): Simple, works, but not instant
2. **WebSocket** (partially built): Lower latency, more complex
3. **Yjs CRDT** (installed): True collaboration, complex to implement

**Recommendation**: For MVP, stick with polling. Remove Yjs/y-websocket until you have paying users who need collaboration.

### 2.3 Rate Limiting - Template Code in Production

`src/lib/rate-limit/stores/redis.ts` contains **commented-out implementation** with this pattern:
```typescript
// Uncomment when ioredis is installed:
throw new Error('Redis rate limiting requires ioredis...');
```

**Problem**: `ioredis` IS installed but the code is still template code.

**Recommendation**: Either:
1. Actually implement Redis rate limiting
2. Or use memory-based rate limiting and remove Redis template code

---

## 3. Bundle Size Analysis

### Current Estimated Bundle (unpacked)

| Library | Size (approx) | Essential? |
|---------|---------------|-----------|
| React + React DOM | 130KB | ✅ |
| MUI + Emotion | 200KB | ⚠️ Heavy |
| Konva | 140KB | ✅ For canvas |
| TanStack Query | 40KB | ✅ |
| Tiptap | 60KB | ⚠️ Evaluate |
| jsPDF | 90KB | ❌ Can lazy-load |
| zxcvbn | 400KB | ❌ Must fix |
| Yjs | 50KB | ❌ Not used |
| **Total** | ~1.1MB | |

### Recommended Optimizations

1. **Lazy-load jsPDF**: Only when exporting
2. **Replace zxcvbn**: With `zxcvbn-ts` or lazy-load
3. **Remove Yjs**: Until needed
4. **Tree-shake MUI**: Use path imports

**Target**: Get initial JS bundle under 500KB

---

## 4. $0 Hosting Strategy (Developer Costs)

### Goal: Launch with Zero Infrastructure Costs

| Service | Free Tier | Limit |
|---------|-----------|-------|
| **Vercel** | Hobby | 100GB bandwidth, serverless |
| **Neon PostgreSQL** | Free | 0.5GB storage, 1 project |
| **Supabase** (alt) | Free | 500MB, 2 projects |
| **Upstash Redis** | Free | 10K commands/day |
| **Resend Email** | Free | 100 emails/day |

### What This Means for Architecture

1. **No persistent WebSocket server** - Vercel doesn't support long-running connections
   - Solution: Use Yjs with WebSocket provider via **Liveblocks** (free tier) or **PartyKit** (free tier)
   - Or: Self-host WS server on **Railway.app** (free $5/month credit)

2. **No Redis initially** - Use in-memory rate limiting
   - Upgrade to Upstash when hitting limits

3. **Database must be efficient** - Only 0.5GB on Neon free tier
   - Implement soft delete cleanup (cron job)
   - Lazy-load large content

### Real-Time Collaboration - Reddit Community Recommendations

Based on community feedback, **PartyKit cloud-prem** is the most recommended approach:

| Provider | Free Tier | Reddit Verdict |
|----------|-----------|----------------|
| **PartyKit cloud-prem** | ∞ (your Cloudflare) | ⭐ **WINNER** - Deploy to your own Cloudflare account, $0 PartyKit fee |
| **PartyKit Individual** | 10 projects | ⚠️ Storage clears every 24h |
| **Liveblocks** | 50-100 MAU | Good but limits hit fast |
| **y-websocket self-host** | Railway/Render | Works but needs maintenance |

**Why PartyKit cloud-prem wins:**
1. Built on Cloudflare Workers (global edge, low latency)
2. Platform fee = $0 when using your own Cloudflare
3. Cloudflare Workers free tier = 100K requests/day
4. Native Yjs compatibility
5. Open source

**Alternative backends mentioned:**
- `y-redis` - For scaling when you outgrow in-memory
- `hocuspocus` - Feature-rich Y.js backend
- `y-sweet` - Rust-based, very fast

**Recommendation**: Start with **PartyKit cloud-prem** deployment to your Cloudflare account.

### Packages to Remove (Not Used)

```bash
# These are installed but not imported anywhere
pnpm remove redis jspdf
```

### Scale-Up Path

| Traffic Level | Upgrade Action | Monthly Cost |
|---------------|----------------|--------------|
| 0-1K users | Stay on free tiers | $0 |
| 1K-10K users | Upgrade Neon, add Upstash | ~$25 |
| 10K+ users | Vercel Pro, dedicated DB | ~$100+ |

---

## 5. Missing Pieces

### Must Have Before Launch

| Gap | Priority | Effort |
|-----|----------|--------|
| DOMPurify XSS protection | HIGH | 1 hour |
| Proper error tracking (Sentry) | HIGH | 2 hours |
| Rate limiting (enable it) | HIGH | 1 day |
| Email verification | MEDIUM | 1 day |
| Password reset flow | MEDIUM | 1 day |

### Nice to Have

| Feature | Priority | Effort |
|---------|----------|--------|
| Dark mode persistence | LOW | Done ✅ |
| Keyboard shortcuts dialog | LOW | 2 hours |
| Mobile responsive canvas | MEDIUM | 1 week |
| Offline support (PWA) | LOW | 1 week |

---

## 6. Recommended Actions

### Immediate (Now)

```bash
# 1. Remove unused packages (-90KB bundle, cleaner deps)
pnpm remove redis jspdf

# 2. Fix MUI version inconsistencies
pnpm update @mui/icons-material@^6.1.7 @mui/material-nextjs@^6.1.7

# 3. Install DOMPurify for XSS protection
pnpm add isomorphic-dompurify
```

### Short-Term (This Week)

1. **Fix zxcvbn bundle** - Lazy-load it:
```typescript
// In RegisterForm.tsx
const checkPasswordStrength = async (password: string) => {
  const { default: zxcvbn } = await import('zxcvbn');
  return zxcvbn(password);
};
```

2. **Complete Yjs integration** with PartyKit:
   - Sign up at partykit.io (free)
   - Deploy y-websocket server
   - Connect frontend

3. **Ensure memory-based rate limiting works** (no Redis dependency)

### Pre-Launch Checklist

- [x] `pnpm remove redis jspdf` executed ✓ (Dec 2025)
- [x] DOMPurify installed and integrated ✓ (already existed)
- [x] zxcvbn lazy-loaded ✓ (Dec 2025)
- [ ] Yjs connected via PartyKit or similar (code exists, needs deployment)
- [ ] Deploy to Vercel (free tier)
- [ ] Database on Neon (free tier)
- [x] Basic error tracking (Sentry free tier) ✓ (Dec 2025)

---

## 7. Final Verdict

### Stack Quality: 7.5/10

**Strengths**:
- Modern, well-chosen core stack
- Good architecture patterns (ADRs, separation of concerns)
- Solid authentication setup
- Proper TypeScript usage

**Weaknesses**:
- Technical debt from incomplete features (Yjs, WebSocket)
- Bundle bloat from unused packages
- Mixed package versions
- Template code in production files

### Recommendation

**Ship a lean MVP**. The current stack is overbuilt for a pre-revenue product. Remove unused features, focus on core canvas functionality, and add premium features as users pay for them.

The F2P model should have:
- Core canvas with notes/bookmarks (free, limited)
- 5 canvases, 100 items per canvas
- No real-time collaboration (premium)
- No PDF export (premium)

This reduces complexity, bundle size, and hosting costs while giving a clear upgrade path.

---

*Analysis Date: December 2024*
*Stack Version: v0.1.0*

---

## Gemini Audit - Dec 2025

> **Status**: Verified & Updated
> **Agent**: Antigravity (Gemini)

### 1. Verification of Previous Findings

| Finding | Status | Verification Details |
|---------|--------|----------------------|
| **Dual Redis** | ✅ CONFIRMED | `src/lib/cache/redis-client.ts` uses `ioredis`. `redis` package is unused. |
| **Yjs Integration** | ⚠️ PARTIAL | `use-collaboration.ts` and `websocket-server.ts` exist and look functional, but `Canvas.tsx` does **NOT** use them. Real-time is currently disabled/unused. |
| **Rate Limiting** | ⚠️ TEMPLATE | `src/lib/rate-limit/stores/redis.ts` is commented-out template code. System falls back to memory store. |
| **Sanitization** | ✅ RESOLVED | `src/lib/sanitization.ts` correctly uses `isomorphic-dompurify`. Previous reports of it missing are outdated. |
| **MUI Versions** | ⚠️ MIXED | `package.json` confirms mixed v6/v7 versions. |

### 2. New Findings & Observations

#### 2.1 "P2W" Ambition vs. Current Architecture
The current architecture is a solid "Productivity Tool" foundation (Miro-like). To support "P2W" (Pay-to-Win/Advantage) features, the following are missing or need work:
- **Tiered Quotas**: The database schema supports `Canvas` and `CanvasItem`, but there's no obvious "Plan" or "Quota" enforcement logic visible in the main flows yet (though `Account` table exists).
- **Premium Features**: Real-time collaboration (Yjs) is the obvious "Premium" feature, but it's currently disconnected. Enabling it could be the key differentiator for paid plans.

#### 2.2 Codebase "Clutter"
- **Unused Hooks**: `use-collaboration.ts` is dead code until integrated.
- **Template Code**: `redis.ts` in rate-limit is noise. It should either be implemented or removed.
- **Duplicate Logic**: `use-debounce.ts` exists. `IMPROVEMENTS.md` mentioned a duplicate `useDebounce.ts` but it seems to be gone (good).

### 3. Recommendations for "Unclogging"

1.  **Remove Dead Weight**:
    - Uninstall `redis` (keep `ioredis`).
    - Uninstall `jspdf` if PDF export isn't an immediate MVP feature (can be re-added later).
    - Lazy-load `zxcvbn` (it's huge).

2.  **Fix Dependencies**:
    - Align MUI versions to v6 (stable) or v7 (latest), but don't mix.

3.  **Decide on Real-Time**:
    - **Option A (MVP)**: Delete `use-collaboration.ts`, `websocket-server.ts`, `yjs-provider.ts`, `yjs`, `y-websocket`. Ship with polling.
    - **Option B (Ambition)**: Keep them, but mark them as "Premium/Beta" and actually integrate `useCollaboration` into `Canvas.tsx` behind a feature flag.
    - **Recommendation**: **Option B**. The code is already there. It's better to fix the integration than to delete potentially valuable work, especially since "P2W" needs premium features.

4.  **Rate Limiting**:
    - If you are deploying to Vercel/Serverless, the current memory fallback is "okay" but not great (state isn't shared).
    - If you have a Redis instance (e.g. Upstash), uncomment the code in `redis.ts`.
    - **Action**: Clean up `redis.ts` - either implement it or remove the commented block and keep it simple.

### 4. Action Plan

I propose the following immediate steps to "unclog":
1.  `pnpm remove redis`
2.  `pnpm update @mui/material @mui/icons-material @mui/material-nextjs` (to align versions)
3.  Refactor `RegisterForm.tsx` to lazy-load `zxcvbn`.
4.  (Optional) Clean up `redis.ts` template code.
