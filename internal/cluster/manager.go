package cluster

import (
	"fmt"
	"sync"
	"time"

	"atlas/internal/cache"
	"atlas/internal/k8s"
)

// Manager handles multiple Kubernetes clusters and their k8s clients.
type Manager struct {
	clusters map[string]*ClusterInfo
	cache    cache.Cache
	mu       sync.RWMutex
}

// ClusterInfo holds information about a Kubernetes cluster.
type ClusterInfo struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Kubeconfig string      `json:"-"` // Don't expose in JSON
	APIServer  string      `json:"api_server"`
	Region     string      `json:"region,omitempty"`
	Client     *k8s.Client `json:"-"`
	Status     string      `json:"status"` // "healthy", "unhealthy", "unknown"
	LastCheck  time.Time   `json:"last_check"`
}

// NewManager creates a new cluster manager.
func NewManager(cache cache.Cache) *Manager {
	return &Manager{
		clusters: make(map[string]*ClusterInfo),
		cache:    cache,
	}
}

// AddCluster registers a new Kubernetes cluster.
func (m *Manager) AddCluster(config ClusterConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Create k8s client from kubeconfig
	client, err := k8s.NewClientFromConfig(config.Kubeconfig)
	if err != nil {
		return fmt.Errorf("failed to create k8s client for cluster %s: %w", config.ID, err)
	}

	// Create cluster info
	info := &ClusterInfo{
		ID:         config.ID,
		Name:       config.Name,
		Kubeconfig: config.Kubeconfig,
		APIServer:  config.APIServer,
		Region:     config.Region,
		Client:     client,
		Status:     "unknown",
		LastCheck:  time.Now(),
	}

	// Store in clusters map
	m.clusters[config.ID] = info

	// Cache cluster metadata
	cacheKey := fmt.Sprintf("cluster:%s:config", config.ID)
	m.cache.Set(cacheKey, info, 24*time.Hour)

	// Update clusters list in cache
	m.updateClustersList()

	return nil
}

// AddClusterWithClient registers a new Kubernetes cluster with an existing client.
// Use this when you already have a k8s client instance.
func (m *Manager) AddClusterWithClient(id, name, region string, client *k8s.Client) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Get API server URL from client config
	apiServer := "unknown"
	if client.Config != nil && client.Config.Host != "" {
		apiServer = client.Config.Host
	}

	// Create cluster info
	info := &ClusterInfo{
		ID:         id,
		Name:       name,
		Kubeconfig: "", // Not from kubeconfig file
		APIServer:  apiServer,
		Region:     region,
		Client:     client,
		Status:     "unknown",
		LastCheck:  time.Now(),
	}

	// Store in clusters map
	m.clusters[id] = info

	// Cache cluster metadata
	cacheKey := fmt.Sprintf("cluster:%s:config", id)
	m.cache.Set(cacheKey, info, 24*time.Hour)

	// Update clusters list in cache
	m.updateClustersList()

	return nil
}

// GetCluster retrieves a cluster's k8s client by ID.
func (m *Manager) GetCluster(clusterID string) (*k8s.Client, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	info, exists := m.clusters[clusterID]
	if !exists {
		return nil, fmt.Errorf("cluster %s not found", clusterID)
	}

	return info.Client, nil
}

// GetClusterInfo retrieves full cluster information by ID.
func (m *Manager) GetClusterInfo(clusterID string) (*ClusterInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	info, exists := m.clusters[clusterID]
	if !exists {
		return nil, fmt.Errorf("cluster %s not found", clusterID)
	}

	return info, nil
}

// ListClusters returns information about all registered clusters.
func (m *Manager) ListClusters() []ClusterInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()

	clusters := make([]ClusterInfo, 0, len(m.clusters))
	for _, info := range m.clusters {
		clusters = append(clusters, *info)
	}

	return clusters
}

// RemoveCluster removes a cluster from the manager.
func (m *Manager) RemoveCluster(clusterID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.clusters[clusterID]; !exists {
		return fmt.Errorf("cluster %s not found", clusterID)
	}

	delete(m.clusters, clusterID)

	// Remove from cache
	cacheKey := fmt.Sprintf("cluster:%s:config", clusterID)
	m.cache.Delete(cacheKey)

	// Update clusters list
	m.updateClustersList()

	return nil
}

// SetUserCluster stores the user's currently selected cluster.
func (m *Manager) SetUserCluster(userID, clusterID string) error {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Verify cluster exists
	if _, exists := m.clusters[clusterID]; !exists {
		return fmt.Errorf("cluster %s not found", clusterID)
	}

	// Store in cache with 24h TTL
	cacheKey := fmt.Sprintf("user:%s:selected_cluster", userID)
	m.cache.Set(cacheKey, clusterID, 24*time.Hour)

	return nil
}

// GetUserCluster retrieves the user's currently selected cluster.
func (m *Manager) GetUserCluster(userID string) (string, bool) {
	cacheKey := fmt.Sprintf("user:%s:selected_cluster", userID)
	data, ok := m.cache.Get(cacheKey)
	if !ok {
		return "", false
	}

	clusterID, ok := data.(string)
	return clusterID, ok
}

// GetDefaultCluster returns the first available cluster or empty string if none exist.
func (m *Manager) GetDefaultCluster() string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for id := range m.clusters {
		return id
	}

	return ""
}

// CheckHealth checks the health of a specific cluster.
func (m *Manager) CheckHealth(clusterID string) error {
	info, err := m.GetClusterInfo(clusterID)
	if err != nil {
		return err
	}

	// Try to get server version to verify connectivity
	_, err = info.Client.Clientset.Discovery().ServerVersion()
	if err != nil {
		m.updateClusterStatus(clusterID, "unhealthy")
		return fmt.Errorf("cluster %s is unhealthy: %w", clusterID, err)
	}

	m.updateClusterStatus(clusterID, "healthy")
	return nil
}

// CheckAllHealth checks the health of all registered clusters.
func (m *Manager) CheckAllHealth() map[string]error {
	m.mu.RLock()
	clusterIDs := make([]string, 0, len(m.clusters))
	for id := range m.clusters {
		clusterIDs = append(clusterIDs, id)
	}
	m.mu.RUnlock()

	results := make(map[string]error)
	for _, id := range clusterIDs {
		results[id] = m.CheckHealth(id)
	}

	return results
}

// updateClusterStatus updates the health status of a cluster.
func (m *Manager) updateClusterStatus(clusterID, status string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if info, exists := m.clusters[clusterID]; exists {
		info.Status = status
		info.LastCheck = time.Now()

		// Update in cache
		cacheKey := fmt.Sprintf("cluster:%s:config", clusterID)
		m.cache.Set(cacheKey, info, 24*time.Hour)
	}
}

// updateClustersList updates the cached list of all clusters.
func (m *Manager) updateClustersList() {
	clusterIDs := make([]string, 0, len(m.clusters))
	for id := range m.clusters {
		clusterIDs = append(clusterIDs, id)
	}

	m.cache.Set("clusters:list", clusterIDs, 24*time.Hour)
}

// ClusterConfig holds configuration for adding a new cluster.
type ClusterConfig struct {
	ID         string
	Name       string
	Kubeconfig string
	APIServer  string
	Region     string
}
