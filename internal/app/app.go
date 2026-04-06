package app

import (
	"log/slog"

	"atlas/internal/cache"
	"atlas/internal/cluster"
	"atlas/internal/k8s"
)

// App holds the application's core dependencies.
type App struct {
	K8sClient      *k8s.Client
	Cache          cache.Cache
	ClusterManager *cluster.Manager
	Logger         *slog.Logger
}

// New creates a new App instance for single-cluster mode.
func New(client *k8s.Client, cacheImpl cache.Cache, logger *slog.Logger) *App {
	return &App{
		K8sClient: client,
		Cache:     cacheImpl,
		Logger:    logger,
	}
}

// NewWithClusterManager creates a new App instance with multi-cluster support.
func NewWithClusterManager(manager *cluster.Manager, cacheImpl cache.Cache, logger *slog.Logger) *App {
	return &App{
		ClusterManager: manager,
		Cache:          cacheImpl,
		Logger:         logger,
	}
}

// GetK8sClient returns the k8s client for the current cluster.
// In multi-cluster mode, it returns the client for the specified cluster ID.
func (a *App) GetK8sClient(clusterID string) (*k8s.Client, error) {
	if a.ClusterManager != nil {
		return a.ClusterManager.GetCluster(clusterID)
	}
	return a.K8sClient, nil
}
