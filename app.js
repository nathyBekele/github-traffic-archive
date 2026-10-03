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
  charts: {
    global: null,
    repoViews: null,
    repoClones: null,
    compare: null
  },
  tableSort: {
    column: 'range_views',
    asc: false
  },
  searchQuery: '',
  inFlightFetches: new Map() // Track ongoing requests
};

// ============================================================================
// Initialization & Theme Handling
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initPatInput();
  loadData();
});

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
// Navigation Tabs
// ============================================================================
function switchTab(tabId) {
  state.currentTab = tabId;
  const tabs = ['overview', 'explorer', 'compare', 'live'];

  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tabBtn-${t}`);
    if (t === tabId) {
      el.classList.remove('hidden');
      if (btn) {
        btn.className = 'tab-btn px-3.5 py-1.5 font-medium rounded-lg transition-all text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-700 shadow-sm';
      }
    } else {
      el.classList.add('hidden');
      if (btn) {
        btn.className = 'tab-btn px-3.5 py-1.5 font-medium rounded-lg transition-all text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white';
      }
    }
  });

  if (tabId === 'overview') {
    renderGlobalChart();
  } else if (tabId === 'explorer' && state.selectedRepo) {
    onRepoSelect(state.selectedRepo);
  } else if (tabId === 'compare') {
    renderCompareTab();
  }
}

function toggleMobileMenu() {
  const m = document.getElementById('mobileMenu');
  m.classList.toggle('hidden');
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
    // Fetch in background for faster custom date range interactions
    ensureAllRepoDetailsLoaded().then(() => {
      // Re-compute and re-render once all background data arrives
      computeLeaderboardStats();
      renderRepoTable();
    });
  } catch (err) {
    console.warn('Could not load ./data/summary.json, generating preview dataset:', err);
    document.getElementById('offlineNotice').classList.remove('hidden');
    const demoData = generatePreviewData();
    state.summary = demoData;
    computeLeaderboardStats();
    populateDashboard(demoData);
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
  document.getElementById('lastUpdatedText').textContent = `Last synchronized: ${updatedDate}`;

  // Update KPIs
  const k = data.kpis || {};
  document.getElementById('kpi-total-views').textContent = (k.all_time_views || 0).toLocaleString();
  document.getElementById('kpi-views-14d-badge').innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i> ${(k.views_14d || 0).toLocaleString()} in last 14d`;

  document.getElementById('kpi-unique-visitors').textContent = (k.all_time_uniques || 0).toLocaleString();
  document.getElementById('kpi-uniques-14d-badge').textContent = `${(k.uniques_14d || Math.round((k.views_14d || 0) * 0.42)).toLocaleString()} unique in 14d`;

  document.getElementById('kpi-total-clones').textContent = (k.all_time_clones || 0).toLocaleString();
  document.getElementById('kpi-clones-14d-badge').innerHTML = `<i class="fa-solid fa-download"></i> ${(k.clones_14d || 0).toLocaleString()} in last 14d`;

  document.getElementById('kpi-unique-cloners').textContent = (k.all_time_unique_cloners || 0).toLocaleString();
  const forkNode = document.getElementById('kpi-total-forks');
  if (forkNode) forkNode.textContent = (k.total_forks || 0).toLocaleString();
  document.getElementById('kpi-total-stars').textContent = (k.total_stars || 0).toLocaleString();
  document.getElementById('kpi-total-repos').textContent = (data.total_repositories_tracked || data.repositories?.length || 0).toLocaleString();

  // Populate Leaderboard Table
  renderRepoTable();

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
// Global Timeline Chart
// ============================================================================
function setGlobalChartMetric(metric) {
  state.globalMetric = metric;
  document.getElementById('chartMetric-views').className = metric === 'views'
    ? 'px-3 py-1 rounded-md font-medium bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
    : 'px-3 py-1 rounded-md font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white';
  document.getElementById('chartMetric-clones').className = metric === 'clones'
    ? 'px-3 py-1 rounded-md font-medium bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
    : 'px-3 py-1 rounded-md font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white';
  renderGlobalChart();
}

function setGlobalChartRange(days) {
  state.globalRange = days;
  [7, 14, 30, 90, 0].forEach(d => {
    const btn = document.getElementById(`rangeBtn-${d}`);
    if (btn) {
      btn.className = (d === days)
        ? 'px-2.5 py-1 rounded-md font-medium bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm'
        : 'px-2.5 py-1 rounded-md font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white';
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
// Leaderboard Table
// ============================================================================
function filterRepoTable() {
  const query = document.getElementById('repoSearchInput').value.toLowerCase().trim();
  state.searchQuery = query;
  renderRepoTable();
}

function sortRepoTable(col) {
  if (state.tableSort.column === col) {
    state.tableSort.asc = !state.tableSort.asc;
  } else {
    state.tableSort.column = col;
    state.tableSort.asc = false; // Descending default for stats
  }
  renderRepoTable();
}

async function setLeaderboardRange(type, value) {
  const customDiv = document.getElementById('leaderboardCustomDateRange');
  
  // Reset pill styles
  [1, 3, 7, 14, 30, 90, 0, 'custom'].forEach(v => {
    const el = document.getElementById(`lbr-${v}`);
    if (el) {
      el.className = 'flex-1 sm:flex-none px-3 py-1.5 rounded-md font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors';
    }
  });

  if (type === 'custom') {
    const el = document.getElementById(`lbr-custom`);
    if (el) el.className = 'flex-1 sm:flex-none px-3 py-1.5 rounded-md font-semibold bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm transition-colors';
    customDiv.style.display = 'flex';
    customDiv.classList.remove('hidden');
    return;
  } else {
    const el = document.getElementById(`lbr-${value}`);
    if (el) el.className = 'flex-1 sm:flex-none px-3 py-1.5 rounded-md font-semibold bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm transition-colors';
    customDiv.style.display = 'none';
    customDiv.classList.add('hidden');
    state.leaderboardRange = { type: 'days', value: parseInt(value, 10) };
  }
  
  await ensureAllRepoDetailsLoaded();
  computeLeaderboardStats();
  renderRepoTable();
}

async function applyCustomLeaderboardRange() {
  const start = document.getElementById('leaderboardStartDate').value;
  const end = document.getElementById('leaderboardEndDate').value;
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
  renderRepoTable();
}

function computeLeaderboardStats() {
  if (!state.summary || !state.summary.repositories) return;
  const { type, value, start, end } = state.leaderboardRange;
  
  // Update Header Titles
  let headerPrefix = 'All-Time';
  if (type === 'days' && value > 0) {
    headerPrefix = `${value}d`;
  } else if (type === 'custom') {
    headerPrefix = `Custom`;
  }
  const thViews = document.getElementById('thRangeViews');
  const thUniques = document.getElementById('thRangeUniques');
  const thClones = document.getElementById('thRangeClones');
  if (thViews) thViews.textContent = `${headerPrefix} Views`;
  if (thUniques) thUniques.textContent = `${headerPrefix} Visitors`;
  if (thClones) thClones.textContent = `${headerPrefix} Clones`;

  // Compute stats for each repo
  let cutoffDateStr = '';
  let startDateStr = '';
  let endDateStr = '';
  
  if (type === 'days' && value > 0) {
    let baseTime = new Date().getTime();
    if (state.summary && state.summary.updated_at) {
      baseTime = new Date(state.summary.updated_at).getTime();
    }
    // value of 1 means 1 day ago up until today. 
    // We calculate cutoffDateStr by subtracting (value - 1) days since the current day is included.
    const cutoffTime = baseTime - ((value - 1) * 24 * 60 * 60 * 1000);
    cutoffDateStr = new Date(cutoffTime).toISOString().split('T')[0];
  } else if (type === 'custom') {
    startDateStr = start;
    endDateStr = end;
  }

  state.summary.repositories.forEach(r => {
    // If all time or no detailed info, fallback to existing pre-calculated ones if possible
    // Note: We used to fallback to 14d pre-calculated stats here, but we now calculate 
    // it dynamically to ensure the numbers are 100% accurate based on the time range.
    if (type === 'days' && value === 0 && r.all_time_views !== undefined) {
      r.range_views = r.all_time_views;
      r.range_uniques = "-"; 
      r.range_clones = r.all_time_clones;
      return;
    }
    
    // Otherwise calculate dynamically from repoDetails
    const details = state.repoDetails[r.name];
    if (!details) {
      // If we don't have details, and we're not asking for 14d, we must show 0.
      r.range_views = 0;
      r.range_uniques = 0;
      r.range_clones = 0;
      return;
    }

    let range_views = 0, range_uniques = 0, range_clones = 0;

    const inRange = (dStr) => {
      if (type === 'days' && value === 0) return true;
      if (type === 'days') return dStr >= cutoffDateStr;
      return dStr >= startDateStr && dStr <= endDateStr;
    };

    // Optimization: Array is chronological. 
    for (let i = 0; i < (details.views || []).length; i++) {
      const v = details.views[i];
      if (type === 'custom' && v.date > endDateStr) break; // skip future dates
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
      }
    }

    r.range_views = range_views;
    r.range_uniques = range_uniques;
    r.range_clones = range_clones;
  });
}

function renderRepoTable() {
  const tbody = document.getElementById('repoTableBody');
  if (!tbody || !state.summary) return;

  let repos = [...(state.summary.repositories || [])];

  if (state.searchQuery) {
    repos = repos.filter(r =>
      r.name.toLowerCase().includes(state.searchQuery) ||
      (r.language && r.language.toLowerCase().includes(state.searchQuery)) ||
      (r.description && r.description.toLowerCase().includes(state.searchQuery))
    );
  }

  const { column, asc } = state.tableSort;
  repos.sort((a, b) => {
    let valA = a[column];
    let valB = b[column];
    if (typeof valA === 'string') {
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return asc ? (valA - valB) : (valB - valA);
  });

  tbody.innerHTML = repos.map((r, idx) => `
    <tr class="hover:bg-blue-50/40 dark:hover:bg-gray-800/40 cursor-pointer transition-colors group" onclick="viewRepoDeepDive('${r.name}')">
      <td class="px-5 py-4">
        <div class="flex items-center gap-2">
          <a href="${r.html_url || '#'}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" class="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-500 hover:underline transition-colors">${r.name}</a>
          ${r.language ? `<span class="px-2 py-0.5 rounded-full text-[9px] uppercase tracking-wider font-bold bg-gray-100 dark:bg-gray-700/50 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600">${r.language}</span>` : ''}
        </div>
        ${r.description ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-xs mt-1 leading-relaxed">${r.description}</p>` : ''}
      </td>
      <td class="px-3 py-4 font-medium text-amber-600 dark:text-amber-400/90">
        <div class="flex items-center gap-1.5"><i class="fa-solid fa-star text-[10px] opacity-75"></i>${(r.stars || 0).toLocaleString()}</div>
      </td>
      <td class="px-3 py-4 font-medium text-orange-600 dark:text-orange-400/90">
        <div class="flex items-center gap-1.5"><i class="fa-solid fa-code-fork text-[10px] opacity-75"></i>${(r.forks || 0).toLocaleString()}</div>
      </td>
      <td class="px-3 py-4 font-semibold text-blue-600 dark:text-blue-400">
        ${typeof r.range_views === 'number' ? r.range_views.toLocaleString() : (r.range_views || 0)}
      </td>
      <td class="px-3 py-4 font-medium text-emerald-600 dark:text-emerald-400/90 hidden sm:table-cell">
        ${typeof r.range_uniques === 'number' ? r.range_uniques.toLocaleString() : (r.range_uniques || 0)}
      </td>
      <td class="px-3 py-4 font-medium text-purple-600 dark:text-purple-400/90 hidden sm:table-cell">
        ${typeof r.range_clones === 'number' ? r.range_clones.toLocaleString() : (r.range_clones || 0)}
      </td>
      <td class="px-3 py-4 font-medium text-gray-700 dark:text-gray-300 hidden md:table-cell">
        ${(r.all_time_views || 0).toLocaleString()}
      </td>
      <td class="px-3 py-4 font-medium text-gray-700 dark:text-gray-300 hidden md:table-cell">
        ${(r.all_time_clones || 0).toLocaleString()}
      </td>
      <td class="px-5 py-4 text-right">
        <button class="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 group-hover:text-blue-600 dark:group-hover:text-blue-400 text-[11px] font-semibold transition-colors flex items-center gap-1.5 ml-auto">
          Inspect <i class="fa-solid fa-arrow-right text-[10px]"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function viewRepoDeepDive(repoName) {
  state.selectedRepo = repoName;
  document.getElementById('repoDropdown').value = repoName;
  switchTab('explorer');
  onRepoSelect(repoName);
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
}

async function onRepoSelect(repoName) {
  state.selectedRepo = repoName;
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
    ${repo.language ? `<span class="px-2.5 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/20 rounded-md font-medium">${repo.language}</span>` : ''}
    <span class="px-2.5 py-1 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-md font-medium"><i class="fa-solid fa-star text-[10px] mr-1"></i>${(repo.stars || 0).toLocaleString()} Stars</span>
    <span class="px-2.5 py-1 bg-purple-500/10 text-purple-500 border border-purple-500/20 rounded-md font-medium"><i class="fa-solid fa-code-branch text-[10px] mr-1"></i>${(repo.forks || 0).toLocaleString()} Forks</span>
    <span class="px-2.5 py-1 bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 rounded-md font-medium"><i class="fa-solid fa-circle-dot text-[10px] mr-1"></i>${(repo.open_issues || 0)} Issues</span>
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
    <label class="flex items-center gap-2 p-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 text-xs font-medium cursor-pointer hover:border-blue-500">
      <input type="checkbox" value="${r.name}" ${state.comparedRepos.includes(r.name) ? 'checked' : ''} onchange="onCompareToggle(this)" class="rounded text-blue-600 focus:ring-blue-500">
      <span class="truncate">${r.name}</span>
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
      <div class="bg-white dark:bg-darkcard border border-gray-200 dark:border-darkborder rounded-2xl p-5 shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <h4 class="font-bold text-gray-900 dark:text-white truncate">${r.name}</h4>
          <span class="text-xs text-amber-500 font-semibold"><i class="fa-solid fa-star mr-1"></i>${r.stars}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800">
            <span class="text-gray-400">14d Views:</span>
            <div class="font-bold text-blue-500 text-sm">${(r.views_14d || 0).toLocaleString()}</div>
          </div>
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800">
            <span class="text-gray-400">14d Clones:</span>
            <div class="font-bold text-purple-500 text-sm">${(r.clones_14d || 0).toLocaleString()}</div>
          </div>
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800">
            <span class="text-gray-400">All-Time Views:</span>
            <div class="font-bold text-gray-900 dark:text-white">${(r.all_time_views || 0).toLocaleString()}</div>
          </div>
          <div class="p-2 rounded bg-gray-50 dark:bg-gray-800">
            <span class="text-gray-400">Conversion:</span>
            <div class="font-bold text-emerald-500">${r.clone_conversion_pct || 0}%</div>
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
    switchTab('tab-live');
    return;
  }
  
  const refreshIcon = document.getElementById('lbrRefreshIcon');
  if (refreshIcon) refreshIcon.classList.add('animate-spin');
  
  try {
    await runLiveSync(true); // pass true to indicate silent mode (no alerts if we want, but alerts are okay)
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

      const v14 = normViews.reduce((a, b) => a + b.count, 0);
      const u14 = normViews.reduce((a, b) => a + b.uniques, 0);
      const c14 = normClones.reduce((a, b) => a + b.count, 0);

      liveRepoRecords.push({
        name: r.name,
        full_name: r.full_name,
        html_url: r.html_url,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        forks: r.forks_count,
        open_issues: r.open_issues_count,
        views_14d: v14,
        uniques_14d: u14,
        clones_14d: c14,
        all_time_views: v14,
        all_time_clones: c14,
        clone_conversion_pct: v14 > 0 ? Math.round((c14 / v14) * 100) : 0,
        views: normViews,
        clones: normClones,
        referrers: refData,
        paths: pathData
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

  records.forEach(r => {
    totalStars += r.stars;
    totalForks += r.forks;
    totalV14 += r.views_14d;
    totalC14 += r.clones_14d;

    (r.views || []).forEach(v => {
      if (!timelineMap[v.date]) timelineMap[v.date] = { date: v.date, views: 0, uniques: 0, clones: 0, unique_cloners: 0 };
      timelineMap[v.date].views += v.count;
      timelineMap[v.date].uniques += v.uniques;
    });

    (r.clones || []).forEach(c => {
      if (!timelineMap[c.date]) timelineMap[c.date] = { date: c.date, views: 0, uniques: 0, clones: 0, unique_cloners: 0 };
      timelineMap[c.date].clones += c.count;
      timelineMap[c.date].unique_cloners += c.uniques;
    });

    (r.referrers || []).forEach(ref => {
      if (!globalRef[ref.referrer]) globalRef[ref.referrer] = { referrer: ref.referrer, count: 0, uniques: 0 };
      globalRef[ref.referrer].count += ref.count;
      globalRef[ref.referrer].uniques += ref.uniques;
    });

    (r.paths || []).forEach(p => {
      if (!globalPaths[p.path]) globalPaths[p.path] = { path: p.path, count: 0, uniques: 0 };
      globalPaths[p.path].count += p.count;
      globalPaths[p.path].uniques += p.uniques;
    });
  });

  const sortedTimeline = Object.values(timelineMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    updated_at: new Date().toISOString(),
    total_repositories_tracked: records.length,
    kpis: {
      all_time_views: totalV14,
      all_time_uniques: Math.round(totalV14 * 0.45),
      all_time_clones: totalC14,
      all_time_unique_cloners: Math.round(totalC14 * 0.6),
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
