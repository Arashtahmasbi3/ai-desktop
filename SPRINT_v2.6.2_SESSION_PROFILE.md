# SPRINT v2.6.2 — Session Profile, Goal/Plan/Run, Execution Trace

> **Status:** DESIGN ONLY — no code written. Waiting for user approval.
> **Base:** v2.6.1 (`master` @ `86ca591`). All file/line references are against the released v2.6.1 tree.
> **Scope decision:** SFTP/File UI is **deferred** to v2.7.x (see §9).

---

## 0. فلسفه (Philosophy)

هدف این اسپرینت، بستن فاصله‌ی بین «یک چت‌بات که ابزار صدا می‌زند» و «یک دستیار قابل‌اعتماد که مثل Codex کار می‌کند» است. سه ستون:

1. **Policy بالا، مکانیزم‌ها پایین.** امروز چهار تنظیم هم‌پوشان داریم (`approvalMode`, `planMode`, `HostPolicy`, `DiagnosticPolicy`). به‌جای افزودن دو مفهوم جدید (Explore + Elevated) آن‌ها را در **یک `SessionProfile`** جمع می‌کنیم که مکانیزم‌های موجود را orchestrate می‌کند و آن‌ها را حذف نمی‌کند.
2. **Main مرجع حقیقت است.** هر تصمیم امنیتی (انقضای Elevated، مسیرهای حساس، audit) در main اعمال می‌شود؛ renderer فقط نمایش می‌دهد. این هم‌راستا با اصل موجود P0-1..P0-4 است.
3. **هر عمل، یک تصمیم قابل‌ممیزی.** تایم‌لاین از «فهرست فعالیت» به «Intent + Evidence + Decision» ارتقا می‌یابد و در یک audit JSONL با زنجیره‌ی hash ثبت می‌شود.

اصل حاکم بر همه‌چیز: **fail-closed**. هر جا شک داریم، رد می‌کنیم و به کاربر می‌گوییم چرا.

---

## 1. باگ امنیتی که ابتدا fix می‌شود (P0-5)

**کشف Sprint analysis:** `FULL_ACCESS_TTL_MS = 30min` و `fullAccessExpiresAt` **فقط** در renderer (`src/renderer/src/store.ts:114,598-617`) با یک `setTimeout` نگه داشته می‌شوند. هیچ‌جای `src/main` یا `src/core` انقضا را چک نمی‌کند (grep خالی). پیامدها:

- اگر renderer reload/crash کند، timer از بین می‌رود ولی `approvalMode='full'` در `persistence.ts` (settings JSON) باقی می‌ماند ⇒ **Elevated برای همیشه**.
- اگر `rememberApprovalMode=true` باشد، همان مشکل دائمی می‌شود.
- `planMode` هم به همین شکل فقط در renderer است.

**Fix (بخشی از Topic 1):** Elevated به یک **grant صریح در main** تبدیل می‌شود:

- `Persistence` یک `sessionProfile` + `elevationGrant` را ذخیره می‌کند.
- main در شروع هر run و در هر tool-call، اعتبار grant را (project/vps/environment/TTL) چک می‌کند.
- renderer فقط `freeze`/`expiresAt` را برای نمایش می‌گیرد و **هیچ‌گاه** حقیقت را تعیین نمی‌کند.
- اگر renderer ریلود شود، main همچنان معتبر است؛ اگر grant منقضی شده باشد، main انکار می‌کند حتی اگر renderer بگوید full.

✅ این «اصلاح» است نه «رجعت» — دقیقاً مطابق rule «P0-1..P0-4 حفظ، فقط تقویت»: P0-5 یک لایه‌ی جدید هم‌خانواده است.

---

## 2. مدل Session Profile

### 2.1 چهار پروفایل

| Profile | هدف | ابزارها | رأی نهایی approval |
|---|---|---|---|
| **Investigate** | تحلیل read-only؛ اجازه‌ی *خواندن* دارد (برخلاف `planMode` فعلی که صفر ابزار می‌دهد) | read/search/git-status/remote-read + `diagnose_crash`/`system-health`؛ **بدون** `write_file`/`run_command`/`remote_shell`/`remote_write_file` | read-only هرگز نمی‌پرسد؛ write/shell اصلاً expose نمی‌شود |
| **Develop** | حالت پیش‌فرض امروز | همه‌ی ابزارها | همان `settings.approvalMode` (پیش‌فرض `auto-write`) |
| **Deploy** | کار روی staging/production | همه‌ی ابزارها | حداقل `auto-write`؛ روی production هرگز `full` نمی‌شود و mutationهای سرویس (push/restart/down) deny می‌مانند |
| **Elevated** | approval برداشته می‌شود، guardrailها فعال | همه‌ی ابزارها | `full` — اما deny-list + P0-2 containment + secret-path block **همیشه** فعال |

**Investigate دو زیرحالت دارد** (چون کاربر «شامل plan-only» را خواست):
- `investigateScope: 'read-only'` → ابزارهای خواندن expose می‌شوند (مدل OpenCode "plan = read-only").
- `investigateScope: 'plan-only'` → صفر ابزار، فقط plan تولید می‌شود (= `planMode` فعلی، حفظ می‌شود).

### 2.2 ورک‌فلو (هماهنگی لایه‌ها)

```
SessionProfile  (لایه بالا، orchestrate می‌کند)
   │
   ├─ approvalMode        ← انتخاب‌گر: effective base mode
   ├─ planMode            ← sub-flag رفع‌کننده (فقط در investigate)
   ├─ tool exposure       ← فیلتر مجموعه ابزارها (Investigate: بدون write/shell)
   ├─ enforceEnvironment  ← Deploy/Elevated: HostPolicy محیط‌آگاه را حاکم می‌کند
   └─ ElevationGrant      ← Elevated: grant+Ttl در main
            │
            ▼
   HostPolicy / DiagnosticPolicy  (لایه پایین، بدون تغییر — فقط تقویت)
```

### 2.3 جدول تبدیل Profile → مکانیزم‌های پایین

| Profile | `approvalMode` مؤثر | `planMode` | tool exposure | `enforceEnvironment` | `HostPolicy` | `DiagnosticPolicy` | TTL (grant) |
|---|---|---|---|---|---|---|---|
| investigate (read-only) | `ask` (read-only bypass) | `false` | read-only set | `false` | رعایت؛ فقط خواندن ممکن است | read-only فعال مجاز | — |
| investigate (plan-only) | `ask` | `true` | `[]` | `false` | بی‌اثر (بدون ابزار) | خیر | — |
| develop | `settings.approvalMode ?? 'auto-write'` | toggle کاربر | full set | `false` | رعایت (بدون تغییر) | read-only مجاز | — |
| deploy | `max('auto-write', settings.approvalMode)` و روی production سقفش `auto-write` | `false` (توصیه) | full set | **`true`** | حاکم؛ production: writes ask، service-mutation deny | read-only فقط | — |
| elevated | `full` (فقط با grant معتبر) | `false` | full set | **`true`** | حاکم؛ deny همیشه فعال | read-only مجاز | **dev 60 / staging 30 / prod 15 دقیقه** |

> ⚠️ **Backward-compat با v2.6.1:** وقتی settings قدیمی `profile` ندارد، `resolveSessionProfile()` مشتق می‌کند:
> - `planModeDefault === true` → `investigate/plan-only`
> - `approvalMode === 'full'` → `elevated` (با grant تازه‌ی ۳۰ دقیقه‌ای، همان رفتار قبلی)
> - در غیر این صورت → `develop`
>
> `approvalMode` و `planModeDefault` در schema **باقی می‌مانند** (additive); `profile` بالای آن‌ها می‌نشیند و هرگز آن‌ها را حذف/بازنویسی مخرب نمی‌کند.
>
> ⚠️ **تغییر TTL dev از ۳۰ → ۶۰ دقیقه:** عمدی است (headroom بیشتر برای کار local، ریسک صفر روی production). اگر نمی‌خواهی، به ۳۰ برمی‌گردانیم.

---

## 3. Schemaهای جدید

### 3.1 `src/shared/profile.ts` (جدید — pure، dependency-free)

```ts
import type { ApprovalMode } from './approval'
import type { ProjectEnvironment } from './project-metadata'

export const SESSION_PROFILES = ['investigate', 'develop', 'deploy', 'elevated'] as const
export type SessionProfile = (typeof SESSION_PROFILES)[number]

export type InvestigateScope = 'read-only' | 'plan-only'

/** Grants live in main; the renderer only ever sees this masked view. */
export interface ElevationGrantView {
  active: boolean
  expiresAt: number | null
  environment: ProjectEnvironment
  /** Set when main refused/expired; renderer shows the reason. */
  revokedReason?: 'expired' | 'scope_mismatch' | 'none'
}

export interface ProfileSettings {
  profile?: SessionProfile
  investigateScope?: InvestigateScope
  /** v2.6.1 compat — kept, no longer authoritative alone. */
  approvalMode?: ApprovalMode
  planModeDefault?: boolean
}

/** Effective behaviour derived from a profile + the active project context. */
export interface ResolvedProfile {
  profile: SessionProfile
  investigateScope?: InvestigateScope
  approvalMode: ApprovalMode
  planMode: boolean
  exposeWriteTools: boolean
  exposeShellTools: boolean
  enforceEnvironmentPolicy: boolean
  environment: ProjectEnvironment
  elevation?: ElevationGrantView
}

export interface ElevationGrant {
  token: string
  grantedAt: number
  expiresAt: number
  projectId?: string
  vpsId?: string
  environment: ProjectEnvironment
  maxTtlMs: number
}

export const ELEVATION_TTL_MS: Record<ProjectEnvironment, number> = {
  development: 60 * 60 * 1000,
  staging: 30 * 60 * 1000,
  production: 15 * 60 * 1000
}

export function isSessionProfile(v: unknown): v is SessionProfile
export function isInvestigateScope(v: unknown): v is InvestigateScope
/** Pure: never trusts a profile the renderer claims without a main-side grant. */
export function resolveSessionProfile(settings: ProfileSettings, grant: ElevationGrant | null, now?: number): ResolvedProfile
/** True when the grant matches project/vps/environment and is unexpired. */
export function isGrantValid(grant: ElevationGrant | null, scope: { projectId?: string; vpsId?: string; environment: ProjectEnvironment }, now?: number): boolean
export function createElevationGrant(input: { environment: ProjectEnvironment; projectId?: string; vpsId?: string; now?: number; random?: () => string }): ElevationGrant
```

### 3.2 `ApprovedPlan` با scope (تغییر در `src/shared/plan.ts`)

```ts
export interface PlanScope {
  /** sha256 پایدارِ steps (title+tool+canonical args، بدون id). */
  planHash: string
  projectId: string
  /** '' برای local. */
  vpsId: string
  /** git branch در لحظه‌ی تأیید؛ '' اگر غیر-git. */
  branch: string
  environment: ProjectEnvironment
}

export interface ApprovedPlan {
  id: string
  runId: string
  stepIds: string[]          // حفظ‌شده (v2.6.1)
  scope: PlanScope           // جدید — بدون آن، trust بی‌اعتبار و fail-closed
  approvedAt: number
  expiresAt: number
}

/** TTL بر اساس محیط (جایگزین ثابتِ ۳۰ دقیقه). */
export const PLAN_TRUST_TTL_BY_ENV: Record<ProjectEnvironment, number> = {
  development: 30 * 60 * 1000,
  staging: 15 * 60 * 1000,
  production: 5 * 60 * 1000
}

export function hashPlan(plan: Plan): string
/** نسخه‌ی v2.6.2: TTL محیطی + تطبیق کامل scope (planHash/project/vps/branch/env). */
export function isPlanActive(plan: ApprovedPlan, now?: number): boolean   // در approved-plan.ts
export function planMatchesScope(plan: ApprovedPlan, current: PlanScope, now?: number): boolean
```

**سخت‌گیری عمدی:** رکوردهای قدیمی `ApprovedPlan` (بدون `scope`) توسط `parsePlanTrust` **معتبر شناخته نمی‌شوند** (fail-closed) و فقط یک warning لاگ می‌شود — نه crash. کاربر باید یک‌بار دوباره plan را trust کند.

### 3.3 Goal (فایل جدید `src/shared/goal.ts`)

```ts
export type GoalStatus = 'active' | 'achieved' | 'abandoned' | 'blocked'

export interface GoalCriterion {
  id: string
  description: string
  met: boolean
  /** مسیر/کامند/تست به‌عنوان مدرک. */
  evidence?: string
  metAt?: number
}

export interface Goal {
  id: string
  projectId: string
  title: string
  description: string
  criteria: GoalCriterion[]
  status: GoalStatus
  createdAt: number
  updatedAt: number
  achievedAt?: number
}

/** لینک Goal به Plan و Run. */
export interface GoalLink {
  goalId: string
  planId?: string
  runId: string
  at: number
}

export function isGoal(value: unknown): value is Goal
export function isCriterionMet(c: GoalCriterion): boolean
export function goalProgress(goal: Goal): { met: number; total: number }
```

**پایداری (project-based، طبق تأیید کاربر):** `GoalStore` در app-data `<userData>/projects/<projectId>/goals.json`. چرا app-data و نه `<root>/.ai-desktop/`؟ چون پروژه‌های remote ریشه‌ی محلی ندارند؛ این مسیر برای local و remote یکسان کار می‌کند. برای پروژه‌های local، امکان آینه‌کردن اختیاری در `<root>/.ai-desktop/goals.json` در فاز بعد (اختیاری).

### 3.4 Run ↔ Goal

- `RunStore.Run` یک `goalId?: string` می‌گیرد (additive).
- `TaskPlan` یک `goalId?: string` می‌گیرد.
- `AgentService.run` یک `goalId?: string` در request می‌پذیرد؛ اگر نبود، **goal فعال** همان پروژه resolve می‌شود (اگر بیش از یکی باشد، `needs_input`).

---

## 4. Execution Trace — Intent / Evidence / Decision

### 4.1 فایل جدید `src/shared/trace.ts`

```ts
export type TracePhase = 'planning' | 'inspecting' | 'executing' | 'verifying' | 'done'

export type EvidenceKind = 'file' | 'command' | 'output' | 'diff' | 'test' | 'log'

export interface TraceEvidence {
  kind: EvidenceKind
  /** مسیر، کامند یا نام ابزار. */
  ref: string
  summary: string
  /** sha256 محتوای مدرک (redacted) برای audit. */
  hash?: string
  file?: string
  lines?: string
}

export interface TraceIntent {
  summary: string
  rationale?: string
}

export interface TraceDecision {
  id: string
  runId: string
  goalId?: string
  phase: TracePhase
  intent: TraceIntent
  evidence: TraceEvidence[]
  /** تصمیم گرفته‌شده: کامندی که اجرا شد / فایلی که نوشته شد / … */
  decision: string
  outcome?: 'ok' | 'failed' | 'blocked' | 'skipped'
  at: number
}

/** رویداد لاگ: event === 'decision' با payload کامل TraceDecision. */
export interface DecisionLogEntry extends AgentLogEntry {
  event: 'decision'
  decision: TraceDecision
}
```

**منبع داده (deterministic، بدون LLM اضافه):** orchestrator از قبل `AgentStep.thought` (planning)، `observations` (نتیجه‌ی ابزار) و `reflection` را تولید می‌کند. `TraceDecision` از همین‌ها **مشتق** می‌شود:
- `intent.summary` ← `step.thought` (اولین جمله‌ی معنادار)
- `evidence[]` ← هر observation: `kind` بر اساس ابزار، `ref` = path/command، `hash` = sha256 خروجی redacted
- `decision` ← actionهای همان step (`name` + args مختصر)
- `outcome` ← ok/blocked/failed

اگر `intent` خالی باشد، از action signature ساخته می‌شود (باز هم بدون LLM). این کار trace را قطعی و unit-testable نگه می‌دارد.

### 4.2 نگاشت فاز

`AgentPhase` موجود (`planning|execution|observation|reflection`) به `TracePhase` نگاشت می‌شود:
`planning→planning`، `execution→executing`، `observation→inspecting|verifying`، `reflection→verifying`، پایان → `done`. نگاشت توابع pure در `src/shared/trace.ts`.

### 4.3 «Ask Why»

- روی هر `DecisionCard` یک دکمه‌ی **Why?**.
- IPC جدید: `agent:explainStep(runId, decisionId)`.
- main از یک `TraceStore` درون‌حافظه (per-run) مقادیر `intent`/`evidence`/`decision` + `thought`/`reflection` همان step را برمی‌گرداند.
- **بدون فراخوانی LLM** به‌صورت پیش‌فرض (پاسخ فوری و قطعی). اگر بسته‌ی «خلاصه‌ی زبانی» لازم شد، یک فاز اختیاری بعداً.

### 4.4 Audit mode (append-only JSONL + hash chain)

فایل جدید `src/core/agent/audit-trail.ts`:

```ts
export interface AuditLine {
  seq: number
  userId: string            // os.userInfo().username
  ts: string                // ISO
  projectId: string
  vpsId: string
  runId: string
  goalId?: string
  phase: TracePhase
  path?: string
  command?: string
  approval: 'auto' | 'approved' | 'denied' | 'not_required' | 'blocked'
  result: 'ok' | 'failed' | 'blocked'
  evidenceHash?: string
  prevHash: string
  hash: string              // sha256(prevHash + canonical(line minus hash))
}

export class AuditTrail {
  constructor(opts: { file: string; userId?: string; now?: () => Date; redact?: (s: string) => string })
  append(entry: Omit<AuditLine, 'seq' | 'prevHash' | 'hash'>): Promise<AuditLine>
  verify(): Promise<{ ok: boolean; brokenAt?: number }>
}
```

- **مسیر:** پروژه‌ی local → `<root>/.ai-desktop/audit.log` (هم‌نام و سازگار با `auditLogPathFor` موجود). پروژه‌ی remote → `<userData>/projects/<projectId>/audit.log` (چون مسیر روی VPS نیست). این تفاوت صریحاً اینجا ثبت می‌شود.
- هر خط قبل از نوشتن با `redact()` موجود پاک می‌شود؛ secret هرگز روی دیسک نمی‌نشیند.
- `verify()` برای tamper detection؛ در UI دکمه‌ی «Verify audit» در Settings → Advanced.
- Export/sign → milestone بعد (طبق تأیید).

---

## 5. Secret Path Guard (block کامل، بدون استثنا)

فایل جدید `src/core/agent/secret-paths.ts` (pure، POSIX + Windows aware):

```ts
export interface SecretPathResult { blocked: boolean; ruleId?: string; reason?: string; path: string }

export const SECRET_PATH_RULES: { id: string; reason: string; test: (p: string) => boolean }[] = [
  // basename-based: .env، .env.*، *.pem، *.key، id_rsa/id_ed25519/id_ecdsa/id_dsa،
  // .git-credentials، .netrc، .npmrc، .pypirc، .pgpass، *.p12، *.pfx، *.jks، *.keystore
  // segment-based: /.ssh/، /.aws/، /.gnupg/، /.kube/، /.docker/config.json
  // absolute system: /etc/shadow، /etc/gshadow، /etc/sudoers، /etc/sudoers.d/
]

export function isSecretPath(path: string): SecretPathResult
/** پاک‌سازی متن کامند از نام فایل‌های حساس (برای shell). */
export function findSecretPathsInCommand(command: string): SecretPathResult[]
```

**نکته‌ی سخت‌گیرانه:** طبق دستور صریح کاربر، **بدون استثنا** — حتی `.env.example` هم block می‌شود (چون fail-closed است و هر «استثنا» یک سطح حمله‌ی جدید می‌سازد). ⚠️ این یک tradeoff واقعی است و اینجا علامت‌گذاری می‌شود؛ اگر بعداً خواستی، یک allowlist صریح و بسته برای templateهای امن (`.env.example|.sample|.template`) با تست اضافه می‌کنیم.

**نقاط اعمال (هم‌خانواده با P0-2، سه+یک نقطه):**
1. `routeToolCall` — اگر مسیر ابزار read/write/list/grep حساس بود ⇒ `blocked: true` قبل از هر routing.
2. `executeRemoteFs` — قبل از هر SFTP/کامند، برای همه‌ی ابزارهای مسیر.
3. `executeRemoteShell` — `findSecretPathsInCommand` قبل از deny-list و detach (پس secret حتی در Elevated هم deny می‌شود).
4. ابزارهای local (`src/main` file tools + `shell:exec` محلی).

**تست‌ها:** `test/security/secret-paths.test.ts` (≈۲۰ سناریو): خواندن/نوشتن `.env`، `cat .env`، `echo x > .env`، `id_rsa`، `/etc/shadow`، `/root/.ssh/authorized_keys`، مسیر حساس داخل project root (که P0-2 نمی‌گیرد)، در Elevated هم block، و موارد سالم (`.envrc` ≠ `.env`، `environment.ts`، `public.key` در مسیر build که rule اشتباه نگیرد — با تست مرزی).

---

## 6. تست‌های جدید

| فایل | تعداد سناریو | چه چیزی را واقعاً تست می‌کند |
|---|---|---|
| `test/security/elevation-main.test.ts` | ~10 | TTL در main: grant منقضی ⇒ deny، renderer bypass بی‌اثر، scope mismatch، grant تازه |
| `test/security/secret-paths.test.ts` | ~20 | هر ۴ نقطه اعمال + مرزهای false-positive |
| `test/core/session-profile.test.ts` | ~12 | `resolveSessionProfile` برای ۴ پروفایل + backward-compat v2.6.1 settings |
| `test/core/explore-mode.test.ts` | ~8 | Investigate read-only ابزار می‌دهد، plan-only صفر؛ write/shell expose نمی‌شود |
| `test/core/plan-scope.test.ts` | ~10 | `hashPlan`, تطبیق scope، رد plan قدیمی، TTL محیطی |
| `test/core/goal-store.test.ts` | ~9 | CRUD، پایداری، progress، goal فعال |
| `test/agent/goal-link.test.ts` | ~6 | Run/TaskPlan به Goal گره می‌خورند؛ تضاد اهداف |
| `test/core/trace-decision.test.ts` | ~10 | مشتق‌کردن `TraceDecision` از step واقعی (بدون mock) |
| `test/core/audit-trail.test.ts` | ~8 | JSONL، hash chain، `verify()` تشخیص دستکاری، redaction |
| `test/renderer/profile-switcher.test.tsx` | ~5 | سوییچ پروفایل + بنر Elevated + شمارش معکوس |
| `test/renderer/decision-card.test.tsx` | ~5 | نمایش Intent/Evidence + دکمه‌ی Why |
| `test/renderer/goal-panel.test.tsx` | ~5 | افزودن/تکمیل/معیار Goal |
| `test/renderer/shortcuts-overlay.test.tsx` | ~4 | overlay راهنما |
| `test/renderer/persian-bidi.test.tsx` | ~4 | RTL چت + `dir=ltr` برای path/command |
| `test/e2e/v2.6.2-integration.test.ts` | ~6 | جریان کامل: Investigate→Develop→Plan trust→Run با Goal→Trace/Audit، با HTTP stub (الگو: `test/e2e/v2.6.1-memory.test.ts`) |

مجموع تخمینی: **~۱۲۵ سناریوی جدید**. همه با کد واقعی؛ mock فقط در مرز HTTP (مثل v2.6.1). تست‌های `test/security` موجود باید سبز بمانند (رگرسیون P0-2).

---

## 7. ریسک‌ها و راه‌های کاهش

| # | ریسک | احتمال | اثر | کاهش |
|---|---|---|---|---|
| R1 | رگرسیون P0-1..P0-4 | متوسط | بالا | پروفایل فقط **فیلتر** است و P0-2/P0-3/P0-4 را دور نمی‌زند؛ اجرای کامل `test/security` قبل از هر commit؛ Elevated هرگز deny-list/P0-2 را برنمی‌دارد |
| R2 | مهاجرت schema settings/session | پایین | متوسط | additive + `resolveSessionProfile` مشتق‌کننده؛ bump `SETTINGS_SCHEMA_VERSION`؛ رکورد قدیمی هرگز حذف نمی‌شود؛ تست migration |
| R3 | انفجار ترکیبی policy | متوسط | بالا | همان مدل واحد profile؛ جدول تبدیل §2.3 تک‌مرجع است؛ تست هر profile×environment |
| R4 | i18n ناقص (fa/en) | متوسط | پایین | هر رشته‌ی جدید هم‌زمان در `i18n/en.json` و `fa.json`؛ تستی که کلید جاافتاده را می‌گیرد |
| R5 | false-positive در secret-path | متوسط | متوسط | تست‌های مرزی (`.envrc`, `environment.ts`, `public.key`)؛ ruleها basename/segment دقیق نه substring خام |
| R6 | نشت secret در audit | پایین | بالا | `redact()` قبل از hash و نوشتن؛ تست با یک secret نمونه که نباید در فایل ظاهر شود |
| R7 | scope creep (SFTP) | متوسط | متوسط | صریحاً defer؛ در AGENTS.md ثبت شد |
| R8 | تغییر TTL dev (۳۰→۶۰) | پایین | پایین | قابل revert؛ در §2.3 علامت‌گذاری شده |

---

## 8. ترتیب اجرا و نقشه‌ی commit (چکیده؛ تفصیل در گام ۳)

ترتیب تأیید‌شده: **۱ → ۴ → ۲ → ۳ → ۵**

1. **Topic 1 — Session Profile:** T1.1 vocabulary pure → T1.2 elevation grant در main (P0-5) → T1.3 gate/tool-exposure → T1.4 secret-path guard → T1.5 UI + i18n
2. **Topic 4 — Goal/Plan/Run:** T4.1 Goal schema/store → T4.2 Plan scope+hash+trust سخت‌گیرانه → T4.3 Run↔Goal + UI
3. **Topic 2 — Explore Mode:** T2.1 Investigate read-only tool set + named diagnostics → T2.2 plan-only حفظ → T2.3 environment-aware enforcement در Deploy
4. **Topic 3 — Execution Trace:** T3.1 trace schema + emit → T3.2 timeline/DecisionCard/Ask Why → T3.3 audit JSONL + hash chain + Verify
5. **Topic 5 — UI Polish:** T5.1 token counter → T5.2 Jobs collapse → T5.3 shortcuts overlay → T5.4 Persian/bidi
6. **Release:** e2e + AGENTS.md + CHANGELOG + bump + tag

**قواعد هر commit:** یک commit per task، Conventional Commits، `npm run typecheck` + `npm test` + `npm run build` همه سبز قبل از commit، AGENTS.md برای هر تصمیم مهم.

---

## 9. خارج از scope (ثبت در AGENTS.md)

- **TODO v2.7.x:** SFTP integration with terminal cwd sync (الهام Electerm). امروز `FileExplorer.tsx` فقط local است؛ remote از `vps:files:*` می‌آید و در UI نمایش داده نمی‌شود.
- Export/sign امضاشده‌ی audit (milestone بعد).
- Multi-user / RBAC / SSO (کاربر تک‌نفره است).

---

## 10. منابع و LICENSE (الگو، نه کپی)

| منبع | LICENSE | الگوی مطلوب | چه چیزی برنمی‌داریم |
|---|---|---|---|
| Codex | Apache-2.0 | Goal state, typed/phase-based events, token count | پروتکل Rust |
| OpenHands | MIT | timeline / evidence / diff / audit | پیاده‌سازی SDK |
| Cline | Apache-2.0 | permission handling, denied-tool strategy, remember-per-session | موتور approval (مال ما قوی‌تر است) |
| OpenCode | MIT | profile model (plan/build → Investigate/Develop/Deploy/Elevated) | کد |
| Tabby | MIT | collapse/focus UI pattern | کد |
| Electerm | MIT | terminal↔file UX (deferred) | کد |
| ShellHub | Apache-2.0 | audit/hash-chain concept | کد |

**قاعده:** هیچ کد مستقیمی کپی نمی‌شود؛ در صورت برداشتن کد قابل‌توجه، LICENSE در AGENTS.md ثبت و شرط آن رعایت می‌شود.

---

## 11. فایل‌های جدید / تغییریافته (خلاصه)

**جدید:** `src/shared/profile.ts`, `src/shared/goal.ts`, `src/shared/trace.ts`, `src/core/agent/secret-paths.ts`, `src/core/agent/audit-trail.ts`, `src/core/agent/goal-store.ts`, `src/core/agent/plan-hash.ts` (یا داخل plan), `src/main/goal-ipc.ts`, `src/renderer/src/components/{ProfileSwitcher,DecisionCard,GoalPanel,ShortcutsOverlay}.tsx`

**تغییر:** `src/shared/{plan,agent}.ts`, `src/core/agent/{approval,approved-plan,plan-trust,persistence,agent-orchestrator,task-planner}.ts`, `src/core/remote/{path-guard,remote-fs,remote-shell}.ts` (اتصال secret-path), `src/main/{agent-service,approval-gate,ipc,app-services}.ts`, `src/preload/{index.ts,index.d.ts}`, `src/renderer/src/{store.ts}`, `src/renderer/src/components/{ExecutionBar,FullAccessToggle,ProgressTimeline,ToolResultCard,ChatPanel,JobsPanel,FileExplorer}.tsx`, `src/renderer/src/i18n/{en,fa}.json`, `src/renderer/src/assets/main.css`, `AGENTS.md`, `CHANGELOG.md`, `package.json`

---

## 12. سؤالات تأیید نهایی

1. جدول §2.3 (Profile → مکانیزم‌ها) درست است؟ به‌خصوص: **Deploy روی production هرگز `full` نمی‌شود** و **Elevated هم deny-list/P0-2 را برنمی‌دارد**.
2. TTL محیطی: dev 60 / staging 30 / prod 15 دقیقه — تأیید؟ (تغییر dev از ۳۰ به ۶۰.)
3. Secret-path: `.env.example` هم block شود (بدون استثنا، طبق دستور) یا allowlist بسته داشته باشیم؟
4. Goal storage در `<userData>/projects/<projectId>/goals.json` (برای پشتیبانی local+remote) — تأیید؟ یا فقط `<root>/.ai-desktop/` برای local کافی است؟
5. `ApprovedPlan` قدیمی بدون scope: رد شود (نیاز به trust دوباره) — تأیید؟ (fail-closed.)
6. `TraceDecision` فقط از داده‌ی موجود مشتق شود (بدون LLM) — تأیید؟
7. Audit برای remote در app-data (نه روی VPS) — تأیید؟
8. بعد از تأیید این سند، اجرا را با ترتیب ۱→۴→۲→۳→۵ شروع کنم؟

---

**منتظر تأیید. هیچ کدی نوشته نمی‌شود.**
