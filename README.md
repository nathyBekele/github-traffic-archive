# 📈 GitHub Traffic & Repository Analytics Archive

> **Never lose your repository traffic data again.** GitHub permanently discards views, clones, referrers, and path metrics after **14 days**. This standalone archive repository collects, aggregates, and permanently preserves your repository traffic forever, paired with an interactive **GitHub Pages** analytics dashboard.

---

## ✨ Features

- 🏛️ **Permanent Archiving**: Daily historical snapshots are merged and accumulated into clean JSON files (`data/repositories/{repo}.json` and `data/summary.json`).
- 📊 **Executive Dashboard**:
  - **Account-Wide KPIs**: All-time views, unique visitors, git clones, unique cloners, stars, and conversion rate.
  - **Interactive Chart**: Switch between Views/Uniques vs Clones/Cloners with rolling time windows (7d, 14d, 30d, 90d, All-Time).
  - **Leaderboard Table**: Sortable multi-repo performance table with instant search filtering.
  - **Traffic Attribution**: Top referrers (e.g., LinkedIn, Google, Reddit, Hacker News) and top paths/files.
- 🔍 **Repository Explorer (Deep Dive)**: Detailed view of each repository's daily traffic, cloners, conversion percentages, and unique content views.
- ⚖️ **Side-by-Side Comparison**: Overlay up to 4 repositories to compare audience growth trends.
- ⚡ **On-Demand Live Fetch**: Run real-time traffic queries directly in your browser anytime using a Personal Access Token without waiting for GitHub Actions.
- 🎨 **Modern UX**: Tailwind CSS, Chart.js, dark/light mode toggle, mobile responsive, zero build tooling required.

---

## 🚀 Quick Setup & Deployment (In 3 Minutes)

### Step 1: Create a New Repository on GitHub
1. Go to [github.com/new](https://github.com/new).
2. Name it (for example: `github-traffic-archive` or `traffic-dashboard`).
3. Set it to **Public** (or **Private** with GitHub Pages enabled).

### Step 2: Push This Folder to Your New Repository
In your terminal:
```bash
cd github-traffic-archive
git init
git add .
git commit -m "feat: initial commit of GitHub Traffic Archive system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/github-traffic-archive.git
git push -u origin main
```

### Step 3: Add Your Personal Access Token (PAT)
Traffic endpoints require a Personal Access Token with repository read permissions:
1. Generate a GitHub PAT (classic) with `repo` scope at: [github.com/settings/tokens/new?scopes=repo&description=traffic-archive](https://github.com/settings/tokens/new?scopes=repo&description=traffic-archive)
2. In your newly created `github-traffic-archive` repository on GitHub:
   - Go to **Settings** → **Secrets and variables** → **Actions**.
   - Click **New repository secret**.
   - **Name**: `PERSONAL_ACCESS_TOKEN`
   - **Secret**: Paste your token.

### Step 4: Enable GitHub Pages
1. Go to **Settings** → **Pages**.
2. Under **Build and deployment** → **Source**, select **GitHub Actions**.
3. Go to the **Actions** tab, click **Archive GitHub Traffic & Deploy Pages**, and click **Run workflow**.

Your analytics site will immediately be live at:
`https://YOUR_USERNAME.github.io/github-traffic-archive/`

---

## 🛠️ How It Works

1. **Daily Automation**: At `00:00 UTC` daily, GitHub Actions runs `collector.py`.
2. **Lossless Merging**: Fetches the rolling 14-day data from GitHub Traffic APIs (`/traffic/views`, `/traffic/clones`, `/traffic/popular/referrers`, `/traffic/popular/paths`) and merges it with existing records. Any day older than 14 days is retained forever.
3. **Automated Commit**: If new traffic is detected, GitHub Actions commits the updated `data/` folder back to `main`.
4. **Instant Deployment**: Deploys the static HTML5 dashboard to GitHub Pages.

---

## 🔒 Security & Privacy

- Your PAT is stored securely in GitHub repository secrets and never exposed in the generated client files.
- In the on-demand live fetch tool, tokens are stored solely in your browser's private `localStorage` and sent directly to `api.github.com` over HTTPS.

---

## 📜 License
MIT License. Free to use, adapt, and customize for personal and enterprise portfolios.
