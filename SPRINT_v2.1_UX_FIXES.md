# 🎯 SPRINT v2.1 — UX Overhaul & Bug Fixes


## 🧠 نقش تو
تو یک ایجنت ارشد طراحی و مهندسی نرم‌افزار هستی.
هدف: رفع مشکلات UX و باگ‌های v2.0.0 و بازطراحی UI بر اساس الگوی Codex.


## ⛔ قانون طلایی — بدون توقف
تو مجاز نیستی برای ابهام توقف کنی. تمام تصمیم‌ها در این سند گرفته شده.
اگر موقعیتی پوشش داده نشده: محافظه‌کارانه‌ترین انتخاب، ثبت در AGENTS.md با `[AUTO-DECISION]`، ادامه.
تنها استثنائات: بودجه > $30، ۱۰ خطای متوالی، خطای امنیتی.


---


## 🎨 جهت طراحی — الهام از Codex


### صفحه اصلی (Main Layout)
```
┌────────────────────────────────────────────────────────────┐
│ [☰] [Logo] AI Desktop    [Workspace ▾] [Model ▾]  [⚙] [─□×]│  ← Custom Titlebar
├──────────┬─────────────────────────────────────────────────┤
│          │                                                  │
│ Sidebar  │              Main Content                        │
│          │                                                  │
│ + New    │  ┌────────────────────────────────────────────┐ │
│ Chat     │  │                                            │ │
│          │  │                                            │ │
│ ▸ Today  │  │              Chat / Welcome                │ │
│   • Chat1│  │                                            │ │
│   • Chat2│  │                                            │ │
│          │  │                                            │ │
│ ▸ Week   │  └────────────────────────────────────────────┘ │
│   • Chat3│                                                  │
│          │  ┌────────────────────────────────────────────┐ │
│ ▸ Projects│ │  Message input...              [📎] [↑]   │ │
│   • proj1│  └────────────────────────────────────────────┘ │
│          │                                                  │
│ [👤 User]│                                                  │
└──────────┴─────────────────────────────────────────────────┘
```


### رنگ‌ها (Dark Theme مثل Codex)
- Background: `#0d0d0d`
- Sidebar: `#171717`
- Card: `#1f1f1f`
- Border: `#2a2a2a`
- Text: `#ececec`
- Text muted: `#8e8e8e`
- Accent: `#7c3aed` (بنفش ملایم)
- Success: `#10b981`
- Danger: `#ef4444`


### تایپوگرافی
- Font: `Inter` + `Vazirmatn` (برای فارسی)
- سایز: ۱۴px base، ۱۳px برای chat، ۱۲px برای metadata


### انیمیشن‌ها
- Hover: ۱۵۰ms ease
- Modal: ۲۰۰ms
- Sidebar collapse: ۲۵۰ms


---


## 📋 تسک‌های Sprint v2.1


### 🔴 اولویت ۱ — باگ‌های حیاتی


#### تسک ۱.۱: رفع خطای `files:list: ENOENT`
**مشکل:** مسیر `/opt/demo-project` (Linux) در ویندوز ذخیره شده و scandir شکست می‌خورد.


**راه‌حل:**
1. در `src/main/store/projects.ts`: قبل از ذخیره project، `path.normalize()` و `path.isAbsolute()` چک شود.
2. در `src/main/fs/list.ts`: قبل از scandir، اگر `!fs.existsSync(path)` → خطای واضح با کد `PATH_NOT_FOUND` برگردان (نه crash).
3. در UI: اگر پروژه‌ای مسیرش نامعتبر است، در Sidebar با آیکون ⚠ و متن «مسیر یافت نشد» نشان بده + دکمه «Remove» و «Locate».
4. Migration: هنگام load پروژه‌های قدیمی، اگر مسیر روی این OS وجود ندارد، به‌طور خودکار حذف نکن؛ فقط mark کن.


**تست:** `test/main/fs-invalid-path.test.ts` — اطمینان از عدم crash.


#### تسک ۱.۲: رفع نبود `remote_shell` در Chat اصلی
**مشکل:** وقتی کاربر در Chat می‌گوید «به VPS وصل شو»، AI می‌گوید sandbox network disabled.


**راه‌حل:**
1. در `src/core/agent-orchestrator.ts`: tool `remote_shell` به‌صورت خودکار در context تزریق شود وقتی:
   - حداقل یک VPS در `vps.list` وجود دارد، **یا**
   - پیام کاربر شامل کلمات کلیدی مثل `vps`, `server`, `ssh`, `remote` است.
2. System prompt Agent: اضافه کن که «تو به tool `remote_shell` دسترسی داری اگر VPS متصل باشد».
3. اگر VPS متصل نیست ولی کاربر درخواست VPS کرد، Agent باید بگوید: «ابتدا در Settings یک VPS اضافه کن» (نه اینکه مستقیم refuse کند).


**تست:** mock VPS + پیام «به VPS وصل شو» → باید `remote_shell` را در available tools ببیند.


#### تسک ۱.۳: Window Controls استاندارد
**مشکل:** titlebar خراب، close/min/max رفتار نادرست.


**راه‌حل:**
1. `BrowserWindow` را با `frame: false` بساز و یک titlebar سفارشی در React بساز.
2. در titlebar سه دکمه:
   - **Minimize:** `win.minimize()`
   - **Maximize/Restore:** `win.isMaximized() ? win.unmaximize() : win.maximize()`
   - **Close:** `win.close()`
3. Drag region: `-webkit-app-region: drag` روی titlebar، `-webkit-app-region: no-drag` روی دکمه‌ها.
4. پشتیبانی از double-click روی titlebar → maximize toggle.
5. آیکون‌ها: `lucide-react` (Minus، Square، X).
6. رنگ دکمه Close در hover: قرمز (#e81123 مثل ویندوز).


**تست:** دستی — open/min/max/close/double-click/drag.


#### تسک ۱.۴: رفع به‌هم‌ریختگی زبان‌ها
**مشکل:** UI گاهی فارسی، گاهی انگلیسی، inconsistent.


**راه‌حل:**
1. سیستم i18n اضافه کن: `src/renderer/i18n/`.
2. دو locale: `en.json`, `fa.json`.
3. کتابخانه: `i18next` + `react-i18next` (اضافه کردن dependency مجاز است).
4. تمام متن‌های hardcoded در UI به `t('key')` تبدیل شوند.
5. Detection خودکار بر اساس `navigator.language`، با امکان override در Settings.
6. Direction خودکار: `dir="rtl"` وقتی locale=fa، `dir="ltr"` وقتی en.
7. در Settings: dropdown «Language / زبان».


**تست:** snapshot test برای هر locale.


---


### 🟠 اولویت ۲ — بازطراحی UI


#### تسک ۲.۱: Sidebar با Chat History
**الزامات:**
1. Sidebar قابل collapse (عرض ۲۶۰px پیش‌فرض، ۶۰px وقتی collapse).
2. سه بخش:
   - **Header:** دکمه «+ New Chat» بزرگ.
   - **Chats:** گروه‌بندی Today / Yesterday / This Week / Older.
   - **Bottom:** دکمه Settings + User avatar.
3. هر Chat item: عنوان (اولین پیام کاربر)، timestamp نسبی، منوی context (Rename، Delete، Export).
4. جستجوی Chats: یک input بالای لیست.
5. ذخیره‌سازی: `~/.ai-desktop/chats/{chatId}.json` (شامل پیام‌ها، workspace، مدل، VPS).
6. `ChatStore` در Zustand: `list()`, `load(id)`, `create()`, `delete(id)`, `rename(id, title)`.


**تست:** CRUD chat + گروه‌بندی زمانی.


#### تسک ۲.۲: Workspace Switcher در Titlebar
**الزامات:**
1. Dropdown در titlebar (کنار Logo) با نام workspace فعلی.
2. لیست workspaceها + دکمه «+ Open Folder».
3. هنگام سوییچ، Chat فعلی بسته نمی‌شود؛ فقط workspace context عوض می‌شود.
4. هر Chat می‌تواند workspace مخصوص خودش داشته باشد.
5. نمایش path کنار نام (با truncate).


**تست:** switch + persistence.


#### تسک ۲.۳: VPS Selector در Chat
**الزامات:**
1. در header Chat (کنار Model dropdown)، یک dropdown `VPS: [None ▾]`.
2. اگر VPS انتخاب شود، تمام tool callهای `remote_shell` روی آن اجرا می‌شوند.
3. اگر VPS انتخاب نشود، `remote_shell` در available tools نیست.
4. اگر VPS انتخاب شده ولی disconnect است، هشدار قرمز + دکمه «Reconnect».
5. آیکون VPS کنار پیام‌های assistant که از remote_shell استفاده کرده‌اند.


**تست:** انتخاب VPS + اجرای tool.


#### تسک ۲.۴: بازطراحی Chat Box (مثل Codex)
**الزامات:**
1. Input بزرگ، border-radius ۱۲px، با focus state واضح.
2. دکمه ارسال (↑) فقط وقتی متن موجود است فعال.
3. `Shift+Enter` = خط جدید، `Enter` = ارسال.
4. دکمه 📎 برای attach فایل (drag & drop هم پشتیبانی شود).
5. نمایش token count زیر input (اختیاری، در Settings قابل خاموش کردن).
6. در حال streaming، دکمه ارسال به «Stop» (■) تغییر می‌کند.
7. Auto-resize: حداکثر ۲۰۰px ارتفاع، سپس scroll.
8. Placeholder: «Ask anything or give a task... / بپرس یا وظیفه بده...».


**تست:** keyboard shortcuts + streaming state.


#### تسک ۲.۵: بازطراحی Settings
**الزامات:**
1. دو ستونی: Sidebar چپ (دسته‌ها)، محتوای راست.
2. دسته‌ها: General, Providers, Custom Providers, GitHub, VPS, Projects, Advanced.
3. حذف checkboxها و عناصر اضافی (طبق بازخورد).
4. هر Provider کارت جداگانه با:
   - Logo + Name
   - وضعیت (active / no key)
   - API key input (با show/hide toggle)
   - Model selector (از کاتالوگ)
   - دکمه «Set active» + «Test connection»
5. GitHub section:
   - **اگر Client ID تنظیم نشده:** توضیح گام‌به‌گام + لینک به GitHub docs برای ساخت OAuth App + دکمه «Advanced: Enter Client ID manually».
   - **اگر Device Flow آماده:** فقط یک دکمه «Connect GitHub» → کد ۸ رقمی نمایش → open browser خودکار.
   - **بهتر:** OAuth App پیش‌فرض embed شود تا کاربر نیازی به Client ID نداشته باشد.


**تست:** screenshot test + interaction.


---


### 🟡 اولویت ۳ — Polish


#### تسک ۳.۱: Onboarding دوباره (به‌روز)
- اسلاید ۶ اضافه: «VPS & Remote» (چون v2.0 اضافه شد).
- اسلاید GitHub به‌روز شود.


#### تسک ۳.۲: Toast Notifications
- موفقیت: سبز، ۳ ثانیه.
- خطا: قرمز، ۵ ثانیه + دکمه dismiss.
- Warning: زرد.


#### تسک ۳.۳: Empty States
- Chat خالی: تصویر + «شروع کن با یک سلام!»
- Sidebar خالی: «هنوز چتی نداری. + New Chat»
- VPS خالی: «VPS اضافه کن تا از راه دور کار کنی»


#### تسک ۳.۴: Keyboard Shortcuts
- `Ctrl+N`: New Chat
- `Ctrl+,`: Settings
- `Ctrl+K`: Command palette
- `Ctrl+B`: Toggle sidebar
- `Esc`: Close modal


#### تسک ۳.۵: Accessibility
- Focus visible روی همه interactive elements.
- ARIA labels.
- Color contrast ≥ 4.5:1.


---


## 🧪 تست‌های الزامی


### Unit Tests
- `test/renderer/i18n.test.ts`
- `test/renderer/chat-store.test.ts`
- `test/main/fs-invalid-path.test.ts`
- `test/core/vps-tool-injection.test.ts`


### Integration Tests
- Sidebar: create → list → rename → delete chat
- Workspace: switch + persistence
- VPS: select + execute remote_shell
- Settings: add custom provider + test connection


### Manual Test Plan
- `TESTING_GUIDE_v2.1.md` با اسکرین‌شات برای هر تغییر


---


## 📦 تحویل نهایی


1. تمام تسک‌ها با تست.
2. `typecheck` (node + web) پاس.
3. `npm test` پاس (بدون regression از ۳۸۴ تست قبلی).
4. `npm run build` پاس.
5. نسخه: `2.0.0` → `2.1.0`.
6. CHANGELOG + README + AGENTS.md به‌روز.
7. ساخت pre-release `v2.1.0` + installer جدید (Setup + Portable).
8. اسکرین‌شات‌های before/after در `docs/screenshots/v2.1/`.
9. گزارش نهایی با جدول: تسک | وضعیت | کامیت.


---


## 🚦 Git Strategy
- Branch: `feature/v2.1-ux-overhaul`
- یک کامیت per تسک با پیام Conventional Commits.
- در پایان: merge به master با `--no-ff`، tag `v2.1.0`، push، pre-release.


---


## 💰 مدیریت بودجه
- بعد از هر تسک، هزینه تخمینی در AGENTS.md.
- اگر > $25، حالت صرفه‌جو (context کمتر).
- اگر > $30، توقف.


---


## 🎬 شروع
1. `AGENTS.md` را بخوان.
2. یک پلان دقیق برای همه تسک‌ها بده.
3. بدون توقف، تسک‌ها را اجرا کن.
4. در انتها، گزارش کامل بده.


**یادآوری: توقف ممنوع، مگر ۳ استثنا.**
**موفق باش.**
