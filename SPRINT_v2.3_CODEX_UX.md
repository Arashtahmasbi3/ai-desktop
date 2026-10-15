# 🎯 SPRINT v2.3 — Codex-Like UX & Approval System


## 🧠 نقش تو
ایجنت ارشد طراحی و مهندسی. هدف: بازطراحی UI/UX بر اساس Codex، رفع loop و بهبود approval system.


## ⛔ قانون طلایی
بدون توقف. تمام تصمیم‌ها اینجا گرفته شده. AUTO-DECISION در AGENTS.md.
استثنائات: بودجه > $50، ۱۰ خطای متوالی، خطای امنیتی.


---


# بخش A — رفع باگ‌های حیاتی (اولویت ۱)


## تسک A.1: Loop Detection & Prevention 🚨


**مشکل:** Agent در حلقه گیر می‌کند (remote_shell → sandbox_error → remote_shell → ...).


**راه‌حل:**
1. **LoopDetector** در `src/core/agent/loop-detector.ts`:
   - نگه‌داری hash از (toolName + args) در یک sliding window (۱۰ مورد اخیر).
   - اگر ۳ بار تکرار همان hash → **WARN**.
   - اگر ۵ بار تکرار → **STOP** با پیام واضح.
   - اگر ۳ tool call متوالی fail شد → **STOP**.
2. **Behavior on STOP:**
   - پیام در Chat: «⚠️ به نظر می‌رسد در حلقه گیر کرده‌ام. مشکل را بررسی می‌کنم.»
   - نمایش خلاصه اقدامات اخیر به کاربر.
   - پیشنهاد: «ادامه بده» / «تصحیح کن» / «توقف».
3. **Reasoning Loop:**
   - اگر Agent > ۲ بار بگوید «let me try X» بدون tool call جدید → STOP.
4. **Timeout:**
   - هر tool call حداکثر ۶۰ ثانیه (برای shell).
   - کل یک turn حداکثر ۵ دقیقه.
5. **تست:** `test/core/loop-detector.test.ts` با سناریوهای mock.


---


## تسک A.2: رفع Path Not Found


**مشکل:** پروژه با `/opt/...` نمایش داده می‌شود ولی روی ویندوز نیست.


**راه‌حل:**
1. **Auto-detect OS mismatch:**
   - اگر path با `/` شروع می‌شود و OS=Windows → بج این را flag کن.
2. **Migration Dialog در Startup:**
   - پروژه‌های missing → modal با لیست.
   - هر پروژه: [Locate on this PC] [Connect to VPS] [Remove]
3. **VPS Path Mapping:**
   - اگر VPS متصل است و پروژه روی VPS است، auto-map کن.
4. **Warning in Chat:**
   - اگر workspace active نیست، قبل از هر tool call هشدار بده.


---


# بخش B — Approval System بازطراحی‌شده (اولویت ۱)


## تسک B.1: Approval Dialog بهبودیافته


**UI جدید دیالوگ:**
```
┌─────────────────────────────────────────────────────┐
│  🛡️ Agent wants to run:                              │
│                                                      │
│  remote_shell                                        │
│  ┌────────────────────────────────────────────────┐ │
│  │ grep -rn "pattern" /opt/demo-project          │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  Working directory: /opt/demo-project               │
│  Server: Demo VPS (192.168.1.10)                  │
│                                                      │
│  ☐ Remember this command                            │
│  ☐ Remember all commands from this tool             │
│  ☐ Auto-approve for this session                    │
│                                                      │
│  [ Deny ] [ Deny & Explain ] [ Approve ] [Approve All]│
└─────────────────────────────────────────────────────┘
```


**الزامات:**
1. چهار دکمه:
   - **Deny**: رد کن، منتظر دستور جدید بمان.
   - **Deny & Explain**: رد کن + از Agent بپرس چرا این کار را می‌خواست.
   - **Approve**: فقط همین یک بار.
   - **Approve All**: تأیید همه دستورات مشابه در این session.
2. **Checkboxها**:
   - "Remember this command" → ذخیره در `approved-commands.json` برای همیشه.
   - "Remember all commands from this tool" → مثلاً همه `read_file`ها.
   - "Auto-approve for this session" → فقط این session.
3. **Command Preview:**
   - **Syntax highlighting** برای دستور.
   - **Warning** اگر دستور در deny-list است (اما کاربر override می‌کند).
   - نمایش **working directory** و **server**.
4. **Approval History:**
   - دکمه کوچک «History» → لیست تأییدهای اخیر.
   - امکان Revoke هر کدام.


**تست:** mock approval flow + snapshot test UI.


---


## تسک B.2: Full Access Toggle زیر Composer


**الگو از Codex:** Full access به‌صورت inline در input box، نه در Settings.


**UI:**
```
┌──────────────────────────────────────────────────────┐
│ 📎  Do anything                                       │
│     🔓 Full access  ▾                                 │
│                          GPT-4o ▾   🎤   ↑           │
└──────────────────────────────────────────────────────┘
```


**الزامات:**
1. **دکمه inline** کنار input (بالا چپ).
2. **سه حالت** با dropdown:
   - 🔒 **Ask** (پیش‌فرض): هر tool call تأیید می‌خواهد.
   - ⚡ **Auto-write**: فقط readها auto، writeها تأیید.
   - 🔓 **Full access**: همه auto (با هشدار).
3. **رنگ‌بندی**:
   - Ask: خاکستری
   - Auto-write: آبی
   - Full access: **نارنجی/قرمز** (مثل Codex).
4. **هشدار در Full access:**
   - وقتی فعال شد، یک banner قرمز بالای chat: «⚠️ Full access فعال است. Agent می‌تواند فایل‌ها را بدون تأیید تغییر دهد.»
   - دکمه «Disable» روی banner.
5. **Auto-disable**:
   - Full access بعد از ۳۰ دقیقه بی‌فعالیتی خودکار خاموش شود.
   - در هر session جدید، به Ask برگردد (مگر کاربر ذخیره کرده باشد).
6. **ذخیره:**
   - `settings.approvalMode`: `'ask' | 'auto-write' | 'full'`
   - `settings.rememberApprovalMode`: boolean
7. **StatusBar:**
   - نمایش mode فعلی در پایین: `🔓 Full access` یا `🔒 Ask`.


**تست:** UI + persistence + auto-disable.


---


## تسک B.3: Smart Approval (یادگیری)


**هدف:** Agent از تأییدهای قبلی یاد بگیرد.


**راه‌حل:**
1. **Pattern Detection:**
   - اگر کاربر ۳ بار `read_file` را تأیید کرد → پیشنهاد «همیشه تأیید کن read_fileها».
2. **Approved Commands DB:**
   - `~/.ai-desktop/approved-commands.json`:
     ```json
     {
       "always": ["read_file:*", "list_dir:*"],
       "tools": ["read_file", "list_dir"],
       "sessions": {...}
     }
     ```
3. **UI:**
   - در Settings → Advanced → «Approved Commands» با امکان revoke.
4. **Dangerous Override:**
   - دستورات در deny-list **هرگز** auto-approve نمی‌شوند حتی در Full access.
   - (مگر با تأیید صریح دو مرحله‌ای).


---


# بخش C — بازطراحی UI/UX بر اساس Codex (اولویت ۲)


## تسک C.1: Sidebar بازطراحی‌شده


**الگوی جدید:**
```
┌──────────────────────────────┐
│ [🏠] AI Desktop ▾            │  ← Workspace dropdown
│ 📝 New  🔔 Alerts  🔍 Search │
├──────────────────────────────┤
│ PROJECTS                     │
│ ● demoproject    (Demo VPS)│  ← نقطه سبز
│ ● demo-b       (Demo VPS)│
│ ⚠ my-server        (Path not found)│ ← قرمز
│ + New project                │
├──────────────────────────────┤
│ RECENTS                      │
│ 💬 وتور را بررسی...          │
│ 💬 استقرار تغییرات...        │
│ 💬 Implement GM-FIX01...     │
│ ...                          │
├──────────────────────────────┤
│ 📁 Workspaces                │
│ 🔌 Plugins                   │
│ ⚙ Settings                   │
├──────────────────────────────┤
│ 👤 Arash Tahmasby            │
└──────────────────────────────┘
```


**الزامات:**
1. **Projects section** با:
   - **آیکون وضعیت**: 🟢 connected, 🔴 disconnected, ⚠ missing
   - **نام VPS** کنار پروژه در پرانتز (اگر remote)
   - **Hover actions**: `⋯` (rename, remove, locate)
   - **Click** → switch project context
2. **Recents section**:
   - لیست chatها (بدون گروه‌بندی زمانی، مثل Codex).
   - Title + آیکون 💬.
   - **Hover**: `⋯` menu (Rename, Delete, Archive, Duplicate, Export).
3. **Bottom navigation**:
   - Workspaces, Plugins, Settings.
   - User avatar.
4. **Search**:
   - `Ctrl+K` → command palette (chat search).
   - فیلتر زنده.


**تست:** snapshot + interaction test.


---


## تسک C.2: Input Box بازطراحی


**الگو:**
```
┌────────────────────────────────────────────────┐
│ 📎  Do anything                                 │
│     🔓 Full access ▾                            │
│                     GPT-4o ▾ 🎤  ⏸/↑          │
└────────────────────────────────────────────────┘
```


**الزامات:**
1. **Placeholder**: «Do anything» (نه «Ask anything»).
2. **Attachment** (+ یا 📎) سمت چپ.
3. **Full access toggle** زیر placeholder، inline (تسک B.2).
4. **Model dropdown** سمت راست با نام توصیفی:
   - نمایش: `GPT-4o`, `Claude 4 Sonnet`, `DeepSeek Chat (V3)`.
   - hover → tooltip با capabilities (`reasoning`, `coding`, `vision`).
5. **Mic icon** (اگر پشتیبانی voice).
6. **Send/Stop**:
   - وقتی streaming: دکمه Stop (■) به‌جای Send.
   - وقتی empty: خاکستری.
   - وقتی متن دارد: آبی.
7. **Auto-resize**: حداکثر ۲۰۰px.
8. **Keyboard**:
   - `Enter` → ارسال.
   - `Shift+Enter` → خط جدید.
   - `Ctrl+Enter` → ارسال (برای فارسی‌نویس‌ها).


---


## تسک C.3: نمایش File Changes در Chat


**الگو (از Codex):**
```
📄 /opt/demo-project/.qa-commerce-ux-03-lZziYu/seed.sql   +54 -0
📄 src/orders/orders.service.ts                            +114 -15
📄 src/orders/orders.service.spec.ts                       +61 -0
Show 20 more files ⌄
```


**الزامات:**
1. **FileChangeCard** جدید در پیام assistant:
   - مسیر فایل (با `...` اگر طولانی).
   - **آمار diff**: `+N -M` با رنگ سبز/قرمز.
   - **آیکون نوع** (ts, sql, md و...).
2. **"Show N more files"** → expand.
3. **کلیک** روی هر فایل → diff view در split panel.
4. **دکمه‌های global**:
   - **Apply All** (با تأیید).
   - **Reject All**.
   - **Review individually** → open split view.
5. **Integrated با Approval System:**
   - اگر mode = Ask، ابتدا approval.
   - اگر Auto-write، فایل‌ها ذخیره می‌شوند ولی diff نمایش داده می‌شود.
   - اگر Full access، همه auto.


---


## تسک C.4: صفحه Empty State


**الگو (از Codex):**
```
              ☁️
    What should we work on in demoproject?
    
    [input box]
```


**الزامات:**
1. **آیکون بزرگ** (Cloud یا Logo) بالای صفحه.
2. **متن خوش‌آمد** با نام پروژه فعال.
3. **پیشنهادهای سریع** زیر:
   - «Browse files in this project»
   - «Run tests»
   - «Explain this codebase»
   - «Fix last commit»
4. **Input box** پایین (center-aligned).


---


## تسک C.5: Settings بازطراحی (مثل Codex)


**Sidebar Settings جدید (دسته‌بندی مثل Codex):**
```
┌───────────────────────────┐
│ General                   │
│                           │
│ INTEGRATIONS              │
│   🔌 Providers            │  ← OpenAI, Anthropic, ...
│   🧩 Plugins              │  ← External tools (GitHub, etc.)
│   🔑 API Keys             │
│   🌐 Browser              │  ← Website permissions
│                           │
│ CODING                    │
│   📁 Projects             │
│   🖥️ Connections          │  ← VPS/SSH
│   🔍 Code Review          │  ← per-repo config
│   ⚡ Approval Mode        │
│                           │
│ ADVANCED                  │
│   🧠 Memory               │
│   📊 Usage                │
│   🔧 Developer            │
└───────────────────────────┘
```


**الزامات:**
1. **دو ستونی** (sidebar + content).
2. **دسته‌بندی جدید** (مثل Codex).
3. **Connections Page**:
   - Tabs: Control this PC / Control other devices / SSH.
   - کارت هر سرور با toggle + status + actions.
4. **Code Review Page**:
   - لیست repos از GitHub.
   - Per-repo auto-review config.
5. **Plugins Page**:
   - Tabs: Plugins / Apps / MCPs.
   - Toggle + Search + Browse directory.
6. **Browser Page**:
   - Website permissions.
   - Default: «Always ask».


---


# بخش D — قابلیت‌های Codex پیشرفته (اولویت ۳)


## تسک D.1: Chat Templates


**هدف:** شروع سریع با قالب‌های آماده.


**الگو:**
- در صفحه Empty، دکمه «Templates» → dropdown.
- قالب‌ها:
  - «Review this PR»
  - «Explain this file»
  - «Write tests for X»
  - «Refactor X»
  - «Fix this bug»
  - «Optimize performance»


**ذخیره:** کاربر می‌تواند template جدید بسازد.


## تسک D.2: Code Block Runner


**هدف:** اجرای کد block داخل chat با یک کلیک.


**الزامات:**
- هر ` ```bash ` یا ` ```python ` block → دکمه «Run» کنار.
- اجرا در local sandbox یا VPS (بسته به context).
- نمایش output زیر block.


## تسک D.3: Session Fork


**هدف:** از یک نقطه در chat، دو مسیر مختلف امتحان کن.


**الزامات:**
- روی هر پیام: منوی `⋯` → «Fork from here».
- یک chat جدید از همان نقطه ساخته می‌شود.
- Link بین دو chat.


## تسک D.4: Voice Input


**الزامات:**
- دکمه Mic در input box.
- از Web Speech API یا Whisper API.
- تبدیل صوت به متن، سپس ارسال.


## تسک D.5: Multi-window Support


**الزامات:**
- `Ctrl+Shift+N` → پنجره جدید Electron.
- هر پنجره می‌تواند chat جداگانه داشته باشد.
- Shared state برای auth و settings.


## تسک D.6: Progress Timeline


**هدف:** نمایش گام‌های agent به‌صورت بصری.


**الگو:**
```
✅ Planned
✅ Read 3 files
🔄 Editing orders.service.ts
⏳ Next: Run tests
```


**الزامات:**
- Vertical timeline در کنار chat.
- Animated progress.
- Collapsible.


---


# 🧪 تست‌های الزامی


## Unit Tests
- Loop detection (۵ سناریو)
- Approval flow (Ask / Auto-write / Full)
- File change capture
- Approval persistence


## Integration Tests
- End-to-end: chat → tool → approval → apply
- Full access toggle → auto-approve
- Loop scenario → stop + recovery
- Settings navigation


## Visual Tests
- Screenshot: sidebar, input box, chat, settings, approval dialog
- RTL mode
- Dark/Light theme


---


# 📦 تحویل نهایی


- [ ] typecheck پاس
- [ ] همه تست‌ها پاس (بدون regression)
- [ ] build پاس
- [ ] نسخه: `2.2.0` → `2.3.0`
- [ ] CHANGELOG + README + AGENTS.md
- [ ] `TESTING_GUIDE_v2.3.md`
- [ ] `FINAL_REPORT_v2.3.md`
- [ ] Pre-release v2.3.0 + installer
- [ ] اسکرین‌شات before/after در `docs/screenshots/v2.3/`


---


# 🚦 Git Strategy


- Branch: `feature/v2.3-codex-ux`
- یک commit per تسک
- در پایان: merge `--no-ff` به master، tag v2.3.0، pre-release


---


# 🎬 شروع


1. AGENTS.md را بخوان.
2. **اول** تسک‌های A (Loop detection + Path fix) را انجام بده — چون حیاتی هستند.
3. بعد B (Approval) — چون UX است.
4. بعد C (UI) — چون بزرگ است.
5. بعد D (پیشرفته) — اگر بودجه اجازه داد.
6. بدون توقف، مگر ۳ استثنا.
7. در پایان گزارش بده.


**موفق باش.**
