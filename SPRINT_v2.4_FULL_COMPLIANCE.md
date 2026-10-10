# SPRINT v2.4 — Full Source-Doc Compliance


## 🎯 هدف
تکمیل ۱۰ قابلیت باقی‌مانده از سند منبع، برای رسیدن به ۹۵٪ انطباق.


## ⛔ قوانین سخت (طبق DEVELOPMENT_CHECKLIST.md)
- بدون skip
- هر تسک: یک commit + حداقل ۳ تست
- قبل از هر commit: typecheck + test + build
- بررسی state قبل از هر تغییر
- Enforcement «حل شد» بدون health check = ممنوع
- اگر شک داری، بپرس


## 📋 پیش‌نیاز
قبل از شروع، DEVELOPMENT_CHECKLIST.md را بخوان و در AGENTS.md تأیید کن:
"v2.4 Sprint — Checklist reviewed. Rules acknowledged. Branch: feature/v2.4-full-compliance."


---


# 🔴 فاز A — قابلیت اطمینان (Reliability)


## تسک A.1: Job ID + Long-Running Tasks


**مشکل (از سند — بخش «چند سؤال مهم بعدی»):**
> «اگر اپ بسته شود، task چه می‌شود؟»


**راه‌حل:**


### ۱. `src/core/agent/job-manager.ts`:
```typescript
interface Job {
  id: string;           // UUID
  command: string;
  vpsId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  exitCode?: number;
  output: string;       // آخرین N خط
  sessionName?: string; // tmux session
}


class JobManager {
  async startLongJob(vpsId, command, options): Promise<Job> {
    const jobId = generateUUID();
    const sessionName = `aidesk-${jobId.slice(0, 8)}`;
    
    // اگر tmux نصب است:
    const hasTmux = await ssh.exec(`which tmux`);
    if (hasTmux.ok) {
      await ssh.exec(`tmux new-session -d -s ${sessionName} '${command} 2>&1 | tee /tmp/${jobId}.log; echo $? > /tmp/${jobId}.exit'`);
      return { id: jobId, sessionName, status: 'running', ... };
    }
    
    // اگر systemd-run موجود است:
    const hasSystemdRun = await ssh.exec(`which systemd-run`);
    if (hasSystemdRun.ok) {
      await ssh.exec(`systemd-run --unit=${sessionName} --no-block bash -c '${command} 2>&1 | tee /tmp/${jobId}.log'`);
      return { id: jobId, sessionName, status: 'running', ... };
    }
    
    // fallback: nohup
    await ssh.exec(`nohup bash -c '${command} > /tmp/${jobId}.log 2>&1' &`);
    return { id: jobId, sessionName: null, status: 'running', ... };
  }
  
  async getJobStatus(vpsId, jobId): Promise<Job> {
    const log = await ssh.exec(`cat /tmp/${jobId}.log 2>/dev/null`);
    const exit = await ssh.exec(`cat /tmp/${jobId}.exit 2>/dev/null`);
    
    if (exit.ok && exit.stdout.trim()) {
      return {
        status: exit.stdout.trim() === '0' ? 'completed' : 'failed',
        exitCode: parseInt(exit.stdout),
        output: log.stdout,
      };
    }
    return { status: 'running', output: log.stdout };
  }
  
  async waitForJob(vpsId, jobId, timeoutMs = 30 * 60 * 1000): Promise<Job> {
    // polling هر ۵ ثانیه
  }
}
```


### ۲. در `remote-shell-tool.ts`:
```typescript
if (estimatedDuration(command) > 60_000) {  // اگر > ۶۰s
  return jobManager.startLongJob(vpsId, command);
}
```


### ۳. UI:
- در Chat، کارت Job:
  ```
  ┌─────────────────────────────────────┐
  │ 🔄 Job #abc12345 (running)         │
  │ $ npm install                       │
  │ Started: 2 min ago                  │
  │ [View log] [Kill] [Wait]            │
  └─────────────────────────────────────┘
  ```
- Background polling
- Notification وقتی تمام شد


### ۴. Persistence:
- Jobs در `~/.ai-desktop/jobs.json`
- بعد از restart، jobs قبلی reload شوند
- Status جدید sync شود


**تست:** ۸ سناریو
1. Job کوتاه (< ۶۰s) → مستقیم
2. Job طولانی → tmux
3. Job طولانی بدون tmux → systemd-run
4. Job طولانی بدون هیچ → nohup
5. Restart اپ → jobs reload
6. Kill job → tmux kill
7. Timeout → pause
8. Exit code ثبت


---


## تسک A.2: State Check قبل از تغییر


**مشکل (از سند — بخش ۴):**
> «پیش از تغییر، وضعیت فعلی بررسی می‌شود.»


**راه‌حل:**


### ۱. `src/core/agent/preflight.ts`:
```typescript
interface PreflightResult {
  ok: boolean;
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message: string;
  }>;
}


async function preflight(ssh, workspace, action): Promise<PreflightResult> {
  const checks = [];
  
  // ۱. Workspace exists
  const exists = await ssh.exec(`test -d ${workspace.path}`);
  checks.push({ name: 'workspace', status: exists.ok ? 'pass' : 'fail', ... });
  
  // ۲. Git status (اگر git)
  if (workspace.isGitRepo) {
    const dirty = await ssh.exec(`cd ${workspace.path} && git status --porcelain`);
    if (dirty.stdout.trim()) {
      checks.push({ 
        name: 'git-clean', 
        status: 'warn',
        message: `${dirty.stdout.split('\n').length} uncommitted files. Commit first?`
      });
    }
  }
  
  // ۳. Disk space (اگر action = write/build)
  if (['write', 'build', 'install'].includes(action)) {
    const df = await ssh.exec(`df -h ${workspace.path} --output=pcent | tail -1`);
    const percent = parseInt(df.stdout);
    if (percent > 90) {
      checks.push({ name: 'disk', status: 'fail', message: `Disk ${percent}% full` });
    }
  }
  
  // ۴. Process check (اگر action = deploy)
  if (action === 'deploy') {
    const pm2 = await ssh.exec(`pm2 list`);
    checks.push({ name: 'pm2', status: 'pass', message: 'PM2 accessible' });
  }
  
  return {
    ok: !checks.some(c => c.status === 'fail'),
    checks,
  };
}
```


### ۲. در `agent-orchestrator.ts`:
قبل از هر tool call با action حساس، preflight اجرا شود.


### ۳. UI:
اگر preflight warning دارد، بنر زرد:
```
⚠️ Preflight warnings:
  • 3 uncommitted files in git
  • [Commit first] [Proceed anyway]
```


**تست:** ۶ سناریو
1. workspace exists → pass
2. workspace missing → fail
3. git dirty → warn
4. disk 95% → fail
5. disk 50% → pass
6. deploy + pm2 missing → warn


---


## تسک A.3: Enforcement "حل شد" بدون تست


**مشکل (از سند — بخش ۴):**
> «مدل نباید صرفاً از روی حدس بگوید "حل شد"؛ باید test یا health-check واقعی داشته باشد.»


**راه‌حل:**


### ۱. `src/core/agent/success-verifier.ts`:
```typescript
// AI اجازه ندارد "Completed" یا "Done" بگوید مگر:
// - یک tool call موفق با exit code 0 در ۳۰ ثانیه اخیر
// - یا یک health check موفق
// - یا یک test موفق


const SUCCESS_MARKERS = [
  'completed', 'done', 'successfully', 'fixed', 'resolved',
  'تمام شد', 'انجام شد', 'حل شد', 'موفق',
];


function verifySuccess(aiResponse: string, recentToolCalls: ToolCall[]): {
  allowed: boolean;
  reason?: string;
} {
  const claimsSuccess = SUCCESS_MARKERS.some(m => 
    aiResponse.toLowerCase().includes(m)
  );
  
  if (!claimsSuccess) return { allowed: true };
  
  const recent = recentToolCalls.filter(tc => 
    Date.now() - tc.timestamp < 30_000
  );
  
  const hasSuccessfulVerification = recent.some(tc => 
    tc.exitCode === 0 && (
      tc.toolName.includes('test') ||
      tc.toolName.includes('health') ||
      tc.toolName.includes('verify') ||
      tc.toolName.includes('build')
    )
  );
  
  if (!hasSuccessfulVerification) {
    return {
      allowed: false,
      reason: 'No recent verification (test/health/build). Please run a verification command first.',
    };
  }
  
  return { allowed: true };
}
```


### ۲. در orchestrator:
قبل از نمایش پیام AI به کاربر، verifySuccess اجرا شود. اگر fail:
- پیام AI بازنویسی شود
- یا AI مجبور به اجرای verification شود


### ۳. UI:
اگر AI ادعای موفقیت کرد بدون تست:
```
⚠️ AI claims success without verification.
[Run tests] [Run health check] [Accept anyway]
```


**تست:** ۵ سناریو
1. AI می‌گوید "انجام شد" + test موفق → allow
2. AI می‌گوید "انجام شد" بدون test → block
3. AI می‌گوید "خطا خورد" → allow (بدون نیاز به test)
4. AI می‌گوید "فایل ساخته شد" + exit 0 → allow
5. AI می‌گوید "deployed" بدون health check → block


---


# 🟠 فاز B — Migration Tools


## تسک B.1: Database Migration


**هدف:** انتقال دیتابیس بین سرورها (طبق سند — بخش ۷).


### ۱. `src/core/tools/db-migrate-tool.ts`:
```typescript
// پشتیبانی از:
// - PostgreSQL (pg_dump + pg_restore)
// - MySQL/MariaDB (mysqldump + restore)
// - MongoDB (mongodump + mongorestore)
// - SQLite (فایل رو کپی کن)


async function migrateDatabase(params: {
  sourceVpsId: string;
  sourceDb: { type: string; name: string; user: string; host?: string; port?: number };
  targetVpsId: string;
  targetDb: { ... };
}): Promise<{ ok: boolean; logs: string[] }> {
  
  // ۱. Detect DB type
  // ۲. Check tools available (pg_dump, mysqldump, ...)
  // ۳. Backup target DB (اگر وجود دارد)
  // ۴. Dump source → /tmp/dump.sql
  // ۵. Transfer dump (rsync یا SFTP)
  // ۶. Restore on target
  // ۷. Verify (row count, schema)
  // ۸. Cleanup
}
```


### ۲. امنیت:
- Password در command line = **ممنوع**
- استفاده از `~/.pgpass` یا `MYSQL_PWD` env
- Dry-run: نشان بده چه دیتابیسی منتقل می‌شود
- Backup اجباری قبل از restore
- Approval برای عملیات روی production


### ۳. UI:
```
┌────────────────────────────────────┐
│  🗄️ Migrate Database              │
├────────────────────────────────────┤
│  Source:                           │
│    VPS: spmotor                    │
│    DB: postgres://user@localhost/mydb │
│    Size: 45 MB                     │
│                                    │
│  Target:                           │
│    VPS: production                 │
│    DB: postgres://user@localhost/mydb │
│    ⚠️ Will overwrite existing data │
│    ☐ Backup target first (recommended)│
│                                    │
│  [Dry-run] [Proceed] [Cancel]      │
└────────────────────────────────────┘
```


**تست:** ۵ سناریو
1. PostgreSQL migrate
2. MySQL migrate
3. Dry-run
4. Backup before restore
5. Fail in middle → rollback


---


## تسک B.2: Docker Image Transfer


**هدف:** انتقال image بین سرورها (طبق سند — بخش ۷).


### ۱. `src/core/tools/docker-migrate-tool.ts`:
```typescript
async function migrateDockerImage(params: {
  sourceVpsId: string;
  image: string;
  tag: string;
  targetVpsId: string;
  useRegistry?: boolean;  // اگر true: از registry استفاده کن
  registryAuth?: { ... };
}): Promise<{ ok: boolean; imageId?: string }> {
  
  if (params.useRegistry) {
    // راه ۱: push to registry, pull on target
    await ssh1.exec(`docker push ${image}:${tag}`);
    await ssh2.exec(`docker pull ${image}:${tag}`);
  } else {
    // راه ۲: save → transfer → load
    await ssh1.exec(`docker save ${image}:${tag} -o /tmp/${image}.tar`);
    await transferFile(sourceVps, targetVps, `/tmp/${image}.tar`);
    await ssh2.exec(`docker load -i /tmp/${image}.tar`);
    await ssh1.exec(`rm /tmp/${image}.tar`);
  }
  
  // Verify
  const targetImageId = await ssh2.exec(`docker images -q ${image}:${tag}`);
  return { ok: !!targetImageId.stdout.trim(), imageId: targetImageId.stdout };
}
```


### ۲. UI:
- Dropdown: "Transfer to VPS..."
- انتخاب image از لیست
- انتخاب target
- Dry-run: حجم image


**تست:** ۴ سناریو
1. Small image save/load
2. Large image via registry
3. Verify after load
4. Cleanup temp files


---


## تسک B.3: Checksum Verify در migrate_project


**هدف:** اطمینان از انتقال صحیح (طبق سند — بخش ۷).


### ۱. در `migrate-project-tool.ts`:
بعد از rsync:
```typescript
// ۱. Hash همه فایل‌ها روی source
const sourceHash = await ssh1.exec(
  `cd ${sourcePath} && find . -type f -exec sha256sum {} \\; | sort | sha256sum`
);


// ۲. Hash همان‌ها روی target
const targetHash = await ssh2.exec(
  `cd ${targetPath} && find . -type f -exec sha256sum {} \\; | sort | sha256sum`
);


if (sourceHash.stdout !== targetHash.stdout) {
  throw new Error('Checksum mismatch! Transfer may be incomplete.');
}


// ۳. گزارش
return {
  ok: true,
  filesCount: ...,
  totalSize: ...,
  checksum: sourceHash.stdout.slice(0, 12),
};
```


**تست:** ۳ سناریو
1. Transfer سالم → checksum match
2. Transfer ناقص → mismatch error
3. Empty dir → checksum ok


---


# 🟡 فاز C — Project Isolation


## تسک C.1: Per-Project Linux User


**هدف (طبق سند — بخش ۵):** هر پروژه یک Linux user جدا.


### ۱. `src/core/agent/project-user-manager.ts`:
```typescript
async function createProjectUser(ssh, project: Project): Promise<{
  username: string;
  created: boolean;
}> {
  const username = `aidesk-${project.id.slice(0, 8)}`;
  
  // Check if exists
  const exists = await ssh.exec(`id ${username} 2>/dev/null`);
  if (exists.ok) return { username, created: false };
  
  // Create user (needs sudo)
  await ssh.exec(`sudo useradd -m -s /bin/bash ${username}`, {
    requiresSudo: true,
    requiresApproval: true,
  });
  
  // Setup SSH key
  // ...
  
  // Chown project dir
  await ssh.exec(`sudo chown -R ${username}:${username} ${project.path}`);
  
  return { username, created: true };
}
```


### ۲. Safety:
- کاربر root نمی‌تواند بدون approval ساخته شود
- اگر sudo نیاز است، دو مرحله‌ای: first approval + sudo confirmation
- Rollback: اگر fail شد، کاربر حذف شود


**تست:** ۴ سناریو
1. User exists → reuse
2. User missing → create
3. Sudo required → approval flow
4. Rollback on fail


---


## تسک C.2: Per-Project SSH Key


**هدف (طبق سند — بخش ۵):** هر پروژه SSH key جدا.


### ۱. در `project-metadata.ts`:
- فیلد `sshKeyRef` (فقط reference، نه کلید)
- فیلد `sshKeyFingerprint`


### ۲. Flow:
1. کاربر SSH key می‌سازد (یا از ~/.ssh انتخاب می‌کند)
2. Public key به `~/.ssh/authorized_keys` روی سرور اضافه می‌شود
3. Private key در keytar (vault سیستم) ذخیره
4. فقط reference در project metadata
5. AI هرگز private key نمی‌بیند


### ۳. در System Prompt:
```
You have access to SSH key reference: ${keyRef}.
The actual key is in the OS vault (keytar). 
You NEVER see the key content. To connect, use the reference.
```


**تست:** ۴ سناریو
1. Generate new key
2. Import existing key
3. Use key for connection
4. Key never exposed in logs


---


## تسک C.3: Git Worktree Support


**هدف (از C.3 معوق v2.3.2):** کار موازی روی یک repo.


### ۱. `src/core/agent/worktree-manager.ts`:
```typescript
async function createWorktree(ssh, project, branch: string): Promise<{
  path: string;
  branch: string;
}> {
  const worktreePath = `${project.path}.worktrees/${branch}`;
  
  // Check if worktree exists
  const exists = await ssh.exec(`test -d ${worktreePath}`);
  if (exists.ok) return { path: worktreePath, branch };
  
  // Create worktree
  await ssh.exec(
    `cd ${project.path} && git worktree add ${worktreePath} ${branch}`
  );
  
  return { path: worktreePath, branch };
}


async function removeWorktree(ssh, project, branch): Promise<void> {
  await ssh.exec(
    `cd ${project.path} && git worktree remove ${project.path}.worktrees/${branch}`
  );
}
```


### ۲. UI:
- Dropdown در Chat Header: انتخاب worktree یا اصلی
- Tab جدید برای هر worktree
- Lock management


**تست:** ۵ سناریو
1. Create worktree
2. List worktrees
3. Switch worktree
4. Remove worktree
5. Conflict detection


---


# 🟣 فاز D — Prompt Agent for Scaffolding


## تسک D.1: Project Scaffolding Assistant


**هدف (طبق سند — بخش ۳):** ساخت پروژه با MVP-first approach.


### ۱. در Chat، وقتی کاربر می‌گوید "یک پروژه X بساز":
AI باید این workflow را اجرا کند:


```
Phase 1: Clarification
  - سؤال از کاربر:
    • هدف پروژه چیست؟
    • کاربر نهایی کیست؟
    • کدام تکنولوژی؟ (Node/Python/Go/...)
    • محیط deploy؟ (development/staging/production)
    • بودجه resources؟ (small/medium/large)
  ↓
Phase 2: MVP Definition
  - پیشنهاد ۳-۵ قابلیت core
  - منتظر تأیید
  ↓
Phase 3: Setup
  - ساخت پوشه
  - git init
  - .gitignore
  - README.md
  - package.json (یا معادل)
  - ساختار پایه
  ↓
Phase 4: First Commit
  - git add -A
  - git commit -m "Initial commit: MVP scaffold"
  ↓
Phase 5: Verify
  - npm install
  - npm run build (اگر ممکن)
  - health check
  ↓
Phase 6: Report
  - خلاصه
  - next steps
```


### ۲. در System Prompt:
```
When user asks to build a new project:


ALWAYS ask these questions first:
1. What is the goal?
2. Who is the user?
3. What tech stack?
4. Which environment? (dev/staging/prod)
5. Resource budget? (small/medium/large)


Then propose an MVP (3-5 core features), wait for approval,
then scaffold with:
- git init from day 1
- README with setup instructions
- .env.example
- .gitignore
- Basic tests
```


### ۳. UI:
- Dialog برای clarification
- Template selector (Node API / React App / Python CLI / ...)


**تست:** ۶ سناریو
1. Simple project → MVP proposed
2. Approval flow
3. Git init done
4. README created
5. .env.example created
6. Initial commit


---


# ✅ فاز E — تست و Release


## D.1 Integration Tests
`test/e2e/v2.4-compliance.e2e.test.ts`:
1. Long job + restart → resume
2. Preflight blocks on dirty git
3. Success without test → blocked
4. DB migration end-to-end
5. Docker transfer
6. Checksum verify
7. Per-project user + key
8. Worktree create/remove
9. Scaffold workflow


## D.2 Security Tests
`test/security/v2.4.test.ts`:
1. DB password never in logs
2. SSH key never exposed
3. Sudo requires two approvals
4. Worktree cannot escape project dir
5. Job kill requires permission


## D.3 Release v2.4.0
- نسخه `2.3.3` → `2.4.0`
- CHANGELOG, README, AGENTS.md
- TESTING_GUIDE_v2.4.0.md
- FINAL_REPORT_v2.4.0.md
- `npm run build:win` (روی ویندوز)
- GitHub Release v2.4.0 (اولین release عمومی بعد از v2.3.2)


---


# 🎬 ترتیب اجرا


1. مرور DEVELOPMENT_CHECKLIST.md + تأیید در AGENTS.md
2. تسک A.1 → تست → commit
3. تسک A.2 → تست → commit
4. تسک A.3 → تست → commit
5. تسک B.1 → تست → commit
6. تسک B.2 → تست → commit
7. تسک B.3 → تست → commit
8. تسک C.1 → تست → commit
9. تسک C.2 → تست → commit
10. تسک C.3 → تست → commit
11. تسک D.1 → تست → commit
12. E.1 + E.2 تست‌های integration/security
13. E.3 merge + tag + build + release


# 📊 خروجی انتظار
- ۱۰ قابلیت جدید
- ۴۰+ تست جدید
- ~۹۵٪ انطباق با سند
- v2.4.0 منتشر شده


**بدون skip. اگر شک داری، بپرس.**
