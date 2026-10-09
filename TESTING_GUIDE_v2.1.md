# Testing Guide — AI Desktop v2.1.0

راهنمای تست دستی برای تأیید نسخهٔ **v2.1.0 (Pre-release)** روی یک ماشین تمیز ویندوز.
هر تسک Sprint v2.1 یک بخش با چک‌لیست دارد. از بالا به پایین کار کنید و هر آیتم را تیک بزنید.

- **Build under test:** `v2.1.0` (pre-release)
- **Release page:** https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.1.0
- **Target OS:** Windows 10 (1909+) or Windows 11, 64-bit
- **Time needed:** ~30–45 دقیقه
- **Known limitations:** [`KNOWN_ISSUES_v2.1.md`](./KNOWN_ISSUES_v2.1.md)

> **از یک VM تمیز شروع کنید.** ایده‌آل: ویندوز تازه‌نصب یا snapshot بدون نصب قبلی AI Desktop،
> بدون `%APPDATA%\AI Desktop` باقی‌مانده و بدون `node_modules`. نسخهٔ ویندوز (`winver`) را ثبت کنید.
>
> **⚠️ Build بدون امضا (unsigned) است** — انتظار هشدار SmartScreen را داشته باشید (بخش ۱۳).

---

## 1. Download & verify integrity

از صفحهٔ release دانلود کنید:

- `AI.Desktop.Setup.2.1.0.exe` (installer — نام فایل محلی: `AI Desktop Setup 2.1.0.exe`)
- `AI.Desktop.2.1.0.Portable.exe` (portable — نام فایل محلی: `AI Desktop 2.1.0 Portable.exe`)
- `SHA256SUMS.txt` (checksums)

> GitHub در حین upload فاصله‌های نام فایل را به نقطه تبدیل می‌کند؛ محتوای `SHA256SUMS.txt` با
> نام‌های نقطه‌دار منتشر شده تا مستقیماً قابل بررسی باشد.

**Expected SHA-256 (v2.1.0):**

```
5ea38500abdf35d487f7d20ed69470f78b5a31374eab5208bf1c07721656dc18  AI.Desktop.2.1.0.Portable.exe
f835786228db67408a9720c981d39659e939e26fd0d316b9ed962dc6f3d50bd1  AI.Desktop.Setup.2.1.0.exe
```

### Verify with PowerShell

```powershell
Get-FileHash ".\AI.Desktop.Setup.2.1.0.exe"    -Algorithm SHA256 | Format-List
Get-FileHash ".\AI.Desktop.2.1.0.Portable.exe" -Algorithm SHA256 | Format-List
```

بررسی خودکار:

```powershell
$expected = @{
  "AI.Desktop.Setup.2.1.0.exe"    = "f835786228db67408a9720c981d39659e939e26fd0d316b9ed962dc6f3d50bd1"
  "AI.Desktop.2.1.0.Portable.exe" = "5ea38500abdf35d487f7d20ed69470f78b5a31374eab5208bf1c07721656dc18"
}
foreach ($f in $expected.Keys) {
  if (-not (Test-Path ".\$f")) { "MISSING  $f"; continue }
  $actual = (Get-FileHash ".\$f" -Algorithm SHA256).Hash.ToLower()
  if ($actual -eq $expected[$f]) { "PASS  $f" } else { "FAIL  $f`n  expected $($expected[$f])`n  actual   $actual" }
}
```

- [ ] هر دو hash مطابق است.

---

## 2. Install & first launch

- [ ] نصب با `AI Desktop Setup 2.1.0.exe` (انتخاب مسیر نصب ممکن است).
- [ ] پس از نصب، اپ باز می‌شود؛ عنوان `AI Desktop` است.
- [ ] نسخهٔ Portable هم بدون نصب اجرا می‌شود.
- [ ] در Advanced Settings نسخهٔ `AI Desktop v2.1.0` نمایش داده می‌شود.

---

## 3. Task 1.1 — پروژه‌های با مسیر نامعتبر (Bug)

**هدف:** مسیر پروژهٔ ناموجود نباید crash کند و باید قابل بازیابی باشد.

- [ ] اگر `%APPDATA%\AI Desktop` از نسخهٔ قبل وجود دارد، اپ **بدون crash** بالا می‌آید.
- [ ] پروژه‌ای با مسیر ناموجود در Sidebar با آیکون ⚠ و متن «مسیر یافت نشد» نشان داده می‌شود.
- [ ] دکمهٔ **Remove** پروژه را حذف می‌کند. → پیام موفق در Toast.
- [ ] دکمهٔ **Locate** دیالوگ انتخاب پوشه را باز می‌کند و مسیر را به‌روز می‌کند.
- [ ] در Settings → Projects، همان پروژه با برچسب `missing path` و دکمهٔ Locate دیده می‌شود.
- [ ] اگر پروژهٔ موجود را باز کنید، `files:list` بدون خطا لیست می‌دهد.

---

## 4. Task 1.2 — تزریق `remote_shell` در چت اصلی (Bug)

**پیش‌نیاز:** یک VPS در Settings → VPS اضافه و **وصل** شده باشد.

- [ ] با VPS وصل، در Chat بپرسید: «به VPS وصل شو و `uname -a` را اجرا کن».
- [ ] Agent از ابزار `remote_shell` استفاده می‌کند (badge «used remote shell» روی پاسخ).
- [ ] خروجی دستور از سرور برگردانده می‌شود (نه پیام network disabled).
- [ ] با VPS **قطع**، درخواست مشابه → Agent می‌گوید ابتدا در Settings یک VPS اضافه/وصل کن.
- [ ] اجرای deny-list شده (مثل `rm -rf /`) بلاک می‌شود و Audit log ثبت می‌کند.

---

## 5. Task 1.3 — Window Controls سفارشی

- [ ] پنجره frameless است و Titlebar سفارشی نمایش داده می‌شود.
- [ ] دکمهٔ **Minimize** (`−`) پنجره را minimize می‌کند.
- [ ] دکمهٔ **Maximize/Restore** (`□`) بین maximize و unmaximize سوییچ می‌کند.
- [ ] دکمهٔ **Close** (`×`) پنجره را می‌بندد (hover قرمز `#e81123`).
- [ ] double-click روی ناحیهٔ Titlebar → maximize toggle.
- [ ] drag ناحیهٔ Titlebar پنجره را جابه‌جا می‌کند؛ روی دکمه‌ها drag غیرفعال است.
- [ ] آیکون دکمهٔ maximize پس از restore به حالت اولیه برمی‌گردد (event از main می‌آید).

---

## 6. Task 1.4 — i18n و RTL/LTR

- [ ] Settings → General → Language: گزینه‌های **English** و **فارسی**.
- [ ] انتخاب **فارسی**: کل UI راست‌به‌چپ می‌شود (`dir=rtl`) و فونت Vazirmatn اعمال می‌شود.
- [ ] انتخاب **English**: UI چپ‌به‌راست می‌شود.
- [ ] در StatusBar نشانگر زبان (`en`/`fa`) با کلیک بین دو حالت سوییچ می‌کند.
- [ ] پس از restart اپ، زبان انتخاب‌شده حفظ شده است (localStorage).
- [ ] هیچ متن hardcoded ناهماهنگ در Sidebar/Settings دیده نمی‌شود.

---

## 7. Task 2.1 — Sidebar با Chat History

- [ ] دکمهٔ بزرگ **+ New Chat** بالای Sidebar.
- [ ] ایجاد چند چت → در گروه‌های **Today / Yesterday / This Week / Older** دسته‌بندی می‌شوند.
- [ ] هر آیتم: عنوان (اولین پیام کاربر)، timestamp نسبی.
- [ ] منوی context هر چت: **Rename / Export / Delete**.
- [ ] Rename عنوان را تغییر می‌دهد و پس از restart باقی می‌ماند.
- [ ] Export یک فایل JSON دانلود می‌کند (پیام‌ها، workspace، مدل، VPS).
- [ ] Delete چت را حذف می‌کند.
- [ ] جست‌وجوی بالای لیست، چت‌ها را فیلتر می‌کند.
- [ ] `Ctrl+B` (یا دکمهٔ ☰) Sidebar را collapse/expand می‌کند (۲۶۰px ↔ ۶۰px).
- [ ] فایل‌ها در `<userData>/chats/{chatId}.json` ذخیره می‌شوند.

---

## 8. Task 2.2 — Workspace Switcher در Titlebar

- [ ] Dropdown نام workspace فعلی در Titlebar کنار Logo.
- [ ] لیست workspaceها + گزینهٔ **Open Folder** (dialog انتخاب پوشه).
- [ ] سوییچ workspace چت فعلی را نمی‌بندد؛ فقط context عوض می‌شود.
- [ ] مسیر workspace کنار نام با truncate نمایش داده می‌شود.
- [ ] پس از restart، workspace فعال حفظ می‌شود.

---

## 9. Task 2.3 — VPS Selector در Chat

- [ ] Dropdown `VPS: [None ▾]` در header چت کنار Model.
- [ ] انتخاب یک VPS وصل → tool callهای `remote_shell` روی همان سرور اجرا می‌شوند.
- [ ] انتخاب `None` → `remote_shell` در available tools نیست.
- [ ] VPS انتخاب‌شدهٔ **disconnect** → هشدار قرمز + دکمهٔ **Reconnect**.
- [ ] پیام assistant که از remote_shell استفاده کرده، آیکون/badge VPS دارد.

---

## 10. Task 2.4 — Chat Box (Codex-style)

- [ ] Input با border-radius ۱۲px و focus state واضح.
- [ ] دکمهٔ ارسال (`↑`) فقط با متن غیرخالی فعال است.
- [ ] `Enter` = ارسال، `Shift+Enter` = خط جدید.
- [ ] دکمهٔ 📎 فایل را attach می‌کند و به‌صورت `@<path>` به prompt اضافه می‌شود.
- [ ] drag & drop فایل روی پنجره هم کار می‌کند.
- [ ] token/character count زیر input (قابل خاموش‌کردن در Settings → General).
- [ ] در حین streaming، دکمهٔ ارسال به **Stop** (`■`) تبدیل می‌شود و پاسخ را متوقف می‌کند.
- [ ] textarea خودکار رشد می‌کند تا ۲۰۰px، سپس scroll می‌گیرد.
- [ ] دکمهٔ scroll-to-bottom و دکمهٔ copy روی پیام‌ها کار می‌کند.
- [ ] Placeholder دوزبانه مطابق locale.

---

## 11. Task 2.5 — Settings دو ستونی

- [ ] Layout دو ستونی: sidebar چپ (دسته‌ها)، محتوای راست.
- [ ] دسته‌ها: **General / Providers / Projects / GitHub / VPS / Advanced**.
- [ ] هر Provider یک کارت جدا: نام، وضعیت (active / no key)، input کلید (password) + Save + Remove، Model selector، دکمهٔ Set active.
- [ ] بخش Projects: افزودن با Browse، لیست، حذف، و بازیابی مسیر نامعتبر.
- [ ] بخش GitHub مطابق وضعیت: اگر Client ID نیست → توضیح گام‌به‌گام + لینک docs؛ اگر Device Flow آماده → دکمهٔ Connect GitHub.
- [ ] عناصر اضافی/checkboxهای نامربوط حذف شده‌اند.
- [ ] دکمهٔ بستن (`×`) گوشهٔ بالا-راست و کلید `Esc`.

---

## 12. Tasks 3.x — Polish (Onboarding، Toast، Empty States، Shortcuts، A11y)

### Onboarding
- [ ] ویزارد شامل مرحلهٔ **VPS & Remote** است.
- [ ] شمارندهٔ مرحله (`x / 5`) نمایش داده می‌شود.
- [ ] دکمه‌های Back / Skip / Next / Get started کار می‌کنند.

### Toast
- [ ] موفقیت = سبز + auto-dismiss.
- [ ] خطا = قرمز + دکمهٔ dismiss.
- [ ] Warning = زرد.
- [ ] Toast در پایین-راست و غیرمسدودکننده است.

### Empty States
- [ ] Chat خالی: لوگو + راهنما.
- [ ] Sidebar خالی: «هنوز چتی نداری. + New Chat».
- [ ] VPS خالی: راهنمای افزودن سرور.

### Keyboard Shortcuts
- [ ] `Ctrl+N` → New Chat
- [ ] `Ctrl+,` → Settings
- [ ] `Ctrl+K` / `Ctrl+P` → Command palette (فلش‌ها + Enter + Esc کار می‌کنند)
- [ ] `Ctrl+B` → Toggle Sidebar
- [ ] `Ctrl+1..6` → سوییچ بین viewها
- [ ] `Esc` به‌ترتیب palette → settings → error را می‌بندد

### Accessibility
- [ ] Focus visible روی همهٔ عناصر interactive (Tab بزنید).
- [ ] دکمه‌های آیکونی `aria-label` دارند.
- [ ] کنتراست متن‌ها ≥ 4.5:1.

---

## 13. Troubleshooting

| نشانه | علت | راه‌حل |
| --- | --- | --- |
| «Windows protected your PC» | build بدون امضای کد | More info → Run anyway |
| چت پاسخی نمی‌دهد | کلید API تنظیم نشده/نامعتبر | Settings → Providers → وارد کردن کلید معتبر |
| ابزار remote کار نمی‌کند | VPS وصل نیست | Settings → VPS → اتصال/Reconnect |
| `PATH_NOT_FOUND` | مسیر پروژه روی این OS وجود ندارد | Sidebar → Locate یا Remove |
| فونت فارسی درست نیست | زبان روی en است | Settings → General → فارسی |
| پالت باز نمی‌شود | focus داخل input است | ابتدا Esc، سپس `Ctrl+K` |

---

## 14. Reporting issues

هنگام گزارش، این موارد را ضمیمه کنید:

- نسخهٔ ویندوز (`winver`)
- نسخهٔ اپ (`Settings → Advanced`)
- locale فعال (`en`/`fa`)
- مراحل بازتولید + خروجی Console (`Ctrl+Shift+I`)
- اسکرین‌شات یا فیلم کوتاه

باگ‌ها را در GitHub Issues ثبت کنید: https://github.com/Arashtahmasbi3/ai-desktop/issues

---
_این سند توسط یک ایجنت هوش مصنوعی (OpenHands) به‌نمایندگی maintainer تهیه شده است._
