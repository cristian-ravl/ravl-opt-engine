---
name: validate
description: Run full cross-project validation — lint, test, and build for both functions and web
---

Run the complete validation sequence for the optimization engine. Execute each step and report pass/fail.

## Steps

Run these commands in order. Stop and report if any step fails:

1. **Lint** (functions):
   ```bash
   cd /Users/cristian/Documents/dev/Ravl/ravl-opt-engine/functions && npm run lint
   ```

2. **Test** (functions):
   ```bash
   cd /Users/cristian/Documents/dev/Ravl/ravl-opt-engine/functions && npm test
   ```

3. **Build backend** (functions):
   ```bash
   cd /Users/cristian/Documents/dev/Ravl/ravl-opt-engine/functions && npm run build
   ```

4. **Build frontend** (web):
   ```bash
   cd /Users/cristian/Documents/dev/Ravl/ravl-opt-engine/web && npm run build
   ```

## Output

Report a summary table:

| Step | Result |
|------|--------|
| Lint | pass/fail |
| Test | pass/fail (N tests) |
| Build (functions) | pass/fail |
| Build (web) | pass/fail |

If any step fails, show the error output and suggest a fix.
