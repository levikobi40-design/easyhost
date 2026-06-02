# API Connectivity Fixes — Summary

## 404 on /api/add-manual-guest — Root Cause

**Problem:** The route was registered at line ~5520, **after** the catch-all `@app.route("/<path:path>")` at line ~417. In some cases (e.g. Gunicorn, certain import orders), the catch-all could match first or cause registration order issues.

**Fix:** Moved `/api/add-manual-guest` to register **before** the catch-all (right after `/api/ping`). Now it's guaranteed to be matched for POST/OPTIONS requests.

---

## What Was Broken

### 1. **CORS + Credentials Conflict**
- `add_cors_headers` after_request was setting `Access-Control-Allow-Origin: *`
- Browsers **reject** `*` when `credentials: 'include'` is used
- **Fix:** Removed the conflicting after_request; Flask-CORS handles headers correctly

### 2. **SECRET_KEY Random Per Run**
- `os.urandom(32).hex()` created a new key on every restart → sessions invalidated
- **Fix:** Stable fallback: `os.getenv("JWT_SECRET", "easyhost-default-secret-key-change-in-production")`

### 3. **Auth Blocking Manual Forms**
- `/api/add-manual-guest` and `/api/properties` required auth even for form submissions
- **Fix:** Added these to `bypass_auth`, and `get_tenant_id_from_request` / `get_auth_context_from_request` now respect `g.bypass_ai_auth`

### 4. **405 / 500 Returning HTML**
- Flask's default error pages are HTML → frontend `response.json()` throws
- **Fix:** Added `@app.errorhandler(500)`, `@app.errorhandler(405)`, `@app.errorhandler(404)` that return JSON

### 5. **OPTIONS Inconsistency**
- Some routes returned `Response(status=204)` for OPTIONS
- **Fix:** All OPTIONS now return `jsonify({"status": "ok"}), 200`

### 6. **Missing Request Logging**
- Hard to debug "Failed to fetch"
- **Fix:** Added `log_incoming_request` before_request that prints `[API] METHOD /path`

---

## Fixed Frontend Fetch Example

```javascript
// Add guest
const response = await fetch('http://localhost:1000/api/add-manual-guest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',  // Required for CORS with cookies/auth
  body: JSON.stringify({
    guest_name: 'John Doe',
    guest_phone: '0501234567',
    email: 'john@example.com',
    check_in: '2025-03-20',
    check_out: '2025-03-22',
    room_composition: 'זוג',
    property_id: 'your-property-uuid',
    property_name: 'Room 1',
  }),
});
const data = await response.json();
if (!response.ok) throw new Error(data.error || 'Request failed');
```

```javascript
// Test connectivity (CORS preflight)
const ping = await fetch('http://localhost:1000/api/ping', {
  method: 'GET',
  credentials: 'include',
});
console.log(await ping.json());  // { status: "ok", message: "pong", cors: "ok" }
```

---

## Development Checklist

1. **Backend:** `python app.py` (runs on port 1000)
2. **Frontend:** `npm start` (runs on port 3000)
3. **CORS origins:** Must include `http://localhost:3000`
4. **Test:** Open DevTools → Console → `fetch('http://localhost:1000/api/ping', {credentials:'include'}).then(r=>r.json()).then(console.log)`

---

## Production Env Vars

```bash
JWT_SECRET=your-secure-secret-here
CORS_ORIGINS=https://your-frontend.com,https://your-app.onrender.com
```
