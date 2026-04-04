package main

import (
	"context"
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

	// Get configuration from environment
	cacheType := getEnv("CACHE_TYPE", "memory")
	clusterID := getEnv("CLUSTER_ID", "default")
	multiClusterMode := getEnv("MULTI_CLUSTER", "false") == "true"

	// Initialize cache
	cacheConfig := cache.Config{
		Type:          cacheType,
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       0,
		ClusterID:     clusterID,
		EnableMetrics: true,
	}

	cacheImpl, err := cache.New(cacheConfig)
	if err != nil {
		log.Fatalf("Failed to create cache: %v", err)
	}

	logger.Info("Cache initialized", "type", cacheType, "cluster_id", clusterID)

	var application *app.App

	if multiClusterMode {
		// Multi-cluster mode
		logger.Info("Starting in multi-cluster mode")
		clusterManager := cluster.NewManager(cacheImpl)

		// Add clusters from configuration
		// In production, load from config file or API
		// For now, just add the default cluster
		k8sClient, err := k8s.NewClient()
		if err != nil {
			log.Fatalf("Failed to create Kubernetes client: %v", err)
		}

		err = clusterManager.AddCluster(cluster.ClusterConfig{
			ID:         clusterID,
			Name:       getEnv("CLUSTER_NAME", "Default Cluster"),
			Kubeconfig: getEnv("KUBECONFIG", ""),
			APIServer:  "https://kubernetes.default.svc",
			Region:     getEnv("CLUSTER_REGION", ""),
		})
		if err != nil {
			log.Fatalf("Failed to add cluster to manager: %v", err)
		}

		application = app.NewWithClusterManager(clusterManager, cacheImpl, logger)

		// Set default K8sClient for backward compatibility with existing handlers
		application.K8sClient = k8sClient
	} else {
		// Single cluster mode (legacy)
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

	port := getEnv("PORT", "8080")
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

	logger.Info("Server started successfully", "port", port, "multi_cluster", multiClusterMode)

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
