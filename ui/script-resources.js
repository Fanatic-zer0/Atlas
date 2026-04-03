/* ============================================
   NEW RESOURCE LOADING FUNCTIONS
   StatefulSets, DaemonSets, Jobs, Endpoints, 
   StorageClasses, HPAs, PDBs
   ============================================ */

// Load StatefulSets
async function loadStatefulSets() {
    console.log('Loading StatefulSets...');
    const container = document.getElementById('statefulsetsContent');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading StatefulSets...</div>';

    try {
        const response = await fetch(`/api/statefulsets/${encodeURIComponent(currentNamespace)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const statefulsets = data.statefulsets || [];
        
        let html = `
            <div class="page-header">
                <h2 class="page-title">StatefulSets</h2>
                <p class="page-subtitle">Stateful applications with persistent storage</p>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">StatefulSets (${statefulsets.length})</h3>
                </div>
                <table class="resource-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Namespace</th>
                            <th>Ready</th>
                            <th>Current</th>
                            <th>Updated</th>
                            <th>Status</th>
                            <th>Age</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (statefulsets.length === 0) {
            html += '<tr><td colspan="7" class="no-data">No StatefulSets found</td></tr>';
        } else {
            statefulsets.forEach(sts => {
                const statusClass = sts.status === 'Healthy' ? 'badge-success' : 'badge-warning';
                html += `
                    <tr class="clickable-row" onclick="openDetailPanel('statefulsetsDetails', 'StatefulSet', '${sts.namespace}', '${sts.name}')">
                        <td>📊 ${sts.name}</td>
                        <td><span class="badge-secondary">${sts.namespace}</span></td>
                        <td><span class="badge ${statusClass}">${sts.ready_replicas}/${sts.desired_replicas}</span></td>
                        <td><span class="badge-info">${sts.current_replicas}</span></td>
                        <td><span class="badge-info">${sts.updated_replicas}</span></td>
                        <td><span class="badge ${statusClass}">${sts.status}</span></td>
                        <td>${sts.age}</td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading StatefulSets:', error);
        container.innerHTML = `<div class="error-message">Failed to load StatefulSets: ${error.message}</div>`;
    }
}

// Load DaemonSets
async function loadDaemonSets() {
    console.log('Loading DaemonSets...');
    const container = document.getElementById('daemonsetsContent');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading DaemonSets...</div>';

    try {
        const response = await fetch(`/api/daemonsets/${encodeURIComponent(currentNamespace)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const daemonsets = data.daemonsets || [];
        
        let html = `
            <div class="page-header">
                <h2 class="page-title">DaemonSets</h2>
                <p class="page-subtitle">Pods running on all nodes</p>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">DaemonSets (${daemonsets.length})</h3>
                </div>
                <table class="resource-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Namespace</th>
                            <th>Desired</th>
                            <th>Current</th>
                            <th>Ready</th>
                            <th>Status</th>
                            <th>Age</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (daemonsets.length === 0) {
            html += '<tr><td colspan="7" class="no-data">No DaemonSets found</td></tr>';
        } else {
            daemonsets.forEach(ds => {
                const statusClass = ds.status === 'Healthy' ? 'badge-success' : 'badge-warning';
                html += `
                    <tr class="clickable-row" onclick="openDetailPanel('daemonsetsDetails', 'DaemonSet', '${ds.namespace}', '${ds.name}')">
                        <td>🔄 ${ds.name}</td>
                        <td><span class="badge-secondary">${ds.namespace}</span></td>
                        <td><span class="badge-info">${ds.desired_number_scheduled}</span></td>
                        <td><span class="badge-info">${ds.current_number_scheduled}</span></td>
                        <td><span class="badge ${statusClass}">${ds.number_ready}</span></td>
                        <td><span class="badge ${statusClass}">${ds.status}</span></td>
                        <td>${ds.age}</td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading DaemonSets:', error);
        container.innerHTML = `<div class="error-message">Failed to load DaemonSets: ${error.message}</div>`;
    }
}

// Load Endpoints
async function loadEndpoints() {
    console.log('Loading Endpoints...');
    const container = document.getElementById('endpointsContent');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading Endpoints...</div>';

    try {
        const response = await fetch(`/api/endpoints/${encodeURIComponent(currentNamespace)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const endpoints = data.endpoints || [];
        
        let html = `
            <div class="page-header">
                <h2 class="page-title">Endpoints</h2>
                <p class="page-subtitle">Service endpoint addresses</p>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Endpoints (${endpoints.length})</h3>
                </div>
                <table class="resource-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Namespace</th>
                            <th>Ready Endpoints</th>
                            <th>Total Endpoints</th>
                            <th>Addresses</th>
                            <th>Age</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (endpoints.length === 0) {
            html += '<tr><td colspan="6" class="no-data">No Endpoints found</td></tr>';
        } else {
            endpoints.forEach(ep => {
                const statusClass = ep.ready_endpoints === ep.total_endpoints ? 'badge-success' : 'badge-warning';
                const addressDisplay = ep.addresses && ep.addresses.length > 0 
                    ? ep.addresses.slice(0, 3).join(', ') + (ep.addresses.length > 3 ? '...' : '')
                    : '-';
                
                html += `
                    <tr class="clickable-row" onclick="openDetailPanel('endpointsDetails', 'Endpoints', '${ep.namespace}', '${ep.name}')">
                        <td>🔗 ${ep.name}</td>
                        <td><span class="badge-secondary">${ep.namespace}</span></td>
                        <td><span class="badge ${statusClass}">${ep.ready_endpoints}</span></td>
                        <td><span class="badge-info">${ep.total_endpoints}</span></td>
                        <td><span class="mono-text text-muted">${addressDisplay}</span></td>
                        <td>${ep.age}</td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading Endpoints:', error);
        container.innerHTML = `<div class="error-message">Failed to load Endpoints: ${error.message}</div>`;
    }
}

// Load StorageClasses
async function loadStorageClasses() {
    console.log('Loading StorageClasses...');
    const container = document.getElementById('storageclassesContent');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading StorageClasses...</div>';

    try {
        const response = await fetch('/api/storageclasses');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const storageclasses = data.storageclasses || [];
        
        let html = `
            <div class="page-header">
                <h2 class="page-title">Storage Classes</h2>
                <p class="page-subtitle">Cluster storage provisioners</p>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">Storage Classes (${storageclasses.length})</h3>
                </div>
                <table class="resource-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Provisioner</th>
                            <th>Reclaim Policy</th>
                            <th>Volume Binding</th>
                            <th>Allow Expansion</th>
                            <th>Default</th>
                            <th>Age</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (storageclasses.length === 0) {
            html += '<tr><td colspan="7" class="no-data">No StorageClasses found</td></tr>';
        } else {
            storageclasses.forEach(sc => {
                const defaultBadge = sc.is_default ? '<span class="badge-success">✓</span>' : '';
                html += `
                    <tr class="clickable-row" onclick="openDetailPanel('storageclassesDetails', 'StorageClass', 'cluster', '${sc.name}')">
                        <td>💿 ${sc.name} ${defaultBadge}</td>
                        <td><span class="mono-text text-muted">${sc.provisioner}</span></td>
                        <td>${sc.reclaim_policy || '-'}</td>
                        <td>${sc.volume_binding_mode || '-'}</td>
                        <td>${sc.allow_volume_expansion ? '✓' : '-'}</td>
                        <td>${sc.is_default ? '✓' : '-'}</td>
                        <td>${sc.age}</td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading StorageClasses:', error);
        container.innerHTML = `<div class="error-message">Failed to load StorageClasses: ${error.message}</div>`;
    }
}

// Load HPAs (Horizontal Pod Autoscalers)
async function loadHPAs() {
    console.log('Loading HPAs...');
    const container = document.getElementById('hpasContent');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading HPAs...</div>';

    try {
        const response = await fetch(`/api/hpas/${encodeURIComponent(currentNamespace)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const hpas = data.hpas || [];
        
        let html = `
            <div class="page-header">
                <h2 class="page-title">Horizontal Pod Autoscalers</h2>
                <p class="page-subtitle">Automatic pod scaling based on metrics</p>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">HPAs (${hpas.length})</h3>
                </div>
                <table class="resource-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Namespace</th>
                            <th>Target</th>
                            <th>Min/Max Replicas</th>
                            <th>Current Replicas</th>
                            <th>Metrics</th>
                            <th>Age</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (hpas.length === 0) {
            html += '<tr><td colspan="7" class="no-data">No HPAs found</td></tr>';
        } else {
            hpas.forEach(hpa => {
                const metricsDisplay = hpa.metrics && hpa.metrics.length > 0 
                    ? hpa.metrics.map(m => m.type).join(', ')
                    : '-';
                
                html += `
                    <tr class="clickable-row" onclick="openDetailPanel('hpasDetails', 'HorizontalPodAutoscaler', '${hpa.namespace}', '${hpa.name}')">
                        <td>📊 ${hpa.name}</td>
                        <td><span class="badge-secondary">${hpa.namespace}</span></td>
                        <td><span class="mono-text">${hpa.target_ref_kind}/${hpa.target_ref_name}</span></td>
                        <td><span class="badge-info">${hpa.min_replicas} / ${hpa.max_replicas}</span></td>
                        <td><span class="badge-${hpa.current_replicas === hpa.desired_replicas ? 'success' : 'warning'}">${hpa.current_replicas}</span></td>
                        <td><span class="text-muted">${metricsDisplay}</span></td>
                        <td>${hpa.age}</td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading HPAs:', error);
        container.innerHTML = `<div class="error-message">Failed to load HPAs: ${error.message}</div>`;
    }
}

// Load PDBs (Pod Disruption Budgets)
async function loadPDBs() {
    console.log('Loading PDBs...');
    const container = document.getElementById('pdbsContent');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading PDBs...</div>';

    try {
        const response = await fetch(`/api/pdbs/${encodeURIComponent(currentNamespace)}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const pdbs = data.pdbs || [];
        
        let html = `
            <div class="page-header">
                <h2 class="page-title">Pod Disruption Budgets</h2>
                <p class="page-subtitle">Maintain pod availability during disruptions</p>
            </div>
            
            <div class="card">
                <div class="card-header">
                    <h3 class="card-title">PDBs (${pdbs.length})</h3>
                </div>
                <table class="resource-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Namespace</th>
                            <th>Min Available</th>
                            <th>Max Unavailable</th>
                            <th>Current Healthy</th>
                            <th>Disruptions Allowed</th>
                            <th>Age</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (pdbs.length === 0) {
            html += '<tr><td colspan="7" class="no-data">No PDBs found</td></tr>';
        } else {
            pdbs.forEach(pdb => {
                const healthClass = pdb.current_healthy >= pdb.desired_healthy ? 'success' : 'danger';
                html += `
                    <tr class="clickable-row" onclick="openDetailPanel('pdbsDetails', 'PodDisruptionBudget', '${pdb.namespace}', '${pdb.name}')">
                        <td>🛡️ ${pdb.name}</td>
                        <td><span class="badge-secondary">${pdb.namespace}</span></td>
                        <td>${pdb.min_available || '-'}</td>
                        <td>${pdb.max_unavailable || '-'}</td>
                        <td><span class="badge-${healthClass}">${pdb.current_healthy}/${pdb.desired_healthy}</span></td>
                        <td><span class="badge-info">${pdb.disruptions_allowed}</span></td>
                        <td>${pdb.age}</td>
                    </tr>
                `;
            });
        }

        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch (error) {
        console.error('Error loading PDBs:', error);
        container.innerHTML = `<div class="error-message">Failed to load PDBs: ${error.message}</div>`;
    }
}
