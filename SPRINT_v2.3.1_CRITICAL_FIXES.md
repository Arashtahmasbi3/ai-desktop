الگوی معماری را از این منابع الهام بگیر:
- Codex (approval, auto-review, loop prevention)
- agent2ssh (PTY, audit)
- MobaRust (workspace separation)
- Tabby (state management)
- OpenCode (multi-provider)


اما کد را در Electron/TypeScript بنویس، نه Tauri/Rust.
## 🎯 منابع الهام (برای ایجنت)


در طول Sprint v2.3.1، این الگوها را در نظر بگیر:


### ۱. Loop Detection (الگو از Codex + agent-loop-guard)
- از sliding window استفاده کن (نه فقط hash)
- fuzzy detection: args کمی تغییر کند، ولی toolName یکی باشد
- auto-review pattern: قبل از STOP، یک sub-agent ارزیابی کند
- **کتابخانه:** `agent-loop-guard` یا `tool-loop-break` (اگر Electron-compatible بود)


### ۲. Workspace Type (الگو از MobaRust)
- جداسازی کامل local/remote در data model
- routing در AgentOrchestrator بر اساس type
- error message واضح برای هر حالت


### ۳. VPS State (الگو از Tabby)
- Zustand store مرکزی
- auto-reconnect on mount
- همه UI از یک منبع


### ۴. Approval Mode (الگو از Codex config)
- `approval_policy` در settings.json
- global store + persistence
- auto-disable 30 min


### ۵. DeepSeek V4 (الگو از OpenCode)
- provider-agnostic adapter
- model catalog با tags
- migration path


## ⚠️ مهم
- **به Tauri مهاجرت نکن.** Electron بمان.
- این منابع **الگو** می‌دهند، نه کد.
- تمرکز روی ۵ مشکل فعلی باشد.
- کد را **خودت** بنویس، با الهام از این معماری‌ها.
# 🚨 SPRINT v2.3.1 — CRITICAL FIXES + SECURITY HARDENING


## 🧠 نقش تو
ایجنت ارشد. هدف: رفع ۵ باگ حیاتی + پیاده‌سازی امنیت + بازبینی و تست دقیق.
اپلیکیشن باید پس از این Sprint به سطح بالایی برسد و آماده استفاده واقعی باشد.


## ⛔ قوانین سخت (بدون استثنا)


### قانون ۱: ممنوعیت skip
- هر دستور در این سند **باید** اجرا شود.
- **هرگز** یک تسک را «کامل» اعلام نکن تا تستش پاس شود.
- اگر ۳ بار تلاش کردی و نشد، توقف کن و دقیقاً گزارش بده چرا.


### قانون ۲: تأیید در هر گام
بعد از هر تسک، این فرمت را گزارش بده:
```
✅ Task X.Y — [نام]
- فایل‌های تغییر یافته: [...]
- تست‌های جدید: [نام‌ها]
- نتیجه تست: X passed, Y failed
- typecheck: ✅/❌
- build: ✅/❌
- commit: [hash]
- مسئله باقی‌مانده: [هیچ یا توضیح]
```


### قانون ۳: تست واقعی، نه صوری
- هر تسک **حداقل ۳ تست واحد** جدید.
- تست‌ها باید **سناریوهای واقعی** را پوشش دهند.
- ممنوع: تست‌هایی که فقط `assert(true)` هستند.
- اگر تست fail شد، fix کن، بعد ادامه بده.


### قانون ۴: قبل از هر commit
```bash
npm run typecheck   # باید exit 0
npm test            # باید 100% پاس
npm run build       # باید exit 0
```
اگر هر کدام fail شد، **commit نکن**.


### قانون ۵: بدون تغییر فایل‌های خارج از scope
- فقط فایل‌هایی که در هر تسک مشخص شده را تغییر بده.
- اگر نیاز به فایل دیگری داشتی، **قبل از تغییر** بپرس.


### استثنائات توقف (فقط ۳ مورد)
1. بودجه > $60
2. ۱۰ خطای متوالی روی یک تسک
3. تعارض منطقی که با ابهام مواجه شدی


---


# 🔴 بخش A — رفع ۵ باگ حیاتی


## تسک A.1: Loop Detection بازنویسی کامل


**مشکل فعلی:** در Chat، `remote_shell` ۱۵+ بار تکرار می‌شود. Loop Detector کار نمی‌کند.


**ریشه:** hash روی `toolName + args` است. args هر بار تغییر می‌کند.


**راه‌حل (الهام از `agent-loop-guard-js` و Codex):**


فایل `src/core/agent/loop-detector.ts` را **کامل بازنویسی کن**:


```typescript
interface LoopDetectorState {
  recentToolNames: string[];      // sliding window (max 15)
  recentToolHashes: string[];     // for exact match detection
  consecutiveFailures: number;
  lastProgressAt: number;         // timestamp
}


class LoopDetector {
  private state: LoopDetectorState;
  private readonly WARN_THRESHOLD = 3;      // 3 repeats = warn
  private readonly STOP_THRESHOLD = 5;      // 5 repeats = stop
  private readonly FAIL_THRESHOLD = 3;      // 3 consecutive fails = stop
  private readonly WINDOW_SIZE = 15;
  private readonly PROGRESS_TIMEOUT = 120_000;  // 2 minutes no progress = stop


  /**
   * چک می‌کند که آیا tool call بعدی باید اجرا شود.
   * @returns { allow: boolean, reason?: string, action?: 'warn' | 'stop' }
   */
  beforeToolCall(toolName: string, args: unknown): {
    allow: boolean;
    reason?: string;
    action?: 'warn' | 'stop';
  };


  /**
   * بعد از اجرای tool، نتیجه را ثبت می‌کند.
   */
  afterToolCall(toolName: string, result: { ok: boolean }): void;


  /**
   * وقتی پیشرفت واقعی رخ داد (فایل نوشته شد، تست پاس شد، ...).
   */
  markProgress(): void;


  reset(): void;
}
```


**آستانه‌ها (دقیق):**
- **WARN** اگر یک toolName ۳ بار در window 15 ظاهر شود (بدون progress).
- **STOP** اگر یک toolName ۵ بار در window 15 ظاهر شود.
- **STOP** اگر ۳ tool call متوالی با `ok=false` fail شوند.
- **STOP** اگر ۲ دقیقه هیچ progress ثبت نشود.


**رفتار on STOP:**
- متوقف کن.
- پیام واضح در Chat (فارسی): «⚠️ تشخیص حلقه. ۵ بار تلاش تکراری برای [toolName]. متوقف کردم.»
- نمایش خلاصه ۵ tool call اخیر با زمان.
- سه دکمه: **ادامه بده** / **تصحیح کن** / **توقف کامل**.
- ثبت در audit log با `reason: "loop_detected"`.


**یکپارچگی:**
- در `agent-orchestrator.ts`، **قبل از هر tool call** `beforeToolCall` را صدا بزن.
- بعد از هر tool call، `afterToolCall`.
- در فایل write/read موفق، `markProgress`.


**تست:** `test/core/loop-detector.test.ts` با ۸ سناریو:
1. سه بار remote_shell → WARN
2. پنج بار remote_shell → STOP
3. سه fail متوالی → STOP
4. ۵ tool متفاوت بدون تکرار → allow
5. progress وسط loop → reset
6. timeout 2 دقیقه → STOP
7. escape hatch («ادامه بده») → reset + allow
8. args مختلف با همان toolName → همچنان WARN


**گزارش:** کد قبلی `loop-detector.ts` را در پیام گزارش **copy کن**، سپس تغییرات.


---


## تسک A.2: Workspace Type (Local vs Remote)


**مشکل:** پروژه با path `/opt/sepehr-motor` (Linux) روی Windows ذخیره شده. UI می‌گوید "Path not found".


**راه‌حل (الهام از MobaRust و wrolp):**


### مدل داده:
```typescript
type WorkspaceType = 'local' | 'remote';


interface Project {
  id: string;
  name: string;
  type: WorkspaceType;
  
  // for type='local'
  localPath?: string;
  
  // for type='remote'
  remoteVpsId?: string;
  remotePath?: string;
  
  createdAt: number;
  updatedAt: number;
}
```


### Migration:
هنگام load پروژه‌های قدیمی در `src/main/store/projects.ts`:
```typescript
function migrateProject(old: any): Project {
  if (!old.type) {
    const isWindows = process.platform === 'win32';
    const isLinuxPath = old.path?.startsWith('/');
    
    if (isWindows && isLinuxPath) {
      return {
        id: old.id,
        name: old.name,
        type: 'remote',
        remoteVpsId: null,
        remotePath: old.path,
        createdAt: old.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
    }
    
    return {
      id: old.id,
      name: old.name,
      type: 'local',
      localPath: old.path,
      createdAt: old.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
  }
  return old;
}
```


### UI:
1. در Sidebar، کنار نام پروژه:
   - `local` → آیکون 🖥️
   - `remote` → آیکون ☁️ + نام VPS در پرانتز
   - اگر `remoteVpsId=null` → ⚠ "VPS را انتخاب کنید"
2. کلیک روی پروژه remote → dropdown انتخاب VPS.
3. در Settings → Projects، editable.


### رفتار عملیات فایل:
- اگر `type=local` → از `fs` (LocalFileService) استفاده کن.
- اگر `type=remote` و VPS متصل → از `remote_shell` / SFTP.
- اگر `type=remote` و VPS disconnect → پیام واضح: «VPS متصل نیست. در Settings → Connections وصل شوید.»


**تست:**
1. Migration: Linux path on Windows → type=remote
2. Migration: C:\Users\... on Windows → type=local
3. Local project → file read from local fs
4. Remote project + connected VPS → file read from remote
5. Remote project + disconnected VPS → error message


---


## تسک A.3: DeepSeek V4 Models


**مشکل:** کاتالوگ فقط V3 دارد.


**راه‌حل:**


فایل `src/shared/models.ts` را آپدیت کن:
```typescript
// حذف: deepseek-chat (V3) و deepseek-reasoner (R1) به عنوان default
// اضافه:
{
  provider: 'deepseek',
  id: 'deepseek-v4-flash',
  name: 'DeepSeek V4 Flash',
  description: 'سریع، ارزان، بهینه برای کدنویسی',
  tags: ['fast', 'cheap', 'coding'],
  contextWindow: 128_000,
  deprecated: false,
},
{
  provider: 'deepseek',
  id: 'deepseek-v4-pro',
  name: 'DeepSeek V4 Pro',
  description: 'قدرتمندترین مدل DeepSeek برای استدلال پیچیده',
  tags: ['powerful', 'reasoning', 'coding'],
  contextWindow: 128_000,
  deprecated: false,
},
// legacy (به عنوان fallback، با warning):
{
  provider: 'deepseek',
  id: 'deepseek-chat',
  name: 'DeepSeek Chat (V3) — Legacy',
  deprecated: true,
  migrationTarget: 'deepseek-v4-flash',
},
{
  provider: 'deepseek',
  id: 'deepseek-reasoner',
  name: 'DeepSeek Reasoner (R1) — Legacy',
  deprecated: true,
  migrationTarget: 'deepseek-v4-pro',
},
```


**Migration:**
اگر کاربر از `deepseek-chat` استفاده می‌کند:
- در UI warning: «این مدل منقضی شده. به DeepSeek V4 Flash سوئیچ کنید؟»
- دکمه: **Switch now** / **Keep for now**


**تست:**
1. کاتالوگ شامل هر ۴ مدل (V4-Flash, V4-Pro, V3, R1)
2. legacy flag = true برای قدیمی‌ها
3. migration suggestion نمایش داده می‌شود
4. وقتی کاربر DeepSeek انتخاب می‌کند، default = V4-Flash


---


## تسک A.4: VPS Connection State Sync


**مشکل:** VPS متصل است اما StatusBar `remote: off` نشان می‌دهد.


**ریشه:** state در store مرکزی همگام نیست.


**راه‌حل (الهام از Tabby و Nexion):**


### Store مرکزی:
فایل `src/renderer/store/vps.ts` بساز:
```typescript
interface VpsState {
  connections: Map<string, {
    vpsId: string;
    status: 'connecting' | 'connected' | 'disconnected' | 'error';
    lastConnectedAt?: number;
    error?: string;
  }>;
  
  activeVpsId: string | null;
  
  connect(vpsId: string): Promise<void>;
  disconnect(vpsId: string): Promise<void>;
  setActive(vpsId: string | null): void;
  getStatus(vpsId: string): ConnectionStatus;
}
```


### همگام‌سازی:
- **همه** کامپوننت‌ها (StatusBar، Chat Header، VpsPanel، Sidebar) از این store بخوانند.
- **نه** از state محلی.
- Subscription pattern: هر تغییری در store → همه UIها update.


### Auto-Reconnect:
در `src/renderer/App.tsx` هنگام mount:
```typescript
useEffect(() => {
  const lastVpsId = localStorage.getItem('last-active-vps');
  if (lastVpsId) {
    vpsStore.connect(lastVpsId).catch(err => {
      console.warn('Auto-reconnect failed:', err);
    });
  }
}, []);
```


### StatusBar:
```tsx
const activeVps = vpsStore.getActive();
const status = activeVps ? vpsStore.getStatus(activeVps) : null;


return (
  <div className="statusbar">
    {status === 'connected' && (
      <span className="text-green-500">
        🌐 {vpsStore.getName(activeVps)} (connected)
      </span>
    )}
    {status === 'disconnected' && (
      <span className="text-red-500">
        🌐 {vpsStore.getName(activeVps)} (disconnected)
      </span>
    )}
    {!activeVps && <span className="text-gray-500">remote: off</span>}
  </div>
);
```


### Chat Header:
Dropdown انتخاب VPS:
- لیست همه VPSها
- وضعیت هر کدام (🟢/🔴/🟡)
- «None» به‌عنوان option
- اگر VPS قبلی فعال بوده، auto-select


**تست:**
1. Connect → StatusBar → connected
2. Disconnect → StatusBar → disconnected
3. Auto-reconnect on mount
4. Chat header dropdown sync
5. Switch active VPS → همه UIها update


---


## تسک A.5: Full Access Toggle — Global State


**مشکل:** Full access در Settings فعال است اما در Composer «Ask before actions» نشان می‌دهد.


**راه‌حل (الهام از Codex approval_policy):**


### Store مرکزی:
فایل `src/renderer/store/approval.ts`:
```typescript
type ApprovalMode = 'ask' | 'auto-write' | 'full';


interface ApprovalState {
  mode: ApprovalMode;
  autoDisableAt: number | null;
  sessionStartedAt: number;
  
  setMode(mode: ApprovalMode): void;
}


const useApprovalStore = create<ApprovalState>((set, get) => ({
  mode: 'ask',
  autoDisableAt: null,
  sessionStartedAt: Date.now(),
  
  setMode(mode) {
    let autoDisableAt = null;
    if (mode === 'full') {
      autoDisableAt = Date.now() + 30 * 60 * 1000;
    }
    set({ mode, autoDisableAt });
    api.settings.set('approvalMode', mode);
  },
}));


// Auto-disable timer
setInterval(() => {
  const { autoDisableAt, mode } = useApprovalStore.getState();
  if (mode === 'full' && autoDisableAt && Date.now() > autoDisableAt) {
    useApprovalStore.getState().setMode('ask');
  }
}, 60_000);
```


### UI — زیر Composer:
```tsx
<div className="composer-footer">
  <button
    onClick={() => cycleApprovalMode()}
    className={cn(
      'text-sm px-3 py-1 rounded',
      mode === 'ask' && 'bg-gray-700',
      mode === 'auto-write' && 'bg-blue-700',
      mode === 'full' && 'bg-orange-600 text-white',
    )}
  >
    {mode === 'ask' && '🔒 Ask before actions'}
    {mode === 'auto-write' && '⚡ Auto-write'}
    {mode === 'full' && '🔓 Full access'}
  </button>
</div>
```


### Banner (وقتی mode=full):
```tsx
{mode === 'full' && (
  <div className="bg-red-900 text-white p-2 flex justify-between">
    <span>⚠️ Full access فعال است. Agent بدون تأیید اجرا می‌کند.</span>
    <button onClick={() => setMode('ask')}>Disable</button>
  </div>
)}
```


### همگام‌سازی Settings ↔ Composer:
- هر دو از `useApprovalStore` بخوانند.
- تغییر در هر کدام → همه‌جا update.
- persistence در `settings.json`.


**تست:**
1. Toggle در Composer → Settings → همگام
2. Toggle در Settings → Composer → همگام
3. Auto-disable after 30 min
4. Banner display on full
5. Persistence across restart


---


# 🔒 بخش B — Security Hardening


## تسک B.1: Secret Masking در Logs


**الزام:** هرگز credentials، API keys، tokens در logs یا audit نباشند.


### Implementation:
فایل `src/core/agent/redact.ts`:
```typescript
const PATTERNS = [
  /sk-[A-Za-z0-9]{20,}/g,           // OpenAI
  /sk-ant-[A-Za-z0-9-]{20,}/g,      // Anthropic
  /ghp_[A-Za-z0-9]{36}/g,           // GitHub PAT
  /gho_[A-Za-z0-9]{36}/g,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /password[=:]\s*\S+/gi,
  /api[_-]?key[=:]\s*\S+/gi,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
];


export function redact(text: string): string {
  let result = text;
  for (const pattern of PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
```


**Apply to:**
- همه logهای agent
- audit log
- error messages در UI
- console.log (فقط در production)


**تست:** ۱۰ سناریو با الگوهای مختلف.


---


## تسک B.2: Host-Key Verification اجباری


**الزام:** هیچ گزینه‌ای برای «ignore host key» نباشد.


### Implementation:
- اولین اتصال: fingerprint را نمایش بده.
- کاربر باید **دستی** تأیید کند (checkbox: «I trust this key»).
- fingerprint در `~/.ai-desktop/known_hosts.json` ذخیره شود.
- تغییر fingerprint → **بلاک اتصال** + هشدار قرمز (possible MITM).
- تنها راه عبور: دستی، با هشدار.


**تست:** ۵ سناریو (first, match, mismatch, missing, corrupted).


---


## تسک B.3: Policy per Host


**الزام:** هر VPS یک policy جداگانه داشته باشد.


### Model:
```typescript
interface HostPolicy {
  vpsId: string;
  mode: 'read-only' | 'staging' | 'production';
  allowCommands: string[];
  denyCommands: string[];
  requireApproval: 'never' | 'always' | 'destructive';
  allowedPaths: string[];
}
```


### Default Policies:
- **production:** read-only. هیچ write، هیچ sudo، هیچ deploy.
- **staging:** auto-write. deploy مجاز.
- **local/dev:** full access (با تأیید).


### UI:
- Settings → Connections → هر سرور → Policy editor.
- Warning در Chat اگر دستور خارج از policy باشد.


**تست:** ۸ سناریو (read-only block write, staging allow deploy, production block all mutations).


---


# ✅ بخش C — Verification & Testing


## C.1: تست Regression
بعد از هر تسک:
```bash
npm run typecheck
npm test
npm run build
```
هیچ regression مجاز نیست.


## C.2: تست Integration
- End-to-end: chat → tool → approval → apply → audit
- Migration از v2.3.0 → v2.3.1 (پروژه‌های قدیمی)
- Loop detection با سناریوی واقعی
- VPS connect → chat → remote_shell


## C.3: تست امنیتی
- `test/security/redaction.test.ts`
- `test/security/host-key.test.ts`
- `test/security/policy-engine.test.ts`


## C.4: Manual Smoke Test
- یک سناریو end-to-end روی Linux (اینجا xvfb-run).
- Screenshot در `docs/screenshots/v2.3.1/`.


---


# 📦 بخش D — Delivery


بعد از اتمام همه تسک‌ها:


1. `CHANGELOG.md` → بخش v2.3.1
2. `AGENTS.md` → Patterns جدید (Loop Detection, Workspace Type, Redaction)
3. `README.md` → بخش Troubleshooting
4. `TESTING_GUIDE_v2.3.1.md`
5. `FINAL_REPORT_v2.3.1.md`


### Git:
```bash
git checkout -b feature/v2.3.1-critical-fixes
# commits per task
git checkout master
git merge --no-ff feature/v2.3.1-critical-fixes
git tag -a v2.3.1 -m "v2.3.1 — Critical Fixes & Security Hardening"
git push origin master
git push origin v2.3.1
```


### Build:
```bash
npm run build:win
# → Setup 2.3.1.exe + Portable 2.3.1.exe + SHA256SUMS
```


### Release:
- GitHub Release v2.3.1 (private)
- prerelease: false
- upload 3 assets


---


# 🎬 شروع


## ترتیب دقیق:
1. **قبل از هر چیز:** `loop-detector.ts` را بخوان و کد فعلی را در پیام گزارش copy کن.
2. تسک A.1 (Loop) → تست → commit
3. تسک A.2 (Workspace Type) → تست → commit
4. تسک A.3 (DeepSeek V4) → تست → commit
5. تسک A.4 (VPS State) → تست → commit
6. تسک A.5 (Full Access) → تست → commit
7. تسک B.1 (Redaction) → تست → commit
8. تسک B.2 (Host-Key) → تست → commit
9. تسک B.3 (Policy) → تست → commit
10. تست integration + security
11. Merge + tag + build + release


## بعد از هر تسک، این فرمت گزارش:
```
✅ Task X.Y — [نام]
- فایل‌های تغییر یافته: [...]
- تست‌های جدید: [نام‌ها]
- نتیجه تست: X passed, Y failed
- typecheck: ✅
- build: ✅
- commit: abc1234
- مسئله باقی‌مانده: [هیچ / توضیح]
```


## در انتها:
گزارش کامل با:
- لیست همه تسک‌های تکمیل‌شده
- آمار تست (قبل/بعد)
- لینک GitHub Release
- SHA256 فایل‌ها
- کارهای نیمه‌کاره
- پیشنهاد برای v2.4


**بدون skip. بدون shortcut. اگر نمی‌توانی، بپرس.**
