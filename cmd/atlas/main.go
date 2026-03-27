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
	"atlas/internal/httpapi"
	"atlas/internal/k8s"
)

func main() {
	// Initialize structured logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	logger.Info("Starting Ajna Kubernetes Dashboard")

	// Initialize Kubernetes client
	client, err := k8s.NewClient()
	if err != nil {
		log.Fatalf("Failed to create Kubernetes client: %v", err)
	}

	// Initialize application with cache and logger
	application := app.New(client, logger)

	ctx := context.Background()

	// Start background cache cleanup (every 5 minutes)
	application.Cache.StartCleanupRoutine(ctx, 5*time.Minute)

	// Setup HTTP routes
	router := httpapi.SetupRoutes(application)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

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

	logger.Info("Server started successfully", "port", port)

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
