# Deploying Telegram Attendance Bot to Railway

### Step 1: Create a GitHub Repository
1. Open your GitHub account and create a new repository (e.g., `telegram-attendance-bot`).
2. Upload all files inside `C:\Users\HP\.gemini\antigravity\scratch\telegram-attendance-bot`:
   - `package.json`
   - `index.js`

---

### Step 2: Deploy on Railway
1. Go to [Railway.app](https://railway.app/) and sign in.
2. Click **+ New Project** -> Select **Deploy from GitHub repo**.
3. Select your newly created `telegram-attendance-bot` repository.
4. Click **Deploy Now**.

---

### Step 3: Add Environment Variables (Variables Tab in Railway)
In your Railway Project settings -> **Variables** tab, add the following key-value pairs:

| Variable Name | Value |
| --- | --- |
| `BOT_TOKEN` | `8974478810:AAEgxD-ikJrMwV_JSBJY9F45ppBhefoZjtg` |
| `GROUP_CHAT_ID` | `-1003493006883` |
| `SPREADSHEET_ID` | `123XUsCdQRMTt_HtcHclEE8RRoFYoAl27KDBi1Ealn3E` |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | *Your Google Service Account Email* |
| `GOOGLE_PRIVATE_KEY` | *Your Google Service Account Private Key* |

---

### Key Features Included:
- ⏰ **6:00 AM Daily Morning Announcement** (`cron.schedule('0 6 * * *')`)
- 📊 **9:00 PM Daily Attendance Report Summary** with Absentee warnings (`cron.schedule('0 21 * * *')`)
- ⏱️ **6:00 AM – 10:00 AM Attendance Window Enforcement** (Rejects `/present` or `/leave` outside this window and auto-deletes the notice after 15s)
- 🔥 **Streak Calculation & Badges** (Rising Star, Silver, Gold, Legend)
- 📋 **`/admission form` Command Response**
- 👤 **`/mystatus` Command** with personal stats (Auto-deletes card after 60 seconds)
- 🧹 **Auto Message Deletion:** User command messages and bot responses auto-delete seamlessly.
