package main

import (
	"context"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"atlas/internal/app"
	"atlas/internal/cache"
	"atlas/internal/cluster"
	"atlas/internal/config"
	"atlas/internal/httpapi"
	"atlas/internal/k8s"
)

func main() {
	// Initialize structured logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	logger.Info("Starting Atlas Kubernetes Dashboard")

	// Load configuration
	configPath := getEnv("CONFIG_PATH", "config.yaml")
	cfg, err := config.LoadWithEnvOverrides(configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Validate configuration
	if err := cfg.Validate(); err != nil {
		log.Fatalf("Invalid configuration: %v", err)
	}

	logger.Info("Configuration loaded",
		"config_file", configPath,
		"cache_type", cfg.Cache.Type,
		"multi_cluster", cfg.Features.MultiCluster,
		"clusters_count", len(cfg.Clusters))

	// Initialize cache
	cacheConfig := cache.Config{
		Type:          cfg.Cache.Type,
		RedisAddr:     cfg.Cache.Redis.Addr,
		RedisPassword: cfg.Cache.Redis.Password,
		RedisDB:       cfg.Cache.Redis.DB,
		ClusterID:     getFirstClusterID(cfg),
		EnableMetrics: true,
	}

	cacheImpl, err := cache.New(cacheConfig)
	if err != nil {
		log.Fatalf("Failed to create cache: %v", err)
	}

	logger.Info("Cache initialized", "type", cfg.Cache.Type)

	var application *app.App

	if cfg.Features.MultiCluster && len(cfg.Clusters) > 0 {
		// Multi-cluster mode
		logger.Info("Starting in multi-cluster mode")
		clusterManager := cluster.NewManager(cacheImpl)

		// Add each cluster from configuration
		for _, clusterCfg := range cfg.Clusters {
			logger.Info("Adding cluster",
				"id", clusterCfg.ID,
				"name", clusterCfg.Name,
				"kubeconfig", clusterCfg.Kubeconfig)

			err := clusterManager.AddCluster(cluster.ClusterConfig{
				ID:         clusterCfg.ID,
				Name:       clusterCfg.Name,
				Kubeconfig: clusterCfg.Kubeconfig,
				APIServer:  clusterCfg.APIServer,
				Region:     clusterCfg.Region,
			})
			if err != nil {
				logger.Error("Failed to add cluster",
					"id", clusterCfg.ID,
					"error", err)
				log.Fatalf("Failed to add cluster %s: %v", clusterCfg.ID, err)
			}
			logger.Info("Cluster added successfully", "id", clusterCfg.ID)
		}

		application = app.NewWithClusterManager(clusterManager, cacheImpl, logger)

		// Set default K8sClient to the first cluster for backward compatibility
		if len(cfg.Clusters) > 0 {
			defaultClient, err := clusterManager.GetCluster(cfg.Clusters[0].ID)
			if err == nil {
				application.K8sClient = defaultClient
				logger.Info("Default cluster set", "id", cfg.Clusters[0].ID)
			}
		}
	} else {
		// Single cluster mode
		logger.Info("Starting in single-cluster mode")
		k8sClient, err := k8s.NewClient()
		if err != nil {
			log.Fatalf("Failed to create Kubernetes client: %v", err)
		}
		application = app.New(k8sClient, cacheImpl, logger)
	}

	// Start cache cleanup if using memory cache
	if memCache, ok := cacheImpl.(*cache.MemoryCache); ok {
		stopCleanup := memCache.StartCleanupRoutine(5 * time.Minute)
		defer stopCleanup()
		logger.Info("Started memory cache cleanup routine")
	}

	// Setup HTTP routes
	router := httpapi.SetupRoutes(application)

	port := fmt.Sprintf("%d", cfg.Server.Port)
	logger.Info("Starting HTTP server", "port", port)

	// Configure HTTP server with timeouts for production use
	server := &http.Server{
		Addr:           ":" + port,
		Handler:        router,
		ReadTimeout:    15 * time.Second,  // Max time to read request
		WriteTimeout:   15 * time.Second,  // Max time to write response
		IdleTimeout:    120 * time.Second, // Max time for keep-alive
		MaxHeaderBytes: 1 << 20,           // 1 MB
	}

	// Setup graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	// Start server in goroutine
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Server error", "error", err)
			log.Fatal(err)
		}
	}()

	logger.Info("Server started successfully",
		"port", port,
		"multi_cluster", cfg.Features.MultiCluster,
		"clusters", len(cfg.Clusters))

	// Wait for interrupt signal
	<-sigChan
	logger.Info("Shutdown signal received, gracefully shutting down...")

	// Create shutdown context with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Attempt graceful shutdown
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("Server shutdown error", "error", err)
		log.Fatal(err)
	}

	logger.Info("Server stopped gracefully")
}

// getEnv retrieves an environment variable or returns a default value.
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getFirstClusterID returns the ID of the first cluster, or "default" if no clusters exist
func getFirstClusterID(cfg *config.Config) string {
	if len(cfg.Clusters) > 0 {
		return cfg.Clusters[0].ID
	}
	return "default"
}
