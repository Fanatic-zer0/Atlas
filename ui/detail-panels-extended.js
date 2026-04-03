/* ============================================
   DETAILED RENDER FUNCTIONS FOR NEW RESOURCE TYPES
   ============================================ */

// StatefulSet-specific details
function renderStatefulSetSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Status Section
    const statusId = `status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    html += '<div class="details-section collapsible-section">';
    html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${statusId}')">`;
    html += `<span class="collapse-icon" id="${statusId}-icon">▼</span>`;
    html += '<span class="section-icon">📊</span>Status</h4>';
    html += `<div class="section-content" id="${statusId}" style="display: block;">`;
    html += '<div class="info-grid">';
    html += `<div class="info-item"><label class="info-label">Ready Replicas:</label><span class="info-value">${details.ready_replicas || data.ready_replicas || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Current Replicas:</label><span class="info-value">${details.current_replicas || data.current_replicas || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Updated Replicas:</label><span class="info-value">${details.updated_replicas || data.updated_replicas || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Status:</label><span class="info-value">${data.status || 'Unknown'}</span></div>`;
    if (details.update_strategy || data.update_strategy) {
        html += `<div class="info-item"><label class="info-label">Update Strategy:</label><span class="info-value">${details.update_strategy || data.update_strategy}</span></div>`;
    }
    if (details.pod_management_policy || data.pod_management_policy) {
        html += `<div class="info-item"><label class="info-label">Pod Management:</label><span class="info-value">${details.pod_management_policy || data.pod_management_policy}</span></div>`;
    }
    html += '</div></div>';
    
    // Selector
    if (details.selector || data.selector) {
        const selector = details.selector || data.selector;
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🎯</span>Selector</h4><div class="labels-container">';
        Object.entries(selector).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div></div>';
    }
    
    // Template/Containers
    if (details.containers && details.containers.length > 0) {
        const containersId = `containers-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="details-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${containersId}')">`;
        html += `<span class="collapse-icon" id="${containersId}-icon">▼</span>`;
        html += `<span class="section-icon">📦</span>Pod Template Containers (${details.containers.length})</h4>`;
        html += `<div class="section-content" id="${containersId}" style="display: block;">`;
        details.containers.forEach((container) => {
            html += '<div class="container-card">';
            html += `<div class="container-header"><span class="container-name">${container.name}</span></div>`;
            html += '<div class="info-grid">';
html += `<div class="info-item"><label class="info-label">Image:</label><span class="info-value code">${container.image}</span></div>`;
            if (container.ports && container.ports.length > 0) {
                const portsStr = container.ports.map(p => `${p.container_port}/${p.protocol || 'TCP'}`).join(', ');
                html += `<div class="info-item"><label class="info-label">Ports:</label><span class="info-value">${portsStr}</span></div>`;
            }
            html += '</div></div>';
        });
        html += '</div></div>';
    }
    
    // Relationships
    if (data.relationships && data.relationships.length > 0) {
        html += renderRelationships(data.relationships);
    }
    
    // Labels
    if (data.labels && Object.keys(data.labels).length > 0) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🏷️</span>Labels</h4><div class="labels-container">';
        Object.entries(data.labels).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div></div>';
    }
    
    return html;
}

// DaemonSet-specific details
function renderDaemonSetSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Status Section
    const statusId = `status-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    html += '<div class="details-section collapsible-section">';
    html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${statusId}')">`;
    html += `<span class="collapse-icon" id="${statusId}-icon">▼</span>`;
    html += '<span class="section-icon">📊</span>Status</h4>';
    html += `<div class="section-content" id="${statusId}" style="display: block;">`;
    html += '<div class="info-grid">';
    html += `<div class="info-item"><label class="info-label">Desired Number:</label><span class="info-value">${details.desired_number_scheduled || data.desired_number_scheduled || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Current Number:</label><span class="info-value">${details.current_number_scheduled || data.current_number_scheduled || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Number Ready:</label><span class="info-value">${details.number_ready || data.number_ready || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Updated Number:</label><span class="info-value">${details.updated_number_scheduled || data.updated_number_scheduled || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Available:</label><span class="info-value">${details.number_available || data.number_available || 0}</span></div>`;
    if (details.number_misscheduled || data.number_misscheduled) {
        html += `<div class="info-item"><label class="info-label">Misscheduled:</label><span class="info-value badge-warning">${details.number_misscheduled || data.number_misscheduled}</span></div>`;
    }
    html += '</div></div></div>';
    
    // Selector
    if (details.selector || data.selector) {
        const selector = details.selector || data.selector;
        const selectorId = `selector-ds-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="info-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${selectorId}')">`;
        html += `<span class="collapse-icon" id="${selectorId}-icon">▼</span>`;
        html += '<span class="section-icon">🎯</span>Selector</h4>';
        html += `<div class="section-content" id="${selectorId}" style="display: block;">`;
        html += '<div class="labels-container">';
        Object.entries(selector).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div></div>';
    }
    
    // Relationships
    if (data.relationships && data.relationships.length > 0) {
        html += renderRelationships(data.relationships);
    }
    
    // Labels
    if (data.labels && Object.keys(data.labels).length > 0) {
        const labelsId = `labels-ds-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="info-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${labelsId}')">`;
        html += `<span class="collapse-icon" id="${labelsId}-icon">▼</span>`;
        html += '<span class="section-icon">🏷️</span>Labels</h4>';
        html += `<div class="section-content" id="${labelsId}" style="display: block;">`;
        html += '<div class="labels-container">';
        Object.entries(data.labels).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div></div>';
    }
    
    return html;
}

// Job-specific details
function renderJobSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Status Section
    const statusId = `status-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    html += '<div class="details-section collapsible-section">';
    html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${statusId}')">`;
    html += `<span class="collapse-icon" id="${statusId}-icon">▼</span>`;
    html += '<span class="section-icon">⚙️</span>Status</h4>';
    html += `<div class="section-content" id="${statusId}" style="display: block;">`;
    html += '<div class="info-grid">';
    html += `<div class="info-item"><label class="info-label">Status:</label><span class="info-value">${data.status || 'Unknown'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Completions:</label><span class="info-value">${details.completions || data.completions || 1}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Succeeded:</label><span class="info-value">${details.succeeded || data.succeeded || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Failed:</label><span class="info-value">${details.failed || data.failed || 0}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Active:</label><span class="info-value">${details.active || data.active || 0}</span></div>`;
    if (details.parallelism !== undefined) {
        html += `<div class="info-item"><label class="info-label">Parallelism:</label><span class="info-value">${details.parallelism}</span></div>`;
    }
    if (details.backoff_limit !== undefined) {
        html += `<div class="info-item"><label class="info-label">Backoff Limit:</label><span class="info-value">${details.backoff_limit}</span></div>`;
    }
    if (details.start_time) {
        html += `<div class="info-item"><label class="info-label">Started:</label><span class="info-value">${details.start_time}</span></div>`;
    }
    if (details.completion_time) {
        html += `<div class="info-item"><label class="info-label">Completed:</label><span class="info-value">${details.completion_time}</span></div>`;
    }
    if (details.duration || data.duration) {
        html += `<div class="info-item"><label class="info-label">Duration:</label><span class="info-value">${details.duration || data.duration}</span></div>`;
    }
    html += '</div></div></div>';
    
    // Conditions
    if (details.conditions && details.conditions.length > 0) {
        const conditionsId = `conditions-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="details-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${conditionsId}')">`;
        html += `<span class="collapse-icon" id="${conditionsId}-icon">▼</span>`;
        html += '<span class="section-icon">🔍</span>Conditions</h4>';
        html += `<div class="section-content" id="${conditionsId}" style="display: block;">`;
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
    
    // Relationships
    if (data.relationships && data.relationships.length > 0) {
        html += renderRelationships(data.relationships);
    }
    
    // Labels
    if (data.labels && Object.keys(data.labels).length > 0) {
        const labelsId = `labels-job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        html += '<div class="info-section collapsible-section">';
        html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${labelsId}')">`;
        html += `<span class="collapse-icon" id="${labelsId}-icon">▼</span>`;
        html += '<span class="section-icon">🏷️</span>Labels</h4>';
        html += `<div class="section-content" id="${labelsId}" style="display: block;">`;
        html += '<div class="labels-container">';
        Object.entries(data.labels).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div></div>';
    }
    
    return html;
}

// Endpoints-specific details
function renderEndpointsSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Addresses Section
    if (details.addresses || data.addresses) {
        const addresses = details.addresses || data.addresses;
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">🔗</span>Addresses (${addresses.length})</h4>`;
        if (addresses.length > 0) {
            html += '<table class="resource-table"><thead><tr><th>IP</th><th>Ready</th><th>Target</th><th>Node</th></tr></thead><tbody>';
            addresses.forEach(addr => {
                const readyClass = addr.ready ? 'badge-success' : 'badge-warning';
                const targetInfo = addr.target_kind && addr.target_name ? `${addr.target_kind}/${addr.target_name}` : '-';
                html += `<tr>`;
                html += `<td><span class="mono-text">${addr.ip}</span></td>`;
                html += `<td><span class="badge ${readyClass}">${addr.ready ? 'Ready' : 'Not Ready'}</span></td>`;
                html += `<td>${targetInfo}</td>`;
                html += `<td>${addr.node || '-'}</td>`;
                html += `</tr>`;
            });
            html += '</tbody></table>';
        }
        html += '</div>';
    }
    
    // Ports Section
    if (details.ports || data.ports) {
        const ports = details.ports || data.ports;
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">🔌</span>Ports</h4>`;
        html += '<div class="info-grid">';
        ports.forEach((port, idx) => {
            html += `<div class="info-item"><label class="info-label">${port.name || `Port ${idx + 1}`}:</label><span class="info-value">${port.port}/${port.protocol}</span></div>`;
        });
        html += '</div></div>';
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

// StorageClass-specific details
function renderStorageClassSpecificDetails(data) {
    let html = '';
    const details = data.details || data;
    
    // Configuration Section
    html += '<div class="details-section">';
    html += '<h4 class="section-title"><span class="section-icon">⚙️</span>Configuration</h4>';
    html += '<div class="info-grid">';
    html += `<div class="info-item"><label class="info-label">Provisioner:</label><span class="info-value mono-text">${data.provisioner}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Reclaim Policy:</label><span class="info-value">${data.reclaim_policy || '-'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Volume Binding:</label><span class="info-value">${data.volume_binding_mode || '-'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Allow Expansion:</label><span class="info-value">${data.allow_volume_expansion ? '✓ Yes' : '✗ No'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Default Class:</label><span class="info-value">${data.is_default ? '✓ Yes' : '✗ No'}</span></div>`;
    html += '</div></div>';
    
    // Parameters
    if (data.parameters && Object.keys(data.parameters).length > 0) {
        html += '<div class="details-section">';
        html += '<h4 class="section-title"><span class="section-icon">📝</span>Parameters</h4>';
        html += '<div class="info-grid">';
        Object.entries(data.parameters).forEach(([key, value]) => {
            html += `<div class="info-item"><label class="info-label">${key}:</label><span class="info-value mono-text">${value}</span></div>`;
        });
        html += '</div></div>';
    }
    
    // Mount Options
    if (data.mount_options && data.mount_options.length > 0) {
        html += '<div class="details-section">';
        html += '<h4 class="section-title"><span class="section-icon">🔧</span>Mount Options</h4>';
        html += '<div class="labels-container">';
        data.mount_options.forEach(opt => {
            html += `<span class="label-badge">${opt}</span>`;
        });
        html += '</div></div>';
    }
    
    // Using PVCs
    if (data.using_pvcs && data.using_pvcs.length > 0) {
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">💾</span>Using PVCs (${data.using_pvcs.length})</h4>`;
        html += '<table class="resource-table"><thead><tr><th>Name</th><th>Namespace</th><th>Status</th></tr></thead><tbody>';
        data.using_pvcs.forEach(pvc => {
            const statusClass = pvc.status === 'Bound' ? 'badge-success' : 'badge-warning';
            html += `<tr><td>${pvc.name}</td><td>${pvc.namespace}</td><td><span class="badge ${statusClass}">${pvc.status}</span></td></tr>`;
        });
        html += '</tbody></table></div>';
    }
    
    return html;
}

// HPA-specific details
function renderHPASpecificDetails(data) {
    let html = '';
    
    // Scaling Status
    html += '<div class="details-section">';
    html += '<h4 class="section-title"><span class="section-icon">📊</span>Scaling Status</h4>';
    html += '<div class="info-grid">';
    html += `<div class="info-item"><label class="info-label">Target:</label><span class="info-value mono-text">${data.target_ref_kind}/${data.target_ref_name}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Min Replicas:</label><span class="info-value">${data.min_replicas}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Max Replicas:</label><span class="info-value">${data.max_replicas}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Current Replicas:</label><span class="info-value">${data.current_replicas}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Desired Replicas:</label><span class="info-value">${data.desired_replicas}</span></div>`;
    html += '</div></div>';
    
    // Metrics
    if (data.metrics && data.metrics.length > 0) {
        html += '<div class="details-section">';
        html += '<h4 class="section-title"><span class="section-icon">📈</span>Metrics</h4>';
        html += '<div class="info-grid">';
        data.metrics.forEach((metric, idx) => {
            html += `<div class="info-item"><label class="info-label">Type:</label><span class="info-value">${metric.type}</span></div>`;
            if (metric.resource_name) {
                html += `<div class="info-item"><label class="info-label">Resource:</label><span class="info-value">${metric.resource_name}</span></div>`;
            }
            if (metric.target) {
                html += `<div class="info-item"><label class="info-label">Target:</label><span class="info-value">${metric.target}</span></div>`;
            }
            if (metric.metric_name) {
                html += `<div class="info-item"><label class="info-label">Metric:</label><span class="info-value">${metric.metric_name}</span></div>`;
            }
        });
        html += '</div></div>';
    }
    
    // Current Metrics
    if (data.current_metrics && data.current_metrics.length > 0) {
        html += '<div class="details-section">';
        html += '<h4 class="section-title"><span class="section-icon">📊</span>Current Metrics</h4>';
        html += '<div class="info-grid">';
        data.current_metrics.forEach((metric) => {
            if (metric.resource_name) {
                html += `<div class="info-item"><label class="info-label">${metric.resource_name}:</label><span class="info-value">${metric.current || '-'}</span></div>`;
            }
        });
        html += '</div></div>';
    }
    
    // Conditions
    if (data.conditions && data.conditions.length > 0) {
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">🔍</span>Conditions</h4>`;
        html += '<div class="conditions-list">';
        data.conditions.forEach(condition => {
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

// PDB-specific details
function renderPDBSpecificDetails(data) {
    let html = '';
    
    // Disruption Budget
    html += '<div class="details-section">';
    html += '<h4 class="section-title"><span class="section-icon">🛡️</span>Disruption Budget</h4>';
    html += '<div class="info-grid">';
    html += `<div class="info-item"><label class="info-label">Min Available:</label><span class="info-value">${data.min_available || '-'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Max Unavailable:</label><span class="info-value">${data.max_unavailable || '-'}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Current Healthy:</label><span class="info-value">${data.current_healthy}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Desired Healthy:</label><span class="info-value">${data.desired_healthy}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Expected Pods:</label><span class="info-value">${data.expected_pods}</span></div>`;
    html += `<div class="info-item"><label class="info-label">Disruptions Allowed:</label><span class="info-value">${data.disruptions_allowed}</span></div>`;
    html += '</div></div>';
    
    // Selector
    if (data.selector && data.selector.matchLabels) {
        html += '<div class="info-section"><h4 class="section-title"><span class="section-icon">🎯</span>Selector</h4><div class="labels-container">';
        Object.entries(data.selector.matchLabels).forEach(([key, value]) => {
            html += `<span class="label-badge">${key}: ${value}</span>`;
        });
        html += '</div></div>';
    }
    
    // Conditions
    if (data.conditions && data.conditions.length > 0) {
        html += '<div class="details-section">';
        html += `<h4 class="section-title"><span class="section-icon">🔍</span>Conditions</h4>`;
        html += '<div class="conditions-list">';
        data.conditions.forEach(condition => {
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

// Helper function to render relationships
function renderRelationships(relationships) {
    const sectionId = `relationships-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let html = '<div class="details-section collapsible-section">';
    html += `<h4 class="section-title collapsible-header" onclick="toggleSection('${sectionId}')">`;
    html += `<span class="collapse-icon" id="${sectionId}-icon">▼</span>`;
    html += `<span class="section-icon">🔗</span>Relationships (${relationships.length})</h4>`;
    html += `<div class="section-content" id="${sectionId}" style="display: block;">`;
    html += '<div class="relationships-list">';
    relationships.forEach(rel => {
        html += '<div class="relationship-item">';
        html += `<span class="rel-icon">${rel.icon || '→'}</span>`;
        html += `<span class="rel-type">${rel.relationship_type}</span>`;
        html += `<span class="rel-resource">${rel.resource_type}: ${rel.resource_name}</span>`;
        html += '</div>';
    });
    html += '</div></div></div>';
    return html;
}
