# SPRINT v2.4.1 — Wire the Tools into Agent + UI

## 📌 Status (updated)
- ✅ A.1–A.4 agent wiring — commit `b03e658`
- ✅ B.1–B.2 Settings toggle + Chat tool card — commit `1a8582b`
- ✅ C.1–C.2 e2e + mocked smoke — commit `8cfa165`
- ⏸️ D merge/tag/push — **pending explicit confirmation** (tag name `v2.4.0` in the
  plan conflicts with the new `v2.4.1` scope; also pushes to `master`).


## 🎯 هدف
اتصال ۵ ماژول ساخته‌شده در v2.4 به Agent و UI، به‌طوری که AI بتواند در Chat واقعی از آن‌ها استفاده کند.


## ⛔ قوانین سخت
- بدون skip
- هر تسک: یک commit + حداقل ۳ تست
- قبل از هر commit: typecheck + test + build
- اگر شک داری، بپرس


## 🎯 Scope (تنها کاربر خودت هستی — Enterprise features لازم نیست)


### ❌ خارج از scope:
- Multi-user
- SSO
- RBAC
- Audit log برای compliance
- Enterprise UI


### ✅ داخل scope:
- Wiring tools به Agent
- UI ساده در Settings برای toggle
- UI در Chat برای نمایش tool result
- تست end-to-end


---


# 🔴 فاز A — Agent Wiring


## تسک A.1: ثبت migrate_database

**فایل:** `src/core/agent/agent-service.ts` (یا معادل)


### کار:
1. import کن:
   ```typescript
   import { dbMigrateTool, dbMigrateExecutor } from '../tools/db-migrate-tool';
   ```

2. به extraTools اضافه کن:
   ```typescript
   const extraTools = [
     // existing tools...
     dbMigrateTool,
   ];
   ```

3. System hint:
   ```
   Use migrate_database for cross-VPS database migration.
   Supported: postgres, mysql, mongodb, sqlite.
   Always dry-run first.
   ```

### تست:
- `test/core/agent-service-db-wire.test.ts` (۳ سناریو)
- AI mock که `migrate_database` را فراخوانی کند
- Tool در لیست available باشد


---


## تسک A.2: ثبت migrate_docker

همان رویکرد:
- import `dockerMigrateTool`
- اضافه به extraTools
- System hint:
  ```
  Use migrate_docker for Docker image transfer.
  Supports: registry push/pull OR save/load.
  ```

### تست: ۳ سناریو


---


## تسک A.3: ثبت scaffold_project

- import `scaffoldTool`
- اضافه به extraTools
- System hint:
  ```
  Use scaffold_project to create new projects.
  Templates: node-ts, react-vite, python, static.
  Always asks: goal, tech, environment first.
  ```

### تست: ۳ سناریو


---


## تسک A.4: ثبت project_user + worktree_*

- import tools
- اضافه به extraTools:
  - `project_user_create`
  - `project_user_remove`
  - `worktree_create`
  - `worktree_list`
  - `worktree_remove`
- System hints مناسب

### تست: ۴ سناریو


---


# 🟠 فاز B — UI (ساده)


## تسک B.1: Settings → Tools Section

**فایل:** `src/renderer/components/Settings/ToolsSection.tsx`

### UI:
```
┌─────────────────────────────────────┐
│  🧰 Tools                           │
├─────────────────────────────────────┤
│  ☑ migrate_database                 │
│     Cross-VPS database migration    │
│                                     │
│  ☑ migrate_docker                   │
│     Docker image transfer           │
│                                     │
│  ☑ scaffold_project                 │
│     Create new projects             │
│                                     │
│  ☑ project_user                     │
│     Manage Linux users per project  │
│                                     │
│  ☑ worktree_manager                 │
│     Git worktree for parallel tasks │
└─────────────────────────────────────┘
```

- Toggle هر tool
- وضعیت در localStorage
- اگر off: tool در extraTools نباشد

### تست: ۴ سناریو


---


## تسک B.2: Chat — نمایش Tool Result

**هدف:** وقتی AI از یک tool جدید استفاده می‌کند، در Chat با جزئیات نمایش داده شود.

### UI:
```
┌──────────────────────────────────────┐
│ 🔧 migrate_database                  │
│ Source: spmotor/prod-db (45 MB)      │
│ Target: production/prod-db           │
│ Duration: 2m 14s                     │
│ Status: ✅ completed                 │
│ [View details]                       │
└──────────────────────────────────────┘
```

- کامپوننت `ToolResultCard.tsx`
- برای هر tool type، template مخصوص
- در Chat inline با پیام AI

### تست: ۳ سناریو


---


# 🟡 فاز C — تست End-to-End


## تسک C.1: Integration Test
`test/e2e/v2.4.1-wiring.e2e.test.ts`:
1. AI → scaffold_project → result
2. AI → migrate_database (mock) → dry-run → approval → execute
3. AI → worktree_create → switch → remove
4. AI → project_user_create → approval → created
5. Toggle tool off → AI دیگر استفاده نکند


## تسک C.2: Smoke Test واقعی

**هدف:** یک سناریوی واقعی روی VPS خودت.

اگر ممکن است، روی VPS تست کن:
1. `scaffold_project` یک پروژه ساده بسازد
2. Git init شود
3. AI فایل‌ها را ببیند
4. AI یک تغییر کوچک بدهد
5. تغییر ثبت شود

**اگر VPS در دسترس نیست:** mock کن.


---


# ✅ فاز D — merge و tag

بعد از تکمیل:
- `git checkout master`
- `git merge --no-ff feature/v2.4-full-compliance`
- `git tag -a v2.4.0 -m "v2.4.0 — Full Compliance"`
- `git push origin master && git push origin v2.4.0`
- **بدون GitHub Release** (روی ویندوز خودت build می‌کنی)


---


# 🎬 ترتیب اجرا

1. تسک A.1 → تست → commit
2. تسک A.2 → تست → commit
3. تسک A.3 → تست → commit
4. تسک A.4 → تست → commit
5. تسک B.1 → تست → commit
6. تسک B.2 → تست → commit
7. تسک C.1 → تست → commit
8. تسک C.2 → smoke test → گزارش
9. تسک D → merge + tag + گزارش نهایی


# 📊 خروجی انتظار
- ۵ tool در Chat قابل استفاده
- Settings با toggle
- Chat نمایش tool result
- تست‌های end-to-end
- merge + tag v2.4.0


**بدون skip. اگر شک داری، بپرس.**
