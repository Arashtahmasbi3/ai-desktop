# SPRINT v2.3.3 — Git-Aware Agent + Self-Diagnosis


## 🧠 هدف
تبدیل AI Desktop به یک agent خودآگاه که:
1. می‌فهمد پروژه git repo است یا نه
2. اگر نبود، با اجازه کاربر git init می‌کند
3. اگر بود، از workflows git استفاده می‌کند
4. خودش مشکلات زیرساخت را تشخیص می‌دهد
5. با اجازه کاربر، زیرساخت را آماده می‌کند


## ⛔ قوانین سخت
- بدون skip
- هر تسک: یک commit + حداقل ۳ تست
- قبل از هر commit: typecheck + test + build
- اگر شک داری، بپرس


---


# 🔴 فاز A — Git Detection & Adaptation


## تسک A.1: تشخیص خودکار Git


**هدف:** AI قبل از هر عملیات، چک کند که پروژه git repo است یا نه.


### ۱. در `remote-workspace.ts` یا مشابه:
```typescript
interface RemoteWorkspaceInfo {
  path: string;
  isGitRepo: boolean;
  gitBranch?: string;
  gitRemote?: string;
  gitDirty?: boolean;
}


async function detectWorkspace(ssh, path): Promise<RemoteWorkspaceInfo> {
  const result = await ssh.exec(`test -d ${path}/.git && echo "yes" || echo "no"`);
  const isGit = result.stdout.trim() === 'yes';
  
  if (isGit) {
    const branch = await ssh.exec(`cd ${path} && git rev-parse --abbrev-ref HEAD`);
    const remote = await ssh.exec(`cd ${path} && git remote get-url origin 2>/dev/null`);
    const dirty = await ssh.exec(`cd ${path} && git status --porcelain`);
    return {
      path,
      isGitRepo: true,
      gitBranch: branch.stdout.trim(),
      gitRemote: remote.stdout.trim() || undefined,
      gitDirty: dirty.stdout.trim().length > 0,
    };
  }
  
  return { path, isGitRepo: false };
}
```


### ۲. ذخیره در project metadata:
```typescript
interface Project {
  // ...
  workspaceInfo?: RemoteWorkspaceInfo;  // کش، هر ۳۰ ثانیه refresh
}
```


### ۳. IPC جدید:
- `projects:detectWorkspace(id)` → برمی‌گرداند RemoteWorkspaceInfo


### ۴. UI:
- در Chat Header، کنار نام پروژه:
  - اگر git: 🌿 `main` (نام branch)
  - اگر بدون git: 📁 `No git`
- Tooltip: نام remote یا "Local only"


**تست:** ۶ سناریو
1. پروژه با git → isGitRepo=true
2. پروژه بدون git → isGitRepo=false
3. git با remote → gitRemote set
4. git بدون remote → gitRemote=null
5. git dirty → gitDirty=true
6. git clean → gitDirty=false


---


## تسک A.2: System Prompt پویا


**هدف:** AI بداند git وجود دارد یا نه و بر اساس آن رفتار کند.


### در `agent-orchestrator.ts`:
```typescript
function buildSystemPrompt(workspace: RemoteWorkspaceInfo): string {
  const basePrompt = `You are an AI assistant for project at ${workspace.path}.`;
  
  if (workspace.isGitRepo) {
    return `${basePrompt}


GIT IS AVAILABLE.
- Branch: ${workspace.gitBranch}
- Remote: ${workspace.gitRemote || 'none'}
- Workflow: use git diff/status/commit for changes.
- Before editing: check git status.
- After editing: show diff.`;
  }
  
  return `${basePrompt}


GIT IS NOT AVAILABLE.
- DO NOT use git commands (they will fail).
- Use: ls, cat, head, tail, grep, find, echo, pwd.
- For edits: create backup first (cp file file.backup-DATE).
- Before overwriting: read the file.
- For version control: suggest git init to user.`;
}
```


### تست:
1. workspace با git → prompt شامل "GIT IS AVAILABLE"
2. workspace بدون git → prompt شامل "GIT IS NOT AVAILABLE"
3. branch name در prompt
4. remote name در prompt


---


## تسک A.3: Loop Detector هوشمندتر


**هدف:** اگر git fail شد، AI دیگر تلاش نکند.


### در `loop-detector.ts`:
```typescript
class LoopDetector {
  private toolFailureCount = new Map<string, number>();
  
  afterToolCall(toolName: string, result: { ok: boolean }) {
    if (!result.ok) {
      const count = (this.toolFailureCount.get(toolName) || 0) + 1;
      this.toolFailureCount.set(toolName, count);
      
      // اگر یک tool ۲ بار fail شد، در این session ممنوع
      if (count >= 2) {
        this.blockedTools.add(toolName);
      }
    }
  }
  
  beforeToolCall(toolName: string): { allow: boolean; reason?: string } {
    if (this.blockedTools.has(toolName)) {
      return { 
        allow: false, 
        reason: `${toolName} has failed twice. Use alternative tools.` 
      };
    }
    return { allow: true };
  }
}
```


### تست:
1. git fails 2x → git blocked
2. git blocked → AI به ls سوییچ می‌کند
3. سایر tools بلاک نمی‌شوند
4. session reset → بلاک برداشته می‌شود


---


# 🟠 فاز B — Auto-Git-Setup


## تسک B.1: Auto-Git Detection در Project Creation


**هدف:** وقتی کاربر یک پروژه جدید روی VPS می‌سازد، AI بپرسد آیا git init کند.


### در Command "Create Project on VPS":
بعد از ساخت پوشه، UI بپرسد:
```
┌────────────────────────────────────┐
│  📦 Setup Git for this project?    │
├────────────────────────────────────┤
│  ☐ Initialize git repository       │
│  ☐ Create initial commit           │
│  ☐ Add .gitignore (Node/Python/...)│
│  ☐ Push to GitHub (needs auth)     │
│                                    │
│  [Skip] [Setup Git]                │
└────────────────────────────────────┘
```


### Implementation:
```typescript
async function setupGit(ssh, path, options) {
  if (options.init) {
    await ssh.exec(`cd ${path} && git init`);
  }
  if (options.gitignore) {
    const template = getGitignoreTemplate(options.projectType);
    await ssh.exec(`cat > ${path}/.gitignore << 'EOF'\n${template}\nEOF`);
  }
  if (options.commit) {
    await ssh.exec(`cd ${path} && git add -A && git commit -m "Initial commit"`);
  }
  if (options.push && options.remoteUrl) {
    await ssh.exec(`cd ${path} && git remote add origin ${options.remoteUrl}`);
    await ssh.exec(`cd ${path} && git push -u origin main`);
  }
}
```


### Templates:
- **Node.js:** node_modules, dist, .env, *.log, .DS_Store
- **Python:** __pycache__, *.pyc, .env, venv, *.log
- **Generic:** .env, *.log, .DS_Store, *.tmp


### تست:
1. Project creation → dialog نمایش داده می‌شود
2. git init → .git ساخته می‌شود
3. .gitignore → درست ساخته می‌شود
4. commit → initial commit
5. push → به GitHub
6. skip → هیچ تغییری


---


## تسک B.2: Git Status Panel


**هدف:** نمایش وضعیت git در Sidebar.


### UI:
```
┌──────────────────────────────┐
│ 🌿 demo-project              │
│    main · 3 changes · ↑2     │
└──────────────────────────────┘
```


- 🌿 = git branch icon
- `main` = نام branch
- `3 changes` = فایل‌های تغییر یافته
- `↑2` = commits آماده push


### Implementation:
- هر ۳۰s یکبار `git status` (background)
- کش در memory
- UI reactive


### تست:
1. clean repo → no changes
2. dirty repo → N changes
3. ahead → ↑N
4. behind → ↓N


---


# 🟡 فاز C — Self-Diagnosis


## تسک C.1: Environment Health Check


**هدف:** AI خودش تشخیص می‌دهد چه ابزارهایی نصب هستند.


### در `health-check-tool.ts`:
```typescript
interface SystemHealth {
  node: { installed: boolean; version?: string };
  npm: { installed: boolean; version?: string };
  git: { installed: boolean; version?: string };
  docker: { installed: boolean; version?: string };
  pm2: { installed: boolean; version?: string };
  disk: { total: string; used: string; free: string; percent: number };
  memory: { total: string; used: string; free: string };
  os: { name: string; version: string };
}


async function getSystemHealth(ssh): Promise<SystemHealth> {
  // Parallel commands
  const [node, npm, git, docker, pm2, df, free, uname] = await Promise.all([
    ssh.exec('node --version 2>/dev/null'),
    ssh.exec('npm --version 2>/dev/null'),
    ssh.exec('git --version 2>/dev/null'),
    ssh.exec('docker --version 2>/dev/null'),
    ssh.exec('pm2 --version 2>/dev/null'),
    ssh.exec('df -h / --output=size,used,avail,pcent'),
    ssh.exec('free -h'),
    ssh.exec('uname -a'),
  ]);
  // parse و return
}
```


### تست:
1. Linux با همه ابزارها
2. Linux با فقدان git
3. Linux با فقدان docker
4. macOS mock
5. disk > 90% → warning


---


## تسک C.2: Diagnostics Panel


**هدف:** پنل نمایش وضعیت سرور.


### UI:
```
┌────────────────────────────────────────────┐
│  🩺 System Health — my-server                │
├────────────────────────────────────────────┤
│  ✅ node v20.10.0                          │
│  ✅ npm v10.2.3                            │
│  ✅ git v2.43.0                            │
│  ❌ docker (not installed)                 │
│  ✅ pm2 v5.3.0                             │
│                                            │
│  💾 Disk: 45 GB / 100 GB (45%)             │
│  🧠 RAM: 2.1 GB / 4 GB (52%)               │
│  🐧 Ubuntu 22.04                           │
│                                            │
│  ⚠️ Recommendations:                       │
│  • docker is missing                     │
│    [Install Docker] [Skip]                 │
└────────────────────────────────────────────┘
```


### Implementation:
- دکمه در Sidebar یا Settings → Connections → هر سرور
- Refresh button
- Auto-refresh هر ۵ دقیقه


### تست:
1. panel رندر می‌شود
2. مقادیر درست
3. recommendations درست
4. Install button فیر می‌شود


---


## تسک C.3: Installation Assistant (با اجازه)


**هدف:** اگر ابزاری نبود، AI با اجازه کاربر نصب می‌کند.


### در AI Chat:
```
کاربر: "docker را نصب کن"
AI: "برای نصب docker باید این کارها انجام شود:
1. apt update
2. apt install -y docker.io
3. systemctl enable docker
4. systemctl start docker
5. usermod -aG docker $USER


آیا موافقید؟ [Approve] [Cancel]"
```


### Implementation:
- Installation recipes در `src/core/agent/install-recipes.ts`:
  ```typescript
  const RECIPES = {
    'docker': {
      preCheck: 'which docker',
      commands: [
        'apt-get update',
        'apt-get install -y docker.io',
        'systemctl enable docker',
        'systemctl start docker',
      ],
      requiresSudo: true,
      verify: 'docker --version',
    },
    'pm2': {
      commands: ['npm install -g pm2'],
      requiresSudo: false,
      verify: 'pm2 --version',
    },
    // ...
  };
  ```


### امنیت:
- همه install commands نیاز به approval صریح دارند.
- نمایش دقیق هر دستور.
- اگر sudo نیاز است، 2FA یا تایید دوم.


### تست:
1. docker install → approval dialog
2. approve → commands اجرا می‌شوند
3. cancel → هیچ تغییری
4. fail در وسط → rollback (اگر ممکن)
5. verify بعد از install


---


# ✅ فاز D — تست و Release


## D.1 Integration Tests
`test/e2e/v2.3.3-git-aware.e2e.test.ts`:
1. Git repo detection → correct workflow
2. Non-git → fallback به file tools
3. Auto-git-setup → git init + commit
4. Loop after git fail → switch به ls
5. Health check → full report
6. Install docker → approval → success


## D.2 Security Tests
1. Install با sudo → approval required
2. Install بدون permission → blocked
3. Git push with invalid token → error message


## D.3 Release
- نسخه `2.3.2` → `2.3.3`
- CHANGELOG + AGENTS.md + README
- TESTING_GUIDE_v2.3.3.md
- FINAL_REPORT_v2.3.3.md
- Build:win + GitHub Release


---


# 🎬 ترتیب اجرا


1. تسک A.1 → تست → commit
2. تسک A.2 → تست → commit
3. تسک A.3 → تست → commit
4. تسک B.1 → تست → commit
5. تسک B.2 → تست → commit
6. تسک C.1 → تست → commit
7. تسک C.2 → تست → commit
8. تسک C.3 → تست → commit
9. D.1 + D.2
10. D.3


# 📊 خروجی انتظار
- Git detection
- Auto-git-setup
- Self-diagnosis + install
- ۲۰+ تست جدید
- v2.3.3 منتشر شده


**بدون skip. اگر شک داری، بپرس.**
