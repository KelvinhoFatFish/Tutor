# PushUp League 💪

**Your friends are counting. Are you?**

A social fitness app where you and your friends compete by doing push-ups every day.
You prop up your phone, the camera watches your form, and every valid push-up is
counted automatically and added to your total, your streak and your leaderboard
position.

---

## Contents

1. [The 60-second version](#1-the-60-second-version)
2. [What you need](#2-what-you-need)
3. [What's in the box](#3-whats-in-the-box)
4. [How to run the app on my computer](#4-how-to-run-the-app-on-my-computer)
5. [Using the app](#5-using-the-app)
6. [How the push-up detection actually works](#6-how-the-push-up-detection-actually-works)
7. [Environment variables](#7-environment-variables)
8. [Putting it online so friends can use it](#8-putting-it-online-so-friends-can-use-it)
9. [Connecting a custom domain (optional)](#9-connecting-a-custom-domain-optional)
10. [How to share with your friends](#10-how-to-share-with-your-friends)
11. [Changing the app later](#11-changing-the-app-later)
12. [Troubleshooting](#12-troubleshooting)
13. [Launch checklist](#13-launch-checklist)
14. [Privacy and security](#14-privacy-and-security)
15. [Tests and what has been verified](#15-tests-and-what-has-been-verified)
16. [Technical appendix](#16-technical-appendix)

---

## 1. The 60-second version

If you already have Node.js installed, open a terminal **in this folder** and run:

```bash
npm install
npm run dev
```

Then open **http://localhost:3000** in Chrome, Edge or Safari.

That's it. There is no database to set up, no account to create, no API key to
paste. Everything runs on your own computer.

> **Words you'll see a lot**
> **Terminal** — the black window where you type commands. On Windows it's
> "PowerShell" or "Terminal"; on a Mac it's "Terminal".
> **`npm`** — the tool that installs and runs JavaScript projects. It comes with Node.js.
> **Dependency** — a piece of code somebody else wrote that this project uses.

---

## 2. What you need

### To run it on your own computer

| You need | Why | Where to get it |
|---|---|---|
| **Node.js version 22.5 or newer** (24 recommended) | Runs the whole app. The built-in database needs 22.5+. | [nodejs.org](https://nodejs.org) → download the **LTS** installer → click through it |
| A **modern browser** | Chrome, Edge, Safari or Firefox. The camera and the AI pose model need a recent one. | Already installed |
| A **webcam** | To count push-ups | Built into most laptops and phones |
| About **150 MB of disk space** | Dependencies plus the pose model | — |

You do **not** need: a database server, Python, Docker, an OpenAI key, or any paid service.

### To put it online for your friends

| You need | Why | Cost |
|---|---|---|
| A **GitHub account** | Stores your code so the hosting service can build it | Free |
| A **Supabase account** | The database that remembers everyone's push-ups | Free tier is plenty |
| A **Vercel account** | Turns your code into a real website with an address | Free tier is plenty |

Full step-by-step instructions are in [section 8](#8-putting-it-online-so-friends-can-use-it).

---

## 3. What's in the box

```
pushup-league/
│
├── README.md                  ← you are here
├── .env.example               ← copy to .env.local when you need settings
├── package.json               ← the list of dependencies and commands
├── next.config.ts             ← web server configuration
├── tsconfig.json              ← TypeScript configuration
│
├── public/                    ← files served directly to the browser
│   ├── icon.svg               ← the app icon
│   ├── manifest.webmanifest   ← lets phones "Add to Home Screen"
│   ├── models/                ← the pose AI model (downloaded automatically)
│   └── mediapipe/wasm/        ← the AI runtime (copied automatically)
│
├── scripts/                   ← helper programs, not part of the app itself
│   ├── setup-assets.mjs       ← prepares the AI files (runs automatically)
│   ├── download-models.mjs    ← downloads the pose model
│   ├── test-detector.mjs      ← tests the push-up counting logic
│   ├── test-social.mjs        ← tests friends, streaks and anti-cheat
│   ├── smoke-test.mjs         ← tests the whole running app over HTTP
│   └── reset-db.mjs           ← deletes your local database
│
└── src/
    ├── app/                   ← the screens and the API
    │   ├── page.tsx               the very first screen
    │   ├── login/ register/       signing in and signing up
    │   ├── onboarding/            the welcome wizard
    │   ├── invite/[code]/         "Alex invited you to PushUp League"
    │   ├── privacy/               privacy notice
    │   ├── workout/               camera, counting, celebration
    │   ├── (app)/                 the signed-in screens
    │   │   ├── dashboard/         home
    │   │   ├── leaderboard/       ranks
    │   │   ├── friends/           friends and requests
    │   │   ├── challenges/        battles
    │   │   ├── profile/           your stats and achievements
    │   │   └── settings/          preferences, privacy, delete account
    │   └── api/                   the 22 API endpoints (the "backend")
    │
    ├── components/             ← reusable pieces of interface
    │   ├── PoseCamera.tsx         ← camera + AI + skeleton drawing
    │   ├── AppShell.tsx           ← header and navigation
    │   └── ...
    │
    └── lib/
        ├── pushup/             ← ⭐ THE PUSH-UP COUNTER ⭐
        │   ├── detector.ts        the state machine that decides what counts
        │   ├── geometry.ts        joint-angle maths
        │   └── types.ts           the tunable thresholds
        ├── db/                 ← database (SQLite or PostgreSQL)
        ├── auth.ts             ← passwords and sessions
        ├── webauthn.ts         ← passkeys ("face login")
        ├── stats.ts            ← totals, streaks, anti-cheat audit
        ├── social.ts           ← friends, leaderboards, notifications
        ├── challenges.ts       ← battles
        ├── achievements.ts     ← badges
        └── client/             ← browser-side helpers (offline queue, sound...)
```

**Size:** about 9,900 lines of TypeScript across 71 source files and 22 API endpoints.

---

## 4. How to run the app on my computer

This is the section to follow if you have never done this before. Take it slowly.

### Step 1 — Install Node.js

1. Go to **https://nodejs.org**
2. Download the big green **LTS** button (LTS means "Long Term Support" — the stable one).
3. Run the installer. Click **Next** through everything. Accept the defaults.
4. **Restart your computer** if the installer asks you to.

**Check it worked.** Open a terminal:

- **Windows:** press the `Windows` key, type `powershell`, press Enter.
- **Mac:** press `Cmd + Space`, type `terminal`, press Enter.

Type this and press Enter:

```bash
node --version
```

You should see something like:

```
v24.14.0
```

If you see `command not found` or `'node' is not recognized`, Node.js isn't installed
properly. Close the terminal, open a new one, and try again. If it still fails, reinstall
Node.js and make sure you tick "Add to PATH" if the installer offers it.

> ⚠️ **The version number matters.** You need **22.5.0 or higher** (24 is ideal).
> The app uses a database that is built into Node itself. On an older version it will
> refuse to start with a message about `node:sqlite`.

### Step 2 — Open a terminal in this folder

**The easy way (Windows):** open the `pushup-league` folder in File Explorer, then
click once in the address bar at the top, type `powershell`, and press Enter. A
terminal opens already pointed at that folder.

**The easy way (Mac):** right-click the `pushup-league` folder → *Services* →
*New Terminal at Folder*.

**The manual way (any system):**

```bash
cd path/to/pushup-league
```

For example:

```bash
cd C:\Users\YourName\Documents\pushup-league
```

or on a Mac:

```bash
cd ~/Documents/pushup-league
```

**Check you are in the right place.** Type:

```bash
ls
```

(On Windows you can use `dir` instead.) You should see `package.json` and `src` in the
list. If you see something else, you are in the wrong folder — `cd` again.

> 💡 **Tip:** in the terminal, press the `Tab` key while typing a folder name and it will
> finish the name for you. This avoids typos.

### Step 3 — Install the dependencies

```bash
npm install
```

This downloads everything the project needs. It takes **1–3 minutes** the first time.

**What you should see:** a lot of text scrolling past, then something like
`added 88 packages in 45s`.

**It is safe to ignore** lines that start with `npm warn`.

**If you see errors:** see [Troubleshooting](#12-troubleshooting).

### Step 4 — Create your settings file (optional right now)

You do **not** need any settings to run the app locally. But if you like, you can create
one now so it's ready later:

**Windows PowerShell:**
```powershell
Copy-Item .env.example .env.local
```

**Mac / Linux:**
```bash
cp .env.example .env.local
```

You can leave the file empty of real values for now. Details in
[section 7](#7-environment-variables).

### Step 5 — Start the app

```bash
npm run dev
```

The first time, you'll also see it preparing the AI files:

```
> pushup-league@1.0.0 predev
> node scripts/setup-assets.mjs

[ok  ] MediaPipe WebAssembly runtime copied to public/mediapipe/wasm
[get ] Downloading the pose model (about 6 MB, one time only)...
[ok  ] pose_landmarker_lite.task (5.78 MB)
```

Then:

```
   ▲ Next.js 15.5.27
   - Local:        http://localhost:3000
   - Network:      http://192.168.1.42:3000

 ✓ Ready in 2.1s
```

**Leave this terminal window open.** That text means the app is running. If you close the
window, the app stops.

### Step 6 — Open it in your browser

Open **Chrome, Edge or Safari** and go to:

```
http://localhost:3000
```

You should see the dark PushUp League welcome screen with a big 💪.

> ⚠️ **Use `localhost`, not a made-up address.** Browsers only allow camera access on
> `https://` websites — and they make an exception for `localhost`. If you open the app
> at something like `http://192.168.1.42:3000` the camera will be blocked.
> That's a browser security rule, not a bug.

### Step 7 — Allow the camera

The first time you open the workout screen, the browser asks:

> *"localhost wants to use your camera"*

Click **Allow**.

If you accidentally clicked **Block**: click the little camera or lock icon in the address
bar, set Camera to **Allow**, then reload the page.

### Step 8 — Create an account and try it

1. Click **Create Account**.
2. Fill in a username, email and password. (Any email works — it isn't verified, because
   this build sends no email.)
3. Leave "Enable biometric sign-in" ticked if you'd like to try the face/fingerprint login
   later, or untick it and skip that step.
4. Click **Create Account 💪**.
5. Work through the onboarding wizard. You can skip the face sign-in and the friends step.

### Step 9 — Test the push-up detection

1. Click the big green **💪 PUSH-UPS** button in the middle of the bottom bar.
2. **Prop your phone or laptop somewhere it can see your whole body from the side.**
   On a laptop: put it on the floor, or on a low table, and lie down beside it, side-on.
3. Watch the **Camera check** panel. Four ticks should turn green:
   - Person detected
   - Whole body visible
   - Enough light
   - Plank position detected
4. When the badge says **✓ Ready**, press **START 💪**.
5. **3… 2… 1… GO!**
6. Do a push-up, all the way down and all the way up.
7. The counter should tick up. You'll see a green **+1** float off the number.

**If the counter isn't moving**, jump to
["Push-ups aren't being detected"](#push-ups-arent-being-detected) in Troubleshooting.
Nine times out of ten it's camera angle or lighting.

### Step 10 — Stop the app when you're done

Go back to the terminal and press **`Ctrl` + `C`**.

### Coming back later

Next time you only need two commands:

```bash
cd path/to/pushup-league
npm run dev
```

Your account and push-up history are saved in `data/pushup-league.db`, so everything is
still there.

---

## 5. Using the app

### The core loop

```
Open app → see the friend leaderboard → feel motivated → start the camera →
do push-ups → automatic counting → score saved → leaderboard updates →
friends get notified → come back tomorrow
```

### The first screen

```
        💪
   PUSHUP LEAGUE
Your friends are counting. Are you?

   [ Create Account ]
   [ Log In ]
```

### The dashboard

```
Good evening, Alex 👋
┌────────────────────────────────┐
│ TODAY'S PUSH-UPS      🔥 5 days│
│ 87                             │
│ ▲ 23 vs yesterday              │
│ Best day: 120                  │
│ ▓▓▓▓▓▓▓▓▓▓▓░░░░░  72%          │
└────────────────────────────────┘

        [ 💪 DO PUSH-UPS ]

Friend leaderboard
🥇 Sarah      103
🥈 You         87
🥉 Alex        82

🔥 16 more push-ups and you'll pass Sarah!
```

### The workout screen

| Phase | What happens |
|---|---|
| **Setup** | Live camera preview, skeleton overlay, four readiness ticks, tips |
| **Countdown** | 3 · 2 · 1 · GO! with a beep |
| **Live** | Giant counter, `+1` animation, streak, timer, today's total, END WORKOUT |
| **Complete** | The celebration, your numbers, calories estimate, achievements, Share / Another Set / Dashboard |

### The five tabs

- **Home** — today's number and the leaderboard
- **Ranks** — Today / This Week / This Month / All Time, with your row highlighted
- **Friends** — search, requests, profiles, block
- **Battles** — challenges with progress bars
- **💪 (centre button)** — start a workout

Your profile and settings are behind the avatar in the top-right corner.

### Things worth trying

- Open **Detection settings** (the ⚙️ in the workout screen) and slide the thresholds
  around while you do push-ups. The changes apply instantly — that's the fastest way to
  find settings that suit you.
- Turn the **sound** and **vibration** off in **Settings**.
- Try the **Share** button at the end of a workout.
- Invite a friend and watch the notifications appear.

---

## 6. How the push-up detection actually works

This is the most important part of the app, so here is exactly what it does.

### It is not a button that adds one

The app really does look at your body. Here is the chain:

```
Camera frame
   ↓  MediaPipe Pose finds 33 body points on you
Skeleton (shoulders, elbows, wrists, hips, knees, ankles…)
   ↓  we compute joint angles
Elbow angle + hip angle + how far your shoulders dropped
   ↓  a state machine with debouncing
A valid push-up — or a rejected one
```

**Everything happens on your device.** The AI model and its runtime are downloaded from
*your own website* (they live in `public/`), and the video frames never leave your
browser. Only the final number is sent to the server.

### The five states

```
        ┌──────────────────── counted +1 ────────────────────┐
        │                                                    ▼
   ┌────────┐  arms   ┌───────┐  elbow   ┌──────┐  depth  ┌────────┐  push  ┌────┐
   │  IDLE  │───────▶ │ READY │────────▶ │ DOWN │───────▶ │ BOTTOM │──────▶ │ UP │
   └────────┘ extend  └───────┘  bends   └──────┘ reached └────────┘   up   └────┘
        ▲                  ▲                     │
        │                  └── "not deep enough"┘
        └── lost tracking / camera knocked
```

A rep is counted **only** when all of these are true:

1. You were locked in a plank at the top — arms extended, body straight.
2. Your elbow bent past the depth threshold.
3. Your **shoulders** physically dropped by at least the required amount.
4. Your **hips** dropped too — this is what stops "bobbing your head" counting.
5. You held the bottom position briefly.
6. Your arms came back to extended.
7. The whole movement took at least the minimum time.
8. The camera was steady throughout.

### How it refuses to be fooled

| Cheat | What stops it |
|---|---|
| Bending your elbows while your body stays still | Shoulder-drop requirement |
| Nodding your head up and down | Elbow angle never changes → nothing happens |
| Tiny little half-reps | Minimum depth + minimum shoulder drop |
| Flailing up and down as fast as possible | Minimum rep duration + cooldown |
| Waving your hand over the lens | Frame-to-frame jump detection resets the rep |
| Standing up and squatting | Plank check: wrists must be below shoulders, body must be straight |
| Editing the number in the browser | Server-side audit rejects impossible rep rates |

### Where the thresholds live

All of them are in **`src/lib/pushup/types.ts`** under `DEFAULT_CONFIG`, and each one is
commented. The three presets are `beginner`, `standard` and `strict`.

| Setting | Default | What it means |
|---|---|---|
| `minElbowAngle` | 100° | Elbow must bend at least this far to count |
| `maxElbowAngle` | 158° | Above this, arms count as "extended" |
| `downElbowAngle` | 132° | Below this, the descent has begun |
| `alignmentTolerance` | 35° | How far from perfectly straight your body may be |
| `minDepthDelta` | 0.05 | How far your shoulders must drop (fraction of the picture) |
| `minHipDepthDelta` | 0.022 | How far your hips must drop |
| `minRepDurationMs` | 650 | Anything faster is not a push-up |
| `cooldownMs` | 320 | Minimum gap between two counted reps |
| `confidenceThreshold` | 0.5 | Below this, counting pauses and tells you to get back in frame |

### Changing them

**The quick way** (no code): the ⚙️ button in the workout screen. Changes apply to the
live camera immediately, so you can tune while you exercise.

**The permanent way:** edit `DEFAULT_CONFIG` in `src/lib/pushup/types.ts`. Then run:

```bash
npm test
```

That runs 28 checks against a simulated body — including "shallow reps are rejected",
"arm-only movement is rejected" and "a knocked camera doesn't count". If you loosen a
threshold too far, those tests will tell you.

---

## 7. Environment variables

"Environment variables" are settings stored outside the code, so that secrets never end
up in your source files.

### Do I need any?

**Locally: no.** The app defaults to a database file on your computer. You can run
everything without touching this.

**When deployed: yes, one.** Your hosting service wipes its disk, so you need a real
database (see [section 8](#8-putting-it-online-so-friends-can-use-it)).

### How to set them

1. Copy the template:
   ```bash
   cp .env.example .env.local
   ```
   (Windows: `Copy-Item .env.example .env.local`)

2. Open `.env.local` in any text editor (Notepad, TextEdit, VS Code).

3. Add your values. For example:
   ```
   DB_DRIVER=postgres
   DATABASE_URL=postgresql://postgres.abcdefgh:yourpassword@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
   ```

4. Save the file and **restart the app** (`Ctrl+C`, then `npm run dev`). Settings are only
   read when the server starts.

### The complete list

| Variable | Required? | Secret? | What it is |
|---|---|---|---|
| `DB_DRIVER` | No — defaults to `sqlite` | No | `sqlite` for a local file, `postgres` for a hosted database |
| `SQLITE_PATH` | No | No | Where the local database file lives |
| `DATABASE_URL` | **Yes, when `DB_DRIVER=postgres`** | 🔴 **YES** | The full connection string to your hosted database |
| `DATABASE_SSL` | No | No | Set to `disable` only for a local Postgres without SSL |
| `WEBAUTHN_RP_ID` | No | No | Only if you use a custom domain in front of a different hostname |
| `APP_ORIGIN` | No | No | Same situation as above |

### Rules to keep you safe

- 🔴 **Never** commit `.env.local` to GitHub. It's already in `.gitignore` — leave it there.
- 🔴 **Never** paste `DATABASE_URL` into a chat, screenshot, issue or support form.
- 🔴 **Never** put any of these values directly into a `.tsx` file. Anything in `src/`
  that starts with `NEXT_PUBLIC_` is visible to every visitor.
- ✅ If you ever leak `DATABASE_URL`, reset the database password in Supabase immediately.

### Why are there so few variables?

Because the push-up detection happens in the browser, there is **no computer-vision API
key** to manage, no per-rep cost, and nothing to leak. That was a deliberate choice.

---

## 8. Putting it online so friends can use it

Right now the app only works on your computer. To send a link to your friends you need it
on the internet.

**The problem to understand first:** hosts like Vercel give your app a fresh, empty disk
every time it starts. If you used the local file database, every deploy would erase
everybody's push-ups. So in production we point the app at a hosted PostgreSQL database
instead. That's what Supabase provides.

Everything here is on free tiers. You will need to do the Supabase and Vercel parts
yourself — I can't create accounts for you.

### Part A — Put your code on GitHub

1. Make sure you have a **GitHub** account: https://github.com/signup
2. Install **Git** if you don't have it: https://git-scm.com/downloads
   Check it's there, in your terminal:
   ```bash
   git --version
   ```
3. In your terminal, inside the `pushup-league` folder, tell Git who you are (once ever):
   ```bash
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```
4. Turn the folder into a Git repository and save a first snapshot:
   ```bash
   git init
   git add .
   git commit -m "PushUp League"
   ```
5. Create an empty repository on GitHub:
   - Go to https://github.com/new
   - **Repository name:** `pushup-league`
   - **Private** or **Public** — either is fine (Vercel works with both)
   - **Do NOT** tick "Add a README file", "Add .gitignore" or "Choose a license"
   - Click **Create repository**
6. GitHub now shows you some commands. Use the ones under
   **"…or push an existing repository from the command line"**:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/pushup-league.git
   git branch -M main
   git push -u origin main
   ```
   It will ask you to sign in to GitHub. If it asks for a password, you need a
   **personal access token** instead: GitHub → your avatar → *Settings* →
   *Developer settings* → *Personal access tokens* → *Tokens (classic)* →
   *Generate new token (classic)* → tick **repo** → copy the token and paste it as the
   password.

✅ **Check:** refresh your GitHub repository page. You should see your files, and
**no** `.env.local` anywhere in the list.

### Part B — Create the database (Supabase)

1. Sign up at https://supabase.com (free).
2. Click **New project**.
   - **Name:** `pushup-league`
   - **Database Password:** click *Generate a password* and **save it somewhere safe**
   - **Region:** whichever is closest to you
   - Click **Create new project** and wait about 2 minutes.
3. In the left sidebar, click the **gear icon** (Project Settings), then **Database**.
4. Scroll to **Connection string** and click the **URI** tab.
5. You'll see something like:
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:6543/postgres
   ```
6. Copy it and replace `[YOUR-PASSWORD]` with the password from step 2.
   Keep the whole thing somewhere handy — you'll paste it into Vercel in a moment.

> ✅ **You do NOT need to create any tables.** The app creates its own tables the first
> time it connects. That's on purpose — one less thing to get wrong.

### Part C — Deploy (Vercel)

1. Sign up at https://vercel.com — choose **Continue with GitHub** (much easier).
2. On your dashboard, click **Add New…** → **Project**.
3. Find `pushup-league` in the list and click **Import**.
   - If it's not listed, click **Adjust GitHub App Permissions** and grant access to the
     repository.
4. Vercel auto-detects Next.js. **Leave the build settings alone** — the defaults are
   correct. (Framework Preset: Next.js, Build Command: `npm run build`, Output: `.next`)
5. Expand **Environment Variables** and add these two:

   | Name | Value |
   |---|---|
   | `DB_DRIVER` | `postgres` |
   | `DATABASE_URL` | the full connection string from Part B |

   ⚠️ Paste the connection string **exactly** — no quotes, no spaces at the ends, and
   make sure you replaced `[YOUR-PASSWORD]` with your real password.

6. Click **Deploy**.
7. Wait 1–3 minutes. You'll see the build log scrolling.
8. When it says **Congratulations!**, click the preview image or the domain — it will look
   like `https://pushup-league-abc123.vercel.app`.

### Part D — Test the live site

Open your new URL and check these one at a time:

1. **The welcome screen appears.** (If you get a 500 error, `DATABASE_URL` is wrong — see
   Troubleshooting.)
2. **Create an account.** It should sign you in and show the onboarding wizard.
3. **Allow the camera** and complete a workout. HTTPS is automatic on Vercel, so the
   camera works.
4. **Refresh the page.** You should still be signed in, and your push-ups should still be
   there. *This is the real test that the database is working.*
5. **Open the URL on your phone.** Create a second account and add your first account as
   a friend using an invite link.
6. **Do a push-up on each account** and confirm the leaderboard updates.

If all six work, you're live. 🎉

### Notes about passkeys / face login in production

Passkeys are locked to the web address they were created on. That means:

- A passkey you created on `http://localhost:3000` will **not** work on your
  `*.vercel.app` address. That's intentional and is how the security model works.
- Just set up face sign-in again on the live site, or sign in with your email and password.

### If your Vercel URL changes

Every time you deploy, Vercel gives you the same production URL, so this is normally a
non-issue. But if you rename the project, everyone's passkeys become invalid. Email and
password will always still work.

---

## 9. Connecting a custom domain (optional)

Your free `something.vercel.app` address works perfectly. A custom domain like
`pushupleague.com` just looks nicer. **This is entirely optional.**

### Where to buy one

Choose any registrar:

- **Cloudflare Registrar** — cheapest, no markup, https://dash.cloudflare.com
- **Namecheap** — popular and beginner-friendly, https://namecheap.com
- **Google Domains successor / Squarespace** — https://domains.squarespace.com

Expect roughly **$10–15 per year** for a `.com`. There is no free legitimate way to get
one — anything offering a free `.com` is a scam.

### How to connect it

1. Buy the domain.
2. In Vercel, open your project → **Settings** → **Domains**.
3. Type your domain (`pushupleague.com`) and click **Add**.
4. Vercel shows you what to do. Usually one of:
   - **Recommended:** change your domain's *nameservers* to Vercel's. Do this in your
     registrar's DNS settings. Vercel then manages everything.
   - **Or:** add the DNS records Vercel shows you (an `A` record for `@`, a `CNAME` for
     `www`) in your registrar's DNS panel.
5. Wait. **DNS changes usually take 5–30 minutes** but can take up to 48 hours to reach
   everywhere in the world. This is normal and nothing is broken.
6. Vercel will say **Valid Configuration** when it can see your domain.

### How HTTPS works

You get it free, automatically. Vercel requests a certificate from Let's Encrypt on your
behalf and renews it forever without you doing anything. This matters because **the camera
only works over HTTPS** — so a custom domain keeps the core feature working.

### After adding the domain

Because passkeys are tied to a web address, **your old passkeys won't work on the new
domain.** Sign in with your email and password once, then set up face sign-in again.

If you want to be explicit about it, you can set these in Vercel's environment variables:

```
WEBAUTHN_RP_ID=pushupleague.com
APP_ORIGIN=https://pushupleague.com
```

---

## 10. How to share with your friends

### The easy way: send them your invite link

1. Open the app and go to the **Friends** tab (or **Settings**).
2. You'll see a box that says **Invite a friend** with a link like:
   ```
   https://your-site.vercel.app/invite/ABC123
   ```
3. Tap **Share**.
   - On a phone this opens your normal share sheet — WhatsApp, Messages, Instagram, email.
   - On a desktop it copies the message to your clipboard.
4. There are also direct buttons for **WhatsApp**, **Messages** and **Email**.

The message that gets sent is:

> 💪 I'm challenging you to PushUp League. Let's see who can do more push-ups! Join me: …

### What happens on their end

```
They tap the link
      ↓
"Alex invited you to PushUp League 💪"
      ↓
[ Join the Competition ]
      ↓
They create an account
      ↓
You are friends automatically — no usernames to type
      ↓
They do push-ups → you get notified → you do push-ups → the competition begins
```

### The other ways to add someone

- **Friend code:** every user has a 6-character code (like `K7M2QP`). Your friend can
  type it into the search box on the Friends page.
- **Username search:** type at least two characters of their username.
- **They add you:** they can send a request, and you'll get a notification to accept.

### Sharing your result after a workout

On the celebration screen, tap **📤 Share Result**. It uses the same native share sheet on
phones, and copies to your clipboard on a desktop.

---

## 11. Changing the app later

### The workflow

Every change follows the same four steps:

```
1. Edit the code on your computer
2. Test it locally  (npm run dev, look at it in the browser)
3. Push to GitHub   (git add . && git commit -m "..." && git push)
4. Vercel rebuilds and your site is updated automatically (1-3 minutes)
```

You can watch step 4 happen: Vercel → your project → **Deployments**. The newest one will
say **Building**, then **Ready**.

If a deploy fails, the old version keeps running — your users never see a broken site.

### The commands you'll actually use

```bash
# Start the app so you can look at your changes
npm run dev

# Check for mistakes in the code (catches a lot before you even run it)
npm run typecheck

# Run the automated tests
npm test

# Stop the dev server
Ctrl + C
```

### Recipes

#### Change colours

Everything is in **`src/app/globals.css`**, at the top, under `@theme`:

```css
--color-volt-500: #2bff88;   /* the electric green */
--color-sky-500:  #00c2ff;   /* the electric blue  */
--color-flame-500:#ff9d1c;   /* the streak orange  */
```

Change a hex code, save, and the whole app updates. Try `#ff2d95` for a hot pink.

#### Change text

Almost all user-facing text is written directly in the screen files under
`src/app/`. For example, the dashboard greeting is in
`src/app/(app)/dashboard/page.tsx`. Use your editor's search (`Ctrl+Shift+F`) to find a
phrase, then edit it.

#### Change the leaderboard message

The encouraging lines are in **`src/lib/social.ts`** in the function
`buildMotivationalMessage`. Also look at `buildChallengeMessage` in
`src/lib/challenges.ts`.

#### Make the counter stricter or more forgiving

**`src/lib/pushup/types.ts`** — the `DEFAULT_CONFIG` object, plus the three presets right
below it. After changing them, run `npm test` to make sure you haven't broken anything.

#### Change how much a rep is worth for calories

**`src/lib/client/format.ts`** — `estimateCalories`. Currently 0.5 kcal per push-up. It's
labelled as an estimate everywhere it appears, which you should keep.

#### Add another exercise later (squats, pull-ups…)

The detector is written to be reusable:

1. Add a new file next to `src/lib/pushup/detector.ts` — for example `squatDetector.ts`.
2. Reuse everything in `geometry.ts` (`angleAt`, `smoothLandmarks`, `trackingConfidence`).
   A squat counts when the **knee** angle closes instead of the elbow: use landmarks 23/24
   (hip), 25/26 (knee) and 27/28 (ankle).
3. Copy the state-machine shape from `detector.ts` — it already handles smoothing,
   debouncing, camera-shake rejection and invalid-rep reporting.
4. Add an exercise picker to `src/app/workout/page.tsx`.
5. Add an `exercise` column to the `workout_sessions` table in `src/lib/db/schema.ts`.

#### Add a new achievement

1. Add an entry to `ACHIEVEMENT_SEED` in **`src/lib/db/schema.ts`**.
2. If it needs a brand-new kind of measurement, add a case to `currentValue()` in
   **`src/lib/achievements.ts`**.

Existing achievement rows are updated automatically on the next start — you don't need to
touch the database.

#### Change leaderboard rules

**`src/lib/social.ts`**:
- `rangeWindow()` decides what "today", "week", "month" and "all" mean
- `buildLeaderboard()` does the ranking
- Ties are broken alphabetically so the order doesn't flicker. Change the `.sort()` if you
  want a different rule.

#### Fix a bug safely

1. Reproduce it locally.
2. If it's about *counting*, add a test case to `scripts/test-detector.mjs` **first** —
   then fix the code until the test passes.
3. If it's about *friends or stats*, add a case to `scripts/test-social.mjs`.
4. Run `npm test`, then push.

### Undoing a bad deploy

Vercel → your project → **Deployments** → find a good older one → **⋯** → **Promote to
Production**. Your site instantly goes back. Nothing is lost.

---

## 12. Troubleshooting

### "The app won't start"

**`command not found: npm`**
Node.js isn't installed, or your terminal was open before you installed it.
Close the terminal, open a new one, and run `node --version`. Still failing? Reinstall
Node.js.

**`Cannot find module 'next'`**
You skipped `npm install`, or you're in the wrong folder. Run `ls` (or `dir`) — you should
see `package.json`. Then run `npm install` again.

**`EADDRINUSE: address already in use :3000`**
Something else is using port 3000 — probably an old copy of this app still running.
Close other terminal windows, or start on a different port:
```bash
npm run dev -- -p 3001
```
Then use http://localhost:3001.

**`Error: Cannot find module 'node:sqlite'`**
Your Node.js is too old. Run `node --version`. You need **22.5.0+** (24 is best). Install
the current LTS from https://nodejs.org.

**`EPERM` or permission errors during `npm install`**
Close your editor and any other terminals, then try again. On Windows, running the
terminal as Administrator fixes it.

### "Camera doesn't work"

Browsers have strict rules here, and it's almost always one of these:

| Symptom | Cause | Fix |
|---|---|---|
| "This browser cannot use the camera" | You're not on `localhost` or `https://` | Use `http://localhost:3000`, never a raw IP address like `192.168.1.5:3000` |
| "Camera access was blocked" | You clicked Block once | Click the 🔒 or camera icon in the address bar → set Camera to **Allow** → reload |
| "The camera is busy" | Zoom, Teams, or another tab is using it | Close them and press **Try again** |
| Nothing happens at all | macOS/Windows privacy setting | **Windows:** Settings → Privacy → Camera → allow desktop apps. **Mac:** System Settings → Privacy & Security → Camera → tick your browser |
| iPhone Safari won't ask | Safari camera permission | Settings → Safari → Camera → **Allow** |

**Important:** the camera only works over `https://` or on `localhost`. This is a browser
security rule that protects you — otherwise any website could secretly film you.

### "Push-ups aren't being detected"

Work through this list in order. The first four fix the vast majority of cases.

**1. Is your whole body in the picture?**
The **Camera check** panel tells you. All four items must be green ticks:
- Person detected
- Whole body visible ← this is the one that usually fails
- Enough light
- Plank position detected

If "Whole body visible" is red, **move the camera further away**. Your head, shoulders,
hips, knees *and* feet all need to be in shot with a bit of margin.

**2. Are you filming from the side?**
This is the single biggest improvement you can make. The app measures the **angle at your
elbow** and the **angle at your hip**. From the side, both are clearly visible. From the
front or from above your head, your arms are pointing at the camera and the angles are
meaningless.

```
   ✅ GOOD                    ❌ BAD
   📱                         📱
    ╲                          │
     ╲  you (side on)          │  you (head-on)
```

**3. Is there enough light?**
The model needs to see the edges of your joints. Face a window, or turn a light on. A dark
room is the second most common cause.

**4. Are you going all the way down?**
The app requires a genuine full push-up. If you're doing half reps you'll see
**"Invalid rep — go all the way down."**

**5. Is the body straightness check rejecting you?**
Look at the "body straightness" number under the camera check. It should be near 180°. If
it's around 140° your hips are sagging or piking. Tighten your core, or open the ⚙️
**Detection settings** and raise the tolerance.

**6. Try the Beginner preset.**
Open the ⚙️ panel in the workout screen and choose **Beginner / easy**. It accepts
shallower reps and a less straight body. This is also the right setting for knee push-ups.
Once you're getting counted reliably, move up to **Standard**.

**7. Watch the live numbers.**
During a workout the app shows `Elbow 145° · Body 178°`. Do a slow push-up and watch the
elbow number. It should drop well below 100°. If it only moves between 165° and 150°, the
camera isn't seeing your arm properly — go back to problems 1 and 2.

**8. Confidence is low.**
In the camera check panel, "confidence" below 50% means the model can't see you clearly.
Stand further back and improve the lighting.

**9. Still nothing?**
Open the ⚙️ panel and lower **Minimum pose confidence** to 0.3, and increase
**Body straightness tolerance**. If that fixes it, your lighting or camera angle is the
underlying problem.

### "My friend's score isn't showing"

Check these in order:

1. **Are you actually friends?** Go to the **Friends** tab. They should be under *Your
   friends*, not under *Sent requests*. A pending request doesn't count.
2. **Are they signed in on the same site?** If you're on `localhost:3000` and they're on
   your live URL, you're using two different databases. Everyone must use the same address.
3. **Have they done push-ups *today*?** The **Today** tab is today only. Try the
   **All Time** tab — if they show up there, everything is working and they simply haven't
   trained today. This is the most common false alarm.
4. **Is the database connected?** On a deployed site, look at the Vercel logs or try
   registering a new account. If that fails, `DATABASE_URL` is wrong.
5. **Does refreshing help?** The app refetches when you switch back to the tab. Force a
   refresh with `Ctrl+Shift+R` (`Cmd+Shift+R` on Mac).
6. **Is their workout waiting to upload?** If they were offline, they'll see a banner
   saying so. It uploads automatically when the connection returns.

### "Deployment failed"

1. Open Vercel → your project → **Deployments** → click the failed one.
2. Click **Build Logs** and scroll to the **first** red error. Later errors are usually
   just consequences.
3. Match it to one of these:

| Error in the log | Meaning | Fix |
|---|---|---|
| `Environment variable not found: DATABASE_URL` | You set `DB_DRIVER=postgres` but no URL | Add `DATABASE_URL` in Vercel → Settings → Environment Variables, then **Redeploy** |
| `getaddrinfo ENOTFOUND` / `password authentication failed` | The connection string is wrong | Re-copy it from Supabase. Make sure `[YOUR-PASSWORD]` is replaced and there are no quotes or stray spaces |
| `Type error: ...` | A code error I'd need to see | Run `npm run typecheck` locally — it shows the same error with a file and line number |
| `Module not found` | A dependency is missing | Run `npm install` locally and commit `package-lock.json` |
| `Command "npm run build" exited with 1` | Generic failure | Scroll up in the log to the real error above this line |

4. After fixing, either push a new commit or click **Redeploy** on the failed deployment.

**Nothing is broken for your users while you debug.** The last successful deployment keeps
running.

### "Environment variable is missing"

1. Vercel → your project → **Settings** → **Environment Variables**.
2. Add the variable. Tick **Production**, **Preview** *and* **Development** so it works in
   all cases.
3. **Click Save.**
4. **Redeploy** — Deployments → newest → **⋯** → **Redeploy**. Environment variables are
   only read at build/start time, so a redeploy is required. This catches people out
   constantly.

For local development, the equivalent file is `.env.local` in the project folder — and you
must restart `npm run dev` after changing it.

### "I forgot my password"

This build has no password-reset email, because sending email requires a paid service and
an account you would have to set up. Two options:

- **If you set up face sign-in**, use the **Sign in with Face ID / Passkey** button — that
  still works.
- **Otherwise**, if it's your own server, you can create a new account, or ask a developer
  to update the password hash in the database.

If you want real password resets, the cleanest upgrade is to swap the login system for
Supabase Auth, which includes reset emails out of the box.

### "I want to wipe everything and start over"

**Locally:**
```bash
npm run db:reset
```
It asks you to type `yes`, then deletes the database file. The next start recreates an
empty one.

**On a deployed site:** in Supabase, go to **Table Editor**, select every table and delete
the rows. Or delete the project and make a new one, then update `DATABASE_URL` in Vercel.

### Something else?

Run these and look at the output:

```bash
node --version     # must be 22.5 or higher
npm run typecheck  # finds code errors with file and line numbers
npm test           # should say "28 passed, 0 failed" then "98 passed, 0 failed"
```

If `npm test` fails, the problem is in the app's logic rather than your setup — and the
failing test name tells you exactly which behaviour broke.

---

## 13. Launch checklist

Work down this list before you send the link to anyone.

### On your computer

- [ ] `node --version` shows 22.5.0 or higher
- [ ] `npm install` completed without errors
- [ ] `npm run dev` starts and prints a `localhost:3000` address
- [ ] The welcome screen loads at http://localhost:3000
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm test` reports **28 passed** (detector) and **98 passed** (social)

### Core features (test these locally first)

- [ ] You can create an account
- [ ] You can log out and log back in with your password
- [ ] The browser asks for camera permission and you can allow it
- [ ] The four camera checks go green when you're positioned correctly
- [ ] The counter increments on a real push-up
- [ ] Half reps are correctly rejected as "Invalid rep"
- [ ] The `+1` animation and the sound/haptic fire on each rep
- [ ] **END WORKOUT** shows the celebration screen with correct numbers
- [ ] Today's total on the dashboard increased by the right amount
- [ ] Your lifetime total increased too
- [ ] Refreshing the page keeps you signed in and keeps your numbers
- [ ] Achievements appear on your profile
- [ ] The 14-day chart shows today's bar

### Friends (needs two accounts)

- [ ] You can create a second account (use a different browser or a private window)
- [ ] Searching by username finds the other person
- [ ] Searching by friend code finds the other person
- [ ] A friend request can be sent, and accepted from the other account
- [ ] Both accounts appear on each other's leaderboard
- [ ] The motivational message names the right person and the right gap
- [ ] An invite link (`/invite/CODE`) shows "…invited you to PushUp League 💪"
- [ ] Signing up through an invite link creates the friendship automatically
- [ ] **No email address is visible anywhere in the friends UI**

### Privacy and safety

- [ ] Settings → **Delete my biometric data** works
- [ ] Settings → **Delete my account** works (it asks you to type `DELETE`)
- [ ] After deleting, you can no longer sign in with that account
- [ ] The privacy notice is reachable and readable (`/privacy`)
- [ ] **You have replaced `replace-this-with-your-email@example.com` in
      `src/app/privacy/page.tsx` with your own address**
- [ ] `.env.local` is **not** on GitHub (check your repository file list)

### Production

- [ ] The code is pushed to GitHub
- [ ] Supabase project created and the connection string saved
- [ ] Vercel project imported with `DB_DRIVER=postgres` and `DATABASE_URL` set
- [ ] The production build succeeded
- [ ] The live URL loads the welcome screen
- [ ] You can register on the live site
- [ ] The live camera works (Vercel gives you HTTPS automatically)
- [ ] Your data is still there after a hard refresh — **this proves the database works**
- [ ] You can log in from your phone
- [ ] Two accounts on the live site can see each other on the leaderboard
- [ ] `npm run test:smoke` passes against your live URL:
      ```bash
      $env:BASE_URL="https://your-site.vercel.app"; npm run test:smoke
      ```
      (Mac/Linux: `BASE_URL="https://your-site.vercel.app" npm run test:smoke`)
- [ ] The mobile layout looks right on a real phone
- [ ] You've set up face sign-in on the live site (passkeys don't carry over from localhost)

### Ready to share

- [ ] You've sent yourself the invite link and it works end to end
- [ ] You've decided who to invite first 😄

---

## 14. Privacy and security

This app points a camera at people, so privacy is treated as a feature rather than a
footnote.

### The camera

- The browser asks permission **explicitly**, with a clear explanation, before the camera
  opens.
- Pose detection runs **entirely in your browser**. The AI model and its runtime are
  served from your own site — there is no request to Google's servers or anyone else's at
  runtime.
- **Video frames are never uploaded, recorded or stored.** There is no code path that
  could do so.
- The camera is released the moment you leave the workout screen.

### Biometric sign-in — and an honest limitation

There are two different things that get called "face login", and the difference matters:

|  | What this app does | What it does **not** do |
|---|---|---|
| **How** | A **passkey**. Your device's secure hardware (Face ID, Windows Hello, fingerprint) verifies you locally and signs a challenge. | It does not take a photo of your face and compare it to a stored image. |
| **What's stored** | A **public key** — a string that can only *verify* signatures, never create them. | No face image, no face scan, no face template, no biometric data of any kind. |
| **If the database leaked** | Nobody could sign in as you with it. | — |

**The limitation, stated plainly:** biometric sign-in is a strong, convenient layer, but it
is not a guarantee of identity and it is not unbreakable. It confirms that whoever is
holding your unlocked device is the person enrolled on it. It is not a substitute for
keeping your password safe and your device locked. Treat your unlocked phone the way you'd
treat your house keys.

You can delete all biometric data at any time: **Settings → Privacy → Delete my biometric
data**. Your account and email/password login keep working.

### Passwords and sessions

- Passwords are hashed with **scrypt** and a unique random salt per user. The original
  password is never stored and cannot be recovered from the database.
- Sessions use a random 32-byte token in an `httpOnly`, `SameSite=Lax` cookie. Only a
  **hash** of the token is stored, so a database leak can't be turned into a login.
- Login errors are identical for "wrong password" and "no such account", and the password
  comparison always runs — so the response can't be used to discover which emails are
  registered.

### Data access

- **Every API route scopes its queries to the signed-in user from the session cookie.**
  There is no `userId` parameter to tamper with. You cannot read or write another person's
  data by changing a request.
- This is verified by an automated test: *"editing your profile does not touch anyone
  else"*, plus checks that only the recipient can accept a friend request and only the
  creator can delete a challenge.
- **Email addresses are never returned by any endpoint.** There is a test asserting the
  string `@example.com` appears nowhere in search results, profiles or invite previews.
- Friends see your streaks and daily numbers. Non-friends see only your username, avatar
  and lifetime total.
- Blocking is absolute: a blocked person disappears from your search results, can't send
  you requests, and can't re-add you through an invite link.

### Anti-cheat

- The browser counts reps, but the server independently checks the result against the
  session's real duration. A physically impossible rep rate is **stored but not credited**,
  so nothing is silently lost and nothing can be inflated.
- Each session has a unique id generated *before* the workout starts. Re-uploading the same
  session — from a retry, a duplicate tab, or an attempt to double-count — is ignored.
- Sessions more than two days away from the server's date are filed under today, so you
  can't back-date a streak.

### Row Level Security (RLS) — the honest answer

**RLS is not enabled, and it is not the right tool for this architecture.** Here's why, and
what to do if that changes.

RLS is a PostgreSQL feature that filters rows based on *who is connected to the database*.
In this app, **the browser never connects to the database.** Your browser talks to the
Next.js API; the API holds one server-side database connection and scopes every single
query to the session user in application code. There is no database connection belonging to
"Alice" for RLS to filter — so enabling RLS would only lock out the app itself.

Security therefore lives in one auditable place: `getCurrentUser()` reads the session
cookie, and every route passes that user's id into its queries.

**⚠️ If you later change the app so the browser talks to Supabase directly** (using the
Supabase JavaScript client), that reasoning stops being true and **you must enable RLS
immediately**. Ask a developer to add policies like:

```sql
alter table daily_stats enable row level security;

create policy "read own and friends' stats" on daily_stats for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.requester_id = auth.uid() and f.recipient_id = daily_stats.user_id)
          or (f.recipient_id = auth.uid() and f.requester_id = daily_stats.user_id))
    )
  );

create policy "write only own stats" on daily_stats for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

Repeat for `workout_sessions`, `users` and `challenge_participants`. Until that day, do not
expose your Supabase keys to the browser.

### What you still need to do yourself

The brief asked for a privacy policy placeholder. `src/app/privacy/page.tsx` contains a
detailed, honest notice — but before you launch publicly you should:

1. **Replace the placeholder contact address** (`replace-this-with-your-email@example.com`).
2. **Have somebody qualified review it** if you plan to operate commercially, or if you have
   users in the EU/UK (GDPR) or California (CCPA). Biometric-privacy law is stricter than
   average, and a template is not legal advice.
3. Add a cookie banner if you later add analytics. This build sets only one cookie — the
   login session — which is strictly necessary, so no consent banner is required as-is.

---

## 15. Tests and what has been verified

This project ships with three test suites. Run the first two any time with:

```bash
npm test
```

### 1. Push-up detector — `npm run test:detector`

Drives the counting logic with a **synthetic human body** and checks 28 behaviours. It
doesn't use a camera, so it's fast and deterministic.

| Scenario | Expected |
|---|---|
| 10 clean, full-depth push-ups | counts exactly 10 |
| The same with camera noise | still counts exactly 8 |
| Shallow reps (elbow to 128°) | 0 counted, reported as "not deep enough" |
| Arm-only movement (body stays high) | 0 counted |
| Head-only movement | 0 counted, 0 rejected |
| Reps that are too fast | 0 counted, reported as "too fast" |
| Rapid half-oscillations | 0 counted |
| A knocked camera mid-rep | rep abandoned, unstable frame reported |
| Losing the person mid-rep | 0 counted |
| The cooldown window | blocks a second rep inside it |
| Body that isn't straight | never reaches READY |
| Someone standing up (not a plank) | 0 counted |
| A realistic 25-rep set with varied timing | counts exactly 25 |
| The camera-position check | accepts a good plank, rejects no-person and low-confidence |

### 2. Social, stats and anti-cheat — `npm run test:social`

Runs the real server code against a throwaway database. 98 checks covering:

- **Streak maths** — today-only, missed days, long runs, longest-ever streak
- **Anti-cheat audit** — impossible rates, negative counts, zero-length sessions, mass rejection
- **Idempotent workouts** — uploading twice adds the reps once
- **Invite links** — create an instant friendship; blocked users can't use them
- **Friend requests** — no duplicates, reciprocal requests auto-accept, only the recipient can accept
- **Search and privacy** — no email leakage; strangers get a limited profile
- **Leaderboards** — correct ranking, non-friends never appear, ties are stable
- **Motivational messages** — never shaming, correct gap, correct person
- **Challenges** — scores from real stats, authorisation, upcoming/active/finished
- **Achievements** — unlock once, never twice
- **Notifications** — rate-limited, never sent to people on zero
- **Blocking** — absolute in both directions

### 3. Full HTTP smoke test — `npm run test:smoke`

95 checks against a **running** server, using real cookies and real requests — the closest
thing to clicking through the app. Requires a server:

```bash
npm run build
npm start
# in a second terminal:
npm run test:smoke
```

It can also test your live site:

```bash
BASE_URL="https://your-site.vercel.app" npm run test:smoke
```

### What I verified myself, and what I could not

Being straight with you, because you asked me to be:

**✅ Verified with real evidence:**

- `npm run build` — the production build completed successfully (15 pages, 22 API routes)
- `npx tsc --noEmit` — zero type errors across the whole codebase
- **28/28** detector tests pass
- **98/98** social, stats and anti-cheat tests pass
- **94/95** HTTP smoke tests passed against a real running server. The single failure
  revealed a genuine inconsistency — my invite-link copy promised instant friendship while
  the code created a pending request. I fixed the code to match the promise, added a test
  for it, and that test now passes.
- The pose model (5.78 MB) and the MediaPipe WebAssembly runtime download correctly and are
  served from the app's own `public/` folder

**⚠️ Not verified — you need to check these yourself:**

- **The camera actually counting a real human body.** I have no camera and cannot run a
  browser. The counting logic is thoroughly tested against synthetic bodies, and the
  MediaPipe API usage matches its documented interface — but the first time this meets a
  real person in a real room will be on your machine. If the count is off, the ⚙️ panel
  and [section 12](#pushups-arent-being-detected) are where to go.
- **Passkeys / face sign-in.** WebAuthn requires a real device with a biometric sensor and
  a real browser prompt. The server-side verification code is written against the official
  `@simplewebauthn` library, but I could not perform an end-to-end registration.
- **Deployment to Vercel and Supabase.** No accounts, so I could not deploy. The
  PostgreSQL driver is written and the app selects it via `DB_DRIVER`, but I could not run
  against a live Supabase instance. Its query layer is identical to the SQLite one that
  passes 98 tests, and the SQL is portable by design — but the first real connection will
  be yours.
- **Real-device mobile layout.** The CSS is mobile-first with safe-area handling, but I could
  not view it on a phone.

I'd rather you know exactly where the confidence is solid and where it isn't, than have you
find out the hard way.

---

## 16. Technical appendix

<details>
<summary><strong>Technology stack</strong> (click to expand)</summary>

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router) + **React 19** | Front end and back end in one project, one command to run, one deploy target |
| Language | **TypeScript 5** | Catches mistakes before you run anything |
| Styling | **Tailwind CSS 4** | Fast to write, tiny output, no separate CSS files to keep in sync |
| Pose detection | **MediaPipe Tasks Vision 1.0** (`PoseLandmarker`) | Runs in the browser, no server cost, no API key, good accuracy |
| Database (local) | **SQLite** via Node's built-in `node:sqlite` | Zero setup — one file, no install, nothing to configure |
| Database (production) | **PostgreSQL** (Supabase) | Vercel wipes its disk, so a hosted database is required |
| Authentication | Custom sessions + **WebAuthn passkeys** | Full control, and passkeys avoid storing any biometric data |
| Password hashing | **scrypt** from Node's built-in `crypto` | Strong, and one fewer dependency to trust |
| Passkey library | `@simplewebauthn/server` + `/browser` | WebAuthn is easy to get subtly wrong; don't hand-roll it |
| Charts | Hand-rolled SVG/CSS | A chart library would add ~200 KB for 14 bars |

</details>

<details>
<summary><strong>Database schema</strong> (click to expand)</summary>

11 tables, created automatically on first run. Every primary key is a `TEXT` UUID generated
by the application, and every timestamp is a `TEXT` ISO-8601 string — which is what lets
one identical schema run unchanged on both SQLite and PostgreSQL.

| Table | Holds |
|---|---|
| `users` | Accounts, profile, cached totals, streak, friend code, notification prefs |
| `auth_sessions` | Login sessions (only a hash of the token is stored) |
| `webauthn_credentials` | Passkey **public keys** and counters |
| `webauthn_challenges` | Short-lived login challenges (deleted on use, so they can't be replayed) |
| `friendships` | Pending, accepted and blocked relationships in one table |
| `workout_sessions` | One row per workout. The id comes from the browser → idempotent uploads |
| `daily_stats` | **The source of truth** for how many push-ups you did on a given day |
| `challenges` | Battles: name, type, target, date window |
| `challenge_participants` | Who is in each battle and their score |
| `achievements` | The badge catalogue (seeded on first run) |
| `user_achievements` | Which badges each user has unlocked, and when |

**Design note:** `daily_stats` is the single source of truth. The totals cached on the
`users` row (lifetime, streak, personal best) are **derived** from it and recomputed after
every workout. That's why they can never drift out of sync or double-count. Every
"today / this week / all time" figure in the app comes from the same place.

</details>

<details>
<summary><strong>API endpoints</strong> (click to expand)</summary>

All 22 endpoints scope their queries to the signed-in user from the session cookie.

**Authentication**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create an account (optionally with an invite code) |
| POST | `/api/auth/login` | Email + password sign-in |
| POST | `/api/auth/logout` | End the session |
| GET | `/api/auth/me` | Who am I? Also reports the passkey count |
| POST | `/api/auth/passkey/register` | Passkey setup, step 1 (options) |
| POST | `/api/auth/passkey/register/verify` | Passkey setup, step 2 (store public key) |
| POST | `/api/auth/passkey/login` | Passkey sign-in, step 1 (options) |
| POST | `/api/auth/passkey/login/verify` | Passkey sign-in, step 2 (open session) |
| GET / DELETE | `/api/auth/passkey` | List / delete passkeys |

**App data**

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/workouts` | Save a finished session (idempotent, audited) |
| GET | `/api/workouts` | Recent sessions |
| GET | `/api/stats` | Dashboard data: totals, streaks, chart, achievements, rank |
| GET | `/api/leaderboard` | Ranks for `today` / `week` / `month` / `all` |
| GET / POST / DELETE / PATCH | `/api/friends` | List, add, remove, block/unblock |
| POST | `/api/friends/respond` | Accept or reject a request |
| GET | `/api/friends/search` | Search by username or friend code |
| GET | `/api/users/[id]` | A profile (full for friends, limited for strangers) |
| GET / POST | `/api/challenges` | List and create battles |
| GET / POST / DELETE | `/api/challenges/[id]` | Detail, join/leave, delete |
| GET / POST | `/api/notifications` | Feed and mark-as-read |
| GET | `/api/invite/[code]` | Invite preview (inviter's name only) |
| PATCH / DELETE | `/api/account` | Update profile / delete account |
| DELETE | `/api/account/biometrics` | Delete all passkeys |

</details>

<details>
<summary><strong>Offline behaviour</strong> (click to expand)</summary>

Counting runs on the device, so a dropped connection never costs you reps:

1. Each workout gets a UUID the moment it starts.
2. On finish, the app tries to upload immediately.
3. If that fails, the session is written to `localStorage` and a banner appears.
4. It retries automatically on the `online` event and whenever the app loads.
5. Because the UUID is the database primary key, retrying **can never double-count**. A
   `4xx` response drops the item (the server will never accept it); a `5xx` or network
   error keeps it for later.

You can see the queue and force a sync in **Settings → Offline workouts**.

</details>

<details>
<summary><strong>Scripts reference</strong> (click to expand)</summary>

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server with live reload |
| `npm run build` | Create the optimised production build |
| `npm start` | Serve the production build (run `build` first) |
| `npm run setup` | Download the pose model and copy the AI runtime |
| `npm test` | Run both test suites |
| `npm run typecheck` | Check the whole codebase for type errors |
| `npm run test:smoke` | Test a running server over HTTP |
| `npm run db:reset` | Delete the local database after a confirmation |

`setup` also runs automatically before `dev` and `build`, and skips anything already
downloaded.

</details>

<details>
<summary><strong>Accessibility and browser support</strong> (click to expand)</summary>

- All interactive elements are real `<button>`/`<a>` elements and are keyboard reachable
- Visible focus rings, suppressed for mouse users only
- The rep counter is an `aria-live` region, so screen readers announce each push-up
- The toast container is an `aria-live` region
- Toggles use `role="switch"` with `aria-checked`; progress bars expose `role="progressbar"`
- All animations respect `prefers-reduced-motion`
- Colour is never the only signal — ticks, icons and text labels carry the meaning too

**Browsers:** Chrome/Edge 111+, Safari 16.4+, Firefox 113+. The camera needs HTTPS or
localhost. Passkeys need a device with a biometric sensor or PIN.

</details>

---

**Now go and beat your friends. 💪**
