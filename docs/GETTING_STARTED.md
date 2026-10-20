# ArchiTrac: Getting Started Guide

This guide takes you from an empty computer to the first working version of ArchiTrac (Release 0) running on your machine and on the internet. Do the parts in order. Each step says what to do, how to check it worked, and why it matters.

**What you'll use:** Visual Studio Code (the editor), Claude Code (the AI that writes the code, running inside VS Code), Git and GitHub (save points and backup), Node.js and pnpm (run the app), Neon (database), Clerk (logins), Vercel (hosting).

**Time:** Parts 1–3 take an afternoon. Release 0 (Part 4) takes about 3–4 weeks part-time.

> **Visual Studio vs. VS Code.** Use **Visual Studio Code** (VS Code), the free, lightweight editor. "Visual Studio" (the big purple one) is built for Microsoft's .NET languages and is the wrong tool for a Next.js app. If you already have Visual Studio installed, leave it; install VS Code alongside it.

---

## Part 1 — Install the tools (one time, ~1 hour)

### 1. Install VS Code
Download from **code.visualstudio.com** and install with default options. On Windows, tick "Add to PATH" and "Open with Code" when offered.
- **Check:** open VS Code; you see a Welcome tab.
- **Why:** this is where you'll read files, run commands, and talk to Claude Code.

### 2. Install Git
- **Mac:** open Terminal and type `git --version`. If it isn't installed, macOS offers to install the developer tools; accept.
- **Windows:** download from **git-scm.com** and accept the defaults.
- **Check:** in VS Code, open the terminal (**View → Terminal**), type `git --version` and press Enter. You should see a version number.
- **Why:** Git takes "save points" (commits) of the whole project, so any mistake can be undone.

Tell Git who you are (once):
```
git config --global user.name "Blake Middleton"
git config --global user.email "blake@themiddletongroup.net"
```

### 3. Install Node.js
Download the **LTS** version from **nodejs.org** and install it.
- **Check:** in the terminal, `node --version` shows v22 or newer (any current LTS is fine).
- **Why:** Node runs the app's code on your computer.

### 4. Turn on pnpm
In the terminal:
```
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version
```
- **Why:** pnpm downloads the code libraries the app depends on. (Corepack ships with Node, so there's nothing extra to download.)
- **If you get a permissions error on Windows:** close VS Code, reopen it with right-click → *Run as administrator*, run the two corepack lines, then reopen normally.

### 5. Install Claude Code in VS Code
1. In VS Code, open the **Extensions** panel (the four-squares icon on the left, or Ctrl/Cmd+Shift+X).
2. Search for **Claude Code** and install the one published by **Anthropic**.
3. Click the Claude icon that appears, and sign in with your Claude account.
- **Check:** type `hello` in the Claude panel and get a reply.
- **Why:** this is your builder. It reads the project's files, writes code, and runs commands, asking your permission first.

### 6. Helpful VS Code extensions (optional but recommended)
Install from the Extensions panel: **ESLint**, **Prettier**, **Tailwind CSS IntelliSense**, **GitLens**. They highlight mistakes and make code easier to read.

---

## Part 2 — Create your accounts (~45 minutes)

Use your work email for all of these. All have free tiers that cover Release 0.

| Service | Website | What it's for | When you need it |
|---|---|---|---|
| GitHub | github.com | Stores the code online; history and backup | Now |
| Neon | neon.tech | The PostgreSQL database | Milestone 0.2 |
| Clerk | clerk.com | Sign-in, users, firms | Milestone 0.3 |
| Vercel | vercel.com | Puts the app on the internet (sign up *with GitHub*) | Milestone 0.7 |
| Sentry | sentry.io | Error alerts | Milestone 0.7 |

You only need to sign up now. Claude Code will tell you exactly what to click in each one when you reach that milestone.

**Turn on two-factor sign-in for GitHub, Neon, Clerk and Vercel.** These accounts hold your code and data.

---

## Part 3 — Set up the project folder (~20 minutes)

### 7. Unzip the starter kit
Make a folder for code that is **not** inside OneDrive, Dropbox or iCloud (sync tools fight with the thousands of small files a project creates). For example:
- Mac: `~/Code/architrac`
- Windows: `C:\Code\architrac`

Unzip **architrac-starter.zip** into it, so `CLAUDE.md` sits directly inside `architrac`.

### 8. Open it in VS Code
**File → Open Folder…** → choose `architrac`. If VS Code asks whether you trust the authors, choose **Yes**.
- **Check:** the left sidebar shows `CLAUDE.md`, `docs`, `mockup`, `seed`, `src`.

### 9. Look around before building
Spend 15 minutes here; it will save hours later.
1. Open `docs/ROADMAP.md`. Right-click the tab → **Open Preview** to read it formatted. (This works for any `.md` file.)
2. Open `CLAUDE.md`. These are the rules Claude Code follows every session.
3. Open the mockup canvas in your browser: **https://claude.ai/artifact/F7g4PL5cpRbcxRK9RRKggs**. Keep it open in a tab while you build. The files in `mockup/` are the same pages in source form. They're there for Claude Code to read, and they won't display properly if you double-click them.

### 10. Make the first save point
In the VS Code terminal:
```
git init
git add .
git commit -m "Starter kit: docs, specs, mockup, seed data"
```
- **Why:** you now have a clean starting point you can always return to.

### 11. Put it on GitHub
1. On github.com click **New repository**, name it `architrac`, set it to **Private**, and **don't** add a README (you already have one).
2. GitHub shows commands under "…or push an existing repository". Copy and run them in the terminal. They look like:
```
git remote add origin https://github.com/YOUR-NAME/architrac.git
git branch -M main
git push -u origin main
```
- **Check:** refresh the GitHub page; your files are there.

---

## Part 4 — Build Release 0 with Claude Code (3–4 weeks part-time)

Open `docs/PROMPTS.md`. Every milestone has a prompt to paste. This is the loop you'll repeat:

### The build loop
1. **Start fresh.** Open a new Claude Code conversation for each milestone (the **+** in the Claude panel). Claude re-reads `CLAUDE.md` at the start.
2. **Make a branch.** Ask Claude: *"Create a branch called feat/0-1-setup."* A branch is a safe copy to work on; `main` stays clean until the work is good.
3. **Plan first.** Press **Shift+Tab** until the mode shows **plan**, then paste the milestone's prompt. Claude explains what it will do without changing anything.
4. **Read the plan.** Ask about anything you don't understand ("why do we need this?"). When it makes sense, say **go**.
5. **Approve actions.** Claude asks before running commands or editing files. Read each one. It's fine to choose "always allow" for safe, repeated commands like `pnpm test`.
6. **Try it.** Run `pnpm dev` in the terminal and open **http://localhost:3000**. Click around. Compare with the mockup.
7. **Check quality.** Ask: *"Run lint, typecheck and tests, and fix anything that fails."*
8. **Save and merge.** Ask: *"Commit this, push the branch, and open a pull request."* Read the summary on GitHub, then merge it. (From 0.7 on, each pull request also gets its own preview link from Vercel.)
9. **Tick the box** in `docs/ROADMAP.md`.

### Milestone checkpoints

| Milestone | You'll know it worked when… | Watch out for |
|---|---|---|
| **0.1 Setup** | `pnpm dev` shows "ArchiTrac" in Barlow at localhost:3000 | If `pnpm` isn't found, redo step 4 |
| **0.2 Database** | The cross-firm test passes; you can see tables in `pnpm db:studio` | Keep the two Neon connection strings (app and owner) straight. Never paste them in chat or commit them; they go in `.env.local` only |
| **0.3 Auth** | You can sign up, create a firm, sign out and back in; visiting `/home` signed out redirects to sign-in | The Clerk webhook needs a public URL locally. Claude will set up a tunnel or explain how to test it |
| **0.4 UI kit** | `/dev/ui` shows every component looking like the mockup | Compare side by side with the mockup in another browser window |
| **0.5 App shell** | Menu rail, collapse toggle, and dark header match `Home.dc.html` | Add-on modules hide when turned off in settings |
| **0.6 Settings** | You can invite a second email address and give it a role | Use a personal email to test the invite |
| **0.7 Deploy** | The app runs at a vercel.app address and every pull request shows green checks | Production keys go in Vercel's settings, not in files |

**Release 0 is done** when a test firm can sign up, invite a user, and see an empty, styled app at a live address, with all checks green.

---

## Part 5 — Before you start Release 1

1. **Review the specs.** Read each file in `docs/specs/release-1/`. Correct anything that doesn't match how TMG works, and answer the **Open questions** at the bottom of each. Specs are cheap to change; code isn't.
2. **Get a developer review.** Have a senior developer review the Release 0 code (database, RLS, auth, permissions) before you build on it. Send them `docs/ARCHITECTURE.md` and the GitHub repo.
3. **Load demo data.** Use the seed prompt in `docs/PROMPTS.md` so every screen has realistic content.
4. **Set up QuickBooks sandbox access** at developer.intuit.com (free) before milestone 1.9.

---

## Everyday habits

- **Commit often.** Small save points make mistakes cheap.
- **Never commit secrets.** `.env.local` is ignored by Git on purpose. If a key is ever pasted somewhere public, rotate it in that service.
- **One milestone per conversation.** Long conversations drift; fresh ones re-read the rules.
- **Ask "why".** "Explain this file line by line" is the fastest way to learn as you go.
- **If Claude goes in circles** (fixes one thing, breaks another): stop, ask *"Summarize what's wrong and what you've tried"*, then start a new conversation with that summary.
- **Update the docs.** When a decision changes, ask Claude to update the spec or `DATA_MODEL.md` in the same pull request.

## Troubleshooting

| Problem | Fix |
|---|---|
| `command not found: pnpm` / `node` | Close and reopen VS Code so it picks up the new install; redo Part 1 steps 3–4 |
| Port 3000 already in use | Stop the other `pnpm dev` (click the terminal, press Ctrl+C) or run `pnpm dev -p 3001` |
| Database connection error | Check `.env.local` exists and the Neon strings end in `?sslmode=require`; make sure the Neon project isn't paused |
| Sign-in loops or redirects | Check the Clerk keys in `.env.local` match the Clerk dashboard (test keys start `pk_test_` / `sk_test_`) |
| Tests fail after a schema change | Ask Claude: *"Run db:generate and db:migrate, then rerun tests and explain any failures."* |
| Something worked yesterday and doesn't now | `git log` shows your save points. Ask Claude: *"Compare with the last commit and find what changed."* |
