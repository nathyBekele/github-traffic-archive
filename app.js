/**
 * GitHub Traffic Archive - Modern Interactive Dashboard
 * Handles aggregated timeline, multi-repo leaderboards, deep-dive views, and live on-demand fetching.
 */

// Application State
const state = {
  summary: null,
  repoDetails: {},
  currentTab: 'overview',
  globalMetric: 'views', // 'views' or 'clones'
  globalRange: 30, // days (0 = all time)
  selectedRepo: null,
  comparedRepos: [],
  leaderboardRange: { type: 'days', value: 14, start: null, end: null },
  repoViewMode: 'grid', // 'grid' or 'table'
  repoCardCols: 3, // 2 or 3 columns in grid mode
  charts: {
    global: null,
    repoViews: null,
    repoClones: null,
    compare: null
  },
  tableSort: {
    column: 'range_clones',
    asc: false
  },
  searchQuery: '',
  inFlightFetches: new Map() // Track ongoing requests
};

// GitHub Official Language Colors Map
const GITHUB_LANGUAGE_COLORS = {
  Python: '#3572A5',
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  HTML: '#e34c26',
  CSS: '#563d7c',
  'Jupyter Notebook': '#DA5B0B',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  PHP: '#4F5D95',
  Ruby: '#701516',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Shell: '#89e051',
  Vue: '#41b883',
  React: '#61dafb',
  Dart: '#00B4AB',
  Scala: '#c22d40',
  R: '#198CE7',
  Perl: '#0298c3',
  Lua: '#000080',
  Liquid: '#67b8de',
  Other: '#8b949e'
};

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================================
// Initialization & Theme Handling
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initPatInput();
  initRouting();
  initRepoViewMode();
  updateProfileLocalTime();
  setInterval(updateProfileLocalTime, 30000);
  loadData();
});

function updateProfileLocalTime() {
  const el = document.getElementById('profileLocalTime');
  if (!el) return;
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Addis_Ababa',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    el.textContent = formatter.format(now);
  } catch (e) {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const userTime = new Date(utc + (3600000 * 3));
    const hours = String(userTime.getHours()).padStart(2, '0');
    const minutes = String(userTime.getMinutes()).padStart(2, '0');
    el.textContent = `${hours}:${minutes}`;
  }
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  // Default to dark mode if nothing is saved
  const isDark = saved ? saved === 'dark' : true;
  applyTheme(isDark);
}

function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(!isDark);
  // Re-render charts with updated theme colors
  renderGlobalChart();
  if (state.selectedRepo) renderRepoCharts(state.selectedRepo);
  if (state.comparedRepos.length > 0) renderCompareChart();
}

function applyTheme(dark) {
  const root = document.documentElement;
  const icon = document.getElementById('themeIcon');
  if (dark) {
    root.classList.add('dark');
    icon.className = 'fa-solid fa-sun';
    localStorage.setItem('theme', 'dark');
  } else {
    root.classList.remove('dark');
    icon.className = 'fa-solid fa-moon';
    localStorage.setItem('theme', 'light');
  }
}

function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

function getChartColors() {
  const dark = isDarkMode();
  return {
    grid: dark ? 'rgba(75, 85, 99, 0.2)' : 'rgba(229, 231, 235, 0.8)',
    text: dark ? '#9ca3af' : '#6b7280',
    tooltipBg: dark ? '#181b21' : '#ffffff',
    tooltipBorder: dark ? '#272b36' : '#e5e7eb',
    tooltipText: dark ? '#f9fafb' : '#111827'
  };
}

function formatDateLabel(dateString) {
  if (!dateString) return '';
  // Parse 'YYYY-MM-DD' as local time to avoid timezone offset issues
  const [year, month, day] = dateString.split('-');
  const date = new Date(year, month - 1, day);
  if (isNaN(date)) return dateString;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ============================================================================
// Navigation Tabs & Client-Side Routing
// ============================================================================
function getYesterdayDateStr() {
  const now = new Date();
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const localYesterday = new Date(localToday.getTime() - 24 * 60 * 60 * 1000);
  const yYear = localYesterday.getFullYear();
  const yMonth = String(localYesterday.getMonth() + 1).padStart(2, '0');
  const yDay = String(localYesterday.getDate()).padStart(2, '0');
  return `${yYear}-${yMonth}-${yDay}`;
}

function mergeClientTimeSeries(existingList, incomingList) {
  const byDate = {};

  (existingList || []).forEach(item => {
    const dt = item.date || (item.timestamp ? item.timestamp.slice(0, 10) : null);
    if (dt) {
      byDate[dt] = {
        date: dt,
        count: parseInt(item.count || 0, 10),
        uniques: parseInt(item.uniques || 0, 10)
      };
    }
  });

  (incomingList || []).forEach(item => {
    const dt = item.date || (item.timestamp ? item.timestamp.slice(0, 10) : null);
    if (dt) {
      const cnt = parseInt(item.count || 0, 10);
      const unq = parseInt(item.uniques || 0, 10);
      if (byDate[dt]) {
        byDate[dt].count = Math.max(byDate[dt].count, cnt);
        byDate[dt].uniques = Math.max(byDate[dt].uniques, unq);
      } else {
        byDate[dt] = { date: dt, count: cnt, uniques: unq };
      }
    }
  });

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

function navigateTo(tabId, repoName = null) {
  if (repoName) {
    state.selectedRepo = repoName;
  }
  switchTab(tabId, true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchTab(tabId, pushHistory = true) {
  state.currentTab = tabId;
  const tabs = ['overview', 'explorer', 'compare', 'live'];

  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tabBtn-${t}`);
    if (t === tabId) {
      if (el) el.classList.remove('hidden');
      if (btn) {
        btn.className = 'tab-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] transition-all text-gray-900 dark:text-white bg-gray-100 dark:bg-[#202020] shadow-xs border border-[#d0d7de] dark:border-[#30363d] font-semibold text-xs whitespace-nowrap';
        btn.setAttribute('aria-selected', 'true');
      }
    } else {
      if (el) el.classList.add('hidden');
      if (btn) {
        btn.className = 'tab-btn flex items-center gap-1.5 px-2.5 py-1.5 rounded-[5px] transition-all text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100/70 dark:hover:bg-[#202020] font-medium text-xs border border-transparent whitespace-nowrap';
        btn.setAttribute('aria-selected', 'false');
      }
    }
  });

  if (pushHistory) {
    let targetHash = '#/overview';
    if (tabId === 'explorer') {
      targetHash = state.selectedRepo ? `#/inspect?repo=${encodeURIComponent(state.selectedRepo)}` : `#/inspect`;
    } else if (tabId === 'compare') {
      targetHash = `#/compare`;
    } else if (tabId === 'live') {
      targetHash = `#/live`;
    }
    if (window.location.hash !== targetHash) {
      window.history.pushState({ tab: tabId, repo: state.selectedRepo }, '', targetHash);
    }
  }

  if (tabId === 'overview') {
    renderGlobalChart();
  } else if (tabId === 'explorer') {
    if (state.selectedRepo) {
      const dropdown = document.getElementById('repoDropdown');
      if (dropdown && dropdown.value !== state.selectedRepo) {
        dropdown.value = state.selectedRepo;
      }
      onRepoSelect(state.selectedRepo);
    }
  } else if (tabId === 'compare') {
    renderCompareTab();
  }
}

function handleRoute() {
  const hash = window.location.hash || '';
  if (hash.startsWith('#/inspect') || hash.startsWith('#inspect')) {
    const queryPart = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(queryPart);
    const repo = params.get('repo');
    if (repo) {
      state.selectedRepo = repo;
      const dropdown = document.getElementById('repoDropdown');
      if (dropdown) dropdown.value = repo;
      onRepoSelect(repo);
    } else if (state.selectedRepo) {
      onRepoSelect(state.selectedRepo);
    }
    switchTab('explorer', false);
  } else if (hash.startsWith('#/compare') || hash.startsWith('#compare')) {
    switchTab('compare', false);
  } else if (hash.startsWith('#/live') || hash.startsWith('#live')) {
    switchTab('live', false);
  } else {
    switchTab('overview', false);
  }
}

function initRouting() {
  window.addEventListener('popstate', () => handleRoute());
  window.addEventListener('hashchange', () => handleRoute());
}

function toggleMobileMenu() {
  const m = document.getElementById('mobileMenu');
  if (m) m.classList.toggle('hidden');
}

// ============================================================================
// Data Loading (Static Archive or Realistic Demo Fallback)
// ============================================================================
async function loadData() {
  try {
    const res = await fetch('./data/summary.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.summary = data;
    computeLeaderboardStats();
    populateDashboard(data);

    // Apply any initial route from URL
    handleRoute();

    // Fetch in background for faster custom date range interactions
    ensureAllRepoDetailsLoaded().then(() => {
      // Re-compute and re-render once all background data arrives
      computeLeaderboardStats();
      renderRepositories();
    });
  } catch (err) {
    console.warn('Could not load ./data/summary.json, generating preview dataset:', err);
    document.getElementById('offlineNotice').classList.remove('hidden');
    const demoData = generatePreviewData();
    state.summary = demoData;
    computeLeaderboardStats();
    populateDashboard(demoData);
    handleRoute();
  }
}

async function ensureAllRepoDetailsLoaded() {
  if (!state.summary || !state.summary.repositories) return;
  
  const CONCURRENCY_LIMIT = 5;
  let active = 0;
  let queue = [...state.summary.repositories];
  
  await new Promise(resolveAll => {
    const next = () => {
      // Skip repos that are already fetched or currently fetching
      while(queue.length > 0 && (state.repoDetails[queue[0].name] || state.inFlightFetches.has(queue[0].name))) {
        queue.shift();
      }

      if (queue.length === 0 && active === 0) {
        resolveAll();
        return;
      }

      while (active < CONCURRENCY_LIMIT && queue.length > 0) {
        const r = queue.shift();
        
        active++;
        const fetchPromise = fetch(`./data/repositories/${r.name}.json`)
          .then(res => {
            if (res.ok) return res.json();
            throw new Error('Failed');
          })
          .then(data => {
            state.repoDetails[r.name] = data;
          })
          .catch(() => {})
          .finally(() => {
            active--;
            next();
          });
          
        state.inFlightFetches.set(r.name, fetchPromise);
      }
    };

    next();
  });

  // Wait for all active fetches to complete
  const allPromises = state.summary.repositories
    .map(r => state.inFlightFetches.get(r.name))
    .filter(p => p);
    
  await Promise.all(allPromises);
}

function populateDashboard(data) {
  // Update Header
  let updatedDate = 'Just now';
  if (data.updated_at) {
    const d = new Date(data.updated_at);
    updatedDate = d.toLocaleString('en-US', {
      timeZone: 'Africa/Nairobi',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }) + ' EAT';
  }
  document.getElementById('lastUpdatedText').textContent = `Last synced: ${updatedDate}`;

  // Update Top Overview Section: GitHub Contribution Heatmap + Activity & Languages Card
  initContributionHeatmap();
  renderActivityAndLanguages(data);

  // Populate Repositories (Cards & Table)
  renderRepositories();

  // Populate Referrers and Paths
  renderTopReferrers(data.top_referrers || []);
  renderTopPaths(data.top_paths || []);

  // Populate Dropdown for Explorer Tab
  populateRepoDropdown(data.repositories || []);

  // Initialize Global Chart
  renderGlobalChart();

  // Select first repo for explorer
  if (data.repositories && data.repositories.length > 0) {
    state.selectedRepo = data.repositories[0].name;
    // Default compared repos to top 3
    state.comparedRepos = data.repositories.slice(0, Math.min(3, data.repositories.length)).map(r => r.name);
  }
}

// ============================================================================
// Top Overview: GitHub Contribution Heatmap & Activity / Languages
// ============================================================================
const TOP_LANGUAGES = [
  { name: 'Python', percent: 42.4, color: '#3572A5' },
  { name: 'TypeScript', percent: 28.6, color: '#3178c6' },
  { name: 'JavaScript', percent: 11.8, color: '#f1e05a' },
  { name: 'Go', percent: 6.7, color: '#00ADD8' },
  { name: 'C++', percent: 5.5, color: '#f34b7d' },
  { name: 'Dart', percent: 5.0, color: '#00B4AB' }
];

function formatRangeDate(isoStr) {
  if (!isoStr) return '';
  const [y, m, d] = isoStr.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

function renderActivityAndLanguages(data) {
  const k = data.kpis || {};
  const totalStars = k.total_stars ? Math.max(37, k.total_stars) : 37;

  const starsEl = document.getElementById('actTotalStars');
  if (starsEl) starsEl.textContent = totalStars.toLocaleString();

  const contEl = document.getElementById('actTotalContributions');
  if (contEl) contEl.textContent = '4.6k';

  const commitsEl = document.getElementById('actTotalCommits');
  if (commitsEl) commitsEl.textContent = '625';

  const prsEl = document.getElementById('actTotalPRs');
  if (prsEl) prsEl.textContent = '51';

  const prsMergedEl = document.getElementById('actTotalPRsMerged');
  if (prsMergedEl) prsMergedEl.textContent = '45';

  // Grade Circular Progress Ring - matching 'B' grade in user inspiration
  const gradeCircle = document.getElementById('gradeCircleProgress');
  const gradeText = document.getElementById('gradeBadgeText');
  if (gradeCircle) {
    gradeCircle.style.strokeDashoffset = '38';
  }
  if (gradeText) gradeText.textContent = 'B';

  // Render Most Used Languages Stacked Bar
  const barContainer = document.getElementById('languagesStackedBar');
  if (barContainer) {
    barContainer.innerHTML = TOP_LANGUAGES.map(lang => `
      <div 
        class="h-full transition-all duration-300 hover:opacity-85 cursor-pointer" 
        style="width: ${lang.percent}%; background-color: ${lang.color};" 
        title="${lang.name}: ${lang.percent}%"
      ></div>
    `).join('');
  }

  // Render Most Used Languages in 2 Columns matching screenshot
  const gridContainer = document.getElementById('languagesBreakdownGrid');
  if (gridContainer) {
    const col1 = [TOP_LANGUAGES[0], TOP_LANGUAGES[2], TOP_LANGUAGES[4]].filter(Boolean);
    const col2 = [TOP_LANGUAGES[1], TOP_LANGUAGES[3], TOP_LANGUAGES[5]].filter(Boolean);

    gridContainer.innerHTML = `
      <div class="grid grid-cols-2 gap-x-6 gap-y-2">
        <div class="space-y-2">
          ${col1.map(lang => `
            <div class="flex items-center gap-2 text-xs">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${lang.color};"></span>
              <span class="font-normal text-gray-700 dark:text-gray-300">${lang.name}</span>
              <span class="font-normal text-gray-500 dark:text-gray-400 ml-auto">${lang.percent}%</span>
            </div>
          `).join('')}
        </div>
        <div class="space-y-2">
          ${col2.map(lang => `
            <div class="flex items-center gap-2 text-xs">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${lang.color};"></span>
              <span class="font-normal text-gray-700 dark:text-gray-300">${lang.name}</span>
              <span class="font-normal text-gray-500 dark:text-gray-400 ml-auto">${lang.percent}%</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}

async function initContributionHeatmap() {
  // 1. Try localStorage cache first for instantaneous render
  try {
    const local = localStorage.getItem('gh_contributions_cache');
    if (local) {
      const parsed = JSON.parse(local);
      if (parsed && parsed.contributions && parsed.contributions.length > 0) {
        state.contributionsData = parsed;
        renderContributionHeatmap(parsed.contributions, parsed.total?.lastYear);
      }
    }
  } catch (e) {}

  // 2. Fallback to local data/contributions.json
  if (!state.contributionsData) {
    try {
      const res = await fetch('./data/contributions.json');
      if (res.ok) {
        const fileData = await res.json();
        state.contributionsData = fileData;
        renderContributionHeatmap(fileData.contributions, fileData.total?.lastYear);
      }
    } catch (e) {
      console.warn('Could not load ./data/contributions.json:', e);
    }
  }

  // 3. Always pull latest from API when page loads / reloads
  syncContributions(false);
}

let isSyncingContributions = false;

async function syncContributions(isManual = false) {
  if (isSyncingContributions) return;
  isSyncingContributions = true;

  const icon = document.getElementById('heatmapSyncIcon');
  if (icon) icon.classList.add('animate-spin');

  const statusNote = document.getElementById('heatmapStatusNote');
  if (statusNote && isManual) statusNote.textContent = 'Syncing latest GitHub contributions...';

  try {
    const res = await fetch('https://github-contributions-api.jogruber.de/v4/nathyBekele?y=last');
    if (res.ok) {
      const data = await res.json();
      if (data && data.contributions && data.contributions.length > 0) {
        state.contributionsData = data;
        localStorage.setItem('gh_contributions_cache', JSON.stringify(data));
        const total = data.total?.lastYear || data.contributions.reduce((s, c) => s + (c.count || 0), 0);
        renderContributionHeatmap(data.contributions, total);

        // Update Activity badge
        const actContEl = document.getElementById('actTotalContributions');
        if (actContEl) {
          actContEl.textContent = total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total.toLocaleString();
        }

        if (statusNote) {
          const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          statusNote.textContent = `Synced with GitHub at ${nowStr}`;
        }
      }
    }
  } catch (err) {
    console.warn('Background sync for contributions skipped/failed:', err);
    if (statusNote && isManual) statusNote.textContent = 'Cached GitHub contributions';
  } finally {
    isSyncingContributions = false;
    if (icon) icon.classList.remove('animate-spin');
  }
}

function renderContributionHeatmap(contributions, totalCount) {
  const container = document.getElementById('heatmapContainer');
  if (!container || !contributions || contributions.length === 0) return;

  const countEl = document.getElementById('heatmapContributionsCount');
  const rangeEl = document.getElementById('heatmapDateRange');

  const startDate = contributions[0].date;
  const endDate = contributions[contributions.length - 1].date;

  const startFormatted = formatRangeDate(startDate);
  const endFormatted = formatRangeDate(endDate);

  const finalTotal = totalCount || contributions.reduce((s, c) => s + (c.count || 0), 0);
  if (countEl) countEl.textContent = finalTotal.toLocaleString();
  if (rangeEl) rangeEl.textContent = `(${startFormatted} – ${endFormatted})`;

  // SVG grid parameters (properly proportioned for 2-column layout)
  const cellSize = 10;
  const cellGap = 3;
  const colStep = cellSize + cellGap; // 13px
  const leftMargin = 26;
  const topMargin = 16;

  const firstDate = new Date(contributions[0].date + 'T00:00:00Z');
  const startDayOfWeek = firstDate.getUTCDay(); // 0 is Sunday

  const weeks = [];
  let currentWeek = new Array(7).fill(null);
  for (let i = 0; i < startDayOfWeek; i++) {
    currentWeek[i] = null;
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabels = [];
  let lastMonth = -1;
  let weekIdx = 0;

  for (let i = 0; i < contributions.length; i++) {
    const item = contributions[i];
    const d = new Date(item.date + 'T00:00:00Z');
    const day = d.getUTCDay();
    const m = d.getUTCMonth();

    currentWeek[day] = item;

    if (day === 0 && m !== lastMonth) {
      monthLabels.push({ col: weekIdx, month: months[m] });
      lastMonth = m;
    }

    if (day === 6 || i === contributions.length - 1) {
      weeks.push(currentWeek);
      currentWeek = new Array(7).fill(null);
      weekIdx++;
    }
  }

  const numCols = weeks.length;
  const svgWidth = leftMargin + (numCols * colStep) + 6;
  const svgHeight = topMargin + (7 * colStep) + 3;

  let svg = `<svg viewBox="0 0 ${svgWidth} ${svgHeight}" class="w-full h-auto select-none overflow-visible block">`;

  // Month labels
  monthLabels.forEach(({ col, month }) => {
    const x = leftMargin + (col * colStep);
    svg += `<text x="${x}" y="11" font-size="9" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif">${month}</text>`;
  });

  // Day labels: Mon (row 1), Wed (row 3), Fri (row 5)
  svg += `<text x="20" y="${topMargin + 1 * colStep + 8.5}" text-anchor="end" font-size="9" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif">Mon</text>`;
  svg += `<text x="20" y="${topMargin + 3 * colStep + 8.5}" text-anchor="end" font-size="9" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif">Wed</text>`;
  svg += `<text x="20" y="${topMargin + 5 * colStep + 8.5}" text-anchor="end" font-size="9" fill="#8b949e" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', sans-serif">Fri</text>`;

  // Grid cells
  weeks.forEach((week, cIdx) => {
    const x = leftMargin + (cIdx * colStep);
    week.forEach((dayData, rIdx) => {
      if (!dayData) return;
      const y = topMargin + (rIdx * colStep);
      const level = dayData.level || 0;
      const count = dayData.count || 0;
      const date = dayData.date;
      svg += `
        <rect 
          x="${x}" 
          y="${y}" 
          width="${cellSize}" 
          height="${cellSize}" 
          rx="2" 
          ry="2" 
          class="heatmap-cell" 
          data-level="${level}" 
          data-count="${count}" 
          data-date="${date}"
          onmouseenter="showHeatmapTooltip(event, ${count}, '${date}')"
          onmouseleave="hideHeatmapTooltip()"
        />
      `;
    });
  });

  svg += `</svg>`;
  container.innerHTML = svg;
}

function showHeatmapTooltip(event, count, dateStr) {
  const tooltip = document.getElementById('heatmapTooltip');
  if (!tooltip) return;

  const d = new Date(dateStr + 'T00:00:00Z');
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const dayName = dayNames[d.getUTCDay()];
  const monthName = months[d.getUTCMonth()];
  const dayNum = d.getUTCDate();
  const year = d.getUTCFullYear();
  const formattedDate = `${dayName}, ${monthName} ${dayNum}, ${year}`;

  const countText = count === 0 
    ? 'No contributions' 
    : `${count} contribution${count === 1 ? '' : 's'}`;

  tooltip.innerHTML = `<strong>${countText}</strong> on ${formattedDate}`;

  const rect = event.target.getBoundingClientRect();
  const tooltipWidth = 240;
  let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
  if (left < 10) left = 10;
  if (left + tooltipWidth > window.innerWidth - 10) left = window.innerWidth - tooltipWidth - 10;

  let top = rect.top - 36;
  if (top < 10) top = rect.bottom + 8;

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.classList.remove('hidden');
}

function hideHeatmapTooltip() {
  const tooltip = document.getElementById('heatmapTooltip');
  if (tooltip) tooltip.classList.add('hidden');
}

// ============================================================================
// Global Timeline Chart
// ============================================================================
function setGlobalChartMetric(metric) {
  state.globalMetric = metric;
  const activeClass = 'px-3 py-1 rounded-md font-semibold text-xs bg-white dark:bg-[#202020] text-gray-900 dark:text-white border border-[#e1e4e8] dark:border-darkborder shadow-sm';
  const inactiveClass = 'px-3 py-1 rounded-md font-medium text-xs text-[#57606a] dark:text-[#8b949e] hover:text-gray-900 dark:hover:text-white border border-transparent';
  document.getElementById('chartMetric-views').className = metric === 'views' ? activeClass : inactiveClass;
  document.getElementById('chartMetric-clones').className = metric === 'clones' ? activeClass : inactiveClass;
  renderGlobalChart();
}

function setGlobalChartRange(days) {
  state.globalRange = days;
  const activeClass = 'px-2.5 py-1 rounded-md font-semibold text-xs bg-white dark:bg-[#202020] text-gray-900 dark:text-white border border-[#e1e4e8] dark:border-darkborder shadow-sm';
  const inactiveClass = 'px-2.5 py-1 rounded-md font-medium text-xs text-[#57606a] dark:text-[#8b949e] hover:text-gray-900 dark:hover:text-white border border-transparent';
  [7, 14, 30, 90, 0].forEach(d => {
    const btn = document.getElementById(`rangeBtn-${d}`);
    if (btn) {
      btn.className = (d === days) ? activeClass : inactiveClass;
    }
  });
  renderGlobalChart();
}

function renderGlobalChart() {
  if (!state.summary || !state.summary.daily_timeline) return;

  const canvas = document.getElementById('globalTimelineChart');
  if (!canvas) return;

  let timeline = [...state.summary.daily_timeline];
  if (state.globalRange > 0 && timeline.length > state.globalRange) {
    timeline = timeline.slice(-state.globalRange);
  }

  const labels = timeline.map(t => formatDateLabel(t.date));
  const colors = getChartColors();

  let datasets = [];
  if (state.globalMetric === 'views') {
    datasets = [
      {
        label: 'Total Views',
        data: timeline.map(t => t.views),
        borderColor: '#3b82f6', // blue-500
        backgroundColor: 'rgba(59, 130, 246, 0.15)',
        fill: true,
        tension: 0.4,
        borderWidth: 2.5,
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 6
      },
      {
        label: 'Unique Visitors',
        data: timeline.map(t => t.uniques),
        borderColor: '#10b981', // emerald-500
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        fill: true,
        tension: 0.4,
        borderWidth: 2.5,
        borderDash: [5, 5], // Differentiate with a dashed line
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 6
      }
    ];
  } else {
    datasets = [
      {
        label: 'Git Clones',
        data: timeline.map(t => t.clones),
        borderColor: '#f59e0b', // amber-500
        backgroundColor: 'rgba(245, 158, 11, 0.15)',
        fill: true,
        tension: 0.4,
        borderWidth: 2.5,
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 6
      },
      {
        label: 'Unique Cloners',
        data: timeline.map(t => t.unique_cloners),
        borderColor: '#ef4444', // red-500
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        fill: true,
        tension: 0.4,
        borderWidth: 2.5,
        borderDash: [5, 5],
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 6
      }
    ];
  }

  if (state.charts.global) {
    state.charts.global.destroy();
  }

  state.charts.global = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { color: colors.text, boxWidth: 12, usePointStyle: true }
        },
        tooltip: {
          backgroundColor: colors.tooltipBg,
          borderColor: colors.tooltipBorder,
          borderWidth: 1,
          titleColor: colors.tooltipText,
          bodyColor: colors.tooltipText,
          padding: 10,
          cornerRadius: 8
        }
      },
      scales: {
        x: {
          grid: { color: colors.grid },
          ticks: { color: colors.text, maxTicksLimit: 12 }
        },
        y: {
          grid: { color: colors.grid },
          ticks: { color: colors.text, beginAtZero: true }
        }
      }
    }
  });
}

// ============================================================================
// Repositories Grid & Table Views
// ============================================================================
// VIEW MODE TOGGLE (Cards Grid vs Leaderboard Table)
// ============================================================================
function initRepoViewMode() {
  const savedMode = localStorage.getItem('traffic_repo_view_mode') || 'grid';
  setRepoViewMode(savedMode);
}

function setRepoViewMode(mode) {
  state.repoViewMode = mode;
  localStorage.setItem('traffic_repo_view_mode', mode);

  const gridBtn = document.getElementById('viewModeGridBtn');
  const tableBtn = document.getElementById('viewModeTableBtn');
  const cardsContainer = document.getElementById('repoCardsViewContainer');
  const tableContainer = document.getElementById('repoTableViewContainer');
  const dateFilterContainer = document.getElementById('repoDateFilterContainer');
  const grid = document.getElementById('repoCardsGrid');

  const activeBtnClass = 'flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] font-semibold text-xs whitespace-nowrap bg-white dark:bg-[#151515] text-[#0969da] dark:text-white border border-[#d0d7de] dark:border-[#30363d] shadow-xs transition-all';
  const inactiveBtnClass = 'flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] font-medium text-xs whitespace-nowrap text-[#57606a] dark:text-[#8b949e] hover:text-gray-900 dark:hover:text-white border border-transparent transition-all';

  if (mode === 'grid') {
    if (gridBtn) gridBtn.className = activeBtnClass;
    if (tableBtn) tableBtn.className = inactiveBtnClass;
    if (cardsContainer) cardsContainer.classList.remove('hidden');
    if (tableContainer) tableContainer.classList.add('hidden');
    // Day filters are only for table view, hide in grid view
    if (dateFilterContainer) {
      dateFilterContainer.classList.add('hidden');
      dateFilterContainer.classList.remove('flex');
    }
    // Fully responsive grid: 1 col on mobile, 2 col on tablet/medium, 3 col on large screens
    if (grid) {
      grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4';
    }
  } else {
    if (gridBtn) gridBtn.className = inactiveBtnClass;
    if (tableBtn) tableBtn.className = activeBtnClass;
    if (cardsContainer) cardsContainer.classList.add('hidden');
    if (tableContainer) tableContainer.classList.remove('hidden');
    // Show day filters in table view
    if (dateFilterContainer) {
      dateFilterContainer.classList.remove('hidden');
      dateFilterContainer.classList.add('flex');
    }
  }
}

function setRepoCardCols(cols) {
  // Retained for backward compatibility
  const grid = document.getElementById('repoCardsGrid');
  if (grid) {
    grid.className = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4';
  }
}

function onRepoSortSelectChange(val) {
  if (!val) return;
  const parts = val.split(':');
  state.tableSort.column = parts[0];
  state.tableSort.asc = (parts[1] === 'asc');
  renderRepositories();
}

function syncSortDropdown() {
  const select = document.getElementById('repoSortSelect');
  if (!select) return;
  const targetVal = `${state.tableSort.column}:${state.tableSort.asc ? 'asc' : 'desc'}`;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === targetVal) {
      select.value = targetVal;
      return;
    }
  }
}

function filterRepoTable() {
  const input = document.getElementById('repoSearchInput');
  const query = input ? input.value.toLowerCase().trim() : '';
  state.searchQuery = query;
  renderRepositories();
}

function sortRepoTable(col) {
  if (state.tableSort.column === col) {
    state.tableSort.asc = !state.tableSort.asc;
  } else {
    state.tableSort.column = col;
    state.tableSort.asc = false; // Descending default for stats
  }
  syncSortDropdown();
  renderRepositories();
}

async function setLeaderboardRange(type, value) {
  const customDiv = document.getElementById('leaderboardCustomDateRange');
  
  // Reset pill styles
  [14, 30, 90, 0, 'custom'].forEach(v => {
    const el = document.getElementById(`lbr-${v}`);
    if (el) {
      el.className = 'px-2.5 py-1 rounded-md font-medium text-xs whitespace-nowrap text-[#57606a] dark:text-[#8b949e] hover:text-gray-900 dark:hover:text-white border border-transparent transition-colors';
    }
  });

  const activeRangeClass = 'px-2.5 py-1 rounded-md font-semibold text-xs whitespace-nowrap bg-white dark:bg-[#202020] text-gray-900 dark:text-white border border-[#e1e4e8] dark:border-darkborder shadow-sm transition-colors';

  if (type === 'custom') {
    const el = document.getElementById('lbr-custom');
    if (el) el.className = activeRangeClass;
    if (customDiv) {
      customDiv.style.display = 'flex';
      customDiv.classList.remove('hidden');
    }
    return;
  } else {
    const el = document.getElementById(`lbr-${value}`);
    if (el) el.className = activeRangeClass;
    if (customDiv) {
      customDiv.style.display = 'none';
      customDiv.classList.add('hidden');
    }
    state.leaderboardRange = { type: 'days', value: parseInt(value, 10) };
  }
  
  await ensureAllRepoDetailsLoaded();
  computeLeaderboardStats();
  renderRepositories();
}

async function applyCustomLeaderboardRange() {
  const start = document.getElementById('leaderboardStartDate')?.value;
  const end = document.getElementById('leaderboardEndDate')?.value;
  if (!start || !end) {
    alert('Please select both start and end dates.');
    return;
  }
  if (new Date(start) > new Date(end)) {
    alert('Start date must be before or equal to end date.');
    return;
  }
  
  state.leaderboardRange = { type: 'custom', start, end };
  await ensureAllRepoDetailsLoaded();
  computeLeaderboardStats();
  renderRepositories();
}

function computeLeaderboardStats() {
  if (!state.summary || !state.summary.repositories) return;
  const { type, value, start, end } = state.leaderboardRange;
  
  const yesterdayStr = getYesterdayDateStr();
  const now = new Date();
  const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const localYesterday = new Date(localToday.getTime() - 24 * 60 * 60 * 1000);

  // Update Header Titles for Table
  let headerPrefix = 'All-Time';
  let titleTooltip = '';
  if (type === 'days' && value === 1) {
    headerPrefix = '1d';
    titleTooltip = `Yesterday (${yesterdayStr})`;
  } else if (type === 'days' && value > 1) {
    headerPrefix = `${value}d`;
    titleTooltip = `Past ${value} days`;
  } else if (type === 'custom') {
    headerPrefix = 'Custom';
    titleTooltip = `${start} to ${end}`;
  }
  const thViews = document.getElementById('thRangeViews');
  const thUniques = document.getElementById('thRangeUniques');
  const thClones = document.getElementById('thRangeClones');
  if (thViews) {
    thViews.textContent = `${headerPrefix} Views`;
    if (titleTooltip) thViews.title = titleTooltip;
  }
  if (thUniques) {
    thUniques.textContent = `${headerPrefix} Visitors`;
    if (titleTooltip) thUniques.title = titleTooltip;
  }
  if (thClones) {
    thClones.textContent = `${headerPrefix} Clones`;
    if (titleTooltip) thClones.title = titleTooltip;
  }

  const lbr1 = document.getElementById('lbr-1');
  if (lbr1) {
    lbr1.title = `Yesterday (${yesterdayStr})`;
  }

  // Compute stats for each repo
  let cutoffDateStr = '';
  let startDateStr = '';
  let endDateStr = '';
  
  if (type === 'days' && value === 1) {
    cutoffDateStr = yesterdayStr;
  } else if (type === 'days' && value > 1) {
    const cutoffTime = localYesterday.getTime() - ((value - 1) * 24 * 60 * 60 * 1000);
    const cDate = new Date(cutoffTime);
    cutoffDateStr = `${cDate.getFullYear()}-${String(cDate.getMonth() + 1).padStart(2, '0')}-${String(cDate.getDate()).padStart(2, '0')}`;
  } else if (type === 'custom') {
    startDateStr = start;
    endDateStr = end;
  }

  state.summary.repositories.forEach(r => {
    if (type === 'days' && value === 0) {
      r.range_views = r.all_time_views !== undefined ? r.all_time_views : (r.summary?.all_time_views || 0);
      r.range_clones = r.all_time_clones !== undefined ? r.all_time_clones : (r.summary?.all_time_clones || 0);
      r.range_uniques = r.all_time_uniques !== undefined ? r.all_time_uniques : (r.summary?.all_time_uniques || '-');
      r.range_unique_cloners = r.all_time_unique_cloners !== undefined ? r.all_time_unique_cloners : (r.summary?.all_time_unique_cloners || '-');
      return;
    }
    
    const details = state.repoDetails[r.name];
    if (!details) {
      // Fallback to top-level 14d summary stats if available
      if (type === 'days' && value === 14) {
        r.range_views = r.views_14d || 0;
        r.range_uniques = r.uniques_14d || 0;
        r.range_clones = r.clones_14d || 0;
        r.range_unique_cloners = r.unique_cloners_14d || 0;
      } else {
        r.range_views = 0;
        r.range_uniques = 0;
        r.range_clones = 0;
        r.range_unique_cloners = 0;
      }
      return;
    }

    let range_views = 0, range_uniques = 0, range_clones = 0, range_unique_cloners = 0;

    const inRange = (dStr) => {
      if (type === 'days' && value === 0) return true;
      if (type === 'days' && value === 1) return dStr === yesterdayStr;
      if (type === 'days') return dStr >= cutoffDateStr;
      return dStr >= startDateStr && dStr <= endDateStr;
    };

    for (let i = 0; i < (details.views || []).length; i++) {
      const v = details.views[i];
      if (type === 'custom' && v.date > endDateStr) break;
      if (inRange(v.date)) {
        range_views += (v.count || 0);
        range_uniques += (v.uniques || 0);
      }
    }
    
    for (let i = 0; i < (details.clones || []).length; i++) {
      const c = details.clones[i];
      if (type === 'custom' && c.date > endDateStr) break;
      if (inRange(c.date)) {
        range_clones += (c.count || 0);
        range_unique_cloners += (c.uniques || 0);
      }
    }

    r.range_views = range_views;
    r.range_uniques = range_uniques;
    r.range_clones = range_clones;
    r.range_unique_cloners = range_unique_cloners;
  });
}

function isRepoPrivate(r) {
  if (!r) return false;
  if (typeof r.is_private === 'boolean') return r.is_private;
  if (typeof r.private === 'boolean') return r.private;
  if (r.visibility === 'private') return true;
  const detail = state.repoDetails && state.repoDetails[r.name];
  if (detail) {
    if (typeof detail.is_private === 'boolean') return detail.is_private;
    if (typeof detail.private === 'boolean') return detail.private;
    if (detail.visibility === 'private') return true;
  }
  return false;
}

function getFilteredAndSortedRepos() {
  if (!state.summary || !state.summary.repositories) return [];

  let repos = [...state.summary.repositories];

  if (state.searchQuery) {
    const raw = state.searchQuery.toLowerCase().trim();
    repos = repos.filter(r => {
      const isPriv = isRepoPrivate(r);
      if (raw === 'private' || raw === 'is:private') return isPriv;
      if (raw === 'public' || raw === 'is:public') return !isPriv;
      return (
        (r.name && r.name.toLowerCase().includes(raw)) ||
        (r.language && r.language.toLowerCase().includes(raw)) ||
        (r.description && r.description.toLowerCase().includes(raw))
      );
    });
  }

  const { column, asc } = state.tableSort;
  repos.sort((a, b) => {
    let valA = a[column];
    let valB = b[column];
    if (valA === undefined || valA === null) valA = 0;
    if (valB === undefined || valB === null) valB = 0;
    if (typeof valA === 'string' && typeof valB === 'string') {
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return asc ? (valA - valB) : (valB - valA);
  });

  return repos;
}

function updateRepoCountBadge() {
  const badge = document.getElementById('repoCountBadge');
  if (!badge || !state.summary) return;
  const total = state.summary.repositories ? state.summary.repositories.length : 0;
  const filtered = getFilteredAndSortedRepos().length;
  if (state.searchQuery && filtered !== total) {
    badge.textContent = `${filtered} of ${total}`;
  } else {
    badge.textContent = `${total}`;
  }
}

function getActiveRangeTagAndLabel() {
  const { type, value, start, end } = state.leaderboardRange;
  if (type === 'days' && value === 1) {
    return { tag: '1d', label: 'Yesterday (1d)' };
  } else if (type === 'days' && value > 1) {
    return { tag: `${value}d`, label: `${value}-Day` };
  } else if (type === 'days' && value === 0) {
    return { tag: 'All', label: 'All-Time' };
  } else if (type === 'custom') {
    return { tag: 'Custom', label: `${start} to ${end}` };
  }
  return { tag: '14d', label: '14-Day' };
}

function renderRepoCards() {
  const container = document.getElementById('repoCardsGrid');
  const emptyState = document.getElementById('repoCardsEmptyState');
  if (!container || !state.summary) return;

  const repos = getFilteredAndSortedRepos();

  if (repos.length === 0) {
    container.innerHTML = '';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }
  if (emptyState) emptyState.classList.add('hidden');

  const { tag: rangeTag, label: rangeLabel } = getActiveRangeTagAndLabel();

  container.innerHTML = repos.map(r => {
    const langColor = GITHUB_LANGUAGE_COLORS[r.language] || '#8b949e';
    const clones = typeof r.range_clones === 'number' ? r.range_clones : (parseInt(r.range_clones, 10) || 0);
    const views = typeof r.range_views === 'number' ? r.range_views : (parseInt(r.range_views, 10) || 0);
    const stars = r.stars || 0;
    const forks = r.forks || 0;
    const uniqueVisitors = typeof r.range_uniques === 'number' ? r.range_uniques : null;
    const uniqueCloners = typeof r.range_unique_cloners === 'number' ? r.range_unique_cloners : null;
    const isPrivate = isRepoPrivate(r);
    const isFork = Boolean(r.is_fork || r.fork || (state.repoDetails[r.name] && state.repoDetails[r.name].is_fork));
    const parentName = r.parent_name || (state.repoDetails[r.name] && state.repoDetails[r.name].parent_name);

    const repoIcon = isPrivate ? `
      <svg class="octicon octicon-lock text-[#57606a] dark:text-[#8b949e] shrink-0" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z"></path>
      </svg>
    ` : `
      <svg class="octicon octicon-repo text-[#57606a] dark:text-[#8b949e] shrink-0" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"></path>
      </svg>
    `;

    // GitHub native star item (only shown if stars > 0)
    const starItem = stars > 0 ? `
      <a 
        href="${r.html_url ? r.html_url + '/stargazers' : '#'}" 
        target="_blank" 
        rel="noopener noreferrer" 
        onclick="event.stopPropagation()" 
        class="inline-flex items-center gap-1 text-[#57606a] dark:text-[#8b949e] hover:text-[#0969da] dark:hover:text-white transition-colors"
        title="${stars.toLocaleString()} stars"
      >
        <i class="fa-regular fa-star text-xs"></i>
        <span>${stars.toLocaleString()}</span>
      </a>
    ` : '';

    // GitHub native fork item (only shown if forks > 0)
    const forkItem = forks > 0 ? `
      <a 
        href="${r.html_url ? r.html_url + '/forks' : '#'}" 
        target="_blank" 
        rel="noopener noreferrer" 
        onclick="event.stopPropagation()" 
        class="inline-flex items-center gap-1 text-[#57606a] dark:text-[#8b949e] hover:text-[#0969da] dark:hover:text-white transition-colors"
        title="${forks.toLocaleString()} forks"
      >
        <svg class="octicon octicon-repo-forked shrink-0" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
          <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 0-.877-.282A2.249 2.249 0 0 1 9.5 5.75h-3a2.249 2.249 0 0 1-.623-.638A2.25 2.25 0 1 0 5 5.372Zm5.75-2.122a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm-7.5 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5ZM8 7.25a.75.75 0 0 1 .75.75v3.628a2.25 2.25 0 1 1-1.5 0V8A.75.75 0 0 1 8 7.25Zm0 6.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"></path>
        </svg>
        <span>${forks.toLocaleString()}</span>
      </a>
    ` : '';

    return `
      <div 
        class="border border-[#d0d7de] dark:border-[#30363d] bg-white dark:bg-[#151515] rounded-[6px] p-3.5 sm:p-4 flex flex-col justify-between hover:border-[#0969da] dark:hover:border-[#58a6ff] transition-all group cursor-pointer text-left h-full shadow-xs"
        onclick="viewRepoDeepDive('${escapeHtml(r.name)}')"
      >
        <!-- Top Section -->
        <div>
          <!-- Header: Repo Icon, Repo Name, Public/Private badge -->
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0 flex-1">
              ${repoIcon}
              <a 
                href="${r.html_url || '#'}" 
                target="_blank" 
                rel="noopener noreferrer" 
                onclick="event.stopPropagation()" 
                class="font-semibold text-sm sm:text-[14.5px] text-[#0969da] dark:text-white hover:underline truncate tracking-tight"
                title="${escapeHtml(r.name)}"
              >
                ${escapeHtml(r.name)}
              </a>
              <span class="inline-flex items-center px-1.5 py-0 text-[10px] font-normal border border-[#d0d7de] dark:border-[#30363d] text-[#57606a] dark:text-[#8b949e] rounded-full leading-[16px] shrink-0">
                ${isPrivate ? 'Private' : 'Public'}
              </span>
            </div>
          </div>

          <!-- Forked from if applicable -->
          ${isFork ? `
            <p class="text-[11px] text-[#57606a] dark:text-[#8b949e] mt-1 truncate">
              Forked from <span class="font-mono">${escapeHtml(parentName || 'upstream')}</span>
            </p>
          ` : ''}

          <!-- Description -->
          <p class="text-xs text-[#57606a] dark:text-[#8b949e] mt-1.5 mb-3 leading-relaxed line-clamp-2 min-h-[32px]">
            ${escapeHtml(r.description || '')}
          </p>
        </div>

        <!-- Footer: Clean metadata flow matching reference -->
        <div class="mt-auto pt-2 border-t border-[#d0d7de]/70 dark:border-[#30363d]/80 flex items-center text-xs text-[#57606a] dark:text-[#8b949e] flex-wrap gap-x-3.5 gap-y-1.5">
          <!-- Language -->
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${langColor};"></span>
            <span class="font-normal text-[11px]">${escapeHtml(r.language || 'Code')}</span>
          </div>

          <!-- Stars -->
          ${starItem}

          <!-- Forks -->
          ${forkItem}

          <!-- Clones -->
          <div 
            class="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-purple-500/5 hover:bg-purple-500/15 text-[#57606a] dark:text-[#8b949e] hover:text-purple-600 dark:hover:text-purple-300 transition-colors cursor-pointer border border-transparent hover:border-purple-500/30"
            onclick="event.stopPropagation(); toggleQuickPreview('${escapeHtml(r.name)}', 'clones', event)"
            onmouseenter="scheduleShowQuickPreview('${escapeHtml(r.name)}', 'clones', event)"
            onmouseleave="scheduleHideQuickPreview()"
            aria-label="${rangeLabel} Git Clones: ${clones.toLocaleString()}"
          >
            <svg class="octicon octicon-download shrink-0" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"></path>
              <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"></path>
            </svg>
            <span class="text-[11px]">${clones.toLocaleString()} clones</span>
          </div>

          <!-- Views -->
          <div 
            class="flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-blue-500/5 hover:bg-blue-500/15 text-[#57606a] dark:text-[#8b949e] hover:text-blue-600 dark:hover:text-blue-300 transition-colors cursor-pointer border border-transparent hover:border-blue-500/30"
            onclick="event.stopPropagation(); toggleQuickPreview('${escapeHtml(r.name)}', 'views', event)"
            onmouseenter="scheduleShowQuickPreview('${escapeHtml(r.name)}', 'views', event)"
            onmouseleave="scheduleHideQuickPreview()"
            aria-label="${rangeLabel} Views: ${views.toLocaleString()}"
          >
            <svg class="octicon octicon-eye shrink-0" viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
              <path d="M8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.62 1.62 0 0 1 0 1.798c-.45.678-1.367 1.932-2.637 3.023C11.67 13.008 9.981 14 8 14c-1.981 0-3.671-.992-4.933-2.078C1.797 10.83.88 9.576.43 8.898a1.62 1.62 0 0 1 0-1.798c.45-.677 1.367-1.931 2.637-3.022C4.33 2.992 6.019 2 8 2ZM1.679 7.932a.12.12 0 0 0 0 .136c.411.622 1.241 1.75 2.366 2.717C5.176 11.758 6.527 12.5 8 12.5c1.473 0 2.825-.742 3.955-1.715 1.124-.967 1.954-2.096 2.366-2.717a.12.12 0 0 0 0-.136c-.412-.621-1.242-1.75-2.366-2.717C10.824 4.242 9.473 3.5 8 3.5c-1.473 0-2.824.742-3.955 1.715-1.124.967-1.955 2.096-2.366 2.717ZM8 10a2 2 0 1 1-.001-3.999A2 2 0 0 1 8 10Z"></path>
            </svg>
            <span class="text-[11px]">${views.toLocaleString()} views</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRepoTable() {
  const tbody = document.getElementById('repoTableBody');
  if (!tbody || !state.summary) return;

  const repos = getFilteredAndSortedRepos();

  if (repos.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="px-5 py-12 text-center text-gray-500 dark:text-gray-400">
          <i class="fa-solid fa-box-open text-2xl mb-2 text-gray-400"></i>
          <p class="font-medium">No repositories match your search or filter</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = repos.map(r => {
    const isPrivate = isRepoPrivate(r);
    const repoIcon = isPrivate ? `
      <svg class="octicon octicon-lock text-[#656d76] dark:text-[#7d8590] shrink-0" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
        <path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z"></path>
      </svg>
    ` : `
      <svg class="octicon octicon-repo text-[#656d76] dark:text-[#7d8590] shrink-0" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
        <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"></path>
      </svg>
    `;
    return `
    <tr class="hover:bg-gray-50/80 dark:hover:bg-[#1a1a1a] cursor-pointer transition-colors group border-b border-[#d0d7de] dark:border-[#30363d]" onclick="viewRepoDeepDive('${escapeHtml(r.name)}')">
      <td class="px-5 py-3">
        <div class="flex items-center gap-2">
          ${repoIcon}
          <a href="${r.html_url || '#'}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="font-semibold text-[#0969da] dark:text-white hover:underline transition-colors text-sm">${escapeHtml(r.name)}</a>
          <span class="inline-flex items-center px-1.5 py-0 text-[10px] font-normal border border-[#d0d7de] dark:border-[#30363d] text-[#57606a] dark:text-[#8b949e] rounded-full leading-tight">
            ${isPrivate ? 'Private' : 'Public'}
          </span>
          ${r.language ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-normal bg-gray-100 dark:bg-[#202020] text-[#57606a] dark:text-[#8b949e] border border-[#d0d7de] dark:border-[#30363d]">${escapeHtml(r.language)}</span>` : ''}
        </div>
        ${r.description ? `<p class="text-xs text-[#57606a] dark:text-[#8b949e] truncate max-w-xs mt-0.5 leading-relaxed">${escapeHtml(r.description)}</p>` : ''}
      </td>
      <td class="px-3 py-3 font-medium text-gray-700 dark:text-gray-300 text-xs">
        <div class="flex items-center gap-1.5"><i class="fa-regular fa-star text-[11px] text-gray-400"></i>${(r.stars || 0).toLocaleString()}</div>
      </td>
      <td class="px-3 py-3 font-medium text-gray-700 dark:text-gray-300 text-xs">
        <div class="flex items-center gap-1.5"><svg class="octicon octicon-repo-forked opacity-60" viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 0-.877-.282A2.249 2.249 0 0 1 9.5 5.75h-3a2.249 2.249 0 0 1-.623-.638A2.25 2.25 0 1 0 5 5.372Zm5.75-2.122a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Zm-7.5 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5ZM8 7.25a.75.75 0 0 1 .75.75v3.628a2.25 2.25 0 1 1-1.5 0V8A.75.75 0 0 1 8 7.25Zm0 6.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"></path></svg>${(r.forks || 0).toLocaleString()}</div>
      </td>
      <td class="px-3 py-3 font-semibold text-[#0969da] dark:text-white cursor-pointer hover:underline text-xs" onclick="event.stopPropagation(); toggleQuickPreview('${escapeHtml(r.name)}', 'views', event)" onmouseenter="scheduleShowQuickPreview('${escapeHtml(r.name)}', 'views', event)" onmouseleave="scheduleHideQuickPreview()" aria-label="14-day views for ${escapeHtml(r.name)}">
        ${typeof r.range_views === 'number' ? r.range_views.toLocaleString() : (r.range_views || 0)}
      </td>
      <td class="px-3 py-3 font-medium text-gray-700 dark:text-gray-300 hidden sm:table-cell text-xs">
        ${typeof r.range_uniques === 'number' ? r.range_uniques.toLocaleString() : (r.range_uniques || 0)}
      </td>
      <td class="px-3 py-3 font-medium text-gray-700 dark:text-gray-300 hidden sm:table-cell cursor-pointer hover:underline text-xs" onclick="event.stopPropagation(); toggleQuickPreview('${escapeHtml(r.name)}', 'clones', event)" onmouseenter="scheduleShowQuickPreview('${escapeHtml(r.name)}', 'clones', event)" onmouseleave="scheduleHideQuickPreview()" aria-label="14-day clones for ${escapeHtml(r.name)}">
        ${typeof r.range_clones === 'number' ? r.range_clones.toLocaleString() : (r.range_clones || 0)}
      </td>
      <td class="px-3 py-3 font-medium text-gray-700 dark:text-gray-300 hidden md:table-cell text-xs">
        ${(r.all_time_views || 0).toLocaleString()}
      </td>
      <td class="px-3 py-3 font-medium text-gray-700 dark:text-gray-300 hidden md:table-cell text-xs">
        ${(r.all_time_clones || 0).toLocaleString()}
      </td>
      <td class="px-5 py-3 text-right">
        <div class="flex items-center justify-end gap-2" onclick="event.stopPropagation()">
          <button 
            type="button"
            onmouseenter="scheduleShowQuickPreview('${escapeHtml(r.name)}', 'clones', event)"
            onmouseleave="scheduleHideQuickPreview()"
            onclick="toggleQuickPreview('${escapeHtml(r.name)}', 'clones', event)"
            class="quick-preview-btn px-2.5 py-1 rounded-md bg-white dark:bg-[#1f1f1f] text-[#57606a] dark:text-[#8b949e] border border-[#e1e4e8] dark:border-[#333333] hover:text-[#0969da] dark:hover:text-white text-xs font-medium transition-all flex items-center gap-1.5"
            aria-label="Quick preview 14-day clones for ${escapeHtml(r.name)}"
          >
            <i class="fa-solid fa-chart-line text-[11px]"></i>
            <span class="hidden sm:inline">Trend</span>
          </button>
          <button 
            type="button"
            onclick="viewRepoDeepDive('${escapeHtml(r.name)}')" 
            class="px-2.5 py-1 rounded-md bg-white dark:bg-[#1f1f1f] text-[#57606a] dark:text-[#8b949e] border border-[#e1e4e8] dark:border-[#333333] hover:text-[#0969da] dark:hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5"
          >
            Inspect <i class="fa-solid fa-arrow-right text-[10px]"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
  }).join('');
}

function renderRepositories() {
  renderRepoCards();
  renderRepoTable();
  updateRepoCountBadge();
  syncSortDropdown();
}

function viewRepoDeepDive(repoName) {
  hideQuickPreview();
  state.selectedRepo = repoName;
  const dropdown = document.getElementById('repoDropdown');
  if (dropdown) dropdown.value = repoName;
  navigateTo('explorer', repoName);
  onRepoSelect(repoName);
}

// ============================================================================
// Quick Clones & Views Trend Popover Modal
// ============================================================================
let quickPreviewTimer = null;
let quickPreviewShowTimer = null;
let currentPreviewRepo = null;
let currentPreviewMetric = 'clones';
let isQuickPreviewPinned = false;

function scheduleShowQuickPreview(repoName, metricType, event) {
  if (isQuickPreviewPinned) return;
  if (quickPreviewTimer) {
    clearTimeout(quickPreviewTimer);
    quickPreviewTimer = null;
  }
  if (quickPreviewShowTimer) clearTimeout(quickPreviewShowTimer);

  const btn = event.currentTarget || event.target;
  const rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 100, top: 100, width: 60, height: 20, bottom: 120 };
  const evtData = {
    currentTarget: btn,
    target: btn,
    getBoundingClientRect: () => rect
  };

  quickPreviewShowTimer = setTimeout(() => {
    showQuickPreview(repoName, metricType, evtData);
  }, 160);
}

function showQuickPreview(repoName, metricTypeOrEvent, maybeEvent) {
  if (quickPreviewShowTimer) {
    clearTimeout(quickPreviewShowTimer);
    quickPreviewShowTimer = null;
  }
  if (quickPreviewTimer) {
    clearTimeout(quickPreviewTimer);
    quickPreviewTimer = null;
  }

  let metricType = 'clones';
  let event = null;
  if (typeof metricTypeOrEvent === 'string') {
    metricType = metricTypeOrEvent;
    event = maybeEvent;
  } else {
    event = metricTypeOrEvent;
  }

  currentPreviewRepo = repoName;
  currentPreviewMetric = metricType;

  const popover = document.getElementById('quickPreviewPopover');
  if (!popover) return;

  let isAbove = false;
  let popoverWidth = Math.min(360, window.innerWidth - 20);
  let left = 10;

  if (event) {
    const btn = event.currentTarget || event.target;
    const rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : { left: 100, top: 100, width: 60, height: 20, bottom: 120 };

    // Center popout relative to the hovered item, clamped within viewport bounds
    left = rect.left + (rect.width / 2) - (popoverWidth / 2);
    if (left + popoverWidth > window.innerWidth - 10) {
      left = window.innerWidth - popoverWidth - 10;
    }
    if (left < 10) left = 10;

    const popoverHeight = 250;
    let top = rect.bottom + 8;
    if (top + popoverHeight > window.innerHeight - 10 && rect.top > popoverHeight + 10) {
      top = rect.top - popoverHeight - 8;
      isAbove = true;
    }

    popover.style.width = `${popoverWidth}px`;
    popover.style.top = `${Math.max(8, top)}px`;
    popover.style.left = `${left}px`;

    const pointerArrow = document.getElementById('qpPointerArrow');
    if (pointerArrow) {
      const btnCenterX = rect.left + (rect.width / 2);
      const arrowLeft = Math.max(16, Math.min(popoverWidth - 28, btnCenterX - left - 5));
      pointerArrow.style.left = `${arrowLeft}px`;

      if (isAbove) {
        pointerArrow.style.top = '';
        pointerArrow.style.bottom = '-6px';
        pointerArrow.className = 'absolute w-2.5 h-2.5 rotate-45 pointer-events-none transition-all duration-75 bg-white dark:bg-[#151515] border-b border-r border-[#d0d7de] dark:border-[#30363d]';
      } else {
        pointerArrow.style.bottom = '';
        pointerArrow.style.top = '-6px';
        pointerArrow.className = 'absolute w-2.5 h-2.5 rotate-45 pointer-events-none transition-all duration-75 bg-white dark:bg-[#151515] border-t border-l border-[#d0d7de] dark:border-[#30363d]';
      }
    }
  }

  // Fast smooth pop-in animation
  popover.classList.remove('hidden');
  popover.style.opacity = '0';
  popover.style.transform = 'scale(0.97) translateY(-2px)';
  requestAnimationFrame(() => {
    popover.style.opacity = '1';
    popover.style.transform = 'scale(1) translateY(0)';
  });

  renderQuickPreviewContent(repoName, metricType);
}

function scheduleHideQuickPreview(delay = 70) {
  if (isQuickPreviewPinned) return;
  if (quickPreviewShowTimer) {
    clearTimeout(quickPreviewShowTimer);
    quickPreviewShowTimer = null;
  }
  if (quickPreviewTimer) clearTimeout(quickPreviewTimer);
  quickPreviewTimer = setTimeout(() => {
    hideQuickPreview();
  }, delay);
}

function cancelHideQuickPreview() {
  if (quickPreviewTimer) {
    clearTimeout(quickPreviewTimer);
    quickPreviewTimer = null;
  }
}

function hideQuickPreview() {
  if (quickPreviewShowTimer) {
    clearTimeout(quickPreviewShowTimer);
    quickPreviewShowTimer = null;
  }
  if (quickPreviewTimer) {
    clearTimeout(quickPreviewTimer);
    quickPreviewTimer = null;
  }
  isQuickPreviewPinned = false;
  const popover = document.getElementById('quickPreviewPopover');
  if (popover && !popover.classList.contains('hidden')) {
    popover.style.opacity = '0';
    popover.style.transform = 'scale(0.97) translateY(-2px)';
    setTimeout(() => {
      if (currentPreviewRepo === null) {
        popover.classList.add('hidden');
      }
    }, 75);
  }
  currentPreviewRepo = null;
}

function toggleQuickPreview(repoName, metricType, event) {
  const popover = document.getElementById('quickPreviewPopover');
  if (popover && !popover.classList.contains('hidden') && currentPreviewRepo === repoName && currentPreviewMetric === metricType) {
    hideQuickPreview();
  } else {
    isQuickPreviewPinned = true;
    showQuickPreview(repoName, metricType, event);
  }
}

// Global click-outside & Escape key dismiss for quick preview popout
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideQuickPreview();
});

document.addEventListener('click', (e) => {
  const popover = document.getElementById('quickPreviewPopover');
  if (popover && !popover.classList.contains('hidden')) {
    if (!popover.contains(e.target) && !e.target.closest('[onclick*="toggleQuickPreview"]')) {
      hideQuickPreview();
    }
  }
});

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  return `${months[m]} ${d}`;
}

async function renderQuickPreviewContent(repoName, metricType = 'clones') {
  const nameEl = document.getElementById('qpRepoName');
  const iconContainer = document.getElementById('qpIconContainer');
  const iconEl = document.getElementById('qpIcon');
  const badgeEl = document.getElementById('qpSummaryBadge');
  const container = document.getElementById('qpGraphContent');
  if (!container) return;

  const isViews = metricType === 'views';

  if (nameEl) nameEl.textContent = repoName;
  if (iconContainer && iconEl) {
    if (isViews) {
      iconContainer.className = 'w-6 h-6 rounded-[4px] bg-blue-500/10 flex items-center justify-center text-[#0969da] dark:text-[#58a6ff] text-xs shrink-0 transition-colors';
      iconEl.className = 'fa-regular fa-eye text-[11px]';
    } else {
      iconContainer.className = 'w-6 h-6 rounded-[4px] bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400 text-xs shrink-0 transition-colors';
      iconEl.className = 'fa-solid fa-download text-[11px]';
    }
  }

  let repo = state.repoDetails[repoName];
  if (!repo) {
    const spinnerColor = isViews ? 'text-blue-500' : 'text-purple-500';
    container.innerHTML = `
      <div class="h-44 flex items-center justify-center text-xs text-gray-400 gap-2">
        <i class="fa-solid fa-spinner animate-spin ${spinnerColor}"></i> Loading 14-day history...
      </div>
    `;
    try {
      const res = await fetch(`./data/repositories/${repoName}.json`);
      if (res.ok) {
        repo = await res.json();
        state.repoDetails[repoName] = repo;
      }
    } catch (e) {
      console.warn('Failed loading repo for quick preview:', e);
    }
  }

  const rawDays = repo ? (isViews ? (repo.views || []) : (repo.clones || [])) : [];

  if (!repo || rawDays.length === 0) {
    const metricLabel = isViews ? 'view' : 'clone';
    container.innerHTML = `<div class="h-40 flex items-center justify-center text-xs text-gray-400 italic">No ${metricLabel} metrics recorded yet for this repository.</div>`;
    if (badgeEl) {
      badgeEl.className = isViews 
        ? 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-[#202020] text-[#0969da] dark:text-blue-300 border border-[#d0d7de] dark:border-[#30363d]'
        : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 dark:bg-[#202020] text-purple-700 dark:text-purple-300 border border-[#d0d7de] dark:border-[#30363d]';
      badgeEl.textContent = `0 ${isViews ? 'views' : 'clones'}`;
    }
    return;
  }

  const dataDays = rawDays.slice(-14);
  const totalCount = dataDays.reduce((sum, d) => sum + (d.count || 0), 0);
  const totalUniques = dataDays.reduce((sum, d) => sum + (d.uniques || 0), 0);

  if (badgeEl) {
    badgeEl.className = isViews 
      ? 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-[#202020] text-[#0969da] dark:text-blue-300 border border-[#d0d7de] dark:border-[#30363d]'
      : 'text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-50 dark:bg-[#202020] text-purple-700 dark:text-purple-300 border border-[#d0d7de] dark:border-[#30363d]';
    badgeEl.textContent = `${totalCount.toLocaleString()} ${isViews ? 'views' : 'clones'} (14d)`;
  }

  container.innerHTML = buildDailyTrendSvgChart(repoName, metricType, dataDays, totalCount, totalUniques);
}

// Generate smooth cubic Catmull-Rom / Bézier spline through points for professional fluid curves
function generateSmoothCurvePath(pts) {
  if (!pts || pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;

  let path = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return path;
}

function buildDailyTrendSvgChart(repoName, metricType, dataDays, totalMetric, totalUniques) {
  const isViews = metricType === 'views';
  const width = 336;
  const height = 110;
  const margin = { top: 22, right: 14, bottom: 20, left: 30 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const counts = dataDays.map(c => c.count || 0);
  const uniquesArr = dataDays.map(c => c.uniques || 0);
  const maxRaw = Math.max(...counts, ...uniquesArr, 1);
  let maxVal = Math.max(maxRaw, 4);
  if (maxRaw > 50) maxVal = Math.ceil(maxRaw / 10) * 10;
  else if (maxRaw > 20) maxVal = Math.ceil(maxRaw / 5) * 5;
  else if (maxRaw > 6) maxVal = Math.ceil(maxRaw / 2) * 2;

  const n = dataDays.length;

  const points = dataDays.map((d, i) => {
    const x = margin.left + (n > 1 ? (i * (plotW / (n - 1))) : (plotW / 2));
    const y = margin.top + plotH - (((d.count || 0) / maxVal) * plotH);
    return { x, y, count: d.count || 0, date: d.date };
  });

  const unqPoints = dataDays.map((d, i) => {
    const x = margin.left + (n > 1 ? (i * (plotW / (n - 1))) : (plotW / 2));
    const y = margin.top + plotH - (((d.uniques || 0) / maxVal) * plotH);
    return { x, y, uniques: d.uniques || 0, date: d.date };
  });

  const baselineY = (margin.top + plotH).toFixed(1);
  const smoothLinePath = generateSmoothCurvePath(points);
  const smoothUnqPath = generateSmoothCurvePath(unqPoints);

  const smoothAreaPath = `${smoothLinePath} L ${points[points.length - 1].x.toFixed(1)} ${baselineY} L ${points[0].x.toFixed(1)} ${baselineY} Z`;

  const primaryColor = isViews ? '#3b82f6' : '#a855f7';
  const primaryLightColor = isViews ? 'text-blue-600 dark:text-blue-400' : 'text-purple-600 dark:text-purple-400';
  const gradId = isViews ? 'qpAreaGradViews' : 'qpAreaGradClones';
  const mainLabel = isViews ? 'Views' : 'Clones';
  const uniquesLabel = isViews ? 'Visitors' : 'Cloners';

  // Find peak point to highlight cleanly
  let peakIdx = 0;
  let peakVal = 0;
  let peakDate = '';
  points.forEach((p, idx) => {
    if (p.count >= peakVal) {
      peakVal = p.count;
      peakIdx = idx;
      peakDate = p.date;
    }
  });

  const peakPoint = points[peakIdx];
  const badgeW = peakVal > 99 ? 28 : (peakVal > 9 ? 22 : 18);
  const badgeX = Math.max(margin.left, Math.min(margin.left + plotW - badgeW, peakPoint.x - (badgeW / 2)));
  const badgeY = Math.max(2, peakPoint.y - 18);

  const peakMarker = peakVal > 0 ? `
    <!-- Peak Callout Badge -->
    <rect x="${badgeX.toFixed(1)}" y="${badgeY.toFixed(1)}" width="${badgeW}" height="14" rx="3" fill="${primaryColor}"/>
    <text x="${(badgeX + badgeW / 2).toFixed(1)}" y="${(badgeY + 10.5).toFixed(1)}" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle">${peakVal}</text>
    <circle cx="${peakPoint.x.toFixed(1)}" cy="${peakPoint.y.toFixed(1)}" r="4" fill="${primaryColor}" stroke="#ffffff" stroke-width="1.8"/>
  ` : '';

  // Non-peak dots
  const regularDots = points.filter((p, i) => i !== peakIdx && p.count > 0).map(p => `
    <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.2" fill="${primaryColor}" opacity="0.8"/>
  `).join('');

  const startDate = points[0] ? formatShortDate(points[0].date) : '';
  const midIdx = Math.floor(points.length / 2);
  const midDate = points[midIdx] ? formatShortDate(points[midIdx].date) : '';
  const endDate = points[points.length - 1] ? formatShortDate(points[points.length - 1].date) : '';

  const halfVal = Math.round(maxVal / 2);

  return `
    <div class="relative w-full space-y-2.5">
      <!-- Mini Informative Metrics Row -->
      <div class="grid grid-cols-3 gap-2 px-2 py-1.5 rounded-[5px] bg-gray-50 dark:bg-[#181818] border border-[#d0d7de] dark:border-[#30363d] text-center">
        <div>
          <span class="block text-xs font-bold text-gray-900 dark:text-white leading-tight">${totalMetric.toLocaleString()}</span>
          <span class="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium">14d ${mainLabel}</span>
        </div>
        <div class="border-x border-[#d0d7de] dark:border-[#30363d]">
          <span class="block text-xs font-bold text-emerald-600 dark:text-emerald-400 leading-tight">${totalUniques.toLocaleString()}</span>
          <span class="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium">14d ${uniquesLabel}</span>
        </div>
        <div>
          <span class="block text-xs font-bold ${primaryLightColor} leading-tight">${peakVal.toLocaleString()}</span>
          <span class="text-[9.5px] text-gray-500 dark:text-gray-400 font-medium">Daily Peak</span>
        </div>
      </div>

      <!-- Graph Header Legend -->
      <div class="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 px-0.5">
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-0.5 ${isViews ? 'bg-blue-500' : 'bg-purple-500'} rounded-xs"></span>
            <span class="font-medium ${isViews ? 'text-blue-500 dark:text-blue-400' : 'text-purple-500 dark:text-purple-400'}">${mainLabel}</span>
          </span>
          <span class="flex items-center gap-1.5">
            <span class="w-2.5 h-0.5 border-b border-dashed border-emerald-500"></span>
            <span class="font-medium text-emerald-600 dark:text-emerald-400">${uniquesLabel}</span>
          </span>
        </div>
        ${peakVal > 0 ? `<span class="text-[10px] text-gray-500 dark:text-gray-400 font-medium">Peak on ${formatShortDate(peakDate)}</span>` : ''}
      </div>

      <!-- High-Fidelity SVG Line Graph -->
      <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto overflow-visible select-none">
        <defs>
          <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${primaryColor}" stop-opacity="0.30"/>
            <stop offset="100%" stop-color="${primaryColor}" stop-opacity="0.0"/>
          </linearGradient>
        </defs>

        <!-- Horizontal Guide Gridlines -->
        <!-- Top Guideline -->
        <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left + plotW}" y2="${margin.top}" stroke="currentColor" class="text-gray-200 dark:text-[#2d333b]" stroke-dasharray="2 3" stroke-width="1"/>
        <text x="${margin.left - 5}" y="${margin.top + 3.5}" text-anchor="end" font-size="8" font-family="monospace" class="fill-gray-400 dark:fill-gray-500">${maxVal}</text>

        <!-- Mid Guideline -->
        <line x1="${margin.left}" y1="${margin.top + (plotH / 2)}" x2="${margin.left + plotW}" y2="${margin.top + (plotH / 2)}" stroke="currentColor" class="text-gray-200 dark:text-[#2d333b]" stroke-dasharray="2 3" stroke-width="1"/>
        <text x="${margin.left - 5}" y="${margin.top + (plotH / 2) + 3.5}" text-anchor="end" font-size="8" font-family="monospace" class="fill-gray-400 dark:fill-gray-500">${halfVal}</text>

        <!-- Baseline -->
        <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="currentColor" class="text-gray-300 dark:text-[#38404a]" stroke-width="1"/>
        <text x="${margin.left - 5}" y="${margin.top + plotH + 3.5}" text-anchor="end" font-size="8" font-family="monospace" class="fill-gray-400 dark:fill-gray-500">0</text>

        <!-- Smooth Area Gradient Fill -->
        <path d="${smoothAreaPath}" fill="url(#${gradId})"/>

        <!-- Smooth Uniques Line (Dashed Emerald) -->
        <path d="${smoothUnqPath}" fill="none" stroke="#10b981" stroke-width="1.3" stroke-dasharray="2.5 2.5" opacity="0.85"/>

        <!-- Smooth Primary Main Line (Rich Curved Stroke) -->
        <path d="${smoothLinePath}" fill="none" stroke="${primaryColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>

        <!-- Data Points & Peak Callout -->
        ${regularDots}
        ${peakMarker}

        <!-- Date Axis Labels -->
        <text x="${margin.left}" y="${margin.top + plotH + 14}" text-anchor="start" font-size="8" class="fill-gray-500 dark:fill-gray-400 font-medium">${startDate}</text>
        <text x="${margin.left + (plotW / 2)}" y="${margin.top + plotH + 14}" text-anchor="middle" font-size="8" class="fill-gray-400 dark:fill-gray-500">${midDate}</text>
        <text x="${margin.left + plotW}" y="${margin.top + plotH + 14}" text-anchor="end" font-size="8" class="fill-gray-500 dark:fill-gray-400 font-medium">${endDate}</text>
      </svg>

      <!-- Footer Action -->
      <div class="pt-2 border-t border-[#d0d7de] dark:border-[#30363d] flex items-center justify-between text-xs">
        <div class="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-[11px]">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>Rolling 14-day window</span>
        </div>
        <button 
          onclick="viewRepoDeepDive('${escapeHtml(repoName)}'); hideQuickPreview();" 
          class="text-xs font-semibold text-[#0969da] dark:text-[#58a6ff] hover:underline flex items-center gap-1 transition-colors"
        >
          <span>Deep Dive</span>
          <i class="fa-solid fa-arrow-right text-[10px]"></i>
        </button>
      </div>
    </div>
  `;
}

// ============================================================================
// Referrers and Paths
// ============================================================================
function renderTopReferrers(referrers) {
  const container = document.getElementById('topReferrersList');
  if (!container) return;

  if (referrers.length === 0) {
    container.innerHTML = `<p class="text-xs text-gray-400 italic">No external referrers recorded yet.</p>`;
    return;
  }

  const maxViews = Math.max(...referrers.map(r => r.count || 1), 1);

  container.innerHTML = referrers.slice(0, 8).map(r => {
    const pct = Math.round((r.count / maxViews) * 100);
    return `
      <div>
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
            <i class="fa-solid fa-globe text-gray-400 text-[11px]"></i> ${r.referrer}
          </span>
          <span class="font-bold text-gray-900 dark:text-white">${r.count.toLocaleString()} views <span class="font-normal text-gray-400">(${r.uniques} unique)</span></span>
        </div>
        <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div class="bg-teal-500 h-1.5 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTopPaths(paths) {
  const container = document.getElementById('topPathsList');
  if (!container) return;

  if (paths.length === 0) {
    container.innerHTML = `<p class="text-xs text-gray-400 italic">No path metrics recorded yet.</p>`;
    return;
  }

  const maxViews = Math.max(...paths.map(p => p.count || 1), 1);

  container.innerHTML = paths.slice(0, 8).map(p => {
    const pct = Math.round((p.count / maxViews) * 100);
    return `
      <div>
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-mono text-gray-700 dark:text-gray-300 truncate max-w-[240px]" title="${p.path}">
            ${p.path}
          </span>
          <span class="font-bold text-gray-900 dark:text-white">${p.count.toLocaleString()} <span class="font-normal text-gray-400">(${p.uniques} unq)</span></span>
        </div>
        <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div class="bg-indigo-500 h-1.5 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Repository Explorer Tab (Deep Dive)
// ============================================================================
function populateRepoDropdown(repos) {
  const dropdown = document.getElementById('repoDropdown');
  if (!dropdown) return;

  dropdown.innerHTML = repos.map(r => `
    <option value="${r.name}">${r.name} (${r.language || 'Code'})</option>
  `).join('');

  if (state.selectedRepo && repos.some(r => r.name === state.selectedRepo)) {
    dropdown.value = state.selectedRepo;
  }
}

async function onRepoSelect(repoName) {
  state.selectedRepo = repoName;
  const breadcrumb = document.getElementById('breadcrumbRepoName');
  if (breadcrumb) breadcrumb.textContent = repoName;

  const dropdown = document.getElementById('repoDropdown');
  if (dropdown && dropdown.value !== repoName) {
    dropdown.value = repoName;
  }

  if (state.currentTab === 'explorer') {
    const targetHash = `#/inspect?repo=${encodeURIComponent(repoName)}`;
    if (window.location.hash !== targetHash) {
      window.history.replaceState({ tab: 'explorer', repo: repoName }, '', targetHash);
    }
  }

  let repo = state.repoDetails[repoName];

  if (!repo) {
    // Try to fetch individual repo JSON file
    try {
      const res = await fetch(`./data/repositories/${repoName}.json`);
      if (res.ok) {
        repo = await res.json();
        state.repoDetails[repoName] = repo;
      }
    } catch (e) {
      console.warn(`Could not load ./data/repositories/${repoName}.json:`, e);
    }
  }

  // Fallback to overview item or generate simulated history if needed
  if (!repo) {
    const summaryItem = state.summary?.repositories?.find(r => r.name === repoName);
    repo = summaryItem ? createSimulatedRepoRecord(summaryItem) : null;
  }

  if (repo) {
    renderRepoDeepDive(repo);
  }
}

function renderRepoDeepDive(repo) {
  document.getElementById('deepRepoName').textContent = repo.name;
  const link = document.getElementById('deepRepoLink');
  link.href = repo.html_url || `https://github.com/${repo.full_name || repo.name}`;

  document.getElementById('deepRepoDesc').textContent = repo.description || 'No description provided for this repository.';

  // Badges
  const tagsContainer = document.getElementById('deepRepoTags');
  tagsContainer.innerHTML = `
    ${repo.language ? `<span class="px-2 py-0.5 bg-gray-100 dark:bg-[#202020] text-[#57606a] dark:text-[#8b949e] border border-[#e1e4e8] dark:border-darkborder rounded-md text-xs font-normal">${escapeHtml(repo.language)}</span>` : ''}
    <span class="px-2 py-0.5 bg-gray-100 dark:bg-[#202020] text-[#57606a] dark:text-[#8b949e] border border-[#e1e4e8] dark:border-darkborder rounded-md text-xs font-normal"><i class="fa-regular fa-star text-[11px] mr-1"></i>${(repo.stars || 0).toLocaleString()} Stars</span>
    <span class="px-2 py-0.5 bg-gray-100 dark:bg-[#202020] text-[#57606a] dark:text-[#8b949e] border border-[#e1e4e8] dark:border-darkborder rounded-md text-xs font-normal"><i class="fa-solid fa-code-fork text-[11px] mr-1"></i>${(repo.forks || 0).toLocaleString()} Forks</span>
    <span class="px-2 py-0.5 bg-gray-100 dark:bg-[#202020] text-[#57606a] dark:text-[#8b949e] border border-[#e1e4e8] dark:border-darkborder rounded-md text-xs font-normal"><i class="fa-regular fa-circle-dot text-[11px] mr-1"></i>${(repo.open_issues || 0)} Issues</span>
  `;

  // Mini Stats
  const s = repo.summary || {};
  document.getElementById('deepViewsTotal').textContent = (s.all_time_views || 0).toLocaleString();
  document.getElementById('deepClonesTotal').textContent = (s.all_time_clones || 0).toLocaleString();
  document.getElementById('deepViews14d').textContent = (s.views_14d || 0).toLocaleString();
  document.getElementById('deepConversionRate').textContent = `${(s.clone_conversion_pct || 0)}%`;

  // Charts
  renderRepoCharts(repo);

  // Forkers
  renderRepoForkers(repo.forker_list || []);

  // Referrers & Paths
  renderRepoReferrers(repo.referrers || []);
  renderRepoPaths(repo.paths || []);
}

function renderRepoCharts(repo) {
  const viewsCanvas = document.getElementById('repoViewsChart');
  const clonesCanvas = document.getElementById('repoClonesChart');
  if (!viewsCanvas || !clonesCanvas) return;

  const colors = getChartColors();
  const views = repo.views || [];
  const clones = repo.clones || [];

  // Views Chart
  if (state.charts.repoViews) state.charts.repoViews.destroy();
  state.charts.repoViews = new Chart(viewsCanvas, {
    type: 'line',
    data: {
      labels: views.map(v => formatDateLabel(v.date)),
      datasets: [
        {
          label: 'Views',
          data: views.map(v => v.count),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.15)',
          fill: true,
          tension: 0.4,
          borderWidth: 2.5
        },
        {
          label: 'Uniques',
          data: views.map(v => v.uniques),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          borderDash: [5, 5]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colors.text } }
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.text, maxTicksLimit: 8 } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.text, beginAtZero: true } }
      }
    }
  });

  // Clones Chart
  if (state.charts.repoClones) state.charts.repoClones.destroy();
  state.charts.repoClones = new Chart(clonesCanvas, {
    type: 'bar',
    data: {
      labels: clones.map(c => formatDateLabel(c.date)),
      datasets: [
        {
          label: 'Clones',
          data: clones.map(c => c.count),
          backgroundColor: '#f59e0b', // amber-500
          borderRadius: 4
        },
        {
          label: 'Unique Cloners',
          data: clones.map(c => c.uniques),
          backgroundColor: '#ef4444', // red-500
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colors.text } }
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.text, maxTicksLimit: 8 } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.text, beginAtZero: true } }
      }
    }
  });
}

function renderRepoForkers(forkers) {
  const c = document.getElementById('repoForkersList');
  if (!c) return;
  if (!forkers || forkers.length === 0) {
    c.innerHTML = '<div class="text-sm text-gray-500 dark:text-gray-400">No fork data available yet.</div>';
    return;
  }

  c.innerHTML = forkers.map(f => `
    <a href="${f.html_url}" target="_blank" rel="noopener noreferrer" class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
      <img src="${f.avatar_url}&s=40" alt="${f.login}" class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700">
      <div class="overflow-hidden">
        <div class="font-medium text-sm text-gray-900 dark:text-white truncate">${f.login}</div>
        <div class="text-[10px] text-gray-500 dark:text-gray-400">${formatDateLabel(f.created_at)}</div>
      </div>
    </a>
  `).join('');
}

function renderRepoReferrers(referrers) {
  const c = document.getElementById('repoReferrersList');
  if (!c) return;
  if (!referrers || referrers.length === 0) {
    c.innerHTML = `<p class="text-xs text-gray-400 italic">No external referrers recorded for this repository.</p>`;
    return;
  }
  const max = Math.max(...referrers.map(r => r.total_count || r.count || 1), 1);
  c.innerHTML = referrers.map(r => {
    const cnt = r.total_count || r.count;
    const unq = r.total_uniques || r.uniques;
    const pct = Math.round((cnt / max) * 100);
    return `
      <div>
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-medium text-gray-800 dark:text-gray-200">${r.referrer}</span>
          <span class="font-bold text-gray-900 dark:text-white">${cnt.toLocaleString()} <span class="font-normal text-gray-400">(${unq} unq)</span></span>
        </div>
        <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div class="bg-teal-500 h-1.5 rounded-full" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderRepoPaths(paths) {
  const c = document.getElementById('repoPathsList');
  if (!c) return;
  if (!paths || paths.length === 0) {
    c.innerHTML = `<p class="text-xs text-gray-400 italic">No path analytics recorded for this repository.</p>`;
    return;
  }
  const max = Math.max(...paths.map(p => p.total_count || p.count || 1), 1);
  c.innerHTML = paths.map(p => {
    const cnt = p.total_count || p.count;
    const unq = p.total_uniques || p.uniques;
    const pct = Math.round((cnt / max) * 100);
    return `
      <div>
        <div class="flex items-center justify-between text-xs mb-1">
          <span class="font-mono text-gray-700 dark:text-gray-300 truncate max-w-[200px]" title="${p.path}">${p.path}</span>
          <span class="font-bold text-gray-900 dark:text-white">${cnt.toLocaleString()} <span class="font-normal text-gray-400">(${unq} unq)</span></span>
        </div>
        <div class="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5 overflow-hidden">
          <div class="bg-indigo-500 h-1.5 rounded-full" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// Compare Mode Tab
// ============================================================================
function renderCompareTab() {
  const container = document.getElementById('compareRepoCheckboxes');
  if (!container || !state.summary) return;

  const repos = state.summary.repositories || [];
  container.innerHTML = repos.map(r => `
    <label class="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-[#161616] border border-[#e1e4e8] dark:border-darkborder text-xs font-medium cursor-pointer hover:border-[#0969da] dark:hover:border-gray-500 transition-colors">
      <input type="checkbox" value="${r.name}" ${state.comparedRepos.includes(r.name) ? 'checked' : ''} onchange="onCompareToggle(this)" class="rounded text-[#0969da] focus:ring-0">
      <span class="truncate text-gray-900 dark:text-white">${escapeHtml(r.name)}</span>
    </label>
  `).join('');

  renderCompareChart();
  renderCompareCards();
}

function onCompareToggle(checkbox) {
  const name = checkbox.value;
  if (checkbox.checked) {
    if (state.comparedRepos.length >= 4) {
      alert('You can compare up to 4 repositories simultaneously.');
      checkbox.checked = false;
      return;
    }
    state.comparedRepos.push(name);
  } else {
    state.comparedRepos = state.comparedRepos.filter(n => n !== name);
  }
  renderCompareChart();
  renderCompareCards();
}

function renderCompareChart() {
  const canvas = document.getElementById('compareChart');
  if (!canvas || !state.summary) return;

  const colors = getChartColors();
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

  // Gather dates from the summary timeline (last 30 days)
  const timeline = (state.summary.daily_timeline || []).slice(-30);
  const labels = timeline.map(t => formatDateLabel(t.date));

  // For each compared repo, get view history
  const datasets = state.comparedRepos.map((repoName, idx) => {
    let repo = state.repoDetails[repoName];
    if (!repo) {
      const summaryItem = state.summary.repositories.find(r => r.name === repoName);
      repo = summaryItem ? createSimulatedRepoRecord(summaryItem) : { views: [] };
    }

    const viewsMap = Object.fromEntries((repo.views || []).map(v => [formatDateLabel(v.date), v.count]));
    const data = labels.map(d => viewsMap[d] || 0);

    return {
      label: repoName,
      data: data,
      borderColor: palette[idx % palette.length],
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      tension: 0.35
    };
  });

  if (state.charts.compare) state.charts.compare.destroy();
  state.charts.compare = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colors.text } }
      },
      scales: {
        x: { grid: { color: colors.grid }, ticks: { color: colors.text, maxTicksLimit: 10 } },
        y: { grid: { color: colors.grid }, ticks: { color: colors.text, beginAtZero: true } }
      }
    }
  });
}

function renderCompareCards() {
  const grid = document.getElementById('compareCardsGrid');
  if (!grid || !state.summary) return;

  grid.innerHTML = state.comparedRepos.map(name => {
    const r = state.summary.repositories.find(x => x.name === name);
    if (!r) return '';
    return `
      <div class="bg-white dark:bg-[#161616] border border-[#e1e4e8] dark:border-[#333333] rounded-lg p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="font-bold text-gray-900 dark:text-white truncate text-sm">${escapeHtml(r.name)}</h4>
          <span class="text-xs text-[#57606a] dark:text-[#8b949e] font-normal flex items-center gap-1"><i class="fa-regular fa-star text-[11px]"></i>${r.stars}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="p-2 rounded-md bg-gray-50 dark:bg-[#202020] border border-[#e1e4e8] dark:border-[#333333]">
            <span class="text-[#57606a] dark:text-[#8b949e] text-[11px]">14d Views:</span>
            <div class="font-bold text-[#0969da] dark:text-white text-sm">${(r.views_14d || 0).toLocaleString()}</div>
          </div>
          <div class="p-2 rounded-md bg-gray-50 dark:bg-[#202020] border border-[#e1e4e8] dark:border-[#333333]">
            <span class="text-[#57606a] dark:text-[#8b949e] text-[11px]">14d Clones:</span>
            <div class="font-bold text-[#0969da] dark:text-white text-sm">${(r.clones_14d || 0).toLocaleString()}</div>
          </div>
          <div class="p-2 rounded-md bg-gray-50 dark:bg-[#202020] border border-[#e1e4e8] dark:border-[#333333]">
            <span class="text-[#57606a] dark:text-[#8b949e] text-[11px]">All-Time Views:</span>
            <div class="font-bold text-gray-900 dark:text-white text-sm">${(r.all_time_views || 0).toLocaleString()}</div>
          </div>
          <div class="p-2 rounded-md bg-gray-50 dark:bg-[#202020] border border-[#e1e4e8] dark:border-[#333333]">
            <span class="text-[#57606a] dark:text-[#8b949e] text-[11px]">Conversion:</span>
            <div class="font-bold text-emerald-600 dark:text-emerald-400 text-sm">${r.clone_conversion_pct || 0}%</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// On-Demand Live Fetch Engine (Client-Side)
// ============================================================================
function initPatInput() {
  const token = localStorage.getItem('traffic_pat');
  if (token) {
    const input = document.getElementById('livePatInput');
    if (input) input.value = token;
  }
  updateRateLimitDisplay();
}

function saveLiveToken() {
  const val = document.getElementById('livePatInput').value.trim();
  if (!val) {
    alert('Please enter a valid GitHub token.');
    return;
  }
  localStorage.setItem('traffic_pat', val);
  updateRateLimitDisplay();
  alert('Token saved locally in browser.');
}

function clearLiveToken() {
  localStorage.removeItem('traffic_pat');
  document.getElementById('livePatInput').value = '';
  updateRateLimitDisplay();
  alert('Token removed.');
}

async function updateRateLimitDisplay() {
  const token = localStorage.getItem('traffic_pat') || document.getElementById('livePatInput')?.value?.trim();
  const badges = document.querySelectorAll('.rate-limit-badge');
  if (badges.length === 0) return;
  
  if (!token) {
    badges.forEach(b => b.classList.add('hidden'));
    return;
  }
  
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (res.ok) {
      const data = await res.json();
      const remaining = data.resources.core.remaining;
      const limit = data.resources.core.limit;
      badges.forEach(badge => {
        badge.textContent = `${remaining}/${limit}`;
        badge.title = `GitHub API Rate Limit: ${remaining} requests remaining out of ${limit} per hour`;
        badge.classList.remove('hidden');
      });
    } else {
      badges.forEach(b => b.classList.add('hidden'));
    }
  } catch (e) {
    badges.forEach(b => b.classList.add('hidden'));
  }
}

async function triggerLeaderboardRefresh() {
  const token = localStorage.getItem('traffic_pat') || document.getElementById('livePatInput')?.value?.trim();
  if (!token) {
    alert('Please configure your GitHub Personal Access Token in the "On-Demand Sync" tab first.');
    navigateTo('live');
    return;
  }
  
  const refreshIcon = document.getElementById('lbrRefreshIcon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');
  
  try {
    await runLiveSync(true); // pass true to indicate silent mode
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');
    updateRateLimitDisplay();
  }
}

function appendLiveLog(msg) {
  const container = document.getElementById('liveProgressContainer');
  container.classList.remove('hidden');
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  container.appendChild(line);
  container.scrollTop = container.scrollHeight;
}

async function runLiveSync() {
  const token = document.getElementById('livePatInput').value.trim();
  if (!token) {
    alert('Please enter a GitHub Personal Access Token with repo scope to perform on-demand sync.');
    return;
  }

  const btn = document.getElementById('liveSyncBtn');
  const icon = document.getElementById('liveSyncIcon');
  const status = document.getElementById('liveStatusText');
  const progressBox = document.getElementById('liveProgressContainer');

  progressBox.innerHTML = '';
  progressBox.classList.remove('hidden');

  btn.disabled = true;
  icon.classList.add('animate-spin');
  status.textContent = 'Contacting GitHub API...';

  try {
    appendLiveLog('Connecting to GitHub API (/user)...');
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!userRes.ok) throw new Error(`Authentication failed (${userRes.status}). Verify your token.`);
    const user = await userRes.json();
    appendLiveLog(`Authenticated as ${user.login}. Fetching repository catalog...`);

    // Fetch user repos
    const reposRes = await fetch('https://api.github.com/user/repos?affiliation=owner&per_page=100', {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
    });
    const repos = await reposRes.json();
    appendLiveLog(`Found ${repos.length} repositories.`);

    const liveRepoRecords = [];
    for (let i = 0; i < repos.length; i++) {
      const r = repos[i];
      status.textContent = `Syncing [${i + 1}/${repos.length}]: ${r.name}...`;
      appendLiveLog(`Fetching traffic for ${r.name}...`);

      const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' };
      const baseUrl = `https://api.github.com/repos/${r.owner.login}/${r.name}/traffic`;

      const [viewsRes, clonesRes, refRes, pathRes] = await Promise.allSettled([
        fetch(`${baseUrl}/views?per=day`, { headers }),
        fetch(`${baseUrl}/clones?per=day`, { headers }),
        fetch(`${baseUrl}/popular/referrers`, { headers }),
        fetch(`${baseUrl}/popular/paths`, { headers })
      ]);

      const viewsData = viewsRes.status === 'fulfilled' && viewsRes.value.ok ? await viewsRes.value.json() : { views: [] };
      const clonesData = clonesRes.status === 'fulfilled' && clonesRes.value.ok ? await clonesRes.value.json() : { clones: [] };
      const refData = refRes.status === 'fulfilled' && refRes.value.ok ? await refRes.value.json() : [];
      const pathData = pathRes.status === 'fulfilled' && pathRes.value.ok ? await pathRes.value.json() : [];

      // Process and normalize dates
      const normViews = (viewsData.views || []).map(v => ({ date: v.timestamp.slice(0, 10), count: v.count, uniques: v.uniques }));
      const normClones = (clonesData.clones || []).map(c => ({ date: c.timestamp.slice(0, 10), count: c.count, uniques: c.uniques }));

      // Merge with existing historical records so we NEVER lose older history
      const existing = state.repoDetails[r.name] || (state.summary && state.summary.repositories ? state.summary.repositories.find(sr => sr.name === r.name) : null) || {};
      const mergedViews = mergeClientTimeSeries(existing.views, normViews);
      const mergedClones = mergeClientTimeSeries(existing.clones, normClones);

      const v14 = normViews.reduce((a, b) => a + (b.count || 0), 0);
      const u14 = normViews.reduce((a, b) => a + (b.uniques || 0), 0);
      const c14 = normClones.reduce((a, b) => a + (b.count || 0), 0);
      const uc14 = normClones.reduce((a, b) => a + (b.uniques || 0), 0);

      const allViews = mergedViews.length > 0 ? mergedViews.reduce((a, b) => a + (b.count || 0), 0) : Math.max(existing.all_time_views || 0, v14);
      const allClones = mergedClones.length > 0 ? mergedClones.reduce((a, b) => a + (b.count || 0), 0) : Math.max(existing.all_time_clones || 0, c14);
      const allUniques = mergedViews.length > 0 ? mergedViews.reduce((a, b) => a + (b.uniques || 0), 0) : (existing.all_time_uniques || u14);
      const allUniqueCloners = mergedClones.length > 0 ? mergedClones.reduce((a, b) => a + (b.uniques || 0), 0) : (existing.all_time_unique_cloners || uc14);

      liveRepoRecords.push({
        name: r.name,
        full_name: r.full_name,
        html_url: r.html_url,
        description: r.description,
        language: r.language,
        is_private: Boolean(r.private),
        is_fork: Boolean(r.fork),
        stars: r.stargazers_count,
        forks: r.forks_count,
        open_issues: r.open_issues_count,
        views_14d: v14,
        uniques_14d: u14,
        clones_14d: c14,
        unique_cloners_14d: uc14,
        all_time_views: allViews,
        all_time_clones: allClones,
        all_time_uniques: allUniques,
        all_time_unique_cloners: allUniqueCloners,
        clone_conversion_pct: allViews > 0 ? Math.round((allClones / allViews) * 100) : 0,
        views: mergedViews,
        clones: mergedClones,
        referrers: refData,
        paths: pathData,
        forker_list: existing.forker_list || []
      });
    }

    appendLiveLog('Aggregating real-time summary...');
    // Build live summary
    const liveSummary = constructLiveSummary(liveRepoRecords);
    state.summary = liveSummary;
    liveRepoRecords.forEach(rec => { state.repoDetails[rec.name] = rec; });

    document.getElementById('syncBadge').innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5"></span> Live Synced`;
    document.getElementById('offlineNotice').classList.add('hidden');

    populateDashboard(liveSummary);
    appendLiveLog('Success! Dashboard updated with real-time GitHub numbers.');
    status.textContent = 'Sync completed successfully!';
    alert('Real-time sync complete! Dashboard updated.');
  } catch (err) {
    appendLiveLog(`ERROR: ${err.message}`);
    status.textContent = 'Sync failed.';
    alert(`Sync error: ${err.message}`);
  } finally {
    btn.disabled = false;
    icon.classList.remove('animate-spin');
    updateRateLimitDisplay();
  }
}

function constructLiveSummary(records) {
  const timelineMap = {};
  const globalRef = {};
  const globalPaths = {};

  let totalStars = 0, totalForks = 0, totalV14 = 0, totalC14 = 0;
  let totalAllViews = 0, totalAllClones = 0, totalAllUniques = 0, totalAllUniqueCloners = 0;

  records.forEach(r => {
    totalStars += (r.stars || 0);
    totalForks += (r.forks || 0);
    totalV14 += (r.views_14d || 0);
    totalC14 += (r.clones_14d || 0);
    totalAllViews += (r.all_time_views || 0);
    totalAllClones += (r.all_time_clones || 0);
    totalAllUniques += (r.all_time_uniques || 0);
    totalAllUniqueCloners += (r.all_time_unique_cloners || 0);

    (r.views || []).forEach(v => {
      if (!timelineMap[v.date]) timelineMap[v.date] = { date: v.date, views: 0, uniques: 0, clones: 0, unique_cloners: 0 };
      timelineMap[v.date].views += (v.count || 0);
      timelineMap[v.date].uniques += (v.uniques || 0);
    });

    (r.clones || []).forEach(c => {
      if (!timelineMap[c.date]) timelineMap[c.date] = { date: c.date, views: 0, uniques: 0, clones: 0, unique_cloners: 0 };
      timelineMap[c.date].clones += (c.count || 0);
      timelineMap[c.date].unique_cloners += (c.uniques || 0);
    });

    (r.referrers || []).forEach(ref => {
      if (!globalRef[ref.referrer]) globalRef[ref.referrer] = { referrer: ref.referrer, count: 0, uniques: 0 };
      globalRef[ref.referrer].count += (ref.count || 0);
      globalRef[ref.referrer].uniques += (ref.uniques || 0);
    });

    (r.paths || []).forEach(p => {
      if (!globalPaths[p.path]) globalPaths[p.path] = { path: p.path, count: 0, uniques: 0 };
      globalPaths[p.path].count += (p.count || 0);
      globalPaths[p.path].uniques += (p.uniques || 0);
    });
  });

  const sortedTimeline = Object.values(timelineMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    updated_at: new Date().toISOString(),
    total_repositories_tracked: records.length,
    kpis: {
      all_time_views: totalAllViews,
      all_time_uniques: totalAllUniques > 0 ? totalAllUniques : Math.round(totalAllViews * 0.45),
      all_time_clones: totalAllClones,
      all_time_unique_cloners: totalAllUniqueCloners > 0 ? totalAllUniqueCloners : Math.round(totalAllClones * 0.6),
      views_14d: totalV14,
      clones_14d: totalC14,
      total_stars: totalStars,
      total_forks: totalForks
    },
    daily_timeline: sortedTimeline,
    repositories: records,
    top_referrers: Object.values(globalRef).sort((a, b) => b.count - a.count),
    top_paths: Object.values(globalPaths).sort((a, b) => b.count - a.count)
  };
}

// ============================================================================
// Export Engine
// ============================================================================
function exportDataJSON() {
  if (!state.summary) {
    alert('No data available to export.');
    return;
  }
  const blob = new Blob([JSON.stringify(state.summary, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `github-traffic-archive-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// Demo / Preview Data Generator (Guarantees zero-config instant preview)
// ============================================================================
function generatePreviewData() {
  const dates = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const timeline = dates.map((dt, idx) => {
    const base = 45 + Math.floor(Math.sin(idx * 0.4) * 20);
    const views = base + Math.floor(Math.random() * 25);
    const uniques = Math.round(views * 0.55);
    const clones = Math.floor(views * 0.18);
    const unique_cloners = Math.max(1, Math.floor(clones * 0.7));
    return { date: dt, views, uniques, clones, unique_cloners };
  });

  const repos = [
    {
      name: 'nathyBekele.github.io',
      language: 'Liquid',
      stars: 14,
      forks: 4,
      open_issues: 0,
      description: 'Personal academic & developer portfolio website built on Jekyll and al-folio.',
      views_14d: 642,
      uniques_14d: 312,
      clones_14d: 48,
      all_time_views: 3840,
      all_time_clones: 290,
      clone_conversion_pct: 7.6
    },
    {
      name: 'cursor-spend-tracker',
      language: 'TypeScript',
      stars: 28,
      forks: 6,
      open_issues: 1,
      description: 'Lightweight Chrome extension & real-time cost intelligence dashboard for Cursor AI API spend.',
      views_14d: 418,
      uniques_14d: 195,
      clones_14d: 72,
      all_time_views: 2450,
      all_time_clones: 340,
      clone_conversion_pct: 13.9
    },
    {
      name: 'redash-chatbot-add-on',
      language: 'Python',
      stars: 19,
      forks: 5,
      open_issues: 2,
      description: 'Conversational BI chatbot extension for Redash converting natural language to SQL queries.',
      views_14d: 280,
      uniques_14d: 130,
      clones_14d: 38,
      all_time_views: 1820,
      all_time_clones: 190,
      clone_conversion_pct: 10.4
    },
    {
      name: 'amharic-hate-speech-detection',
      language: 'Jupyter Notebook',
      stars: 32,
      forks: 8,
      open_issues: 0,
      description: 'Deep learning NLP benchmark and classification models for low-resource Amharic text.',
      views_14d: 215,
      uniques_14d: 110,
      clones_14d: 44,
      all_time_views: 1940,
      all_time_clones: 310,
      clone_conversion_pct: 16.0
    },
    {
      name: 'vula',
      language: 'TypeScript',
      stars: 12,
      forks: 2,
      open_issues: 0,
      description: 'Agentic pitch deck generator and presentation builder powered by Claude and GPT-4o.',
      views_14d: 184,
      uniques_14d: 88,
      clones_14d: 22,
      all_time_views: 920,
      all_time_clones: 115,
      clone_conversion_pct: 12.5
    },
    {
      name: 'promptkit',
      language: 'Python',
      stars: 8,
      forks: 1,
      open_issues: 0,
      description: 'Production prompt testing, optimization, and regression testing harness for LLMs.',
      views_14d: 96,
      uniques_14d: 46,
      clones_14d: 16,
      all_time_views: 450,
      all_time_clones: 62,
      clone_conversion_pct: 13.8
    }
  ];

  return {
    updated_at: new Date().toISOString(),
    total_repositories_tracked: repos.length,
    kpis: {
      all_time_views: 11420,
      all_time_uniques: 5840,
      all_time_clones: 1307,
      all_time_unique_cloners: 790,
      views_14d: 1835,
      clones_14d: 240,
      total_stars: 113,
      total_forks: 26,
      total_open_issues: 3
    },
    daily_timeline: timeline,
    repositories: repos,
    top_referrers: [
      { referrer: 'github.com', count: 820, uniques: 410 },
      { referrer: 'google.com', count: 480, uniques: 310 },
      { referrer: 'linkedin.com', count: 320, uniques: 240 },
      { referrer: 't.co (Twitter/X)', count: 180, uniques: 135 },
      { referrer: 'reddit.com', count: 140, uniques: 95 },
      { referrer: 'huggingface.co', count: 95, uniques: 65 }
    ],
    top_paths: [
      { path: '/README.md', count: 940, uniques: 520 },
      { path: '/releases', count: 280, uniques: 180 },
      { path: '/blob/main/package.json', count: 190, uniques: 120 },
      { path: '/tree/main/src', count: 160, uniques: 95 },
      { path: '/issues', count: 85, uniques: 50 }
    ]
  };
}

function createSimulatedRepoRecord(item) {
  const dates = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const views = dates.map(dt => {
    const count = Math.max(1, Math.round((item.views_14d / 14) * (0.6 + Math.random() * 0.8)));
    const uniques = Math.max(1, Math.round(count * 0.6));
    return { date: dt, count, uniques };
  });

  const clones = dates.map(dt => {
    const count = Math.max(0, Math.round((item.clones_14d / 14) * (0.4 + Math.random() * 1.2)));
    const uniques = Math.max(0, Math.round(count * 0.8));
    return { date: dt, count, uniques };
  });

  return {
    ...item,
    views,
    clones,
    referrers: [
      { referrer: 'github.com', count: Math.round(item.views_14d * 0.45), uniques: Math.round(item.uniques_14d * 0.45) },
      { referrer: 'google.com', count: Math.round(item.views_14d * 0.3), uniques: Math.round(item.uniques_14d * 0.3) },
      { referrer: 'linkedin.com', count: Math.round(item.views_14d * 0.2), uniques: Math.round(item.uniques_14d * 0.2) }
    ],
    paths: [
      { path: '/README.md', count: Math.round(item.views_14d * 0.6), uniques: Math.round(item.uniques_14d * 0.6) },
      { path: '/releases', count: Math.round(item.views_14d * 0.2), uniques: Math.round(item.uniques_14d * 0.2) }
    ],
    summary: {
      all_time_views: item.all_time_views,
      all_time_clones: item.all_time_clones,
      views_14d: item.views_14d,
      uniques_14d: item.uniques_14d,
      clones_14d: item.clones_14d,
      clone_conversion_pct: item.clone_conversion_pct
    }
  };
}
