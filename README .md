# CivicVision AI

AI-powered civic issue reporting — citizens report a problem, it gets classified,
scored for urgency, and routed to the right city department. Includes a live
map and dashboard.

```
civicvision/
├── frontend/           static site — works with or without the backend
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── config.js       ← the ONE setting you edit per deployment
├── backend/             FastAPI service that calls the Anthropic API
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example    ← copy to .env, put your real key there
├── .gitignore
└── README.md
```

The frontend works standalone (offline, in-browser classifier) or talks to
the backend for real AI-based classification. Nothing breaks if you only
deploy the frontend.

---

## 1. Upload to GitHub

```bash
cd civicvision
git init
git add .
git commit -m "Initial commit — CivicVision AI"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

`.env` is already excluded by `.gitignore` — your API key will never be
committed as long as you don't rename or move it.

---

## 2. Run the frontend

No build step. Either:
- Open `frontend/index.html` directly in a browser, or
- Serve it locally so `fetch()` calls behave like production:
  ```bash
  cd frontend
  python3 -m http.server 5500
  ```
  then visit `http://localhost:5500`

To publish it for free with **GitHub Pages**: repo → Settings → Pages →
set source to the `frontend/` folder on the `main` branch.

---

## 3. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Create a key (you'll need billing set up to make live calls)
3. Copy it — you won't be able to see it again after leaving the page

**Never** put this key in `frontend/` files, `config.js`, or anywhere that
ships to the browser. It only ever lives in `backend/.env`.

---

## 4. Run the backend locally

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# open .env and paste your key: ANTHROPIC_API_KEY=sk-ant-...
uvicorn main:app --reload
```

Check it's alive: `http://localhost:8000/api/health` → `{"status":"ok","ai_enabled":true}`

If `ANTHROPIC_API_KEY` is left blank, `/api/analyze` still works — it falls
back to the same keyword-based classifier the frontend uses offline, so you
can develop and demo without spending API credits.

---

## 5. Connect the frontend to the backend

Open `frontend/config.js` and set:

```js
window.CIVICVISION_API_BASE = "http://localhost:8000";
```

That's the only wiring needed — `script.js` already calls
`POST {API_BASE}/api/analyze` and falls back to the offline classifier
automatically if the backend is unreachable.

---

## 6. Deploy the backend

Any Python host works. Free-tier options that fit this project size:

**Render**
1. New → Web Service → connect your GitHub repo, root directory `backend`
2. Build command: `pip install -r requirements.txt`
3. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables: `ANTHROPIC_API_KEY`, `ALLOWED_ORIGINS` (your
   GitHub Pages URL, e.g. `https://yourusername.github.io`)

**Railway**
1. New Project → Deploy from GitHub repo → set root directory to `backend`
2. Add the same environment variables in the Variables tab
3. Railway auto-detects the start command from `requirements.txt`; if it
   doesn't, set it manually to `uvicorn main:app --host 0.0.0.0 --port $PORT`

Once deployed, update `frontend/config.js` with the live backend URL and
redeploy/refresh the frontend (e.g. push to GitHub Pages again).

---

## Notes

- CORS is controlled by `ALLOWED_ORIGINS` in `backend/.env` — set it to your
  real frontend URL in production instead of `*`.
- The `/api/analyze` response shape is fixed (`type`, `score`, `severity`,
  `priority`, `explanation`, `location`) — the frontend's offline classifier
  and the backend's AI classifier both return this same shape, so you can
  switch between them any time without touching `script.js`.
