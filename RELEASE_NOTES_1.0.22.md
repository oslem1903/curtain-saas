# iOS 1.0.22 (25): first-use registration and update policy

## Problem and behavior

The 1.0.20 App Review change hid signup and blocked /signup, /setup and /join on iOS, including the provisioning helper. New App Store users therefore had no account creation path; password recovery cannot create an account.

This hotfix restores the complete registration and invitation routes, lets users choose their own password, verifies their email and calls the existing authenticated, idempotent start_self_service_trial RPC. The existing seven-day trial, server authorization, tenant isolation and native purchase restrictions remain in place. Password recovery explains how an unregistered user can create an account without exposing whether an address is registered.

The source package and Xcode project are prepared as 1.0.22, build 25. Android native version numbers are unchanged.

## Required updates

NativeUpdateGate checks public iOS release metadata outside the auth provider and router. It can block login, registration and authenticated screens. The policy is iOS-only and validates the App Store destination and minimum semantic version. Checks run at startup, every minute, on visibility/focus/online and on manual retry. A failed initial request does not block access; a previously received requirement survives a transient network failure during the same app session.

Apply only `supabase/migrations/20261029090000_public_ios_release_policy.sql` after reviewing the schema. Do not run a bulk database push: this repository contains historical migrations. The new table contains release metadata only, is readable anonymously, restricts writes to super administrators and starts DISABLED. No live database changes have been made by this implementation.

After the desired minimum version is approved and actually downloadable in the target storefront, set its verified apps.apple.com URL and enable the iOS row. Never enable a minimum version that users cannot yet download. Disable the row to roll back enforcement.

**Compatibility limit:** existing 1.0.20/21 installations do not contain this anonymous gate and cannot be forced to update from their login screen by this migration. Their old AppUpdateNotifier runs only after authentication and does not filter platforms; a global forced app_updates row could also block Windows/Android. No such row is created. The new gate supports mandatory updates once a user has installed 1.0.22 or later.

## Validation completed

- TypeScript project compilation and changed-source ESLint passed.
- Vite production bundle compiled with a local test backend configuration; this is NOT a production IPA.
- Capacitor iOS synchronization passed. The generated web assets are ignored by Git; Codemagic rebuilds them with its production environment group.
- Follow-up validation: 28 targeted desktop/mobile/iOS-bridge browser tests passed (2 iOS-only cases correctly skipped on other platforms).
- One browser flow exercised the exact synthetic HTTP fixture used by the native workflow, including menu navigation and the erasure receipt.
- 18 isolated PostgreSQL/PGlite account-deletion security and completion checks passed.
- Tests intercept all external requests, use synthetic users and do not send emails or create live businesses.
- Native iOS compilation/signing, a real iPhone, actual email delivery and the live database policy have NOT been validated here.

## Build and App Review handoff

1. Codemagic: branch `fix/ios-signup-required-update`, workflow `perdepro-ios` (PerdePRO iOS imzali IPA), using the existing `perdepro_env` production configuration. Build version must be 1.0.22 (25).
2. Test the signed build on a real iPhone: signup, email verification, return to app, trial dashboard, existing-account login and password recovery. Validate the live self-service RPC/configuration. Re-test invitation acceptance.
3. The previous submission explicitly removed business registration for App Review. Disclose the restored registration and seven-day trial in the new submission; do not claim that Apple has approved this new flow. Keep native purchase links disabled.
4. Adds in-app permanent erasure initiation, a seven-day manual processing deadline, a super-admin queue and receipt tracking after Auth deletion. Apply the dedicated account-deletion migration and establish the operator process in ACCOUNT_DELETION_OPERATIONS.md. It is not automatic erasure: the operator must actually delete the account and associated personal data. Verify live installation before submission. App Review approval is not guaranteed.
5. Select the signed build in a new 1.0.22 App Store Connect version, provide accurate review notes and request expedited review for the first-use blocker after submission.
6. Only activate any compatible mandatory-update policy once the target release is available. First-update instructions for existing anonymous users remain necessary because of the compatibility limit above.

Suggested review explanation (verify against the final signed build):
"This update fixes a first-use account access blocker. A new user can choose Create account, enter their business name, email and a password, verify their email and return to the app. Password recovery remains available for existing accounts. The app offers a seven-day trial without payment-card collection or automatic charges. No external payment links have been added. Please review the restored registration flow and its trial behavior."

## Build 25 follow-up

Adds permanent erasure initiation from settings/setup/locked screens and public receipt tracking. Completion refuses while Auth/profile/membership/storage ownership still exists, then removes identity fields from the request. Shared companies are not automatically deleted. Requires the dedicated database migration and documented manual operation. The new unsigned ios-account-flow-smoke workflow uses synthetic loopback data and sends no live email. Already-uploaded build 24 lacks this follow-up; replace it with build 25 after validation.

## Native smoke failure diagnosis (October 29)

Codemagic run 6ae306b5206ce93970c729c0 compiled the simulator app, opened signup and entered all four fields. Its commands.json and screenshot show the first hideKeyboard command failing before the signup request; later steps did not run. Replaced both hideKeyboard calls with safe heading taps. AuthShell blurs a focused form field on background/heading pointer taps while leaving controls/labels intact, and ignores delayed scroll requests for fields no longer focused. Seven targeted desktop/mobile/iOS-bridge browser checks passed (two non-iOS fixture cases skipped); these include background focus dismissal, label activation and the synthetic HTTP signup-to-erasure flow. TypeScript and AuthShell ESLint passed. Native success still requires another Codemagic run; no production auth/email success is inferred from this failure.

## Second native smoke failure diagnosis (October 29)

Codemagic run 6ae3118b206ce93970c72d29 passed registration, simulated verification and the dashboard. After opening Settings, Maestro matched a stale offscreen sidebar link named Hesabımı sil instead of scrolling to the Settings button. The captured hierarchy places that link at [0,686][80,704] while the screenshot still shows the top of Settings. The sidebar previously used a transform alone, leaving its descendants exposed to iOS accessibility. Closed mobile sidebars now also use visibility:hidden; desktop lg:visible behavior is preserved. The Settings button also has a distinct accessible name (Kalıcı hesap silme ekranını aç) used by the native test. Regression checks require the closed sidebar to be hidden and its duplicate link absent before tapping the actual Settings control. Seven targeted desktop/mobile/iOS-bridge browser checks passed (two non-iOS fixture cases skipped), including closed/open sidebar accessibility, desktop navigation, and the HTTP signup-to-erasure flow. TypeScript, Settings ESLint and Vite compilation passed. A native rerun remains necessary.
