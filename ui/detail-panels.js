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
    // Use the detailed resource endpoint (keep original case)
    const endpoint = `/api/resource/${resourceType}/${namespace}/${name}`;

    const response = await fetch(endpoint);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
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
    } else if (type === 'persistentvolumeclaim') {
        const pvcColor = data.status === 'Bound' ? 'success' : data.status === 'Pending' ? 'warning' : 'danger';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${pvcColor}-bg); color: var(--${pvcColor}); border: 1px solid var(--${pvcColor});">
                    ${data.status || 'Unknown'}
                </span>
                <span class="status-badge" style="background: var(--info-bg); color: var(--info); border: 1px solid var(--info);">
                    ${data.pod_count || 0} pod${(data.pod_count || 0) !== 1 ? 's' : ''}
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
    
    // Extract details object
    const details = data.details || data;
    
    // Status Section
    html += '<div class="details-section">';
    html += '<h4 class="section-title"><span class="section-icon">📊</span>Status</h4>';
    html += '<div class="info-grid">';
    html += `<div class="info-item"><label class="info-label">Phase:</label><span class="info-value">${details.phase || data.status || 'N/A'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Node:</label><span class="info-value">${details.node_name || 'N/A'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Pod IP:</label><span class="info-value">${details.pod_ip || 'N/A'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Host IP:</label><span class="info-value">${details.host_ip || 'N/A'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">QoS Class:</label><span class="info-value">${details.qos_class || 'N/A'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Service Account:</label><span class="info-value">${details.service_account || 'default'}</span></div>`;
    if (details.created_at) {
        html += `<div class="info-item"><label class="info-label">Created:</label><span class="info-value">${details.created_at}</span></div>`;
    }
    html += '</div></div>';
    
    // Init Containers Section
    if (details.init_containers && details.init_containers.length > 0) {
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">⚙️</span>Init Containers (${details.init_containers.length})</h4>`;
        
        details.init_containers.forEach((container, idx) => {
            const status = details.init_container_statuses && details.init_container_statuses[idx];
            const statusClass = status && status.state === 'Completed' ? 'status-healthy' : 
                               status && status.state === 'Failed' ? 'status-unhealthy' : 'status-warning';
            const statusText = status ? status.state : 'Unknown';
            
            html += '<div class="container-card">';
            html += `<div class="container-header">`;
            html += `<span class="container-name">${idx + 1}/${details.init_containers.length} ${container.name}</span>`;
            html += `<span class="container-status ${statusClass}">${statusText}</span>`;
            html += '</div>';
            html += '<div class="info-grid">';
            html += `<div class="info-item"><label class="info-label">Image:</label><span class="info-value code">${container.image}</span></div>`;
            
            if (container.command && container.command.length > 0) {
                html += `<div class="info-item"><label class="info-label">Command:</label><span class="info-value code">${container.command.join(' ')}</span></div>`;
            }
            if (container.args && container.args.length > 0) {
                html += `<div class="info-item"><label class="info-label">Args:</label><span class="info-value code">${container.args.join(' ')}</span></div>`;
            }
            
            // Resources
            if (container.resources) {
                if (container.resources.requests) {
                    const req = container.resources.requests;
                    html += `<div class="info-item"><label class="info-label">Requests:</label><span class="info-value">CPU: ${req.cpu || '0'}, Mem: ${req.memory || '0'}</span></div>`;
                }
                if (container.resources.limits) {
                    const lim = container.resources.limits;
                    html += `<div class="info-item"><label class="info-label">Limits:</label><span class="info-value">CPU: ${lim.cpu || '∞'}, Mem: ${lim.memory || '∞'}</span></div>`;
                }
            }
            
            if (status && status.message) {
                html += `<div class="info-item"><label class="info-label">Message:</label><span class="info-value">${status.message}</span></div>`;
            }
            html += '</div></div>';
        });
        html += '</div>';
    }
    
    // Main Containers Section
    if (details.containers && details.containers.length > 0) {
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">📦</span>Containers (${details.containers.length})</h4>`;
        
        details.containers.forEach((container, idx) => {
            const status = details.container_statuses && details.container_statuses[idx];
            const statusClass = status && status.state === 'Running' ? 'status-healthy' : 
                               status && status.state === 'Terminated' ? 'status-unhealthy' : 'status-warning';
            const statusText = status ? status.state : 'Unknown';
            
            html += '<div class="container-card">';
            html += '<div class="container-header">';
            html += `<span class="container-name">${container.name}</span>`;
            html += `<span class="container-status ${statusClass}">${statusText}</span>`;
            if (status && status.ready !== undefined) {
                html += `<span class="container-ready ${status.ready ? 'ready-yes' : 'ready-no'}">${status.ready ? 'Ready' : 'Not Ready'}</span>`;
            }
            html += '</div>';
            html += '<div class="info-grid">';
            html += `<div class="info-item"><label class="info-label">Image:</label><span class="info-value code">${container.image}</span></div>`;
            
            // Ports
            if (container.ports && container.ports.length > 0) {
                const portsStr = container.ports.map(p => 
                    `${p.container_port}${p.name ? '(' + p.name + ')' : ''}/${p.protocol || 'TCP'}`
                ).join(', ');
                html += `<div class="info-item"><label class="info-label">Ports:</label><span class="info-value">${portsStr}</span></div>`;
            }
            
            // Resources
            if (container.resources) {
                if (container.resources.requests) {
                    const req = container.resources.requests;
                    html += `<div class="info-item"><label class="info-label">Requests:</label><span class="info-value">CPU: ${req.cpu || '0'}, Mem: ${req.memory || '0'}</span></div>`;
                }
                if (container.resources.limits) {
                    const lim = container.resources.limits;
                    html += `<div class="info-item"><label class="info-label">Limits:</label><span class="info-value">CPU: ${lim.cpu || '∞'}, Mem: ${lim.memory || '∞'}</span></div>`;
                }
            }
            
            if (status) {
                if (status.restart_count !== undefined) {
                    html += `<div class="info-item"><label class="info-label">Restarts:</label><span class="info-value">${status.restart_count}</span></div>`;
                }
                if (status.started_at) {
                    html += `<div class="info-item"><label class="info-label">Started:</label><span class="info-value">${status.started_at}</span></div>`;
                }
                if (status.reason) {
                    html += `<div class="info-item"><label class="info-label">Reason:</label><span class="info-value">${status.reason}</span></div>`;
                }
                if (status.message) {
                    html += `<div class="info-item"><label class="info-label">Message:</label><span class="info-value">${status.message}</span></div>`;
                }
            }
            html += '</div></div>';
        });
        html += '</div>';
    }
    
    // Conditions Section
    if (details.conditions && details.conditions.length > 0) {
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">🔍</span>Conditions (${details.conditions.length})</h4>`;
        html += '<div class="conditions-list">';
        details.conditions.forEach(condition => {
            const statusClass = condition.status === 'True' ? 'status-healthy' : 'status-warning';
            html += '<div class="condition-item">';
            html += `<div class="condition-header">`;
            html += `<span class="condition-type">${condition.type}</span>`;
            html += `<span class="condition-status ${statusClass}">${condition.status}</span>`;
            html += '</div>';
            if (condition.reason || condition.message) {
                html += '<div class="condition-details">';
                if (condition.reason) {
                    html += `<span class="condition-reason">${condition.reason}</span>`;
                }
                if (condition.message) {
                    html += `<span class="condition-message">${condition.message}</span>`;
                }
                html += '</div>';
            }
            html += '</div>';
        });
        html += '</div></div>';
    }
    
    // App Info Section
    if (details.app_info && Object.keys(details.app_info).length > 0) {
        html += '<div class="details-section">';
        html += '<h4 class="section-title"><span class="section-icon">📱</span>App Info</h4>';
        html += '<div class="info-grid">';
        if (details.app_info.app_name) {
            html += `<div class="info-item"><label class="info-label">App Name:</label><span class="info-value">${details.app_info.app_name}</span></div>`;
        }
        if (details.app_info.version) {
            html += `<div class="info-item"><label class="info-label">Version:</label><span class="info-value">${details.app_info.version}</span></div>`;
        }
        if (details.app_info.component) {
            html += `<div class="info-item"><label class="info-label">Component:</label><span class="info-value">${details.app_info.component}</span></div>`;
        }
        html += '</div></div>';
    }
    
    // Labels
    if (details.labels && Object.keys(details.labels).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.entries(details.labels).forEach(([key, value]) => {
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
