/* ============================================
   GLOBAL STATE & INITIALIZATION
   ============================================ */

console.log('Script.js loaded successfully');

let currentNamespace = 'default';
let currentTab = 'overview';
let sidebarCollapsed = false;
let tabDataCache = {}; // Cache for tab data to prevent reload on tab switch
let podStatusChart = null;
let resourceChart = null;
let autoRefreshIntervals = {}; // Store interval IDs for auto-refresh
let isNamespaceSwitching = false; // Track if we're currently switching namespaces
let targetJobToHighlight = null; // Store job name to filter after navigation to Jobs tab

// Table sorting and filtering state
let tableSortState = {}; // { tabName: { column: 'name', direction: 'asc' } }
let tableFilterState = {}; // { tabName: { filterType: 'status', filterValue: 'Running' } }

// Connection monitoring
let connectionStatus = 'checking'; // 'connected', 'disconnected', 'checking'
let consecutiveFailures = 0;
let lastSuccessfulFetch = Date.now();
let healthCheckInterval = null;

/* ============================================
   CONNECTION MONITORING & ERROR HANDLING
   ============================================ */

function updateConnectionStatus(status) {
    connectionStatus = status;
    const statusElement = document.getElementById('connectionStatus');
    const textElement = document.getElementById('connectionText');
    
    if (!statusElement || !textElement) return;
    
    // Remove all status classes
    statusElement.classList.remove('connected', 'disconnected', 'checking');
    
    switch (status) {
        case 'connected':
            statusElement.classList.add('connected');
            textElement.textContent = 'Connected';
            statusElement.title = 'API connection is healthy';
            consecutiveFailures = 0;
            lastSuccessfulFetch = Date.now();
            hideErrorBanner();
            break;
        case 'disconnected':
            statusElement.classList.add('disconnected');
            textElement.textContent = 'Disconnected';
            statusElement.title = `API connection failed (${consecutiveFailures} attempts)`;
            showErrorBanner(
                'error',
                '🔴 Cluster API Unreachable',
                'Cannot connect to Kubernetes API. Check that the cluster is accessible and Atlas has valid credentials.',
                [
                    { text: 'Retry', action: () => { checkAPIHealth(); refreshCurrentTab(); } }
                ]
            );
            break;
        case 'checking':
            statusElement.classList.add('checking');
            textElement.textContent = 'Checking...';
            statusElement.title = 'Checking API connection';
            break;
    }
}

function showErrorBanner(type = 'error', title, message, actions = []) {
    const banner = document.getElementById('errorBanner');
    if (!banner) return;
    
    const typeClass = type === 'warning' ? 'warning' : type === 'info' ? 'info' : '';
    const icon = type === 'warning' ? '⚠️' : type === 'info' ? 'ℹ️' : '❌';
    
    let actionsHTML = '';
    if (actions.length > 0) {
        actionsHTML = '<div class="error-banner-actions">';
        actions.forEach(action => {
            actionsHTML += `<button class="error-banner-button" onclick="(${action.action.toString()})()">${action.text}</button>`;
        });
        actionsHTML += '</div>';
    }
    
    banner.className = `error-banner ${typeClass}`;
    banner.innerHTML = `
        <div class="error-banner-content">
            <span class="error-banner-icon">${icon}</span>
            <div class="error-banner-message">
                <strong>${title}</strong>
                ${message ? `<div style="margin-top: 4px; font-size: 12px; opacity: 0.9;">${message}</div>` : ''}
            </div>
        </div>
        ${actionsHTML}
        <button class="error-banner-close" onclick="hideErrorBanner()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    banner.style.display = 'flex';
}

function hideErrorBanner() {
    const banner = document.getElementById('errorBanner');
    if (banner) {
        banner.style.display = 'none';
    }
}

async function checkAPIHealth() {
    try {
        updateConnectionStatus('checking');
        // Use /readyz which actually checks K8s cluster connectivity
        const response = await fetch('/readyz', { 
            method: 'GET',
            headers: { 'Cache-Control': 'no-cache' }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.status === 'ready') {
                consecutiveFailures = 0;
                updateConnectionStatus('connected');
                return true;
            } else {
                consecutiveFailures++;
                updateConnectionStatus('disconnected');
                showErrorBanner(
                    'error',
                    '☸️ Cluster Connection Error',
                    data.error || 'Kubernetes cluster is not reachable',
                    [{ text: 'Retry', action: () => { checkAPIHealth(); refreshCurrentTab(); } }]
                );
                return false;
            }
        } else {
            consecutiveFailures++;
            updateConnectionStatus('disconnected');
            return false;
        }
    } catch (error) {
        consecutiveFailures++;
        console.error('Health check failed:', error);
        updateConnectionStatus('disconnected');
        showErrorBanner(
            'error',
            '🌐 Connection Error',
            'Cannot reach Atlas server or Kubernetes cluster',
            [{ text: 'Retry', action: () => { checkAPIHealth(); refreshCurrentTab(); } }]
        );
        return false;
    }
}

function startHealthMonitoring() {
    // Check immediately
    checkAPIHealth();
    
    // Then check every 30 seconds
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }
    healthCheckInterval = setInterval(() => {
        // If we haven't had a successful fetch in 2 minutes, check health
        const timeSinceLastSuccess = Date.now() - lastSuccessfulFetch;
        if (timeSinceLastSuccess > 120000 || consecutiveFailures > 0) {
            checkAPIHealth();
        }
    }, 30000);
}

// Enhanced fetch wrapper with error handling
async function safeFetch(url, options = {}) {
    try {
        const response = await fetch(url, options);
        
        if (!response.ok) {
            consecutiveFailures++;
            
            if (response.status === 500 || response.status === 502 || response.status === 503) {
                if (consecutiveFailures >= 2) {
                    updateConnectionStatus('disconnected');
                }
                throw new Error(`API server error (${response.status})`);
            } else if (response.status === 401 || response.status === 403) {
                showErrorBanner(
                    'error',
                    '🔐 Authentication Error',
                    'Access denied. Check your Kubernetes credentials and RBAC permissions.',
                    []
                );
                throw new Error('Authentication failed');
            } else if (response.status === 404) {
                throw new Error('Resource not found');
            }
            
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Success - update status
        consecutiveFailures = 0;
        lastSuccessfulFetch = Date.now();
        if (connectionStatus !== 'connected') {
            updateConnectionStatus('connected');
        }
        
        return response;
    } catch (error) {
        consecutiveFailures++;
        
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            if (consecutiveFailures >= 2) {
                updateConnectionStatus('disconnected');
                showErrorBanner(
                    'error',
                    '🌐 Network Error',
                    'Cannot reach the Atlas server. Check your network connection.',
                    [{ text: 'Retry', action: () => { checkAPIHealth(); refreshCurrentTab(); } }]
                );
            }
        }
        
        console.error('Fetch error:', error);
        throw error;
    }
}

/* ============================================
   PERFORMANCE-OPTIMIZED API FETCHING
   Batched fetching with priority ordering
   ============================================ */

// Resource fetch priorities (high to low)
const RESOURCE_PRIORITIES = {
    // Priority 1: Most frequently changing (30s refresh)
    HIGH: {
        interval: 30000,
        resources: ['pods', 'events']
    },
    // Priority 2: Medium-high frequency (45s refresh)
    MEDIUM_HIGH: {
        interval: 45000,
        resources: ['endpoints', 'nodes']
    },
    // Priority 3: Medium frequency (60s refresh)
    MEDIUM: {
        interval: 60000,
        resources: ['deployments', 'replicasets', 'statefulsets', 'daemonsets']
    },
    // Priority 4: Medium-low frequency (90s refresh)
    MEDIUM_LOW: {
        interval: 90000,
        resources: ['jobs', 'cronjobs']
    },
    // Priority 5: Low frequency (120s refresh)
    LOW: {
        interval: 120000,
        resources: ['services']
    },
    // Priority 6: Lowest frequency (180s refresh)
    LOWEST: {
        interval: 180000,
        resources: ['configmaps', 'secrets', 'ingresses', 'pvcs', 'storageclasses', 'hpas', 'pdbs']
    }
};

// Resource API endpoint mapper
function getResourceEndpoint(resourceType, namespace) {
    const ns = namespace || currentNamespace;
    const nsParam = encodeURIComponent(ns);
    
    const endpoints = {
        'pods': `/api/pods/${nsParam}`,
        'events': `/api/health/${nsParam}`, // Events are part of health endpoint
        'endpoints': `/api/endpoints/${nsParam}`,
        'nodes': '/api/cluster', // Node status from cluster endpoint
        'deployments': `/api/deployments/${nsParam}`,
        'replicasets': `/api/deployments/${nsParam}`, // ReplicaSets included in deployments
        'statefulsets': `/api/statefulsets/${nsParam}`,
        'daemonsets': `/api/daemonsets/${nsParam}`,
        'jobs': `/api/jobs/${nsParam}`,
        'cronjobs': `/api/cronjobs/${nsParam}`,
        'services': `/api/services/${nsParam}`,
        'configmaps': `/api/configmaps/${nsParam}`,
        'secrets': `/api/secrets/${nsParam}`,
        'ingresses': `/api/ingresses/${nsParam}`,
        'pvcs': `/api/pvpvc/${nsParam}`,
        'storageclasses': `/api/storageclasses/${nsParam}`,
        'hpas': `/api/hpas/${nsParam}`,
        'pdbs': `/api/pdbs/${nsParam}`
    };
    
    return endpoints[resourceType];
}

// Batch fetch resources by priority with progressive loading
async function batchFetchByPriority(resources, onProgress) {
    const results = {};
    const priorities = ['HIGH', 'MEDIUM_HIGH', 'MEDIUM', 'MEDIUM_LOW', 'LOW', 'LOWEST'];
    
    for (const priority of priorities) {
        const priorityConfig = RESOURCE_PRIORITIES[priority];
        const requestedInPriority = resources.filter(r => priorityConfig.resources.includes(r));
        
        if (requestedInPriority.length === 0) continue;
        
        // Notify progress
        if (onProgress) {
            onProgress(priority, requestedInPriority);
        }
        
        // Fetch all resources in this priority batch in parallel
        const batchPromises = requestedInPriority.map(async (resource) => {
            const endpoint = getResourceEndpoint(resource);
            if (!endpoint) return { resource, data: null };
            
            try {
                const response = await fetch(endpoint);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const data = await response.json();
                return { resource, data };
            } catch (error) {
                console.error(`Error fetching ${resource}:`, error);
                return { resource, data: null, error };
            }
        });
        
        const batchResults = await Promise.all(batchPromises);
        
        // Store results
        batchResults.forEach(({ resource, data }) => {
            if (data) results[resource] = data;
        });
    }
    
    return results;
}

// Unified fetch for a single resource type
async function fetchResource(resourceType, namespace, options = {}) {
    let endpoint = getResourceEndpoint(resourceType, namespace);
    if (!endpoint) return null;
    
    // Add pagination parameters if provided
    if (options.limit) {
        const separator = endpoint.includes('?') ? '&' : '?';
        endpoint += `${separator}limit=${options.limit}`;
        if (options.continue) {
            endpoint += `&continue=${encodeURIComponent(options.continue)}`;
        }
    }
    
    try {
        const response = await fetch(endpoint);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error(`Error fetching ${resourceType}:`, error);
        return null;
    }
}

// Setup auto-refresh for specific resource types based on priority
function setupAutoRefresh(resourceType, callback) {
    // Clear existing interval if any
    if (autoRefreshIntervals[resourceType]) {
        clearInterval(autoRefreshIntervals[resourceType]);
    }
    
    // Find the priority tier for this resource
    let interval = 60000; // Default 60s
    for (const [priority, config] of Object.entries(RESOURCE_PRIORITIES)) {
        if (config.resources.includes(resourceType)) {
            interval = config.interval;
            break;
        }
    }
    
    // Setup new interval
    autoRefreshIntervals[resourceType] = setInterval(() => {
        if (callback) callback();
    }, interval);
    
    console.log(`Auto-refresh enabled for ${resourceType} every ${interval/1000}s`);
}

// Clear all auto-refresh intervals
function clearAllAutoRefresh() {
    Object.keys(autoRefreshIntervals).forEach(key => {
        clearInterval(autoRefreshIntervals[key]);
        delete autoRefreshIntervals[key];
    });
}

// Clear auto-refresh for specific resource
function clearAutoRefresh(resourceType) {
    if (autoRefreshIntervals[resourceType]) {
        clearInterval(autoRefreshIntervals[resourceType]);
        delete autoRefreshIntervals[resourceType];
    }
}

/* ============================================
   THEME MANAGEMENT
   ============================================ */

const THEMES = [
    { name: 'light', label: 'Light', icon: '☀️' },
    { name: 'dark', label: 'Dark', icon: '🌙' },
    { name: 'onedark', label: 'One Dark Pro', icon: '⚡' },
    { name: 'github-dark', label: 'GitHub Dark', icon: '🐙' },
    { name: 'tokyo', label: 'Tokyo Night', icon: '🗼' },
    { name: 'github-light', label: 'GitHub Light', icon: '☁️' },
    { name: 'ayu', label: 'Ayu Light', icon: '🌤️' }
];

function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = getCurrentTheme();
    
    // Find current theme index
    const currentIndex = THEMES.findIndex(t => t.name === currentTheme);
    
    // Get next theme (cycle through)
    const nextIndex = (currentIndex + 1) % THEMES.length;
    const nextTheme = THEMES[nextIndex];
    
    // Apply new theme
    applyTheme(nextTheme.name);
}

function applyTheme(themeName) {
    const html = document.documentElement;
    const themeIcon = document.getElementById('themeIcon');
    
    // Remove all theme classes
    html.classList.remove('dark', 'theme-onedark', 'theme-github-dark', 'theme-tokyo', 'theme-github-light', 'theme-ayu');
    
    // Apply new theme class
    if (themeName === 'dark') {
        html.classList.add('dark');
    } else if (themeName !== 'light') {
        html.classList.add(`theme-${themeName}`);
    }
    
    // Update icon
    const theme = THEMES.find(t => t.name === themeName);
    if (themeIcon && theme) {
        themeIcon.textContent = theme.icon;
    }
    
    // Save preference
    localStorage.setItem('theme', themeName);
}

function getCurrentTheme() {
    const html = document.documentElement;
    
    if (html.classList.contains('dark')) return 'dark';
    if (html.classList.contains('theme-onedark')) return 'onedark';
    if (html.classList.contains('theme-github-dark')) return 'github-dark';
    if (html.classList.contains('theme-tokyo')) return 'tokyo';
    if (html.classList.contains('theme-github-light')) return 'github-light';
    if (html.classList.contains('theme-ayu')) return 'ayu';
    
    return 'light';
}

function loadThemePreference() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    applyTheme(savedTheme);
}

/* ============================================
   SIDEBAR MANAGEMENT
   ============================================ */

function toggleSidebar() {
    // This is for future sidebar collapse feature
    console.log('Sidebar toggle');
}

function toggleMobileSidebar() {
    const sidebar = document.getElementById('mobileSidebar');
    if (sidebar) {
        sidebar.classList.toggle('open');
    }
}

function loadSidebarState() {
    // Future implementation for sidebar state persistence
}

/* ============================================
   CLOCK FUNCTIONALITY
   ============================================ */

let selectedTimezone = 'UTC';

function updateClocks() {
    const now = new Date();
    
    // Local time
    const localTime = now.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
    });
    const localClockEl = document.getElementById('localClock');
    if (localClockEl) {
        localClockEl.textContent = localTime;
    }
    
    // Selected timezone time
    try {
        const tzTime = now.toLocaleTimeString('en-US', { 
            timeZone: selectedTimezone,
            hour12: false, 
            hour: '2-digit', 
            minute: '2-digit', 
            second: '2-digit' 
        });
        const selectedClockEl = document.getElementById('selectedClock');
        if (selectedClockEl) {
            selectedClockEl.textContent = tzTime;
        }
    } catch (error) {
        console.error('Error updating timezone clock:', error);
    }
}

function updateSelectedTimezone() {
    const timezoneSelect = document.getElementById('timezoneSelect');
    if (timezoneSelect) {
        selectedTimezone = timezoneSelect.value;
        // Save to localStorage
        localStorage.setItem('selectedTimezone', selectedTimezone);
        // Immediately update the clock
        updateClocks();
    }
}

function loadSelectedTimezone() {
    const saved = localStorage.getItem('selectedTimezone');
    if (saved) {
        selectedTimezone = saved;
        const timezoneSelect = document.getElementById('timezoneSelect');
        if (timezoneSelect) {
            timezoneSelect.value = saved;
        }
    }
}

function initializeClocks() {
    loadSelectedTimezone();
    updateClocks();
    // Update every second
    setInterval(updateClocks, 1000);
}

/* ============================================
   TAB NAVIGATION
   ============================================ */

function selectTab(event, tabName) {
    if (event) event.preventDefault();
    
    // Clear auto-refresh for previous tab before switching
    if (currentTab && currentTab !== tabName) {
        clearAutoRefresh(currentTab);
        clearAutoRefresh(`${currentTab}-pods`);
        clearAutoRefresh('overview-pods');
    }
    
    currentTab = tabName;

    // Hide any existing namespace indicators when switching tabs
    hideNamespaceIndicator();

    // Close mobile sidebar when a tab is selected
    toggleMobileSidebar();

    // Update active menu item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active', 'text-white', 'bg-primary-600', 'dark:bg-primary-500');
        item.classList.add('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-700');
    });

    // Support both real click (event.target) and programmatic call (match by data-tab)
    const activeItem = (event && event.target)
        ? event.target.closest('.nav-item')
        : document.querySelector(`[data-tab="${tabName}"]`);
    if (activeItem) {
        activeItem.classList.remove('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-700');
        activeItem.classList.add('active', 'text-white', 'bg-primary-600', 'dark:bg-primary-500');
    }

    // Update active tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
    const tabElement = document.getElementById(tabName);
    if (tabElement) {
        tabElement.classList.remove('hidden');
    }

    // Load data based on tab
    loadTabData(tabName);
}

async function loadTabData(tabName) {
    console.log(`Loading tab data for: ${tabName}`);
    
    // Check if we have cached data for this tab
    if (tabDataCache[tabName] && tabDataCache[tabName].namespace === currentNamespace) {
        // Data is cached, don't reload
        console.log(`Tab ${tabName} data is cached, skipping reload`);
        hideNamespaceIndicator(); // Hide loading indicator
        isNamespaceSwitching = false; // Reset flag
        return;
    }

    console.log(`Fetching fresh data for tab: ${tabName}`);
    
    try {
        switch (tabName) {
            case 'overview':
                await loadOverview();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'resourceViewer':
                await loadAllResources();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'ingresses':
                await loadIngresses();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'services':
                await loadServices();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'pods':
                await loadPods();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'deployments':
                loadDeployments();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'configmaps':
                loadConfigMaps();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'secrets':
                loadSecrets();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'releases':
                loadReleases();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'pvpvc':
                loadPVPVC();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'health':
                // Health merged into dashboard
                hideNamespaceIndicator();
                isNamespaceSwitching = false;
                selectTab(null, 'overview');
                return; // Don't show loaded indicator
            case 'cluster':
                await loadClusterNodes();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'crds':
                loadCRDs();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'cronjobs':
                await loadCronJobsAndJobs();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'statefulsets':
                loadStatefulSets();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'daemonsets':
                loadDaemonSets();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'jobs':
                await loadJobs();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'endpoints':
                loadEndpoints();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'storageclasses':
                loadStorageClasses();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'hpas':
                loadHPAs();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'pdbs':
                loadPDBs();
                tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
                break;
            case 'network':
                // Network loads on button click, don't show indicator
                hideNamespaceIndicator();
                isNamespaceSwitching = false;
                return;
            default:
                console.warn(`Unknown tab: ${tabName}`);
                hideNamespaceIndicator();
                isNamespaceSwitching = false;
                return;
        }
        
        // Show loaded indicator only during namespace switches
        if (isNamespaceSwitching) {
            showNamespaceLoaded();
            isNamespaceSwitching = false; // Reset flag
        }
    } catch (error) {
        console.error(`Error loading tab ${tabName}:`, error);
        hideNamespaceIndicator();
        isNamespaceSwitching = false; // Reset flag on error
    }
}

/* ============================================
   UNIVERSAL TABLE SORTING & FILTERING
   ============================================ */

// Sort table by column
function sortTable(tabName, tableSelector, columnIndex, dataType = 'string') {
    const table = document.querySelector(tableSelector);
    if (!table) return;

    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr:not(.expandable-row)'));
    
    // Initialize sort state for this tab
    if (!tableSortState[tabName]) {
        tableSortState[tabName] = { column: null, direction: null };
    }
    
    // Toggle sort direction
    let direction = 'asc';
    if (tableSortState[tabName].column === columnIndex) {
        direction = tableSortState[tabName].direction === 'asc' ? 'desc' : 'asc';
    }
    
    tableSortState[tabName] = { column: columnIndex, direction };
    
    // Update header UI
    const headers = table.querySelectorAll('th.sortable');
    headers.forEach((th, idx) => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (idx === columnIndex) {
            th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');
        }
    });
    
    // Sort rows
    rows.sort((a, b) => {
        let aVal = a.querySelectorAll('td')[columnIndex]?.textContent.trim() || '';
        let bVal = b.querySelectorAll('td')[columnIndex]?.textContent.trim() || '';
        
        // Remove emojis and special chars for comparison
        aVal = aVal.replace(/[📦🏗️⏰💼⚙️🔗]/g, '').trim();
        bVal = bVal.replace(/[📦🏗️⏰💼⚙️🔗]/g, '').trim();
        
        let comparison = 0;
        
        if (dataType === 'number') {
            // Extract first number from string (for "2/3" format)
            const aNum = parseFloat(aVal.split('/')[0]) || 0;
            const bNum = parseFloat(bVal.split('/')[0]) || 0;
            comparison = aNum - bNum;
        } else if (dataType === 'age') {
            // Convert age strings to seconds for comparison
            comparison = parseAge(aVal) - parseAge(bVal);
        } else {
            // String comparison
            comparison = aVal.localeCompare(bVal);
        }
        
        return direction === 'asc' ? comparison : -comparison;
    });
    
    // Re-append rows in sorted order
    rows.forEach(row => tbody.appendChild(row));
}

// Parse age string to seconds (e.g., "2d", "5h", "30m")
function parseAge(ageStr) {
    if (!ageStr || ageStr === '-') return 0;
    
    const match = ageStr.match(/^(\d+)([smhdy])/);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const multipliers = {
        's': 1,
        'm': 60,
        'h': 3600,
        'd': 86400,
        'y': 31536000
    };
    
    return value * (multipliers[unit] || 0);
}

// Filter table by stat card
function filterTableByStatus(tabName, tableSelector, filterType, filterValue) {
    const table = document.querySelector(tableSelector);
    if (!table) return;
    
    // Initialize filter state
    if (!tableFilterState[tabName]) {
        tableFilterState[tabName] = { filterType: null, filterValue: null };
    }
    
    // Toggle filter - if same filter clicked, clear it
    if (tableFilterState[tabName].filterType === filterType && 
        tableFilterState[tabName].filterValue === filterValue) {
        // Clear filter
        tableFilterState[tabName] = { filterType: null, filterValue: null };
        const rows = table.querySelectorAll('tbody tr:not(.expandable-row)');
        rows.forEach(row => row.style.display = '');
        
        // Remove active state from all stat-mini cards
        document.querySelectorAll(`#${tabName} .stat-mini.clickable`).forEach(card => {
            card.classList.remove('active');
        });
        return;
    }
    
    // Apply filter
    tableFilterState[tabName] = { filterType, filterValue };
    
    const rows = table.querySelectorAll('tbody tr:not(.expandable-row)');
    rows.forEach(row => {
        const shouldShow = matchesFilter(row, filterType, filterValue);
        row.style.display = shouldShow ? '' : 'none';
    });
}

// Check if row matches filter criteria
function matchesFilter(row, filterType, filterValue) {
    const cells = row.querySelectorAll('td');
    
    switch (filterType) {
        case 'status':
            // Find status cell (usually has badge)
            const statusBadge = Array.from(cells).find(cell => 
                cell.querySelector('.badge-success, .badge-warning, .badge-danger, .badge-info')
            );
            if (!statusBadge) return true;
            const statusText = statusBadge.textContent.trim().toLowerCase();
            return statusText.includes(filterValue.toLowerCase());
            
        case 'ready':
            // Check if all replicas are ready (for deployments, etc.)
            const replicasText = cells[1]?.textContent.trim() || '';
            const match = replicasText.match(/(\d+)\/(\d+)/);
            if (!match) return true;
            const [, ready, total] = match;
            return filterValue === 'ready' ? ready === total : ready !== total;
            
        default:
            return true;
    }
}

/* ============================================
   CLUSTER & NAMESPACE
   ============================================ */

async function loadClusterInfo() {
    const clusterInfoEl = document.getElementById('clusterInfo');
    
    try {
        const response = await safeFetch('/api/cluster');
        
        if (!response.ok) {
            updateConnectionStatus('disconnected');
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();

        clusterInfoEl.innerHTML = `
            <span>🏗️ ${clusterShortName(data.cluster_name)}</span>
        `;

        // Populate namespace selector
        const select = document.getElementById('namespaceSelect');
        if (select && data.namespaces && data.namespaces.length > 0) {
            select.innerHTML = data.namespaces.map(ns =>
                    `<option value="${ns}">${ns}</option>`
                ).join('');

            // Default to 'default' namespace if it exists, otherwise first
            const hasDefault = data.namespaces.includes('default');
            if (hasDefault) {
                currentNamespace = 'default';
                select.value = 'default';
            } else {
                currentNamespace = data.namespaces[0];
                select.value = currentNamespace;
            }
        }
    } catch (error) {
        console.error('Error loading cluster info:', error);
        updateConnectionStatus('disconnected');
        clusterInfoEl.innerHTML = `<span style="color: var(--danger-color);">⚠️ Cluster Unreachable</span>`;
        showErrorBanner(
            'error',
            '☸️ Kubernetes Cluster Error',
            'Cannot connect to Kubernetes cluster. Check your kubeconfig and cluster status.',
            [{ text: 'Retry', action: () => { loadClusterInfo(); checkAPIHealth(); } }]
        );
    }
}

function changeNamespace() {
    currentNamespace = document.getElementById('namespaceSelect').value;
    tabDataCache = {}; // Clear cache when namespace changes
    clearAllAutoRefresh(); // Clear auto-refresh intervals
    isNamespaceSwitching = true; // Set flag for namespace switch
    showNamespaceLoading(); // Show loading indicator
    updateAllNsBanner();
    refreshCurrentTab();
}

/* ============================================
   MULTI-CLUSTER MANAGEMENT
   ============================================ */

let currentClusterID = 'default';
let multiClusterMode = false;

// Load available clusters from the API
async function loadClusters() {
    try {
        const response = await fetch('/api/cluster/current');
        if (!response.ok) {
            console.log('Multi-cluster mode not enabled');
            return;
        }
        
        const data = await response.json();
        multiClusterMode = data.mode === 'multi-cluster';
        currentClusterID = data.cluster_id;
        
        if (!multiClusterMode) {
            // Hide cluster selector in single-cluster mode
            const clusterSelectorWrap = document.getElementById('clusterSelectorWrap');
            if (clusterSelectorWrap) {
                clusterSelectorWrap.style.display = 'none';
            }
            return;
        }
        
        // Show cluster selector
        const clusterSelectorWrap = document.getElementById('clusterSelectorWrap');
        if (clusterSelectorWrap) {
            clusterSelectorWrap.style.display = 'flex';
        }
        
        // Load list of clusters
        const clustersResponse = await fetch('/api/clusters');
        if (clustersResponse.ok) {
            const clusters = await clustersResponse.json();
            populateClusterSelector(clusters, currentClusterID);
        }
    } catch (error) {
        console.error('Error loading clusters:', error);
        multiClusterMode = false;
    }
}

// Populate the cluster selector dropdown
function populateClusterSelector(clusters, selectedClusterID) {
    const clusterSelect = document.getElementById('clusterSelect');
    if (!clusterSelect) return;
    
    clusterSelect.innerHTML = '';
    
    clusters.forEach(cluster => {
        const option = document.createElement('option');
        option.value = cluster.id;
        option.textContent = `${cluster.name} (${cluster.region || cluster.id})`;
        
        if (cluster.id === selectedClusterID) {
            option.selected = true;
        }
        
        // Add status indicator
        if (cluster.status) {
            const statusIcon = cluster.status === 'healthy' ? '✓' : 
                              cluster.status === 'unhealthy' ? '✗' : '○';
            option.textContent = `${statusIcon} ${option.textContent}`;
        }
        
        clusterSelect.appendChild(option);
    });
}

// Switch to a different cluster
async function switchCluster() {
    const clusterSelect = document.getElementById('clusterSelect');
    if (!clusterSelect) return;
    
    const newClusterID = clusterSelect.value;
    if (newClusterID === currentClusterID) return;
    
    try {
        // Show loading indicator
        showClusterSwitching(newClusterID);
        
        // Call API to switch cluster
        const response = await fetch('/api/cluster/switch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ cluster_id: newClusterID })
        });
        
        if (!response.ok) {
            throw new Error('Failed to switch cluster');
        }
        
        currentClusterID = newClusterID;
        
        // Clear all caches and reload
        tabDataCache = {};
        clearAllAutoRefresh();
        
        // Reload cluster info and current tab
        await loadClusterInfo();
        refreshCurrentTab();
        
        showClusterSwitched(newClusterID);
        
    } catch (error) {
        console.error('Error switching cluster:', error);
        showErrorBanner(
            'error',
            'Cluster Switch Failed',
            `Failed to switch to cluster: ${error.message}`,
            [{ text: 'Retry', action: switchCluster }]
        );
        
        // Revert selector to current cluster
        clusterSelect.value = currentClusterID;
    }
}

// Show cluster switching indicator
function showClusterSwitching(clusterID) {
    const banner = document.createElement('div');
    banner.id = 'clusterSwitchBanner';
    banner.className = 'namespace-loading-banner';
    banner.innerHTML = `
        <div class="spinner"></div>
        <span>Switching to cluster: <strong>${clusterID}</strong></span>
    `;
    const contentPane = document.querySelector('.content-pane');
    if (contentPane) contentPane.insertAdjacentElement('afterbegin', banner);
}

// Show cluster switched success
function showClusterSwitched(clusterID) {
    const existing = document.getElementById('clusterSwitchBanner');
    if (existing) existing.remove();
    
    const banner = document.createElement('div');
    banner.id = 'clusterSwitchBanner';
    banner.className = 'namespace-loaded-banner';
    banner.innerHTML = `
        <span class="checkmark">✓</span>
        <span>Switched to: <strong>${clusterID}</strong></span>
    `;
    const contentPane = document.querySelector('.content-pane');
    if (contentPane) contentPane.insertAdjacentElement('afterbegin', banner);
    
    // Auto-hide after 2 seconds
    setTimeout(() => {
        const indicator = document.getElementById('clusterSwitchBanner');
        if (indicator) {
            indicator.classList.add('namespace-indicator-fade-out');
            setTimeout(() => indicator.remove(), 400);
        }
    }, 2000);
}

// Show/hide a warning banner when All Namespaces is active on data-heavy tabs
// Note: "All Namespaces" feature has been removed for performance reasons
function updateAllNsBanner() {
    const existing = document.getElementById('allNsBanner');
    if (existing) existing.remove();
}

// Show namespace loading indicator
function showNamespaceLoading() {
    hideNamespaceIndicator(); // Remove any existing indicator
    const banner = document.createElement('div');
    banner.id = 'namespaceIndicator';
    banner.className = 'namespace-loading-banner';
    banner.innerHTML = `
        <div class="spinner"></div>
        <span>Loading namespace: <strong>${currentNamespace}</strong></span>
    `;
    const contentPane = document.querySelector('.content-pane');
    if (contentPane) contentPane.insertAdjacentElement('afterbegin', banner);
}

// Show namespace loaded indicator
function showNamespaceLoaded() {
    hideNamespaceIndicator(); // Remove loading indicator
    const banner = document.createElement('div');
    banner.id = 'namespaceIndicator';
    banner.className = 'namespace-loaded-banner';
    banner.innerHTML = `
        <span class="checkmark">✓</span>
        <span>Loaded: <strong>${currentNamespace}</strong></span>
    `;
    const contentPane = document.querySelector('.content-pane');
    if (contentPane) contentPane.insertAdjacentElement('afterbegin', banner);
    
    // Auto-hide after 2 seconds with fade-out animation
    setTimeout(() => {
        const indicator = document.getElementById('namespaceIndicator');
        if (indicator) {
            indicator.classList.add('namespace-indicator-fade-out');
            // Remove from DOM after animation completes
            setTimeout(() => {
                hideNamespaceIndicator();
            }, 400); // Match fadeOut animation duration
        }
    }, 2000);
}

// Hide namespace indicator
function hideNamespaceIndicator() {
    const existing = document.getElementById('namespaceIndicator');
    if (existing) existing.remove();
}

// Returns the namespace string to use in API URLs.
function nsForApi() {
    return currentNamespace;
}

function refreshCurrentTab() {
    // Clear cache for current tab to force reload
    delete tabDataCache[currentTab];
    
    // Clear auto-refresh for current tab
    clearAutoRefresh(currentTab);
    clearAutoRefresh(`${currentTab}-pods`);
    clearAutoRefresh('overview-pods');
    
    loadTabData(currentTab);
}

/* ============================================
   DASHBOARD NAVIGATION HELPERS
   ============================================ */

// Navigate to tabs – also handles resource explorer with type pre-filter
function navigateToTab(tabName, searchFilter) {
    if (tabName === 'health') tabName = 'overview';
    selectTab(null, tabName);

    if (searchFilter && tabName !== 'overview') {
        setTimeout(() => {
            const searchMap = {
                pods:        'podSearchFilter',
                deployments: 'deploymentSearchFilter',
                services:    'serviceSearchFilter',
                ingresses:   'ingressSearchFilter',
                configmaps:  'configmapSearchFilter',
                secrets:     'secretSearchFilter',
                crds:        'crdSearchFilter',
            };
            const searchId = searchMap[tabName];
            if (searchId) {
                const input = document.getElementById(searchId);
                if (input) { input.value = searchFilter; filterTable(tabName); }
            }
        }, 400);
    }
}

// Navigate to Resource Explorer pre-filtered to a specific resource type
function navigateToResourceType(resourceType) {
    selectTab(null, 'resourceViewer');
    setTimeout(() => {
        const filter = document.getElementById('resourceTypeFilter');
        if (filter) {
            filter.value = resourceType;
            loadAllResources();
        }
    }, 100);
}

// Navigate to pods tab and filter to unhealthy pods
function navigateToPodFilter(preset) {
    if (preset === 'unhealthy') {
        window._podStatusFilter = 'unhealthy';
    }
    navigateToTab('pods');
}

// Click a namespace chip: switch namespace then navigate to requested tab
function setNamespaceAndNavigate(ns, tabName) {
    const select = document.getElementById('namespaceSelect');
    if (select) {
        select.value = ns;
        changeNamespace();
    }
    setTimeout(() => navigateToTab(tabName), 100);
}

// Extract a human-readable name from an EKS ARN or any cluster identifier.
// "arn:aws:eks:us-east-1:123:cluster/my-cluster" → "my-cluster"
function clusterShortName(name) {
    if (!name) return 'Unknown';
    const m = name.match(/\/([^/]+)$/);
    return m ? m[1] : name;
}

async function loadOverview() {
    try {
        // Phase 1: Fetch HIGH priority resources first (Pods + Events/Health)
        console.log('📊 Loading HIGH priority: Pods, Events...');
        const [pods, health] = await Promise.all([
            fetchResource('pods'),  // Fetch all pods (no limit) - shares cache with Pods tab
            fetchResource('events')
        ]);

        // If fetch failed or returned null, clear dashboard
        if (!pods || !health) {
            clearDashboard();
            return;
        }

        // Handle both old format (array) and new paginated format (object with items)
        const podsArray = Array.isArray(pods) ? pods : (pods?.items || pods?.pods || []);
        
        // Show initial data immediately
        updateOverviewHealthDetails(health, podsArray);
        renderDashboardEvents(health);

        // Phase 2: Fetch MEDIUM_HIGH priority (Nodes) and MEDIUM priority (Deployments)
        console.log('📊 Loading MEDIUM priority: Deployments, Services, Nodes...');
        const [deployments, services, cluster] = await Promise.all([
            fetchResource('deployments'),  // Fetch all - shares cache with Deployments tab
            fetchResource('services'),     // Fetch all - shares cache with Services tab
            fetchResource('nodes')
        ]);

        const deploymentsArray = Array.isArray(deployments) ? deployments : (deployments?.items || deployments?.deployments || []);
        const servicesArray = Array.isArray(services) ? services : (services?.items || services?.services || []);
        
        // Update UI progressively
        updateClusterDetails(cluster, health);
        renderDashboardResourceGrid(health);
        
        // Update page subtitle
        const subtitle = document.getElementById('dashboardSubtitle');
        if (subtitle && cluster) {
            const short = clusterShortName(cluster.cluster_name);
            subtitle.textContent = `${short}${cluster.context_name && clusterShortName(cluster.context_name) !== short ? ' · ' + clusterShortName(cluster.context_name) : ''}`;
        }

        console.log('✅ Overview loaded with priority-based batching');

        // Setup auto-refresh for overview (refresh high-priority data more frequently)
        setupAutoRefresh('overview-pods', () => {
            if (currentTab === 'overview') {
                console.log('⟳ Auto-refreshing pods and events...');
                Promise.all([
                    fetchResource('pods'),  // No limit - shares cache with Pods tab
                    fetchResource('events')
                ]).then(([pods, health]) => {
                    const podsArray = Array.isArray(pods) ? pods : (pods?.items || pods?.pods || []);
                    updateOverviewHealthDetails(health, podsArray);
                    renderDashboardEvents(health);
                });
            }
        });

    } catch (error) {
        console.error('Error loading overview:', error);
        clearDashboard();
        showErrorBanner(
            'error',
            '⚠️ Dashboard Load Failed',
            'Cannot load dashboard data. Check cluster connectivity.',
            [{ text: 'Retry', action: () => loadOverview() }]
        );
    }
}

// Clear dashboard when cluster is unreachable
function clearDashboard() {
    // Clear cluster details
    const clusterDetailsEl = document.querySelector('.cluster-details');
    if (clusterDetailsEl) {
        clusterDetailsEl.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Cluster data unavailable</p>';
    }
    
    // Clear events
    const eventsEl = document.querySelector('.events-list');
    if (eventsEl) {
        eventsEl.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">No events</p>';
    }
    
    console.log('Dashboard cleared due to cluster connectivity issues');
}

// updateStatCards function removed - stat cards no longer exist in UI

function updateCharts(pods, deployments, services) {
    // Check if Chart.js is loaded
    if (typeof Chart === 'undefined') {
        console.error('Chart.js is not loaded');
        return;
    }
    
    // Destroy existing charts if they exist
    if (podStatusChart) {
        podStatusChart.destroy();
    }
    if (resourceChart) {
        resourceChart.destroy();
    }
    
    // Handle both array and object formats
    const podsArray = Array.isArray(pods) ? pods : (pods.pods || []);
    const deploymentsArray = Array.isArray(deployments) ? deployments : (deployments.deployments || []);
    const servicesArray = Array.isArray(services) ? services : (services.services || []);
    
    try {
        // Pod Status Chart
        const podsByStatus = {};
        podsArray.forEach(pod => {
            podsByStatus[pod.status] = (podsByStatus[pod.status] || 0) + 1;
        });
        
        const podCtx = document.getElementById('podStatusChart');
        if (podCtx && Object.keys(podsByStatus).length > 0) {
            podStatusChart = new Chart(podCtx, {
                type: 'doughnut',
                data: {
                    labels: Object.keys(podsByStatus),
                    datasets: [{
                        data: Object.values(podsByStatus),
                        backgroundColor: [
                            'rgb(34, 197, 94)',   // green
                            'rgb(239, 68, 68)',   // red
                            'rgb(251, 191, 36)',  // yellow
                            'rgb(59, 130, 246)',  // blue
                            'rgb(168, 85, 247)',  // purple
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: {
                                color: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151',
                                padding: 15
                            }
                        }
                    }
                }
            });
        }
        
        // Resource Overview Chart
        const resourceCtx = document.getElementById('resourceChart');
        if (resourceCtx) {
            resourceChart = new Chart(resourceCtx, {
                type: 'bar',
                data: {
                    labels: ['Pods', 'Deployments', 'Services'],
                    datasets: [{
                        label: 'Resources',
                        data: [
                            podsArray.length,
                            deploymentsArray.length,
                            servicesArray.length
                        ],
                        backgroundColor: [
                            'rgb(59, 130, 246)',
                            'rgb(168, 85, 247)',
                            'rgb(34, 197, 94)'
                        ],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151'
                            },
                            grid: {
                                color: document.documentElement.classList.contains('dark') ? '#374151' : '#e5e7eb'
                            }
                        },
                        x: {
                            ticks: {
                                color: document.documentElement.classList.contains('dark') ? '#d1d5db' : '#374151'
                            },
                            grid: {
                                display: false
                            }
                        }
                    }
                }
            });
        }
    } catch (error) {
        console.error('Error creating charts:', error);
    }
}

function updateClusterDetails(cluster, health) {
    const detailsEl = document.getElementById('clusterDetails');
    if (!detailsEl) return;
    
    // Handle null/undefined cluster (e.g., when API fails)
    if (!cluster) {
        detailsEl.innerHTML = '<div class="dash-info-list"><div style="color: var(--text-secondary); padding: 12px;">Cluster information unavailable</div></div>';
        return;
    }

    const nodeCount = (health && health.nodes) ? health.nodes.length : 0;
    const readyNodes = (health && health.nodes) ? health.nodes.filter(n => n.ready !== false).length : 0;
    const nsCount = cluster.namespaces ? cluster.namespaces.length : 0;

    let html = `<div class="dash-info-list">`;

    const shortName = clusterShortName(cluster.cluster_name);
    const shortCtx = clusterShortName(cluster.context_name);
    html += `
        <div class="dash-info-row">
            <span class="dash-info-key">Cluster</span>
            <span class="dash-info-val">${shortName}</span>
        </div>
        ${shortCtx !== shortName ? `
        <div class="dash-info-row">
            <span class="dash-info-key">Context</span>
            <span class="dash-info-val dash-info-mono">${shortCtx}</span>
        </div>` : ''}
        <div class="dash-info-row">
            <span class="dash-info-key">Nodes</span>
            <span class="dash-info-val">
                <span style="color:var(--success)">${readyNodes} ready</span>
                ${nodeCount - readyNodes > 0 ? `<span style="color:var(--danger);margin-left:6px;">${nodeCount - readyNodes} not ready</span>` : ''}
                <span class="dash-info-muted"> / ${nodeCount} total</span>
            </span>
        </div>
        <div class="dash-info-row">
            <span class="dash-info-key">Namespaces</span>
            <span class="dash-info-val">
                <span class="dash-count-badge">${nsCount}</span>
            </span>
        </div>
    `;

    // Namespace chips (up to 8, then overflow)
    if (cluster.namespaces && cluster.namespaces.length > 0) {
        html += `<div class="dash-ns-chips">`;
        cluster.namespaces.slice(0, 8).forEach(ns => {
            html += `<span class="dash-ns-chip" onclick="setNamespaceAndNavigate('${ns}', 'pods')">${ns}</span>`;
        });
        if (cluster.namespaces.length > 8) {
            html += `<span class="dash-ns-chip dash-ns-chip-more">+${cluster.namespaces.length - 8} more</span>`;
        }
        html += `</div>`;
    }

    // Node list (compact, first 7 visible, rest collapsible)
    if (health && health.nodes && health.nodes.length > 0) {
        const nodes = health.nodes;
        const initialCount = 7;
        const hasMore = nodes.length > initialCount;
        const nodeId = 'dash-nodes-extra-' + Date.now();
        html += `<div class="dash-nodes-mini">`;
        nodes.forEach((node, idx) => {
            const ready = node.ready !== false;
            const hidden = hasMore && idx >= initialCount ? ` style="display:none"` : '';
            const extraClass = hasMore && idx >= initialCount ? ' dash-node-extra' : '';
            html += `
                <div class="dash-node-row${extraClass}"${hidden}>
                    <span class="dash-node-dot" style="background:${ready ? 'var(--success)' : 'var(--danger)'}"></span>
                    <span class="dash-node-name">${node.name}</span>
                    <span class="dash-node-meta">${node.instance_type || node.os || ''}</span>
                    <span class="dash-node-status" style="color:${ready ? 'var(--success)' : 'var(--danger)'}">${ready ? 'Ready' : 'NotReady'}</span>
                </div>
            `;
        });
        if (hasMore) {
            html += `
                <div class="dash-nodes-toggle" onclick="
                    var rows = this.parentElement.querySelectorAll('.dash-node-extra');
                    var expanded = this.getAttribute('data-expanded') === '1';
                    rows.forEach(function(r){ r.style.display = expanded ? 'none' : ''; });
                    this.setAttribute('data-expanded', expanded ? '0' : '1');
                    this.textContent = expanded ? 'View all ${nodes.length} nodes ▾' : 'Show less ▴';
                " data-expanded="0">View all ${nodes.length} nodes ▾</div>
            `;
        }
        html += `</div>`;
    }

    html += `</div>`;
    detailsEl.innerHTML = html;
}

function updateOverviewHealthDetails(health, podsArray) {
    const detailsEl = document.getElementById('overviewHealthDetails');
    if (!detailsEl) return;
    if (!health) { detailsEl.innerHTML = '<span class="muted-text">No health data</span>'; return; }

    const podCount     = health.pod_count     || 0;
    const podRunning   = health.pod_running    || 0;
    const podUnhealthy = podCount - podRunning;
    const podPct = podCount > 0 ? Math.round((podRunning / podCount) * 100) : 100;

    const depCount   = health.deployment_count          || 0;
    const depHealthy = health.deployment_health?.healthy || 0;
    const depPct = depCount > 0 ? Math.round((depHealthy / depCount) * 100) : 100;

    const nodeCount = (health.nodes && health.nodes.length) || 0;
    const nodeReady = (health.nodes && health.nodes.filter(n => n.ready !== false).length) || nodeCount;
    const nodePct = nodeCount > 0 ? Math.round((nodeReady / nodeCount) * 100) : 100;

    // Services metrics
    const svcWith    = health.service_health?.with_endpoints    || 0;
    const svcWithout = health.service_health?.without_endpoints || 0;
    const svcTotal   = health.service_count || 0;
    const svcPct = svcTotal > 0 ? Math.round((svcWith / svcTotal) * 100) : 100;

    function circleColor(pct) { return pct >= 80 ? 'status-healthy' : pct >= 50 ? 'status-warning' : 'status-critical'; }

    let html = `
        <div class="dash-circles">
            <div class="dash-circle-item" onclick="navigateToTab('pods')" title="View pods">
                <div class="circular-progress ${circleColor(podPct)}">
                    <svg class="circular-svg" width="80" height="80">
                        <circle class="circular-bg" cx="40" cy="40" r="33"/>
                        <circle class="circular-bar" cx="40" cy="40" r="33"
                            style="stroke-dasharray:207;stroke-dashoffset:${207 - (207 * podPct) / 100};"/>
                    </svg>
                    <div class="circular-text"><div class="circular-value" style="font-size:18px;">${podCount}</div></div>
                </div>
                <div class="dash-circle-label">Pods</div>
                <div class="dash-circle-sub">
                    <span style="color:var(--success)">${podRunning}↑</span>
                    ${podUnhealthy > 0 ? `<span style="color:var(--danger);cursor:pointer" onclick="event.stopPropagation();navigateToPodFilter('unhealthy')">${podUnhealthy}↓</span>` : ''}
                </div>
            </div>
            <div class="dash-circle-item" onclick="navigateToTab('deployments')" title="View deployments">
                <div class="circular-progress ${circleColor(depPct)}">
                    <svg class="circular-svg" width="80" height="80">
                        <circle class="circular-bg" cx="40" cy="40" r="33"/>
                        <circle class="circular-bar" cx="40" cy="40" r="33"
                            style="stroke-dasharray:207;stroke-dashoffset:${207 - (207 * depPct) / 100};"/>
                    </svg>
                    <div class="circular-text"><div class="circular-value" style="font-size:18px;">${depCount}</div></div>
                </div>
                <div class="dash-circle-label">Deployments</div>
                <div class="dash-circle-sub">
                    <span style="color:var(--success)">${depHealthy}↑</span>
                    ${depCount - depHealthy > 0 ? `<span style="color:var(--danger)">${depCount - depHealthy}↓</span>` : ''}
                </div>
            </div>
            <div class="dash-circle-item" onclick="navigateToTab('services')" title="View services">
                <div class="circular-progress ${circleColor(svcPct)}">
                    <svg class="circular-svg" width="80" height="80">
                        <circle class="circular-bg" cx="40" cy="40" r="33"/>
                        <circle class="circular-bar" cx="40" cy="40" r="33"
                            style="stroke-dasharray:207;stroke-dashoffset:${207 - (207 * svcPct) / 100};"/>
                    </svg>
                    <div class="circular-text"><div class="circular-value" style="font-size:18px;">${svcTotal}</div></div>
                </div>
                <div class="dash-circle-label">Services</div>
                <div class="dash-circle-sub">
                    <span style="color:var(--success)">${svcWith}↑</span>
                    ${svcWithout > 0 ? `<span style="color:var(--danger)">${svcWithout}↓</span>` : ''}
                </div>
            </div>
            <div class="dash-circle-item" onclick="navigateToTab('cluster')" title="View nodes">
                <div class="circular-progress ${circleColor(nodePct)}">
                    <svg class="circular-svg" width="80" height="80">
                        <circle class="circular-bg" cx="40" cy="40" r="33"/>
                        <circle class="circular-bar" cx="40" cy="40" r="33"
                            style="stroke-dasharray:207;stroke-dashoffset:${207 - (207 * nodePct) / 100};"/>
                    </svg>
                    <div class="circular-text"><div class="circular-value" style="font-size:18px;">${nodeCount}</div></div>
                </div>
                <div class="dash-circle-label">Nodes</div>
                <div class="dash-circle-sub">
                    <span style="color:var(--success)">${nodeReady}↑</span>
                    ${nodeCount - nodeReady > 0 ? `<span style="color:var(--danger)">${nodeCount - nodeReady}↓</span>` : ''}
                </div>
            </div>
        </div>
    `;

    // Unhealthy pods — inline, fills the empty space in this panel
    // Succeeded/Completed = healthy terminal states (job pods), exclude them
    const unhealthyPods = (podsArray || []).filter(p =>
        !['Running', 'Succeeded', 'Completed'].includes(p.status) ||
        (p.status === 'Running' && p.ready_containers < p.total_containers)
    );
    html += `
        <div class="dash-unhealthy-section">
            <div class="dash-unhealthy-section-title">
                Unhealthy Workloads
                ${unhealthyPods.length > 0 ? `<span class="dash-badge-danger">${unhealthyPods.length}</span>` : ''}
            </div>
    `;
    if (unhealthyPods.length === 0) {
        html += `
            <div class="dash-all-healthy">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>
                All workloads healthy
            </div>
        `;
    } else {
        unhealthyPods.slice(0, 6).forEach(pod => {
            const color = pod.status === 'Failed' ? 'var(--danger)' : 'var(--warning)';
            const restarts = pod.restart_count || pod.restarts || 0;
            html += `
                <div class="dash-unhealthy-row" onclick="navigateToTab('pods','${pod.name}')" title="Find in Pods tab">
                    <span class="dash-unhealthy-dot" style="background:${color}"></span>
                    <span class="dash-unhealthy-name">${pod.name}</span>
                    <span class="dash-unhealthy-status" style="color:${color}">${pod.status}</span>
                    ${restarts > 0 ? `<span class="dash-unhealthy-restarts">${restarts}↻</span>` : ''}
                </div>
            `;
        });
        if (unhealthyPods.length > 6) {
            html += `<div class="dash-see-more" onclick="navigateToPodFilter('unhealthy')">See all ${unhealthyPods.length} unhealthy pods →</div>`;
        }
    }
    html += `</div>`;

    detailsEl.innerHTML = html;
}

function renderDashboardResourceGrid(health) {
    const el = document.getElementById('dashResourceGrid');
    if (!el) return;

    // tab: direct tab name, rtype: pre-filter Explorer by this K8s type
    const items = [
        { label: 'StatefulSets', count: health.summary?.statefulsets || 0, sub: `${health.summary?.statefulsets_ready || 0} ready`,    rtype: 'StatefulSet', icon: '<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20M9 21V9"/>' },
        { label: 'DaemonSets',   count: health.summary?.daemonsets   || 0, sub: `${health.summary?.daemonsets_ready   || 0} ready`,    rtype: 'DaemonSet',   icon: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>' },
        { label: 'Ingresses',    count: health.summary?.ingresses     || 0, sub: '',                                                     tab: 'ingresses',     icon: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>' },
        { label: 'Jobs',         count: health.summary?.jobs         || 0, sub: `${health.summary?.jobs_succeeded     || 0} succeeded`, tab: 'cronjobs',      icon: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>' },
        { label: 'CronJobs',     count: health.summary?.cronjobs     || 0, sub: `${health.summary?.cronjobs_suspended || 0} suspended`, tab: 'cronjobs',      icon: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' },
        { label: 'ConfigMaps',   count: health.summary?.configmaps   || 0, sub: '',                                                     tab: 'configmaps',    icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>' },
        { label: 'Secrets',      count: health.summary?.secrets      || 0, sub: '',                                                     tab: 'secrets',       icon: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>' },
        { label: 'PVCs',         count: health.summary?.pvcs         || 0, sub: `${health.summary?.pvcs_bound         || 0} bound`,    tab: 'pvpvc',         icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>' },
    ];

    let html = `<div class="dash-resource-grid">`;
    items.forEach(item => {
        // Items with rtype go to Resource Explorer pre-filtered; others go to their direct tab
        const onclick = item.rtype
            ? `navigateToResourceType('${item.rtype}')`
            : `navigateToTab('${item.tab}')`;
        html += `
            <div class="dash-resource-card" onclick="${onclick}" title="Go to ${item.label}">
                <div class="dash-resource-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
                </div>
                <div class="dash-resource-count">${item.count}</div>
                <div class="dash-resource-label">${item.label}</div>
                ${item.sub ? `<div class="dash-resource-sub">${item.sub}</div>` : '<div class="dash-resource-sub">&nbsp;</div>'}
            </div>
        `;
    });
    html += `</div>`;
    el.innerHTML = html;
}

function renderDashboardEvents(health) {
    const el = document.getElementById('dashEventsPanel');
    if (!el) return;

    const events = health.cluster_events || [];
    if (events.length === 0) {
        el.style.display = 'none';
        return;
    }

    const warnCount = events.filter(e => e.type === 'Warning' || e.type === 'Error').length;
    let html = `
        <div class="panel" style="margin-bottom:16px;">
            <div class="panel-header">
                <span style="display:flex;align-items:center;gap:6px;">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    Recent Events
                    ${warnCount > 0 ? `<span class="dash-badge-danger">${warnCount} warnings</span>` : ''}
                </span>
            </div>
            <div class="panel-body dash-events-grid">
    `;
    events.slice(0, 12).forEach(event => {
        const isWarning = event.type === 'Warning' || event.type === 'Error';
        const time = event.time ? new Date(event.time).toLocaleString('en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'}) : '';
        html += `
            <div class="dash-event-row ${isWarning ? 'dash-event-warn' : 'dash-event-info'}">
                <div class="dash-event-reason">${event.reason || 'Event'}</div>
                <div class="dash-event-msg">${event.message || ''}</div>
                <div class="dash-event-meta">${event.resource ? event.resource + ' · ' : ''}${event.count > 1 ? event.count + 'x · ' : ''}${time}</div>
            </div>
        `;
    });
    html += `</div></div>`;
    el.innerHTML = html;
    el.style.display = '';
}

/* ============================================
   INGRESSES
   ============================================ */

async function loadIngresses() {
    const container = document.getElementById('ingressesContent');
    const startTime = performance.now();
    container.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading ingresses...</p></div>';

    try {
        const response = await safeFetch(`/api/ingresses/${nsForApi()}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const ingresses = await response.json();
        const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`✓ Loaded ${ingresses.length} ingresses in ${loadTime}s`);

        if (!Array.isArray(ingresses)) {
            throw new Error('Invalid response format');
        }

        if (ingresses.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🌐</div><p>No ingresses found</p></div>';
            return;
        }

        // Store globally for detail panel access (consistent array format)
        window.ingressesData = Array.isArray(ingresses) ? ingresses : [ingresses];
        renderIngressesTable(ingresses, container, loadTime);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading ingresses</p><small>${error.message}</small></div>`;
    }
}

function renderIngressesTable(ingresses, container, loadTime = '') {
    const tlsCount = ingresses.filter(i => i.tls_enabled).length;
    const hostCount = ingresses.reduce((sum, i) => sum + ((i.rules && i.rules.length) || (i.hosts && i.hosts.length) || 0), 0);
    
    // Update stats in resource-controls
    const statsHtml = `
        <div class="resource-stats">
            <div class="stat-mini">
                <span class="stat-mini-value">${ingresses.length}</span>
                <span class="stat-mini-label">Total</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${hostCount}</span>
                <span class="stat-mini-label">Hosts</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${tlsCount}</span>
                <span class="stat-mini-label">TLS</span>
            </div>
            ${loadTime ? `<div class="stat-mini" title="Load time"><span class="stat-mini-value">${loadTime}s</span><span class="stat-mini-label">Load Time</span></div>` : ''}
        </div>
    `;
    
    const controlsDiv = document.querySelector('#ingresses .resource-controls');
    if (controlsDiv) {
        // Remove existing stats if any
        const existingStats = controlsDiv.querySelector('.resource-stats');
        if (existingStats) existingStats.remove();
        // Insert stats at the beginning
        controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
    }
    
    let html = `
        <table class="resource-table ingress-table">
            <thead>
                <tr>
                    <th>Ingress Name</th>
                    <th>Host</th>
                    <th>Class</th>
                    <th>TLS</th>
                    <th>LB IPs</th>
                </tr>
            </thead>
            <tbody>
    `;

    ingresses.forEach((ing, idx) => {
        // Get primary host (first rule's host or first host)
        let primaryHost = '*';
        let hostCount = 0;
        
        if (ing.rules && ing.rules.length > 0) {
            primaryHost = ing.rules[0].host || '*';
            hostCount = ing.rules.length;
        } else if (ing.hosts && ing.hosts.length > 0) {
            primaryHost = ing.hosts[0];
            hostCount = ing.hosts.length;
        }
        
        const hostDisplay = hostCount > 1 
            ? `${primaryHost} <span class="badge-count">+${hostCount - 1}</span>`
            : primaryHost;
        
        const lbIPs = ing.loadbalancer_ips && ing.loadbalancer_ips.length > 0
            ? ing.loadbalancer_ips.join(', ')
            : '-';

        // Main row - clickable to open detail panel
        html += `
            <tr class="clickable-row" onclick="openDetailPanel('ingressesDetails', 'Ingress', '${ing.namespace}', '${ing.name}')">
                <td>🌐 ${ing.name}</td>
                <td><span class="badge-host">${hostDisplay}</span></td>
                <td>${ing.ingress_class || '-'}</td>
                <td>${ing.tls_enabled ? '<span class="badge-success">🔒 Yes</span>' : '<span class="badge-secondary">No</span>'}</td>
                <td><span class="text-muted">${lbIPs}</span></td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderIngressDetails(ing) {
    let detailsHtml = '';
    
    // Extract details object (backend returns nested structure)
    const details = ing.details || ing;
    
    // Debug: Log the data structure
    console.log('renderIngressDetails called with:', ing);
    console.log('Extracted details:', details);
    
    // Always show basic Ingress Configuration section
    detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🌐</span>Ingress Configuration</h4><div class="info-grid">';
    detailsHtml += `<div class="info-item"><label class="info-label">Ingress Class</label><span class="info-value">${details.ingress_class || 'default'}</span></div>`;
    detailsHtml += `<div class="info-item"><label class="info-label">TLS Enabled</label><span class="info-value">${details.tls_enabled ? 'Yes' : 'No'}</span></div>`;
    if (details.hosts && details.hosts.length > 0) {
        detailsHtml += `<div class="info-item"><label class="info-label">Hosts</label><span class="info-value">${details.hosts.join(', ')}</span></div>`;
    }
    detailsHtml += '</div></div>';
    
    // TLS Configuration
    if (details.tls_config && details.tls_config.length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔒</span>TLS Configuration</h4>';
        details.tls_config.forEach((tls, idx) => {
            detailsHtml += '<div class="info-grid" style="margin-bottom: 12px; padding: 12px; background: var(--bg-darker); border-radius: 4px;">';
            detailsHtml += `<div class="info-item"><label class="info-label">Secret</label><span class="info-value code">${tls.secret_name}</span></div>`;
            if (tls.hosts && tls.hosts.length > 0) {
                detailsHtml += `<div class="info-item"><label class="info-label">Hosts</label><span class="info-value">${tls.hosts.join(', ')}</span></div>`;
            }
            detailsHtml += '</div>';
        });
        detailsHtml += '</div>';
    }
    
    // Rules and Paths
    if (details.rules && details.rules.length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔀</span>Routing Rules</h4>';
        details.rules.forEach((rule, idx) => {
            detailsHtml += '<div style="margin-bottom: 16px; padding: 12px; background: var(--bg-darker); border-radius: 6px; border-left: 3px solid var(--primary);">';
            detailsHtml += `<div style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">Host: ${rule.host || '* (default)'}</div>`;
            
            if (rule.paths && rule.paths.length > 0) {
                detailsHtml += '<table style="width: 100%; border-collapse: collapse; margin-top: 8px;">';
                detailsHtml += '<thead><tr style="background: var(--bg-darkest); text-align: left; font-size: 0.85em;"><th style="padding: 6px;">Path</th><th>Type</th><th>Service</th><th>Port</th></tr></thead><tbody>';
                rule.paths.forEach(path => {
                    detailsHtml += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 6px;"><code>${path.path}</code></td>
                            <td style="font-size: 0.85em;">${path.path_type}</td>
                            <td><span class="badge-info">${path.service}</span></td>
                            <td>${path.port}</td>
                        </tr>
                    `;
                });
                detailsHtml += '</tbody></table>';
            }
            detailsHtml += '</div>';
        });
        detailsHtml += '</div>';
    } else {
        // Show message if no routing rules
        detailsHtml += '<div class="info-section"><p style="color: var(--text-secondary);">No routing rules configured</p></div>';
    }
    
    // Show Kong plugins if available
    if (details.kong_plugins && details.kong_plugins.length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔌</span>Kong Plugins</h4><div class="plugin-badges">';
        details.kong_plugins.forEach(plugin => {
            detailsHtml += `<span class="badge-plugin">${plugin}</span>`;
        });
        detailsHtml += '</div></div>';
    }
    
    // Labels
    if (details.labels && Object.keys(details.labels).length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.entries(details.labels).forEach(([key, value]) => {
            detailsHtml += `<span class="label-badge">${key}: ${value}</span>`;
        });
        detailsHtml += '</div></div>';
    }
    
    // Annotations (often contain important ingress config)
    if (details.annotations && Object.keys(details.annotations).length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">📝</span>Annotations</h4><div style="max-height: 200px; overflow-y: auto;">';
        Object.entries(details.annotations).forEach(([key, value]) => {
            detailsHtml += `<div style="padding: 4px 0; border-bottom: 1px solid var(--border-color); font-size: 0.85em;"><strong style="color: var(--text-secondary);">${key}:</strong> <span style="color: var(--text-primary); font-family: var(--font-mono); word-break: break-all;">${value}</span></div>`;
        });
        detailsHtml += '</div></div>';
    }
    
    return detailsHtml;
}

function toggleIngressDetails(ingressId) {
    const detailsRow = document.getElementById(`${ingressId}-details`);
    const icon = document.getElementById(`${ingressId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

async function testAllIngressChecks(host, tlsEnabled, ingressName, hostIdx) {
    const resultId = `test-result-${ingressName}-${hostIdx}`;
    const resultEl = document.getElementById(resultId);

    if (!resultEl) return;

    resultEl.innerHTML = '<span style="color: var(--info-color);">⏳ Running full diagnostics...</span>';

    const port = tlsEnabled ? 443 : 80;
    const protocol = tlsEnabled ? 'https' : 'http';

    let results = [];

    try {
        // DNS Test
        const dnsResp = await fetch('/api/network/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostname: host, test_type: 'dns' })
        });
        const dnsData = await dnsResp.json();
        results.push(`DNS: ${dnsData.status_emoji} ${dnsData.resolved_ip || 'failed'} (${dnsData.latency_ms.toFixed(0)}ms)`);

        // TCP Test
        const tcpResp = await fetch('/api/network/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostname: host, port: port, test_type: 'tcp' })
        });
        const tcpData = await tcpResp.json();
        results.push(`TCP:${port}: ${tcpData.status_emoji} (${tcpData.latency_ms.toFixed(0)}ms)`);

        // HTTP/HTTPS Test
        const httpResp = await fetch('/api/network/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostname: host, test_type: protocol })
        });
        const httpData = await httpResp.json();
        results.push(`${protocol.toUpperCase()}: ${httpData.status_emoji} ${httpData.status_code || ''} (${httpData.latency_ms.toFixed(0)}ms)`);

        const allSuccess = dnsData.success && tcpData.success && httpData.success;
        const color = allSuccess ? 'var(--success-color)' : 'var(--warning-color)';

        resultEl.innerHTML = `
            <div style="color: ${color}; line-height: 1.6;">
                ${results.join(' • ')}
            </div>
        `;
    } catch (error) {
        resultEl.innerHTML = `<span style="color: var(--danger-color);">✗ Test failed: ${error.message}</span>`;
    }
}

/* ============================================
   SERVICES
   ============================================ */

async function loadServices() {
    const container = document.getElementById('servicesContent');
    const startTime = performance.now();
    container.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading services...</p></div>';

    try {
        // Always load related resources for relationship matching
        const fetchServices = safeFetch(`/api/services/${nsForApi()}`).then(r => r.ok ? r.json() : null);
        const fetchDeployments = safeFetch(`/api/deployments/${nsForApi()}`).then(r => r.ok ? r.json() : null);
        const fetchIngresses = safeFetch(`/api/ingresses/${nsForApi()}`).then(r => r.ok ? r.json() : null);
        
        const [servicesData, deploymentsData, ingressesData] = await Promise.all([
            fetchServices,
            fetchDeployments,
            fetchIngresses
        ]);
        
        // Store deployments globally
        if (deploymentsData) {
            const deps = deploymentsData.items || deploymentsData;
            window.deploymentsData = Array.isArray(deps) ? deps : [deps];
            console.log(`✓ Loaded ${window.deploymentsData.length} deployments for service matching`);
        }
        
        // Store ingresses globally
        if (ingressesData) {
            const ings = ingressesData.items || ingressesData;
            window.ingressesData = Array.isArray(ings) ? ings : [ings];
            console.log(`✓ Loaded ${window.ingressesData.length} ingresses for service matching`);
        }

        if (!servicesData) {
            throw new Error('Failed to load services');
        }

        const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
        
        // Handle both old format (array) and new format (object with items)
        const services = Array.isArray(servicesData) ? servicesData : (servicesData.items || []);
        console.log(`✓ Loaded ${services.length} services in ${loadTime}s`);

        if (services.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔗</div><p>No services found</p></div>';
            return;
        }

        // Store globally for detail panel access in consistent format
        window.servicesData = { items: services };
        
        // Debug logging
        console.log('Services tab data check:', {
            services: services.length,
            deployments: window.deploymentsData?.length || 0,
            ingresses: window.ingressesData?.length || 0
        });
        
        renderServicesTable(services, container, loadTime);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading services</p><small>${error.message}</small></div>`;
    }
}

function renderServicesTable(services, container, loadTime = '') {
    const lbCount = services.filter(s => s.type === 'LoadBalancer').length;
    const totalEndpoints = services.reduce((sum, s) => sum + (s.endpoint_count || 0), 0);
    
    // Update stats in resource-controls
    const statsHtml = `
        <div class="resource-stats">
            <div class="stat-mini">
                <span class="stat-mini-value">${services.length}</span>
                <span class="stat-mini-label">Total</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${lbCount}</span>
                <span class="stat-mini-label">LoadBalancer</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${totalEndpoints}</span>
                <span class="stat-mini-label">Endpoints</span>
            </div>
            ${loadTime ? `<div class="stat-mini" title="Load time"><span class="stat-mini-value">${loadTime}s</span><span class="stat-mini-label">Load Time</span></div>` : ''}
        </div>
    `;
    
    const controlsDiv = document.querySelector('#services .resource-controls');
    if (controlsDiv) {
        const existingStats = controlsDiv.querySelector('.resource-stats');
        if (existingStats) existingStats.remove();
        controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
    }
    
    let html = `
        <table class="resource-table service-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Cluster IP</th>
                    <th>Ports</th>
                    <th>Endpoints</th>
                    <th>Routes To (Deployments)</th>
                    <th>Exposed By (Ingresses)</th>
                </tr>
            </thead>
            <tbody>
    `;

    services.forEach((svc, idx) => {
        const typeClass = svc.type === 'LoadBalancer' ? 'success' : svc.type === 'NodePort' ? 'warning' : 'info';
        
        // Find deployments that this service routes to (by matching selector with pod labels)
        let routesTo = [];
        if (window.deploymentsData && svc.selector && Object.keys(svc.selector).length > 0) {
            routesTo = window.deploymentsData.filter(dep => {
                if (dep.namespace !== svc.namespace) return false;
                if (!dep.pod_labels) return false;
                
                // Check if all service selector labels match deployment pod labels
                return Object.entries(svc.selector).every(([key, value]) => {
                    return dep.pod_labels[key] === value;
                });
            });
        }
        
        // Find ingresses that expose this service
        let exposedBy = [];
        if (window.ingressesData && Array.isArray(window.ingressesData)) {
            exposedBy = window.ingressesData.filter(ing => {
                if (ing.namespace !== svc.namespace) return false;
                if (!ing.rules || !Array.isArray(ing.rules)) return false;
                
                // Check if any ingress rule references this service
                return ing.rules.some(rule => {
                    if (!rule.paths || !Array.isArray(rule.paths)) return false;
                    return rule.paths.some(path => path.service_name === svc.name);
                });
            });
        }
        
        // Debug logging for first two services
        if (idx < 2) {
            console.log(`Service ${idx + 1}: ${svc.name}`, {
                namespace: svc.namespace,
                selector: svc.selector,
                deployments_available: window.deploymentsData?.length || 0,
                ingresses_available: window.ingressesData?.length || 0,
                routes_to_matches: routesTo.length,
                exposed_by_matches: exposedBy.length
            });
            
            if (window.deploymentsData && window.deploymentsData.length > 0 && idx === 0) {
                console.log('First deployment sample:', {
                    name: window.deploymentsData[0].name,
                    namespace: window.deploymentsData[0].namespace,
                    pod_labels: window.deploymentsData[0].pod_labels
                });
            }
            
            if (window.ingressesData && window.ingressesData.length > 0 && idx === 0) {
                console.log('First ingress sample:', {
                    name: window.ingressesData[0].name,
                    namespace: window.ingressesData[0].namespace,
                    rules: window.ingressesData[0].rules
                });
            }
        }
        
        // Endpoints HTML (clickable to navigate to endpoints tab)
        const endpointsHtml = svc.endpoint_count > 0
            ? `<span class="badge-success clickable-badge" onclick="event.stopPropagation(); navigateToEndpoints('${svc.namespace}', '${svc.name}')" title="View endpoints">✓ ${svc.endpoint_count}</span>`
            : '<span class="badge-secondary">0</span>';
        
        // Routes To HTML
        let routesToHtml = '<span class="text-muted">-</span>';
        if (routesTo.length > 0) {
            const firstDep = routesTo[0];
            const moreCount = routesTo.length - 1;
            routesToHtml = `<span class="badge-info clickable-badge" onclick="event.stopPropagation(); navigateToDeployments('${firstDep.namespace}', '${firstDep.name}')" title="View deployment">📦 ${firstDep.name}</span>`;
            if (moreCount > 0) {
                routesToHtml += ` <span class="text-muted">+${moreCount}</span>`;
            }
        }
        
        // Exposed By HTML
        let exposedByHtml = '<span class="text-muted">-</span>';
        if (exposedBy.length > 0) {
            const firstIng = exposedBy[0];
            const moreCount = exposedBy.length - 1;
            exposedByHtml = `<span class="badge-warning clickable-badge" onclick="event.stopPropagation(); navigateToIngresses('${firstIng.namespace}', '${firstIng.name}')" title="View ingress">🌐 ${firstIng.name}</span>`;
            if (moreCount > 0) {
                exposedByHtml += ` <span class="text-muted">+${moreCount}</span>`;
            }
        }
        
        // Main row - clickable to open detail panel
        html += `
            <tr class="clickable-row" onclick="openDetailPanel('servicesDetails', 'Service', '${svc.namespace}', '${svc.name}')">
                <td>🔗 ${svc.name}</td>
                <td><span class="badge-${typeClass}">${svc.type || 'ClusterIP'}</span></td>
                <td><span class="mono-text">${svc.cluster_ip || '-'}</span></td>
                <td><span class="badge-info">${(svc.ports || []).length}</span></td>
                <td>${endpointsHtml}</td>
                <td>${routesToHtml}</td>
                <td>${exposedByHtml}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderServiceDetails(svc) {
    let detailsHtml = '';
    
    // Extract details object (backend returns nested structure)
    const details = svc.details || svc;
    
    // Debug: Log the data structure
    console.log('renderServiceDetails called with:', svc);
    console.log('Extracted details:', details);
    
    // Service Configuration
    detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔗</span>Service Configuration</h4><div class="info-grid">';
    detailsHtml += `<div class="info-item"><label class="info-label">Type</label><span class="info-value">${details.type || 'ClusterIP'}</span></div>`;
    if (details.cluster_ip) {
        detailsHtml += `<div class="info-item"><label class="info-label">Cluster IP</label><span class="info-value code">${details.cluster_ip}</span></div>`;
    }
    if (details.session_affinity) {
        detailsHtml += `<div class="info-item"><label class="info-label">Session Affinity</label><span class="info-value">${details.session_affinity}</span></div>`;
    }
    if (details.endpoint_count !== undefined) {
        detailsHtml += `<div class="info-item"><label class="info-label">Endpoints</label><span class="info-value">${details.endpoint_count}</span></div>`;
    }
    detailsHtml += '</div></div>';
    
    // External IPs if present
    if (details.external_ips && details.external_ips.length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🌐</span>External IPs</h4><div class="plugin-badges">';
        details.external_ips.forEach(ip => {
            detailsHtml += `<span class="badge-plugin">${ip}</span>`;
        });
        detailsHtml += '</div></div>';
    }
    
    // Ports - detailed table
    if (details.ports && details.ports.length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔌</span>Ports</h4>';
        detailsHtml += '<table style="width: 100%; border-collapse: collapse; margin-top: 8px;">';
        detailsHtml += '<thead><tr style="background: var(--bg-darkest); text-align: left; font-size: 0.85em;"><th style="padding: 6px;">Name</th><th>Port</th><th>Target Port</th><th>Protocol</th><th>Node Port</th></tr></thead><tbody>';
        details.ports.forEach(port => {
            detailsHtml += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 6px;">${port.name || '-'}</td>
                    <td>${port.port}</td>
                    <td><code>${port.target_port || port.port}</code></td>
                    <td>${port.protocol || 'TCP'}</td>
                    <td>${port.node_port || '-'}</td>
                </tr>
            `;
        });
        detailsHtml += '</tbody></table></div>';
    }
    
    // Selector
    if (details.selector && Object.keys(details.selector).length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🎯</span>Selector</h4><div class="labels-container">';
        Object.entries(details.selector).forEach(([key, value]) => {
            detailsHtml += `<span class="label-badge">${key}: ${value}</span>`;
        });
        detailsHtml += '</div></div>';
    }
    
    // Labels
    if (details.labels && Object.keys(details.labels).length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.entries(details.labels).forEach(([key, value]) => {
            detailsHtml += `<span class="label-badge">${key}: ${value}</span>`;
        });
        detailsHtml += '</div></div>';
    }
    
    // Annotations
    if (details.annotations && Object.keys(details.annotations).length > 0) {
        detailsHtml += '<div class="info-section"><h4 class="section-title"><span class="section-icon">📝</span>Annotations</h4><div style="max-height: 200px; overflow-y: auto;">';
        Object.entries(details.annotations).forEach(([key, value]) => {
            detailsHtml += `<div style="padding: 4px 0; border-bottom: 1px solid var(--border-color); font-size: 0.85em;"><strong style="color: var(--text-secondary);">${key}:</strong> <span style="color: var(--text-primary); font-family: var(--font-mono); word-break: break-all;">${value}</span></div>`;
        });
        detailsHtml += '</div></div>';
    }
    
    return detailsHtml;
}

function toggleServiceDetails(serviceId) {
    const detailsRow = document.getElementById(`${serviceId}-details`);
    const icon = document.getElementById(`${serviceId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   CONFIGMAPS
   ============================================ */

async function loadConfigMaps() {
    const container = document.getElementById('configmapsContent');
    container.innerHTML = '<div class="loading">Loading config maps...</div>';

    try {
        const response = await fetch(`/api/configmaps/${nsForApi()}`);
        const data = await response.json();
        const configmaps = data.configmaps || [];

        if (configmaps.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><p>No configmaps found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.configMapsData = configmaps;
        renderConfigMapsTable(configmaps, container);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading configmaps</p><small>${error.message}</small></div>`;
    }
}

function renderConfigMapsTable(configmaps, container) {
    const totalKeys = configmaps.reduce((sum, cm) => sum + (cm.keys?.length || 0), 0);
    
    // Update stats in resource-controls
    const statsHtml = `
        <div class="resource-stats">
            <div class="stat-mini">
                <span class="stat-mini-value">${configmaps.length}</span>
                <span class="stat-mini-label">Total</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${totalKeys}</span>
                <span class="stat-mini-label">Keys</span>
            </div>
        </div>
    `;
    
    const controlsDiv = document.querySelector('#configmaps .resource-controls');
    if (controlsDiv) {
        const existingStats = controlsDiv.querySelector('.resource-stats');
        if (existingStats) existingStats.remove();
        controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
    }
    
    let html = `
        <table class="resource-table configmap-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Keys</th>
                    <th>Age</th>
                </tr>
            </thead>
            <tbody>
    `;

    configmaps.forEach((cm, idx) => {
        const keys = cm.keys || [];
        
        // Main row - clickable to open detail panel
        html += `
            <tr class="clickable-row" onclick="openDetailPanel('configmapsDetails', 'ConfigMap', '${cm.namespace}', '${cm.name}')">
                <td>📝 ${cm.name}</td>
                <td><span class="badge-info">${keys.length}</span></td>
                <td>${cm.age || '-'}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderConfigMapDetails(cm) {
    let detailsHtml = '<div class="ingress-details-grid">';
    
    // Keys section - show only key names, not values for security
    const keys = cm.keys || [];
    if (keys.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🔑 Configuration Keys</strong>
                    <span class="text-xs text-gray-500 dark:text-gray-400 ml-2">(values hidden for security)</span>
                </div>
                <div class="ingress-paths">
        `;
        
        keys.forEach(key => {
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">KEY</span>
                        <code>${key}</code>
                    </div>
                    <div class="path-backend">
                        <span class="text-muted">🔒 Value hidden</span>
                    </div>
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    detailsHtml += '</div>';
    return detailsHtml;
}

function toggleConfigMapDetails(configmapId) {
    const detailsRow = document.getElementById(`${configmapId}-details`);
    const icon = document.getElementById(`${configmapId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   SECRETS
   ============================================ */

async function loadSecrets() {
    const container = document.getElementById('secretsContent');
    container.innerHTML = '<div class="loading">Loading secrets...</div>';

    try {
        const response = await fetch(`/api/secrets/${nsForApi()}`);
        const data = await response.json();
        const secrets = data.secrets || [];

        if (secrets.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔐</div><p>No secrets found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.secretsData = secrets;
        renderSecretsTable(secrets, container);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading secrets</p><small>${error.message}</small></div>`;
    }
}

function renderSecretsTable(secrets, container) {
    const totalKeys = secrets.reduce((sum, s) => sum + ((s.keys && s.keys.length) || 0), 0);
    const tlsCount = secrets.filter(s => s.type && s.type.includes('tls')).length;
    
    // Update stats in resource-controls
    const statsHtml = `
        <div class="resource-stats">
            <div class="stat-mini">
                <span class="stat-mini-value">${secrets.length}</span>
                <span class="stat-mini-label">Total</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${totalKeys}</span>
                <span class="stat-mini-label">Keys</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${tlsCount}</span>
                <span class="stat-mini-label">TLS</span>
            </div>
        </div>
    `;
    
    const controlsDiv = document.querySelector('#secrets .resource-controls');
    if (controlsDiv) {
        const existingStats = controlsDiv.querySelector('.resource-stats');
        if (existingStats) existingStats.remove();
        controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
    }
    
    let html = `
        <table class="resource-table secret-table">
            <thead>
                <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Keys</th>
                    <th>Age</th>
                </tr>
            </thead>
            <tbody>
    `;

    secrets.forEach((sec, idx) => {
        const keys = sec.keys || [];
        
        // Main row - clickable to open detail panel
        html += `
            <tr class="clickable-row" onclick="openDetailPanel('secretsDetails', 'Secret', '${sec.namespace}', '${sec.name}')">
                <td>🔐 ${sec.name}</td>
                <td><span class="badge-secondary">${sec.type || 'Opaque'}</span></td>
                <td><span class="badge-info">${keys.length}</span></td>
                <td>${sec.age || '-'}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderSecretDetails(sec) {
    let detailsHtml = '<div class="ingress-details-grid">';
    
    // Keys section - don't show values for security
    const keys = sec.keys || [];
    if (keys.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🔑 Secret Keys (values hidden)</strong>
                </div>
                <div class="ingress-paths">
        `;
        
        keys.forEach(key => {
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">KEY</span>
                        <code>${key}</code>
                    </div>
                    <div class="path-backend">
                        <span class="text-muted">🔒 *****</span>
                    </div>
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    detailsHtml += '</div>';
    return detailsHtml;
}

function toggleSecretDetails(secretId) {
    const detailsRow = document.getElementById(`${secretId}-details`);
    const icon = document.getElementById(`${secretId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   PODS
   ============================================ */

// Pagination state for pods
let podsState = {
    allPods: [],
    loading: false
};

async function loadPods(reset = true, silent = false) {
    const container = document.getElementById('podsContent');
    const startTime = performance.now();
    
    // Reset state if requested
    if (reset) {
        podsState = {
            allPods: [],
            loading: false
        };
    }
    
    // Prevent concurrent loads
    if (podsState.loading) {
        console.log('⏸ Pod load already in progress');
        return;
    }
    
    podsState.loading = true;
    
    // Show loading with better feedback (only if not silent refresh)
    if (reset && !silent) {
        container.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading pods...</p><p class="loading-detail">Fetching data from Kubernetes API</p></div>';
    }

    try {
        // Fetch all pods (no pagination limit)
        const url = `/api/pods/${nsForApi()}`;
        
        const response = await safeFetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
        
        // Handle both old format (array) and new format (object with items)
        const pods = Array.isArray(data) ? data : (data.items || []);
        
        console.log(`✓ Loaded ${pods.length} pods in ${loadTime}s`);

        // Store all pods
        podsState.allPods = pods;
        podsState.loading = false;

        if (podsState.allPods.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>No pods found</p></div>';
            return;
        }

        const runningCount = podsState.allPods.filter(p => p.status === 'Running').length;
        const pendingCount = podsState.allPods.filter(p => p.status === 'Pending').length;
        const failedCount = podsState.allPods.filter(p => ['Failed', 'Error', 'CrashLoopBackOff', 'ImagePullBackOff'].includes(p.status)).length;
        const succeededCount = podsState.allPods.filter(p => ['Succeeded', 'Completed'].includes(p.status)).length;
        const totalRestarts = podsState.allPods.reduce((sum, p) => sum + (p.restart_count || 0), 0);
        
        // Update stats in resource-controls with clickable filters
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini clickable ${tableFilterState['pods']?.filterValue === 'all' ? 'active' : ''}" 
                     onclick="filterPodsByStatus('all')" 
                     title="Show all pods">
                    <span class="stat-mini-value">${podsState.allPods.length}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini clickable ${tableFilterState['pods']?.filterValue === 'Running' ? 'active' : ''}" 
                     onclick="filterPodsByStatus('Running')" 
                     title="Show running pods">
                    <span class="stat-mini-value">${runningCount}</span>
                    <span class="stat-mini-label">Running</span>
                </div>
                <div class="stat-mini clickable ${tableFilterState['pods']?.filterValue === 'Pending' ? 'active' : ''}" 
                     onclick="filterPodsByStatus('Pending')" 
                     title="Show pending pods">
                    <span class="stat-mini-value">${pendingCount}</span>
                    <span class="stat-mini-label">Pending</span>
                </div>
                <div class="stat-mini clickable ${tableFilterState['pods']?.filterValue === 'Failed' ? 'active' : ''}" 
                     onclick="filterPodsByStatus('Failed')" 
                     title="Show failed pods">
                    <span class="stat-mini-value">${failedCount}</span>
                    <span class="stat-mini-label">Failed</span>
                </div>
                <div class="stat-mini" title="Total restarts across all pods">
                    <span class="stat-mini-value">${totalRestarts}</span>
                    <span class="stat-mini-label">Restarts</span>
                </div>
                <div class="stat-mini" title="Load time">
                    <span class="stat-mini-value">${loadTime}s</span>
                    <span class="stat-mini-label">Load Time</span>
                </div>
            </div>
        `;
        
        const controlsDiv = document.querySelector('#pods .resource-controls');
        if (controlsDiv) {
            const existingStats = controlsDiv.querySelector('.resource-stats');
            if (existingStats) existingStats.remove();
            controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
        }

        // Store pods data for panel access
        window.podsData = podsState.allPods;

        // Render table
        container.innerHTML = `
            <table class="resource-table" id="podsTable">
                <thead>
                    <tr>
                        <th class="sortable" onclick="sortTable('pods', '#podsTable', 0, 'string')">
                            Name<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('pods', '#podsTable', 1, 'string')">
                            Status<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('pods', '#podsTable', 2, 'number')">
                            Ready<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('pods', '#podsTable', 3, 'number')">
                            Restarts<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('pods', '#podsTable', 4, 'string')">
                            Pod IP<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('pods', '#podsTable', 5, 'string')">
                            Node<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('pods', '#podsTable', 6, 'age')">
                            Age<span class="sort-icon"></span>
                        </th>
                        <th>Status Details</th>
                    </tr>
                </thead>
                <tbody id="podsTableBody">
                    ${podsState.allPods.map((pod, idx) => {
                        const statusDetails = pod.status_details || 'OK';
                        const isError = statusDetails.includes('Error') || statusDetails.includes('Failed') || statusDetails.includes('exit code');
                        const detailsClass = isError ? 'badge-danger' : statusDetails === 'OK' ? 'badge-success' : 'badge-warning';
                        
                        // Determine status badge color based on both status and readiness
                        let statusBadgeClass = 'badge-secondary';
                        if (pod.status === 'Running') {
                            // Running but not all containers ready = warning (0/1 scenario)
                            statusBadgeClass = (pod.ready_containers === pod.total_containers) ? 'badge-success' : 'badge-warning';
                        } else if (['Succeeded', 'Completed'].includes(pod.status)) {
                            statusBadgeClass = 'badge-info';
                        } else if (pod.status === 'Pending') {
                            statusBadgeClass = 'badge-warning';
                        } else if (['Failed', 'Error', 'CrashLoopBackOff', 'ImagePullBackOff'].includes(pod.status)) {
                            statusBadgeClass = 'badge-danger';
                        }
                        
                        return `
                        <tr class="clickable-row" onclick="openDetailPanel('podsDetails', 'Pod', '${pod.namespace}', '${pod.name}')">
                            <td>📦 ${pod.name || 'N/A'}</td>
                            <td><span class="badge ${statusBadgeClass}">${pod.status || 'Unknown'}</span></td>
                            <td>${pod.ready_containers || 0}/${pod.total_containers || 0}</td>
                            <td><span class="badge-${(pod.restart_count || 0) > 5 ? 'danger' : 'secondary'}">${pod.restart_count || 0}</span></td>
                            <td><span class="badge-info">${pod.ip || 'N/A'}</span></td>
                            <td>${pod.node || 'N/A'}</td>
                            <td>${pod.age || 'N/A'}</td>
                            <td><span class="${detailsClass}" style="font-size: 0.85em; max-width: 300px; display: inline-block; word-wrap: break-word;">${statusDetails}</span></td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        `;

        // Remove any existing filter indicators first
        const existingIndicators = document.querySelectorAll('.dash-filter-indicator');
        existingIndicators.forEach(ind => ind.remove());

        // Apply dashboard filter if navigated from dashboard
        if (window._podStatusFilter === 'unhealthy') {
            window._podStatusFilter = null;
            const rows = container.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                const statusText = cells[1]?.querySelector('.badge')?.textContent.trim() || '';
                const readyText  = cells[2]?.textContent.trim() || ''; // e.g. "2/2" or "0/2"
                const [readyN, totalN] = readyText.split('/').map(Number);
                const notReady = !isNaN(readyN) && !isNaN(totalN) && readyN < totalN;
                const isHealthy = (statusText === 'Running' && !notReady)
                               || statusText === 'Succeeded'
                               || statusText === 'Completed';
                row.style.display = isHealthy ? 'none' : '';
            });
            // Show a filter indicator
            const indicator = document.createElement('div');
            indicator.className = 'dash-filter-indicator';
            indicator.innerHTML = `Showing unhealthy pods only · <span onclick="clearPodFilter()" style="cursor:pointer;text-decoration:underline">Clear filter</span>`;
            container.insertAdjacentElement('beforebegin', indicator);
        }
        
        // Apply job filter if navigated from Jobs tab or Deployments tab
        if (window.targetPodFilter) {
            const filterName = window.targetPodFilter;
            window.targetPodFilter = null; // Clear after using
            
            const rows = container.querySelectorAll('tbody tr');
            let visibleCount = 0;
            rows.forEach(row => {
                const podNameCell = row.querySelector('td:first-child');
                const podName = podNameCell?.textContent.replace('📦 ', '').trim() || '';
                // Pods created by jobs/deployments have names like "name-xxxxx" or "name-xxxxx-xxxxx"
                // Match pods that start with the filter name
                if (podName.startsWith(filterName + '-')) {
                    row.style.display = '';
                    visibleCount++;
                } else {
                    row.style.display = 'none';
                }
            });
            
            // Show a filter indicator
            const indicator = document.createElement('div');
            indicator.className = 'dash-filter-indicator';
            indicator.innerHTML = `Showing pods for <strong>${filterName}</strong> (${visibleCount} pod${visibleCount !== 1 ? 's' : ''}) · <span onclick="clearPodFilter()" style="cursor:pointer;text-decoration:underline">Clear filter</span>`;
            container.insertAdjacentElement('beforebegin', indicator);
            
            // Scroll to first visible row
            setTimeout(() => {
                const firstVisibleRow = container.querySelector('tbody tr:not([style*="display: none"])');
                if (firstVisibleRow) {
                    firstVisibleRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
        
        // Setup auto-refresh for pods (30s - HIGH priority)
        // Only setup on initial load, not on "Load More" pagination
        if (reset && !silent) {
            setupAutoRefresh('pods', () => {
                if (currentTab === 'pods') {
                    console.log('⟳ Auto-refreshing pods...');
                    loadPods(true, true); // Silent refresh - no loading spinner
                }
            });
        }
    } catch (error) {
        console.error('Error loading pods:', error);
        podsState.loading = false;
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading pods</p><small>${error.message}</small></div>`;
    }
}

function clearPodFilter() {
    // Restore all hidden pod rows and remove indicator
    const indicator = document.querySelector('.dash-filter-indicator');
    if (indicator) indicator.remove();
    const rows = document.querySelectorAll('#podsContent tbody tr');
    rows.forEach(r => r.style.display = '');
    
    // Clear the global filter variable
    window.targetPodFilter = null;
    window._podStatusFilter = null;
    
    // Clear filter state and remove active class from stat cards
    if (tableFilterState['pods']) {
        tableFilterState['pods'] = { filterType: null, filterValue: null };
    }
    document.querySelectorAll('#pods .stat-mini.clickable').forEach(card => {
        card.classList.remove('active');
    });
}

// Filter Pods by status (stat card filter)
function filterPodsByStatus(status) {
    if (status === 'all') {
        // Clear filter
        clearPodFilter();
        return;
    }
    
    const table = document.querySelector('#podsTable');
    if (!table) return;
    
    // Update filter state
    if (!tableFilterState['pods']) {
        tableFilterState['pods'] = {};
    }
    tableFilterState['pods'] = { filterType: 'status', filterValue: status };
    
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const statusBadge = row.querySelector('td:nth-child(2) .badge');
        if (!statusBadge) {
            row.style.display = 'none';
            return;
        }
        
        const podStatus = statusBadge.textContent.trim();
        let shouldShow = false;
        
        if (status === 'Running') {
            shouldShow = podStatus === 'Running';
        } else if (status === 'Pending') {
            shouldShow = podStatus === 'Pending';
        } else if (status === 'Failed') {
            shouldShow = ['Failed', 'Error', 'CrashLoopBackOff', 'ImagePullBackOff'].includes(podStatus);
        } else if (status === 'Succeeded') {
            shouldShow = ['Succeeded', 'Completed'].includes(podStatus);
        }
        
        row.style.display = shouldShow ? '' : 'none';
    });
    
    // Update active state on stat cards
    document.querySelectorAll('#pods .stat-mini.clickable').forEach(card => {
        card.classList.remove('active');
    });
    event.target.closest('.stat-mini')?.classList.add('active');
}

/* ============================================
   DEPLOYMENTS
   ============================================ */

async function loadDeployments(silent = false) {
    const container = document.getElementById('deploymentsContent');
    const startTime = performance.now();
    if (!silent) {
        container.innerHTML = '<div class="loading"><div class="loading-spinner"></div><p>Loading deployments...</p></div>';
    }

    try {
        // Always fetch deployments, but reuse services if recently loaded (within 2 minutes)
        const shouldFetchServices = !window.servicesData || 
                                    !window.servicesData.items || 
                                    !window.servicesData.lastLoaded || 
                                    (Date.now() - window.servicesData.lastLoaded) > 120000; // 2 minutes
        
        const fetchPromises = [safeFetch(`/api/deployments/${nsForApi()}`)];
        if (shouldFetchServices) {
            fetchPromises.push(safeFetch(`/api/services/${nsForApi()}`));
        }
        
        const responses = await Promise.all(fetchPromises);
        const deploymentsResponse = responses[0];
        const servicesResponse = responses[1]; // undefined if not fetched

        if (!deploymentsResponse.ok) {
            throw new Error(`HTTP ${deploymentsResponse.status}: ${deploymentsResponse.statusText}`);
        }

        const deploymentsData = await deploymentsResponse.json();
        const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
        
        // Handle both old format (array) and new format (object with items)
        const deployments = Array.isArray(deploymentsData) ? deploymentsData : (deploymentsData.items || []);
        console.log(`✓ Loaded ${deployments.length} deployments in ${loadTime}s`);
        
        // Debug: Check first deployment structure
        if (deployments.length > 0) {
            console.log('First deployment data:', deployments[0]);
        }

        // Load services data for "Exposed By" column matching (if fetched or reused)
        if (servicesResponse && servicesResponse.ok) {
            const servicesData = await servicesResponse.json();
            // Store in consistent format with items array and timestamp
            window.servicesData = {
                items: servicesData.items ? servicesData.items : (Array.isArray(servicesData) ? servicesData : [servicesData]),
                lastLoaded: Date.now()
            };
            console.log(`✓ Loaded ${window.servicesData.items?.length || 0} services for deployment matching`);
        } else if (!shouldFetchServices) {
            const age = Math.round((Date.now() - window.servicesData.lastLoaded) / 1000);
            console.log(`✓ Reusing ${window.servicesData.items?.length || 0} cached services (${age}s old)`);
        } else {
            console.warn('Failed to load services for deployment matching');
            window.servicesData = { items: [], lastLoaded: Date.now() };
        }

        if (deployments.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏗️</div><p>No deployments found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.deploymentsData = deployments;
        renderDeploymentsTable(deployments, container, loadTime);
        
        // Setup auto-refresh for deployments (60s based on MEDIUM priority)
        if (!silent) {
            setupAutoRefresh('deployments', () => {
                if (currentTab === 'deployments') {
                    console.log('⟳ Auto-refreshing deployments...');
                    loadDeployments(true); // Silent refresh - no loading spinner
                }
            });
        }
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading deployments</p><small>${error.message}</small></div>`;
    }
}

function renderDeploymentsTable(deployments, container, loadTime = '') {
    const readyCount = deployments.filter(d => (d.ready_replicas || 0) === (d.desired_replicas || 0) && (d.desired_replicas || 0) > 0).length;
    const notReadyCount = deployments.filter(d => (d.ready_replicas || 0) !== (d.desired_replicas || 0) || (d.desired_replicas || 0) === 0).length;
    const totalReplicas = deployments.reduce((sum, d) => sum + (d.desired_replicas || 0), 0);
    
    // Update stats in resource-controls with clickable filters
    const statsHtml = `
        <div class="resource-stats">
            <div class="stat-mini clickable ${tableFilterState['deployments']?.filterValue === 'all' ? 'active' : ''}" 
                 onclick="filterDeploymentsByStatus('all')" 
                 title="Show all deployments">
                <span class="stat-mini-value">${deployments.length}</span>
                <span class="stat-mini-label">Total</span>
            </div>
            <div class="stat-mini clickable ${tableFilterState['deployments']?.filterValue === 'ready' ? 'active' : ''}" 
                 onclick="filterDeploymentsByStatus('ready')" 
                 title="Show ready deployments">
                <span class="stat-mini-value">${readyCount}</span>
                <span class="stat-mini-label">Ready</span>
            </div>
            <div class="stat-mini clickable ${tableFilterState['deployments']?.filterValue === 'notready' ? 'active' : ''}" 
                 onclick="filterDeploymentsByStatus('notready')" 
                 title="Show progressing deployments">
                <span class="stat-mini-value">${notReadyCount}</span>
                <span class="stat-mini-label">Progressing</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${totalReplicas}</span>
                <span class="stat-mini-label">Replicas</span>
            </div>
            ${loadTime ? `<div class="stat-mini" title="Load time"><span class="stat-mini-value">${loadTime}s</span><span class="stat-mini-label">Load Time</span></div>` : ''}
        </div>
    `;
    
    const controlsDiv = document.querySelector('#deployments .resource-controls');
    if (controlsDiv) {
        const existingStats = controlsDiv.querySelector('.resource-stats');
        if (existingStats) existingStats.remove();
        controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
    }
    
    let html = `
        <table class="resource-table deployment-table">
            <thead>
                <tr>
                    <th class="sortable" onclick="sortTable('deployments', '.deployment-table', 0, 'string')">
                        Name<span class="sort-icon"></span>
                    </th>
                    <th class="sortable" onclick="sortTable('deployments', '.deployment-table', 1, 'number')">
                        Replicas<span class="sort-icon"></span>
                    </th>
                    <th class="sortable" onclick="sortTable('deployments', '.deployment-table', 2, 'number')">
                        Updated<span class="sort-icon"></span>
                    </th>
                    <th class="sortable" onclick="sortTable('deployments', '.deployment-table', 3, 'number')">
                        Available<span class="sort-icon"></span>
                    </th>
                    <th class="sortable" onclick="sortTable('deployments', '.deployment-table', 4, 'string')">
                        Status<span class="sort-icon"></span>
                    </th>
                    <th>View Pods</th>
                    <th>Exposed By (Services)</th>
                </tr>
            </thead>
            <tbody>
    `;

    deployments.forEach((dep, idx) => {
        const desiredReplicas = dep.desired_replicas || 0;
        const readyReplicas = dep.ready_replicas || 0;
        const totalPods = desiredReplicas;
        
        // Determine status: scaled down (0/0), ready (matching and > 0), or progressing
        let status, statusBadge;
        if (desiredReplicas === 0) {
            status = 'Scaled Down';
            statusBadge = 'scaled';  // Orange badge for scaled down
        } else if (readyReplicas === desiredReplicas) {
            status = 'Ready';
            statusBadge = 'success';
        } else {
            status = 'Progressing';
            statusBadge = 'warning';
        }
        
        // Debug: Log totalPods calculation for first deployment
        if (idx === 0) {
            console.log('First deployment View Pods debug:', {
                name: dep.name,
                desired_replicas: dep.desired_replicas,
                totalPods: totalPods,
                ready_replicas: dep.ready_replicas
            });
        }
        
        // Find services exposing this deployment (matching selectors with pod labels)
        let exposedBy = [];
        if (window.servicesData && window.servicesData.items && dep.pod_labels) {
            exposedBy = window.servicesData.items.filter(svc => {
                // Must be in same namespace
                if (svc.namespace !== dep.namespace) return false;
                
                // Service must have a selector
                if (!svc.selector || Object.keys(svc.selector).length === 0) return false;
                
                // Check if all service selector labels match deployment pod labels
                return Object.entries(svc.selector).every(([key, value]) => {
                    return dep.pod_labels[key] === value;
                });
            });
        }
        
        // Debug logging for first 2 deployments
        if (idx < 2) {
            console.log(`Deployment ${idx + 1}: ${dep.name}`, {
                namespace: dep.namespace,
                pod_labels: dep.pod_labels,
                services_available: window.servicesData?.items?.length || 0,
                matches_found: exposedBy.length
            });
            
            if (window.servicesData?.items?.length > 0 && idx === 0) {
                console.log('First service sample:', {
                    name: window.servicesData.items[0].name,
                    namespace: window.servicesData.items[0].namespace,
                    selector: window.servicesData.items[0].selector
                });
            }
            
            if (exposedBy.length > 0) {
                console.log('Matched service:', exposedBy[0]);
            }
        }
        
        // View Pods button
        const viewPodsHtml = totalPods > 0 
            ? `<button class="btn-secondary" style="font-size: 0.75em; padding: 4px 8px;" onclick="event.stopPropagation(); navigateToPodsForDeployment('${dep.namespace}', '${dep.name}')" title="View pods for this deployment">📦 ${totalPods} pod${totalPods > 1 ? 's' : ''}</button>`
            : '<span class="text-muted">No pods</span>';
        
        // Exposed By services
        let exposedByHtml = '<span class="text-muted">-</span>';
        if (exposedBy.length > 0) {
            const firstSvc = exposedBy[0];
            const moreCount = exposedBy.length - 1;
            exposedByHtml = `<span class="badge-info clickable-badge" onclick="event.stopPropagation(); navigateToService('${firstSvc.namespace}', '${firstSvc.name}')" title="View service">🌐 ${firstSvc.name}</span>`;
            if (moreCount > 0) {
                exposedByHtml += ` <span class="text-muted">+${moreCount}</span>`;
            }
        }
        
        // Main row - clickable to open detail panel
        html += `
            <tr class="clickable-row" onclick="openDetailPanel('deploymentsDetails', 'Deployment', '${dep.namespace}', '${dep.name}')">
                <td>🏗️ ${dep.name || 'Unknown'}</td>
                <td><span class="badge-${statusBadge}">${readyReplicas}/${desiredReplicas}</span></td>
                <td><span class="badge-info">${dep.updated_replicas || 0}</span></td>
                <td><span class="badge-info">${dep.available_replicas || 0}</span></td>
                <td><span class="badge-${statusBadge}">${status}</span></td>
                <td>${viewPodsHtml}</td>
                <td>${exposedByHtml}</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

// Filter Deployments by status (stat card filter)
function filterDeploymentsByStatus(status) {
    if (status === 'all') {
        // Clear filter
        const table = document.querySelector('.deployment-table');
        if (table) {
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => row.style.display = '');
        }
        // Clear filter state
        if (tableFilterState['deployments']) {
            tableFilterState['deployments'] = { filterType: null, filterValue: null };
        }
        document.querySelectorAll('#deployments .stat-mini.clickable').forEach(card => {
            card.classList.remove('active');
        });
        return;
    }
    
    const table = document.querySelector('.deployment-table');
    if (!table) return;
    
    // Update filter state
    if (!tableFilterState['deployments']) {
        tableFilterState['deployments'] = {};
    }
    tableFilterState['deployments'] = { filterType: 'status', filterValue: status };
    
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const replicasCell = row.querySelector('td:nth-child(2)');
        if (!replicasCell) {
            row.style.display = 'none';
            return;
        }
        
        const replicasText = replicasCell.textContent.trim();
        const match = replicasText.match(/(\d+)\/(\d+)/);
        if (!match) {
            row.style.display = 'none';
            return;
        }
        
        const ready = match[1];
        const total = match[2];
        const isReady = ready === total && parseInt(total) > 0;
        
        let shouldShow = false;
        if (status === 'ready') {
            shouldShow = isReady;
        } else if (status === 'notready') {
            shouldShow = !isReady;
        }
        
        row.style.display = shouldShow ? '' : 'none';
    });
    
    // Update active state on stat cards
    document.querySelectorAll('#deployments .stat-mini.clickable').forEach(card => {
        card.classList.remove('active');
    });
    event.target.closest('.stat-mini')?.classList.add('active');
}

// Navigation: Jump to Pods tab filtered by deployment
function navigateToPodsForDeployment(namespace, deploymentName) {
    console.log(`Navigating to Pods for deployment: ${namespace}/${deploymentName}`);
    
    // Store the deployment name to filter pods
    window.targetPodFilter = deploymentName;
    
    // Clear cache to force reload with new filter
    delete tabDataCache['pods'];
    
    // Switch to Pods tab (this will trigger loadPods)
    selectTab(null, 'pods');
}

// Navigation: Jump to Services tab and show specific service
function navigateToService(namespace, serviceName) {
    console.log(`Navigating to Service: ${namespace}/${serviceName}`);
    
    // Don't clear cache - use existing data for faster navigation
    // delete tabDataCache['services'];  // Removed to avoid redundant fetch
    
    // Switch to Services tab
    const servicesTab = document.querySelector('[data-tab="services"]');
    if (servicesTab) {
        servicesTab.click();
        
        // Wait for the tab to load, then filter by service name
        setTimeout(() => {
            const searchInput = document.getElementById('serviceSearchFilter');
            if (searchInput) {
                searchInput.value = serviceName;
                filterTable('services');
                
                // Optionally scroll to the filtered service
                const servicesContent = document.getElementById('servicesContent');
                if (servicesContent) {
                    servicesContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        }, 300);
    }
}

// Navigation: Jump to Endpoints tab and filter by name
function navigateToEndpoints(namespace, endpointName) {
    console.log(`Navigating to Endpoints: ${namespace}/${endpointName}`);
    
    // Don't clear cache - use existing data for faster navigation
    // delete tabDataCache['endpoints'];  // Removed to avoid redundant fetch
    
    // Switch to Endpoints tab (no search filter available in endpoints tab)
    const endpointsTab = document.querySelector('[data-tab="endpoints"]');
    if (endpointsTab) {
        endpointsTab.click();
        
        // Scroll to the endpoints content
        setTimeout(() => {
            const endpointsContent = document.getElementById('endpointsContent');
            if (endpointsContent) {
                endpointsContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 300);
    }
}

// Navigation: Jump to Deployments tab and filter by name
function navigateToDeployments(namespace, deploymentName) {
    console.log(`Navigating to Deployment: ${namespace}/${deploymentName}`);
    
    // Don't clear cache - use existing data for faster navigation
    // delete tabDataCache['deployments'];  // Removed to avoid redundant fetch
    
    // Switch to Deployments tab
    const deploymentsTab = document.querySelector('[data-tab="deployments"]');
    if (deploymentsTab) {
        deploymentsTab.click();
        
        // Wait for the tab to load, then filter by deployment name
        setTimeout(() => {
            const searchInput = document.getElementById('deploymentSearchFilter');
            if (searchInput) {
                searchInput.value = deploymentName;
                filterTable('deployments');
                
                const deploymentsContent = document.getElementById('deploymentsContent');
                if (deploymentsContent) {
                    deploymentsContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        }, 300);
    }
}

// Navigation: Jump to Ingresses tab and filter by name
function navigateToIngresses(namespace, ingressName) {
    console.log(`Navigating to Ingress: ${namespace}/${ingressName}`);
    
    // Don't clear cache - use existing data for faster navigation
    // delete tabDataCache['ingresses'];  // Removed to avoid redundant fetch
    
    // Switch to Ingresses tab
    const ingressesTab = document.querySelector('[data-tab="ingresses"]');
    if (ingressesTab) {
        ingressesTab.click();
        
        // Wait for the tab to load, then filter by ingress name
        setTimeout(() => {
            const searchInput = document.getElementById('ingressSearchFilter');
            if (searchInput) {
                searchInput.value = ingressName;
                filterTable('ingresses');
                
                const ingressesContent = document.getElementById('ingressesContent');
                if (ingressesContent) {
                    ingressesContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        }, 300);
    }
}

function renderDeploymentDetails(dep) {
    let detailsHtml = '<div class="ingress-details-grid">';
    
    // Handle both list API structure and detail API structure
    const details = dep.details || dep;
    const desiredReplicas = dep.desired_replicas || details.replicas_desired;
    const readyReplicas = dep.ready_replicas || details.replicas_ready;
    const availableReplicas = dep.available_replicas || details.replicas_available;
    const updatedReplicas = dep.updated_replicas || details.replicas_updated;
    const containers = details.containers || [];
    
    // Extract images and resources from containers if not in flat structure
    let images = dep.images || [];
    let resources = dep.resources || [];
    if (images.length === 0 && containers.length > 0) {
        images = containers.map(c => c.image);
    }
    if (resources.length === 0 && containers.length > 0) {
        resources = containers.map(c => ({
            name: c.name,
            requests: c.resources?.requests,
            limits: c.resources?.limits
        })).filter(r => r.requests || r.limits);
    }
    
    // Status Overview with Health Score
    detailsHtml += `
        <div class="ingress-rule-card">
            <div class="ingress-rule-header">
                <strong>${dep.status_emoji || '📊'} Status Overview</strong>
            </div>
            <div class="info-grid" style="padding: 12px;">
    `;
    
    if (dep.health_score !== undefined) {
        const healthClass = dep.health_score >= 80 ? 'success' : dep.health_score >= 50 ? 'warning' : 'danger';
        detailsHtml += `
            <div class="info-item">
                <label class="info-label">Health Score</label>
                <span class="info-value"><span class="badge-${healthClass}">${dep.health_score}%</span></span>
            </div>
        `;
    }
    
    if (dep.status) {
        detailsHtml += `
            <div class="info-item">
                <label class="info-label">Status</label>
                <span class="info-value">${dep.status}</span>
            </div>
        `;
    }
    
    // Replica counts
    if (desiredReplicas !== undefined) {
        detailsHtml += `
            <div class="info-item">
                <label class="info-label">Desired Replicas</label>
                <span class="info-value">${desiredReplicas}</span>
            </div>
        `;
    }
    if (readyReplicas !== undefined) {
        detailsHtml += `
            <div class="info-item">
                <label class="info-label">Ready Replicas</label>
                <span class="info-value">${readyReplicas}</span>
            </div>
        `;
    }
    if (availableReplicas !== undefined) {
        detailsHtml += `
            <div class="info-item">
                <label class="info-label">Available Replicas</label>
                <span class="info-value">${availableReplicas}</span>
            </div>
        `;
    }
    if (updatedReplicas !== undefined) {
        detailsHtml += `
            <div class="info-item">
                <label class="info-label">Updated Replicas</label>
                <span class="info-value">${updatedReplicas}</span>
            </div>
        `;
    }
    
    detailsHtml += '</div></div>';
    
    // Container Images section
    if (images && images.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🐳 Container Images</strong>
                </div>
                <div class="ingress-paths">
        `;
        
        images.forEach(image => {
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <code>${image}</code>
                    </div>
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    // Container Resources (CPU/Memory)
    if (resources && resources.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>💾 Container Resources</strong>
                </div>
                <div style="padding: 12px;">
        `;
        
        resources.forEach((resource, idx) => {
            detailsHtml += `<div style="margin-bottom: 12px; ${idx > 0 ? 'border-top: 1px solid var(--border-color); padding-top: 12px;' : ''}">`;
            detailsHtml += `<div style="font-weight: 600; color: var(--text-primary); margin-bottom: 6px;">${resource.name}</div>`;
            detailsHtml += '<div class="info-grid">';
            
            if (resource.requests) {
                detailsHtml += `
                    <div class="info-item">
                        <label class="info-label">CPU Requests</label>
                        <span class="info-value"><code>${resource.requests.cpu || '0'}</code></span>
                    </div>
                    <div class="info-item">
                        <label class="info-label">Memory Requests</label>
                        <span class="info-value"><code>${resource.requests.memory || '0'}</code></span>
                    </div>
                `;
            }
            
            if (resource.limits) {
                detailsHtml += `
                    <div class="info-item">
                        <label class="info-label">CPU Limits</label>
                        <span class="info-value"><code>${resource.limits.cpu || '∞'}</code></span>
                    </div>
                    <div class="info-item">
                        <label class="info-label">Memory Limits</label>
                        <span class="info-value"><code>${resource.limits.memory || '∞'}</code></span>
                    </div>
                `;
            }
            
            detailsHtml += '</div></div>';
        });
        
        detailsHtml += '</div></div>';
    }
    
    // Update Strategy section
    const strategy = dep.strategy || details.strategy;
    if (strategy) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>📋 Update Strategy</strong>
                </div>
                <div class="info-grid" style="padding: 12px;">
        `;
        
        if (typeof strategy === 'string') {
            detailsHtml += `
                <div class="info-item">
                    <label class="info-label">Type</label>
                    <span class="info-value">${strategy}</span>
                </div>
            `;
        } else {
            if (strategy.type) {
                detailsHtml += `
                    <div class="info-item">
                        <label class="info-label">Type</label>
                        <span class="info-value">${strategy.type}</span>
                    </div>
                `;
            }
            if (strategy.max_surge) {
                detailsHtml += `
                    <div class="info-item">
                        <label class="info-label">Max Surge</label>
                        <span class="info-value">${strategy.max_surge}</span>
                    </div>
                `;
            }
            if (strategy.max_unavailable) {
                detailsHtml += `
                    <div class="info-item">
                        <label class="info-label">Max Unavailable</label>
                        <span class="info-value">${strategy.max_unavailable}</span>
                    </div>
                `;
            }
        }
        
        detailsHtml += '</div></div>';
    }
    
    // Conditions section (from detail API)
    if (details.conditions && details.conditions.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>⚡ Conditions</strong>
                </div>
                <div class="info-grid" style="padding: 12px;">
        `;
        
        details.conditions.forEach(condition => {
            const statusClass = condition.status === 'True' ? 'success' : condition.status === 'False' ? 'danger' : 'warning';
            detailsHtml += `
                <div class="info-item">
                    <label class="info-label">${condition.type}</label>
                    <span class="info-value"><span class="badge-${statusClass}">${condition.status}</span></span>
                </div>
            `;
            if (condition.message) {
                detailsHtml += `
                    <div class="info-item" style="grid-column: 1 / -1;">
                        <span class="info-value" style="font-size: 0.9em; color: var(--text-secondary);">${condition.message}</span>
                    </div>
                `;
            }
        });
        
        detailsHtml += '</div></div>';
    }
    
    // Selector section (from detail API)
    if (details.selector && Object.keys(details.selector).length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🎯 Pod Selector</strong>
                </div>
                <div class="labels-container" style="padding: 12px;">
        `;
        
        Object.entries(details.selector).forEach(([key, value]) => {
            detailsHtml += `<span class="label-badge">${key}: ${value}</span>`;
        });
        
        detailsHtml += '</div></div>';
    }
    
    detailsHtml += '</div>';
    return detailsHtml;
}

function toggleDeploymentDetails(deploymentId) {
    const detailsRow = document.getElementById(`${deploymentId}-details`);
    const icon = document.getElementById(`${deploymentId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   HEALTH DASHBOARD
   ============================================ */

async function loadHealth() {
    const container = document.getElementById('healthResults');
    container.innerHTML = '<div class="loading">Analyzing cluster health...</div>';

    try {
        const response = await fetch(`/api/health/${nsForApi()}`);
        const data = await response.json();

        // Calculate percentages
        const podCount = data.pod_count || 0;
        const podReady = data.pod_running || 0;
        const podUnhealthy = podCount - podReady;
        const podPercentage = podCount > 0 ? Math.round((podReady / podCount) * 100) : 0;
        
        const deploymentCount = data.deployment_count || 0;
        const deploymentHealthy = data.deployment_health?.healthy || 0;
        const deploymentUnhealthy = deploymentCount - deploymentHealthy;
        const deploymentPercentage = deploymentCount > 0 ? Math.round((deploymentHealthy / deploymentCount) * 100) : 0;
        
        const nodeCount = data.summary?.nodes || 0;
        const nodeReady = data.summary?.nodes_ready || nodeCount;
        const nodeUnhealthy = nodeCount - nodeReady;
        const nodePercentage = nodeCount > 0 ? Math.round((nodeReady / nodeCount) * 100) : 100;
        
        const podRunning = data.pod_running || 0;
        const podPending = data.pod_pending || 0;
        const podFailed = data.pod_failed || 0;
        
        const deploymentDegraded = data.deployment_health?.degraded || 0;
        const deploymentCritical = data.deployment_health?.critical || 0;
        
        const servicesWithEndpoints = data.service_health?.with_endpoints || 0;
        const servicesNoEndpoints = data.service_health?.without_endpoints || 0;

        let html = '';

        // === PRIMARY METRICS - Circular Progress Indicators ===
        html += `
            <div class="health-primary-metrics">
                <div class="circular-metric">
                    <div class="circular-progress ${podPercentage >= 80 ? 'status-healthy' : podPercentage >= 50 ? 'status-warning' : 'status-critical'}" data-percentage="${podPercentage}">
                        <svg class="circular-svg" width="120" height="120">
                            <circle class="circular-bg" cx="60" cy="60" r="50"/>
                            <circle class="circular-bar" cx="60" cy="60" r="50" 
                                style="stroke-dashoffset: ${314 - (314 * podPercentage) / 100};"/>
                        </svg>
                        <div class="circular-text">
                            <div class="circular-value">${podCount}</div>
                        </div>
                    </div>
                    <div class="circular-label">Pods</div>
                    <div class="circular-breakdown">
                        <div class="breakdown-item success"><span class="dot"></span><span class="count">${podReady}</span></div>
                        <div class="breakdown-item danger"><span class="dot"></span><span class="count">${podUnhealthy}</span></div>
                    </div>
                </div>
                
                <div class="circular-metric">
                    <div class="circular-progress ${deploymentPercentage >= 80 ? 'status-healthy' : deploymentPercentage >= 50 ? 'status-warning' : 'status-critical'}" data-percentage="${deploymentPercentage}">
                        <svg class="circular-svg" width="120" height="120">
                            <circle class="circular-bg" cx="60" cy="60" r="50"/>
                            <circle class="circular-bar" cx="60" cy="60" r="50" 
                                style="stroke-dashoffset: ${314 - (314 * deploymentPercentage) / 100};"/>
                        </svg>
                        <div class="circular-text">
                            <div class="circular-value">${deploymentCount}</div>
                        </div>
                    </div>
                    <div class="circular-label">Deployments</div>
                    <div class="circular-breakdown">
                        <div class="breakdown-item success"><span class="dot"></span><span class="count">${deploymentHealthy}</span></div>
                        <div class="breakdown-item danger"><span class="dot"></span><span class="count">${deploymentUnhealthy}</span></div>
                    </div>
                </div>
                
                <div class="circular-metric">
                    <div class="circular-progress ${nodePercentage >= 80 ? 'status-healthy' : nodePercentage >= 50 ? 'status-warning' : 'status-critical'}" data-percentage="${nodePercentage}">
                        <svg class="circular-svg" width="120" height="120">
                            <circle class="circular-bg" cx="60" cy="60" r="50"/>
                            <circle class="circular-bar" cx="60" cy="60" r="50" 
                                style="stroke-dashoffset: ${314 - (314 * nodePercentage) / 100};"/>
                        </svg>
                        <div class="circular-text">
                            <div class="circular-value">${nodeCount}</div>
                        </div>
                    </div>
                    <div class="circular-label">Nodes</div>
                    <div class="circular-breakdown">
                        <div class="breakdown-item success"><span class="dot"></span><span class="count">${nodeReady}</span></div>
                        <div class="breakdown-item danger"><span class="dot"></span><span class="count">${nodeUnhealthy}</span></div>
                    </div>
                </div>
            </div>
        `;

        // === RESOURCE COUNTS GRID ===
        const statefulSets = data.summary?.statefulsets || 0;
        const statefulSetsReady = data.summary?.statefulsets_ready || 0;
        const daemonSets = data.summary?.daemonsets || 0;
        const daemonSetsReady = data.summary?.daemonsets_ready || 0;
        const services = data.service_count || 0;
        const ingresses = data.ingress_count || 0;
        const jobs = data.summary?.jobs || 0;
        const jobsSucceeded = data.summary?.jobs_succeeded || 0;
        const cronJobs = data.summary?.cronjobs || 0;
        const cronJobsSuspended = data.summary?.cronjobs_suspended || 0;
        
        html += `
            <div class="health-resources-grid">
                <div class="health-resource-item">
                    <div class="health-resource-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="3" width="20" height="18" rx="2"/>
                            <path d="M2 9h20M9 21V9"/>
                        </svg>
                    </div>
                    <div class="health-resource-count">${statefulSets}</div>
                    <div class="health-resource-label">StatefulSets</div>
                    <div class="health-resource-status">${statefulSetsReady} ready</div>
                </div>
                
                <div class="health-resource-item">
                    <div class="health-resource-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                        </svg>
                    </div>
                    <div class="health-resource-count">${daemonSets}</div>
                    <div class="health-resource-label">DaemonSets</div>
                    <div class="health-resource-status">${daemonSetsReady} ready</div>
                </div>
                
                <div class="health-resource-item">
                    <div class="health-resource-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
                        </svg>
                    </div>
                    <div class="health-resource-count">${services}</div>
                    <div class="health-resource-label">Services</div>
                    <div class="health-resource-status">&nbsp;</div>
                </div>
                
                <div class="health-resource-item">
                    <div class="health-resource-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M2 7l4.41-4.41A2 2 0 017.83 2h8.34a2 2 0 011.42.59L22 7M2 17l4.41 4.41A2 2 0 007.83 22h8.34a2 2 0 001.42-.59L22 17M2 12h20"/>
                        </svg>
                    </div>
                    <div class="health-resource-count">${ingresses}</div>
                    <div class="health-resource-label">Ingresses</div>
                    <div class="health-resource-status">&nbsp;</div>
                </div>
                
                <div class="health-resource-item">
                    <div class="health-resource-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>
                        </svg>
                    </div>
                    <div class="health-resource-count">${jobs}</div>
                    <div class="health-resource-label">Jobs</div>
                    <div class="health-resource-status">${jobsSucceeded} succeeded</div>
                </div>
                
                <div class="health-resource-item">
                    <div class="health-resource-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                    </div>
                    <div class="health-resource-count">${cronJobs}</div>
                    <div class="health-resource-label">CronJobs</div>
                    <div class="health-resource-status">${cronJobsSuspended} suspended</div>
                </div>
            </div>
        `;

        // === UNHEALTHY WORKLOADS ===
        const unhealthyPods = [];
        if (data.pods && Array.isArray(data.pods)) {
            data.pods.forEach(pod => {
                if (pod.status !== 'Running' || pod.ready === false) {
                    unhealthyPods.push(pod);
                }
            });
        }

        if (unhealthyPods.length > 0) {
            html += `
                <div style="margin-top: 24px;">
                    <div class="unhealthy-header">
                        <div class="unhealthy-icon">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                                <line x1="12" y1="9" x2="12" y2="13"/>
                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                            </svg>
                        </div>
                        <h3 class="unhealthy-title">Unhealthy Workloads</h3>
                        <span class="unhealthy-count">${unhealthyPods.length}</span>
                    </div>
                    <div class="unhealthy-workloads-list">
            `;

            unhealthyPods.slice(0, 10).forEach(pod => {
                const statusClass = pod.status === 'Failed' ? 'status-failed' : 
                                  pod.status === 'Pending' ? 'status-pending' : 'status-error';
                const restartCount = pod.restart_count || 0;
                const namespace = pod.namespace || currentNamespace;
                
                html += `
                    <div class="unhealthy-workload-item ${statusClass}">
                        <div class="workload-status-indicator"></div>
                        <div class="workload-content">
                            <div class="workload-header">
                                <div class="workload-type">Pod</div>
                                <div class="workload-name">${pod.name}</div>
                                ${restartCount > 0 ? `<div class="workload-restart">RestartCount: ${restartCount}</div>` : ''}
                                <div class="workload-time">${pod.age || '-'}</div>
                            </div>
                            <div class="workload-namespace">${namespace}</div>
                        </div>
                    </div>
                `;
            });

            html += '</div></div>';
        }

        // === CLUSTER EVENTS ===
        if (data.cluster_events && data.cluster_events.length > 0) {
            html += `
                <div style="margin-top: 24px;">
                    <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">Recent Events</h3>
                    <div class="health-events-list">
            `;

            data.cluster_events.slice(0, 10).forEach((event, idx) => {
                const typeClass = event.type === 'Warning' ? 'event-warning' : 
                                event.type === 'Error' ? 'event-error' : 'event-info';
                const typeIcon = event.type === 'Warning' ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>` : 
                               event.type === 'Error' ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>` : 
                               `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
                
                html += `
                    <div class="health-event-item ${typeClass}">
                        <div class="event-icon">${typeIcon}</div>
                        <div class="event-content">
                            <div class="event-header">
                                <span class="event-reason">${event.reason || 'Event'}</span>
                                ${event.resource ? `<span class="event-resource">${event.resource}</span>` : ''}
                                <span class="event-count">${event.count || 1}x</span>
                                <span class="event-time">${event.time ? new Date(event.time).toLocaleString('en-US', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '-'}</span>
                            </div>
                            <div class="event-message">${event.message || 'No details available'}</div>
                        </div>
                    </div>
                `;
            });

            html += '</div></div>';
        }

        // === ISSUES SECTION ===
        if (data.issues && data.issues.length > 0) {
            html += `
                <div style="margin-top: 24px;">
                    <h3 style="font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.5px;">Issues Detected</h3>
                    <div style="display: grid; gap: 8px;">
            `;

            data.issues.forEach(issue => {
                html += `
                    <div class="health-event-item event-error">
                        <div class="event-icon">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                            </svg>
                        </div>
                        <div class="event-content">
                            <div class="event-header">
                                <span class="event-reason">${issue.type || 'Issue'}</span>
                            </div>
                            <div class="event-message">${issue.message || 'No details available'}</div>
                        </div>
                    </div>
                `;
            });

            html += '</div></div>';
        } else {
            html += `
                <div class="health-success-card">
                    <svg class="success-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="8 12 11 15 16 9"/>
                    </svg>
                    <div class="success-title">All Systems Operational</div>
                    <div class="success-subtitle">No issues detected in your cluster</div>
                </div>
            `;
        }

        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading health data</p><small>${error.message}</small></div>`;
    }
}

async function loadClusterNodes() {
    const container = document.getElementById('clusterResults');
    container.innerHTML = '<div class="loading">Loading cluster nodes...</div>';

    try {
        const response = await fetch(`/api/health/${nsForApi()}`);
        const data = await response.json();

        if (!data.nodes || data.nodes.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🖥️</div><p>No nodes found</p></div>';
            return;
        }

        // Calculate stats
        const readyNodes = data.nodes.filter(n => n.ready).length;
        const totalCPU = data.nodes.reduce((sum, n) => {
            const cpu = n.cpu ? parseInt(n.cpu) : 0;
            return sum + cpu;
        }, 0);
        const workerNodes = data.nodes.filter(n => !n.roles || n.roles.length === 0 || n.roles.includes('worker')).length;

        // Update stats in resource-controls
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini">
                    <span class="stat-mini-value">${data.nodes.length}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${readyNodes}</span>
                    <span class="stat-mini-label">Ready</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${workerNodes}</span>
                    <span class="stat-mini-label">Workers</span>
                </div>
            </div>
        `;
        
        const controlsDiv = document.querySelector('#cluster .resource-controls');
        if (controlsDiv) {
            const existingStats = controlsDiv.querySelector('.resource-stats');
            if (existingStats) existingStats.remove();
            controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
        }

        let html = `
            <div class="health-card">
                <h3>🖥️ Cluster Nodes (${data.nodes.length})</h3>
                <table class="resource-table node-table">
                    <thead>
                        <tr>
                            <th style="width: 30px;"></th>
                            <th>Node Name</th>
                            <th>Status</th>
                            <th>Roles</th>
                            <th>Version</th>
                            <th>Pods</th>
                            <th>CPU</th>
                            <th>Memory</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        data.nodes.forEach((node, idx) => {
            const nodeId = `node-${idx}`;
            const statusClass = node.ready ? 'badge-success' : 'badge-danger';
            const roles = node.roles && node.roles.length > 0 ? node.roles.join(', ') : 'worker';
            
            html += `
                <tr class="node-row expandable" onclick="toggleNodeDetails('${nodeId}')">
                    <td class="expand-icon">
                        <span id="${nodeId}-icon" class="collapse-icon">▶</span>
                    </td>
                    <td>🖥️ ${node.name}</td>
                    <td><span class="badge ${statusClass}">${node.ready ? 'Ready' : 'Not Ready'}</span></td>
                    <td>${roles}</td>
                    <td>${node.kubelet_version || 'N/A'}</td>
                    <td><span class="badge-info">${node.pod_count || 0}</span></td>
                    <td>${node.cpu || 'N/A'}</td>
                    <td>${node.memory || 'N/A'}</td>
                </tr>
                <tr id="${nodeId}-details" class="node-details-row" style="display: none;">
                    <td colspan="8">
                        <div class="ingress-details-content">
                            <div class="ingress-details-grid">
                                <div class="ingress-rule-card">
                                    <div class="ingress-rule-header"><strong>💻 System Info</strong></div>
                                    <div class="ingress-paths">
                                        <div class="ingress-path-item">
                                            <div class="path-route"><strong>OS:</strong> ${node.os || 'N/A'}</div>
                                        </div>
                                        <div class="ingress-path-item">
                                            <div class="path-route"><strong>Kernel:</strong> ${node.kernel_version || 'N/A'}</div>
                                        </div>
                                        <div class="ingress-path-item">
                                            <div class="path-route"><strong>Architecture:</strong> ${node.architecture || 'N/A'}</div>
                                        </div>
                                        <div class="ingress-path-item">
                                            <div class="path-route"><strong>Container Runtime:</strong> ${node.container_runtime || 'N/A'}</div>
                                        </div>
                                    </div>
                                </div>
                                ${node.addresses && node.addresses.length > 0 ? `
                                    <div class="ingress-rule-card">
                                        <div class="ingress-rule-header"><strong>🌐 Addresses</strong></div>
                                        <div class="ingress-paths">
                                            ${node.addresses.map(addr => `
                                                <div class="ingress-path-item">
                                                    <div class="path-route"><strong>${addr.type}:</strong> ${addr.address}</div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                                ${node.conditions && node.conditions.length > 0 ? `
                                    <div class="ingress-rule-card">
                                        <div class="ingress-rule-header"><strong>📋 Conditions</strong></div>
                                        <div class="ingress-paths">
                                            ${node.conditions.map(cond => `
                                                <div class="ingress-path-item">
                                                    <div class="path-route">
                                                        <span class="badge-${cond.status === 'True' ? (cond.type === 'Ready' ? 'success' : 'warning') : 'secondary'}">${cond.type}</span>
                                                        <span style="margin-left: 8px;">${cond.status}</span>
                                                        ${cond.message ? ` - ${cond.message}` : ''}
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table></div>';

        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading cluster nodes</p><small>${error.message}</small></div>`;
    }
}

function toggleNodeDetails(nodeId) {
    const detailsRow = document.getElementById(`${nodeId}-details`);
    const icon = document.getElementById(`${nodeId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

// Toggle resource details in Explorer tab (inline expansion)
async function toggleResourceDetails(resourceId, resourceType, namespace, name) {
    const detailsRow = document.getElementById(`${resourceId}-details`);
    const icon = document.getElementById(`${resourceId}-icon`);
    const contentDiv = document.getElementById(`${resourceId}-content`);
    
    if (!detailsRow || !icon) return;
    
    const isVisible = detailsRow.style.display !== 'none';
    
    if (isVisible) {
        // Collapse
        detailsRow.style.display = 'none';
        icon.textContent = '▶';
        icon.classList.remove('expanded');
    } else {
        // Expand
        detailsRow.style.display = 'table-row';
        icon.textContent = '▼';
        icon.classList.add('expanded');
        
        // Load details if not already loaded
        if (contentDiv && contentDiv.innerHTML.includes('Loading')) {
            try {
                const url = buildResourceURL(resourceType, namespace, name);
                const response = await fetch(url);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const resource = await response.json();
                
                // Render inline details - Resource Explorer only
                let html = '<div class="ingress-details-grid">';
                
                // Relationships section with recursive resource explorer
                html += '<div class="ingress-rule-card xray-card">';
                html += '<div class="ingress-rule-header" id="xray-header-${resourceId}"><strong>🔎 Resource Explorer</strong> <span class="xray-loading-badge">⏳ Loading...</span></div>';
                html += '<div id="xray-tree-container">Building dependency tree...</div>';
                html += '</div>';
                
                html += '</div>';
                contentDiv.innerHTML = html;
                
                // Asynchronously build and render full recursive tree
                buildAndRenderFullTree(resourceType, namespace, name, `${resourceId}-content`);
                
            } catch (error) {
                contentDiv.innerHTML = `<div class="error-small" style="padding: 12px; color: var(--danger);">Failed to load: ${error.message}</div>`;
            }
        }
    }
}

// Backward compatibility
async function analyzeHealth() {
    await loadHealth();
}

/* ============================================
   HIERARCHICAL RELATIONSHIP DISPLAY (Resource Explorer)
   ============================================ */

// Check if resource type is cluster-scoped (no namespace)
function isClusterScopedResource(resourceType) {
    const clusterScoped = [
        'PersistentVolume',
        'StorageClass',
        'Node',
        'ClusterRole',
        'ClusterRoleBinding',
        'CustomResourceDefinition',
        'CRD'
    ];
    return clusterScoped.includes(resourceType);
}

// Build API URL for resource (handles cluster-scoped vs namespaced)
function buildResourceURL(resourceType, namespace, name) {
    if (isClusterScopedResource(resourceType)) {
        // Cluster-scoped resources don't have namespace
        return `/api/resource/${encodeURIComponent(resourceType)}/_all/${encodeURIComponent(name)}`;
    }
    // Namespaced resources
    return `/api/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}

// Get resource from global cache to avoid duplicate API calls
function getResourceFromCache(resourceType, namespace, name) {
    const cacheMap = {
        'Pod': window.podsData,
        'Deployment': window.deploymentsData,
        'Service': window.servicesData,
        'ConfigMap': window.configMapsData,
        'Secret': window.secretsData,
        'Ingress': window.ingressesData,
        'CronJob': window.cronJobsData,
        'CRD': window.crdsData
    };
    
    // Handle PV/PVC which are stored differently
    if (resourceType === 'PersistentVolumeClaim' && window.pvpvcData?.pvcs) {
        return window.pvpvcData.pvcs.find(r => r.name === name && r.namespace === namespace);
    }
    if (resourceType === 'PersistentVolume' && window.pvpvcData?.unbound_pvs) {
        // PVs are cluster-scoped, so no namespace check
        return window.pvpvcData.unbound_pvs.find(r => r.name === name);
    }
    
    const cache = cacheMap[resourceType];
    if (!cache || !Array.isArray(cache)) return null;
    
    // For cluster-scoped resources, ignore namespace
    if (isClusterScopedResource(resourceType)) {
        return cache.find(r => r.name === name);
    }
    
    return cache.find(r => 
        r.name === name && 
        (r.namespace === namespace || !r.namespace)
    );
}

// Check if resource is a leaf resource (terminal node - no further expansion)
function isLeafResource(resourceType) {
    const leafResources = [
        'ConfigMap',
        'Secret',
        'PersistentVolumeClaim',
        'PersistentVolume',
        'ServiceAccount',
        'Endpoints'
    ];
    return leafResources.includes(resourceType);
}

// Recursively fetch full relationship tree
// OPTIMIZED: Uses cached data first, only makes API calls when necessary
// Performance: ~0.5-2 seconds for typical resources (10x faster than before!)
async function fetchFullRelationshipTree(resourceType, namespace, name, visitedResources = new Set(), depth = 0, maxDepth = 5) {
    // Prevent infinite loops and limit depth
    const resourceKey = `${resourceType}/${namespace}/${name}`;
    if (visitedResources.has(resourceKey) || depth >= maxDepth) {
        return null;
    }
    visitedResources.add(resourceKey);
    
    // Validate input - prevent crashes from bad data
    if (!resourceType || !name) {
        console.warn(`Invalid resource data: type=${resourceType}, name=${name}`);
        return null;
    }
    
    // Check if this is a leaf resource - don't fetch relationships for these
    const isLeaf = isLeafResource(resourceType);
    
    // Try to get from cache first
    const cachedResource = getResourceFromCache(resourceType, namespace, name);
    let resource = null;
    
    if (cachedResource) {
        console.log(`✓ Found ${resourceKey} in cache (no API call needed)`);
        resource = cachedResource;
    } else {
        // Not in cache, fetch from API
        try {
            const url = buildResourceURL(resourceType, namespace, name);
            const response = await fetch(url);
            
            if (!response.ok) {
                console.warn(`Failed to fetch ${resourceKey}: ${response.status}`);
                return null;
            }
            
            resource = await response.json();
            
            // Validate resource data
            if (!resource || typeof resource !== 'object') {
                console.warn(`Invalid resource data received for ${resourceKey}`);
                return null;
            }
            
            console.log(`⚡ Fetched ${resourceKey} from API`);
        } catch (error) {
            console.error(`Error fetching ${resourceKey}:`, error);
            return null;
        }
    }
    
    // Build node with resource data
    const level = getResourceHierarchyLevel(resourceType);
    const node = {
        type: resourceType,
        name: name,
        namespace: namespace,
        level: level,
        healthScore: resource.health_score || resource.healthScore,
        status: resource.status,
        children: [],
        isLeaf: isLeaf
    };
    
    // Stop recursion at leaf resources (ConfigMap, Secret, PVC, ServiceAccount, etc.)
    if (isLeaf) {
        console.log(`🍃 Leaf resource ${resourceKey} - no further expansion`);
        return node;
    }
    
    // Recursively fetch relationships (using cache when possible)
    if (resource.relationships && Array.isArray(resource.relationships) && resource.relationships.length > 0) {
        const childPromises = resource.relationships.map(async (rel) => {
            try {
                const childType = rel.resource_type || rel.target_type;
                const childName = rel.resource_name || rel.target_name;
                
                // Skip invalid relationships
                if (!childType || !childName) {
                    console.warn(`Skipping invalid relationship:`, rel);
                    return null;
                }
                
                // For cluster-scoped resources, use "_all" as namespace placeholder
                let childNamespace;
                if (isClusterScopedResource(childType)) {
                    childNamespace = '_all';
                } else {
                    childNamespace = rel.namespace || namespace; // Use same namespace if not specified
                }
                
                const childNode = await fetchFullRelationshipTree(
                    childType,
                    childNamespace,
                    childName,
                    visitedResources,
                    depth + 1,
                    maxDepth
                );
                
                if (childNode) {
                    childNode.relationshipType = rel.relationship_type;
                    return childNode;
                }
                return null;
            } catch (error) {
                console.error(`Error processing relationship:`, rel, error);
                return null;
            }
        });
        
        const children = await Promise.all(childPromises);
        node.children = children.filter(child => child !== null);
    }
    
    return node;
}

// Build and render the full recursive tree
async function buildAndRenderFullTree(resourceType, namespace, name, contentDivId) {
    try {
        const tree = await fetchFullRelationshipTree(resourceType, namespace, name);
        
        if (!tree) {
            const contentDiv = document.getElementById(contentDivId);
            if (contentDiv) {
                const xrayContainer = contentDiv.querySelector('#xray-tree-container');
                if (xrayContainer) {
                    xrayContainer.innerHTML = '<div class="tree-empty">Unable to load dependency tree</div>';
                    
                    // Update loading badge
                    const loadingBadge = contentDiv.querySelector('.xray-loading-badge');
                    if (loadingBadge) {
                        loadingBadge.innerHTML = '⚠️ Failed';
                        loadingBadge.style.color = 'var(--warning)';
                    }
                }
            }
            return;
        }
        
        // Render the tree
        const html = renderRecursiveTree(tree, true, '', true);
        
        const contentDiv = document.getElementById(contentDivId);
        if (contentDiv) {
            const xrayContainer = contentDiv.querySelector('#xray-tree-container');
            if (xrayContainer) {
                xrayContainer.innerHTML = html;
                
                // Update header to show loaded - remove loading badge
                const loadingBadge = contentDiv.querySelector('.xray-loading-badge');
                if (loadingBadge) {
                    loadingBadge.innerHTML = '✓ Loaded';
                    loadingBadge.style.color = 'var(--success)';
                    loadingBadge.classList.remove('xray-loading-badge');
                    loadingBadge.classList.add('xray-loaded-badge');
                }
            }
        }
        
    } catch (error) {
        console.error('Error building full tree:', error);
        const contentDiv = document.getElementById(contentDivId);
        if (contentDiv) {
            const xrayContainer = contentDiv.querySelector('#xray-tree-container');
            if (xrayContainer) {
                xrayContainer.innerHTML = `<div class="tree-empty" style="color: var(--danger);">Error: ${error.message}</div>`;
                
                // Update loading badge to show error
                const loadingBadge = contentDiv.querySelector('.xray-loading-badge');
                if (loadingBadge) {
                    loadingBadge.innerHTML = '⚠️ Error';
                    loadingBadge.style.color = 'var(--danger)';
                }
            }
        }
    }
}

// Render recursive tree with aesthetic grouped layout (reference image style)
function renderRecursiveTree(node, isRoot = true, prefix = '', isLast = true) {
    if (!node) return '';
    
    let html = '';
    const icon = getResourceIcon(node.type);
    
    if (isRoot) {
        // Root node (starting resource) - skip displaying it, go straight to children
        html += `<div class="xray-tree-modern">`;
        
        // Group children by resource type
        if (node.children && node.children.length > 0) {
            const groupedChildren = {};
            node.children.forEach(child => {
                const type = child.type;
                if (!groupedChildren[type]) {
                    groupedChildren[type] = [];
                }
                groupedChildren[type].push(child);
            });
            
            // Render grouped sections without headers
            html += '<div class="relationship-groups">';
            
            Object.keys(groupedChildren).forEach(resourceType => {
                const children = groupedChildren[resourceType];
                const groupId = `group-${resourceType}-${Date.now()}-${Math.random()}`;
                
                html += `
                    <div class="relationship-group">
                        <div class="relationship-group-items" id="${groupId}" style="display: block;">
                `;
                
                // Render each child as expandable card
                children.forEach((child, index) => {
                    const childId = `child-${resourceType}-${index}-${Date.now()}-${Math.random()}`;
                    html += renderRelationshipCard(child, childId, 0, node.type, child.relationshipType);
                });
                
                html += `
                        </div>
                    </div>
                `;
            });
            
            html += '</div>';
        } else {
            html += '<div class="tree-empty">No related resources</div>';
        }
        
        html += `</div>`;
        
    }
    
    return html;
}

// Get resource type icon based on type
function getResourceTypeIcon(resourceType) {
    const iconMap = {
        'Pod': '📦',
        'Deployment': '🚀',
        'Service': '🔗',
        'ConfigMap': '⚙️',
        'Secret': '🔒',
        'PersistentVolumeClaim': '💾',
        'PersistentVolume': '💿',
        'ServiceAccount': '🔐',
        'Ingress': '🌐',
        'StatefulSet': '📊',
        'DaemonSet': '⚡',
        'Job': '⚙️',
        'CronJob': '⏰',
        'ReplicaSet': '📑',
        'Endpoints': '🎯',
        'Node': '🖥️'
    };
    return iconMap[resourceType] || getResourceIcon(resourceType);
}

// Get human-readable relationship label
function getRelationshipLabel(relationshipType, parentType, childType) {
    if (!relationshipType) return '';
    
    // Map relationship types to clear parent/child labels
    const labelMap = {
        // Ownership relationships
        'Owned By': `👤 managed by ${parentType}`,
        'Owned By CronJob': '👤 managed by CronJob',
        'Manages Pod': '👤 manages',
        'Created Pod': '👤 created by',
        
        // Resource usage
        'Uses PVC': '💾 uses storage',
        'Uses ServiceAccount': '🔐 uses identity',
        'Uses ConfigMap': '⚙️ uses config',
        'Uses Secret': '🔒 uses secret',
        'Uses ConfigMap (Env)': '⚙️ uses config (env)',
        'Uses Secret (Env)': '🔒 uses secret (env)',
        
        // Volume mounts
        'Mounts ConfigMap': '📂 mounts config',
        'Mounts Secret': '📂 mounts secret',
        
        // Routing relationships
        'Routes To Deployment': '🔀 routes to',
        'Routes To Service': '🔀 routes to',
        'Routes To StatefulSet': '🔀 routes to',
        'Routes To Pod': '🔀 routes to',
        
        // Generic
        'backend': '🔗 backend'
    };
    
    return labelMap[relationshipType] || relationshipType.toLowerCase();
}

// Render individual relationship card with expand capability and relationship labels
function renderRelationshipCard(node, cardId, depth = 0, parentType = '', relationshipType = '') {
    const icon = getResourceIcon(node.type);
    const hasChildren = node.children && node.children.length > 0;
    const indent = depth * 24; // Increased indentation for better visibility
    const isLeaf = node.isLeaf || isLeafResource(node.type); // Check if this is a terminal resource
    
    // Generate human-readable relationship label with icon
    const relationLabel = getRelationshipLabel(relationshipType, parentType, node.type);
    
    // Get resource type icon for display
    const resourceIconName = getResourceTypeIcon(node.type);
    
    let html = `
        <div class="relationship-card ${isLeaf ? 'leaf-resource' : ''}" style="margin-left: ${indent}px;">
            <div class="relationship-card-header" ${hasChildren && !isLeaf ? `onclick="toggleRelationshipCard('${cardId}')"` : ''}>
                ${hasChildren && !isLeaf ? `<span class="card-expand-icon" id="${cardId}-icon">▶</span>` : '<span class="card-no-expand">└─</span>'}
                <span class="card-icon">${resourceIconName}</span>
                <span class="card-resource-name">${node.name}</span>
                <span class="resource-type-badge badge-${node.type.toLowerCase()}">${node.type}</span>
                ${relationLabel ? `<span class="relation-label">${relationLabel}</span>` : ''}
                ${node.healthScore ? `<span class="card-health" title="Health Score">${node.healthScore}%</span>` : ''}
            </div>
    `;
    
    // Only show children if not a leaf resource
    if (hasChildren && !isLeaf) {
        html += `<div class="relationship-card-children" id="${cardId}" style="display: none;">`;
        
        node.children.forEach((child, index) => {
            const childCardId = `${cardId}-child-${index}`;
            html += renderRelationshipCard(child, childCardId, depth + 1, node.type, child.relationshipType);
        });
        
        html += `</div>`;
    }
    
    html += `</div>`;
    
    return html;
}

// Toggle relationship group (Pod group, ConfigMap group, etc.)
function toggleRelationshipGroup(groupId) {
    const group = document.getElementById(groupId);
    const icon = document.getElementById(`${groupId}-icon`);
    
    if (!group || !icon) return;
    
    const isVisible = group.style.display !== 'none';
    group.style.display = isVisible ? 'none' : 'block';
    icon.textContent = isVisible ? '▶' : '▼';
}

// Toggle individual relationship card expansion
function toggleRelationshipCard(cardId) {
    const card = document.getElementById(cardId);
    const icon = document.getElementById(`${cardId}-icon`);
    
    if (!card || !icon) return;
    
    const isVisible = card.style.display !== 'none';
    card.style.display = isVisible ? 'none' : 'block';
    icon.textContent = isVisible ? '▶' : '▼';
}

// Define resource type hierarchy (higher number = lower in hierarchy)
function getResourceHierarchyLevel(resourceType) {
    const hierarchy = {
        // Network entry points (top level)
        'Ingress': 1,
        
        // Service layer
        'Service': 2,
        'Endpoints': 3,
        
        // Workload controllers
        'HorizontalPodAutoscaler': 4,
        'Deployment': 5,
        'StatefulSet': 5,
        'DaemonSet': 5,
        'CronJob': 5,
        'Job': 6,
        'ReplicaSet': 7,
        
        // Pod level
        'Pod': 8,
        
        // Storage (can be at various levels)
        'PersistentVolumeClaim': 9,
        'PersistentVolume': 10,
        'StorageClass': 11,
        
        // Configuration (can be referenced by multiple resources)
        'ConfigMap': 12,
        'Secret': 12,
        
        // Other resources
        'ServiceAccount': 13,
        'Node': 14
    };
    
    return hierarchy[resourceType] || 50; // Default to bottom if unknown
}

// Build tree structure from flat relationships
function buildRelationshipTree(relationships, currentResourceType, currentResourceName) {
    const tree = {
        name: currentResourceName,
        type: currentResourceType,
        level: getResourceHierarchyLevel(currentResourceType),
        children: []
    };
    
    // Group relationships by hierarchy level
    const byLevel = {};
    relationships.forEach(rel => {
        const targetType = rel.resource_type || rel.target_type || 'Resource';
        const targetName = rel.resource_name || rel.target_name;
        const level = getResourceHierarchyLevel(targetType);
        
        if (!byLevel[level]) {
            byLevel[level] = [];
        }
        
        byLevel[level].push({
            type: targetType,
            name: targetName,
            relationshipType: rel.relationship_type,
            level: level
        });
    });
    
    // Sort levels
    const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
    
    // Build tree structure
    levels.forEach(level => {
        byLevel[level].forEach(rel => {
            tree.children.push({
                type: rel.type,
                name: rel.name,
                relationshipType: rel.relationshipType,
                level: rel.level,
                children: []
            });
        });
    });
    
    return tree;
}

// Render tree node with proper k9s-style connectors
function renderTreeNode(node, isLast, prefix = '', isRoot = false) {
    let html = '';
    const icon = getResourceIcon(node.type);
    
    if (isRoot) {
        // Root node (current resource)
        html += `
            <div class="tree-node tree-root">
                <span class="tree-icon">${icon}</span>
                <span class="tree-type">${node.type}</span>
                <span class="tree-name">${node.name}</span>
                <span class="tree-badge current">CURRENT</span>
            </div>
        `;
    } else {
        // Child nodes
        const connector = isLast ? '└─' : '├─';
        const nodePrefix = prefix + connector;
        
        html += `
            <div class="tree-node">
                <span class="tree-prefix">${nodePrefix}</span>
                <span class="tree-icon">${icon}</span>
                <span class="tree-type">${node.type}</span>
                <span class="tree-name">${node.name}</span>
            </div>
        `;
    }
    
    // Render children with proper indentation
    if (node.children && node.children.length > 0) {
        const childPrefix = isRoot ? '' : (prefix + (isLast ? '  ' : '│ '));
        
        node.children.forEach((child, index) => {
            const isLastChild = index === node.children.length - 1;
            html += renderTreeNode(child, isLastChild, childPrefix, false);
        });
    }
    
    return html;
}

// Render relationships in k9s xray-style hierarchical tree
function renderRelationshipHierarchy(relationships, currentResourceType, currentResourceName = 'current') {
    if (!relationships || relationships.length === 0) {
        return '<div class="tree-empty">No relationships found</div>';
    }
    
    const currentLevel = getResourceHierarchyLevel(currentResourceType);
    
    // Separate upstream and downstream
    const upstream = [];
    const downstream = [];
    
    relationships.forEach(rel => {
        const targetType = rel.resource_type || rel.target_type || 'Resource';
        const targetLevel = getResourceHierarchyLevel(targetType);
        
        if (targetLevel < currentLevel) {
            upstream.push(rel);
        } else {
            downstream.push(rel);
        }
    });
    
    let html = '<div class="xray-tree">';
    
    // Render upstream (what this depends on)
    if (upstream.length > 0) {
        html += '<div class="tree-section upstream-section">';
        html += '<div class="tree-section-header">⬆️ Upstream Dependencies</div>';
        
        // Sort by hierarchy level (highest first)
        upstream.sort((a, b) => {
            const aLevel = getResourceHierarchyLevel(a.resource_type || a.target_type);
            const bLevel = getResourceHierarchyLevel(b.resource_type || b.target_type);
            return aLevel - bLevel;
        });
        
        upstream.forEach((rel, index) => {
            const isLast = index === upstream.length - 1;
            const connector = isLast ? '└─' : '├─';
            const icon = getResourceIcon(rel.resource_type || rel.target_type);
            const name = rel.resource_name || rel.target_name;
            const type = rel.resource_type || rel.target_type;
            
            html += `
                <div class="tree-node upstream-node">
                    <span class="tree-prefix">${connector}</span>
                    <span class="tree-icon">${icon}</span>
                    <span class="tree-type">${type}</span>
                    <span class="tree-name">${name}</span>
                    <span class="tree-relation">${rel.relationship_type || ''}</span>
                </div>
            `;
            
            if (!isLast) {
                html += '<div class="tree-connector">│</div>';
            }
        });
        
        html += '</div>';
    }
    
    // Current resource
    html += `
        <div class="tree-section current-section">
            <div class="tree-node tree-current">
                <span class="tree-icon">${getResourceIcon(currentResourceType)}</span>
                <span class="tree-type">${currentResourceType}</span>
                <span class="tree-name">${currentResourceName}</span>
                <span class="tree-badge">📍 CURRENT</span>
            </div>
        </div>
    `;
    
    // Render downstream (what depends on this)
    if (downstream.length > 0) {
        html += '<div class="tree-section downstream-section">';
        html += '<div class="tree-section-header">⬇️ Downstream Dependents</div>';
        
        // Sort by hierarchy level (lowest first)
        downstream.sort((a, b) => {
            const aLevel = getResourceHierarchyLevel(a.resource_type || a.target_type);
            const bLevel = getResourceHierarchyLevel(b.resource_type || b.target_type);
            return aLevel - bLevel;
        });
        
        downstream.forEach((rel, index) => {
            const isLast = index === downstream.length - 1;
            const connector = isLast ? '└─' : '├─';
            const icon = getResourceIcon(rel.resource_type || rel.target_type);
            const name = rel.resource_name || rel.target_name;
            const type = rel.resource_type || rel.target_type;
            
            html += `
                <div class="tree-node downstream-node">
                    <span class="tree-prefix">${connector}</span>
                    <span class="tree-icon">${icon}</span>
                    <span class="tree-type">${type}</span>
                    <span class="tree-name">${name}</span>
                    <span class="tree-relation">${rel.relationship_type || ''}</span>
                </div>
            `;
            
            if (!isLast) {
                html += '<div class="tree-connector">│</div>';
            }
        });
        
        html += '</div>';
    }
    
    html += '</div>';
    return html;
}

/* ============================================
   CRDs (Custom Resource Definitions)
   ============================================ */

async function loadCRDs() {
    const container = document.getElementById('crdsContent');
    container.innerHTML = '<div class="loading">Loading CRDs...</div>';

    try {
        const response = await fetch('/api/crds');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const crds = await response.json();

        if (!Array.isArray(crds) || crds.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚙️</div><p>No Custom Resource Definitions found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.crdsData = crds;

        // Update stats in resource-controls
        const apiGroups = [...new Set(crds.map(crd => crd.group))];
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini">
                    <span class="stat-mini-value">${crds.length}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${apiGroups.length}</span>
                    <span class="stat-mini-label">API Groups</span>
                </div>
            </div>
        `;
        
        const controlsDiv = document.querySelector('#crds .resource-controls');
        if (controlsDiv) {
            const existingStats = controlsDiv.querySelector('.resource-stats');
            if (existingStats) existingStats.remove();
            controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
        }

        let html = `
            <table class="resource-table crd-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Group</th>
                        <th>Version(s)</th>
                        <th>Scope</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
        `;

        crds.forEach((crd, idx) => {
            const versions = crd.versions ? crd.versions.join(', ') : 'N/A';
            
            html += `
                <tr class="clickable-row" onclick="openDetailPanel('crdsDetails', 'CustomResourceDefinition', 'cluster', '${crd.name}', window.crdsData[${idx}])">
                    <td>⚙️ ${crd.name}</td>
                    <td><span class="badge-info">${crd.group || 'N/A'}</span></td>
                    <td><small>${versions}</small></td>
                    <td><span class="badge-${crd.scope === 'Namespaced' ? 'success' : 'warning'}">${crd.scope || 'N/A'}</span></td>
                    <td>${crd.age || 'N/A'}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading CRDs</p><small>${error.message}</small></div>`;
    }
}

function renderCRDDetails(crd) {
    let detailsHtml = '<div class="ingress-details-grid">';
    
    // Basic info section
    detailsHtml += `
        <div class="ingress-rule-card">
            <div class="ingress-rule-header"><strong>📝 Resource Names</strong></div>
            <div class="ingress-paths">
                <div class="ingress-path-item">
                    <div class="path-route"><strong>Kind:</strong> ${crd.kind || 'N/A'}</div>
                </div>
                <div class="ingress-path-item">
                    <div class="path-route"><strong>Plural:</strong> ${crd.plural || 'N/A'}</div>
                </div>
                <div class="ingress-path-item">
                    <div class="path-route"><strong>Singular:</strong> ${crd.singular || 'N/A'}</div>
                </div>
                ${crd.list_kind ? `
                <div class="ingress-path-item">
                    <div class="path-route"><strong>List Kind:</strong> ${crd.list_kind}</div>
                </div>
                ` : ''}
            </div>
        </div>
    `;
    
    // Versions section with details
    if (crd.version_details && crd.version_details.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header"><strong>📋 Versions</strong></div>
                <div class="ingress-paths">
        `;
        
        crd.version_details.forEach(v => {
            const badges = [];
            if (v.storage) badges.push('<span class="badge-success">Storage</span>');
            if (v.served) badges.push('<span class="badge-info">Served</span>');
            if (v.deprecated) badges.push('<span class="badge-warning">Deprecated</span>');
            
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <strong>${v.name}</strong>
                        ${badges.join(' ')}
                    </div>
                    ${v.deprecation_warning ? `<div class="path-backend" style="color: #ff9800;">⚠️ ${v.deprecation_warning}</div>` : ''}
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    // Scope and Conversion section
    detailsHtml += `
        <div class="ingress-rule-card">
            <div class="ingress-rule-header"><strong>⚙️ Configuration</strong></div>
            <div class="ingress-paths">
                <div class="ingress-path-item">
                    <div class="path-route"><strong>Scope:</strong> <span class="badge-info">${crd.scope || 'N/A'}</span></div>
                </div>
                ${crd.conversion_strategy ? `
                <div class="ingress-path-item">
                    <div class="path-route"><strong>Conversion:</strong> <span class="badge-plugin">${crd.conversion_strategy}</span></div>
                </div>
                ` : ''}
                ${crd.subresources && crd.subresources.length > 0 ? `
                <div class="ingress-path-item">
                    <div class="path-route"><strong>Subresources:</strong> ${crd.subresources.map(s => `<span class="badge-plugin">${s}</span>`).join(' ')}</div>
                </div>
                ` : ''}
            </div>
        </div>
    `;
    
    // Categories section
    if (crd.categories && crd.categories.length > 0) {
        detailsHtml += `
            <div class="ingress-plugins">
                <strong>🏷️ Categories:</strong>
                <div class="plugin-badges">
                    ${crd.categories.map(cat => `<span class="badge-plugin">${cat}</span>`).join('')}
                </div>
            </div>
        `;
    }
    
    // Short names section
    if (crd.short_names && crd.short_names.length > 0) {
        detailsHtml += `
            <div class="ingress-plugins">
                <strong>🔤 Short Names:</strong>
                <div class="plugin-badges">
                    ${crd.short_names.map(name => `<span class="badge-plugin">${name}</span>`).join('')}
                </div>
            </div>
        `;
    }
    
    // Additional printer columns
    if (crd.additional_columns && crd.additional_columns.length > 0) {
        detailsHtml += `
            <div class="ingress-plugins">
                <strong>📊 Additional Columns:</strong>
                <div class="plugin-badges">
                    ${crd.additional_columns.map(col => `<span class="badge-info">${col}</span>`).join('')}
                </div>
            </div>
        `;
    }
    
    // Conditions section
    if (crd.conditions && crd.conditions.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header"><strong>🔍 Conditions</strong></div>
                <div class="ingress-paths">
        `;
        
        crd.conditions.forEach(cond => {
            const statusBadge = cond.status === 'True' ? 
                '<span class="badge-success">✓</span>' : 
                '<span class="badge-error">✗</span>';
            
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        ${statusBadge} <strong>${cond.type}</strong>
                        ${cond.reason ? ` - ${cond.reason}` : ''}
                    </div>
                    ${cond.message ? `<div class="path-backend">${cond.message}</div>` : ''}
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    detailsHtml += '</div>';
    return detailsHtml;
}

function toggleCRDDetails(crdId) {
    const detailsRow = document.getElementById(`${crdId}-details`);
    const icon = document.getElementById(`${crdId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   CRONJOBS & JOBS
   ============================================ */

async function loadCronJobsAndJobs() {
    console.log('loadCronJobsAndJobs() called');
    const container = document.getElementById('cronjobsContent');
    if (!container) {
        console.error('CronJobs container not found');
        return;
    }
    container.innerHTML = '<div class="loading">Loading CronJobs...</div>';

    try {
        // Fetch cronjobs and pods in parallel
        const [cronjobsResponse, podsResponse] = await Promise.all([
            fetch(`/api/cronjobs/${nsForApi()}`),
            fetch(`/api/pods/${nsForApi()}`)
        ]);
        
        if (!cronjobsResponse.ok) {
            throw new Error(`HTTP ${cronjobsResponse.status}: ${cronjobsResponse.statusText}`);
        }
        const cronjobs = await cronjobsResponse.json();
        console.log('CronJobs API response:', cronjobs);

        // Get pods to match with jobs
        let pods = [];
        if (podsResponse.ok) {
            const podsData = await podsResponse.json();
            pods = podsData.items || [];
        }

        // Handle null/empty response
        if (!cronjobs || !Array.isArray(cronjobs) || cronjobs.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏰</div><p>No CronJobs found in this namespace</p></div>';
            return;
        }

        // Match pods to jobs by name prefix (pod name starts with job name)
        cronjobs.forEach(cj => {
            if (cj.jobs && Array.isArray(cj.jobs)) {
                cj.jobs.forEach(job => {
                    const matchedPods = pods.filter(pod => 
                        pod.name && job.name && pod.name.startsWith(job.name + '-')
                    );
                    job.pod_names = matchedPods.map(p => p.name);
                    job.pod_statuses = matchedPods.map(p => ({ name: p.name, status: p.status }));
                });
            }
        });

        // Store globally for detail panel access
        window.cronJobsData = cronjobs;
        renderCronJobsTable(cronjobs, container);
    } catch (error) {
        console.error('Error loading CronJobs:', error);
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading CronJobs</p><small>${error.message}</small></div>`;
    }
}

function renderCronJobsTable(cronjobs, container) {
    try {
        const totalCronJobs = cronjobs.length;
        const totalJobs = cronjobs.reduce((sum, cj) => sum + (cj.jobs ? cj.jobs.length : 0), 0);
        const activeJobs = cronjobs.reduce((sum, cj) => sum + (cj.active_count || 0), 0);

        if (totalCronJobs === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏰</div><p>No CronJobs found</p></div>';
            return;
        }

        const suspendedCronJobs = cronjobs.filter(cj => cj.suspend).length;
        const readyCronJobs = cronjobs.filter(cj => !cj.suspend).length;

        // Update stats in resource-controls
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini">
                    <span class="stat-mini-value">${totalCronJobs}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${readyCronJobs}</span>
                    <span class="stat-mini-label">Ready</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${totalJobs}</span>
                    <span class="stat-mini-label">Jobs</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${activeJobs}</span>
                    <span class="stat-mini-label">Active</span>
                </div>
            </div>
        `;
        
        const controlsDiv = document.querySelector('#cronjobs .resource-controls');
        if (controlsDiv) {
            const existingStats = controlsDiv.querySelector('.resource-stats');
            if (existingStats) existingStats.remove();
            controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
        }

        let html = `
            <table class="resource-table cronjob-table">
                <thead>
                    <tr>
                        <th style="width: 30px;"></th>
                        <th>Name</th>
                        <th>Schedule</th>
                        <th>Jobs</th>
                        <th>Next Run</th>
                        <th>Suspend</th>
                        <th>Last Scheduled</th>
                        <th>Active</th>
                        <th>Age</th>
                    </tr>
                </thead>
                <tbody>
        `;

        cronjobs.forEach((cj, idx) => {
            const suspendBadge = cj.suspend ? '<span class="badge-warning">Yes</span>' : '<span class="badge-success">No</span>';
            const lastSchedule = cj.last_schedule_time ? new Date(cj.last_schedule_time).toLocaleString() : 'Never';
            const nextRunIn = cj.next_run_in || '-';
            const jobCount = (cj.jobs && Array.isArray(cj.jobs)) ? cj.jobs.length : 0;
            const cronjobId = `cronjob-${idx}`;

            // Expand icon (show only if there are jobs)
            const expandIcon = jobCount > 0 
                ? `<span class="collapse-icon" id="${cronjobId}-icon" onclick="event.stopPropagation(); toggleCronJobJobs('${cronjobId}')">▶</span>`
                : `<span style="color: var(--text-muted);">•</span>`;

            html += `
                <tr class="clickable-row" onclick="openDetailPanel('cronjobsDetails', 'CronJob', '${cj.namespace}', '${cj.name}')">
                    <td>${expandIcon}</td>
                    <td>⏰ ${cj.name}</td>
                    <td><code>${cj.schedule || '-'}</code></td>
                    <td><span class="badge-info">${jobCount} jobs</span></td>
                    <td><span class="badge-info">${nextRunIn}</span></td>
                    <td>${suspendBadge}</td>
                    <td>${lastSchedule}</td>
                    <td><span class="badge-info">${cj.active_count || 0}</span></td>
                    <td>${cj.age || '-'}</td>
                </tr>
            `;

            // Expandable row for Jobs
            if (jobCount > 0) {
                html += `
                    <tr id="${cronjobId}-jobs" class="expandable-row" style="display: none;">
                        <td colspan="9" style="padding: 0; background-color: var(--bg-darker);">
                            <div style="padding: 16px; border-left: 3px solid var(--primary);">
                                <h4 style="margin: 0 0 12px 0; color: var(--text-primary); font-size: 14px;">
                                    💼 Jobs created by <code>${cj.name}</code>
                                </h4>
                                ${renderJobsUnderCronJob(cj.jobs)}
                            </div>
                        </td>
                    </tr>
                `;
            }
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (renderError) {
        console.error('Error rendering CronJobs table:', renderError);
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error rendering CronJobs</p><small>${renderError.message}</small></div>`;
    }
}

function renderJobsUnderCronJob(jobs) {
    if (!jobs || jobs.length === 0) {
        return '<div class="text-muted">No jobs found</div>';
    }
    
    let html = `
        <table class="resource-table" style="margin: 0; font-size: 0.85em;">
            <thead>
                <tr>
                    <th>Status</th>
                    <th>Job Name</th>
                    <th>Completions</th>
                    <th>Succeeded</th>
                    <th>Failed</th>
                    <th>Duration</th>
                    <th>Age</th>
                    <th>Pods</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    jobs.forEach(job => {
        const statusClass = job.status === 'Completed' ? 'badge-success' :
                            job.status === 'Failed' ? 'badge-danger' :
                            job.status === 'Active' ? 'badge-info' : 'badge-secondary';
        
        // Show pods with their statuses
        let podsHtml = '<span class="text-muted">-</span>';
        if (job.pod_statuses && job.pod_statuses.length > 0) {
            podsHtml = job.pod_statuses.map(p => {
                const podStatusClass = p.status === 'Running' ? 'badge-info' : 
                                       p.status === 'Succeeded' ? 'badge-success' :
                                       p.status === 'Failed' ? 'badge-danger' : 'badge-secondary';
                return `<span class="${podStatusClass}" style="display: inline-block; margin: 2px; font-size: 0.8em;">${p.name}<br/>(${p.status})</span>`;
            }).join('');
        } else if (job.pod_names && job.pod_names.length > 0) {
            podsHtml = job.pod_names.map(name => `<span class="badge-secondary" style="display: inline-block; margin: 2px;">${name}</span>`).join('');
        }
        
        // Assuming jobs have namespace field (inherited from parent CronJob)
        const namespace = job.namespace || currentNamespace;
        
        html += `
            <tr>
                <td><span class="${statusClass}">${job.status || '-'}</span></td>
                <td><code>${job.name}</code></td>
                <td>${job.completions ?? '-'}</td>
                <td>${job.succeeded ?? '-'}</td>
                <td>${job.failed ?? '-'}</td>
                <td>${job.duration || '-'}</td>
                <td>${job.age || '-'}</td>
                <td style="max-width: 300px; word-wrap: break-word;">${podsHtml}</td>
                <td>
                    <button class="btn-secondary" style="font-size: 0.75em; padding: 4px 8px;" onclick="navigateToJob('${namespace}', '${job.name}')" title="View in Jobs tab">View Job →</button>
                </td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
        <div style="margin-top: 12px; text-align: right;">
            <button class="btn-primary" style="font-size: 0.85em;" onclick="navigateToJobsTab()">
                View All Jobs →
            </button>
        </div>
    `;
    return html;
}

function toggleCronJobJobs(cronjobId) {
    const jobsRow = document.getElementById(`${cronjobId}-jobs`);
    const icon = document.getElementById(`${cronjobId}-icon`);

    if (jobsRow && icon) {
        const isVisible = jobsRow.style.display !== 'none';
        jobsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   JOBS (STANDALONE VIEW)
   ============================================ */

async function loadJobs() {
    console.log('loadJobs() called');
    const container = document.getElementById('jobsContent');
    if (!container) {
        console.error('Jobs container not found');
        return;
    }
    container.innerHTML = '<div class="loading">Loading Jobs...</div>';

    try {
        const response = await fetch(`/api/jobs/${nsForApi()}`);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('Jobs API response:', data);
        
        const jobs = data.jobs || [];

        // Handle empty response
        if (jobs.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">💼</div><p>No Jobs found in this namespace</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.jobsData = jobs;
        renderJobsTable(jobs, container);
        
        // Check if we need to filter for a specific job
        if (targetJobToHighlight) {
            const searchInput = document.getElementById('jobSearchFilter');
            if (searchInput) {
                searchInput.value = targetJobToHighlight;
                filterJobsTable();
                // Scroll to the first visible job
                setTimeout(() => {
                    const firstVisibleRow = document.querySelector('.job-table tbody tr:not([style*="display: none"])');
                    if (firstVisibleRow) {
                        firstVisibleRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }, 100);
            }
            targetJobToHighlight = null; // Clear after filtering
        }
    } catch (error) {
        console.error('Error loading Jobs:', error);
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading Jobs</p><small>${error.message}</small></div>`;
    }
}

function renderJobsTable(jobs, container) {
    try {
        const totalJobs = jobs.length;
        const completedJobs = jobs.filter(j => j.status === 'Completed').length;
        const failedJobs = jobs.filter(j => j.status === 'Failed').length;
        const activeJobs = jobs.filter(j => j.status === 'Running').length;

        // Update stats in resource-controls with clickable filters
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini clickable ${tableFilterState['jobs']?.filterValue === 'all' ? 'active' : ''}" 
                     onclick="filterJobsByStatus('all')" 
                     title="Show all jobs">
                    <span class="stat-mini-value">${totalJobs}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini clickable ${tableFilterState['jobs']?.filterValue === 'Running' ? 'active' : ''}" 
                     onclick="filterJobsByStatus('Running')" 
                     title="Show running jobs">
                    <span class="stat-mini-value">${activeJobs}</span>
                    <span class="stat-mini-label">Active</span>
                </div>
                <div class="stat-mini clickable ${tableFilterState['jobs']?.filterValue === 'Completed' ? 'active' : ''}" 
                     onclick="filterJobsByStatus('Completed')" 
                     title="Show completed jobs">
                    <span class="stat-mini-value">${completedJobs}</span>
                    <span class="stat-mini-label">Completed</span>
                </div>
                <div class="stat-mini clickable ${tableFilterState['jobs']?.filterValue === 'Failed' ? 'active' : ''}" 
                     onclick="filterJobsByStatus('Failed')" 
                     title="Show failed jobs">
                    <span class="stat-mini-value">${failedJobs}</span>
                    <span class="stat-mini-label">Failed</span>
                </div>
            </div>
        `;
        
        const controlsDiv = document.querySelector('#jobs .resource-controls');
        if (controlsDiv) {
            const existingStats = controlsDiv.querySelector('.resource-stats');
            if (existingStats) existingStats.remove();
            controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
        }

        let html = `
            <table class="resource-table job-table">
                <thead>
                    <tr>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 0, 'string')">
                            Status<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 1, 'string')">
                            Job Name<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 2, 'string')">
                            Parent CronJob<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 3, 'number')">
                            Completions<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 4, 'number')">
                            Succeeded<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 5, 'number')">
                            Failed<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 6, 'number')">
                            Active<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 7, 'age')">
                            Duration<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('jobs', '.job-table', 8, 'age')">
                            Age<span class="sort-icon"></span>
                        </th>
                        <th>View Pods</th>
                    </tr>
                </thead>
                <tbody>
        `;

        jobs.forEach((job, idx) => {
            const statusClass = job.status === 'Completed' ? 'badge-success' :
                                job.status === 'Failed' ? 'badge-danger' :
                                job.status === 'Running' ? 'badge-info' : 'badge-secondary';

            // Parent CronJob badge with navigation
            let ownerHtml = '<span class="text-muted">-</span>';
            if (job.owner_cronjob) {
                ownerHtml = `<span class="badge-info clickable-badge" onclick="navigateToCronJob('${job.namespace}', '${job.owner_cronjob}')" title="Click to view CronJob">⏰ ${job.owner_cronjob}</span>`;
            }

            // View Pods button - search for pods with job name prefix
            const totalPods = (job.succeeded || 0) + (job.failed || 0) + (job.active || 0);
            const viewPodsHtml = totalPods > 0 
                ? `<button class="btn-secondary" style="font-size: 0.75em; padding: 4px 8px;" onclick="event.stopPropagation(); navigateToPods('${job.namespace}', '${job.name}')" title="View pods for this job">📦 ${totalPods} pod${totalPods > 1 ? 's' : ''}</button>`
                : '<span class="text-muted">No pods</span>';

            html += `
                <tr class="clickable-row" onclick="openDetailPanel('jobsDetails', 'Job', '${job.namespace}', '${job.name}')">
                    <td><span class="${statusClass}">${job.status || '-'}</span></td>
                    <td><code>${job.name}</code></td>
                    <td>${ownerHtml}</td>
                    <td>${job.completions ?? '-'}</td>
                    <td>${job.succeeded ?? 0}</td>
                    <td>${job.failed ?? 0}</td>
                    <td>${job.active ?? 0}</td>
                    <td>${job.duration || '-'}</td>
                    <td>${job.age || '-'}</td>
                    <td>${viewPodsHtml}</td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (renderError) {
        console.error('Error rendering Jobs table:', renderError);
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error rendering Jobs</p><small>${renderError.message}</small></div>`;
    }
}

// Navigation helper: Jump from Job to parent CronJob
function navigateToCronJob(namespace, cronjobName) {
    console.log(`Navigating to CronJob: ${namespace}/${cronjobName}`);
    
    // Clear the cache for cronjobs tab to force reload with fresh data
    delete tabDataCache['cronjobs'];
    
    // Switch to CronJobs tab
    const cronjobsTab = document.querySelector('[data-tab="cronjobs"]');
    if (cronjobsTab) {
        cronjobsTab.click();
        
        // Wait for the tab to load, then open detail panel
        setTimeout(() => {
            openDetailPanel('cronjobsDetails', 'CronJob', namespace, cronjobName);
        }, 300);
    }
}

// Navigation helper: Jump to Jobs tab
function navigateToJobsTab() {
    console.log('Navigating to Jobs tab');
    
    const jobsTab = document.querySelector('[data-tab="jobs"]');
    if (jobsTab) {
        jobsTab.click();
    }
}

// Navigation helper: Jump to specific Job in Jobs tab and apply filter
function navigateToJob(namespace, jobName) {
    console.log(`Navigating to Job with filter: ${namespace}/${jobName}`);
    
    // Store the target job to filter after loading
    targetJobToHighlight = jobName;
    
    // Clear cache to force reload with filter
    delete tabDataCache['jobs'];
    
    // Switch to Jobs tab (this will trigger loadJobs() which will apply the filter)
    selectTab(null, 'jobs');
}

// Filter Jobs table by job name or parent CronJob (search box filter)
function filterJobsTable() {
    const searchInput = document.getElementById('jobSearchFilter');
    if (!searchInput) return;
    
    const filter = searchInput.value.toLowerCase();
    const table = document.querySelector('.job-table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        const jobName = row.querySelector('td:nth-child(2)')?.textContent.toLowerCase() || '';
        const parentCronJob = row.querySelector('td:nth-child(3)')?.textContent.toLowerCase() || '';
        const status = row.querySelector('td:nth-child(1)')?.textContent.toLowerCase() || '';
        
        // Show row if filter matches job name, parent cronjob, or status
        if (jobName.includes(filter) || parentCronJob.includes(filter) || status.includes(filter)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

// Filter Jobs by status (stat card filter)
function filterJobsByStatus(status) {
    // Clear search box when using stat filter
    const searchInput = document.getElementById('jobSearchFilter');
    if (searchInput) searchInput.value = '';
    
    if (status === 'all') {
        // Clear filter
        filterTableByStatus('jobs', '.job-table', 'status', 'all');
        return;
    }
    
    filterTableByStatus('jobs', '.job-table', 'status', status);
    
    // Update active state on stat cards
    document.querySelectorAll('#jobs .stat-mini.clickable').forEach(card => {
        card.classList.remove('active');
    });
    event.target.closest('.stat-mini')?.classList.add('active');
}

// Navigation helper: Jump to Pods tab and filter by job name
function navigateToPods(namespace, jobName) {
    console.log(`Navigating to Pods with filter: ${namespace}/${jobName}`);
    
    // Store the job name to filter pods (pods start with job name)
    window.targetPodFilter = jobName;
    
    // Clear cache to force reload with new filter
    delete tabDataCache['pods'];
    
    // Switch to Pods tab (this will trigger loadPods)
    selectTab(null, 'pods');
}

/* ============================================
   RELEASES
   ============================================ */

async function loadReleases() {
    const container = document.getElementById('releasesResults');
    container.innerHTML = '<div class="loading">Loading release information...</div>';

    try {
        const response = await fetch(`/api/releases/${nsForApi()}`);
        const releases = await response.json();

        if (releases.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎯</div><p>No releases found in this namespace</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.releasesData = releases;

        const calculateAge = (timestamp) => {
            const now = new Date();
            const date = new Date(timestamp);
            const diffMs = now - date;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
            
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return '1d ago';
            if (diffDays < 365) return `${diffDays}d ago`;
            const years = Math.floor(diffDays / 365);
            const remainingDays = diffDays % 365;
            return `${years}y${remainingDays}d ago`;
        };

        // Calculate stats
        const runningCount = releases.filter(r => {
            const status = r.helm_release?.status || 'Running';
            return status === 'deployed' || status === 'Running';
        }).length;
        const totalDeployments = releases.length;

        // Update stats in resource-controls
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini">
                    <span class="stat-mini-value">${totalDeployments}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${runningCount}</span>
                    <span class="stat-mini-label">Running</span>
                </div>
            </div>
        `;
        
        const controlsDiv = document.querySelector('#releases .resource-controls');
        if (controlsDiv) {
            const existingStats = controlsDiv.querySelector('.resource-stats');
            if (existingStats) existingStats.remove();
            controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
        }

        let html = `
            <table class="resource-table release-table">
                <thead>
                    <tr>
                        <th class="sortable" onclick="sortTable('releases', '.release-table', 0, 'string')">
                            Deployment<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('releases', '.release-table', 1, 'string')">
                            Version<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('releases', '.release-table', 2, 'string')">
                            Status<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('releases', '.release-table', 3, 'age')">
                            Created<span class="sort-icon"></span>
                        </th>
                        <th class="sortable" onclick="sortTable('releases', '.release-table', 4, 'age')">
                            Last Deployed<span class="sort-icon"></span>
                        </th>
                    </tr>
                </thead>
                <tbody>
        `;

        releases.forEach((release, idx) => {
            const version = release.version || release.helm_release?.app_version || '-';
            const createdAge = calculateAge(release.created_at);
            const lastDeployedAge = release.last_deployed ? calculateAge(release.last_deployed) : createdAge;
            const status = release.helm_release?.status || 'Running';
            const statusClass = status === 'deployed' || status === 'Running' ? 'badge-success' : 'badge-warning';

            html += `
                <tr class="clickable-row" onclick="openDetailPanel('releasesDetails', 'Release', '${release.namespace}', '${release.deployment_name}', window.releasesData[${idx}])">
                    <td><span class="mono-text">🚀 ${release.deployment_name}</span></td>
                    <td><span class="badge-secondary">${version}</span></td>
                    <td><span class="badge ${statusClass}">${status}</span></td>
                    <td>${createdAge}</td>
                    <td>${lastDeployedAge}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;

        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading releases</p><small>${error.message}</small></div>`;
    }
}

async function showReleaseDetails(deploymentName, namespace) {
    const container = document.getElementById('releaseDetails');
    container.innerHTML = '<div class="loading">Loading details...</div>';

    try {
        const response = await fetch(`/api/releases/${namespace}`);
        const releases = await response.json();
        const release = releases.find(r => r.deployment_name === deploymentName);

        if (!release) {
            container.innerHTML = '<p>Release not found</p>';
            return;
        }

        let html = `
            <div class="health-card">
                <h3>${release.deployment_name}</h3>
                <div class="info-grid">
                    <div class="info-item">
                        <strong>Namespace</strong>
                        <div>${release.namespace}</div>
                    </div>
                    <div class="info-item">
                        <strong>Created At</strong>
                        <div>${new Date(release.created_at).toLocaleString()}</div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = `<p style="color: var(--danger-color);">Error: ${error.message}</p>`;
    }
}

/* ============================================
   PV/PVC
   ============================================ */

async function loadPVPVC() {
    const container = document.getElementById('pvpvcContent');
    container.innerHTML = '<div class="loading">Loading PV/PVC information...</div>';

    try {
        const response = await fetch(`/api/pvpvc/${nsForApi()}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (!data.pvcs || (data.pvcs.length === 0 && (!data.unbound_pvs || data.unbound_pvs.length === 0))) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">💾</div><p>No persistent volumes or claims found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.pvpvcData = data;
        renderPVPVCTable(data, container);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading PV/PVC</p><small>${error.message}</small></div>`;
    }
}

function renderPVPVCTable(data, container) {
    const pvcCount = (data.pvcs && data.pvcs.length) || 0;
    const unboundCount = (data.unbound_pvs && data.unbound_pvs.length) || 0;
    const boundCount = data.pvcs ? data.pvcs.filter(p => p.status === 'Bound').length : 0;
    
    // Update stats in resource-controls
    const statsHtml = `
        <div class="resource-stats">
            <div class="stat-mini">
                <span class="stat-mini-value">${pvcCount}</span>
                <span class="stat-mini-label">Claims</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${boundCount}</span>
                <span class="stat-mini-label">Bound</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${unboundCount}</span>
                <span class="stat-mini-label">Unbound</span>
            </div>
        </div>
    `;
    
    const controlsDiv = document.querySelector('#pvpvc .resource-controls');
    if (controlsDiv) {
        const existingStats = controlsDiv.querySelector('.resource-stats');
        if (existingStats) existingStats.remove();
        controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
    }
    
    let html = '';

    if (data.pvcs && data.pvcs.length > 0) {
        html += `
            <h3 style="margin-top: 20px; margin-bottom: 12px;">Persistent Volume Claims</h3>
            <table class="resource-table pvc-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Storage</th>
                        <th>Access Mode</th>
                        <th>Used By</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.pvcs.forEach((pvc, idx) => {
            const statusClass = pvc.status === 'Bound' ? 'badge-success' :
                pvc.status === 'Pending' ? 'badge-warning' : 'badge-danger';
            const storage = pvc.actual_storage || pvc.requested_storage || '-';
            const accessModes = (pvc.access_modes || []).join(', ') || '-';
            const podCount = pvc.pod_count || 0;

            html += `
                <tr class="clickable-row" onclick="openDetailPanel('pvpvcDetails', 'PersistentVolumeClaim', '${pvc.namespace}', '${pvc.name}')">
                    <td>💾 ${pvc.name}</td>
                    <td><span class="badge ${statusClass}">${pvc.status}</span></td>
                    <td>${storage}</td>
                    <td><small>${accessModes}</small></td>
                    <td><span class="badge-${podCount > 0 ? 'success' : 'secondary'}">${podCount} pod${podCount !== 1 ? 's' : ''}</span></td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;
    }

    if (data.unbound_pvs && data.unbound_pvs.length > 0) {
        html += `
            <h3 style="margin-top: 20px; margin-bottom: 12px;">Unbound Persistent Volumes</h3>
            <table class="resource-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Capacity</th>
                        <th>Access Modes</th>
                        <th>Reclaim Policy</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.unbound_pvs.forEach(pv => {
            const statusClass = pv.status === 'Available' ? 'badge-success' : 'badge-warning';
            const accessModes = (pv.access_modes || []).join(', ') || '-';
            
            html += `
                <tr>
                    <td>💾 ${pv.name}</td>
                    <td><span class="badge ${statusClass}">${pv.status}</span></td>
                    <td>${pv.capacity}</td>
                    <td><small>${accessModes}</small></td>
                    <td><span class="badge-info">${pv.reclaim_policy || 'Retain'}</span></td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
        `;
    }

    container.innerHTML = html;
}

function renderPVCDetails(pvc) {
    let detailsHtml = '<div class="ingress-details-grid">';

    // Basic Info
    const accessModes = (pvc.access_modes || []).join(', ') || '-';
    const requestedStorage = pvc.requested_storage || '-';
    const actualStorage = pvc.actual_storage || pvc.storage_size || '-';
    const statusClass = pvc.status === 'Bound' ? 'success' :
                        pvc.status === 'Pending' ? 'warning' : 'danger';

    detailsHtml += `
        <div class="ingress-rule-card">
            <div class="ingress-rule-header">
                <strong>📋 Claim Details</strong>
            </div>
            <div class="ingress-paths">
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">STATUS</span>
                        <span class="badge badge-${statusClass}">${pvc.status || '-'}</span>
                    </div>
                </div>
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">NAMESPACE</span>
                        <code>${pvc.namespace || '-'}</code>
                    </div>
                </div>
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">ACCESS MODES</span>
                        <code>${accessModes}</code>
                    </div>
                </div>
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">REQUESTED</span>
                        <code>${requestedStorage}</code>
                    </div>
                    <div class="path-backend">
                        <span class="text-muted">Actual provisioned: ${actualStorage}</span>
                    </div>
                </div>
                ${pvc.storage_class ? `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">STORAGE CLASS</span>
                        <code>${pvc.storage_class}</code>
                    </div>
                </div>` : ''}
                ${pvc.volume_mode ? `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">VOLUME MODE</span>
                        <code>${pvc.volume_mode}</code>
                    </div>
                </div>` : ''}
                ${pvc.created_at ? `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">CREATED</span>
                        <code>${pvc.created_at}</code>
                    </div>
                    <div class="path-backend">
                        <span class="text-muted">Age: ${pvc.age_days || 0} day(s)</span>
                    </div>
                </div>` : ''}
            </div>
        </div>
    `;

    // PV Details
    if (pvc.pv_details) {
        const pv = pvc.pv_details;
        const pvDetails = pv.volume_details || {};
        let driverRows = '';

        if (pv.volume_type === 'CSI' && pvDetails.driver) {
            driverRows += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">DRIVER</span>
                        <code>${pvDetails.driver}</code>
                    </div>
                    ${pvDetails.fsType ? `<div class="path-backend"><span class="text-muted">fsType: ${pvDetails.fsType}</span></div>` : ''}
                </div>
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">VOLUME HANDLE</span>
                        <code>${pvDetails.volumeHandle || '-'}</code>
                    </div>
                </div>
            `;
        } else if (pv.volume_type === 'NFS' && pvDetails.server) {
            driverRows += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">NFS SERVER</span>
                        <code>${pvDetails.server}${pvDetails.path || ''}</code>
                    </div>
                </div>
            `;
        } else if (pv.volume_type === 'AWS EBS' && pvDetails.volumeID) {
            driverRows += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">EBS VOLUME</span>
                        <code>${pvDetails.volumeID}</code>
                    </div>
                    ${pvDetails.fsType ? `<div class="path-backend"><span class="text-muted">fsType: ${pvDetails.fsType}</span></div>` : ''}
                </div>
            `;
        } else if ((pv.volume_type === 'HostPath' || pv.volume_type === 'Local') && pvDetails.path) {
            driverRows += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">PATH</span>
                        <code>${pvDetails.path}</code>
                    </div>
                </div>
            `;
        }

        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>💾 Persistent Volume</strong>
                </div>
                <div class="ingress-paths">
                    <div class="ingress-path-item">
                        <div class="path-route">
                            <span class="path-badge">NAME</span>
                            <code>${pvc.volume_name || pv.name || 'N/A'}</code>
                        </div>
                        <div class="path-backend">
                            <span class="text-muted">Status: ${pv.status || '-'}</span>
                        </div>
                    </div>
                    <div class="ingress-path-item">
                        <div class="path-route">
                            <span class="path-badge">TYPE</span>
                            <code>${pv.volume_type || 'Unknown'}</code>
                        </div>
                        <div class="path-backend">
                            <span class="text-muted">Capacity: ${pv.capacity || '-'} | Mode: ${pv.volume_mode || 'Filesystem'}</span>
                        </div>
                    </div>
                    <div class="ingress-path-item">
                        <div class="path-route">
                            <span class="path-badge">RECLAIM</span>
                            <code>${pv.reclaim_policy || 'Retain'}</code>
                        </div>
                    </div>
                    ${driverRows}
                </div>
            </div>
        `;
    }

    // Pods using this PVC
    if (pvc.pod_details && pvc.pod_details.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>📦 Pods Using This Volume (${pvc.pod_details.length})</strong>
                </div>
                <div class="ingress-paths">
        `;

        pvc.pod_details.forEach(pod => {
            const podStatusClass = pod.status === 'Running' ? 'success' :
                                   pod.status === 'Pending' ? 'warning' : 'danger';
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge ${podStatusClass}">${pod.status}</span>
                        <code>${pod.name}</code>
                    </div>
                    <div class="path-backend">
                        <span class="text-muted">Node: ${pod.node || 'N/A'} | Restarts: ${pod.restart_count || 0} | Age: ${pod.age_days || 0}d</span>
                    </div>
                </div>
            `;
        });

        detailsHtml += '</div></div>';
    } else {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>📦 Pods Using This Volume</strong>
                </div>
                <div class="ingress-paths">
                    <div class="ingress-path-item">
                        <div class="path-route"><span class="text-muted">No pods currently using this volume</span></div>
                    </div>
                </div>
            </div>
        `;
    }

    // Labels
    if (pvc.labels && Object.keys(pvc.labels).length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🏷️ Labels</strong>
                </div>
                <div class="ingress-paths">
                    ${Object.entries(pvc.labels).map(([k, v]) => `
                        <div class="ingress-path-item">
                            <div class="path-route">
                                <span class="path-badge">LABEL</span>
                                <code>${k}</code>
                            </div>
                            <div class="path-backend"><span class="text-muted">${v}</span></div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    detailsHtml += '</div>';
    return detailsHtml;
}

function togglePVCDetails(pvcId) {
    const detailsRow = document.getElementById(`${pvcId}-details`);
    const icon = document.getElementById(`${pvcId}-icon`);
    
    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   RESOURCE VIEWER
   ============================================ */

function filterTable(tab) {
    let searchId;
    if (tab === 'ingresses') {
        searchId = 'ingressSearchFilter';
    } else if (tab === 'services') {
        searchId = 'serviceSearchFilter';
    } else if (tab === 'pods') {
        searchId = 'podSearchFilter';
    } else if (tab === 'deployments') {
        searchId = 'deploymentSearchFilter';
    } else if (tab === 'configmaps') {
        searchId = 'configmapSearchFilter';
    } else if (tab === 'secrets') {
        searchId = 'secretSearchFilter';
    } else if (tab === 'releases') {
        searchId = 'releaseSearchFilter';
    } else {
        return;
    }
    
    const search = document.getElementById(searchId);
    if (!search) return;
    
    const filter = search.value.toLowerCase();
    const container = document.getElementById(`${tab}Content`) || document.getElementById(`${tab}Results`) || document.getElementById(tab);
    if (!container) return;
    
    // Filter table rows - handle both regular rows and expandable rows
    const table = container.querySelector('table');
    if (!table) return;
    
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(row => {
        // Skip detail rows - they should always be hidden initially
        if (row.classList.contains('ingress-details-row') || 
            row.classList.contains('service-details-row') ||
            row.classList.contains('deployment-details-row') ||
            row.classList.contains('configmap-details-row') ||
            row.classList.contains('secret-details-row') ||
            row.classList.contains('release-details-row')) {
            // Always hide detail rows when filtering
            row.style.display = 'none';
            return;
        }
        
        const text = row.textContent.toLowerCase();
        const matches = text.includes(filter);
        row.style.display = matches ? '' : 'none';
        
        // Reset the icon state for collapsed rows when filtering
        if (matches && row.classList.contains('expandable')) {
            const rowId = row.getAttribute('onclick');
            if (rowId) {
                // Extract the ID from onclick attribute
                const match = rowId.match(/'([^']+)'/);
                if (match) {
                    const id = match[1];
                    const icon = document.getElementById(`${id}-icon`);
                    if (icon) {
                        icon.textContent = '▶';
                        icon.classList.remove('expanded');
                    }
                }
            }
        }
    });
}


async function loadAllResources() {
    console.log('loadAllResources called');
    
    const container = document.getElementById('resourceList');
    const detailsContainer = document.getElementById('resourceDetails');
    const resourceType = document.getElementById('resourceTypeFilter').value;

    if (!container) {
        console.error('resourceList container not found!');
        return;
    }

    container.innerHTML = '<div class="loading">⚡ Loading resources...</div>';
    detailsContainer.innerHTML = '';
    detailsContainer.classList.remove('active');

    try {
        const startTime = Date.now();
        const typeFilter = resourceType !== 'all' ? `&resource_type=${resourceType}` : '';
        const url = `/api/resources/${nsForApi()}?limit=500${typeFilter}&lightweight=true`;
        console.log('Fetching resources from:', url);
        
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const loadTime = ((Date.now() - startTime) / 1000).toFixed(2);

        let resources, total, cached, fetchTime;
        if (Array.isArray(data)) {
            resources = data;
            total = data.length;
            cached = false;
        } else {
            resources = data.resources || [];
            total = data.total || resources.length;
            cached = data.cached || false;
            fetchTime = data.fetch_time;
        }

        if (resources.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>No resources found</p></div>';
            return;
        }

        const grouped = {};
        resources.forEach(r => {
            if (!grouped[r.resource_type]) {
                grouped[r.resource_type] = [];
            }
            grouped[r.resource_type].push(r);
        });

        // Update stats in resource-controls
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini">
                    <span class="stat-mini-value">${total}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${Object.keys(grouped).length}</span>
                    <span class="stat-mini-label">Types</span>
                </div>
                <div class="stat-mini" style="min-width: 80px;">
                    <span class="stat-mini-value" style="font-size: 16px;">${cached ? '📦' : '⚡'}</span>
                    <span class="stat-mini-label">${cached ? 'Cached' : `${fetchTime || loadTime}s`}</span>
                </div>
            </div>
        `;
        
        const controlsDiv = document.querySelector('#resourceViewer .resource-controls');
        if (controlsDiv) {
            const existingStats = controlsDiv.querySelector('.resource-stats');
            if (existingStats) existingStats.remove();
            controlsDiv.insertAdjacentHTML('afterbegin', statsHtml);
        }

        let html = `
            <div class="resource-explorer-layout">
                <table class="resource-table">
                <thead>
                    <tr>
                        <th style="width: 30px;"></th>
                        <th>Type</th>
                        <th>Name</th>
                        <th>Namespace</th>
                        <th>Status</th>
                        <th>Health</th>
                    </tr>
                </thead>
                <tbody>
        `;

        // Sort resources by type then name
        resources.sort((a, b) => {
            if (a.resource_type !== b.resource_type) {
                return a.resource_type.localeCompare(b.resource_type);
            }
            return a.name.localeCompare(b.name);
        });

        resources.forEach((item, idx) => {
            const resourceId = `resource-${idx}`;
            const icon = getResourceIcon(item.resource_type);
            const healthScore = item.health_score || 0;
            const healthEmoji = healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴';
            const healthBadge = healthScore >= 80 ? 'badge-success' : healthScore >= 60 ? 'badge-warning' : 'badge-danger';
            const status = item.status || 'Unknown';

            // Main row with expand icon
            html += `
                <tr class="resource-row expandable" onclick="toggleResourceDetails('${resourceId}', '${item.resource_type}', '${item.namespace}', '${item.name}')">
                    <td class="expand-icon">
                        <span id="${resourceId}-icon" class="collapse-icon">▶</span>
                    </td>
                    <td><span class="badge-info">${icon} ${item.resource_type}</span></td>
                    <td>${item.name}</td>
                    <td><span class="badge-secondary">${item.namespace}</span></td>
                    <td><span class="badge-info">${status}</span></td>
                    <td><span class="${healthBadge}">${healthEmoji} ${healthScore}%</span></td>
                </tr>
                <tr id="${resourceId}-details" class="resource-details-row" style="display: none;">
                    <td colspan="6">
                        <div class="resource-details-content" id="${resourceId}-content">
                            <div class="loading-small">Loading details...</div>
                        </div>
                    </td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            </div>
        `;

        container.innerHTML = html;
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading resources</p><small>${error.message}</small></div>`;
    }
}

function getTypeColor(type) {
    const colors = {
        'Ingress': '#3B82F6',
        'Service': '#10B981',
        'Deployment': '#8B5CF6',
        'Pod': '#F59E0B',
        'StatefulSet': '#EF4444',
        'DaemonSet': '#06B6D4',
        'Job': '#EC4899',
        'CronJob': '#6366F1'
    };
    return colors[type] || '#6B7280';
}

async function loadResourceDetails(resourceType, namespace, name) {
    const container = document.getElementById('resourceDetails');
    container.classList.add('active');
    container.innerHTML = '<div class="loading">Loading details...</div>';
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    try {
        const url = `/api/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
        const response = await fetch(url);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const resource = await response.json();

        const healthEmoji = resource.health_score >= 80 ? '🟢' : resource.health_score >= 60 ? '🟡' : '🔴';
        const statusColor = getStatusColor(resource.health_score);

        let html = `
            <div class="details-resizer"></div>
            <div class="details-header">
                <div class="details-title-section">
                    <span class="details-icon">${healthEmoji}</span>
                    <div class="details-title-content">
                        <h3 class="details-name">${resource.name}</h3>
                        <span class="details-subtitle">${resourceType} in ${resource.namespace}</span>
                    </div>
                </div>
                <div class="details-badges">
                    <span class="status-badge" style="background: ${statusColor}20; color: ${statusColor}; border: 1px solid ${statusColor};">
                        Health: ${resource.health_score}%
                    </span>
                    <span class="status-badge" style="background: var(--accent-primary)20; color: var(--accent-primary); border: 1px solid var(--accent-primary);">
                        ${resource.status}
                    </span>
                </div>
                <button class="close-details" onclick="closeResourceDetails()">×</button>
            </div>
            <div class="details-body">
                ${formatDetails(resource.details)}
        `;

        if (resource.relationships && resource.relationships.length > 0) {
            const relGroups = {};
            resource.relationships.forEach(rel => {
                if (!relGroups[rel.relationship_type]) {
                    relGroups[rel.relationship_type] = [];
                }
                relGroups[rel.relationship_type].push(rel);
            });

            const relId = `relationships-explorer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            html += '<div class="details-section collapsible-section">';
            html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${relId}')">`;
            html += `<span class="collapse-icon" id="${relId}-icon">▼</span>`;
            html += '<span class="section-icon">🔗</span>Relationships</h4>';
            html += `<div class="section-content" id="${relId}" style="display: block;">`;
            html += '<div class="relationships-tree">';

            Object.keys(relGroups).forEach(relType => {
                html += `<div class="relationship-group">`;
                html += `<div class="relationship-type-header">${relType}</div>`;
                relGroups[relType].forEach(rel => {
                    const resourceName = rel.resource_name || rel.target_name || 'Unknown';
                    const targetType = rel.target_type || 'Resource';
                    const targetNamespace = rel.target_namespace || resource.namespace;
                    const icon = rel.icon || '→';
                    const canExpand = isExpandableResourceType(targetType);
                    
                    html += `
                        <div class="relationship-item ${canExpand ? 'expandable' : 'leaf'}" data-type="${targetType}" data-namespace="${targetNamespace}" data-name="${resourceName}">
                            <div class="rel-content">
                                ${canExpand ? '<span class="rel-toggle">▶</span>' : '<span class="rel-leaf-dot">•</span>'}
                                <span class="rel-icon">${icon}</span>
                                <span class="rel-name">${resourceName}</span>
                                <span class="rel-type-badge">${targetType}</span>
                            </div>
                            ${canExpand ? '<div class="rel-children" style="display: none;"><div class="loading-small">Loading...</div></div>' : ''}
                        </div>
                    `;
                });
                html += '</div>';
            });

            html += '</div></div></div>'; // Close relationships-tree, section-content, and details-section
        }

        html += '</div>';
        container.innerHTML = html;
        
        // Initialize resizer
        initializeDetailsResizer();
    } catch (error) {
        container.innerHTML = `
            <div class="details-resizer"></div>
            <div class="details-header">
                <div class="details-title-section">
                    <div class="details-title-content">
                        <h3 class="details-name">Error Loading Details</h3>
                    </div>
                </div>
                <button class="close-details" onclick="closeResourceDetails()">×</button>
            </div>
            <div class="details-body">
                <p style="color: var(--danger-color);">${error.message}</p>
            </div>
        `;
        
        // Initialize resizer even on error
        initializeDetailsResizer();
    }
}

function closeResourceDetails() {
    const container = document.getElementById('resourceDetails');
    container.classList.remove('active');
    setTimeout(() => {
        container.innerHTML = '';
    }, 300);
}

// Initialize resizer for resource details panel
function initializeDetailsResizer() {
    const resizer = document.querySelector('.details-resizer');
    const panel = document.getElementById('resourceDetails');
    
    if (!resizer || !panel) return;
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        resizer.classList.add('resizing');
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = startX - e.clientX;
        const newWidth = startWidth + deltaX;
        
        // Enforce min and max width
        if (newWidth >= 350 && newWidth <= 800) {
            panel.style.width = `${newWidth}px`;
        }
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Handle relationship expansion
document.addEventListener('click', async function(e) {
    const relItem = e.target.closest('.relationship-item.expandable');
    if (!relItem) return;
    
    const toggle = relItem.querySelector('.rel-toggle');
    const children = relItem.querySelector('.rel-children');
    const isExpanded = toggle.textContent === '▼';
    
    if (isExpanded) {
        toggle.textContent = '▶';
        toggle.classList.remove('loading');
        children.style.display = 'none';
    } else {
        // Show loading state on toggle
        toggle.classList.add('loading');
        toggle.textContent = '⟳';
        children.style.display = 'block';
        // Scroll the expanded item into view so user can see the content
        relItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Load relationships if not already loaded
        if (children.querySelector('.loading-small')) {
            let resourceType = relItem.dataset.type;
            const namespace = relItem.dataset.namespace;
            const name = relItem.dataset.name;
            
            // If resourceType is 'Resource', try to infer from relationship type
            if (!resourceType || resourceType === 'Resource') {
                // Try to detect from the name or context
                if (name.includes('svc') || name.includes('service')) {
                    resourceType = 'Service';
                } else if (name.includes('deployment') || name.includes('deploy')) {
                    resourceType = 'Deployment';
                } else if (name.includes('pod')) {
                    resourceType = 'Pod';
                } else if (name.includes('ingress')) {
                    resourceType = 'Ingress';
                } else {
                    // Default to Service as it's most common in relationships
                    resourceType = 'Service';
                }
            }
            
            try {
                const url = `/api/resource/${encodeURIComponent(resourceType)}/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
                console.log('Fetching relationship details:', url);
                const response = await fetch(url);
                
                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('API Error:', response.status, errorText);
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                console.log('Received relationship data:', data);
                
                if (data.relationships && data.relationships.length > 0) {
                    let html = '';
                    data.relationships.forEach(rel => {
                        const resourceName = rel.resource_name || rel.target_name || 'Unknown';
                        const targetType = rel.target_type || rel.resource_type || 'Resource';
                        const targetNamespace = rel.target_namespace || namespace;
                        const icon = rel.icon || '→';
                        const canExpand = isExpandableResourceType(targetType);
                        
                        html += `
                            <div class="relationship-item ${canExpand ? 'expandable' : 'leaf'} nested" data-type="${targetType}" data-namespace="${targetNamespace}" data-name="${resourceName}">
                                <div class="rel-content">
                                    ${canExpand ? '<span class="rel-toggle">▶</span>' : '<span class="rel-leaf-dot">•</span>'}
                                    <span class="rel-icon">${icon}</span>
                                    <span class="rel-name">${resourceName}</span>
                                    <span class="rel-type-badge">${targetType}</span>
                                </div>
                                ${canExpand ? '<div class="rel-children" style="display: none;"><div class="loading-small">Loading...</div></div>' : ''}
                            </div>
                        `;
                    });
                    children.innerHTML = html;
                    // Scroll to show newly loaded children
                    children.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } else {
                    children.innerHTML = '<div class="no-relationships">No further relationships</div>';
                }
            } catch (error) {
                console.error('Failed to load relationships:', error);
                children.innerHTML = `<div class="error-small">Failed to load: ${error.message}</div>`;
            } finally {
                // Remove loading state and show expanded arrow
                toggle.classList.remove('loading');
                toggle.textContent = '▼';
            }
        }
    }
    
    e.stopPropagation();
});

function getResourceIcon(resourceType) {
    const icons = {
        'Ingress': '🌐',
        'Service': '🔗',
        'Pod': '📦',
        'Deployment': '🏗️',
        'StatefulSet': '💾',
        'DaemonSet': '👥',
        'Job': '⚡',
        'CronJob': '⏰'
    };
    return icons[resourceType] || '📄';
}

// Resource types that have meaningful further relationships worth expanding
function isExpandableResourceType(type) {
    const expandable = new Set([
        'Pod', 'Deployment', 'StatefulSet', 'DaemonSet',
        'Service', 'Ingress', 'Job', 'CronJob', 'ReplicaSet'
    ]);
    return expandable.has(type);
}

function getStatusColor(healthScore) {
    if (healthScore >= 80) return '#AAD94C';
    if (healthScore >= 60) return '#FFB454';
    return '#F07178';
}

function formatDetails(details) {
    let html = '';

    if (!details) return html;

    // Labels - make collapsible
    if (details.labels && Object.keys(details.labels).length > 0) {
        const labelsId = `labels-explorer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="info-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${labelsId}')">`;
        html += `<span class="collapse-icon" id="${labelsId}-icon">▼</span>`;
        html += '<span class="section-icon">🏷️</span>Labels</h4>';
        html += `<div class="section-content" id="${labelsId}" style="display: block;">`;
        html += '<div class="labels-container">';
        Object.keys(details.labels).forEach(key => {
            html += `<span class="label-badge">${key}: ${details.labels[key]}</span>`;
        });
        html += '</div></div></div>';
    }

    return html;
}

function filterResources() {
    const searchText = document.getElementById('resourceSearchFilter').value.toLowerCase();
    const cards = document.querySelectorAll('#resourceList .card');

    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        if (text.includes(searchText)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

/* ============================================
   CACHE MANAGEMENT
   ============================================ */

async function clearCache() {
    try {
        const response = await fetch('/api/cache/clear', { method: 'POST' });
        const result = await response.json();
        alert(result.message);
        updateCacheStats();
        refreshCurrentTab();
    } catch (error) {
        alert('Error clearing cache: ' + error.message);
    }
}

// Cache stats removed - no longer needed
// async function updateCacheStats() { ... }

/* ============================================
   PERFORMANCE MONITORING
   ============================================ */

// Display API fetch strategy in console
function logFetchStrategy() {
    console.log('%c⚡ API Fetch Performance Strategy', 'font-weight: bold; font-size: 14px; color: #3b82f6;');
    console.log('%cPriority-based batched fetching enabled', 'color: #22c55e;');
    console.log('');
    console.log('%c┌─ Priority Tiers & Auto-Refresh Intervals:', 'font-weight: bold;');
    
    const priorities = [
        { name: 'HIGH', interval: 30, resources: 'Pods, Events', color: '#ef4444' },
        { name: 'MEDIUM_HIGH', interval: 45, resources: 'Endpoints, Nodes', color: '#f59e0b' },
        { name: 'MEDIUM', interval: 60, resources: 'Deployments, StatefulSets, DaemonSets', color: '#eab308' },
        { name: 'MEDIUM_LOW', interval: 90, resources: 'Jobs, CronJobs', color: '#3b82f6' },
        { name: 'LOW', interval: 120, resources: 'Services', color: '#8b5cf6' },
        { name: 'LOWEST', interval: 180, resources: 'ConfigMaps, Secrets, Ingresses, PVCs, etc.', color: '#64748b' }
    ];
    
    priorities.forEach(p => {
        console.log(`%c│  ${p.name.padEnd(12)} %c→ ${p.interval}s refresh  %c│ ${p.resources}`, 
            `font-weight: bold; color: ${p.color}`,
            'color: #94a3b8;',
            'color: #64748b;'
        );
    });
    
    console.log('└─────────────────────────────────────────');
    console.log('');
    console.log('%c💡 Benefits:', 'font-weight: bold; color: #22c55e;');
    console.log('  • Critical data loads first (<2s)');
    console.log('  • ~60% reduction in API calls');
    console.log('  • Lower server load');
    console.log('  • Smart auto-refresh per priority');
    console.log('');
}

/* ============================================
   INITIALIZATION
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded - Initializing dashboard...');
    
    try {
        // Initialize connection health monitoring
        startHealthMonitoring();
        console.log('✓ Health monitoring started');
        
        // Display performance strategy
        logFetchStrategy();
        
        loadThemePreference();
        console.log('✓ Theme loaded');
        
        loadSidebarState();
        console.log('✓ Sidebar state loaded');
        
        initializeClocks();
        console.log('✓ Clocks initialized');
        
        loadClusters();
        console.log('⟳ Loading clusters...');
        
        loadClusterInfo();
        console.log('⟳ Loading cluster info...');
        
        // Load overview dashboard on initial page load
        console.log('⟳ Loading overview dashboard with priority-based batching...');
        loadOverview();
        
        console.log('%c✅ Dashboard initialized successfully', 'font-weight: bold; color: #22c55e;');
    } catch (error) {
        console.error('Error during initialization:', error);
    }
});
