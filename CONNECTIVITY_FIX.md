# 1) Diagnosis

- **תהליך/פורט אחר**: שרת אחר (Flask ישן, Node, nginx) מאזין על 1000. ה-Flask שמדפיס url_map רץ בתהליך אחר או לא מגיע אליו הבקשה.
- **Host mismatch**: Frontend ב-WSL/VM/Docker — `localhost` שם מצביע על המכונה הווירטואלית, לא על המכונה שרצה Flask.
- **Reverse proxy**: nginx או proxy אחר על 1000 מחזיר 404 ל־`/api/health` כי לא מגדיר אותו.
- **אין הדפסת 404 בלוג**: אם מקבלים 404 בדפדפן אבל לא מופיע `[404] Not found: GET /api/health` ב-Flask — הבקשה לא מגיעה ל-Flask.

---

# 2) Verification Steps

```powershell
# A) מי מאזין על 1000? (Windows)
netstat -ano | findstr :1000

# B) curl ישיר מאותה מכונה
curl -v http://127.0.0.1:1000/api/health

# C) בדיקת PID — אחרי ההרצה, Flask יודפס:
#    [hotel_dashboard] PID=12345 PORT=1000 — אם curl מחזיר pid זהה = אותו תהליך
```

**Expected**:
- A: `LISTENING` עם PID — להשוואה עם PID של `python app.py`
- B: `{"ok":true}` + status 200
- C: ה-PID בדפדפן זהה ל-PID בתהליך Python

---

# 3) Patches

## Backend (app.py)

### א) הדפסת PID+PORT בהפעלה + health מחזיר pid
### ב) /health (ללא api) כ־fallback

```diff
--- a/app.py
+++ b/app.py
@@ -374,6 +374,11 @@ app = Flask(
     template_folder=_template_dir,                       # index.html
 )

+@app.get("/health")
+@app.get("/api/health")
+def health():
+    return {"ok": True, "pid": os.getpid()}
+
 # ── Session & Cookie config ──────────────────────────────────────────────────
@@ -12640,6 +12645,7 @@ if __name__ == "__main__":
     port = int(os.environ.get("PORT", 1000))
+    print(f"[hotel_dashboard] PID={os.getpid()} PORT={port}", flush=True)
     print(f"[hotel_dashboard] 🚀 Listening on http://0.0.0.0:{port} (use http://localhost:{port} for fetch)")
```

(Applied.)

## Frontend (apiClient.js + .env.example)

### apiClient.js — מקור אמת מ־ENV + fallback חכם

```diff
--- a/src/utils/apiClient.js
+++ b/src/utils/apiClient.js
@@ -12,9 +12,22 @@ const PRODUCTION_URL = 'https://easyhost.onrender.com';
 // Backend: http://127.0.0.1:1000 (localhost also works) — REACT_APP_API_URL in .env override
 const LOCAL_URL      = 'http://127.0.0.1:1000';
 
-const _hostname    = typeof window !== 'undefined' ? window.location.hostname : '';
+const _hostname    = typeof window !== 'undefined' ? window.location.hostname : '';
 const _isLocalhost = _hostname === 'localhost' || _hostname === '127.0.0.1';
 const _isRender    = _hostname.endsWith('.onrender.com');
 
+// When frontend on LAN/WSL/VM/phone: API = same host as frontend, port 1000
+const _lanApiUrl   = typeof window !== 'undefined' && _hostname && !_isLocalhost
+  ? `http://${_hostname}:1000` : null;
+
 // REACT_APP_API_URL is baked in at build time by Create React App from .env
 const _envUrl = (() => {
@@ -28,8 +41,9 @@ const _envUrl = (() => {
 })();
 
 export const API_URL = (() => {
-  if (_isRender)    return PRODUCTION_URL;   // always prod when on Render
-  if (_envUrl)      return _envUrl;          // .env override (local dev)
-  if (_isLocalhost) return LOCAL_URL;        // localhost safety net
+  if (_isRender)    return PRODUCTION_URL;   // Render → prod
+  if (_envUrl)      return _envUrl;          // .env override (single source of truth)
+  if (_lanApiUrl)   return _lanApiUrl;       // LAN/WSL/VM/phone: same host:1000
+  if (_isLocalhost) return LOCAL_URL;        // localhost → 127.0.0.1:1000
   return PRODUCTION_URL;                     // unknown host → prod
 })();
```

### .env.example (אם חסר — הוסף)

```
REACT_APP_API_URL=http://127.0.0.1:1000
```

---

# 4) Run Instructions

```powershell
# 1. Kill any process on 1000
netstat -ano | findstr :1000
# taskkill /PID <pid> /F   # if needed

# 2. Backend
cd c:\Users\user\Desktop\hotel_ai_assistant\hotel_dashboard
python app.py

# 3. In another terminal — Frontend (.env.local optional)
echo REACT_APP_API_URL=http://127.0.0.1:1000 > .env.local
npm start

# 4. Verify
curl http://127.0.0.1:1000/api/health
# → {"ok":true,"pid":12345}
```
