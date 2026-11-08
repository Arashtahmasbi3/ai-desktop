# Staged i18n fixtures

These files are **test expectations**, not translations to be shipped. Each one lists the keys a feature needs, so a test
can ask "is every one of them present and translated in both shipped locales?" without the test needing the feature's
source to enumerate them.

They used to live at `_research/i18n/` — outside this repository — so a clean checkout had no files to read: five test
files failed, one could not even be imported, and `npm run typecheck` reported two missing JSON modules. The expectation
was fine; its location was the bug. A guard test (`test/ops/no-outside-imports.test.ts`) now fails the build if a file
under `test/` reaches outside the repository again.

The shipped truth remains `src/renderer/src/i18n/{en,fa}.json`. The tests compare against those files; these fixtures only
define the expected key set.
