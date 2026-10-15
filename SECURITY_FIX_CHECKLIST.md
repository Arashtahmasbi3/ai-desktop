# 🔒 SECURITY_FIX_CHECKLIST.md — AI Desktop v2.5


## 📌 خلاصه اجرایی


این چک‌لیست بر اساس audit امنیتی مستقل روی commit `v2.4.1` تهیه شده است.
هدف: تبدیل AI Desktop از «بتای جدی» به «ابزار قابل اعتماد برای VPS شخصی و پروژه‌های واقعی».


**امتیاز فعلی طبق audit: ۴۲٪** (هدف: ۸۵٪+ در پایان این چک‌لیست)


## ⛔ قوانین طلایی (برای همه تسک‌ها)


```
۱. یک تسک در آن واحد — نه بیشتر
۲. هر تسک: کد + تست + commit جداگانه
۳. قبل از commit: typecheck + test + build (هر سه باید سبز)
۴. تست امنیتی واقعی، نه mock ساده
۵. اگر شک داری، توقف و بپرس
۶. بدون skip — حتی یک تسک
۷. AGENTS.md بعد از هر تسک به‌روز شود
۸. هیچ Release جدیدی تا پایان P0+P1
۹. اگر یک تسک ۳ بار fail شد → توقف و گزارش
۱۰. بودجه: اگر > $50 → توقف
```


## 🚫 ممنوعیت‌های صریح


```
❌ Release جدید تا پایان P0+P1
❌ قابلیت جدید تا پایان P0+P1
❌ UI redesign تا پایان P2
❌ Tauri migration
❌ Enterprise features (Multi-user, SSO, RBAC)
❌ تغییرات خارج از scope تسک
```


---


# 🔴 فاز P0 — بحرانی (Blocker برای Production)


**هدف:** رفع ۴ مشکل امنیتی که استفاده روی VPS جدی را خطرناک می‌کند.
**زمان تخمینی:** ۶–۸ ساعت
**هزینه تخمینی:** ~$۶
**معیار قبولی فاز:** هیچ patch خارج از پروژه، هیچ read/write خارج از root، هیچ VPS خودکار، هیچ «always allow» برای shell.


---


## ✅ تسک P0-1: Project Run Isolation


### 🔍 مشکل (طبق audit)
> `FileService` یک root سراسری دارد. با تغییر پروژه، root آن تغییر می‌کند. اگر agent برای پروژه A patch بسازد و کاربر قبل از Apply به پروژه B برود، احتمال دارد patch A در B اعمال شود.


### 🎯 راه‌حل


هر **Run** باید immutable داشته باشد:


```typescript
// src/shared/types/agent-run.ts
interface AgentRun {
  id: string;               // UUID
  projectId: string;        // ← immutable
  projectRoot: string;      // ← snapshot در زمان شروع run
  baseRevisions: Map<string, string>;  // path → hash قبل از تغییر
  startedAt: number;
  status: 'running' | 'completed' | 'aborted';
}


// src/core/agent/run-store.ts
class RunStore {
  private runs = new Map<string, AgentRun>();
  
  createRun(projectId: string, projectRoot: string): AgentRun {
    const run: AgentRun = {
      id: generateUUID(),
      projectId,
      projectRoot,
      baseRevisions: new Map(),
      startedAt: Date.now(),
      status: 'running',
    };
    this.runs.set(run.id, run);
    return run;
  }
  
  getRun(runId: string): AgentRun | undefined {
    return this.runs.get(runId);
  }
}


// src/main/agent-service.ts — applyChange
async function applyChange(runId: string, patch: FilePatch): Promise<ApplyResult> {
  const run = runStore.getRun(runId);
  if (!run) {
    return { ok: false, error: 'Run not found or expired' };
  }
  
  // Verify project hasn't changed
  const activeProject = projectStore.getActive();
  if (!activeProject || activeProject.id !== run.projectId) {
    return { 
      ok: false, 
      error: `Project changed since patch was created. Patch belongs to ${run.projectId}, active is ${activeProject?.id}.`
    };
  }
  
  // Verify base revision (فایل تغییر نکرده باشد)
  const currentHash = await hashFileContent(patch.path);
  const baseHash = run.baseRevisions.get(patch.path);
  if (baseHash && currentHash !== baseHash) {
    return { 
      ok: false, 
      error: `File changed since patch was created. Reload and retry.`,
      conflict: true,
    };
  }
  
  // Apply patch در root همان run
  const fullPath = path.join(run.projectRoot, patch.path);
  await writeFile(fullPath, patch.content);
  
  // ثبت revision جدید
  run.baseRevisions.set(patch.path, await hashFileContent(fullPath));
  
  return { ok: true };
}
```


### 📁 فایل‌های تغییر یافته
```
+ src/shared/types/agent-run.ts
+ src/core/agent/run-store.ts
~ src/main/agent-service.ts (applyChange)
~ src/main/app-services.ts (RunStore injection)
~ src/renderer/src/components/Chat/FileChangeCard.tsx (نمایش runId)
~ src/renderer/src/store/chat.ts (ذخیره runId در پیام)
```


### 🧪 تست‌های الزامی (۵ سناریو)


`test/core/run-isolation.test.ts`:


```typescript
describe('Project Run Isolation', () => {
  it('applies patch when project matches', async () => {
    // run created for project A, apply on project A → OK
  });
  
  it('rejects patch when active project changed', async () => {
    // run for A → switch to B → apply → REJECT
  });
  
  it('rejects patch when file changed externally', async () => {
    // run creates patch → external edit → apply → REJECT (conflict)
  });
  
  it('allows multiple patches on same file in same run', async () => {
    // patch1 → apply → patch2 → apply → both OK
  });
  
  it('rejects stale run (created > 30min ago)', async () => {
    // run created → 31 min → apply → REJECT (expired)
  });
});
```


### ✅ معیار قبولی
- [ ] هیچ patch خارج از projectId اعمال نمی‌شود
- [ ] Conflict detection کار می‌کند
- [ ] Run expiration پیاده‌سازی شده (۳۰ دقیقه)
- [ ] ۵ تست پاس
- [ ] AGENTS.md به‌روز


### 📝 Commit Message
```
feat(security): immutable Project Run isolation


- Add AgentRun with projectId + baseRevisions
- Verify project + file hash before apply
- 30min run expiration
- 5 security tests
```


---


## ✅ تسک P0-2: Remote Path Enforcement


### 🔍 مشکل (طبق audit)
> برای remote project، مسیر absolute که مدل بفرستد همان‌طور پذیرفته می‌شود. اگر مدل `/etc/nginx/nginx.conf` بفرستد، routing آن را محدود به root پروژه نمی‌کند.


### 🎯 راه‌حل


```typescript
// src/core/remote/path-guard.ts
import * as path from 'path';


export interface PathGuardResult {
  ok: boolean;
  resolvedPath?: string;
  error?: string;
}


export function enforceProjectPath(
  requestedPath: string,
  projectRoot: string,
): PathGuardResult {
  if (!requestedPath || typeof requestedPath !== 'string') {
    return { ok: false, error: 'Invalid path' };
  }
  
  // Normalize root (remove trailing slash)
  const root = path.posix.normalize(projectRoot).replace(/\/$/, '');
  
  // Resolve requested path
  let resolved: string;
  if (path.posix.isAbsolute(requestedPath)) {
    resolved = path.posix.normalize(requestedPath);
  } else {
    resolved = path.posix.normalize(path.posix.join(root, requestedPath));
  }
  
  // Check containment
  if (resolved !== root && !resolved.startsWith(root + '/')) {
    return {
      ok: false,
      error: `Path "${requestedPath}" is outside project root "${root}"`,
    };
  }
  
  // Reject control characters
  if (/[\x00-\x1f]/.test(resolved)) {
    return { ok: false, error: 'Path contains control characters' };
  }
  
  return { ok: true, resolvedPath: resolved };
}
```


### 🔌 اعمال در routing layer


```typescript
// src/core/agent/tool-routing.ts
async function routeRemoteTool(toolName: string, args: any, context: RunContext) {
  const project = projectStore.get(context.projectId);
  if (!project || project.type !== 'remote') {
    throw new Error('Not a remote project');
  }
  
  const root = project.remotePath;
  
  // برای ابزارهای path-based
  if (['remote_read_file', 'remote_write_file', 'remote_list_dir', 'remote_grep', 'remote_exists'].includes(toolName)) {
    const guard = enforceProjectPath(args.path, root);
    if (!guard.ok) {
      throw new Error(guard.error);
    }
    args.path = guard.resolvedPath;
  }
  
  // برای remote_shell: چک args.command اگر شامل path است
  if (toolName === 'remote_shell') {
    const paths = extractPathsFromCommand(args.command);
    for (const p of paths) {
      const guard = enforceProjectPath(p, root);
      if (!guard.ok) {
        throw new Error(`Command references path outside project: ${p}`);
      }
    }
  }
  
  return executeRemoteTool(toolName, args, context);
}


// helper
function extractPathsFromCommand(cmd: string): string[] {
  // heuristic: extract absolute paths
  const matches = cmd.match(/\/[a-zA-Z0-9_\-./]+/g) || [];
  return matches.filter(p => p.startsWith('/') && p.length > 1);
}
```


### 📁 فایل‌های تغییر یافته
```
+ src/core/remote/path-guard.ts
~ src/core/agent/tool-routing.ts
~ src/core/tools/remote-fs-tools.ts (path enforcement)
~ src/core/tools/remote-shell-tool.ts (path extraction + check)
```


### 🧪 تست‌های الزامی (۷ سناریو)


`test/security/path-guard.test.ts`:


```typescript
describe('Remote Path Enforcement', () => {
  const ROOT = '/opt/demo-project';
  
  it('allows absolute path inside root', () => {
    expect(enforceProjectPath('/opt/demo-project/src/app.ts', ROOT).ok).toBe(true);
  });
  
  it('allows relative path', () => {
    expect(enforceProjectPath('src/app.ts', ROOT).ok).toBe(true);
  });
  
  it('rejects absolute path outside root', () => {
    expect(enforceProjectPath('/etc/passwd', ROOT).ok).toBe(false);
  });
  
  it('rejects path traversal', () => {
    expect(enforceProjectPath('../../etc/passwd', ROOT).ok).toBe(false);
  });
  
  it('rejects symlink escape (if resolvable)', () => {
    // اگر implementation support symlink resolution
  });
  
  it('rejects control chars', () => {
    expect(enforceProjectPath('/opt/demo-project/file\x00.txt', ROOT).ok).toBe(false);
  });
  
  it('rejects command referencing outside path', async () => {
    await expect(routeRemoteTool('remote_shell', 
      { command: 'cat /etc/passwd' }, context)).rejects.toThrow();
  });
});
```


### ✅ معیار قبولی
- [ ] هیچ read/write خارج از root
- [ ] Path traversal بلاک می‌شود
- [ ] Command injection (path) بلاک می‌شود
- [ ] خطای واضح برای کاربر
- [ ] ۷ تست پاس


### 📝 Commit Message
```
feat(security): enforce remote path containment


- Add path-guard for remote tools
- Reject absolute paths outside project root
- Reject path traversal + control chars
- Extract + validate paths in remote_shell commands
- 7 security tests
```


---


## ✅ تسک P0-3: حذف «Always Allow» برای remote_shell


### 🔍 مشکل (طبق audit)
> کاربر می‌تواند یک بار `remote_shell` را تأیید کند و Remember بزند. برنامه آن را صرفاً با نام ابزار ذخیره می‌کند؛ نه VPS، نه پروژه، نه command.


### 🎯 راه‌حل


```typescript
// src/core/agent/remember-policy.ts


// فقط این ابزارها می‌توانند Remember شوند:
const REMEMBERABLE_TOOLS = new Set([
  'read_file',
  'list_dir',
  'remote_read_file',
  'remote_list_dir',
  'exists',
  'remote_exists',
  // ⚠️ remote_shell، write_file، migrate، db_*، scaffold_* عمداً حذف شده‌اند
]);


export function canRememberTool(toolName: string): boolean {
  return REMEMBERABLE_TOOLS.has(toolName);
}


// Remember محدود به scope
export interface RememberedApproval {
  toolName: string;
  vpsId: string;         // ← scope اجباری
  projectId: string;     // ← scope اجباری
  expiresAt: number;     // ← TTL ۳۰ دقیقه
}


export function isRememberedApprovalValid(
  remembered: RememberedApproval,
  context: { toolName: string; vpsId: string; projectId: string }
): boolean {
  if (!canRememberTool(remembered.toolName)) return false;
  if (remembered.toolName !== context.toolName) return false;
  if (remembered.vpsId !== context.vpsId) return false;
  if (remembered.projectId !== context.projectId) return false;
  if (Date.now() > remembered.expiresAt) return false;
  return true;
}
```


### 🎨 تغییرات UI


```typescript
// src/renderer/src/components/Approval/ApprovalDialog.tsx


// مخفی کردن checkbox Remember برای ابزارهای غیرمجاز
{canRememberTool(pendingApproval.toolName) && (
  <label className="remember-checkbox">
    <input type="checkbox" ... />
    Remember for this VPS + project (30 min)
  </label>
)}


// برای ابزارهای حساس، نمایش warning
{!canRememberTool(pendingApproval.toolName) && isDestructive(pendingApproval.toolName) && (
  <div className="warning-banner">
    ⚠️ This tool cannot be remembered. Each call requires approval.
  </div>
)}
```


### 📁 فایل‌های تغییر یافته
```
+ src/core/agent/remember-policy.ts
~ src/main/approval-gate.ts
~ src/renderer/src/components/Approval/ApprovalDialog.tsx
~ src/renderer/src/store/approval.ts
```


### 🧪 تست‌های الزامی (۵ سناریو)


```typescript
describe('Remember Policy', () => {
  it('remote_shell cannot be remembered', () => {
    expect(canRememberTool('remote_shell')).toBe(false);
  });
  
  it('read_file can be remembered', () => {
    expect(canRememberTool('read_file')).toBe(true);
  });
  
  it('remembered approval expires after 30min', () => {
    const old = { ...remembered, expiresAt: Date.now() - 1000 };
    expect(isRememberedApprovalValid(old, ctx)).toBe(false);
  });
  
  it('remembered approval for VPS A does not apply to VPS B', () => {
    const forA = { ...remembered, vpsId: 'vps-a' };
    expect(isRememberedApprovalValid(forA, { ...ctx, vpsId: 'vps-b' })).toBe(false);
  });
  
  it('remembered approval for project A does not apply to project B', () => {
    // همان منطق
  });
});
```


### ✅ معیار قبولی
- [ ] remote_shell هرگز Remember نمی‌شود
- [ ] Remember فقط برای read-only tools
- [ ] TTL ۳۰ دقیقه اعمال می‌شود
- [ ] Scope (VPS + project) اجباری
- [ ] UI warning برای ابزارهای حساس
- [ ] ۵ تست پاس


### 📝 Commit Message
```
feat(security): restrict tool remember to read-only, scoped


- Remove remote_shell from rememberable tools
- Require VPS + project scope
- 30min TTL for remembered approvals
- UI: hide remember checkbox for sensitive tools
- 5 security tests
```


---


## ✅ تسک P0-4: حذف Auto VPS Selection


### 🔍 مشکل (طبق audit)
> اگر کاربر VPS انتخاب نکرده باشد ولی در متن از `server` یا `VPS` نام ببرد، برنامه اولین VPS متصل را انتخاب می‌کند.


### 🎯 راه‌حل


```typescript
// src/core/agent/vps-resolver.ts


export interface VpsResolution {
  ok: boolean;
  vpsId?: string;
  error?: string;
  source?: 'explicit' | 'project' | 'none';
}


export function resolveVpsForRun(context: {
  explicitVpsId?: string;
  project?: Project;
  requiresVps: boolean;
}): VpsResolution {
  // ۱. اگر کاربر صریح انتخاب کرده → همان
  if (context.explicitVpsId) {
    return { ok: true, vpsId: context.explicitVpsId, source: 'explicit' };
  }
  
  // ۲. اگر پروژه remote است → vpsId پروژه
  if (context.project?.type === 'remote' && context.project.remoteVpsId) {
    return { ok: true, vpsId: context.project.remoteVpsId, source: 'project' };
  }
  
  // ۳. اگر نیاز به VPS است ولی هیچ‌کدام → خطا
  if (context.requiresVps) {
    return {
      ok: false,
      error: 'No VPS selected. Please choose a VPS in the chat header, or select a remote project.',
      source: 'none',
    };
  }
  
  // ۴. نیاز ندارد → OK (local)
  return { ok: true, source: 'none' };
}


// تشخیص "requiresVps"
function requiresVps(toolName: string, args: any): boolean {
  const VPS_REQUIRING_TOOLS = new Set([
    'remote_shell', 'remote_read_file', 'remote_write_file',
    'remote_list_dir', 'remote_grep', 'migrate_database',
    'migrate_docker', 'migrate_project', 'worktree_create', ...
  ]);
  return VPS_REQUIRING_TOOLS.has(toolName);
}
```


### 🎨 تغییرات UI


```typescript
// Chat header: نشان دادن واضح VPS فعال یا "None"
{!activeVpsId && requiresVpsForCurrentTask && (
  <Banner severity="warning">
    ⚠️ این task نیاز به VPS دارد. یک VPS انتخاب کنید.
    [Select VPS ▼]
  </Banner>
)}
```


### 📁 فایل‌های تغییر یافته
```
+ src/core/agent/vps-resolver.ts
~ src/main/agent-service.ts (استفاده از resolver)
~ src/renderer/src/components/Chat/ChatHeader.tsx (banner)
~ src/renderer/src/store/vps.ts
```


### 🧪 تست‌های الزامی (۴ سناریو)


```typescript
describe('VPS Resolver', () => {
  it('uses explicit VPS if provided', () => {
    const r = resolveVpsForRun({ explicitVpsId: 'vps-x', requiresVps: true });
    expect(r.vpsId).toBe('vps-x');
    expect(r.source).toBe('explicit');
  });
  
  it('uses project VPS if project is remote', () => {
    const r = resolveVpsForRun({ 
      project: { type: 'remote', remoteVpsId: 'vps-y' }, 
      requiresVps: true 
    });
    expect(r.vpsId).toBe('vps-y');
    expect(r.source).toBe('project');
  });
  
  it('errors if VPS required but none selected', () => {
    const r = resolveVpsForRun({ requiresVps: true });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('No VPS selected');
  });
  
  it('allows local task without VPS', () => {
    const r = resolveVpsForRun({ requiresVps: false });
    expect(r.ok).toBe(true);
  });
});
```


### ✅ معیار قبولی
- [ ] هیچ fallback خودکار VPS
- [ ] خطای واضح برای کاربر
- [ ] Banner در UI
- [ ] ۴ تست پاس


### 📝 Commit Message
```
fix(security): remove auto VPS selection for side-effect actions


- Add vps-resolver with explicit project/explicit sources
- Require VPS for all remote tools
- UI banner when VPS required but not selected
- 4 tests
```


---


## 🏁 پایان فاز P0 — چک‌لیست تأیید


```
□ P0-1 Project Isolation — کامل + تست
□ P0-2 Remote Path Enforcement — کامل + تست
□ P0-3 Remove Remote Shell Remember — کامل + تست
□ P0-4 Remove Auto VPS — کامل + تست
□ typecheck + build پاس
□ همه تست‌های قبلی هنوز سبز
□ AGENTS.md به‌روز
□ توقف و تأیید کاربر برای فاز P1
```


---


# 🟠 فاز P1 — مهم (Reliability & Privacy)


**زمان تخمینی:** ۶–۸ ساعت
**هزینه تخمینی:** ~$۶
**معیار قبولی فاز:** بدون RAM leak، بدون disconnect بی‌ربط، diff/backup برای remote writes.


---


## ✅ تسک P1-1: Output/File Size Caps


### 🔍 مشکل (طبق audit)
> `remote_shell` و SFTP سقف output/file size ندارند. یک فایل بزرگ می‌تواند RAM را پر کند.


### 🎯 راه‌حل


```typescript
// src/core/remote/stream-caps.ts
export const MAX_STDOUT = 10 * 1024 * 1024;   // 10 MB
export const MAX_STDERR = 2 * 1024 * 1024;    // 2 MB
export const MAX_FILE_READ = 50 * 1024 * 1024; // 50 MB
export const MAX_FILE_WRITE = 100 * 1024 * 1024; // 100 MB


export async function execWithCaps(
  ssh: SshClient,
  command: string,
  caps = { stdout: MAX_STDOUT, stderr: MAX_STDERR }
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    ssh.exec(command, (err, stream) => {
      if (err) return reject(err);
      
      let stdout = '';
      let stderr = '';
      let truncated = false;
      
      stream.on('data', (chunk: Buffer) => {
        if (stdout.length + chunk.length > caps.stdout) {
          const remain = caps.stdout - stdout.length;
          stdout += chunk.slice(0, remain).toString();
          truncated = true;
          stream.close();
          return;
        }
        stdout += chunk.toString();
      });
      
      stream.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length + chunk.length > caps.stderr) return;
        stderr += chunk.toString();
      });
      
      stream.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code, truncated });
      });
    });
  });
}
```


### 🧪 تست‌ها (۴ سناریو)
```
□ Small output (< 1MB) → OK
□ Medium output (5MB) → OK
□ Large output (15MB) → truncated + warning
□ File read > 50MB → REJECT با پیام واضح
```


### 📝 Commit
```
feat(reliability): cap remote shell output + file size


- Add execWithCaps with stdout/stderr limits
- Reject file reads > 50MB
- Mark truncated results in UI
- 4 tests
```


---


## ✅ تسک P1-2: Remote Diff + Backup قبل از Write


### 🔍 مشکل (طبق audit)
> remote writeهای agent مستقیم روی VPS اعمال می‌شوند، اما UI review/diff واقعیِ قبل از apply عمدتاً برای `write_file` محلی ساخته شده است.


### 🎯 راه‌حل


```typescript
// Flow برای هر remote_write_file:
async function remoteWriteFlow(runId, path, content, project) {
  // ۱. خواندن فایل موجود (اگر هست)
  const existing = await remoteReadFile(path, project);
  
  // ۲. ساخت diff
  const diff = existing.ok
    ? buildDiff(existing.content, content, path)
    : buildNewFileDiff(path, content);
  
  // ۳. Backup (اگر overwrite)
  let backupPath: string | null = null;
  if (existing.ok) {
    backupPath = `${path}.backup-${Date.now()}`;
    await remoteShell(`cp -p "${path}" "${backupPath}"`, project);
  }
  
  // ۴. برگرداندن diff + backupPath برای UI
  return {
    ok: true,
    requiresApproval: true,
    diff,
    backupPath,
    runId,
    path,
  };
}


// بعد از approval → execute + verify
async function confirmRemoteWrite(runId, path, content, backupPath, project) {
  try {
    await remoteWriteFile(path, content, project);
    
    // Verify: hash file جدید
    const newHash = await remoteHash(path, project);
    return { ok: true, newHash };
  } catch (err) {
    // Rollback
    if (backupPath) {
      await remoteShell(`mv "${backupPath}" "${path}"`, project);
    }
    return { ok: false, error: String(err), rolledBack: !!backupPath };
  }
}
```


### 🧪 تست‌ها (۵ سناریو)
```
□ New file → no diff, no backup
□ Overwrite → diff shown, backup created
□ Approve → write + verify hash
□ Reject → no change
□ Write fail → auto rollback
```


### 📝 Commit
```
feat(reliability): remote write with diff + backup + rollback


- Generate diff before write
- Create timestamped backup on overwrite
- Auto-rollback on write failure
- 5 tests
```


---


## ✅ تسک P1-3: Terminal Lifecycle Fix


### 🔍 مشکل (طبق audit)
> هر VPS تنها یک terminal session نگه می‌دارد، session قبلی رها می‌شود، و اگر component در زمان نامناسب unmount شود کد حتی اتصال VPS را disconnect می‌کند.


### 🎯 راه‌حل


```typescript
// src/main/terminal-manager.ts
class TerminalManager {
  private sessions = new Map<string, TerminalSession>();
  
  // terminal session در main process می‌ماند، حتی وقتی UI unmount می‌شود
  async attach(vpsId: string, cols: number, rows: number): Promise<string> {
    const sessionId = generateUUID();
    const session = await createSshSession(vpsId, cols, rows);
    this.sessions.set(sessionId, session);
    return sessionId;
  }
  
  detach(sessionId: string): void {
    // فقط observer را جدا می‌کند، session باقی می‌ماند
    const session = this.sessions.get(sessionId);
    if (session) {
      session.removeAllListeners('data');
    }
  }
  
  close(sessionId: string): void {
    // فقط با دستور صریح کاربر
    const session = this.sessions.get(sessionId);
    if (session) {
      session.close();
      this.sessions.delete(sessionId);
    }
  }
  
  async list(vpsId: string): Promise<TerminalSession[]> {
    // برای reconnect به session قبلی
  }
}
```


### 📁 فایل‌های تغییر یافته
```
~ src/main/terminal-manager.ts (جدید یا refactor)
~ src/renderer/src/components/Vps/VpsTerminal.tsx
~ src/main/vps-ipc.ts
```


### 🧪 تست‌ها (۳ سناریو)
```
□ Mount terminal → disconnect SSH (باید باقی بماند)
□ Unmount terminal → SSH still connected
□ Re-mount → همان session قبلی
```


### 📝 Commit
```
fix(reliability): terminal lifecycle persistence


- Move terminal sessions to main process
- Detach ≠ disconnect
- Re-attach to existing session
- 3 tests
```


---


## ✅ تسک P1-4: Provider Fallback Privacy


### 🔍 مشکل (طبق audit)
> fallback بین providerها می‌تواند prompt، خروجی سرور و محتویات حساس را بدون تأیید مجدد به provider دیگری بفرستد.


### 🎯 راه‌حل


```typescript
// src/shared/types/fallback-policy.ts
interface FallbackPolicy {
  enabled: boolean;
  allowedProviders: string[];  // کاربر صریحاً انتخاب می‌کند
  requireConfirmation: boolean; // پیش‌فرض: true
}


// src/core/agent/fallback-handler.ts
async function handleProviderFailure(
  activeProvider: string,
  error: Error,
  policy: FallbackPolicy,
): Promise<FallbackResult> {
  if (!policy.enabled) {
    return { ok: false, reason: 'Fallback disabled' };
  }
  
  const candidates = policy.allowedProviders.filter(p => p !== activeProvider);
  if (candidates.length === 0) {
    return { ok: false, reason: 'No fallback providers allowed' };
  }
  
  if (policy.requireConfirmation) {
    // UI banner: "DeepSeek failed. Switch to OpenAI? (privacy note)"
    return {
      ok: false,
      requiresUserApproval: true,
      suggestedProvider: candidates[0],
    };
  }
  
  return { ok: true, fallbackTo: candidates[0] };
}
```


### 🎨 UI
```
┌─────────────────────────────────────────┐
│ ⚠️ DeepSeek failed                       │
│                                         │
│ Fallback to OpenAI?                     │
│ ⚠️ Your prompt and file contents will   │
│    be sent to OpenAI.                   │
│                                         │
│ [Switch to OpenAI] [Stay] [Disable]     │
└─────────────────────────────────────────┘
```


### 🧪 تست‌ها (۳ سناریو)
```
□ Provider fail + requireConfirmation → user prompt
□ Provider fail + auto → fallback (user opted in)
□ Provider fail + no fallback allowed → error
```


### 📝 Commit
```
feat(privacy): user-confirmed provider fallback


- Add FallbackPolicy with allowedProviders
- UI banner for user confirmation
- Default requireConfirmation: true
- 3 tests
```


---


## 🏁 پایان فاز P1 — چک‌لیست تأیید


```
□ P1-1 Output Caps — کامل + تست
□ P1-2 Remote Diff + Backup — کامل + تست
□ P1-3 Terminal Lifecycle — کامل + تست
□ P1-4 Fallback Privacy — کامل + تست
□ typecheck + build پاس
□ همه تست‌های قبلی هنوز سبز
□ AGENTS.md به‌روز
□ توقف و تأیید کاربر برای فاز P2
```


---


# 🟡 فاز P2 — Electron Security & Release


**زمان تخمینی:** ۴–۵ ساعت
**هزینه تخمینی:** ~$۵
**معیار قبولی فاز:** Electron sandbox، dependency audit پاک، CI فعال.


---


## ✅ تسک P2-1: Electron Sandbox


### 🔍 مشکل
> `sandbox: false` و `webviewTag: true` attack surface را بالا می‌برد.


### 🎯 راه‌حل
```typescript
// src/main/index.ts
new BrowserWindow({
  webPreferences: {
    sandbox: true,           // ← فعال
    contextIsolation: true,
    nodeIntegration: false,
    webviewTag: false,       // ← اگر ممکن
    preload: path.join(__dirname, 'preload.js'),
  }
});
```


اگر `webviewTag` ضروری است:
- فقط برای browser داخلی
- با `sandbox: true` روی webview
- با `webSecurity: true` و CSP سخت


### 🧪 تست‌ها (۳ سناریو)
```
□ App باز می‌شود
□ Preload API کار می‌کند
□ Browser داخلی کار می‌کند
```


### 📝 Commit
```
security(electron): enable sandbox + restrict webview


- sandbox: true
- webviewTag: false (or sandboxed)
- 3 smoke tests
```


---


## ✅ تسک P2-2: Dependency Vulnerabilities


### 🎯 راه‌حل
```bash
npm audit
npm audit fix
# اگر باقی ماند → بررسی manual + آپدیت
```


### ✅ معیار قبولی
- [ ] `npm audit --omit=dev` = 0
- [ ] `npm audit` ≤ 2 low


### 📝 Commit
```
chore(deps): fix npm audit vulnerabilities


- npm audit fix
- Update X, Y, Z
- audit --omit=dev: 0 vulnerabilities
```


---


## ✅ تسک P2-3: GitHub Actions CI


### 🎯 راه‌حل
```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]


jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```


### ✅ معیار قبولی
- [ ] CI روی push اجرا می‌شود
- [ ] همه stepها سبز


### 📝 Commit
```
ci: add GitHub Actions for test + build


- Workflow on push/pull_request
- Runs typecheck, test, build
```


---


## 🏁 پایان فاز P2 — چک‌لیست تأیید


```
□ P2-1 Electron Sandbox — کامل
□ P2-2 Dependency Audit — پاک
□ P2-3 CI — فعال
□ typecheck + build پاس
□ AGENTS.md به‌روز
□ توقف و تأیید کاربر برای فاز P3
```


---


# 🟢 فاز P3 — UI/UX Polish


**زمان تخمینی:** ۴ ساعت
**هزینه تخمینی:** ~$۴
**معیار قبولی فاز:** Tool card با جزئیات، Approval شفاف، RTL دقیق.


---


## ✅ تسک P3-1: Tool Card با Command + Output


### 🎯 UI
```
┌────────────────────────────────────────────┐
│ 🔧 remote_shell                            │
│ $ ls -la /opt/demo-project                 │
│ Host: my-server | cwd: /opt/demo-project     │
│ Exit: 0 | Duration: 245ms                  │
│ [▼ View output (12 lines)]                 │
└────────────────────────────────────────────┘
```


### 📁 فایل‌ها
```
~ src/renderer/src/components/Chat/ToolResultCard.tsx
~ src/renderer/src/components/Chat/RecentActions.tsx
```


### 📝 Commit
```
feat(ui): rich tool result card with command + output


- Show command, host, cwd, exit code, duration
- Collapsible output viewer
```


---


## ✅ تسک P3-2: Approval Dialog شفاف


### 🎯 UI
```
┌────────────────────────────────────────────┐
│ 🛡️ Approve tool action?                    │
│                                            │
│ Tool: remote_shell                         │
│ Command: $ git pull origin main            │
│ VPS: my-server | Project: demo-project       │
│                                            │
│ ⚠️ This tool cannot be remembered.         │
│    Each call requires approval.            │
│                                            │
│ [Deny] [Approve once] [Approve for 30min]  │
└────────────────────────────────────────────┘
```


### 📝 Commit
```
feat(ui): transparent approval dialog


- Show command, VPS, project
- Warning for non-rememberable tools
- Clear scope for remembered approvals
```


---


## ✅ تسک P3-3: RTL/LTR دقیق


### 🎯 راه‌حل
```html
<!-- Chat message: RTL -->
<div dir="rtl" lang="fa">{userMessage}</div>


<!-- Code block: always LTR -->
<pre dir="ltr" style="unicode-bidi: embed">{code}</pre>


<!-- Paths/outputs: LTR -->
<code dir="ltr">{path}</code>
```


### 📝 Commit
```
fix(ui): correct RTL/LTR for mixed content


- Chat messages: RTL when Persian
- Code, paths, output: always LTR
- Use dir="auto" for user input
```


---


## ✅ تسک P3-4: Accessibility


### 🎯 راه‌حل
- Focus trap در modal (`@headlessui/react` یا custom)
- Keyboard navigation (Tab، Escape)
- ARIA labels
- Screen reader compatibility


### 📝 Commit
```
feat(a11y): focus trap + keyboard navigation + ARIA


- Modal focus trap
- Escape closes modals
- ARIA labels for interactive elements
```


---


## 🏁 پایان فاز P3 — چک‌لیست تأیید


```
□ P3-1 Tool Card — کامل
□ P3-2 Approval Dialog — کامل
□ P3-3 RTL/LTR — کامل
□ P3-4 Accessibility — کامل
□ typecheck + build پاس
□ AGENTS.md به‌روز
□ توقف و تأیید کاربر برای فاز Release
```


---


# 📦 فاز Release — v2.5.0


## پیش‌نیاز
- [ ] همه P0 + P1 + P2 + P3 کامل
- [ ] تست end-to-end روی VPS واقعی
- [ ] تست manual روی ویندوز
- [ ] AGENTS.md، CHANGELOG، README به‌روز


## مراحل Release


```bash
# ۱. merge به master
git checkout master
git pull origin master
git merge --no-ff feature/v2.5-security -m "Merge v2.5: Security + Reliability"


# ۲. bump نسخه
# package.json: 2.4.2 → 2.5.0


# ۳. tag
git tag -a v2.5.0 -m "v2.5.0 — Security + Reliability"
git push origin master
git push origin v2.5.0


# ۴. build:win
npm run build:win


# ۵. GitHub Release
# - title: "v2.5.0 — Security + Reliability"
# - prerelease: false
# - assets: Setup.exe + Portable.exe + SHA256SUMS.txt
# - notes: لیست fixها + ارجاع به SECURITY_FIX_CHECKLIST.md
```


## گزارش نهایی
- [ ] لینک GitHub Release
- [ ] SHA256 هر asset
- [ ] ارزیابی نهایی (درصد آمادگی طبق همان معیارهای audit)
- [ ] AGENTS.md: "v2.5.0 released. Security checklist 100% complete. Ready for production use on personal VPS."


---


# 📊 معیارهای پیشرفت


| فاز | تسک‌ها | امتیاز هدف |
|-----|-------|------------|
| شروع | — | ۴۲٪ |
| P0 کامل | ۴ | ۵۵٪ |
| P1 کامل | ۴ | ۷۰٪ |
| P2 کامل | ۳ | ۸۰٪ |
| P3 کامل | ۴ | ۹۰٪ |
| Release v2.5 | — | **۹۵٪** |


---


# 🎯 نحوه استفاده از این فایل


## برای هر تسک:


**۱. فایل تسک را به OpenHands بده:**
```
تسک P0-1 را انجام بده.
[متن تسک + راه‌حل + تست‌ها + معیار قبولی]


قواعد:
- یک commit
- تست‌های الزامی
- قبل از commit: typecheck + test + build
- اگر شک داری، بپرس


شروع کن.
```


**۲. بعد از گزارش:**
- کد را چک کن
- تست‌ها را run کن
- اگر OK → تسک بعدی


**۳. در انتهای هر فاز:**
- توقف کن
- همه تسک‌های فاز را بازبینی کن
- تأیید از کاربر بگیر
- فاز بعد را شروع کن


---


# 📌 یادآوری نهایی


- **هدف:** ۹۵٪ آمادگی برای production
- **بدون skip**
- **یک تسک در آن واحد**
- **هر تسک: تست امنیتی دارد**
- **AGENTS.md هر تسک به‌روز**


**موفق باش.**
