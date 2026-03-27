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

/* ============================================
   THEME MANAGEMENT
   ============================================ */

function toggleTheme() {
    const html = document.documentElement;
    const themeIcon = document.getElementById('themeIcon');

    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        themeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>';
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        themeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>';
        localStorage.setItem('theme', 'dark');
    }
}

function loadThemePreference() {
    const savedTheme = localStorage.getItem('theme');
    const html = document.documentElement;
    const themeIcon = document.getElementById('themeIcon');

    if (savedTheme === 'light') {
        html.classList.remove('dark');
        if (themeIcon) {
            themeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path>';
        }
    } else {
        html.classList.add('dark');
        if (themeIcon) {
            themeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path>';
        }
    }
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
   TAB NAVIGATION
   ============================================ */

function selectTab(event, tabName) {
    event.preventDefault();
    currentTab = tabName;

    // Close mobile sidebar when a tab is selected
    toggleMobileSidebar();

    // Update active menu item - remove from all, add to clicked
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active', 'text-white', 'bg-primary-600', 'dark:bg-primary-500');
        item.classList.add('text-gray-700', 'dark:text-gray-300', 'hover:bg-gray-100', 'dark:hover:bg-gray-700');
    });
    
    const activeItem = event.target.closest('.nav-item');
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
        return;
    }

    console.log(`Fetching fresh data for tab: ${tabName}`);
    
    switch (tabName) {
        case 'overview':
            await loadOverview();
            tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
            break;
        case 'resourceViewer':
            loadAllResources();
            // Mark as loaded after the load function is called
            tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
            break;
        case 'ingresses':
            loadIngresses();
            tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
            break;
        case 'services':
            loadServices();
            tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
            break;
        case 'pods':
            loadPods();
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
            await loadHealth();
            tabDataCache[tabName] = { namespace: currentNamespace, loaded: true };
            break;
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
        case 'network':
            // Network loads on button click
            break;
    }
}

/* ============================================
   CLUSTER & NAMESPACE
   ============================================ */

async function loadClusterInfo() {
    const clusterInfoEl = document.getElementById('clusterInfo');
    
    try {
        const response = await fetch('/api/cluster');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();

        clusterInfoEl.innerHTML = `
            <span>🏗️ Cluster: ${data.cluster_name || 'Unknown'}</span>
        `;

        // Populate namespace selector
        const select = document.getElementById('namespaceSelect');
        if (select && data.namespaces && data.namespaces.length > 0) {
            select.innerHTML = data.namespaces.map(ns =>
                `<option value="${ns}">${ns}</option>`
            ).join('');
            
            // Set current namespace to the first one if default doesn't exist
            const hasDefault = data.namespaces.includes('default');
            if (!hasDefault) {
                currentNamespace = data.namespaces[0];
                select.value = currentNamespace;
            }
        }
    } catch (error) {
        console.error('Error loading cluster info:', error);
        clusterInfoEl.innerHTML = `<span style="color: var(--danger-color);">⚠️ ${error.message}</span>`;
    }
}

function changeNamespace() {
    currentNamespace = document.getElementById('namespaceSelect').value;
    tabDataCache = {}; // Clear cache when namespace changes
    refreshCurrentTab();
}

function refreshCurrentTab() {
    // Clear cache for current tab to force reload
    delete tabDataCache[currentTab];
    loadTabData(currentTab);
}

/* ============================================
   OVERVIEW DASHBOARD
   ============================================ */

async function loadOverview() {
    try {
        console.log('Loading overview dashboard...');
        
        // Load stats in parallel
        const [pods, deployments, services, health, cluster] = await Promise.all([
            fetch(`/api/pods/${currentNamespace}`).then(r => r.json()),
            fetch(`/api/deployments/${currentNamespace}`).then(r => r.json()),
            fetch(`/api/services/${currentNamespace}`).then(r => r.json()),
            fetch(`/api/health/${currentNamespace}`).then(r => r.json()),
            fetch('/api/cluster').then(r => r.json())
        ]);

        console.log('API Data received:', { pods, deployments, services, health, cluster });

        // Update stat cards
        updateStatCards(pods, deployments, services, health);
        
        // Update cluster details
        updateClusterDetails(cluster);
        
        // Update health details in overview
        updateOverviewHealthDetails(health);
        
        console.log('Overview dashboard loaded successfully');
    } catch (error) {
        console.error('Error loading overview:', error);
    }
}

function updateStatCards(pods, deployments, services, health) {
    try {
        // Handle both array and object formats
        const podsArray = Array.isArray(pods) ? pods : (pods.pods || []);
        const deploymentsArray = Array.isArray(deployments) ? deployments : (deployments.deployments || []);
        const servicesArray = Array.isArray(services) ? services : (services.services || []);
        
        // Total Pods
        const totalPods = podsArray.length;
        const runningPods = podsArray.filter(p => p.status === 'Running').length;
        const statTotalPodsEl = document.getElementById('statTotalPods');
        const statPodsRunningEl = document.getElementById('statPodsRunning');
        if (statTotalPodsEl) statTotalPodsEl.textContent = totalPods;
        if (statPodsRunningEl) statPodsRunningEl.textContent = `${runningPods} running`;
        
        // Deployments
        const totalDeployments = deploymentsArray.length;
        const readyDeployments = deploymentsArray.filter(d => d.ready_replicas === d.desired_replicas).length;
        const statDeploymentsEl = document.getElementById('statDeployments');
        const statDeploymentsReadyEl = document.getElementById('statDeploymentsReady');
        if (statDeploymentsEl) statDeploymentsEl.textContent = totalDeployments;
        if (statDeploymentsReadyEl) statDeploymentsReadyEl.textContent = `${readyDeployments} ready`;
        
        // Services
        const totalServices = servicesArray.length;
        const serviceTypes = servicesArray.map(s => s.type);
        const clusterIPs = serviceTypes.filter(t => t === 'ClusterIP').length;
        const statServicesEl = document.getElementById('statServices');
        const statServicesTypeEl = document.getElementById('statServicesType');
        if (statServicesEl) statServicesEl.textContent = totalServices;
        if (statServicesTypeEl) statServicesTypeEl.textContent = `${clusterIPs} ClusterIP`;
        
        // Health Score
        let healthScore = 'N/A';
        let healthStatus = 'Unknown';
        let healthColor = 'text-gray-600 dark:text-gray-400';
        
        if (health) {
            // Calculate total healthy resources
            const healthyPods = (health.pod_health && health.pod_health.healthy) || 0;
            const healthyDeployments = (health.deployment_health && health.deployment_health.healthy) || 0;
            const healthyServices = (health.service_health && health.service_health.with_endpoints) || 0;
            
            const totalPods = health.pod_count || 0;
            const totalDeployments = health.deployment_count || 0;
            const totalServices = health.service_count || 0;
            
            const healthy = healthyPods + healthyDeployments + healthyServices;
            const total = totalPods + totalDeployments + totalServices;
            
            const percentage = total > 0 ? Math.round((healthy / total) * 100) : 0;
            healthScore = `${percentage}%`;
            
            if (percentage >= 90) {
                healthStatus = '✓ Healthy';
                healthColor = 'text-green-600 dark:text-green-400';
            } else if (percentage >= 70) {
                healthStatus = '⚠ Warning';
                healthColor = 'text-yellow-600 dark:text-yellow-400';
            } else {
                healthStatus = '✗ Critical';
                healthColor = 'text-red-600 dark:text-red-400';
            }
        }
        
        const statHealthScoreEl = document.getElementById('statHealthScore');
        const healthStatusEl = document.getElementById('statHealthStatus');
        if (statHealthScoreEl) statHealthScoreEl.textContent = healthScore;
        if (healthStatusEl) {
            healthStatusEl.textContent = healthStatus;
            healthStatusEl.className = `text-sm font-medium ${healthColor}`;
        }
        
        console.log('Stat cards updated successfully');
    } catch (error) {
        console.error('Error updating stat cards:', error);
    }
}

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

function updateClusterDetails(cluster) {
    const detailsEl = document.getElementById('clusterDetails');
    if (!detailsEl) return;
    
    let html = '';
    html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Cluster Name:</span> <span class="ml-2">${cluster.cluster_name || 'Unknown'}</span></p>`;
    html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Context:</span> <span class="ml-2">${cluster.context_name || 'Unknown'}</span></p>`;
    html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Total Namespaces:</span> <span class="ml-2">${cluster.namespaces ? cluster.namespaces.length : 0}</span></p>`;
    
    if (cluster.namespaces && cluster.namespaces.length > 0) {
        html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Namespaces:</span></p>`;
        html += '<div class="flex flex-wrap gap-2 mt-2">';
        cluster.namespaces.slice(0, 10).forEach(ns => {
            html += `<span class="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs">${ns}</span>`;
        });
        if (cluster.namespaces.length > 10) {
            html += `<span class="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded text-xs">+${cluster.namespaces.length - 10} more</span>`;
        }
        html += '</div>';
    }
    
    detailsEl.innerHTML = html;
}

function updateOverviewHealthDetails(health) {
    const detailsEl = document.getElementById('overviewHealthDetails');
    if (!detailsEl) return;
    
    let html = '';
    
    if (health) {
        // Calculate total healthy and unhealthy resources
        const healthyPods = (health.pod_health && health.pod_health.healthy) || 0;
        const degradedPods = (health.pod_health && health.pod_health.degraded) || 0;
        const criticalPods = (health.pod_health && health.pod_health.critical) || 0;
        
        const healthyDeployments = (health.deployment_health && health.deployment_health.healthy) || 0;
        const degradedDeployments = (health.deployment_health && health.deployment_health.degraded) || 0;
        const criticalDeployments = (health.deployment_health && health.deployment_health.critical) || 0;
        
        const healthyServices = (health.service_health && health.service_health.with_endpoints) || 0;
        const unhealthyServices = (health.service_health && health.service_health.without_endpoints) || 0;
        
        const totalPods = health.pod_count || 0;
        const totalDeployments = health.deployment_count || 0;
        const totalServices = health.service_count || 0;
        const totalNodes = (health.nodes && health.nodes.length) || 0;
        
        const healthy = healthyPods + healthyDeployments + healthyServices;
        const unhealthy = (degradedPods + criticalPods) + (degradedDeployments + criticalDeployments) + unhealthyServices;
        const total = totalPods + totalDeployments + totalServices + totalNodes;
        const percentage = total > 0 ? Math.round((healthy / total) * 100) : 0;
        
        html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Total Resources:</span> <span class="ml-2">${total}</span></p>`;
        html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Healthy:</span> <span class="ml-2 text-green-600 dark:text-green-400">${healthy}</span></p>`;
        html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Unhealthy:</span> <span class="ml-2 text-red-600 dark:text-red-400">${unhealthy}</span></p>`;
        html += `<p class="mb-2"><span class="font-medium text-gray-900 dark:text-white">Health Score:</span> <span class="ml-2">${percentage}%</span></p>`;
        
        // Show resource breakdown
        html += '<div class="mt-4">';
        html += '<p class="font-medium text-gray-900 dark:text-white mb-2">Resource Breakdown:</p>';
        html += '<div class="flex flex-wrap gap-2">';
        
        if (totalPods > 0) {
            html += `<span class="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded text-xs">Pods: ${totalPods}</span>`;
        }
        if (totalDeployments > 0) {
            html += `<span class="px-2 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded text-xs">Deployments: ${totalDeployments}</span>`;
        }
        if (totalServices > 0) {
            html += `<span class="px-2 py-1 bg-indigo-100 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 rounded text-xs">Services: ${totalServices}</span>`;
        }
        if (totalNodes > 0) {
            html += `<span class="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded text-xs">Nodes: ${totalNodes}</span>`;
        }
        
        html += '</div>';
        html += '</div>';
    } else {
        html = '<p class="text-gray-500 dark:text-gray-400">No health data available</p>';
    }
    
    detailsEl.innerHTML = html;
}

/* ============================================
   INGRESSES
   ============================================ */

async function loadIngresses() {
    const container = document.getElementById('ingressesContent');
    container.innerHTML = '<div class="loading">Loading ingresses...</div>';

    try {
        const response = await fetch(`/api/ingresses/${currentNamespace}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const ingresses = await response.json();

        if (!Array.isArray(ingresses)) {
            throw new Error('Invalid response format');
        }

        if (ingresses.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🌐</div><p>No ingresses found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.ingressesData = ingresses;
        renderIngressesTable(ingresses, container);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading ingresses</p><small>${error.message}</small></div>`;
    }
}

function renderIngressesTable(ingresses, container) {
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
            <tr class="clickable-row" onclick="openDetailPanel('ingressesDetails', 'Ingress', '${currentNamespace}', '${ing.name}', window.ingressesData[${idx}])">
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
    let detailsHtml = '<div class="ingress-details-grid">';
    
    if (ing.rules && ing.rules.length > 0) {
        ing.rules.forEach((rule, ruleIdx) => {
            const host = rule.host || '*';
            
            detailsHtml += `
                <div class="ingress-rule-card">
                    <div class="ingress-rule-header">
                        <strong>🌐 Host:</strong> <span class="badge-host">${host}</span>
                    </div>
            `;
            
            if (rule.paths && rule.paths.length > 0) {
                detailsHtml += '<div class="ingress-paths">';
                rule.paths.forEach(path => {
                    const pathType = path.path_type || 'Prefix';
                    const pathValue = path.path || '/';
                    const serviceName = path.service_name || 'N/A';
                    const servicePort = path.service_port || 'N/A';
                    
                    detailsHtml += `
                        <div class="ingress-path-item">
                            <div class="path-route">
                                <span class="path-badge">${pathType}</span>
                                <code>${pathValue}</code>
                            </div>
                            <div class="path-backend">
                                <span class="text-muted">→</span>
                                <span class="service-link">🔗 ${serviceName}:${servicePort}</span>
                            </div>
                        </div>
                    `;
                });
                detailsHtml += '</div>';
            } else {
                detailsHtml += '<div class="text-muted">No paths configured</div>';
            }
            
            detailsHtml += '</div>';
        });
    }
    
    // Show Kong plugins if available
    if (ing.kong_plugins && ing.kong_plugins.length > 0) {
        detailsHtml += `
            <div class="ingress-plugins">
                <strong>🔌 Kong Plugins:</strong>
                <div class="plugin-badges">
                    ${ing.kong_plugins.map(plugin => `<span class="badge-plugin">${plugin}</span>`).join('')}
                </div>
            </div>
        `;
    }
    
    detailsHtml += '</div>';
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
    container.innerHTML = '<div class="loading">Loading services...</div>';

    try {
        const response = await fetch(`/api/services/${currentNamespace}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const services = await response.json();

        if (!Array.isArray(services)) {
            throw new Error('Invalid response format');
        }

        if (services.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🔗</div><p>No services found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.servicesData = services;
        renderServicesTable(services, container);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading services</p><small>${error.message}</small></div>`;
    }
}

function renderServicesTable(services, container) {
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
                </tr>
            </thead>
            <tbody>
    `;

    services.forEach((svc, idx) => {
        const typeClass = svc.type === 'LoadBalancer' ? 'success' : svc.type === 'NodePort' ? 'warning' : 'info';
        
        // Main row - clickable to open detail panel
        html += `
            <tr class="clickable-row" onclick="openDetailPanel('servicesDetails', 'Service', '${currentNamespace}', '${svc.name}', window.servicesData[${idx}])">
                <td>🔗 ${svc.name}</td>
                <td><span class="badge-${typeClass}">${svc.type || 'ClusterIP'}</span></td>
                <td><span class="mono-text">${svc.cluster_ip || '-'}</span></td>
                <td><span class="badge-info">${(svc.ports || []).length}</span></td>
                <td><span class="badge-${svc.endpoint_count > 0 ? 'success' : 'secondary'}">${svc.endpoint_count || 0}</span></td>
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
    let detailsHtml = '<div class="ingress-details-grid">';
    
    // Ports section
    if (svc.ports && svc.ports.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🔌 Ports & Protocols</strong>
                </div>
                <div class="ingress-paths">
        `;
        
        svc.ports.forEach(port => {
            const portName = port.name || 'unnamed';
            const protocol = port.protocol || 'TCP';
            const targetPort = port.target_port || port.port;
            const nodePort = port.node_port ? ` (NodePort: ${port.node_port})` : '';
            
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge">${protocol}</span>
                        <code>${portName !== 'unnamed' ? portName + ' - ' : ''}${port.port}:${targetPort}${nodePort}</code>
                    </div>
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    // Selectors section
    if (svc.selector && Object.keys(svc.selector).length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🎯 Selectors</strong>
                </div>
                <div class="ingress-paths">
        `;
        
        Object.entries(svc.selector).forEach(([key, value]) => {
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <code>${key}: ${value}</code>
                    </div>
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    // External IPs if available
    if (svc.external_ips && svc.external_ips.length > 0) {
        detailsHtml += `
            <div class="ingress-plugins">
                <strong>🌐 External IPs:</strong>
                <div class="plugin-badges">
                    ${svc.external_ips.map(ip => `<span class="badge-plugin">${ip}</span>`).join('')}
                </div>
            </div>
        `;
    }
    
    detailsHtml += '</div>';
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
        const response = await fetch(`/api/configmaps/${currentNamespace}`);
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
            <tr class="clickable-row" onclick="openDetailPanel('configmapsDetails', 'ConfigMap', '${currentNamespace}', '${cm.name}', window.configMapsData[${idx}])">
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
        const response = await fetch(`/api/secrets/${currentNamespace}`);
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
            <tr class="clickable-row" onclick="openDetailPanel('secretsDetails', 'Secret', '${currentNamespace}', '${sec.name}', window.secretsData[${idx}])">
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

async function loadPods() {
    const container = document.getElementById('podsContent');
    container.innerHTML = '<div class="loading">Loading pods...</div>';

    try {
        const response = await fetch(`/api/pods/${currentNamespace}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const pods = await response.json();

        if (!Array.isArray(pods)) {
            console.error('Pods response is not an array:', pods);
            throw new Error('Invalid response format');
        }

        if (pods.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">📦</div><p>No pods found</p></div>';
            return;
        }

        const runningCount = pods.filter(p => p.status === 'Running').length;
        const totalRestarts = pods.reduce((sum, p) => sum + (p.restart_count || 0), 0);
        
        // Update stats in resource-controls
        const statsHtml = `
            <div class="resource-stats">
                <div class="stat-mini">
                    <span class="stat-mini-value">${pods.length}</span>
                    <span class="stat-mini-label">Total</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${runningCount}</span>
                    <span class="stat-mini-label">Running</span>
                </div>
                <div class="stat-mini">
                    <span class="stat-mini-value">${totalRestarts}</span>
                    <span class="stat-mini-label">Restarts</span>
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
        window.podsData = pods;

        container.innerHTML = `
            <table class="resource-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Ready</th>
                        <th>Restarts</th>
                        <th>Pod IP</th>
                        <th>Node</th>
                        <th>Age</th>
                        <th>Status Details</th>
                    </tr>
                </thead>
                <tbody>
                    ${pods.map((pod, idx) => {
                        const statusDetails = pod.status_details || 'OK';
                        const isError = statusDetails.includes('Error') || statusDetails.includes('Failed') || statusDetails.includes('exit code');
                        const detailsClass = isError ? 'badge-danger' : statusDetails === 'OK' ? 'badge-success' : 'badge-warning';
                        return `
                        <tr class="clickable-row" onclick="openDetailPanel('podsDetails', 'Pod', '${currentNamespace}', '${pod.name}', window.podsData[${idx}])">
                            <td>📦 ${pod.name || 'N/A'}</td>
                            <td><span class="badge ${['Running', 'Succeeded', 'Completed'].includes(pod.status) ? 'badge-success' : pod.status === 'Pending' ? 'badge-warning' : ['Failed', 'Error', 'CrashLoopBackOff', 'ImagePullBackOff'].includes(pod.status) ? 'badge-danger' : 'badge-secondary'}">${pod.status || 'Unknown'}</span></td>
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
    } catch (error) {
        console.error('Error loading pods:', error);
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading pods</p><small>${error.message}</small></div>`;
    }
}

/* ============================================
   DEPLOYMENTS
   ============================================ */

async function loadDeployments() {
    const container = document.getElementById('deploymentsContent');
    container.innerHTML = '<div class="loading">Loading deployments...</div>';

    try {
        const response = await fetch(`/api/deployments/${currentNamespace}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const deployments = await response.json();

        if (!Array.isArray(deployments)) {
            throw new Error('Invalid response format');
        }

        if (deployments.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🏗️</div><p>No deployments found</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.deploymentsData = deployments;
        renderDeploymentsTable(deployments, container);
    } catch (error) {
        container.innerHTML = `<div class="error-state"><div class="error-icon">⚠️</div><p>Error loading deployments</p><small>${error.message}</small></div>`;
    }
}

function renderDeploymentsTable(deployments, container) {
    const readyCount = deployments.filter(d => (d.ready_replicas || 0) === (d.desired_replicas || 0) && (d.desired_replicas || 0) > 0).length;
    const totalReplicas = deployments.reduce((sum, d) => sum + (d.desired_replicas || 0), 0);
    
    // Update stats in resource-controls
    const statsHtml = `
        <div class="resource-stats">
            <div class="stat-mini">
                <span class="stat-mini-value">${deployments.length}</span>
                <span class="stat-mini-label">Total</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${readyCount}</span>
                <span class="stat-mini-label">Ready</span>
            </div>
            <div class="stat-mini">
                <span class="stat-mini-value">${totalReplicas}</span>
                <span class="stat-mini-label">Replicas</span>
            </div>
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
                    <th>Name</th>
                    <th>Replicas</th>
                    <th>Updated</th>
                    <th>Available</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
    `;

    deployments.forEach((dep, idx) => {
        const ready = (dep.ready_replicas || 0) === (dep.desired_replicas || 0);
        
        // Main row - clickable to open detail panel
        html += `
            <tr class="clickable-row" onclick="openDetailPanel('deploymentsDetails', 'Deployment', '${currentNamespace}', '${dep.name}', window.deploymentsData[${idx}])">
                <td>🏗️ ${dep.name || 'Unknown'}</td>
                <td><span class="badge-${ready ? 'success' : 'warning'}">${dep.ready_replicas || 0}/${dep.desired_replicas || 0}</span></td>
                <td><span class="badge-info">${dep.updated_replicas || 0}</span></td>
                <td><span class="badge-info">${dep.available_replicas || 0}</span></td>
                <td><span class="badge-${ready ? 'success' : 'warning'}">${ready ? '✅ Ready' : '⏳ Progressing'}</span></td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}

function renderDeploymentDetails(dep) {
    let detailsHtml = '<div class="ingress-details-grid">';
    
    // Images section
    if (dep.images && dep.images.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>🐳 Container Images</strong>
                </div>
                <div class="ingress-paths">
        `;
        
        dep.images.forEach(image => {
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
    
    // Strategy section
    if (dep.strategy) {
        detailsHtml += `
            <div class="ingress-plugins">
                <strong>📋 Strategy:</strong>
                <span class="badge-plugin">${dep.strategy}</span>
            </div>
        `;
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
        const response = await fetch(`/api/health/${currentNamespace}`);
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
        const response = await fetch(`/api/health/${currentNamespace}`);
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

// Backward compatibility
async function analyzeHealth() {
    await loadHealth();
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
            fetch(`/api/cronjobs/${currentNamespace}`),
            fetch(`/api/pods/${currentNamespace}`)
        ]);
        
        if (!cronjobsResponse.ok) {
            throw new Error(`HTTP ${cronjobsResponse.status}: ${cronjobsResponse.statusText}`);
        }
        const cronjobs = await cronjobsResponse.json();
        console.log('CronJobs API response:', cronjobs);

        // Get pods to match with jobs
        let pods = [];
        if (podsResponse.ok) {
            pods = await podsResponse.json();
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

        let html = `
            <table class="resource-table cronjob-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Schedule</th>
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

            html += `
                <tr class="clickable-row" onclick="openDetailPanel('cronjobsDetails', 'CronJob', '${currentNamespace}', '${cj.name}', window.cronJobsData[${idx}])">
                    <td>⏰ ${cj.name}</td>
                    <td><code>${cj.schedule || '-'}</code></td>
                    <td><span class="badge-info">${nextRunIn}</span></td>
                    <td>${suspendBadge}</td>
                    <td>${lastSchedule}</td>
                    <td><span class="badge-info">${cj.active_count || 0}</span></td>
                    <td>${cj.age || '-'}</td>
                </tr>
            `;
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
            </tr>
        `;
    });
    
    html += '</tbody></table>';
    return html;
}

function toggleCronJobDetails(cronjobId) {
    const detailsRow = document.getElementById(`${cronjobId}-details`);
    const icon = document.getElementById(`${cronjobId}-icon`);

    if (detailsRow && icon) {
        const isVisible = detailsRow.style.display !== 'none';
        detailsRow.style.display = isVisible ? 'none' : 'table-row';
        icon.textContent = isVisible ? '▶' : '▼';
        icon.classList.toggle('expanded', !isVisible);
    }
}

/* ============================================
   RELEASES
   ============================================ */

async function loadReleases() {
    const container = document.getElementById('releasesResults');
    container.innerHTML = '<div class="loading">Loading release information...</div>';

    try {
        const response = await fetch(`/api/releases/${currentNamespace}`);
        const releases = await response.json();

        if (releases.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎯</div><p>No releases found in this namespace</p></div>';
            return;
        }

        // Store globally for detail panel access
        window.releasesData = releases;

        const calculateAge = (createdAt) => {
            const now = new Date();
            const created = new Date(createdAt);
            const diffMs = now - created;
            const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
            if (diffDays === 0) return 'Today';
            if (diffDays === 1) return '1 day';
            if (diffDays < 365) return `${diffDays}d`;
            const years = Math.floor(diffDays / 365);
            const remainingDays = diffDays % 365;
            return `${years}y${remainingDays}d`;
        };

        let html = `
            <table class="resource-table">
                <thead>
                    <tr>
                        <th>Deployment</th>
                        <th>Version</th>
                        <th>Managed By</th>
                        <th>Status</th>
                        <th>Age</th>
                    </tr>
                </thead>
                <tbody>
        `;

        releases.forEach((release, idx) => {
            const managedBy = release.helm_release ? 'Helm' : 'Manual';
            const version = release.version || release.helm_release?.app_version || '-';
            const age = calculateAge(release.created_at);
            const status = release.helm_release?.status || 'Running';
            const statusClass = status === 'deployed' || status === 'Running' ? 'badge-success' : 'badge-warning';

            html += `
                <tr class="clickable-row" onclick="openDetailPanel('releasesDetails', 'Release', '${release.namespace}', '${release.deployment_name}', window.releasesData[${idx}])">
                    <td><span class="mono-text">${release.deployment_name}</span></td>
                    <td>${version}</td>
                    <td><span class="badge-secondary">${managedBy}</span></td>
                    <td><span class="${statusClass}">${status}</span></td>
                    <td>${age}</td>
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
        const response = await fetch(`/api/pvpvc/${currentNamespace}`);

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
                <tr class="clickable-row" onclick="openDetailPanel('pvpvcDetails', 'PersistentVolumeClaim', '${currentNamespace}', '${pvc.name}', window.pvpvcData.pvcs[${idx}])">
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
    
    // Pods using this PVC
    if (pvc.pod_details && pvc.pod_details.length > 0) {
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>📦 Pods Using This Volume</strong>
                </div>
                <div class="ingress-paths">
        `;
        
        pvc.pod_details.forEach(pod => {
            const statusClass = pod.status === 'Running' ? 'success' : 
                               pod.status === 'Pending' ? 'warning' : 'danger';
            detailsHtml += `
                <div class="ingress-path-item">
                    <div class="path-route">
                        <span class="path-badge ${statusClass}">${pod.status}</span>
                        <code>${pod.name}</code>
                    </div>
                    <div class="path-backend">
                        <span class="text-muted">Node: ${pod.node || 'N/A'} | Restarts: ${pod.restart_count || 0}</span>
                    </div>
                </div>
            `;
        });
        
        detailsHtml += '</div></div>';
    }
    
    // PV Details
    if (pvc.pv_details) {
        const pv = pvc.pv_details;
        detailsHtml += `
            <div class="ingress-rule-card">
                <div class="ingress-rule-header">
                    <strong>💾 Persistent Volume Details</strong>
                </div>
                <div class="ingress-paths">
                    <div class="ingress-path-item">
                        <div class="path-route">
                            <span class="path-badge">VOLUME</span>
                            <code>${pvc.volume_name || 'N/A'}</code>
                        </div>
                        <div class="path-backend">
                            <span class="text-muted">Type: ${pv.volume_type || 'Unknown'} | Capacity: ${pv.capacity}</span>
                        </div>
                    </div>
                    ${pvc.storage_class ? `
                    <div class="ingress-path-item">
                        <div class="path-route">
                            <span class="path-badge">CLASS</span>
                            <code>${pvc.storage_class}</code>
                        </div>
                        <div class="path-backend">
                            <span class="text-muted">Reclaim: ${pv.reclaim_policy || 'Retain'}</span>
                        </div>
                    </div>
                    ` : ''}
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
    } else {
        return;
    }
    
    const search = document.getElementById(searchId);
    if (!search) return;
    
    const filter = search.value.toLowerCase();
    const container = document.getElementById(`${tab}Content`) || document.getElementById(tab);
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
            row.classList.contains('secret-details-row')) {
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
        const url = `/api/resources/${currentNamespace}?limit=500${typeFilter}&lightweight=true`;
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
                        <th>Type</th>
                        <th>Name</th>
                        <th>Namespace</th>
                        <th>Status</th>
                        <th>Health</th>
                        <th>Actions</th>
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

        resources.forEach(item => {
            const icon = getResourceIcon(item.resource_type);
            const healthScore = item.health_score || 0;
            const healthEmoji = healthScore >= 80 ? '🟢' : healthScore >= 60 ? '🟡' : '🔴';
            const healthBadge = healthScore >= 80 ? 'badge-success' : healthScore >= 60 ? 'badge-warning' : 'badge-danger';
            const status = item.status || 'Unknown';

            html += `
                <tr onclick="loadResourceDetails('${item.resource_type}', '${item.namespace}', '${item.name}')" style="cursor: pointer;">
                    <td><span class="badge-info">${icon} ${item.resource_type}</span></td>
                    <td>${item.name}</td>
                    <td><span class="badge-secondary">${item.namespace}</span></td>
                    <td><span class="badge-info">${status}</span></td>
                    <td><span class="${healthBadge}">${healthEmoji} ${healthScore}%</span></td>
                    <td>
                        <button class="action-btn" onclick="event.stopPropagation(); loadResourceDetails('${item.resource_type}', '${item.namespace}', '${item.name}')" title="View Details">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="vertical-align:middle;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
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

            html += '<div class="details-section"><h4 class="section-title"><span class="section-icon">🔗</span>Relationships</h4><div class="relationships-tree">';

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

            html += '</div></div>';
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

    const regularFields = Object.keys(details).filter(k => 
        !['containers', 'container_statuses', 'conditions', 'recent_events', 'replica_sets', 'ports', 'strategy', 'labels', 'annotations'].includes(k) &&
        !k.includes('_count')
    );

    if (regularFields.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">📋</span>Basic Information</h4><div class="info-grid">';
        regularFields.forEach(key => {
            const value = details[key];
            if (typeof value !== 'object') {
                const displayKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                html += `<div class="info-item"><label class="info-label">${displayKey}</label><span class="info-value">${value}</span></div>`;
            }
        });
        html += '</div></div>';
    }

    if (details.labels && Object.keys(details.labels).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.keys(details.labels).forEach(key => {
            html += `<span class="label-badge">${key}: ${details.labels[key]}</span>`;
        });
        html += '</div></div>';
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

async function updateCacheStats() {
    try {
        const response = await fetch('/api/cache/stats');
        const stats = await response.json();
        const statsEl = document.getElementById('cacheStats');
        if (statsEl) {
            statsEl.textContent = `📦 Cache: ${stats.size} items`;
        }
    } catch (error) {
        console.error('Error fetching cache stats:', error);
    }
}

/* ============================================
   INITIALIZATION
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded - Initializing dashboard...');
    
    try {
        loadThemePreference();
        console.log('Theme loaded');
        
        loadSidebarState();
        console.log('Sidebar state loaded');
        
        loadClusterInfo();
        console.log('Loading cluster info...');
        
        updateCacheStats();
        console.log('Updating cache stats...');
        
        // Load overview dashboard on initial page load
        loadOverview();
        console.log('Loading overview...');

        // Update cache stats every 10 seconds
        setInterval(updateCacheStats, 10000);
        
        console.log('Dashboard initialized successfully');
    } catch (error) {
        console.error('Error during initialization:', error);
    }
});
