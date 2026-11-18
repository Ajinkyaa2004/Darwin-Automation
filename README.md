# ⏱️ Darwin Automation

### Attendance on Autopilot: Automatic Darwinbox Clock-In & Clock-Out

[Overview](#-overview) • [Quick Start](#-quick-start) • [Features](#-features) • [Architecture](#️-architecture) • [Installation](#-installation) • [Usage](#-usage) • [Configuration](#️-configuration) • [Troubleshooting](#-troubleshooting)

---

[![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?style=flat&logo=playwright&logoColor=white)](https://playwright.dev/)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-Cloud_Runner-2088FF?style=flat&logo=githubactions&logoColor=white)](https://github.com/features/actions)
[![macOS](https://img.shields.io/badge/macOS-launchd_Backup-000000?style=flat&logo=apple&logoColor=white)](https://support.apple.com/macos)
[![cron-job.org](https://img.shields.io/badge/cron--job.org-Scheduler-C43C1A?style=flat)](https://cron-job.org/)
[![Darwinbox](https://img.shields.io/badge/Darwinbox-HRMS-1E50D8?style=flat)](https://darwinbox.com/)

---

## 🎯 Overview

**Darwin Automation** clocks you in and out on **Darwinbox** every working day, with nobody touching it.

It started with a very real problem: I kept forgetting to punch. Some days the clock-in, some days the clock-out, some days both, and every time it meant sending my manager an **attendance regularization request**. So I automated it.

It runs in **two independent layers**:

| Layer | Where it runs | What it does |
|---|---|---|
| **☁️ Cloud** | GitHub Actions, triggered by cron-job.org | Signs in with Playwright and punches at the scheduled time |
| **💻 Mac backup** | Your own Mac, via `launchd` | Wakes up a few minutes later, checks, and only punches if the cloud missed |

### ✨ Why This Project?

- ✅ **Never double-punches.** It reads the button state before every click.
- 🔐 **Stays trusted.** It keeps the Darwinbox login session alive between runs.
- 📩 **Handles login codes.** It can read the one-time code from email if Darwinbox asks for one.
- ⚙️ **One settings file.** Shift timings and week offs live in `schedule.json`.
- 🛡️ **Safe by default.** It refuses to punch on week offs or outside the allowed time window.
- 🔔 **Always tells you.** You get a macOS notification after every backup run, and an email if the cloud trigger fails.

> **Note:** Only automate attendance if your employer permits it. This project was built with approval.

---

## 🚀 Quick Start

```
git clone https://github.com/Ajinkyaa2004/Darwin-Automation.git
cd Darwin-Automation
npm install

# Test without clicking (signs in, reads the button, stops)
DARWINBOX_USER=<employee-id> DARWINBOX_PASS=<password> DRY_RUN=1 FORCE=1 node punch.js in
```

Then set up the [cloud layer](#2️⃣-cloud-layer-github-actions--cron-joborg) and the [Mac backup](#3️⃣-mac-backup-layer).

---

## 🎬 Demo

### Run Output

```
$ node punch.js in
{"session":"carried forward from last run"}
{
  "ok": true,
  "clicked": true,
  "message": "Clockin successful",
  "label": "clockin"
}
```

### Mac Notifications

| Notification | Meaning |
|---|---|
| ✅ **Darwinbox: clocked in** | The Mac backup punched for you |
| **Darwinbox: no click needed** | The cloud already punched, so the backup did nothing |
| ⚠️ **Darwinbox: clock in FAILED, punch manually** | Something went wrong. Punch from the app |

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Quick Start](#-quick-start)
- [Demo](#-demo)
- [Features](#-features)
- [Tech Stack](#️-tech-stack)
- [Architecture](#️-architecture)
- [Installation](#-installation)
- [Usage](#-usage)
- [Configuration](#️-configuration)
- [Project Structure](#-project-structure)
- [Safety & Guardrails](#️-safety--guardrails)
- [Troubleshooting](#-troubleshooting)
- [Roadmap](#️-roadmap)
- [Contributing](#-contributing)

---

## ✨ Features

### ☁️ Cloud Layer
- **cron-job.org** fires at exact times and calls the GitHub `workflow_dispatch` API.
- **GitHub Actions** spins up a fresh Ubuntu runner, so your laptop isn't needed.
- **Playwright (headless Chromium)** signs in to Darwinbox and clicks **Clock in** or **Clock out**.
- The encrypted session is **carried forward** between runs via the Actions cache.

### 💻 Mac Backup Layer
- Runs **5 minutes after** the cloud run, as a safety net.
- Uses a **persistent Chrome profile** that Darwinbox remembers, just like your everyday browser.
- **Wakes the Mac itself** before clock-in, so it works with the lid closed.
- Survives restarts. The schedule reloads automatically when you log in.

### 🔐 Login & Security
- Reuses a trusted session, so Darwinbox normally doesn't ask for an OTP.
- If an OTP is requested, reads it from Gmail. An Outlook rule forwards only Darwinbox OTP emails.
- Never guesses old codes, because wrong attempts are limited.
- Credentials live only in **GitHub Secrets** and **`~/.darwinbox/env`** (owner-only permissions).

### 🛡️ Guardrails
- Reads the button label and first-in time **before** clicking.
- Skips **week offs**, and runs only in a window from 30 min before to 3 h after the scheduled time.
- Handles clock-outs **after midnight** as part of the previous day's shift.
- Manual dry runs never click.

### 🔔 Monitoring
- macOS notification after each Mac run, plus a log at `~/.darwinbox/punch.log`.
- GitHub "Run failed" emails, plus cron-job.org failure alerts.
- A debug screenshot artifact is uploaded when a cloud run fails (kept 3 days).

---

## 🛠️ Tech Stack

### Runtime
**Language:** JavaScript (Node.js 22)
**Browser Automation:** Playwright (Chromium / Google Chrome)
**Email (OTP fallback):** ImapFlow + Mailparser over Gmail IMAP

### Scheduling & Infrastructure
**Cloud Runner:** GitHub Actions (`ubuntu-latest`)
**Precise Trigger:** cron-job.org → GitHub REST API (`workflow_dispatch`)
**Local Scheduler:** macOS `launchd` (LaunchAgents) + `pmset` wake timer
**State:** AES-256-GCM encrypted session in the GitHub Actions cache

---

## 🏗️ Architecture

```
flowchart LR
    A[cron-job.org<br/>exact time] -->|workflow_dispatch| B[GitHub Actions<br/>runner]
    B --> C[punch.js<br/>Playwright]
    C -->|saved session| D[(Darwinbox)]
    C -.->|OTP asked?| E[Gmail IMAP<br/>forwarded OTP]
    E -.-> C
    F[macOS launchd<br/>+5 min] --> G[mac/run.sh]
    G --> C2[punch.js<br/>persistent Chrome profile]
    C2 -->|already punched? skip| D
    G --> H[macOS notification]
```

### 🔁 Punch Flow

```
1. Check IST day and time → week off or outside window? → skip
2. Open Darwinbox with the saved session → OTP? → read from Gmail
3. Read the button label + first-in time
4. State already correct? → no click
5. Click exactly once → wait for "Clockin/Clockout successful"
6. Save the session for the next run
```

### 🎨 Design Choices

| Choice | Implementation | Why |
|---|---|---|
| **Two layers** | Cloud + Mac backup | GitHub runners sometimes hit Darwinbox's new-device OTP |
| **External trigger** | cron-job.org | GitHub's built-in `schedule:` can run hours late |
| **State check before click** | Read the button + first-in time | Never double-punch |
| **Session carry-forward** | Encrypted Actions cache | Keeps the trusted session fresh, like a browser |
| **Single config** | `schedule.json` | Change shift or week offs in one place |

---

## 💻 Installation

### Prerequisites
- Node.js 18+ (22 recommended)
- A GitHub account (for the cloud layer)
- A free [cron-job.org](https://cron-job.org/) account
- macOS with Google Chrome (for the backup layer)
- *(Optional)* Gmail with an app password (for the OTP fallback)

### Quick Setup

#### 1️⃣ Clone Repository
```
git clone https://github.com/Ajinkyaa2004/Darwin-Automation.git
cd Darwin-Automation
npm install
```

#### 2️⃣ Cloud Layer (GitHub Actions + cron-job.org)

**a. Save a trusted session (once, on your Mac):**
```
node save-session.js
```
Sign in in the window that opens, tick **Remember me** and enter the OTP. The session is copied to your clipboard.

**b. Add repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `DARWINBOX_PASS` | Your Darwinbox password |
| `DARWINBOX_STATE` | The session from `save-session.js` |
| `GMAIL_USER` | *(optional)* Gmail address that receives forwarded OTPs |
| `GMAIL_APP_PASSWORD` | *(optional)* Gmail app password |

Set your employee ID in `.github/workflows/punch.yml` (`DARWINBOX_USER`).

**c. Create two cron-job.org jobs**, one for clock in and one for clock out:
- **URL:** `https://api.github.com/repos/<you>/Darwin-Automation/actions/workflows/punch.yml/dispatches`
- **Method:** `POST`
- **Headers:** `Authorization: Bearer <fine-grained token with Actions: read & write>`, `Accept: application/vnd.github+json`
- **Body:** `{"ref":"main","inputs":{"action":"in","dry_run":false}}` (use `"out"` for clock out)
- **Notifications:** turn on "execution of the cronjob fails".

#### 3️⃣ Mac Backup Layer
```
bash mac/install.sh     # saves login locally, schedules runs, sets the wake timer
node mac/login.js       # sign in once in Chrome, tick "Remember me"
```

**🔧 Verify (no click):**
```
MAC_PROFILE=1 DRY_RUN=1 FORCE=1 bash -c 'set -a; . ~/.darwinbox/env; node punch.js in'
```
Expected: `"ok": true` and `"reason": "dry run"`.

### Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `DARWINBOX_USER` / `DARWINBOX_PASS` | both | Darwinbox login |
| `DARWINBOX_STATE` | cloud | Bootstrap session (gzip + base64) |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | both | OTP fallback via IMAP |
| `MAC_PROFILE=1` | Mac | Use the persistent Chrome profile |
| `DRY_RUN=1` | both | Sign in and check, never click |
| `FORCE=1` | both | Ignore day/time guards (testing only) |

---

## 🎮 Usage

### Daily Workflow
Nothing to do. On working days:

| Time | What happens |
|---|---|
| Clock-in time | ☁️ Cloud clocks you in |
| +5 min | 💻 Mac checks. Already in? Nothing. Missed? Clocks in |
| Clock-out time | ☁️ Cloud clocks you out |
| +5 min | 💻 Mac checks again |

### 1️⃣ Run a Dry Test (cloud)
GitHub → **Actions** → **Darwinbox punch** → **Run workflow**, choose `in` or `out`, and keep **Dry run** ticked.

### 2️⃣ Check the Logs
- **Cloud:** the Actions tab → latest run → `punch` job
- **Mac:** `cat ~/.darwinbox/punch.log`

### 3️⃣ Re-login if Asked
If you get a ⚠️ notification after a long break or a password change:
```
node mac/login.js        # Mac backup
node save-session.js     # cloud: paste into the DARWINBOX_STATE secret
```

### 4️⃣ Uninstall the Mac Backup
```
bash mac/uninstall.sh
```

---

## ⚙️ Configuration

Everything schedule-related lives in **`schedule.json`**:

```
{
  "weekOffs": ["Sat", "Sun"],
  "clockIn": "10:00",
  "clockOut": "19:00"
}
```

- **Days:** `Sun` `Mon` `Tue` `Wed` `Thu` `Fri` `Sat`
- **Times:** 24-hour IST

### When Your Shift or Week Offs Change
1. **Edit `schedule.json`.** On GitHub: open the file → ✏️ → Commit.
2. **cron-job.org:** set both jobs to the new times. If a job's timezone is UTC, subtract 5 h 30 min.
3. **Mac:** `git pull && bash mac/install.sh`

---

## 📂 Project Structure

```
Darwin-Automation/
├── .github/
│   └── workflows/
│       └── punch.yml        # Cloud workflow (dispatch + keepalive)
├── mac/
│   ├── browser.js           # Persistent Chrome profile config
│   ├── install.sh           # Mac setup: launchd jobs + wake timer
│   ├── login.js             # One-time sign-in for the Mac profile
│   ├── run.sh               # Called by launchd, logs + notifies
│   └── uninstall.sh         # Removes the Mac backup
├── punch.js                 # Core: guards, sign-in, state check, single click
├── otp.js                   # Reads forwarded OTP emails over Gmail IMAP
├── save-session.js          # Saves a trusted session for the cloud layer
├── schedule.json            # Shift timings + week offs (the only file to edit)
├── package.json
└── README.md
```

---

## 🛡️ Safety & Guardrails

| Guard | Behaviour |
|---|---|
| **Button check** | Clicks only if the button shows the expected action |
| **First-in check** | Won't clock in again if a first-in time already exists |
| **Week offs** | Skipped automatically from `schedule.json` |
| **Time window** | Only from 30 min before to 3 h after the scheduled time |
| **Concurrency** | One cloud run at a time (`concurrency: darwinbox-punch`) |
| **Staggered layers** | The Mac runs 5 min after the cloud, so both never click at once |
| **No OTP guessing** | Uses only a fresh code, or presses **Resend OTP** once |

---

## 🧰 Troubleshooting

| Problem | Fix |
|---|---|
| `Darwinbox asked for an OTP` | Re-run `node save-session.js` (cloud) or `node mac/login.js` (Mac) |
| Cloud run never started | Check cron-job.org history. The GitHub token may have expired |
| Mac didn't run at clock-out | The Mac must be awake. Only one daily wake timer is allowed (used for clock-in) |
| Nothing ran after a restart | Log in to your Mac once. LaunchAgents load at login |
| `outside time window` | Expected outside the allowed window. Use `FORCE=1` only for dry tests |
| Cleaner app deleted the session | Add `~/.darwinbox` to its ignore list, then run `node mac/login.js` |

---

## 🗺️ Roadmap

### ✅ Completed
- [x] Cloud punches via GitHub Actions + cron-job.org
- [x] State check before click (no double punches)
- [x] Encrypted session carry-forward
- [x] OTP fallback via forwarded email
- [x] Mac backup with wake timer + notifications
- [x] Single `schedule.json` for shift and week offs

### 📅 Planned Features
- [ ] Skip dates for leave and holidays
- [ ] Wake timer for clock-out on the Mac
- [ ] Phone push notification on failure

---

## 🤝 Contributing

### Contributions are welcome! 🎉

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-idea`
3. Commit your changes: `git commit -m "Add your idea"`
4. Push and open a Pull Request

Please never commit `darwinbox-state.txt`, `.env` files or any credentials.

---

## 🛟 Support

### 🐛 Issues & Questions
Open an issue on [GitHub Issues](https://github.com/Ajinkyaa2004/Darwin-Automation/issues).

---

**Made with ❤️ by [Ajinkya Dhumal](https://github.com/Ajinkyaa2004) · [Actorix](https://actorix.in)**
