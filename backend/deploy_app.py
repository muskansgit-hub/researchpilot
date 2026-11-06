"""Optional password gate for a public ResearchPilot demo.

Run with:  uvicorn deploy_app:app --app-dir backend --host 0.0.0.0 --port 8000

* APP_PASSWORD unset  -> behaves exactly like app.main:app (open to everyone).
* APP_PASSWORD set    -> every request needs HTTP Basic auth. Any username works;
                         the password must match. /api/health stays open so the
                         hosting platform can run health checks.
"""
import base64
import hmac
import os

from app.main import app as _inner_app

_BODY = b"Password required."


class BasicAuthGate:
    def __init__(self, app, password: str):
        self.app = app
        self.password = password.encode()

    async def __call__(self, scope, receive, send):
        # Lifespan events (startup/shutdown) must reach the real app untouched.
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if scope["path"] == "/api/health" and scope["method"] == "GET":
            return await self.app(scope, receive, send)

        supplied = b""
        header = dict(scope["headers"]).get(b"authorization", b"")
        if header[:6].lower() == b"basic ":
            try:
                supplied = base64.b64decode(header[6:]).split(b":", 1)[1]
            except Exception:
                supplied = b""
        if hmac.compare_digest(supplied, self.password):
            return await self.app(scope, receive, send)

        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"www-authenticate", b'Basic realm="ResearchPilot demo"'),
                (b"content-type", b"text/plain; charset=utf-8"),
                (b"content-length", str(len(_BODY)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": _BODY})


_password = os.getenv("APP_PASSWORD", "")
app = BasicAuthGate(_inner_app, _password) if _password else _inner_app
