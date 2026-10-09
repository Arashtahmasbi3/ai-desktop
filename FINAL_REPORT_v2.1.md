# گزارش نهایی — v2.1.0 (UX Overhaul)

## خلاصه اجرا

- تاریخ اجرا: 2026-10-05
- نسخه: `2.0.0` → `2.1.0`
- برنچ: `feature/v2.1-ux-overhaul` → merge با `--no-ff` به `master`
- کامیت merge: `02b95c9` — "Merge v2.1: UX overhaul"
- کامیت قابلیت: `cfda6e6` — feat(v2.1): UX overhaul, i18n, chat history and critical bug fixes
- کامیت مستندات: `4884892` — docs(v2.1): changelog entry and sprint auto-decisions
- مجموع کامیت‌های `master`: ۳۸
- تست‌ها: **411 پاس / 1 skip** (۵۸ فایل) — یک تست جدید نیز skip شده
- `typecheck` (node + web): ✅ سبز
- `npm run build`: ✅ سبز
- وضعیت نهایی: ✅ (merge + tag + pre-release + installer منتشر شد)

---

## جدول تسک‌ها

| تسک | عنوان | وضعیت | کامیت |
| --- | --- | --- | --- |
| 1.1 | رفع `files:list: ENOENT` و mark پروژه‌های نامعتبر (`PATH_NOT_FOUND`) | ✅ | `cfda6e6` |
| 1.2 | تزریق `remote_shell` در چت اصلی (`RemoteShellToolExecutor` + orchestrator) | ✅ | `cfda6e6` |
| 1.3 | Window Controls سفارشی (frameless + IPC minimize/maximize/close) | ✅ | `cfda6e6` |
| 1.4 | i18n (i18next en/fa + سوییچ زندهٔ RTL/LTR + ذخیرهٔ locale) | ✅ | `cfda6e6` |
| 2.1 | Sidebar با Chat History (گروه‌بندی زمانی، جست‌وجو، context menu) | ✅ | `cfda6e6` |
| 2.2 | Workspace Switcher در Titlebar | ✅ | `cfda6e6` |
| 2.3 | VPS Selector در Chat + badge استفادهٔ remote | ✅ | `cfda6e6` |
| 2.4 | بازطراحی Chat Box (attach/token count/stop/auto-resize/scroll) | ✅ | `cfda6e6` |
| 2.5 | Settings دو ستونی (General/Providers/Projects/GitHub/VPS/Advanced) | ✅ | `cfda6e6` |
| 3.1 | Onboarding دوباره (مرحلهٔ VPS + شمارندهٔ مرحله) | ✅ | `cfda6e6` |
| 3.2 | Toast Notifications (success/error/warning) | ✅ | `cfda6e6` |
| 3.3 | Empty States (chat/sidebar/palette) | ✅ | `cfda6e6` |
| 3.4 | Keyboard Shortcuts (palette/sidebar/views/Esc) | ✅ | `cfda6e6` |
| 3.5 | Accessibility (aria-label، focus، dکمه‌های آیکونی) | ✅ | `cfda6e6` |
| — | تست‌ها (i18n/chat-store/fs/vps-injection) | ✅ | `cfda6e6` |
| — | نسخه 2.1.0 + CHANGELOG + AGENTS.md | ✅ | `cfda6e6`, `4884892` |
| — | merge/tag/pre-release/installer | ✅ | `02b95c9` |

> تمام تسک‌های فاز A/F/۱/۲/۳ تکمیل شده‌اند (به `AGENTS.md` بخش v2.1 رجوع کنید).

---

## لینک pre-release

📦 https://github.com/Arashtahmasbi3/ai-desktop/releases/tag/v2.1.0

| فایل | حجم | SHA-256 |
| --- | --- | --- |
| `AI.Desktop.Setup.2.1.0.exe` | ~107.2 MB | `f835786228db67408a9720c981d39659e939e26fd0d316b9ed962dc6f3d50bd1` |
| `AI.Desktop.2.1.0.Portable.exe` | ~106.9 MB | `5ea38500abdf35d487f7d20ed69470f78b5a31374eab5208bf1c07721656dc18` |
| `SHA256SUMS.txt` | 189 B | — |

- tag: `v2.1.0` — title: **v2.1.0 — UX Overhaul (Pre-release)** — prerelease: `true`
- ⚠️ مخزن private است؛ دانلود نیازمند ورود به GitHub است.

---

## آمار کد

| سنجه | مقدار |
| --- | --- |
| فایل‌های `src/` (ts/tsx) | 118 |
| خطوط `src/` | ~16,195 |
| فایل‌های تست | 64 |
| خطوط تست | ~5,932 |
| تغییرات v2.0.0 → master | 48 فایل، +4,050 / −347 |

### تست‌های جدید v2.1

- `test/renderer/i18n.test.ts` — parity کلیدهای en/fa + تشخیص locale
- `test/renderer/chat-store.test.ts` — state/actionهای تاریخچهٔ چت
- `test/main/chat-store.test.ts` — CRUD فایل‌محور چت
- `test/main/fs-invalid-path.test.ts` — عدم crash روی مسیر نامعتبر
- `test/core/vps-tool-injection.test.ts` — تزریق `remote_shell`

---

## قابلیت‌های نسخه

### i18n و RTL/LTR
- `en`/`fa` با i18next + react-i18next؛ سوییچ فوری `dir`؛ ذخیره در localStorage.

### تاریخچهٔ چت
- یک فایل JSON per chat در `<userData>/chats/`؛ گروه‌بندی Today/Yesterday/This Week/Older؛
  جست‌وجو، Rename، Export (JSON)، Delete.

### UI Codex-style
- Titlebar frameless با کنترل‌های سفارشی و workspace switcher.
- Sidebar قابل collapse (۲۶۰px ↔ ۶۰px)، دکمهٔ بزرگ New Chat.
- Chat box با attach، token count، Stop، auto-resize، scroll-to-bottom، copy.
- Settings دو ستونی و Command Palette (`Ctrl+K`/`Ctrl+P`).

### رفع باگ‌ها
- `PATH_NOT_FOUND` + بازیابی مسیر پروژه.
- تزریق `remote_shell` وقتی VPS وصل است.
- پذیرش مسیر ویندوزی در اعتبارسنجی cross-platform.
- گزارش وضعیت maximize/restore به renderer.

---

## تصمیم‌های خودکار (خلاصه)

تمام `[AUTO-DECISION]`ها در `AGENTS.md` ثبت شده‌اند؛ کلیدی‌ترین‌ها:
- نسخه `2.1.0`.
- تاریخچهٔ چت = فایل-per-chat؛ `agent.sessions` برای پنل Tasks حفظ شد.
- i18n = i18next؛ locale در localStorage؛ متن‌های طولانی onboarding انگلیسی ماندند.
- Export = JSON download؛ Rename = `window.prompt`.
- IPC جدید `dialog:pickFile` برای attach.

---

## تأیید نهایی

- [x] `npm run typecheck` (node + web)
- [x] `npm test` — 411 پاس / 1 skip
- [x] `npm run build`
- [x] `npm run build:win` — Setup + Portable
- [x] merge `--no-ff` به `master` + push
- [x] tag `v2.1.0` + push
- [x] pre-release با ۳ asset
- [x] مستندات (Testing Guide، Known Issues، Final Report)

---
_این گزارش توسط یک ایجنت هوش مصنوعی (OpenHands) به‌نمایندگی maintainer تهیه شده است._
