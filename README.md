# Extraction Comparator

KG Extraction Comparator — Manual DOCX vs LLM CSV with a real PostgreSQL database.

## Project structure

```
extraction-comparator/
├── src/
│   ├── server/
│   │   ├── index.js          # Express entry point
│   │   ├── db.js             # PostgreSQL connection pool
│   │   └── routes/
│   │       └── results.js    # REST API for saved results
│   └── client/
│       ├── index.html        # Frontend shell
│       ├── css/
│       │   └── style.css     # All styles
│       └── js/
│           ├── api.js        # fetch() wrappers (replaces localStorage)
│           ├── parse.js      # DOCX + CSV parsing (browser-side)
│           ├── compare.js    # Triple-matching + metrics
│           ├── render.js     # DOM update helpers
│           └── app.js        # Main controller / event wiring
├── scripts/
│   └── init-db.js            # One-time table creation script
├── render.yaml               # Render Blueprint (web service + Postgres)
├── .env.example              # Environment variable template
├── .gitignore
└── package.json
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/results` | List all saved results |
| POST | `/api/results` | Save a new result |
| DELETE | `/api/results/:id` | Delete one result |
| DELETE | `/api/results` | Clear all results |
| GET | `/health` | DB health check |

## Local development

### Prerequisites
- Node.js ≥ 18
- PostgreSQL running locally

### Setup

```bash
# 1. Clone and install
git clone <your-repo-url>
cd extraction-comparator
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL to your local Postgres

# 3. Create the database table
npm run db:init

# 4. Start the dev server (auto-restarts on changes)
npm run dev
```

Open http://localhost:3000

## Deploy to Render

### Option A — Blueprint (one click)
1. Push the repo to GitHub.
2. In Render Dashboard → **New → Blueprint** → connect your repo.
3. Render reads `render.yaml` and creates:
   - A **Web Service** running the Node server
   - A **PostgreSQL** database (free tier, 90-day limit)
4. After deploy, open the Render Shell for your web service and run:
   ```
   npm run db:init
   ```
   This creates the `prompt_results` table.

### Option B — Manual
1. Create a **PostgreSQL** instance in Render → copy the **Internal Connection String**.
2. Create a **Web Service**:
   - Build command: `npm install`
   - Start command: `npm start`
   - Add env var `DATABASE_URL` = the connection string from step 1
3. Run `npm run db:init` from the Render Shell.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (auto-set by Render Blueprint) |
| `NODE_ENV` | optional | Set to `production` on Render |
| `PORT` | optional | Default `3000`; Render sets this automatically |
