# GitHub Traffic Archive

A tool to automatically collect and save your GitHub repository traffic data before GitHub deletes it (which happens every 14 days). It includes a web dashboard to view your historical traffic.

## How to Use This for Your Own Account

Follow these steps to set up the archive for your GitHub account:

### 1. Create your repository
Create a new public or private repository on GitHub (e.g., `github-traffic-archive`).

### 2. Push this code
Push the contents of this project to your new repository.

### 3. Add your access token
The tool needs permission to read your repository traffic.
1. Generate a GitHub Personal Access Token (classic) with the `repo` scope.
2. Go to your new repository's settings on GitHub.
3. Under **Secrets and variables** -> **Actions**, add a new repository secret.
4. Name the secret `PERSONAL_ACCESS_TOKEN` and paste your token as the value.

### 4. Enable the dashboard
1. In your repository settings, go to **Pages**.
2. Under **Build and deployment**, set the source to **GitHub Actions**.
3. Go to the **Actions** tab in your repository and manually run the "Archive GitHub Traffic & Deploy Pages" workflow.

Your dashboard will now be automatically updated every day and will be visible at `https://[YOUR_USERNAME].github.io/[YOUR_REPO_NAME]/`.

## Running Locally

To test or view the dashboard on your own computer, you can run a local web server. 

Open your terminal in this project's folder and run the following command (using port 8080 to avoid conflicts):

```bash
python3 -m http.server 3030
```

Then, open `http://localhost:3030` in your web browser.

## How It Works

1. A scheduled task runs every day using GitHub Actions.
2. It fetches your latest traffic data using the GitHub API.
3. It saves and merges this new data into the `data/` folder, keeping your old data safe.
4. It updates the web dashboard so you can view your combined historical data.
