# Known Issues & Limitations — AI Desktop v2.1.0

این سند محدودیت‌های شناخته‌شدهٔ **v2.1.0 pre-release** را فهرست می‌کند. هیچ‌کدام غافلگیرکننده
نیستند؛ برای آگاهی تسترها اینجا ثبت شده‌اند. راهنمای تست در
[`TESTING_GUIDE_v2.1.md`](./TESTING_GUIDE_v2.1.md) و جزئیات کامل تأیید در
[`FINAL_REPORT_v2.1.md`](./FINAL_REPORT_v2.1.md).

کلید شدت: **⚠️ Expected** (طبق طراحی/محیط)، **ℹ️ Limitation** (برای نسخهٔ بعد)، **🐞 Bug**
(ناخواسته — لطفاً گزارش کنید).

---

## 1. No code signing → SmartScreen warning ⚠️

نصب‌کننده و نسخهٔ portable **امضا نشده‌اند** (گواهی امضا پیکربندی نشده).

- **نشانه:** ویندوز «Windows protected your PC» نشان می‌دهد؛ SmartScreen ممکن است اجرای اول را
  تأخیر/هشدار کند و برخی آنتی‌ویروس‌ها publisher ناشناس را علامت بزنند.
- **اثر:** فقط اصطکاک ظاهری — باینری‌ها همان‌هایی هستند که ساخته‌ایم (SHA-256 را در
  [`TESTING_GUIDE_v2.1.md`](./TESTING_GUIDE_v2.1.md#1-download--verify-integrity) بررسی کنید).
- **راه‌حل موقت:** **More info → Run anyway** (یا راست‌کلیک → Properties → **Unblock**).
- **رفع (maintainer):** گواهی امضا تهیه کنید؛ build خودکار امضا می‌شود وقتی
  `CSC_LINK` / `CSC_KEY_PASSWORD` (یا گواهی OS) تنظیم باشد. بدون تغییر کد.

---

## 2. An API key is required ⚠️

AI Desktop مدل بسته‌بندی‌شده ندارد و به provider میزبان متصل می‌شود.

- **نشانه:** چت تا وقتی کلید تنظیم نشود کاری نمی‌کند / خطای auth.
- **نیازمندی:** کلید معتبر **DeepSeek** (اصلی)، یا **OpenAI**، **Anthropic**، **Google**.
  کلیدها در Settings وارد و با keystore سیستم (`safeStorage`) رمزنگاری می‌شوند — هرگز plaintext
  و هرگز در renderer افشا نمی‌شوند.
- **اثر:** بدون کلید (و اینترنت) پاسخ ممکن نیست. هزینهٔ مصرف با provider است.

---

## 3. Docker is optional for the sandbox ⚠️

اجرای کد ترجیحاً از **Docker** استفاده می‌کند اما fallback محلی دارد.

- **با Docker:** اجرا در کانتینر سخت‌شده (محدودیت منابع، `--network none`, rootfs فقط‌خواندنی).
- **بدون Docker:** fallback شفاف به sandbox محلی و اجرای دستورات.

---

## 4. `ssh2` native dependency & Linux cross-build ⚠️

`ssh2` تنها dependency اجرایی است و از bundle خارج (lazy) نگه داشته می‌شود؛ بیلد ویندوز از
Linux انجام می‌شود.

- **اثر:** `cpu-features` (native اختیاری) بسته‌بندی نمی‌شود و `npmRebuild: false` است؛ fallback
  خالص-JS کار می‌کند.
- **توجه:** build از Linux برای `.exe` ویندوز پشتیبانی می‌شود (Wine؛ cache شده).

---

## 5. Deny-list روی ترمینال دستی ℹ️

ورودی ترمینال دستی VPS امروز اعمال deny-list نمی‌شود (کاربر مالک سرور است).

- **برنامه:** افزودن toggle اختیاری در Settings برای اعمال deny-list روی ورودی تایپ‌شده.
- **توجه:** ابزار `remote_shell` خود Agent همیشه تحت deny-list + rate limit است.

---

## 6. Onboarding — کلید GitHub embed نشده ℹ️

Sprint پیشنهاد embed کردن یک OAuth App پیش‌فرض را داشت.

- **وضعیت فعلی:** اتصال GitHub با Device Flow و Client ID کاربر (یا توضیح گام‌به‌گام) کار می‌کند.
- **برنامه:** embed کردن Client ID پیش‌فرض در نسخهٔ بعد تا کاربر نیازی به ساخت OAuth App نداشته باشد.
- **نیازمندی محیط:** `git` باید روی PATH باشد.

---

## 7. اپلیکیشن روی Linux/CI قابل اجرا نیست (فقط build) ⚠️

در محیط بدون display، `electron` با خطای zygote/namespace بالا نمی‌آید.

- **نشانه:** `Failed to move to new namespace` و `Failed to receive boot message from zygote`.
- **اثر:** فقط اجرای GUI؛ build و تست‌های headless سبز هستند. روی ویندوز اجرا می‌شود.

---

## 8. Renderer تک‌chunk است ℹ️

bundle رندرر یک chunk بزرگ minified است (Vite هشدار >500KB می‌دهد).

- **اثر:** برای اپ دسکتاپ که از دیسک لود می‌شود ناچیز است.
- **برنامه:** lazy-load مسیرهای Settings/Editor در نسخهٔ بعد.

---

## 9. سایر نکات ℹ️

- **دادهٔ کاربر هنگام uninstall حذف نمی‌شود** (`deleteAppDataOnUninstall: false`)؛ برای reset کامل
  `%APPDATA%\AI Desktop` را دستی پاک کنید.
- **i18n:** این نسخه `en`/`fa` با سوییچ زندهٔ RTL/LTR دارد. متن‌های طولانی onboarding انگلیسی
  مانده‌اند (طبق `[AUTO-DECISION]` در `AGENTS.md`).
- **تاریخچهٔ چت:** یک فایل JSON per chat در `<userData>/chats/`. مکانیزم قدیمی `agent.sessions`
  برای پنل Tasks باقی مانده است.
- **Export چت** به‌صورت JSON download است (بدون save dialog)؛ Rename با `window.prompt`.
- **Host keyهای VPS per-server pin می‌شوند**؛ تغییر key رد می‌شود. اگر سرور را عمداً rebuild
  کردید، اتصال را حذف و دوباره اضافه کنید.
- **سرور remote-access فقط localhost** است و احراز هویت/TLS ندارد.

---

## Reporting

موردی خارج از این لیست یا رفتاری متفاوت دیدید؟ در GitHub Issues ثبت کنید:
https://github.com/Arashtahmasbi3/ai-desktop/issues

**هرگز API key، token، پسورد SSH یا private key را در گزارش قرار ندهید.**

---
_این سند توسط یک ایجنت هوش مصنوعی (OpenHands) به‌نمایندگی maintainer تهیه شده است._
