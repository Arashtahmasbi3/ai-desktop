# 🎯 SPRINT v2.2 — Codex-Like Features & Deep Fixes

## 🧠 نقش تو
تو یک ایجنت ارشد طراحی و مهندسی هستی.
هدف: رفع مشکلات v2.1 و ارتقای اپ به سطح واقعی Codex.
بدون توقف کار کن. تمام تصمیم‌ها در این سند گرفته شده.
AUTO-DECISION در AGENTS.md ثبت کن.

## ⛔ استثنائات توقف
فقط: بودجه > $40، ۱۰ خطای متوالی، خطای امنیتی.

---

## 🎯 تسک‌های Sprint v2.2

### 🔴 تسک ۱: Path Discovery خودکار (حیاتی)

**مشکل:** پروژه با مسیر `/opt/demo-project` ساخته شده اما روی ویندوز یافت نمی‌شود.

**راه‌حل:**
1. **Auto-migration در Startup:**
   - هنگام load پروژه‌ها، اگر `!fs.existsSync(path)`:
     - پروژه mark شود `[missing]` با آیکون ⚠ (نه حذف).
     - در Sidebar با رنگ قرمز نمایش + دکمه «Locate» و «Remove».
2. **Locate Dialog:**
   - کلیک «Locate» → `dialog.showOpenDialog` با `properties: ['openDirectory']`.
   - کاربر پوشه جدید را انتخاب می‌کند.
   - مسیر در DB آپدیت می‌شود.
3. **Path Normalization:**
   - در همه جا `path.normalize()` + `path.resolve()`.
   - اگر path با `/` شروع شده و OS ویندوز است، هشدار بده.
4. **Auto-search در Workspace (اگر VPS متصل):**
   - اگر پروژه `[missing]` و VPS متصل است، دکمه «Search on VPS» → `find / -type d -name "<project-name>" 2>/dev/null`.
   - اگر پیدا شد، به عنوان remote workspace set کن.

**تست:** `test/main/path-migration.test.ts`

---

### 🔴 تسک ۲: VPS Filesystem Discovery (Codex-like)

**هدف:** وقتی VPS وصل است، AI بتواند فایل‌سیستم VPS را ببیند و پروژه پیدا کند.

**راه‌حل:**
1. **دستورات جدید در RemoteShellTool:**
   - `vps:list-dirs {path}` → لیست پوشه‌ها (با `find -maxdepth 2 -type d`).
   - `vps:search-project {name}` → جستجوی پروژه.
   - `vps:read-file {path}` → خواندن فایل.
   - `vps:git-status {path}` → وضعیت Git.
2. **Auto-discovery در Chat:**
   - وقتی کاربر می‌گوید «پروژه X را روی VPS پیدا کن»، Agent:
     - `find / -maxdepth 4 -type d -name "X" 2>/dev/null`
     - نتایج را نشان می‌دهد.
     - کاربر انتخاب می‌کند.
3. **VPS Workspace Mode:**
   - در Workspace Switcher، گزینه «Add Remote Workspace».
   - کاربر VPS + path را انتخاب می‌کند.
   - پروژه روی VPS به لیست پروژه‌ها اضافه می‌شود.
4. **پیشنهاد AI در Chat:**
   - اگر VPS متصل است و لیست پروژه‌های محلی خالی است، AI بگوید: «روی VPS پروژه‌ها را بگردم؟»

**تست:** mock VPS + سناریوهای discovery.

---

### 🔴 تسک ۳: Chats → Projects (چند مکالمه زیر یک پروژه)

**مشکل:** هر چت جدا است، کاربر نمی‌تواند چند چت را به یک پروژه وصل کند.

**راه‌حل:**
1. **ساختار داده جدید:**
   ```
   Project {
     id, name, path, type: 'local' | 'remote',
     vpsId?: string, createdAt
   }
   Chat {
     id, title, projectId?, createdAt, messages[]
   }
   ```
2. **Sidebar جدید:**
   ```
   ┌─────────────────────────┐
   │ + New Chat              │
   ├─────────────────────────┤
   │ ▼ Project: my-server      │
   │   • Chat 1 (2h ago)     │
   │   • Chat 2 (yesterday)  │
   │   + New chat in project │
   ├─────────────────────────┤
   │ ▼ No Project            │
   │   • Chat 3 (Today)      │
   └─────────────────────────┘
   ```
3. **Actions:**
   - Drag chat → به پروژه بکش.
   - Context menu: `Move to Project ▸`.
   - «+ New chat in project» → چت جدید با workspace پروژه.
4. **Share Context:**
   - چت‌های زیر یک پروژه، **workspace مشترک** دارند.
   - تاریخچه چت‌ها جدا ولی فایل‌ها مشترک.
5. **UI در Chat Header:**
   - نمایش نام پروژه (کلیک → drop-down سوییچ پروژه).

**تست:** CRUD chat with project + drag & drop.

---

### 🔴 تسک ۴: GitHub OAuth ساده و شفاف

**مشکل:** کاربر گیج می‌شود. فقط یک فیلد Client ID دارد.

**راه‌حل:**
1. **دو حالت در Settings → GitHub:**
   - **حالت ۱ (پیش‌فرض): «Connect with GitHub»**
     - دکمه بزرگ بنفش.
     - Device Flow شروع می‌شود.
     - کد ۸ رقمی نمایش داده می‌شود + دکمه «Copy».
     - به‌طور خودکار `github.com/login/device` در مرورگر باز می‌شود.
     - Polling تا تأیید.
     - وقتی موفق شد: ✅ + avatar + username.
   - **حالت ۲ (پیشرفته): «Use your own OAuth App»**
     - توضیح گام‌به‌گام با لینک مستقیم:
       `https://github.com/settings/applications/new`
     - فیلد Client ID.
     - راهنما: «Enable Device Flow» را حتماً تیک بزن.
2. **Embed OAuth App پیش‌فرض:**
   - یک Client ID پیش‌فرض در اپ embed کن (تو باید یک OAuth App بسازی).
   - تا کاربر نیازی به ساخت نداشته باشد.
   - **نکته امنیتی:** Device Flow نیازی به Client Secret ندارد → safe.
3. **راهنمای تصویری:**
   - یک modal با اسکرین‌شات‌های GitHub.
4. **Onboarding گام GitHub:**
   - اسلاید جدید: «GitHub Integration» با تصویر.

**تست:** mock Device Flow + UI snapshot.

---

### 🟠 تسک ۵: رفع کامل RTL

**مشکل:** فارسی راست‌چین نیست، جهت قاطی می‌شود.

**راه‌حل:**
1. **Root element:**
   ```html
   <html dir="rtl" lang="fa">
   ```
   وقتی locale=fa.
2. **Logical Properties:**
   - `margin-inline-start` بجای `margin-left`.
   - `padding-inline` بجای `padding-left/right`.
   - `inset-inline-start` بجای `left`.
3. **Chat bubbles:**
   - User message در RTL: از راست.
   - Assistant message در RTL: از راست با تفاوت رنگ.
4. **Code blocks:**
   - **همیشه LTR** (حتی در حالت فارسی):
     ```css
     code, pre { direction: ltr; text-align: left; unicode-bidi: embed; }
     ```
5. **متن دوزبانه:**
   - اگر پیام ترکیبی فارسی + انگلیسی است، `unicode-bidi: plaintext`.
6. **Font:**
   - فونت Vazirmatn برای فارسی، Inter برای انگلیسی.
   - `font-family: 'Inter', 'Vazirmatn', sans-serif;` + fallback.
7. **Icons در RTL:**
   - فلش‌ها برعکس شوند (مثلاً `→` بشود `←`).
8. **Scrollbar در RTL:** از چپ.
9. **تست بصری:** screenshot test در دو حالت.

**تست:** Playwright screenshot در fa و en.

---

### 🟠 تسک ۶: حافظه پایدارتر (Memory Fix)

**مشکل:** AI سریع فراموش می‌کند.

**راه‌حل:**
1. **System Prompt تقویت:**
   - در ابتدای هر session، context کامل از:
     - Workspace فعلی + فایل‌های کلیدی.
     - خلاصه چت‌های قبلی (summarized).
     - تصمیمات مهم پروژه.
2. **Project Memory File:**
   - هر پروژه یک `AI_CONTEXT.md` دارد.
   - Agent بعد از هر تعامل مهم، آن را آپدیت می‌کند.
   - در ابتدای هر چت جدید، این فایل خوانده می‌شود.
3. **Session Summary:**
   - وقتی context > ۷۰٪، یک خلاصه تولید کن.
   - خلاصه در ابتدای context بعدی تزریق شود.
4. **Codebase Indexing:**
   - یک index سبک از فایل‌های پروژه.
   - `grep` سریع برای جستجو.
   - Agent می‌تواند بگوید «فایل X را نشان بده» بدون خواندن کل context.
5. **Persistent Notes:**
   - Agent می‌تواند `notes.md` بسازد در workspace.
   - بین sessionها باقی می‌ماند.
6. **Token Budget:**
   - نمایش دقیق‌تر مصرف توکن.
   - هشدار قبل از پر شدن.

**تست:** سناریوی طولانی — AI بعد از ۲۰ پیام باید هنوز موضوع اصلی را بداند.

---

### 🟠 تسک ۷: کاتالوگ کامل DeepSeek + مدل‌های جدید

**مشکل:** فقط `deepseek-chat (V3)` هست.

**راه‌حل:**
1. **DeepSeek:**
   - `deepseek-chat` (V3) — general purpose
   - `deepseek-reasoner` (R1) — reasoning (توجه: خطای reasoning_content را هندل کن)
   - `deepseek-coder` (اگر endpoint دارد)
2. **کاتالوگ کامل (به‌روز):**
   - **OpenAI:** gpt-4o, gpt-4o-mini, gpt-4.1, gpt-4.1-mini, o1, o1-mini, o3-mini
   - **Anthropic:** claude-4-opus, claude-4-sonnet, claude-3.7-sonnet, claude-3.5-haiku
   - **Google:** gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash, gemini-2.0-flash-thinking
   - **DeepSeek:** deepseek-chat, deepseek-reasoner
   - **xAI:** grok-3, grok-3-mini
   - **Mistral:** mistral-large-2, codestral
   - **Meta (via Together/Groq):** llama-3.3-70b, llama-3.1-405b
   - **Qwen:** qwen-2.5-coder-32b, qwen-2.5-72b
   - **Cohere:** command-r-plus
3. **تگ‌ها:**
   - `reasoning`, `coding`, `fast`, `cheap`, `vision`, `multimodal`
4. **Auto-detect capability:** از API capability endpoint استفاده کن (اگر موجود).

**تست:** snapshot از dropdown + تحقق وجود همه idها.

---

### 🟡 تسک ۸: Codex-Like Features (ارتقا)

**هدف:** اپ به سطح واقعی Codex برسد.

**۸.۱ Inline Diff در Chat:**
- وقتی Agent فایل را ویرایش می‌کند، diff داخل پیام assistant نمایش داده شود.
- دکمه «Apply» و «Reject».

**۸.۲ File Tree Sidebar (در Project View):**
- کنار Chat، یک فایل‌اکسپلورر درختی.
- کلیک روی فایل → در Preview پنل باز شود.

**۸.۳ Terminal در Chat (نه فقط VpsPanel):**
- زیر Chat، یک terminal کوچک.
- اگر VPS متصل، روی VPS اجرا شود؛ وگرنه local sandbox.

**۸.۴ Slash Commands:**
- `/help`, `/clear`, `/compact`, `/file <path>`, `/run <cmd>`, `/vps <id>`, `/model <name>`.

**۸.۵ Codebase Search:**
- Ctrl+Shift+F → جستجو در کل پروژه.
- نتایج با context.

**۸.۶ Multi-file Edit:**
- Agent می‌تواند چند فایل را همزمان ویرایش کند.
- UI یک list از تغییرات نشان دهد.

**۸.۷ Plan Mode:**
- کاربر می‌تواند بگوید «plan بده» → Agent بدون اجرا، فقط برنامه می‌دهد.
- دکمه «Execute Plan».

**۸.۸ Approval Workflow:**
- هر دستور خطرناک (write, delete) نیاز به تأیید.
- Settings: `Auto-approve safe commands`.

**۸.۹ Session Restore:**
- اگر اپ crash کرد، session بعدی از آخرین checkpoint ادامه دهد.

**۸.۱۰ Keyboard-first:**
- Ctrl+P → Command palette
- Ctrl+Shift+P → All commands
- Ctrl+K → New chat
- Ctrl+L → Clear chat
- Ctrl+/ → Show shortcuts

---

## 🧪 تست‌های الزامی

### Unit
- path migration
- project/chat CRUD
- RTL rendering
- memory context

### Integration
- VPS discovery end-to-end
- GitHub Device Flow (mock)
- Chats → Project move
- Long conversation (۲۰+ پیام) با memory persistence

### Visual
- Screenshot fa + en
- Screenshot RTL + LTR
- Screenshot Codex-like UI

---

## 📦 تحویل نهایی

- typecheck + test + build پاس
- نسخه `2.1.0` → `2.2.0`
- CHANGELOG + README + AGENTS.md
- pre-release v2.2.0 + installer
- FINAL_REPORT_v2.2.md
- TESTING_GUIDE_v2.2.md

## 🚦 Git
- Branch: `feature/v2.2-codex-features`
- کامیت per تسک
- merge `--no-ff` در پایان

## 🎬 شروع
1. AGENTS.md را بخوان.
2. پلان دقیق بده (۳ خط per تسک).
3. بدون توقف اجرا کن.
4. در انتها گزارش بده.
