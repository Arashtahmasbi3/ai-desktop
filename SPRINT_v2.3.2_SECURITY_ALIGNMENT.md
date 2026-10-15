# 🚨 SPRINT v2.3.2 — Remote-First Architecture & Security Alignment


## 🧠 هدف
هم‌راستا کردن AI Desktop با اصول سند امنیتی:
- Remote-First (هر عملیات روی VPS)
- Plan → Approve → Execute
- Credential در vault (نه در JSON)
- Project Isolation
- Command Timeout & Retry Limit
- Secret Masking
- Least Privilege


## ⛔ قوانین سخت


### قانون ۱: ممنوعیت skip
هر تسک باید اجرا شود. اگر غیرممکن است، توقف کن و بپرس.


### قانون ۲: تأیید در هر گام
بعد از هر تسک، این فرمت:
```
✅ Task X.Y — [نام]
- فایل‌های تغییر یافته: [...]
- تست‌های جدید: [نام‌ها]
- نتیجه تست: X passed, Y failed
- typecheck: ✅/❌
- build: ✅/❌
- commit: [hash]
- مسئله باقی‌مانده: [هیچ / توضیح]
```


### قانون ۳: تست واقعی
- هر تسک: حداقل ۳ تست.
- ممنوع: `assert(true)`.
- اگر fail شد، fix کن، بعد commit.


### قانون ۴: قبل از هر commit
```bash
npm run typecheck
npm test
npm run build
```
اگر fail شد، commit نکن.


### استثنائات توقف
1. بودجه > $50
2. ۱۰ خطای متوالی
3. تعارض منطقی


---


# 🔴 فاز A — رفع باگ‌های حیاتی


## تسک A.1: Remote-First File Routing


**مشکل (از اسکرین‌شات):** در Chat، وقتی workspace=remote، AI هنوز از `list_dir` و `read_file` محلی استفاده می‌کند. نتیجه: `list_dir (sandbox_error)`.


**راه‌حل (طبق سند — بخش ۲ «چطور روی VPS کار می‌کنم»):**


### ۱. یکپارچگی در AgentOrchestrator:
```typescript
// src/core/agent/agent-orchestrator.ts
class AgentOrchestrator {
  async beforeToolCall(toolName: string, args: any, context: Context) {
    const workspace = context.activeProject;
    
    if (workspace?.type === 'remote') {
      // Route local fs tools to remote equivalents
      const remoteRoute = {
        'list_dir': 'remote_list_dir',
        'read_file': 'remote_read_file',
        'write_file': 'remote_write_file',
        'exists': 'remote_exists',
        'grep': 'remote_grep',
      };
      
      if (remoteRoute[toolName]) {
        return {
          redirected: true,
          actualTool: remoteRoute[toolName],
          args,
        };
      }
    }
    
    return { redirected: false, actualTool: toolName, args };
  }
}
```


### ۲. اضافه کردن ابزارهای remote:
اگر موجود نیستند، این ابزارها را بساز:
- `remote_list_dir(path)` → `ssh.exec('ls -la {path}')`
- `remote_read_file(path)` → `ssh.exec('cat {path}')`
- `remote_write_file(path, content)` → `ssh.exec('cat > {path} << "EOF"...')`
- `remote_exists(path)` → `ssh.exec('test -e {path} && echo yes || echo no')`
- `remote_grep(pattern, path)` → `ssh.exec('grep -r {pattern} {path}')`


### ۳. System Prompt:
اضافه کن:
```
You are working on a REMOTE workspace at {remotePath} on VPS {vpsName}.
Do NOT use local file tools. Use remote_* tools only.
For any shell command, use remote_shell.
```


**تست:** `test/core/remote-routing.test.ts` — ۸ سناریو:
1. workspace=local → list_dir stays local
2. workspace=remote → list_dir → remote_list_dir
3. workspace=remote + no VPS → clear error
4. workspace=remote + VPS connected → works
5. remote_write_file → no local write
6. args preserved
7. unknown tool → not redirected
8. nested paths


**گزارش:** کد قبلی `agent-orchestrator.ts` (بخش tool routing) را copy کن، سپس تغییرات.


---


## تسک A.2: رفع Path Not Found


**مشکل (از اسکرین‌شات):** پروژه remote، هنوز "Path not found" نشان می‌دهد.


**راه‌حل:**


### ۱. در `src/renderer/components/ChatHeader.tsx`:
```typescript
// قبل:
const hasPath = fs.existsSync(project.path);


// بعد:
const hasPath = project.type === 'local' 
  ? fs.existsSync(project.localPath)
  : project.remotePath && vpsStore.getStatus(project.remoteVpsId) === 'connected';
```


### ۲. نمایش وضعیت دقیق:
| حالت | نمایش |
|------|-------|
| `type=local` + path exists | ✅ بدون warning |
| `type=local` + missing | ⚠ "Local path not found" + [Locate] |
| `type=remote` + VPS connected + path set | ✅ "Remote: /opt/... (connected)" |
| `type=remote` + VPS disconnected | 🔴 "VPS not connected" + [Reconnect] |
| `type=remote` + no VPS | ⚠ "Select a VPS" + dropdown |
| `type=remote` + no path | ⚠ "Set remote path" |


### ۳. حذف Banner قرمز «Path not found» وقتی type=remote.


**تست:** ۶ سناریو (طبق جدول بالا).


---


## تسک A.3: Policy Context-Aware


**مشکل (از اسکرین‌شات):** `remote_shell (blocked)` حتی برای read-only commands.


**راه‌حل (طبق سند — بخش ۲ «دستورهای read-only»):**


### ۱. Policy با دو دسته:
```typescript
// src/core/agent/policy.ts
interface HostPolicy {
  vpsId: string;
  mode: 'read-only' | 'staging' | 'production';
  
  // این‌ها همیشه allow (بدون approval):
  readOnlyCommands: string[];  // ['ls', 'cat', 'grep', 'find', 'pwd', 'git status', 'docker ps', 'systemctl status']
  
  // این‌ها نیاز به approval:
  writeCommands: string[];
  
  // این‌ها بلاک مطلق:
  denyCommands: string[];
  
  allowedPaths: string[];
}
```


### ۲. Default Policy:
```typescript
const DEFAULT_POLICY: HostPolicy = {
  mode: 'staging',
  readOnlyCommands: [
    'ls', 'cat', 'head', 'tail', 'grep', 'find', 'pwd',
    'git status', 'git log', 'git diff', 'git branch',
    'docker ps', 'docker images', 'docker logs',
    'systemctl status', 'systemctl is-active',
    'ps', 'top', 'htop', 'free', 'df', 'du',
    'whoami', 'id', 'uname', 'date',
    'node --version', 'npm --version', 'python --version',
    'echo', 'which', 'file', 'wc',
  ],
  writeCommands: [
    'git pull', 'git fetch', 'git checkout', 'git merge',
    'npm install', 'npm run build', 'npm test',
    'docker compose up', 'docker compose down', 'docker compose restart',
    'pm2 restart', 'pm2 reload', 'systemctl restart', 'systemctl reload',
  ],
  denyCommands: [
    'rm -rf /', 'mkfs', 'dd if=', 'shutdown', 'reboot', 'halt',
    'sudo', 'su', 'chmod -R 777', 'chown -R',
    'git push --force', 'git reset --hard',
    'docker rm -f', 'docker system prune -a',
    'kill -9', ':(){ :|:& };:',
    '> /dev/sda', '> /dev/sdb',
  ],
  allowedPaths: [],
};
```


### ۳. Rule Engine:
```typescript
function checkCommand(command: string, policy: HostPolicy): Decision {
  const baseCmd = command.trim().split(/\s+/)[0];
  
  // Deny اول
  for (const deny of policy.denyCommands) {
    if (command.includes(deny)) {
      return { action: 'deny', reason: `Matched deny rule: ${deny}` };
    }
  }
  
  // Read-only
  for (const ro of policy.readOnlyCommands) {
    if (command.startsWith(ro)) {
      return { action: 'allow', category: 'read-only' };
    }
  }
  
  // Write
  for (const wr of policy.writeCommands) {
    if (command.startsWith(wr)) {
      return { action: 'approval-required', category: 'write' };
    }
  }
  
  // Unknown → approval
  return { action: 'approval-required', category: 'unknown' };
}
```


**تست:** `test/core/policy.test.ts` — ۱۲ سناریو:
1. `ls /opt` در read-only → allow
2. `cat file` → allow
3. `git status` → allow
4. `git pull` در staging → approval
5. `git pull` در production → approval
6. `rm -rf /` → deny
7. `sudo apt install` → deny
8. command ناشناس → approval
9. مسیر خارج از allowedPaths → deny
10. `echo` → allow
11. `docker compose up` در staging → approval
12. `docker compose up` در production → deny


---


## تسک A.4: Command Timeout


**مشکل:** اگر command hang کند، اپ معطل می‌ماند.


**راه‌حل (طبق سند — بخش ۴ «برای هر command timeout»):**


### ۱. در `remote-shell-tool.ts`:
```typescript
const DEFAULT_TIMEOUT = 60_000;      // 60s برای commands معمولی
const BUILD_TIMEOUT = 300_000;       // 5 min برای build/test
const MIGRATION_TIMEOUT = 1_800_000; // 30 min برای migration


function getTimeout(command: string): number {
  if (/\b(npm|yarn|pnpm)\s+(install|build|test)/.test(command)) return BUILD_TIMEOUT;
  if (/\b(rsync|pg_dump|pg_restore|docker save|docker load)/.test(command)) return MIGRATION_TIMEOUT;
  return DEFAULT_TIMEOUT;
}


async function execWithTimeout(ssh, command, timeout) {
  return Promise.race([
    ssh.exec(command),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms: ${command}`)), timeout)
    ),
  ]);
}
```


### ۲. Stream با kill:
```typescript
const stream = await ssh.exec(command);
const timer = setTimeout(() => {
  stream.signal('KILL');
  reject(new Error('Timeout'));
}, timeout);
```


**تست:** `test/core/timeout.test.ts` — ۴ سناریو:
1. command سریع → OK
2. `sleep 120` → timeout بعد از ۶۰s
3. `npm install` → timeout ۳۰۰s
4. `rsync` → timeout ۱۸۰۰s


---


## تسک A.5: Plan Mode


**مشکل (از سند — بخش ۲ و ۴):** AI بدون plan، مستقیم tool call می‌زند → loop.


**راه‌حل:**


### ۱. در System Prompt:
```
CRITICAL WORKFLOW:
1. Before ANY tool call, present a plan:
   - What you will do (max 5 steps)
   - Which tool for each step
   - Expected outcome
2. Wait for user approval.
3. Execute only after approval.
4. Report result.
5. If next step needed, plan again.


Exception: read-only commands (ls, cat, git status) do NOT need plan.
```


### ۲. UI — Plan Card:
در Chat، قبل از tool calls، یک کارت نمایش بده:
```
┌────────────────────────────────────────┐
│ 📋 Plan                                │
├────────────────────────────────────────┤
│ 1. Check remote path: /opt/demo-project│
│    → remote_shell: "ls /opt/..."       │
│ 2. Read package.json                   │
│    → remote_read_file                  │
│ 3. Install dependencies                │
│    → remote_shell: "npm install"       │
│                                        │
│ [Approve Plan] [Modify] [Cancel]       │
└────────────────────────────────────────┘
```


### ۳. State Machine:
```typescript
type AgentPhase = 
  | { type: 'idle' }
  | { type: 'planning', plan: Plan }
  | { type: 'awaiting-approval', plan: Plan }
  | { type: 'executing', currentStep: number }
  | { type: 'completed' }
  | { type: 'stopped', reason: string };
```


### ۴. Full Access Mode:
- در mode=full: plan auto-approve می‌شود (بدون UI).
- در mode=ask/auto-write: plan نمایش داده می‌شود.


**تست:** `test/core/plan-mode.test.ts` — ۸ سناریو:
1. task ساده → plan نمایش داده می‌شود
2. approve plan → اجرا
3. reject plan → متوقف
4. modify plan → ویرایش و اجرا
5. full mode → auto-approve
6. read-only command → بدون plan
7. plan طولانی (>5 step) → هشدار
8. loop در plan → detect


---


# 🟠 فاز B — امنیت و شفافیت


## تسک B.1: Backup قبل از write/destructive


**طبق سند — بخش ۲ و ۷:** قبل از هر عملیات خطرناک، backup.


### ۱. در `remote-write-file-tool.ts`:
```typescript
async function writeFileWithBackup(ssh, path, content) {
  // اگر فایل وجود دارد:
  if (await remoteExists(ssh, path)) {
    const backupPath = `${path}.backup-${Date.now()}`;
    await ssh.exec(`cp ${path} ${backupPath}`);
    audit.log('backup_created', { original: path, backup: backupPath });
  }
  
  // سپس write
  await ssh.exec(`cat > ${path} << 'EOF'\n${content}\nEOF`);
}
```


### ۲. در `migrate-project-tool.ts`:
قبل از `rsync`، یک dry-run بگیر و به کاربر نمایش بده.


### ۳. UI:
- Backup files در `.ai-desktop-backups/` نگهداری شوند.
- در audit log نمایش داده شوند.
- گزینه "Restore from backup" در context menu.


**تست:** ۵ سناریو.


---


## تسک B.2: Health Check بعد از Deploy


**طبق سند — بخش ۲:** بعد از deploy، health check.


### ۱. بعد از `npm run build` یا `docker compose up`:
```typescript
async function healthCheck(ssh, project) {
  // چک‌های عمومی:
  const checks = [
    { name: 'process', cmd: `pgrep -f ${project.processName}` },
    { name: 'port', cmd: `ss -tlnp | grep ${project.port}` },
    { name: 'http', cmd: `curl -s -o /dev/null -w "%{http_code}" http://localhost:${project.port}/health` },
  ];
  
  for (const check of checks) {
    const result = await ssh.exec(check.cmd);
    if (result.exitCode !== 0) {
      return { ok: false, failed: check.name, output: result.output };
    }
  }
  
  return { ok: true };
}
```


### ۲. Config per project:
```typescript
interface Project {
  // ...
  healthCheck?: {
    processName?: string;
    port?: number;
    healthEndpoint?: string;
    customCommand?: string;
  };
}
```


**تست:** ۶ سناریو.


---


## تسک B.3: Dry-run برای rsync


**طبق سند — بخش ۷:** قبل از rsync واقعی، dry-run.


### ۱. در `migrate-project-tool.ts`:
```typescript
// Step 1: dry-run
const dryRunResult = await ssh.exec(
  `rsync -aH --info=progress2 --dry-run -e ssh ${source} ${target}`
);


// نمایش به کاربر:
// ┌─────────────────────────────────────┐
// │ Files to transfer: 245              │
// │ Total size: 12.4 MB                 │
// │ Files to delete: 0 (--delete off)   │
// │ [Show list] [Proceed] [Cancel]      │
// └─────────────────────────────────────┘


// Step 2: اگر کاربر تأیید کرد، اجرای واقعی
```


### ۲. بدون `--delete`:
هرگز `--delete` استفاده نکن مگر کاربر صریحاً بخواهد.


**تست:** ۵ سناریو.


---


## تسک B.4: نمایش Context ارسالی به AI


**طبق سند — بخش «چند سؤال مهم بعدی»:** شفافیت privacy.


### ۱. دکمه «View Context» در Chat:
```
┌──────────────────────────────────────────┐
│ 📤 Context to be sent                    │
├──────────────────────────────────────────┤
│ Provider: DeepSeek V4 Flash              │
│ Tokens (estimated): 12,340               │
│                                          │
│ Included:                                │
│  • System prompt (2,100 tokens)          │
│  • Chat history (8,200 tokens)           │
│  • Files: package.json, src/index.ts     │
│  • Remote context: /opt/demo-project     │
│                                          │
│ NOT included:                            │
│  • .env, secrets, private keys           │
│  • Files outside workspace               │
│                                          │
│ [Expand] [Send anyway]                   │
└──────────────────────────────────────────┘
```


### ۲. Settings:
- `settings.showContextBeforeSend`: boolean
- اگر فعال: قبل از هر پیام، نمایش.
- اگر غیرفعال: فقط در Settings → Usage قابل مشاهده.


**تست:** ۴ سناریو.


---


## تسک B.5: Import از ~/.ssh/config


**طبق سند — بخش ۶:** امکان import.


### ۱. Settings → Connections → دکمه «Import from ~/.ssh/config»:
- پارس فایل `~/.ssh/config`
- نمایش لیست hostها
- هر کدام: [Add] [Skip]


### ۲. امنیت:
- **هیچ کلید خصوصی خوانده نشود.**
- فقط `HostName`, `User`, `Port`, `IdentityFile` (فقط مسیر).
- کلید واقعی از keytar.


**تست:** ۳ سناریو.


---


# 🟡 فاز C — جداسازی پروژه


## تسک C.1: Per-Project Metadata (کامل)


**طبق سند — بخش ۵:** هر پروژه هویت مستقل.


### Data Model:
```typescript
interface Project {
  id: string;
  name: string;
  type: 'local' | 'remote';
  
  // Local
  localPath?: string;
  
  // Remote
  remoteVpsId?: string;
  remotePath?: string;
  linuxUser?: string;
  sshKeyRef?: string;  // reference to keytar
  
  // Metadata
  environment: 'development' | 'staging' | 'production';
  repository?: {
    url: string;
    branch: string;
  };
  dockerComposeProject?: string;
  ports?: number[];
  domains?: string[];
  
  // Policy
  policy: HostPolicy;
  
  // Health
  healthCheck?: HealthCheckConfig;
  
  // Audit
  auditLogPath: string;
  
  createdAt: number;
  updatedAt: number;
}
```


### UI:
Settings → Projects → هر پروژه یک کارت کامل.


**تست:** ۴ سناریو.


---


## تسک C.2: Project Isolation UI


### ۱. نمایش در Sidebar:
```
🟢 project-a (prod-iran-1) [production]
🟡 project-b (staging-iran) [staging]
🔴 project-c (local)         [development]
```


### ۲. Warning در Chat:
اگر دستور از policy خارج است، قبل از approval هشدار قرمز.


**تست:** ۳ سناریو.


---


## تسک C.3: Worktree Support


**طبق سند — بخش ۵:** Git worktree برای multi-task.


### ۱. دستور `/worktree new`:
- یک worktree جدید بساز
- branch جدید
- مسیر جدید


### ۲. UI:
- Tab جدید برای هر worktree
- lock بین آن‌ها


**تست:** ۳ سناریو (اختیاری — می‌توانی skip کنی اگر پیچیده است).


---


# ✅ فاز D — تست و انتشار


## D.1 Integration Tests


`test/e2e/v2.3.2-security.e2e.test.ts`:
1. Remote workspace → tool routing
2. Policy check → read-only allow, write approval
3. Timeout → kill after 60s
4. Plan Mode → approve → execute
5. Backup → write → restore
6. Health check → success/fail
7. Dry-run rsync → proceed


## D.2 Security Tests


`test/security/v2.3.2.test.ts`:
1. Deny-list bypass attempt
2. Path traversal (`../../etc/passwd`)
3. Command injection (`ls; rm -rf /`)
4. Policy mode change mid-session
5. Timeout bypass via background process


## D.3 Build + Release


```bash
npm run typecheck
npm test
npm run build
npm run build:win
```


نسخه: `2.3.1` → `2.3.2`.


Git:
```bash
git checkout -b feature/v2.3.2-security
# commits per task
git checkout master
git merge --no-ff feature/v2.3.2-security
git tag -a v2.3.2 -m "v2.3.2 — Remote-First & Security"
git push origin master
git push origin v2.3.2
```


GitHub Release v2.3.2 با assetها.


---


# 🎬 ترتیب اجرا


```
1. گزارش کد فعلی مربوطه:
   - src/core/agent/agent-orchestrator.ts (routing section)
   - src/core/agent/policy.ts (اگر موجود)
   - src/core/tools/remote-shell-tool.ts
   - src/main/store/projects.ts
   - src/renderer/store/vps.ts

2. تسک A.1 → تست → commit
3. تسک A.2 → تست → commit
4. تسک A.3 → تست → commit
5. تسک A.4 → تست → commit
6. تسک A.5 → تست → commit
7. تسک B.1 → تست → commit
8. تسک B.2 → تست → commit
9. تسک B.3 → تست → commit
10. تسک B.4 → تست → commit
11. تسک B.5 → تست → commit
12. تسک C.1 → تست → commit
13. تسک C.2 → تست → commit
14. D.1 + D.2 integration tests
15. D.3 build + release


بعد از هر تسک: گزارش با فرمت مشخص.
```


# 📊 خروجی انتظار
- ۵ باگ حیاتی رفع شده
- ۵ لایه امنیتی اضافه
- ۳ بخش جداسازی پروژه
- ۳۰+ تست جدید
- v2.3.2 منتشر شده


**بدون skip. اگر شک داری، بپرس.**
