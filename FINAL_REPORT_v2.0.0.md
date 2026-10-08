# گزارش نهایی — v2.0.0

## خلاصه اجرا

- تاریخ شروع: 2026-10-05
- تاریخ پایان: 2026-10-05
- مجموع Sprintها: ۴ (v1.1, v1.2, v1.3, v2.0)
- مجموع قابلیتها: ۱۵
- مجموع کامیتهای Sprint 4: ۳ (به‌علاوه کامیتهای Sprint 1–3 روی برنچ‌های جدا)
- مجموع تستها: **384 پاس / 1 skip** (۵۳ فایل) — `typecheck` و `build` سبز
- وضعیت نهایی: ✅ (به‌صورت محلی کامیت شد؛ push/merge به master انجام نشد — نیازمند تأیید کاربر)

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
- کامیتها: ۳
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
- تگها: پیشنهادی `v1.1.0, v1.2.0, v1.3.0, v2.0.0` (تگ‌زنی محلی انجام نشد)
- پیش‌نیازهای کاربر: Windows 10+, Node.js 20+, Git (اختیاری), حساب GitHub (اختیاری), VPS با SSH (اختیاری)
- هزینه توکن تخمینی: —
- زمان تخمینی اجرا: —

## دستاوردهای کلیدی

- مرز امنیتی سخت برای Remote: host-key اجباری، deny list، rate limit، audit log JSON و
  قطع خودکار پس از ۳۰ دقیقه بی‌کاری — همه در main process و همه تست‌شده.
- هیچ secret ای به renderer نمی‌رود؛ رمز/عبارت عبور با `safeStorage` رمزنگاری و کلید خصوصی
  فقط با مسیر ارجاع داده می‌شود.
- `SshBackend` به‌صورت interface طراحی شد تا مدیر SSH با یک transport جعلی کاملاً تست شود.

## محدودیت‌ها و کارهای آینده (v2.1+)

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
