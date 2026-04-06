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
                <p style="color: var(--danger);">${sanitizeErrorMessage(error)}</p>
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
    
    // Get the resource name based on type (releases use deployment_name)
    const resourceName = data.name || data.deployment_name || 'Unknown';
    
    let html = `
        <div class="details-resizer"></div>
        <div class="details-header">
            <div class="details-title-section">
                <span class="details-icon">${getResourceIcon(type)}</span>
                <div class="details-title-content">
                    <h3 class="details-name">${resourceName}</h3>
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
    } else if (type === 'deployment' || type === 'statefulset') {
        const ready = data.ready_replicas || 0;
        const desired = data.desired_replicas || 0;
        const statusClass = ready === desired ? 'success' : 'warning';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${statusClass}-bg); color: var(--${statusClass}); border: 1px solid var(--${statusClass});">
                    ${ready}/${desired} Ready
                </span>
            </div>
        `;
    } else if (type === 'daemonset') {
        const ready = data.number_ready || 0;
        const desired = data.desired_number_scheduled || 0;
        const statusClass = ready === desired ? 'success' : 'warning';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${statusClass}-bg); color: var(--${statusClass}); border: 1px solid var(--${statusClass});">
                    ${ready}/${desired} Ready
                </span>
            </div>
        `;
    } else if (type === 'job') {
        let statusClass = 'info';
        if (data.status === 'Completed') statusClass = 'success';
        else if (data.status === 'Failed') statusClass = 'danger';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${statusClass}-bg); color: var(--${statusClass}); border: 1px solid var(--${statusClass});">
                    ${data.status || 'Running'}
                </span>
            </div>
        `;
    } else if (type === 'endpoints') {
        const ready = data.ready_endpoints || 0;
        const total = data.total_endpoints || 0;
        const statusClass = ready === total ? 'success' : 'warning';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${statusClass}-bg); color: var(--${statusClass}); border: 1px solid var(--${statusClass});">
                    ${ready}/${total} Ready
                </span>
            </div>
        `;
    } else if (type === 'horizontalpodautoscaler') {
        const current = data.current_replicas || 0;
        const desired = data.desired_replicas || 0;
        const statusClass = current === desired ? 'success' : 'warning';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${statusClass}-bg); color: var(--${statusClass}); border: 1px solid var(--${statusClass});">
                    ${current} replicas
                </span>
                <span class="status-badge" style="background: var(--info-bg); color: var(--info); border: 1px solid var(--info);">
                    ${data.min_replicas} - ${data.max_replicas} range
                </span>
            </div>
        `;
    } else if (type === 'poddisruptionbudget') {
        const current = data.current_healthy || 0;
        const desired = data.desired_healthy || 0;
        const statusClass = current >= desired ? 'success' : 'danger';
        html += `
            <div class="details-badges">
                <span class="status-badge" style="background: var(--${statusClass}-bg); color: var(--${statusClass}); border: 1px solid var(--${statusClass});">
                    ${current}/${desired} Healthy
                </span>
                <span class="status-badge" style="background: var(--info-bg); color: var(--info); border: 1px solid var(--info);">
                    ${data.disruptions_allowed} disruptions allowed
                </span>
            </div>
        `;
    } else if (type === 'storageclass') {
        html += `
            <div class="details-badges">
                ${data.is_default ? '<span class="status-badge" style="background: var(--success-bg); color: var(--success); border: 1px solid var(--success);">Default</span>' : ''}
                <span class="status-badge" style="background: var(--info-bg); color: var(--info); border: 1px solid var(--info);">
                    ${data.pvc_count || 0} PVCs
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

    // Render resource-specific details (Basic Info removed, relationships kept)
    html += renderSpecificDetails(type, data);
    
    html += `</div>`;
    
    return html;
}

// Get icon for resource type
function getResourceIcon(type) {
    const icons = {
        'pod': '📦',
        'deployment': '🚀',
        'statefulset': '📊',
        'daemonset': '🔄',
        'job': '⚙️',
        'cronjob': '⏰',
        'service': '🔗',
        'ingress': '🌐',
        'endpoints': '🔗',
        'node': '🖥️',
        'configmap': '📋',
        'secret': '🔒',
        'persistentvolumeclaim': '💾',
        'storageclass': '💿',
        'horizontalpodautoscaler': '📊',
        'poddisruptionbudget': '🛡️',
        'customresourcedefinition': '🔧',
        'release': '🚀'
    };
    return icons[type] || '📦';
}

// Render basic information section
function renderBasicInfo(type, data) {
    let html = '<div class="info-section"><h4 class="section-title"><span class="section-icon">📋</span>Basic Information</h4><div class="info-grid">';
    
    // Extract details if nested
    const details = data.details || {};
    
    // Build the info items based on resource type
    if (type === 'pod') {
        // Pod-specific basic info
        if (data.namespace) html += `<div class="info-item"><label class="info-label">Namespace</label><span class="info-value">${data.namespace}</span></div>`;
        if (details.pod_ip) html += `<div class="info-item"><label class="info-label">Pod IP</label><span class="info-value">${details.pod_ip}</span></div>`;
        if (details.node_name) html += `<div class="info-item"><label class="info-label">Node</label><span class="info-value">${details.node_name}</span></div>`;
        if (details.host_ip) html += `<div class="info-item"><label class="info-label">Host IP</label><span class="info-value">${details.host_ip}</span></div>`;
        if (details.qos_class) html += `<div class="info-item"><label class="info-label">QoS Class</label><span class="info-value">${details.qos_class}</span></div>`;
        if (details.service_account) html += `<div class="info-item"><label class="info-label">Service Account</label><span class="info-value">${details.service_account}</span></div>`;
        if (details.restart_policy) html += `<div class="info-item"><label class="info-label">Restart Policy</label><span class="info-value">${details.restart_policy}</span></div>`;
        if (details.created_at) html += `<div class="info-item"><label class="info-label">Created</label><span class="info-value">${details.created_at}</span></div>`;
    } else {
        // Generic field rendering for other resources
        const commonFields = ['namespace', 'created', 'age', 'uid'];
        const typeSpecificFields = {
            'deployment': ['strategy', 'replicas', 'updated_replicas'],
            'service': ['type', 'cluster_ip', 'session_affinity'],
            'ingress': ['class', 'tls_enabled'],
            'node': ['version', 'os', 'architecture', 'container_runtime']
        };

        const fields = [...commonFields, ...(typeSpecificFields[type] || [])];
        
        fields.forEach(field => {
            // Check both top-level and nested details
            const value = data[field] !== undefined ? data[field] : details[field];
            if (value !== undefined && value !== null) {
                const label = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                html += `
                    <div class="info-item">
                        <label class="info-label">${label}</label>
                        <span class="info-value">${value}</span>
                    </div>
                `;
            }
        });
    }
    
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
        case 'statefulset':
            html += renderStatefulSetSpecificDetails(data);
            break;
        case 'daemonset':
            html += renderDaemonSetSpecificDetails(data);
            break;
        case 'job':
            html += renderJobSpecificDetails(data);
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
        case 'endpoints':
            html += renderEndpointsSpecificDetails(data);
            break;
        case 'storageclass':
            html += renderStorageClassSpecificDetails(data);
            break;
        case 'horizontalpodautoscaler':
            html += renderHPASpecificDetails(data);
            break;
        case 'poddisruptionbudget':
            html += renderPDBSpecificDetails(data);
            break;
        case 'configmap':
            // Use existing detailed function from script.js if available
            if (typeof renderConfigMapDetails === 'function') {
                html += '<div class="details-section">' + renderConfigMapDetails(data) + '</div>';
            }
            // Add relationships
            if (data.relationships && data.relationships.length > 0) {
                html += renderRelationships(data.relationships);
            }
            break;
        case 'secret':
            // Use existing detailed function from script.js if available
            if (typeof renderSecretDetails === 'function') {
                html += '<div class="details-section">' + renderSecretDetails(data) + '</div>';
            }
            // Add relationships
            if (data.relationships && data.relationships.length > 0) {
                html += renderRelationships(data.relationships);
            }
            break;
        case 'persistentvolumeclaim':
            // Use existing detailed function from script.js if available
            if (typeof renderPVCDetails === 'function') {
                html += '<div class="details-section">' + renderPVCDetails(data) + '</div>';
            }
            // Add relationships
            if (data.relationships && data.relationships.length > 0) {
                html += renderRelationships(data.relationships);
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
    const statusId = `status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    html += '<div class="details-section collapsible-section">';
    html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${statusId}')">`;
    html += '<span class="collapse-icon" id="' + statusId + '-icon">▼</span>';
    html += '<span class="section-icon">📊</span>Status</h4>';
    html += `<div class="section-content" id="${statusId}">`;
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
    html += '</div></div></div>';
    
    // Init Containers Section
    if (details.init_containers && details.init_containers.length > 0) {
        const initId = `init-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="details-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${initId}')">`;
        html += '<span class="collapse-icon" id="' + initId + '-icon">▼</span>';
        html += `<span class="section-icon">⚙️</span>Init Containers (${details.init_containers.length})</h4>`;
        html += `<div class="section-content" id="${initId}">`;
        
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
        html += '</div></div>';
    }
    
    // Main Containers Section
    if (details.containers && details.containers.length > 0) {
        const containersId = `containers-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="details-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${containersId}')">`;
        html += '<span class="collapse-icon" id="' + containersId + '-icon">▼</span>';
        html += `<span class="section-icon">📦</span>Containers (${details.containers.length})</h4>`;
        html += `<div class="section-content" id="${containersId}">`;
        
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
        html += '</div></div></div>';
    }
    
    // App Info Section
    if (details.app_info && Object.keys(details.app_info).length > 0) {
        const appInfoId = `appinfo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="details-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${appInfoId}')">`;
        html += '<span class="collapse-icon" id="' + appInfoId + '-icon">▼</span>';
        html += '<span class="section-icon">📱</span>App Info</h4>';
        html += `<div class="section-content" id="${appInfoId}">`;
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
    
    // Relationships
    if (data.relationships && data.relationships.length > 0) {
        html += renderRelationships(data.relationships);
    }
    
    // Labels
    if (details.labels && Object.keys(details.labels).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.entries(details.labels).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div></div>';
    }
    
    return html;
}

// Deployment-specific details (basic fallback)
function renderDeploymentSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Replica information
    if (details.replicas_desired !== undefined) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">📊</span>Replicas</h4><div class="info-grid">';
        html += `<div class="info-item"><label class="info-label">Desired</label><span class="info-value">${details.replicas_desired}</span></div>`;
        if (details.replicas_ready !== undefined) html += `<div class="info-item"><label class="info-label">Ready</label><span class="info-value">${details.replicas_ready}</span></div>`;
        if (details.replicas_available !== undefined) html += `<div class="info-item"><label class="info-label">Available</label><span class="info-value">${details.replicas_available}</span></div>`;
        if (details.replicas_updated !== undefined) html += `<div class="info-item"><label class="info-label">Updated</label><span class="info-value">${details.replicas_updated}</span></div>`;
        html += '</div></div>';
    }
    
    // Strategy
    if (details.strategy) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🎯</span>Update Strategy</h4><div class="info-grid">';
        html += `<div class="info-item"><label class="info-label">Type</label><span class="info-value">${details.strategy.type}</span></div>`;
        if (details.strategy.max_surge) html += `<div class="info-item"><label class="info-label">Max Surge</label><span class="info-value">${details.strategy.max_surge}</span></div>`;
        if (details.strategy.max_unavailable) html += `<div class="info-item"><label class="info-label">Max Unavailable</label><span class="info-value">${details.strategy.max_unavailable}</span></div>`;
        html += '</div></div>';
    }
    
    // Containers
    if (details.containers && details.containers.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🐳</span>Containers</h4>';
        details.containers.forEach((container, idx) => {
            html += '<div class="container-card">';
            html += `<div class="container-header"><span class="container-name">${idx + 1}. ${container.name}</span></div>`;
            html += '<div class="info-grid">';
            html += `<div class="info-item"><label class="info-label">Image</label><span class="info-value code">${container.image}</span></div>`;
            
            if (container.ports && container.ports.length > 0) {
                const portsStr = container.ports.map(p => `${p.container_port}/${p.protocol}`).join(', ');
                html += `<div class="info-item"><label class="info-label">Ports</label><span class="info-value">${portsStr}</span></div>`;
            }
            
            if (container.resources) {
                if (container.resources.requests) {
                    const req = container.resources.requests;
                    html += `<div class="info-item"><label class="info-label">Requests</label><span class="info-value">CPU: ${req.cpu || '0'}, Mem: ${req.memory || '0'}</span></div>`;
                }
                if (container.resources.limits) {
                    const lim = container.resources.limits;
                    html += `<div class="info-item"><label class="info-label">Limits</label><span class="info-value">CPU: ${lim.cpu || '∞'}, Mem: ${lim.memory || '∞'}</span></div>`;
                }
            }
            
            html += '</div></div>';
        });
        html += '</div>';
    }
    
    // Conditions
    if (details.conditions && details.conditions.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">⚡</span>Conditions</h4><div class="info-grid">';
        details.conditions.forEach(condition => {
            const statusClass = condition.status === 'True' ? 'success' : condition.status === 'False' ? 'danger' : 'warning';
            html += `
                <div class="info-item">
                    <label class="info-label">${condition.type}</label>
                    <span class="info-value"><span class="badge-${statusClass}">${condition.status}</span></span>
                </div>
            `;
            if (condition.message) {
                html += `<div class="info-item" style="grid-column: 1 / -1;"><span class="info-value" style="font-size: 0.9em; color: var(--text-secondary);">${condition.message}</span></div>`;
            }
        });
        html += '</div></div>';
    }
    
    // Selector
    if (details.selector && Object.keys(details.selector).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🎯</span>Selector</h4><div class="labels-container">';
        Object.entries(details.selector).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div>';
    }
    
    // Relationships
    if (data.relationships && data.relationships.length > 0) {
        html += renderRelationships(data.relationships);
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

// Service-specific details (basic fallback)
function renderServiceSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Service info
    if (details.type || details.cluster_ip) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔗</span>Service Details</h4><div class="info-grid">';
        if (details.type) html += `<div class="info-item"><label class="info-label">Type</label><span class="info-value">${details.type}</span></div>`;
        if (details.cluster_ip) html += `<div class="info-item"><label class="info-label">Cluster IP</label><span class="info-value code">${details.cluster_ip}</span></div>`;
        if (details.session_affinity) html += `<div class="info-item"><label class="info-label">Session Affinity</label><span class="info-value">${details.session_affinity}</span></div>`;
        if (details.endpoint_count !== undefined) html += `<div class="info-item"><label class="info-label">Endpoints</label><span class="info-value">${details.endpoint_count}</span></div>`;
        
        // External IPs if present
        if (details.external_ips && details.external_ips.length > 0) {
            html += `<div class="info-item"><label class="info-label">External IPs</label><span class="info-value">${details.external_ips.join(', ')}</span></div>`;
        }
        
        html += '</div></div>';
    }
    
    // Ports
    if (details.ports && details.ports.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔌</span>Ports</h4>';
        html += '<table style="width: 100%; border-collapse: collapse;">';
        html += '<thead><tr style="background: var(--bg-darker); text-align: left;"><th style="padding: 8px;">Name</th><th>Port</th><th>Target Port</th><th>Protocol</th><th>Node Port</th></tr></thead><tbody>';
        details.ports.forEach(port => {
            html += `
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <td style="padding: 8px;">${port.name || '-'}</td>
                    <td>${port.port}</td>
                    <td>${port.target_port || port.port}</td>
                    <td>${port.protocol || 'TCP'}</td>
                    <td>${port.node_port || '-'}</td>
                </tr>
            `;
        });
        html += '</tbody></table></div>';
    }
    
    // Relationships
    if (data.relationships && data.relationships.length > 0) {
        html += renderRelationships(data.relationships);
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

// Ingress-specific details (basic fallback)
function renderIngressSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Ingress class and TLS info
    if (details.ingress_class || details.tls_enabled !== undefined) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🌐</span>Ingress Configuration</h4><div class="info-grid">';
        if (details.ingress_class) html += `<div class="info-item"><label class="info-label">Ingress Class</label><span class="info-value">${details.ingress_class}</span></div>`;
        if (details.tls_enabled !== undefined) html += `<div class="info-item"><label class="info-label">TLS Enabled</label><span class="info-value">${details.tls_enabled ? 'Yes' : 'No'}</span></div>`;
        html += '</div></div>';
    }
    
    // TLS Configuration
    if (details.tls_config && details.tls_config.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔒</span>TLS Configuration</h4>';
        details.tls_config.forEach((tls, idx) => {
            html += '<div class="info-grid" style="margin-bottom: 12px; padding: 12px; background: var(--bg-darker); border-radius: 4px;">';
            html += `<div class="info-item"><label class="info-label">Secret</label><span class="info-value code">${tls.secret_name}</span></div>`;
            if (tls.hosts && tls.hosts.length > 0) {
                html += `<div class="info-item"><label class="info-label">Hosts</label><span class="info-value">${tls.hosts.join(', ')}</span></div>`;
            }
            html += '</div>';
        });
        html += '</div>';
    }
    
    // Rules and Paths
    if (details.rules && details.rules.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🔀</span>Routing Rules</h4>';
        details.rules.forEach((rule, idx) => {
            html += '<div style="margin-bottom: 16px; padding: 12px; background: var(--bg-darker); border-radius: 6px; border-left: 3px solid var(--primary);">';
            html += `<div style="font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">Host: ${rule.host || '* (default)' }</div>`;
            
            if (rule.paths && rule.paths.length > 0) {
                html += '<table style="width: 100%; border-collapse: collapse; margin-top: 8px;">';
                html += '<thead><tr style="background: var(--bg-darkest); text-align: left; font-size: 0.85em;"><th style="padding: 6px;">Path</th><th>Type</th><th>Service</th><th>Port</th></tr></thead><tbody>';
                rule.paths.forEach(path => {
                    html += `
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <td style="padding: 6px;"><code>${path.path}</code></td>
                            <td style="font-size: 0.85em;">${path.path_type}</td>
                            <td><span class="badge-info">${path.service}</span></td>
                            <td>${path.port}</td>
                        </tr>
                    `;
                });
                html += '</tbody></table>';
            }
            html += '</div>';
        });
        html += '</div>';
    }
    
    // Labels
    if (details.labels && Object.keys(details.labels).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.entries(details.labels).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div>';
    }
    
    // Annotations (often contain important ingress config)
    if (details.annotations && Object.keys(details.annotations).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">📝</span>Annotations</h4><div style="max-height: 200px; overflow-y: auto;">';
        Object.entries(details.annotations).forEach(([key, value]) => {
            html += `<div style="padding: 4px 0; border-bottom: 1px solid var(--border-color); font-size: 0.85em;"><strong style="color: var(--text-secondary);">${key}:</strong> <span style="color: var(--text-primary); font-family: var(--font-mono); word-break: break-all;">${value}</span></div>`;
        });
        html += '</div></div>';
    }
    
    return html;
}

// CronJob-specific details
function renderCronJobSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Schedule info
    html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">⏰</span>Schedule Information</h4><div class="info-grid">';
    
    if (details.schedule) {
        html += `
            <div class="info-item">
                <label class="info-label">Schedule</label>
                <span class="info-value"><code>${details.schedule}</code></span>
            </div>
        `;
    }
    
    if (details.suspend !== undefined) {
        html += `
            <div class="info-item">
                <label class="info-label">Suspended</label>
                <span class="info-value">${details.suspend ? 'Yes' : 'No'}</span>
            </div>
        `;
    }
    
    if (details.last_schedule_time) {
        html += `
            <div class="info-item">
                <label class="info-label">Last Schedule</label>
                <span class="info-value">${new Date(details.last_schedule_time).toLocaleString()}</span>
            </div>
        `;
    }
    
    if (details.next_run_in) {
        html += `
            <div class="info-item">
                <label class="info-label">Next Run</label>
                <span class="info-value">${details.next_run_in}</span>
            </div>
        `;
    }
    
    if (details.active_count !== undefined) {
        html += `
            <div class="info-item">
                <label class="info-label">Active Jobs</label>
                <span class="info-value">${details.active_count}</span>
            </div>
        `;
    }
    
    html += '</div></div>';
    
    // Jobs - use detailed render function from script.js if available
    if (details.jobs && details.jobs.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">📋</span>Jobs</h4>';
        if (typeof renderJobsUnderCronJob === 'function') {
            html += renderJobsUnderCronJob(details.jobs);
        } else {
            // Fallback to simple rendering
            html += '<div class="info-grid">';
            details.jobs.forEach(job => {
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
    
    // Release Information Section
    html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🚀</span>Release Information</h4><div class="info-grid">';
    
    if (data.app_name) {
        html += `
            <div class="info-item">
                <label class="info-label">App Name</label>
                <span class="info-value">${data.app_name}</span>
            </div>
        `;
    }
    
    if (data.instance) {
        html += `
            <div class="info-item">
                <label class="info-label">Instance</label>
                <span class="info-value">${data.instance}</span>
            </div>
        `;
    }
    
    if (data.version || data.helm_release?.app_version) {
        html += `
            <div class="info-item">
                <label class="info-label">Version</label>
                <span class="info-value badge-secondary">${data.version || data.helm_release.app_version}</span>
            </div>
        `;
    }
    
    if (data.replicas !== undefined) {
        html += `
            <div class="info-item">
                <label class="info-label">Replicas</label>
                <span class="info-value">${data.replicas}</span>
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
    
    html += '</div></div>';
    
    // Timestamps Section
    html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">⏰</span>Timestamps</h4><div class="info-grid">';
    
    if (data.created_at) {
        html += `
            <div class="info-item">
                <label class="info-label">Created At</label>
                <span class="info-value">${new Date(data.created_at).toLocaleString()}</span>
            </div>
        `;
    }
    
    if (data.last_deployed) {
        const lastDeployedDate = new Date(data.last_deployed);
        const timeDiff = Date.now() - lastDeployedDate.getTime();
        const daysAgo = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        const hoursAgo = Math.floor(timeDiff / (1000 * 60 * 60));
        const timeAgoText = daysAgo > 0 ? `${daysAgo}d ago` : `${hoursAgo}h ago`;
        
        html += `
            <div class="info-item">
                <label class="info-label">Last Deployed</label>
                <span class="info-value">${lastDeployedDate.toLocaleString()} <span style="color: var(--text-secondary); font-size: 0.9em;">(${timeAgoText})</span></span>
            </div>
        `;
    }
    
    html += '</div></div>';
    
    // Container Images Section
    if (data.image_tags && data.image_tags.length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🐳</span>Container Images</h4>';
        html += '<div class="container-list">';
        
        data.image_tags.forEach((tag, idx) => {
            html += `
                <div class="info-item" style="padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                    <label class="info-label">Container ${idx + 1}</label>
                    <span class="info-value code" style="font-family: var(--font-mono); font-size: 0.9em;">${tag}</span>
                </div>
            `;
        });
        
        html += '</div></div>';
    }
    
    // Load revision history asynchronously
    html += '<div id="releaseRevisionHistory" style="margin-top: 16px;"><div class="loading" style="text-align: center; padding: 20px; color: var(--text-secondary);">Loading revision history...</div></div>';
    
    // Trigger loading of revision history
    setTimeout(() => {
        loadReleaseRevisionHistory(data.namespace, data.deployment_name);
    }, 100);
    
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

// Load revision history for a release (deployment)
async function loadReleaseRevisionHistory(namespace, deploymentName) {
    const container = document.getElementById('releaseRevisionHistory');
    if (!container) return;
    
    try {
        const response = await fetch(`/api/releases/${namespace}/${deploymentName}/history`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const history = await response.json();
        
        if (!history || history.length === 0) {
            container.innerHTML = '<div class="info-section"><p style="color: var(--text-secondary); text-align: center;">No revision history available</p></div>';
            return;
        }
        
        let html = '<div class="info-section"><h4 class="section-title"><span class="section-icon">📜</span>Revision History</h4>';
        html += '<div class="revision-timeline">';
        
        history.forEach((revision, idx) => {
            const isLatest = idx === 0;
            const revisionDate = new Date(revision.created_at);
            const timeDiff = Date.now() - revisionDate.getTime();
            const daysAgo = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
            const hoursAgo = Math.floor(timeDiff / (1000 * 60 * 60));
            const minutesAgo = Math.floor(timeDiff / (1000 * 60));
            
            let timeAgoText;
            if (daysAgo > 0) timeAgoText = `${daysAgo}d ago`;
            else if (hoursAgo > 0) timeAgoText = `${hoursAgo}h ago`;
            else timeAgoText = `${minutesAgo}m ago`;
            
            html += `
                <div class="revision-item ${isLatest ? 'revision-latest' : ''}">
                    <div class="revision-marker"></div>
                    <div class="revision-content">
                        <div class="revision-header">
                            <span class="revision-number">Revision ${revision.revision}</span>
                            ${isLatest ? '<span class="revision-badge">Current</span>' : ''}
                            <span class="revision-time">${timeAgoText}</span>
                        </div>
                        <div class="revision-timestamp">${revisionDate.toLocaleString()}</div>
            `;
            
            // Show image changes
            if (revision.images && revision.images.length > 0) {
                html += '<div class="revision-images">';
                revision.images.forEach((image, imgIdx) => {
                    const previousImage = idx < history.length - 1 ? history[idx + 1].images[imgIdx] : null;
                    const imageChanged = previousImage && image !== previousImage;
                    
                    html += `
                        <div class="revision-image ${imageChanged ? 'image-changed' : ''}">
                            <span class="image-label">Container ${imgIdx + 1}:</span>
                            <code class="image-value">${image}</code>
                            ${imageChanged ? '<span class="change-badge">CHANGED</span>' : ''}
                        </div>
                    `;
                    
                    if (imageChanged && previousImage) {
                        html += `
                            <div class="revision-change-detail">
                                <span style="color: var(--danger);">− ${previousImage}</span>
                            </div>
                        `;
                    }
                });
                html += '</div>';
            }
            
            // Show replica changes
            if (revision.replicas !== undefined) {
                const previousReplicas = idx < history.length - 1 ? history[idx + 1].replicas : null;
                const replicasChanged = previousReplicas !== null && revision.replicas !== previousReplicas;
                
                if (replicasChanged) {
                    html += `
                        <div class="revision-detail">
                            <span class="change-badge">REPLICAS</span>
                            <span style="color: var(--text-secondary);">${previousReplicas} → ${revision.replicas}</span>
                        </div>
                    `;
                }
            }
            
            html += '</div></div>';
        });
        
        html += '</div></div>';
        container.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading revision history:', error);
        container.innerHTML = '<div class="info-section"><p style="color: var(--text-secondary); text-align: center;">Failed to load revision history</p></div>';
    }
}

/* ============================================
   COLLAPSIBLE SECTION HELPERS
   ============================================ */

// Toggle collapsible section visibility
function toggleSection(sectionId) {
    console.log('toggleSection called with ID:', sectionId);
    const section = document.getElementById(sectionId);
    const icon = document.getElementById(`${sectionId}-icon`);
    
    console.log('Section found:', section ? 'yes' : 'no');
    console.log('Icon found:', icon ? 'yes' : 'no');
    
    if (section && icon) {
        const isVisible = section.style.display !== 'none';
        section.style.display = isVisible ? 'none' : 'block';
        icon.textContent = isVisible ? '▶' : '▼';
        console.log('Toggled to:', isVisible ? 'collapsed' : 'expanded');
    }
}

// Helper function to create collapsible section wrapper
function createCollapsibleSection(title, icon, content, defaultOpen = true) {
    const sectionId = `section-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const displayStyle = defaultOpen ? 'block' : 'none';
    const iconChar = defaultOpen ? '▼' : '▶';
    
    return `
        <div class="details-section collapsible-section">
            <h4 class="section-title collapsible-header" onclick="toggleSection('${sectionId}')">
                <span class="collapse-icon" id="${sectionId}-icon">${iconChar}</span>
                <span class="section-icon">${icon}</span>${title}
            </h4>
            <div class="section-content" id="${sectionId}" style="display: ${displayStyle};">
                ${content}
            </div>
        </div>
    `;
}
