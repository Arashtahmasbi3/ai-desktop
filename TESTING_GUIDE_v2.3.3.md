# Testing Guide — v2.3.3 (Git-Aware Agent + Self-Diagnosis)

Run the automated suite first, then the manual checklist in the app.

## 1. Automated regression

```bash
npm run typecheck   # tsc for node + web
npx vitest run      # full Vitest suite
npm run build       # electron-vite production build
```

Expected on this tree: **108 test files, 815 passed | 1 skipped**; typecheck and
build clean.

## 2. Targeted suites added in v2.3.3

```bash
npx vitest run test/core/workspace-detect.test.ts
npx vitest run test/core/workspace-prompt.test.ts
npx vitest run test/core/loop-detector.test.ts
npx vitest run test/core/git-setup.test.ts
npx vitest run test/core/git-status.test.ts
npx vitest run test/core/system-health.test.ts
npx vitest run test/core/install-recipes.test.ts
npx vitest run test/e2e/v2.3.3-git-aware.e2e.test.ts
```

| Suite | Focus |
| --- | --- |
| `workspace-detect` | `test -d .git` probe, branch/remote/dirty, quoting, non-repo fast path |
| `workspace-prompt` | git-aware vs plain-file system hint |
| `loop-detector` | two failures block the tool; success/reset clears it; unrelated tools unaffected |
| `git-setup` | command order, `.gitignore` templates, push only with a URL, quoting |
| `git-status` | `--porcelain=v1 --branch` parsing (ahead/behind/dirty/clean) |
| `system-health` | node/npm/git/docker/pm2 probes, disk/memory parsing, recommendations |
| `install-recipes` | recipe lookup, sudo prefixing, approval/sudo gate |
| `v2.3.3-git-aware.e2e` | 6 integration + 3 security scenarios (see below) |

## 3. What the e2e suite proves

1. A git repo is detected with the correct branch and dirty flag.
2. A non-git folder falls back to plain file tools ("No git").
3. Auto-git-setup runs `git init` and then the initial commit.
4. After git fails twice the loop routes to `ls` instead of aborting.
5. The health check returns a full report (node/git/disk/memory).
6. An approved docker install runs its `sudo` commands and verifies.
7. A sudo install without elevation is rejected.
8. An install without approval never executes a command.
9. A `git push` with an invalid token surfaces the auth error.

## 4. Manual checklist

- [ ] Connect a VPS, add a **remote** project that is a git repo → chat header shows
      the branch; sidebar pill shows `branch · N changes`.
- [ ] Add a **remote** project that is not a repo → the "Setup Git?" dialog appears;
      the command preview matches the checked options; **Skip** closes it.
- [ ] Run the dialog → `.gitignore` is created for the chosen type and the initial
      commit lands.
- [ ] Open VPS → **Health** → report lists tools; a missing tool offers **Install**.
- [ ] Confirm a plain install runs; a sudo install asks for the second confirmation,
      and cancelling it runs nothing.
- [ ] Ask the agent to `git commit` in a non-repo folder → it errors, then the agent
      switches to file tools instead of looping forever.

## 5. Manual Windows build / release

`build:win` must run on Windows (electron-builder NSIS needs a Windows or Wine
host):

```powershell
npm run typecheck; npm test; npm run build
npm run build:win
```

Attach `AI.Desktop.Setup.2.3.3.exe`, `AI.Desktop.2.3.3.Portable.exe` and
`SHA256SUMS.txt` to the GitHub release.
