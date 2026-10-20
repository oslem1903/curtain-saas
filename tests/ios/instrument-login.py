"""Instrument only the disposable simulator checkout; never print credentials."""
from pathlib import Path
import sys

source = Path(sys.argv[1] if len(sys.argv) > 1 else "src/pages/Login.tsx")
text = source.read_text()
changes = [
    ('    const [loading, setLoading] = useState(false);', '''    const [_reviewPhase, _setReviewPhase] = useState(() => sessionStorage.getItem("perdepro-review-phase") || "idle");
    function _reviewSetPhase(phase: string) {
        sessionStorage.setItem("perdepro-review-phase", phase);
        _setReviewPhase(phase);
    }
    const [loading, setLoading] = useState(false);'''),
    ('        e.preventDefault();\n        if (loading) return;', '        e.preventDefault();\n        _reviewSetPhase("submit_received");\n        if (loading) return;'),
    ('        if (!cleanEmail || !password) {', '        if (!cleanEmail || !password) {\n            _reviewSetPhase("fields_missing");'),
    ('            const { data, error } = await withTimeout(', '            _reviewSetPhase("request_started");\n            const { data, error } = await withTimeout('),
    ('\n            if (data.session?.user) {', '\n            if (data.session?.user) {\n                _reviewSetPhase("session_ready");'),
    ('        } catch (loginError) {', '        } catch (loginError) {\n            _reviewSetPhase("request_failed");'),
    ('            <form onSubmit={handleLogin}', '            <form onKeyDown={(event) => { if (event.key === "Enter") _reviewSetPhase("enter_received"); }} onSubmit={handleLogin}'),
    ('                <button type="submit" aria-label=', '                <button type="submit" onClick={() => _reviewSetPhase("button_clicked")} aria-label='),
    ('            </form>', '''                <output aria-live="polite" className="block text-xs">
                    review-status: {email ? "email-ready" : "email-empty"} {password ? "password-ready" : "password-empty"} {_reviewPhase}
                </output>
            </form>'''),
]
for before, after in changes:
    if text.count(before) != 1:
        raise SystemExit("Simulator instrumentation anchor changed; refusing an uncertain edit")
    text = text.replace(before, after, 1)
source.write_text(text)
print("Disposable simulator login instrumentation prepared (fixed status words only)")
