#!/bin/bash
# Unsigned, synthetic simulator ONLY. Never publishes to Apple or touches a live backend.
set -euo pipefail
export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_CLI_NO_ANALYTICS=1
OUT="$CM_BUILD_DIR/build/ios-account-flow-smoke"
mkdir -p "$OUT"
SIM_ID=$(python3 - <<'PY'
import json, subprocess
available=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','available','--json']))
devices=[d for runtime, group in available['devices'].items() if 'iOS' in runtime for d in group if d.get('isAvailable') and 'iPhone' in d['name']]
if not devices: raise SystemExit('No iPhone simulator available')
print(next((d for d in devices if 'Pro Max' in d['name']),devices[0])['udid'])
PY
)
node tests/ios/account-flow-fixture.mjs > "$OUT/fixture.log" 2>&1 &
FIXTURE_PID=$!
trap 'kill "$FIXTURE_PID" >/dev/null 2>&1 || true; xcrun simctl shutdown "$SIM_ID" >/dev/null 2>&1 || true' EXIT
node --input-type=module - <<'JS'
for(let i=0;i<20;i++) {
  try { const r=await fetch('http://127.0.0.1:54329/__state'); if(r.ok)process.exit(0); } catch {}
  await new Promise(r=>setTimeout(r,500));
}
throw Error('Local fixture did not start');
JS
xcrun simctl boot "$SIM_ID" || true
xcrun simctl bootstatus "$SIM_ID" -b
xcrun simctl status_bar "$SIM_ID" override --time '9:41' --batteryState charged --batteryLevel 100
xcrun simctl install "$SIM_ID" "$CM_BUILD_DIR/build/ios-simulator/Build/Products/Debug-iphonesimulator/App.app"
RESULT=0
maestro --device "$SIM_ID" test --test-output-dir "$OUT/maestro" --debug-output "$OUT/maestro" tests/ios/account-flow-smoke.yaml > "$OUT/maestro.log" 2>&1 || RESULT=$?
if [ "$RESULT" -ne 0 ]; then
  echo 'FAIL: native synthetic UI flow; inspect artifacts.' | tee "$OUT/result.txt"
  xcrun simctl io "$SIM_ID" screenshot "$OUT/failure.png" || true
  exit "$RESULT"
fi
node --input-type=module - <<'JS' | tee "$OUT/result.txt"
import assert from 'node:assert/strict';
const s=await (await fetch('http://127.0.0.1:54329/__state')).json();
assert.equal(s.signups,1);assert.equal(s.companies,1);assert.ok(s.trialCalls>=1);assert.equal(s.deletionRequests,1);
console.log('PASS: native iOS signup, simulated verification, one trial company, and permanent deletion request receipt.');
console.log('Synthetic backend only. Does not validate production SMTP, real email delivery or live database deployment.');
JS
