# ✅ چک‌لیست توسعه پایدار — AI Desktop


## 🎯 قبل از هر Sprint


### ۱. تعریف دقیق
- [ ] هدف Sprint در یک جمله نوشته شده
- [ ] معیار موفقیت قابل اندازه‌گیری است
- [ ] محدوده (scope) مشخص است
- [ ] خارج از محدوده (out of scope) مشخص است


### ۲. Backlog مرتب
- [ ] تسک‌ها اولویت‌بندی شده‌اند
- [ ] وابستگی‌ها شناسایی شده‌اند
- [ ] تخمین زمان هر تسک
- [ ] تعریف "Done" برای هر تسک


### ۳. محیط آماده
- [ ] branch جدید از master ساخته شده
- [ ] آخرین master pull شده
- [ ] تست‌های فعلی پاس می‌شوند
- [ ] checkpoint (commit) قبل از شروع


---


## 🛠️ در طول Sprint


### ۴. هر تسک
- [ ] کد نوشته شده
- [ ] حداقل ۳ تست واحد
- [ ] تست integration (اگر لازم)
- [ ] typecheck پاس
- [ ] build پاس
- [ ] یک commit جداگانه
- [ ] گزارش کوتاه


### ۵. کیفیت کد
- [ ] بدون `any` غیرضروری
- [ ] بدون `console.log` در production
- [ ] بدون کد تکراری
- [ ] نام‌گذاری واضح
- [ ] کامنت برای منطق پیچیده


### ۶. امنیت
- [ ] هیچ secret در کد نیست
- [ ] هیچ secret در log نیست
- [ ] ورودی‌ها validate می‌شوند
- [ ] خروجی‌ها escape می‌شوند
- [ ] Deny-list رعایت شده
- [ ] Approval در جای خود


### ۷. مستندسازی
- [ ] AGENTS.md به‌روز (الگوها، درس‌ها)
- [ ] CHANGELOG.md به‌روز
- [ ] README.md به‌روز (اگر UI تغییر کرد)
- [ ] TESTING_GUIDE به‌روز


---


## 🧪 بعد از Sprint


### ۸. تست کامل
- [ ] `npm run typecheck` (node + web)
- [ ] `npm test` (همه پاس)
- [ ] `npm run build`
- [ ] Smoke test (Linux + Xvfb)
- [ ] Manual test (ویندوز تمیز) — اگر ممکن
- [ ] Security test (سناریوهای خطرناک)


### ۹. بازبینی
- [ ] کد review شده (خودت یا تیم)
- [ ] تست‌ها معنی‌دار هستند (نه صرفاً `assert(true)`)
- [ ] بدون regression
- [ ] performance قابل قبول


### ۱۰. Git
- [ ] commit message طبق Conventional Commits
- [ ] branch push شده
- [ ] PR باز شده
- [ ] CI پاس شده (اگر وجود دارد)
- [ ] PR merge شده (بعد از تأیید)
- [ ] tag annotated زده شده
- [ ] tag push شده


### ۱۱. Release
- [ ] نسخه در package.json
- [ ] CHANGELOG section
- [ ] FINAL_REPORT_vX.Y.Z.md
- [ ] TESTING_GUIDE_vX.Y.Z.md
- [ ] build:win (روی ویندوز)
- [ ] SHA256SUMS
- [ ] GitHub Release (با assetها)


---


## 🚨 قوانین طلایی (هرگز نقض نشوند)


### قانون ۱: بدون skip
هیچ تسکی را بدون دلیل فنی skip نکن. اگر نمی‌شود، توقف کن و بپرس.


### قانون ۲: تست واقعی، نه ادعا
- AI نباید بگوید "حل شد" بدون health check
- هر fix باید تست داشته باشد
- هر تست باید سناریوی واقعی را پوشش دهد


### قانون ۳: بررسی قبل از تغییر
- قبل از هر تغییر، وضعیت فعلی را بگیر
- `git status`, `ls`, `cat` قبل از هر اقدام
- اگر ابزاری وجود ندارد، از ابزار جایگزین استفاده کن


### قانون ۴: Plan قبل از اجرا
- هر مجموعه tool call با یک plan شروع شود
- plan شامل: چه کاری، چه ابزاری، نتیجه مورد انتظار
- در mode=ask: منتظر تأیید کاربر


### قانون ۵: حداقل دسترسی
- AI فقط به مسیر پروژه دسترسی داشته باشد
- Deny-list همیشه فعال
- Approval برای عملیات خطرناک
- Secret masking در همه logها


### قانون ۶: جداسازی
- هر پروژه metadata مستقل
- هر پروژه SSH key جدا (اگر ممکن)
- هر پروژه Linux user جدا (اگر ممکن)
- Policy per-host


### قانون ۷: قابل بازگشت
- Git repo از روز اول
- Backup قبل از تغییرات خطرناک
- Checkpoint قبل از migration
- Rollback plan برای هر عملیات


### قانون ۸: شفافیت
- AI بگوید چه فایلی را می‌خواند
- AI بگوید چه تغییری می‌دهد
- AI نتیجه را نشان دهد
- Context قبل از ارسال نمایش داده شود


### قانون ۹: تشخیص خودکار
- قبل از هر عملیات، محیط را چک کن:
  - Git هست؟
  - Node/npm هست؟
  - Docker هست؟
  - Disk فضا دارد؟
  - Memory کافی است؟
- بر اساس نتیجه، استراتژی را انتخاب کن


### قانون ۱۰: گزارش صادقانه
- اگر تست fail شد، بگو
- اگر ابزاری نبود، بگو
- اگر بودجه تمام شد، بگو
- حدس نزن، سؤال بپرس


---


## 📊 معیارهای کیفیت


| معیار | حداقل |
|-------|-------|
| Test coverage | ۸۰٪ |
| Typecheck | 100% clean |
| Build | بدون warning |
| Security tests | همه پاس |
| Integration tests | همه پاس |
| Performance | < 200ms response |
| Memory | < 500MB |
| Bundle size | < 200MB |


---


## 🎯 فازهای آینده (v2.4 و بعد)


### v2.4 — تکمیل امنیت
- [ ] Job ID + systemd/tmux برای تسک‌های طولانی
- [ ] Docker image transfer (save/load)
- [ ] DB migration (pg_dump/mysqldump)
- [ ] Object storage transfer (S3/R2)
- [ ] Checksum verify در migrate
- [ ] Per-project Linux user (خودکار)
- [ ] Per-project SSH key (خودکار)
- [ ] Git worktree
- [ ] Prompt Agent برای ساخت پروژه (MVP-first)
- [ ] Enforcement "حل شد" بدون تست
- [ ] نمایش fingerprint قبل از تأیید (UX کامل)


### v2.5 — Enterprise
- [ ] Multi-user
- [ ] Role-based access control
- [ ] Audit log immutable
- [ ] SSO integration
- [ ] Team collaboration
- [ ] Cost tracking per project


### v3.0 — Distribution
- [ ] Code Signing (EV)
- [ ] Auto-update
- [ ] macOS version
- [ ] Linux version
- [ ] Marketplace
- [ ] Plugin system


---


## 🎬 گردش کار پیشنهادی هر Sprint


```
۱. تحلیل (۳۰ دقیقه)
   - بازبینی backlog
   - اولویت‌بندی
   - تعریف scope
   ↓
۲. Plan (۱۵ دقیقه)
   - نوشتن SPRINT_vX.Y.Z.md
   - تأیید کاربر
   ↓
۳. توسعه (متغیر)
   - هر تسک: کد → تست → commit
   - گزارش کوتاه بعد از هر تسک
   ↓
۴. تست کامل (۱ ساعت)
   - typecheck + test + build
   - Smoke test
   - Security test
   ↓
۵. بازبینی (۳۰ دقیقه)
   - بررسی کد
   - بررسی تست‌ها
   - بررسی مستندات
   ↓
۶. Release (۱ ساعت)
   - merge + tag
   - build:win
   - GitHub Release
   ↓
۷. بازخورد (متغیر)
   - تست کاربر
   - ثبت باگ‌ها
   - برنامه v بعدی
```


---


## 📌 چه چیزی از سند منبع هنوز مانده؟


### اولویت بالا (v2.4):
1. Job ID + systemd/tmux
2. DB migration
3. Docker image transfer
4. State check صریح قبل از تغییر
5. Enforcement "حل شد" بدون تست
6. Per-project Linux user و SSH key


### اولویت متوسط (v2.4/v2.5):
7. Git worktree
8. Prompt Agent برای scaffold
9. Object storage transfer
10. Checksum verify


### اولویت پایین (v2.5/v3.0):
11. Multi-task parallel
12. Agent روی VPS
13. Multi-user + RBAC
14. Code Signing + Auto-update
