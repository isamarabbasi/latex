# Resume Optimizer

A browser-based tool that uses your OpenAI API key to tailor a LaTeX resume and cover letter to a job description, then pushes the result to **your own** Overleaf project and Google Doc.

Everything runs locally. The only network calls are to OpenAI, Overleaf, and Google — using **your own keys**, configured via a local `.env` file. No data is sent to anyone else.

## What you'll need

1. **Node.js** 18+ — https://nodejs.org
2. **Git** installed (Git Credential Manager on Windows is included by default)
3. **An OpenAI API key** — https://platform.openai.com/api-keys (entered in the browser, stored only in your browser's localStorage)
4. **A Google Cloud OAuth client** (free) — for writing your cover letter into a Google Doc
5. **An Overleaf account with a paid plan** that includes Git integration (Standard / Professional / Premium) — the free tier does NOT support Git. See https://www.overleaf.com/user/subscription/plans

## One-time setup

### 1. Clone and install

```bash
git clone https://github.com/DANISH062/latex.git resume-optimizer
cd resume-optimizer
npm install
cp .env.example .env
cp .overleaf-repo/sample.template.tex .overleaf-repo/sample.tex
```

The last line creates **your personal** `sample.tex` from the template. Edit `.overleaf-repo/sample.tex` to put in your own name, contact info, experience, education, and skills. This file is gitignored, so your edits stay on your machine and are never pushed back to this public repo.

If you want to include a profile photo on the resume, place it at `.overleaf-repo/pic/profile.png` (the whole `pic/` folder is gitignored) and uncomment the `\photoR{...}` line in `sample.tex`.

### 2. Set up Google OAuth (for cover letter -> Google Doc)

1. Go to https://console.cloud.google.com/apis/credentials
2. Create a new project (or pick an existing one).
3. Enable the **Google Docs API** for the project (APIs & Services -> Library -> Google Docs API -> Enable).
4. OAuth consent screen -> External -> fill in app name and your email -> add yourself as a test user.
5. Credentials -> Create Credentials -> **OAuth client ID** -> Application type **Web application**.
   - Authorized redirect URI: `http://localhost:3001/auth/callback`
6. Copy the **Client ID** and **Client secret** into your `.env` file:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

### 3. Set up the cover letter Google Doc

1. Create a Google Doc that will be your cover letter template (header, signature, formatting — whatever you want).
2. In the body of the doc, type the literal text `[COVER_LETTER_BODY]` where the generated cover letter should go.
3. Copy the doc ID from the URL — `docs.google.com/document/d/`**`<this part>`**`/edit` — into `.env`:
   ```
   GOOGLE_DOC_ID=...
   ```

### 4. Set up your Overleaf project + Git integration

> **Heads up:** Overleaf's Git integration is a **paid feature** (Overleaf Premium / Standard / Professional). The free tier won't work. Check at https://www.overleaf.com/user/subscription/plans

#### 4a. Create the project

1. Create a new Overleaf project (or open an existing one) with the LaTeX template you want as your resume.
2. Inside the project: **Menu** (top-left) -> under **Sync**, click **Git**.
3. Copy the Git URL shown — it looks like `https://git@git.overleaf.com/<project-id>`.
4. Paste it into `.env`:
   ```
   OVERLEAF_GIT_URL=https://git@git.overleaf.com/<project-id>
   ```

#### 4b. Generate a Git authentication token

Overleaf's Git endpoint does **not** accept your account password. You need a token:

1. Go to https://www.overleaf.com/user/settings
2. Scroll to **Git integration** (or **Git authentication tokens**) -> **Create token**.
3. Give it a name (e.g. "resume-optimizer") and copy the token — you'll only see it once.

#### 4c. Cache the token in Git (one-time)

The first time the server tries to clone/push, Git will prompt for credentials in a popup:

- **Username:** `git` (literally the word "git")
- **Password:** paste the token from step 4b

On Windows, Git Credential Manager will remember it automatically. To verify it works *before* running the server, open a terminal and try a manual clone:

```bash
git clone <your OVERLEAF_GIT_URL> /tmp/overleaf-test
```

If the clone succeeds, the credential is cached and the server will reuse it. If it fails, double-check that your Overleaf plan supports Git and that your token is valid.

#### How the tool uses this

When you click **Send to Overleaf** in the browser, the server writes your generated LaTeX to `.overleaf-repo/sample.tex`, commits it, and `git push`es to your Overleaf project — at which point your Overleaf editor shows the new resume.

### 5. Run

```bash
npm start
```

Then:

1. Open `index.html` in your browser (or serve it however you like).
2. Paste your **OpenAI API key** into the bar at the top — it's stored in your browser's localStorage only.
3. The first time you save a cover letter, the server will ask you to visit `http://localhost:3001/auth/google` to authorize Google Docs access. Do it once; the token is saved locally to `.google-token.json` (gitignored).

## How it stays private

| Secret | Where it lives | Sent where |
|---|---|---|
| OpenAI API key | Your browser's localStorage | OpenAI only (direct from browser) |
| Google OAuth client | Your `.env` (gitignored) | Google only |
| Google access token | `.google-token.json` (gitignored) | Google only |
| Overleaf Git creds | OS Git Credential Manager | Overleaf only |

The repo never ships any of these. `.gitignore` is set up to keep `.env`, `.google-token.json`, and `google-credentials.json` out of commits.

## Troubleshooting

- **"GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set"** — you missed step 2. Check `.env`.
- **"Placeholder [COVER_LETTER_BODY] not found"** — your Google Doc doesn't contain that exact text in the body. Add it back (only needed for the first save; afterwards a named range tracks the location).
- **Overleaf push hangs or fails auth** — open a terminal and try `git clone <your-OVERLEAF_GIT_URL>` manually so Git Credential Manager prompts and stores creds. Then restart the server.
- **"Authentication failed" on Overleaf** — make sure (1) you're on a paid Overleaf plan with Git integration, (2) you used the **Git token** as the password (not your account password), and (3) the username you entered was literally `git`. Tokens are managed at https://www.overleaf.com/user/settings under "Git integration".
- **Wrong cached Overleaf credentials** — on Windows, open Credential Manager (search "Credential Manager" in Start), find the entry for `git.overleaf.com`, and delete it. Then retry — Git will prompt again.
- **OAuth redirect URI mismatch** — the URI in your Google Cloud OAuth client must exactly match `GOOGLE_REDIRECT_URI` in `.env` (default `http://localhost:3001/auth/callback`).
