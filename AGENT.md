# Agent Guide for GitHub Traffic Archive

Welcome! If you are an AI assistant or agent interacting with this repository, this document provides the necessary context on how the system works, its architecture, and how to operate it.

## Overview

**GitHub Traffic Archive** is a system that circumvents GitHub's 14-day limit on repository traffic data. It automatically fetches, merges, and stores traffic metrics (views, clones, referrers, paths) into a static JSON format, and serves it through an HTML5 dashboard.

## File Structure

- `collector.py`: The core Python script that talks to the GitHub API. It runs daily via GitHub Actions. It fetches the latest 14 days of traffic and merges it losslessly with existing records.
- `app.js`: The frontend JavaScript that parses the JSON data and renders the interactive dashboard (using Chart.js).
- `index.html`: The HTML layout for the dashboard. It uses Tailwind CSS (via CDN) for styling.
- `data/summary.json`: The aggregated output from `collector.py`. Contains account-wide KPIs, multi-repo leaderboards, and timelines.
- `data/history_log.json`: A log of the automated runs (successes and errors).
- `data/repositories/{repo}.json`: (Dynamically generated) Deep-dive historical records for individual repositories.

## Core Mechanisms

### Data Merging (`collector.py`)
GitHub only provides the last 14 days of data in rolling windows. The Python script downloads this data, loads the existing `JSON` files from the `data/` folder, and updates the existing records. It ensures that any data older than 14 days is retained forever. It uses simple timestamps to de-duplicate entries.

### The Dashboard (`app.js` and `index.html`)
The frontend is completely static and requires no build tools (No Webpack, Vite, or React). It fetches `./data/summary.json` to load the initial views. If the user clicks on a specific repository, it fetches `./data/repositories/{repo_name}.json`.

## Agent Instructions & Workflows

### 1. Running the Project Locally
If a user asks how to run the project locally, guide them to start a simple HTTP server in the root directory, like so:
```bash
python3 -m http.server 3030
```
Then they can visit `http://localhost:3030`.
*(Note: If they have another app running on 8000, always suggest an alternative port like 3030).*

### 2. Modifying the Frontend
- **CSS**: The project uses Tailwind CSS via a CDN script tag in `index.html`. Do not attempt to install `npm` packages for Tailwind; just use standard Tailwind utility classes directly in the HTML or `app.js` string templates.
- **JavaScript**: It uses vanilla JavaScript. `app.js` handles all state, rendering, and Chart.js initialization.

### 3. Modifying the Backend / Collector
- The `collector.py` script uses only the Python Standard Library (`urllib`, `json`, `os`, `datetime`). **Do not introduce external dependencies like `requests` or `pandas`** unless explicitly requested by the user, as the goal is to keep the GitHub Action fast and lightweight.
- The collector expects a GitHub Personal Access Token in the `GITHUB_TOKEN`, `GH_TOKEN`, or `TRAFFIC_TOKEN` environment variable.

### 4. Testing the Collector Locally
To run the collector locally to fetch real data:
1. The user must provide a valid GitHub PAT.
2. Run: `GITHUB_TOKEN="your_token_here" python3 collector.py`
This will update the `data/` folder in place.

## Common Tasks

- **Updating Charts**: If you need to add a new chart, modify `app.js` and ensure Chart.js is properly initialized. Look for existing chart instances (e.g., `mainChart`) and follow the same pattern.
- **Adding new GitHub metrics**: You will need to update `collector.py` to call the new API endpoint, update the merge logic to save the data, and then update `app.js` and `index.html` to display it.