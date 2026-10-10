# SPRINT v2.4.2 — Loop Detector Fix (Critical)

## 📌 Status
- ✅ Fix 1 — per-call guard keyed on normalized call identity — commit `fabde1c`
- ✅ Fix 2 — successful shell command resets the loop window — commit `34789dd`
- ✅ Release v2.4.2 — merge `b6207d4`, tag `v2.4.2`, GitHub Release published

Branch merged: `feature/v2.4.2-loop-fix` → `master`
Release: https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.4.2


## 🎯 هدف
رفع دو باگ تشخیص حلقه که باعث توقف نادرست (false positive) در اجرای ابزارهای general-purpose می‌شد.


## ⛔ قوانین سخت
- بدون skip
- هر تسک: یک commit + حداقل ۳ تست
- قبل از هر commit: typecheck + test + build
- اگر شک داری، بپرس


## 🔍 ریشه باگ (ریشه‌یابی تاییدشده)

### باگ ۱ — شمارش فقط بر اساس نام ابزار
در `src/core/agent/loop-detector.ts`، گارد per-tool-call پنجره را با **نام ابزار** می‌شمرد:
`remote_shell("pwd")` + `remote_shell("ls")` + `remote_shell("cat")` = سه «تکرار»
→ هشدار روی سومی و توقف روی پنجمی، در حالی که این‌ها سه کار متفاوت‌اند.

### باگ ۲ — موفقیت remote_shell به‌عنوان progress حساب نمی‌شد
در `src/core/agent-orchestrator.ts` فقط `read_file/write_file/remote_read_file/remote_write_file`
پنجره را reset می‌کردند؛ یک اسکریپت طولانی از دستورهای shell موفق و متفاوت باز هم پنجره را پر می‌کرد.


## ✅ راه‌حل

### Fix 1 — call identity به‌جای نام ابزار
`computeLoopHash(toolName, args)` (exported از `loop-detector.ts`):
- ابزارهای general-purpose (`run_command`, `remote_shell`, `shell_exec`): کلید = نام + **command نرمال‌شده** (trim + جمع‌کردن فاصله‌های اضافی)
- ابزارهای مسیرمحور (`read_file`, `write_file`, `list_dir`, `remote_*`, `exists`): کلید = نام + **path نرمال‌شده** (یکسان‌سازی `/` و `\`، حذف `./` و اسلش انتهایی)
- بقیه: نام + `stableStringify(args)` کامل

نتیجه: دستورهای متفاوت یک ابزار با هم جمع نمی‌شوند، ولی **تکرار عیناً یکسان** هنوز روی ۳ هشدار و روی ۵ توقف می‌دهد.

### Fix 2 — shell موفق = پیشرفت
`run_command` و `remote_shell` به مجموعهٔ `progressTools` در orchestrator اضافه شدند؛
هر فراخوانی موفق `markProgress()` را صدا می‌زند و پنجرهٔ حلقه را تازه می‌کند.
لایهٔ step-level (`observe`) هم‌چنان تکرار واقعی را می‌گیرد، پس محافظت از دست نمی‌رود.

### تست‌ها
- `test/core/loop-detector.test.ts` — بازنویسی تست ۸ (رفتار قدیمی) + ۵ تست جدید (۹–۱۳)
- `test/agent/orchestrator.test.ts` — ۳ تست جدید در describe «shell progress (v2.4.2)»


## 🎬 ترتیب اجرا
1. Fix 1 + تست‌ها → commit
2. Fix 2 + تست‌ها → commit
3. (اختیاری، در صورت درخواست) bump 2.4.1 → 2.4.2، merge به `master`، tag `v2.4.2`، push
