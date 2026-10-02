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
  charts: {
    global: null,
    repoViews: null,
    repoClones: null,
    compare: null
  },
  tableSort: {
    column: 'views_14d',
    asc: false
  },
  searchQuery: ''
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
  const isDark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
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
    tooltipBg: dark ? '#111827' : '#ffffff',
    tooltipBorder: dark ? '#374151' : '#e5e7eb',
    tooltipText: dark ? '#f9fafb' : '#111827'
  };
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
    populateDashboard(data);
  } catch (err) {
    console.warn('Could not load ./data/summary.json, generating preview dataset:', err);
    document.getElementById('offlineNotice').classList.remove('hidden');
    const demoData = generatePreviewData();
    state.summary = demoData;
    populateDashboard(demoData);
  }
}

function populateDashboard(data) {
  // Update Header
  const updatedDate = data.updated_at ? new Date(data.updated_at).toLocaleString() : 'Just now';
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

  const labels = timeline.map(t => t.date);
  const colors = getChartColors();

  let datasets = [];
  if (state.globalMetric === 'views') {
    datasets = [
      {
        label: 'Total Views',
        data: timeline.map(t => t.views),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 5
      },
      {
        label: 'Unique Visitors',
        data: timeline.map(t => t.uniques),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.05)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 5
      }
    ];
  } else {
    datasets = [
      {
        label: 'Git Clones',
        data: timeline.map(t => t.clones),
        borderColor: '#a855f7',
        backgroundColor: 'rgba(168, 85, 247, 0.12)',
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 5
      },
      {
        label: 'Unique Cloners',
        data: timeline.map(t => t.unique_cloners),
        borderColor: '#ec4899',
        backgroundColor: 'rgba(236, 72, 153, 0.05)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: timeline.length > 40 ? 0 : 3,
        pointHoverRadius: 5
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
    <tr class="hover:bg-blue-50/50 dark:hover:bg-gray-800/40 cursor-pointer transition" onclick="viewRepoDeepDive('${r.name}')">
      <td class="px-6 py-3.5">
        <div class="flex items-center gap-2">
          <span class="font-bold text-gray-900 dark:text-white hover:text-blue-500">${r.name}</span>
          ${r.language ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700">${r.language}</span>` : ''}
        </div>
        ${r.description ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-xs mt-0.5">${r.description}</p>` : ''}
      </td>
      <td class="px-4 py-3.5 font-medium text-amber-500">
        <i class="fa-solid fa-star text-[10px] mr-1"></i>${(r.stars || 0).toLocaleString()}
      </td>
      <td class="px-4 py-3.5 font-semibold text-blue-600 dark:text-blue-400">
        ${(r.views_14d || 0).toLocaleString()}
      </td>
      <td class="px-4 py-3.5 font-medium text-gray-700 dark:text-gray-300">
        ${(r.uniques_14d || 0).toLocaleString()}
      </td>
      <td class="px-4 py-3.5 font-medium text-purple-600 dark:text-purple-400">
        ${(r.clones_14d || 0).toLocaleString()}
      </td>
      <td class="px-4 py-3.5 font-medium text-gray-900 dark:text-white">
        ${(r.all_time_views || 0).toLocaleString()}
      </td>
      <td class="px-4 py-3.5 font-medium text-gray-900 dark:text-white">
        ${(r.all_time_clones || 0).toLocaleString()}
      </td>
      <td class="px-6 py-3.5 text-right">
        <button class="px-2.5 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-[11px] font-medium transition">
          Inspect <i class="fa-solid fa-chevron-right ml-1 text-[9px]"></i>
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
      labels: views.map(v => v.date),
      datasets: [
        {
          label: 'Views',
          data: views.map(v => v.count),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2
        },
        {
          label: 'Uniques',
          data: views.map(v => v.uniques),
          borderColor: '#6366f1',
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2
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
      labels: clones.map(c => c.date),
      datasets: [
        {
          label: 'Clones',
          data: clones.map(c => c.count),
          backgroundColor: '#a855f7',
          borderRadius: 4
        },
        {
          label: 'Unique Cloners',
          data: clones.map(c => c.uniques),
          backgroundColor: '#ec4899',
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
  const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'];

  // Gather dates from the summary timeline (last 30 days)
  const timeline = (state.summary.daily_timeline || []).slice(-30);
  const labels = timeline.map(t => t.date);

  // For each compared repo, get view history
  const datasets = state.comparedRepos.map((repoName, idx) => {
    let repo = state.repoDetails[repoName];
    if (!repo) {
      const summaryItem = state.summary.repositories.find(r => r.name === repoName);
      repo = summaryItem ? createSimulatedRepoRecord(summaryItem) : { views: [] };
    }

    const viewsMap = Object.fromEntries((repo.views || []).map(v => [v.date, v.count]));
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
}

function saveLiveToken() {
  const val = document.getElementById('livePatInput').value.trim();
  if (!val) {
    alert('Please enter a valid GitHub token.');
    return;
  }
  localStorage.setItem('traffic_pat', val);
  alert('Token saved locally in browser.');
}

function clearLiveToken() {
  localStorage.removeItem('traffic_pat');
  document.getElementById('livePatInput').value = '';
  alert('Token removed.');
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
