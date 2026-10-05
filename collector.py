#!/usr/bin/env python3
"""
GitHub Traffic & Repository Metrics Archiver
---------------------------------------------
Fetches, accumulates, and permanently preserves GitHub repository traffic
(views, unique visitors, clones, unique cloners, referrers, and paths)
which GitHub otherwise permanently deletes after 14 days.

Generates:
- data/repositories/{repo}.json (deep-dive historical records)
- data/summary.json (aggregated multi-repo timeline, leaderboards, KPIs)
- data/history_log.json (run audit log)

Zero external dependencies required (uses standard library: urllib, json, os).
"""

import os
import sys
import json
import time
from datetime import datetime, timezone
import urllib.request
import urllib.error

# Configuration from Environment Variables
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or os.environ.get("TRAFFIC_TOKEN", "").strip()
GITHUB_OWNER = os.environ.get("GITHUB_OWNER", "").strip()
INCLUDE_FORKS = os.environ.get("INCLUDE_FORKS", "false").lower() in ("true", "1", "yes")
EXCLUDE_REPOS = [r.strip().lower() for r in os.environ.get("EXCLUDE_REPOS", "").split(",") if r.strip()]
ONLY_REPOS = [r.strip().lower() for r in os.environ.get("ONLY_REPOS", "").split(",") if r.strip()]
DATA_DIR = os.environ.get("DATA_DIR", "data")
REPOS_DIR = os.path.join(DATA_DIR, "repositories")


def log(msg):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"[{now}] {msg}", flush=True)


def github_api_request(url, token):
    """Make authenticated request to GitHub API with error handling and rate limit tracking."""
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "GitHub-Traffic-Archiver"
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            remaining = response.headers.get("X-RateLimit-Remaining")
            if remaining and int(remaining) < 10:
                log(f"WARNING: GitHub API Rate limit low! Remaining: {remaining}")
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 403 and "rate limit" in str(e.reason).lower():
            log(f"ERROR: GitHub API rate limit exceeded on {url}")
        elif e.code == 404:
            return None  # Endpoint or traffic data not found / no access
        elif e.code == 403:
            # Often permission denied for traffic if token lacks push/repo access
            return None
        log(f"HTTPError {e.code} for {url}: {e.reason}")
        return None
    except Exception as e:
        log(f"Request failed for {url}: {e}")
        return None


def get_all_repositories(token, specified_owner=None):
    """Retrieve all repositories for the authenticated user or specified owner."""
    repos = []
    page = 1

    if token:
        # Authenticated user - gets all owned repos (including private if token has repo scope)
        endpoint = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page="
    elif specified_owner:
        endpoint = f"https://api.github.com/users/{specified_owner}/repos?per_page=100&page="
    else:
        endpoint = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page="

    while True:
        url = f"{endpoint}{page}"
        batch = github_api_request(url, token)
        if not batch or not isinstance(batch, list) or len(batch) == 0:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1

    # Filter out forks or excluded repos
    filtered = []
    for r in repos:
        name = r.get("name", "")
        name_lower = name.lower()

        if ONLY_REPOS and name_lower not in ONLY_REPOS:
            continue
        if name_lower in EXCLUDE_REPOS:
            continue
        if r.get("fork") and not INCLUDE_FORKS:
            continue

        filtered.append(r)

    return filtered


def normalize_date(timestamp_str):
    """Convert ISO timestamp (e.g. 2026-10-02T00:00:00Z) to YYYY-MM-DD."""
    if not timestamp_str:
        return None
    return timestamp_str[:10]


def load_json(filepath, default=None):
    if default is None:
        default = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log(f"Error reading {filepath}: {e}")
    return default


def save_json(filepath, data):
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    temp_path = f"{filepath}.tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(temp_path, filepath)


def merge_time_series(existing_list, incoming_list):
    """
    Merge daily time series (views or clones).
    Format of items: {"date": "YYYY-MM-DD", "count": int, "uniques": int}
    Preserves all historical dates forever. If date matches, uses highest count & uniques.
    """
    by_date = {}

    for item in existing_list or []:
        dt = item.get("date") or normalize_date(item.get("timestamp"))
        if dt:
            by_date[dt] = {
                "date": dt,
                "count": int(item.get("count", 0)),
                "uniques": int(item.get("uniques", 0))
            }

    for item in incoming_list or []:
        dt = item.get("date") or normalize_date(item.get("timestamp"))
        if dt:
            cnt = int(item.get("count", 0))
            unq = int(item.get("uniques", 0))
            if dt in by_date:
                by_date[dt]["count"] = max(by_date[dt]["count"], cnt)
                by_date[dt]["uniques"] = max(by_date[dt]["uniques"], unq)
            else:
                by_date[dt] = {"date": dt, "count": cnt, "uniques": unq}

    # Sort chronologically
    sorted_dates = sorted(by_date.keys())
    return [by_date[d] for d in sorted_dates]


def merge_referrers(existing_referrers, incoming_referrers, run_date):
    """
    Merge referrer statistics with cumulative tracking and history.
    """
    ref_map = {}
    for r in existing_referrers or []:
        name = r.get("referrer")
        if name:
            ref_map[name] = {
                "referrer": name,
                "total_count": int(r.get("total_count", r.get("count", 0))),
                "total_uniques": int(r.get("total_uniques", r.get("uniques", 0))),
                "latest_count": int(r.get("latest_count", r.get("count", 0))),
                "latest_uniques": int(r.get("latest_uniques", r.get("uniques", 0))),
                "last_seen": r.get("last_seen", run_date)
            }

    for r in incoming_referrers or []:
        name = r.get("referrer")
        cnt = int(r.get("count", 0))
        unq = int(r.get("uniques", 0))
        if not name:
            continue

        if name in ref_map:
            prev = ref_map[name]
            # If latest is different, update cumulative delta or retain max
            delta_count = max(0, cnt - prev["latest_count"])
            delta_uniques = max(0, unq - prev["latest_uniques"])
            prev["total_count"] += delta_count
            prev["total_uniques"] += delta_uniques
            prev["latest_count"] = cnt
            prev["latest_uniques"] = unq
            prev["last_seen"] = run_date
        else:
            ref_map[name] = {
                "referrer": name,
                "total_count": cnt,
                "total_uniques": unq,
                "latest_count": cnt,
                "latest_uniques": unq,
                "last_seen": run_date
            }

    # Sort by total_count descending
    return sorted(ref_map.values(), key=lambda x: x["total_count"], reverse=True)


def merge_paths(existing_paths, incoming_paths, run_date):
    """
    Merge top paths statistics with cumulative tracking and history.
    """
    path_map = {}
    for p in existing_paths or []:
        pth = p.get("path")
        if pth:
            path_map[pth] = {
                "path": pth,
                "title": p.get("title", pth),
                "total_count": int(p.get("total_count", p.get("count", 0))),
                "total_uniques": int(p.get("total_uniques", p.get("uniques", 0))),
                "latest_count": int(p.get("latest_count", p.get("count", 0))),
                "latest_uniques": int(p.get("latest_uniques", p.get("uniques", 0))),
                "last_seen": p.get("last_seen", run_date)
            }

    for p in incoming_paths or []:
        pth = p.get("path")
        cnt = int(p.get("count", 0))
        unq = int(p.get("uniques", 0))
        title = p.get("title", pth)
        if not pth:
            continue

        if pth in path_map:
            prev = path_map[pth]
            delta_count = max(0, cnt - prev["latest_count"])
            delta_uniques = max(0, unq - prev["latest_uniques"])
            prev["total_count"] += delta_count
            prev["total_uniques"] += delta_uniques
            prev["latest_count"] = cnt
            prev["latest_uniques"] = unq
            prev["title"] = title
            prev["last_seen"] = run_date
        else:
            path_map[pth] = {
                "path": pth,
                "title": title,
                "total_count": cnt,
                "total_uniques": unq,
                "latest_count": cnt,
                "latest_uniques": unq,
                "last_seen": run_date
            }

    return sorted(path_map.values(), key=lambda x: x["total_count"], reverse=True)


def process_repository(repo, token, run_date, run_iso):
    """
    Fetch live 14-day metrics for a single repository and merge with historical archive.
    """
    name = repo["name"]
    full_name = repo["full_name"]
    owner = repo["owner"]["login"]
    filepath = os.path.join(REPOS_DIR, f"{name}.json")

    existing_record = load_json(filepath, {})

    # Fetch live traffic data endpoints
    base_traffic_url = f"https://api.github.com/repos/{owner}/{name}/traffic"

    views_data = github_api_request(f"{base_traffic_url}/views?per=day", token) or {}
    clones_data = github_api_request(f"{base_traffic_url}/clones?per=day", token) or {}
    referrers_data = github_api_request(f"{base_traffic_url}/popular/referrers", token) or []
    paths_data = github_api_request(f"{base_traffic_url}/popular/paths", token) or []
    
    # Fetch list of people who forked the repository
    forks_data = github_api_request(f"https://api.github.com/repos/{owner}/{name}/forks?per_page=100&sort=newest", token) or []
    
    # Merge with existing forkers to not lose anyone past 100
    existing_forkers = existing_record.get("forker_list", [])
    forker_dict = {f["login"]: f for f in existing_forkers}
    
    if forks_data:
        for f in forks_data:
            login = f["owner"]["login"]
            forker_dict[login] = {
                "login": login,
                "avatar_url": f["owner"]["avatar_url"],
                "html_url": f["owner"]["html_url"],
                "created_at": normalize_date(f.get("created_at", run_iso))
            }
            
    # Sort forkers by creation date descending
    forker_list = sorted(list(forker_dict.values()), key=lambda x: x["created_at"], reverse=True)

    # Merge time series
    incoming_views = views_data.get("views", [])
    merged_views = merge_time_series(existing_record.get("views", []), incoming_views)

    incoming_clones = clones_data.get("clones", [])
    merged_clones = merge_time_series(existing_record.get("clones", []), incoming_clones)

    # Merge referrers and paths
    merged_referrers = merge_referrers(existing_record.get("referrers", []), referrers_data, run_date)
    merged_paths = merge_paths(existing_record.get("paths", []), paths_data, run_date)

    # Calculate All-time and 14-day totals
    all_time_views = sum(v["count"] for v in merged_views)
    all_time_uniques = sum(v["uniques"] for v in merged_views)
    all_time_clones = sum(c["count"] for c in merged_clones)
    all_time_unique_cloners = sum(c["uniques"] for c in merged_clones)

    # Calculate exact 14-day rolling window based on calendar date
    cutoff_dt = datetime.fromisoformat(run_iso.replace("Z", "+00:00"))
    from datetime import timedelta
    cutoff_date = (cutoff_dt - timedelta(days=14)).strftime("%Y-%m-%d")

    last_14_views = [v for v in merged_views if v["date"] >= cutoff_date]
    views_14d = sum(v["count"] for v in last_14_views)
    uniques_14d = sum(v["uniques"] for v in last_14_views)

    last_14_clones = [c for c in merged_clones if c["date"] >= cutoff_date]
    clones_14d = sum(c["count"] for c in last_14_clones)
    unique_cloners_14d = sum(c["uniques"] for c in last_14_clones)

    conversion_rate = round((all_time_clones / all_time_views * 100), 1) if all_time_views > 0 else 0.0

    # Build updated repo record
    updated_record = {
        "name": name,
        "full_name": full_name,
        "owner": owner,
        "description": repo.get("description") or "",
        "html_url": repo.get("html_url"),
        "homepage": repo.get("homepage") or "",
        "language": repo.get("language") or "Other",
        "topics": repo.get("topics") or [],
        "stars": repo.get("stargazers_count", 0),
        "forks": repo.get("forks_count", 0),
        "forker_list": forker_list,
        "open_issues": repo.get("open_issues_count", 0),
        "watchers": repo.get("watchers_count", 0),
        "license": repo.get("license", {}).get("name") if repo.get("license") else None,
        "is_private": repo.get("private", False),
        "is_fork": repo.get("fork", False),
        "created_at": repo.get("created_at"),
        "updated_at": repo.get("updated_at"),
        "pushed_at": repo.get("pushed_at"),
        "last_synced": run_iso,
        "summary": {
            "all_time_views": all_time_views,
            "all_time_uniques": all_time_uniques,
            "all_time_clones": all_time_clones,
            "all_time_unique_cloners": all_time_unique_cloners,
            "views_14d": views_14d,
            "uniques_14d": uniques_14d,
            "clones_14d": clones_14d,
            "unique_cloners_14d": unique_cloners_14d,
            "clone_conversion_pct": conversion_rate,
            "days_tracked": len(merged_views)
        },
        "views": merged_views,
        "clones": merged_clones,
        "referrers": merged_referrers,
        "paths": merged_paths
    }

    save_json(filepath, updated_record)
    log(f"Archived {name}: {all_time_views} all-time views ({views_14d} in 14d), {all_time_clones} clones.")
    return updated_record


def build_summary(repo_records, run_iso):
    """
    Construct global overview summary across all tracked repositories:
    Aggregated daily timeline, leaderboard, top referrers, languages, and totals.
    """
    timeline_map = {}
    global_referrers = {}
    global_paths = {}
    languages = {}

    total_stars = 0
    total_forks = 0
    total_open_issues = 0
    total_views_all_time = 0
    total_uniques_all_time = 0
    total_clones_all_time = 0
    total_unique_cloners_all_time = 0
    total_views_14d = 0
    total_clones_14d = 0

    repo_summaries = []

    for r in repo_records:
        name = r["name"]
        total_stars += r.get("stars", 0)
        total_forks += r.get("forks", 0)
        total_open_issues += r.get("open_issues", 0)

        s = r.get("summary", {})
        total_views_all_time += s.get("all_time_views", 0)
        total_uniques_all_time += s.get("all_time_uniques", 0)
        total_clones_all_time += s.get("all_time_clones", 0)
        total_unique_cloners_all_time += s.get("all_time_unique_cloners", 0)
        total_views_14d += s.get("views_14d", 0)
        total_clones_14d += s.get("clones_14d", 0)

        lang = r.get("language") or "Other"
        languages[lang] = languages.get(lang, 0) + 1

        # Aggregate daily views
        for v in r.get("views", []):
            dt = v["date"]
            if dt not in timeline_map:
                timeline_map[dt] = {"date": dt, "views": 0, "uniques": 0, "clones": 0, "unique_cloners": 0}
            timeline_map[dt]["views"] += v["count"]
            timeline_map[dt]["uniques"] += v["uniques"]

        # Aggregate daily clones
        for c in r.get("clones", []):
            dt = c["date"]
            if dt not in timeline_map:
                timeline_map[dt] = {"date": dt, "views": 0, "uniques": 0, "clones": 0, "unique_cloners": 0}
            timeline_map[dt]["clones"] += c["count"]
            timeline_map[dt]["unique_cloners"] += c["uniques"]

        # Aggregate referrers
        for ref in r.get("referrers", []):
            ref_name = ref.get("referrer")
            if not ref_name:
                continue
            if ref_name not in global_referrers:
                global_referrers[ref_name] = {"referrer": ref_name, "count": 0, "uniques": 0}
            global_referrers[ref_name]["count"] += ref.get("total_count", ref.get("count", 0))
            global_referrers[ref_name]["uniques"] += ref.get("total_uniques", ref.get("uniques", 0))

        # Aggregate paths
        for pth in r.get("paths", []):
            p_val = pth.get("path")
            if not p_val:
                continue
            if p_val not in global_paths:
                global_paths[p_val] = {"path": p_val, "title": pth.get("title", p_val), "count": 0, "uniques": 0}
            global_paths[p_val]["count"] += pth.get("total_count", pth.get("count", 0))
            global_paths[p_val]["uniques"] += pth.get("total_uniques", pth.get("uniques", 0))

        # Compact summary for the leaderboard
        repo_summaries.append({
            "name": name,
            "full_name": r.get("full_name"),
            "html_url": r.get("html_url"),
            "description": r.get("description"),
            "language": r.get("language"),
            "topics": r.get("topics", []),
            "stars": r.get("stars", 0),
            "forks": r.get("forks", 0),
            "open_issues": r.get("open_issues", 0),
            "is_private": r.get("is_private", False),
            "is_fork": r.get("is_fork", False),
            "views_14d": s.get("views_14d", 0),
            "uniques_14d": s.get("uniques_14d", 0),
            "clones_14d": s.get("clones_14d", 0),
            "all_time_views": s.get("all_time_views", 0),
            "all_time_clones": s.get("all_time_clones", 0),
            "clone_conversion_pct": s.get("clone_conversion_pct", 0),
            "last_synced": r.get("last_synced")
        })

    # Sort repos by 14d views descending
    repo_summaries.sort(key=lambda x: (x["views_14d"], x["all_time_views"], x["stars"]), reverse=True)

    # Sort timeline
    sorted_timeline = [timeline_map[d] for d in sorted(timeline_map.keys())]

    # Sort global referrers & paths
    sorted_referrers = sorted(global_referrers.values(), key=lambda x: x["count"], reverse=True)
    sorted_paths = sorted(global_paths.values(), key=lambda x: x["count"], reverse=True)

    summary = {
        "updated_at": run_iso,
        "total_repositories_tracked": len(repo_records),
        "kpis": {
            "all_time_views": total_views_all_time,
            "all_time_uniques": total_uniques_all_time,
            "all_time_clones": total_clones_all_time,
            "all_time_unique_cloners": total_unique_cloners_all_time,
            "views_14d": total_views_14d,
            "clones_14d": total_clones_14d,
            "total_stars": total_stars,
            "total_forks": total_forks,
            "total_open_issues": total_open_issues
        },
        "daily_timeline": sorted_timeline,
        "repositories": repo_summaries,
        "top_referrers": sorted_referrers[:20],
        "top_paths": sorted_paths[:20],
        "languages": languages
    }

    summary_path = os.path.join(DATA_DIR, "summary.json")
    save_json(summary_path, summary)
    log(f"Summary generated at {summary_path} with {len(repo_records)} repositories and {len(sorted_timeline)} days of history.")
    return summary


def update_run_log(run_iso, repo_count, total_views, total_clones):
    """Keep a lightweight audit log of sync runs."""
    log_path = os.path.join(DATA_DIR, "history_log.json")
    logs = load_json(log_path, [])
    logs.insert(0, {
        "run_at": run_iso,
        "repos_tracked": repo_count,
        "views_14d": total_views,
        "clones_14d": total_clones
    })
    # Keep last 100 sync records
    save_json(log_path, logs[:100])


def main():
    log("Starting GitHub Traffic & Metrics Collection...")
    run_dt = datetime.now(timezone.utc)
    run_date = run_dt.strftime("%Y-%m-%d")
    run_iso = run_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    if not GITHUB_TOKEN:
        log("WARNING: GITHUB_TOKEN is not set.")
        log("Traffic endpoints require a Personal Access Token with 'repo' scope.")
        log("Without a token, only public metadata (stars, forks) can be fetched.")

    # 1. Discover repositories
    repos = get_all_repositories(GITHUB_TOKEN, GITHUB_OWNER)
    log(f"Found {len(repos)} repositories to process.")

    # 2. Process each repository
    repo_records = []
    for r in repos:
        name = r["name"]
        try:
            record = process_repository(r, GITHUB_TOKEN, run_date, run_iso)
            repo_records.append(record)
            # Slight sleep to be polite to GitHub API
            time.sleep(0.15)
        except Exception as e:
            log(f"Error processing repository {name}: {e}")

    # 3. Build global summary
    summary = build_summary(repo_records, run_iso)

    # 4. Update audit log
    kpis = summary.get("kpis", {})
    update_run_log(run_iso, len(repo_records), kpis.get("views_14d", 0), kpis.get("clones_14d", 0))

    log("Collection completed successfully!")


if __name__ == "__main__":
    main()
