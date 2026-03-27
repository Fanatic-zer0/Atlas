/* ============================================
   UNIFIED DETAIL PANEL SYSTEM
   Handles opening and rendering details for all resource types
   ============================================ */

// Generic function to open detail panel for any resource type
async function openDetailPanel(panelId, resourceType, namespace, name, data = null) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    panel.classList.add('active');
    panel.innerHTML = '<div class="loading">Loading details...</div>';

    try {
        let resourceData = data;
        
        // If data not provided, fetch it based on resource type
        if (!resourceData) {
            resourceData = await fetchResourceData(resourceType, namespace, name);
        }

        // Render details based on resource type
        const html = renderResourceDetails(resourceType, resourceData, namespace, panelId);
        panel.innerHTML = html;

        // Initialize resizer
        initializeDetailsResizer(panelId);
    } catch (error) {
        panel.innerHTML = `
            <div class="details-resizer"></div>
            <div class="details-header">
                <div class="details-title-section">
                    <div class="details-title-content">
                        <h3 class="details-name">Error Loading Details</h3>
                    </div>
                </div>
                <button class="close-details" onclick="closeDetailPanel('${panelId}')">×</button>
            </div>
            <div class="details-body">
                <p style="color: var(--danger);">${error.message}</p>
            </div>
        `;
    }
}

// Close detail panel
function closeDetailPanel(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
        panel.classList.remove('active');
        setTimeout(() => {
            panel.innerHTML = '';
        }, 300);
    }
}

// Fetch resource data based on type
async function fetchResourceData(resourceType, namespace, name) {
    let endpoint = '';
    
    switch (resourceType.toLowerCase()) {
        case 'pod':
            endpoint = `/api/pods/${namespace}`;
            break;
        case 'deployment':
            endpoint = `/api/deployments/${namespace}`;
            break;
        case 'service':
            endpoint = `/api/services/${namespace}`;
            break;
        case 'ingress':
            endpoint = `/api/ingresses/${namespace}`;
            break;
        case 'node':
            endpoint = `/api/health/${namespace}`;
            break;
        default:
            throw new Error(`Unknown resource type: ${resourceType}`);
    }

    const response = await fetch(endpoint);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Find the specific resource by name
    if (Array.isArray(data)) {
        const resource = data.find(r => r.name === name);
        if (!resource) {
            throw new Error(`Resource ${name} not found`);
        }
        return resource;
    } else if (resourceType.toLowerCase() === 'node' && data.nodes) {
        const node = data.nodes.find(n => n.name === name);
        if (!node) {
            throw new Error(`Node ${name} not found`);
        }
        return node;
    }
    
    return data;
}

// Render details based on resource type
function renderResourceDetails(resourceType, data, namespace, panelId) {
    const type = resourceType.toLowerCase();
    
    let html = `
        <div class="details-resizer"></div>
        <div class="details-header">
            <div class="details-title-section">
                <span class="details-icon">${getResourceIcon(type)}</span>
                <div class="details-title-content">
                    <h3 class="details-name">${data.name || 'Unknown'}</h3>
                    <span class="details-subtitle">${resourceType} in ${namespace}</span>
                </div>
            </div>
    `;

    // Add status badges based on resource type
    if (type === 'pod') {
        const statusClass = ['Running', 'Succeeded', 'Completed'].includes(data.status) ? 'success' : 
                          data.status === 'Pending' ? 'warning' : 'danger';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${statusClass}-bg); color: var(--${statusClass}); border: 1px solid var(--${statusClass});">
                    ${data.status || 'Unknown'}
                </span>
                <span class="status-badge" style="background: var(--info-bg); color: var(--info); border: 1px solid var(--info);">
                    ${data.ready_containers || 0}/${data.total_containers || 0} Ready
                </span>
            </div>
        `;
    } else if (type === 'deployment') {
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--info-bg); color: var(--info); border: 1px solid var(--info);">
                    ${data.ready_replicas || 0}/${data.desired_replicas || 0} Ready
                </span>
            </div>
        `;
    }

    html += `
            <button class="close-details" onclick="closeDetailPanel('${panelId}')">×</button>
        </div>
        <div class="details-body">
    `;

    // Render resource-specific details
    html += renderBasicInfo(type, data);
    html += renderSpecificDetails(type, data);
    
    html += `</div>`;
    
    return html;
}

// Get icon for resource type
function getResourceIcon(type) {
    const icons = {
        'pod': '📦',
        'deployment': '🚀',
        'service': '🔗',
        'ingress': '🌐',
        'node': '🖥️',
        'configmap': '📋',
        'secret': '🔒'
    };
    return icons[type] || '📦';
}

// Render basic information section
function renderBasicInfo(type, data) {
    let html = '<div class="info-section"><h4 class="section-title"><span class="section-icon">📋</span>Basic Information</h4><div class="info-grid">';
    
    const commonFields = ['namespace', 'created', 'age', 'uid'];
    const typeSpecificFields = {
        'pod': ['ip', 'node', 'restart_count', 'qos_class'],
        'deployment': ['strategy', 'replicas', 'updated_replicas'],
        'service': ['type', 'cluster_ip', 'session_affinity'],
        'ingress': ['class', 'tls_enabled'],
        'node': ['version', 'os', 'architecture', 'container_runtime']
    };

    const fields = [...commonFields, ...(typeSpecificFields[type] || [])];
    
    fields.forEach(field => {
        if (data[field] !== undefined && data[field] !== null) {
            const label = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            html += `
                <div class="info-item">
                    <label class="info-label">${label}</label>
                    <span class="info-value">${data[field]}</span>
                </div>
            `;
        }
    });
    
    html += '</div></div>';
    return html;
}

// Render specific details based on resource type
function renderSpecificDetails(type, data) {
    let html = '';
    
    switch (type) {
        case 'pod':
            html += renderPodSpecificDetails(data);
            break;
        case 'deployment':
            // Use existing detailed function from script.js if available
            if (typeof renderDeploymentDetails === 'function') {
                html += '<div class="details-section">' + renderDeploymentDetails(data) + '</div>';
            } else {
                html += renderDeploymentSpecificDetails(data);
            }
            break;
        case 'service':
            // Use existing detailed function from script.js if available
            if (typeof renderServiceDetails === 'function') {
                html += '<div class="details-section">' + renderServiceDetails(data) + '</div>';
            } else {
                html += renderServiceSpecificDetails(data);
            }
            break;
        case 'ingress':
            // Use existing detailed function from script.js if available
            if (typeof renderIngressDetails === 'function') {
                html += '<div class="details-section">' + renderIngressDetails(data) + '</div>';
            } else {
                html += renderIngressSpecificDetails(data);
            }
            break;
        case 'configmap':
            // Use existing detailed function from script.js if available
            if (typeof renderConfigMapDetails === 'function') {
                html += '<div class="details-section">' + renderConfigMapDetails(data) + '</div>';
            }
            break;
        case 'secret':
            // Use existing detailed function from script.js if available
            if (typeof renderSecretDetails === 'function') {
                html += '<div class="details-section">' + renderSecretDetails(data) + '</div>';
            }
            break;
        case 'persistentvolumeclaim':
            // Use existing detailed function from script.js if available
            if (typeof renderPVCDetails === 'function') {
                html += '<div class="details-section">' + renderPVCDetails(data) + '</div>';
            }
            break;
        case 'customresourcedefinition':
            // Use existing detailed function from script.js if available
            if (typeof renderCRDDetails === 'function') {
                html += '<div class="details-section">' + renderCRDDetails(data) + '</div>';
            }
            break;
        case 'cronjob':
            // Render CronJob details
            html += renderCronJobSpecificDetails(data);
            break;
        case 'release':
            // Render Release details
            html += renderReleaseSpecificDetails(data);
            break;
        case 'node':
            html += renderNodeDetails(data);
            break;
        default:
            html += '<div class="info-section"><p>No detailed information available for this resource type.</p></div>';
    }
    
    return html;
}

// Pod-specific details (basic fallback)
function renderPodSpecificDetails(data) {
    let html = '';
    
    // Containers
    if (data.containers && data.containers.length > 0) {
        html += '<div class="details-section"><h4 class="section-title"><span class="section-icon">📦</span>Containers</h4>';
        data.containers.forEach(container => {
            html += `
                <div class="info-item">
                    <label class="info-label">${container.name || 'Container'}</label>
                    <span class="info-value">Image: ${container.image || 'N/A'}</span>
                </div>
            `;
        });
        html += '</div>';
    }
    
    // Labels
    if (data.labels && Object.keys(data.labels).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.entries(data.labels).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div>';
    }
    
    return html;
}

// Deployment-specific details (basic fallback)
function renderDeploymentSpecificDetails(data) {
    let html = '';
    
    if (data.selector && Object.keys(data.selector).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🎯</span>Selector</h4><div class="labels-container">';
        Object.entries(data.selector).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div>';
    }
    
    return html;
}

// Service-specific details (basic fallback)
function renderServiceSpecificDetails(data) {
    let html = '';
    
    // Ports
    if (data.ports && data.ports.length > 0) {
        html += '<div class="details-section"><h4 class="section-title"><span class="section-icon">🔌</span>Ports</h4><div class="info-grid">';
        data.ports.forEach((port, idx) => {
            html += `
                <div class="info-item">
                    <label class="info-label">Port ${idx + 1}</label>
                    <span class="info-value">${port.port}:${port.target_port || port.port}/${port.protocol || 'TCP'}</span>
                </div>
            `;
        });
        html += '</div></div>';
    }
    
    // Selector
    if (data.selector && Object.keys(data.selector).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🎯</span>Selector</h4><div class="labels-container">';
        Object.entries(data.selector).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div>';
    }
    
    return html;
}

// Ingress-specific details (basic fallback)
function renderIngressSpecificDetails(data) {
    let html = '';
    
    // Rules
    if (data.rules && data.rules.length > 0) {
        html += '<div class="details-section"><h4 class="section-title"><span class="section-icon">🔀</span>Rules</h4>';
        data.rules.forEach((rule, idx) => {
            html += `
                <div class="info-item">
                    <label class="info-label">Host ${idx + 1}</label>
                    <span class="info-value">${rule.host || '*'}</span>
                </div>
            `;
            if (rule.paths) {
                rule.paths.forEach(path => {
                    html += `
                        <div class="info-item" style="margin-left: 20px;">
                            <label class="info-label">${path.path || '/'}</label>
                            <span class="info-value">${path.backend || 'N/A'}</span>
                        </div>
                    `;
                });
            }
        });
        html += '</div>';
    }
    
    return html;
}

// CronJob-specific details
function renderCronJobSpecificDetails(data) {
    let html = '';
    
    // Schedule info
    html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">⏰</span>Schedule Information</h4><div class="info-grid">';
    
    if (data.schedule) {
        html += `
            <div class="info-item">
                <label class="info-label">Schedule</label>
                <span class="info-value"><code>${data.schedule}</code></span>
            </div>
        `;
    }
    
    if (data.suspend !== undefined) {
        html += `
            <div class="info-item">
                <label class="info-label">Suspended</label>
                <span class="info-value">${data.suspend ? 'Yes' : 'No'}</span>
            </div>
        `;
    }
    
    if (data.last_schedule_time) {
        html += `
            <div class="info-item">
                <label class="info-label">Last Schedule</label>
                <span class="info-value">${new Date(data.last_schedule_time).toLocaleString()}</span>
            </div>
        `;
    }
    
    if (data.next_run_in) {
        html += `
            <div class="info-item">
                <label class="info-label">Next Run</label>
                <span class="info-value">${data.next_run_in}</span>
            </div>
        `;
    }
    
    if (data.active_count !== undefined) {
        html += `
            <div class="info-item">
                <label class="info-label">Active Jobs</label>
                <span class="info-value">${data.active_count}</span>
            </div>
        `;
    }
    
    html += '</div></div>';
    
    // Jobs - use detailed render function from script.js if available
    if (data.jobs && data.jobs.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">📋</span>Jobs</h4>';
        if (typeof renderJobsUnderCronJob === 'function') {
            html += renderJobsUnderCronJob(data.jobs);
        } else {
            // Fallback to simple rendering
            html += '<div class="info-grid">';
            data.jobs.forEach(job => {
                const statusClass = job.status === 'Completed' ? 'success' : 
                                  job.status === 'Failed' ? 'danger' : 'info';
                html += `
                    <div class="info-item">
                        <label class="info-label">${job.name}</label>
                        <span class="info-value"><span class="badge-${statusClass}">${job.status}</span> - ${job.age || 'N/A'}</span>
                    </div>
                `;
            });
            html += '</div>';
        }
        html += '</div>';
    }
    
    return html;
}

// Release-specific details
function renderReleaseSpecificDetails(data) {
    let html = '';
    
    html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🚀</span>Release Information</h4><div class="info-grid">';
    
    if (data.version || data.helm_release?.app_version) {
        html += `
            <div class="info-item">
                <label class="info-label">Version</label>
                <span class="info-value">${data.version || data.helm_release.app_version}</span>
            </div>
        `;
    }
    
    if (data.helm_release) {
        html += `
            <div class="info-item">
                <label class="info-label">Managed By</label>
                <span class="info-value">Helm</span>
            </div>
        `;
        if (data.helm_release.status) {
            html += `
                <div class="info-item">
                    <label class="info-label">Status</label>
                    <span class="info-value">${data.helm_release.status}</span>
                </div>
            `;
        }
    }
    
    if (data.created_at) {
        html += `
            <div class="info-item">
                <label class="info-label">Created</label>
                <span class="info-value">${new Date(data.created_at).toLocaleString()}</span>
            </div>
        `;
    }
    
    html += '</div></div>';
    
    return html;
}

// Node-specific details
function renderNodeDetails(data) {
    let html = '';
    
    // Conditions
    if (data.conditions && data.conditions.length > 0) {
        html += '<div class="details-section"><h4 class="section-title"><span class="section-icon">⚡</span>Conditions</h4><div class="info-grid">';
        data.conditions.forEach(condition => {
            html += `
                <div class="info-item">
                    <label class="info-label">${condition.type || 'Condition'}</label>
                    <span class="info-value">${condition.status || 'Unknown'}</span>
                </div>
            `;
        });
        html += '</div></div>';
    }
    
    // Resources
    if (data.capacity || data.allocatable) {
        html += '<div class="details-section"><h4 class="section-title"><span class="section-icon">💾</span>Resources</h4><div class="info-grid">';
        if (data.capacity) {
            Object.entries(data.capacity).forEach(([key, value]) => {
                html += `
                    <div class="info-item">
                        <label class="info-label">Capacity ${key}</label>
                        <span class="info-value">${value}</span>
                    </div>
                `;
            });
        }
        html += '</div></div>';
    }
    
    return html;
}

// Initialize resizer for a specific panel
function initializeDetailsResizer(panelId) {
    const resizer = document.querySelector(`#${panelId} .details-resizer`);
    const panel = document.getElementById(panelId);
    
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
