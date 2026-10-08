# گزارش نهایی — v2.0.0

## خلاصه اجرا

- تاریخ شروع: 2026-10-05
- تاریخ پایان: 2026-10-05
- مجموع Sprintها: ۴ (v1.1, v1.2, v1.3, v2.0)
- مجموع قابلیتها: ۱۵
- مجموع کامیتهای Sprint 4: ۵ (۳ کامیت قابلیت/تست + یادداشت backlog + اصلاح build)
- مجموع کامیتهای `master`: ۳۲
- مجموع تستها: **384 پاس / 1 skip** (۵۳ فایل) — `typecheck` و `build` سبز
- حجم کد: **~14,256 خط** TypeScript/TSX در `src/` (۱۱۰ فایل) + **~5,578 خط** تست
- وضعیت نهایی: ✅ (merge به master، tag، pre-release و installer منتشر شد)

## لینک pre-releaseها

| نسخه | لینک |
| --- | --- |
| v1.1.0 | https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v1.1.0 |
| v1.2.0 | https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v1.2.0 |
| v1.3.0 | https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v1.3.0 |
| v2.0.0 | https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.0.0 |

📦 دانلود v2.0.0 (assetها): https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.0.0

- `AI Desktop Setup 2.0.0.exe` — ~107.2 MB (نصبکننده NSIS)
- `AI Desktop 2.0.0 Portable.exe` — ~106.9 MB (نسخهٔ portable)
- `SHA256SUMS.txt` — چکسام SHA-256

## قابلیتهای هر Sprint

### Sprint 1 — v1.1 (مدل و UX)
- Model switcher در هدر چت (انتخاب مدل/پرووایدر برای هر پیام)
- کاتالوگ مرکزی مدلها (`src/shared/models.ts`)
- Custom providers سازگار با OpenAI + تست اتصال زنده
- ویزارد onboarding در اجرای اول

### Sprint 2 — v1.2 (پیشنمایش و مرور)
- Diff دوبهدو (split view)
- Markdown preview درونبرنامهای
- مرورگر داخلی sandboxed (Ctrl+4) محدود به `http(s)`

### Sprint 3 — v1.3 (GitHub)
- احراز هویت OAuth Device Flow (توکن رمزنگاریشده)
- عملیات مخزن: commit / pull / push / clone (view Ctrl+5)
- لیست Pull Requestها و Issueها

### Sprint 4 — v2.0 (VPS / Remote)
- اتصال SSH (رمز/کلید) با تأیید اجباری host key
- ترمینال زنده (xterm) + File explorer از راه دور (SFTP)
- ابزار guardشدهٔ `remote_shell` برای Agent
- گاردهای امنیتی: deny list، rate limit 100/min، audit log JSON، قطع خودکار ۳۰ دقیقهای

## Sprint 1 — v1.1

- قابلیتها: ۴/۴ ✅ (تغییر مدل در حین چت، کاتالوگ مدل‌ها، Custom Providers، Onboarding)
- کامیتها: ۵
- تستهای جدید: بخشی از مجموعه فعلی
- مشکلات باقی‌مانده: —
- تصمیمات خودکار (AUTO-DECISION): کاتالوگ مدل‌ها به‌صورت shared در `src/shared/models.ts`
- گزینه‌های بهتر (BETTER-ALTERNATIVE): —

## Sprint 2 — v1.2

- قابلیتها: ۳/۳ ✅ (Split diff، Markdown preview، مرورگر آنلاین)
- کامیتها: ۳
- مشکلات باقی‌مانده: —
- تصمیمات خودکار: preview داخلی با محدودیت `http(s)`

## Sprint 3 — v1.3

- قابلیتها: ۳/۳ ✅ (GitHub OAuth device flow، عملیات ریپو، PR/Issues)
- کامیتها: ۳
- مشکلات باقی‌مانده: —
- تصمیمات خودکار: Device Flow به‌جای redirect؛ توکن با `safeStorage`
- گزینه‌های بهتر: حذف `octokit`/`simple-git` و استفاده از `fetch` + CLI `git`

## Sprint 4 — v2.0

- قابلیتها: ۵/۵ ✅
  1. اتصال SSH (رمز/کلید + تأیید اجباری host key)
  2. ترمینال زنده (xterm)
  3. File explorer از راه دور (SFTP)
  4. یکپارچگی با Agent (`remote_shell` مورد اعتماد/guard شده)
  5. تست نفوذ
- کامیتها: ۵
- تستهای نفوذ: **پاس در همه سناریوها** — `rm -rf /`، `curl … | bash`، fork bomb،
  `dd of=/dev/sda`، عبور از ۱۰۰ دستور/دقیقه، و host key اشتباه همگی بلاک می‌شوند
  (`test/security/penetration.test.ts`).
- آسیب‌پذیری‌های باقی‌مانده:
  - ترمینال SSH به‌طور ذاتی اجازهٔ دستور دلخواه می‌دهد؛ Deny list فقط روی `exec` مبتنی بر متد
    (ابزار Agent) اعمال می‌شود، نه روی تایپ دستی در ترمینال — چون کاربر خودش صاحب سرور است.
  - وابستگی به باینری/پکیج `ssh2` (تنها dependency زمان‌اجرا) برای بسته‌بندی.
  - Code signing و auto-update همچنان ندارد.

## آمار کلی

- نسخه نهایی: 2.0.0
- تگها: `v1.1.0, v1.2.0, v1.3.0, v2.0.0` — همه ساخته و به origin push شدند
- کامیتها روی `master`: ۳۲
- تستها: ۵۳ فایل / 384 پاس / 1 skip
- خطوط کد: ~14,256 خط TS/TSX در `src/` + ~5,578 خط تست
- پیشنیازهای کاربر: Windows 10+, Node.js 20+, Git (اختیاری), حساب GitHub (اختیاری), VPS با SSH (اختیاری)
- هزینه توکن تخمینی: —
- زمان تخمینی اجرا: —

## Smoke test (اجرای داخلی)

روی همین محیط Linux با `xvfb-run` + Electron ساختهشده (`out/main/index.js`) و از طریق
Chrome DevTools Protocol اجرا شد:

- ✅ پنجره باز شد (عنوان `AI Desktop`، ریشهٔ React رندر شد).
- ✅ `window.api` با همهٔ namespaceها موجود بود: `app, settings, dialog, projects,
  customProviders, onboarding, github, vps, fs, agent, worker, remote, webUtils, events`.
- ✅ IPC handlerها واقعاً پاسخ دادند:
  - `app.ping` → `"pong"`
  - `settings.get` → شیء settings
  - `vps.list` / `vps.status` / `vps.audit` → مقادیر معتبر (disconnected / 0)
  - `agent.sessions` → آرایه
  - `worker.status` → `{state:"idle", online:true, ...}`
  - `fs.list` → پاسخ معتبر
- ✅ **صفر خطای console و صفر exception**.
- (خطوط `dbus` در لاگ، خطای محیط بدون D-Bus هستند و بیربط به اپ.)

اسکرینشات پنجرهٔ اجراشده: `.agent_tmp/smoke-v2.0.0.png`

## Installer v2.0.0

از `master` ساخته و به pre-release v2.0.0 آپلود شد:

| فایل | حجم | SHA-256 |
| --- | --- | --- |
| `AI Desktop Setup 2.0.0.exe` | ~107.2 MB | `14f3135937e53f055b398d11fade2fe9ff4579e843fc32058033ef819a8602c9` |
| `AI Desktop 2.0.0 Portable.exe` | ~106.9 MB | `2b5d95528dd080a6a3e4cecea7d89d8c87689c096a19620ec06aa6b3d7710edf` |
| `SHA256SUMS.txt` | چکسام | — |

## دستاوردهای کلیدی

- مرز امنیتی سخت برای Remote: host-key اجباری، deny list، rate limit، audit log JSON و
  قطع خودکار پس از ۳۰ دقیقه بی‌کاری — همه در main process و همه تست‌شده.
- هیچ secret ای به renderer نمی‌رود؛ رمز/عبارت عبور با `safeStorage` رمزنگاری و کلید خصوصی
  فقط با مسیر ارجاع داده می‌شود.
- `SshBackend` به‌صورت interface طراحی شد تا مدیر SSH با یک transport جعلی کاملاً تست شود.

## محدودیت‌ها و کارهای آینده (v2.1+)

- **TODO v2.1 (تصمیم کاربر):** گزینه «اعمال Deny-list روی ترمینال دستی» در Settings —
  پیش‌فرض **خاموش**. امروز ترمینال دستی VPS آزاد است چون کاربر مالک سرور است؛ در v2.1 یک
  تاگل اختیاری در Settings اضافه می‌شود تا deny list روی ورودی تایپ‌شده هم اعمال شود.
  (ثبت‌شده در `AGENTS.md` بخش Backlog.)
- Code Signing
- Auto-update
- Ollama/Local models
- نسخه macOS/Linux
- Multi-agent
- پشتیبانی از known_hosts سیستم و انتقال فایل با پروتکل‌های بیشتر (rsync/scp)

## توصیه برای تست دستی کاربر

۱. اجرای `npm run dev` و باز کردن نمای VPS با `Ctrl+6`
۲. افزودن یک سرور (رمز یا مسیر کلید خصوصی)
۳. تأیید fingerprint در اتصال اول (و رد کردن اتصال با کلید اشتباه)
۴. تست ترمینال، مرور فایل‌ها و اجرای یک دستور خطرناک برای دیدن بلاک شدن
۵. بررسی Audit tab و رخدادهای `blocked`/`rate_limited`

## تصمیمات خودکار (خلاصه)

| ID | تصمیم |
| --- | --- |
| `[AUTO-DECISION]` | Deny list به‌صورت regex و over-eager، با تست ۱۶ دستور خطرناک |
| `[AUTO-DECISION]` | host key فقط پس از تأیید صریح کاربر pin می‌شود |
| `[AUTO-DECISION]` | audit log به‌صورت آرایه JSON با سقف ۲۰۰۰ رکورد |
| `[BETTER-ALTERNATIVE]` | `keytar` → `safeStorage` (بدون native module دوم) |
| `[BETTER-ALTERNATIVE]` | `ssh2-sftp-client` حذف و از SFTP داخلی `ssh2` استفاده شد |
| `[BETTER-ALTERNATIVE]` | `xterm`/`xterm-addon-fit` (منسوخ) → `@xterm/xterm`/`@xterm/addon-fit` |

## پیام پایانی

موفق باشی 🚀
