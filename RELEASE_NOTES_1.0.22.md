# iOS 1.0.22 (24): first-use registration and update policy

## Problem and behavior

The 1.0.20 App Review change hid signup and blocked /signup, /setup and /join on iOS, including the provisioning helper. New App Store users therefore had no account creation path; password recovery cannot create an account.

This hotfix restores the complete registration and invitation routes, lets users choose their own password, verifies their email and calls the existing authenticated, idempotent start_self_service_trial RPC. The existing seven-day trial, server authorization, tenant isolation and native purchase restrictions remain in place. Password recovery explains how an unregistered user can create an account without exposing whether an address is registered.

The source package and Xcode project are prepared as 1.0.22, build 24. Android native version numbers are unchanged.

## Required updates

NativeUpdateGate checks public iOS release metadata outside the auth provider and router. It can block login, registration and authenticated screens. The policy is iOS-only and validates the App Store destination and minimum semantic version. Checks run at startup, every minute, on visibility/focus/online and on manual retry. A failed initial request does not block access; a previously received requirement survives a transient network failure during the same app session.

Apply only `supabase/migrations/20261029090000_public_ios_release_policy.sql` after reviewing the schema. Do not run a bulk database push: this repository contains historical migrations. The new table contains release metadata only, is readable anonymously, restricts writes to super administrators and starts DISABLED. No live database changes have been made by this implementation.

After the desired minimum version is approved and actually downloadable in the target storefront, set its verified apps.apple.com URL and enable the iOS row. Never enable a minimum version that users cannot yet download. Disable the row to roll back enforcement.

**Compatibility limit:** existing 1.0.20/21 installations do not contain this anonymous gate and cannot be forced to update from their login screen by this migration. Their old AppUpdateNotifier runs only after authentication and does not filter platforms; a global forced app_updates row could also block Windows/Android. No such row is created. The new gate supports mandatory updates once a user has installed 1.0.22 or later.

## Validation completed

- TypeScript project compilation and changed-source ESLint passed.
- Vite production bundle compiled with a local test backend configuration; this is NOT a production IPA.
- Capacitor iOS synchronization passed. The generated web assets are ignored by Git; Codemagic rebuilds them with its production environment group.
- 8 targeted Chromium tests with the Capacitor iOS bridge and iPhone viewport passed.
- 12 targeted desktop and mobile-web tests passed.
- Tests intercept all external requests, use synthetic users and do not send emails or create live businesses.
- Native iOS compilation/signing, a real iPhone, actual email delivery and the live database policy have NOT been validated here.

## Build and App Review handoff

1. Codemagic: branch `fix/ios-signup-required-update`, workflow `perdepro-ios` (PerdePRO iOS imzali IPA), using the existing `perdepro_env` production configuration. Build version must be 1.0.22 (24).
2. Test the signed build on a real iPhone: signup, email verification, return to app, trial dashboard, existing-account login and password recovery. Validate the live self-service RPC/configuration. Re-test invitation acceptance.
3. The previous submission explicitly removed business registration for App Review. Disclose the restored registration and seven-day trial in the new submission; do not claim that Apple has approved this new flow. Keep native purchase links disabled.
4. Apple guideline 5.1.1(v) requires in-app account deletion when account creation is offered. No end-user account deletion implementation was found in the reviewed source. This is an outstanding submission prerequisite, not a feature implemented by this hotfix; verify/implement it before claiming review readiness. App Review approval is not guaranteed.
5. Select the signed build in a new 1.0.22 App Store Connect version, provide accurate review notes and request expedited review for the first-use blocker after submission.
6. Only activate any compatible mandatory-update policy once the target release is available. First-update instructions for existing anonymous users remain necessary because of the compatibility limit above.

Suggested review explanation (verify against the final signed build):
"This update fixes a first-use account access blocker. A new user can choose Create account, enter their business name, email and a password, verify their email and return to the app. Password recovery remains available for existing accounts. The app offers a seven-day trial without payment-card collection or automatic charges. No external payment links have been added. Please review the restored registration flow and its trial behavior."
