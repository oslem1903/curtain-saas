#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.maestro/bin:$PATH"
if [ -f "$CM_BUILD_DIR/build/ios-authenticated-screenshots/iPhone/02-Panel.png" ]; then
  echo 'Normal simulator flow reached dashboard; no instrumented login needed.'
  exit 0
fi
# A known authentication error needs correction, not another login attempt.
if python3 - <<'PY'
from pathlib import Path
import json
p = Path('/tmp/perdepro-private-hierarchy.json')
try:
    ui = json.dumps(json.loads(p.read_text()), ensure_ascii=False)
except (OSError, ValueError):
    ui = ''
errors = ['E-posta veya şifre hatalı.', 'Sunucuya bağlanılamadı.', 'Çok fazla deneme yapıldı.']
raise SystemExit(0 if any(message in ui for message in errors) else 1)
PY
then
  echo 'Known authentication error detected; no automatic repeat attempted.'
  exit 1
fi
python3 tests/ios/instrument-login.py
npm run build > /tmp/perdepro-diagnostic-web-build.log 2>&1
npx cap sync ios > /tmp/perdepro-diagnostic-cap-sync.log 2>&1
xcodebuild build -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$CM_BUILD_DIR/build/ios-simulator" CODE_SIGNING_ALLOWED=NO > /tmp/perdepro-diagnostic-xcode.log 2>&1
SIM_ID=$(python3 - <<'PY'
import json, subprocess
data = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))
devices = [d for group in data['devices'].values() for d in group if d.get('isAvailable') and 'iPhone' in d['name']]
print(next((d for d in devices if '17 Pro Max' in d['name']), devices[0])['udid'])
PY
)
trap 'xcrun simctl shutdown "$SIM_ID" >/dev/null 2>&1 || true' EXIT
xcrun simctl boot "$SIM_ID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_ID" -b > /tmp/perdepro-diagnostic-boot.log 2>&1
xcrun simctl install "$SIM_ID" "$CM_BUILD_DIR/build/ios-simulator/Build/Products/Debug-iphonesimulator/App.app"
python3 - <<'PY'
from pathlib import Path
flow = Path('tests/ios/review-screenshots.yaml').read_text()
end = flow.index('- takeScreenshot: 02-Panel')
short = [line for line in flow[:end].splitlines() if not line.startswith('- takeScreenshot:')]
Path('/tmp/perdepro-login-diagnostic.yaml').write_text('\n'.join(short) + '\n')
PY
RESULT=0
maestro --device "$SIM_ID" test --test-output-dir /tmp/perdepro-diagnostic-private /tmp/perdepro-login-diagnostic.yaml > /tmp/perdepro-diagnostic-private.log 2>&1 || RESULT=$?
maestro --device "$SIM_ID" hierarchy > /tmp/perdepro-diagnostic-hierarchy.json 2>/dev/null || true
python3 - <<'PY'
from pathlib import Path
import json
try:
    ui = json.dumps(json.loads(Path('/tmp/perdepro-diagnostic-hierarchy.json').read_text()), ensure_ascii=False)
except (OSError, ValueError):
    ui = ''
for marker in ['review-status:', 'email-ready', 'email-empty', 'password-ready', 'password-empty', 'idle', 'enter_received', 'button_clicked', 'submit_received', 'fields_missing', 'request_started', 'request_failed', 'session_ready', 'Yönetici Paneli', 'E-posta veya şifre hatalı.', 'Sunucuya bağlanılamadı.', 'Allow Paste', 'Allow Access', 'Save Password']:
    if marker in ui:
        print('Safe simulator diagnosis:', marker)
PY
echo 'Instrumented login images and raw logs are private and are not artifacts.'
exit "$RESULT"
