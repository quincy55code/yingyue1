# Task 6 Report: Tighten express.static Scope

**Date:** 2026-06-24
**Status:** DONE
**Commit SHA:** `f2679e0`

## What was done

1. **Replaced `express.static(__dirname)` with targeted mounts in `server.js`** (line 82):
   - `app.use('/public', express.static(path.join(__dirname, 'public')))` — serves `public/` assets including `public/images/tags/`
   - `app.use('/js', express.static(path.join(__dirname, 'js')))` — serves frontend JS modules
   - `app.use('/css', express.static(path.join(__dirname, 'css')))` — serves stylesheets
   - `app.get('/index.html', ...)` — explicit route for index.html
   - `app.get('/lyrics.html', ...)` — explicit route for lyrics popup
   - `app.get('/', ...)` — root serves index.html

2. **Restarted server and verified:**
   - `GET /` → HTTP 200 (serves index.html)
   - `GET /index.html` → HTTP 200
   - `GET /lyrics.html` → HTTP 200
   - `GET /js/player.js` → HTTP 200
   - `GET /css/style.css` → HTTP 200
   - `GET /public/images/tags/华语.jpg` (URL-encoded) → HTTP 200
   - `GET /.env` → HTTP 404 (previously exposed)
   - `GET /server.js` → HTTP 404 (previously exposed)

## Impact

- `.env`, `node_modules/`, `scripts/`, `server.js`, `sql/`, and all other project files are no longer accessible via the web server
- Only `public/`, `js/`, `css/`, `index.html`, and `lyrics.html` are served publicly
- No changes to API endpoints or application functionality
