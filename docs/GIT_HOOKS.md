# Git Hooks Setup

> **FIXED:** Issue #44 - Git hooks enforcing code quality rules

This project uses [Husky](https://typicode.github.io/husky/) to enforce code quality through git hooks.

## Available Hooks

### Pre-Commit Hook

**Triggers:** Before each commit
**Location:** `.husky/pre-commit`

**Checks:**
- ✅ **ESLint** - Automatically fixes linting errors
- ✅ **Prettier** - Automatically formats code
- ✅ **Staged files only** - Only checks files you're committing

**What it does:**
```bash
# For *.{js,jsx,ts,tsx} files:
- eslint --fix
- prettier --write

# For *.{json,md} files:
- prettier --write
```

**Example output:**
```
✔ Preparing lint-staged...
✔ Running tasks for staged files...
✔ Applying modifications from tasks...
✔ Cleaning up temporary files...
✅ Pre-commit checks passed!
```

---

### Commit Message Hook

**Triggers:** Before commit message is saved
**Location:** `.husky/commit-msg`

**Checks:**
- ✅ **Conventional Commits format**
- ✅ **Valid commit type**
- ✅ **Subject length** (1-100 characters)

**Format:**
```
type(scope?): subject

# Or with breaking change:
type(scope?)!: subject
```

**Valid types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, semicolons, etc.)
- `refactor` - Code refactoring
- `test` - Adding or updating tests
- `chore` - Maintenance tasks
- `perf` - Performance improvements
- `ci` - CI/CD changes
- `build` - Build system changes
- `revert` - Reverting previous commits

**Examples:**
```bash
# ✅ Valid commit messages:
git commit -m "feat: add dark mode support"
git commit -m "fix(auth): resolve session timeout issue"
git commit -m "docs: update API documentation"
git commit -m "refactor(canvas): extract utility functions"
git commit -m "test: add E2E tests for sharing flow"
git commit -m "perf(canvas): optimize rendering with React.memo"

# ❌ Invalid commit messages:
git commit -m "updated files"           # Missing type
git commit -m "feature: add login"      # Wrong type (use 'feat')
git commit -m "fix:"                    # Missing subject
```

**Error example:**
```
❌ Invalid commit message format!

Commit message must follow Conventional Commits format:
  type(scope?): subject

Valid types: feat, fix, docs, style, refactor, test, chore, perf, ci, build, revert

Your commit message:
  updated files
```

---

### Pre-Push Hook

**Triggers:** Before pushing to remote
**Location:** `.husky/pre-push`

**Checks:**
- ✅ **Type checking** - Full TypeScript type check
- ✅ **Unit tests** - Runs all unit tests
- ✅ **Linting** - Full project lint check

**What it does:**
```bash
1. pnpm run type-check  # Check for TypeScript errors
2. pnpm run test --run  # Run all tests
3. pnpm run lint        # Lint entire project
```

**Example output:**
```
🔍 Running pre-push checks...
📝 Type checking...
✓ No type errors found

🧪 Running tests...
✓ 45 tests passed

🔧 Running linter...
✓ No linting errors

✅ All pre-push checks passed!
🚀 Pushing to remote...
```

**Why pre-push instead of pre-commit?**
- **Faster commits** - Type checking and testing can be slow
- **Better workflow** - Allows rapid iteration during development
- **CI safety** - Catches issues before they reach CI/CD
- **Flexibility** - Can commit work-in-progress locally

---

## Bypassing Hooks

### Skip Pre-Commit Hook

```bash
# Not recommended, but available for emergencies
git commit --no-verify -m "WIP: work in progress"
```

### Skip Pre-Push Hook

```bash
# Not recommended, but available for emergencies
git push --no-verify
```

**⚠️ Warning:** Only bypass hooks when absolutely necessary. CI/CD will still run these checks, and failing builds block deployments.

---

## Troubleshooting

### Hook Not Running

**Problem:** Git hooks not executing

**Solution:**
```bash
# Reinstall husky hooks
pnpm run prepare

# Verify hooks are executable
ls -la .husky/
```

### Type Check is Slow

**Problem:** Pre-push hook takes too long

**Solution:**
```bash
# Option 1: Skip type check during development
git push --no-verify

# Option 2: Use incremental type checking (faster)
# Add to tsconfig.json:
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo"
  }
}
```

### Lint-Staged Failures

**Problem:** Pre-commit fails even after fixes

**Solution:**
```bash
# Clear lint-staged cache
rm -rf .git/.lint-staged-*

# Re-run
git commit
```

### Tests Failing Locally

**Problem:** Pre-push hook fails on tests

**Solution:**
```bash
# Run tests manually to see full output
pnpm run test

# Fix failing tests, then:
git push
```

---

## Configuration

### Customizing Lint-Staged

**Location:** `package.json`

```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": [
      "eslint --fix",
      "prettier --write"
    ],
    "*.{json,md}": [
      "prettier --write"
    ]
  }
}
```

**Add more checks:**
```json
{
  "lint-staged": {
    "*.{js,jsx,ts,tsx}": [
      "eslint --fix",
      "prettier --write",
      "vitest related --run"  // Run tests for related files
    ]
  }
}
```

### Customizing Pre-Push Checks

**Location:** `.husky/pre-push`

```bash
# Add build check
pnpm run build
if [ $? -ne 0 ]; then
  echo "❌ Build failed."
  exit 1
fi
```

---

## Best Practices

### 1. Commit Often, Push Less Frequently

```bash
# Make small, focused commits locally
git commit -m "feat(auth): add login form"
git commit -m "feat(auth): add validation"
git commit -m "test(auth): add login tests"

# Then push once all tests pass
git push
```

### 2. Fix Issues Immediately

When a hook fails, fix the issue before proceeding:

```bash
# Pre-commit failed
❌ Pre-commit checks failed. Please fix the errors above.

# Fix the issues, then stage and commit again
git add .
git commit -m "fix: resolve linting errors"
```

### 3. Use Conventional Commits

Following the Conventional Commits format provides:
- **Better changelog generation**
- **Automatic semantic versioning**
- **Clearer commit history**
- **Easier code review**

### 4. Don't Skip Hooks in Production Branches

```bash
# ❌ Never do this on main/production branches
git push --no-verify origin main

# ✅ Always run full checks before merging
git push origin feature-branch
```

---

## CI/CD Integration

The same checks run in CI/CD:

```yaml
# .github/workflows/ci.yml
- name: Lint
  run: pnpm run lint

- name: Type Check
  run: pnpm run type-check

- name: Test
  run: pnpm run test --run

- name: Build
  run: pnpm run build
```

**Benefits:**
- Git hooks catch issues early (faster feedback)
- CI/CD provides final validation (safety net)
- Prevents broken code from reaching production

---

## Performance Optimization

### Incremental Type Checking

**Add to `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo"
  }
}
```

**Add to `.gitignore`:**
```
.tsbuildinfo
```

**Result:** Type checking becomes much faster after the first run.

### Parallel Execution

**Update `.husky/pre-push`:**
```bash
# Run checks in parallel (requires GNU parallel)
parallel ::: \
  "pnpm run type-check" \
  "pnpm run test --run" \
  "pnpm run lint"
```

---

## Resources

- **Husky:** https://typicode.github.io/husky/
- **Lint-Staged:** https://github.com/okonet/lint-staged
- **Conventional Commits:** https://www.conventionalcommits.org/

---

**Last Updated:** 2025-11-15
**Issue:** #44 - Git hooks enforcement
