# ATS Resume Builder — personal deploy (Gemini)

Upload/paste a resume + a job description -> ATS score, missing keywords,
and a tailored rewrite you can download as PDF (or .tex for LaTeX).

The AI calls go through `api/gemini.js`, a serverless proxy that holds your
Google Gemini API key **server-side** so it never reaches the browser.

## What you need
- A free GitHub account
- A free Vercel account (sign in with GitHub)
- A free Gemini API key from https://aistudio.google.com/apikey  (no credit card)
- Node.js installed (only if you want to run it locally)

## Get the Gemini key (1 minute)
1. Go to https://aistudio.google.com/apikey and sign in with Google.
2. Click "Create API key" -> copy it.
   No billing needed; the free tier works immediately.

## Deploy to Vercel (recommended) — ~10 minutes
1. Create a new GitHub repo and upload every file in this folder
   (keep the structure: `api/`, `src/`, and the root files).
2. Go to https://vercel.com -> "Add New... -> Project" -> import that repo.
3. Vercel auto-detects Vite. Leave build settings as-is.
4. Open "Environment Variables" and add:
       Name:  GEMINI_API_KEY
       Value: <your real key>
5. Click Deploy. You get a URL like https://your-app.vercel.app.

To update later: edit files, push to GitHub, Vercel redeploys automatically.

## Run locally instead (key stays on your machine)
1. `npm install`
2. `cp .env.local.example .env.local` and paste your real key into it.
3. `npm i -g vercel` then `vercel dev`
   (use `vercel dev`, NOT `npm run dev` — only `vercel dev` runs the
   /api/gemini function the AI features need.)
4. Open the localhost URL it prints.

## Model & limits
- Default model is `gemini-2.5-flash` (set once in src/App.jsx as GEMINI_MODEL).
  Free tier ~ 10 requests/min, 250/day — plenty for personal use.
- If rewrites ever come back empty or cut off, switch GEMINI_MODEL to
  `gemini-2.5-flash-lite` (1000/day) and redeploy.
- Verify current model names at https://ai.google.dev/gemini-api/docs/models

## Privacy
- On the FREE tier, Google may use your prompts/responses to improve its models.
  Your resume contains personal data — if that matters to you, use a paid tier
  (enable billing) or a different provider.
- Never commit your real key. `.env.local` is already in `.gitignore`.
