package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"ajna/internal/app"
	"ajna/internal/httpapi"
	"ajna/internal/k8s"
)

func main() {
	// Initialize Kubernetes client
	client, err := k8s.NewClient()
	if err != nil {
		log.Fatalf("Failed to create Kubernetes client: %v", err)
	}

	// Initialize application with cache
	application := app.New(client)

	ctx := context.Background()

	// Start background cache cleanup (every 5 minutes)
	application.Cache.StartCleanupRoutine(ctx, 5*time.Minute)

	// Setup HTTP routes
	router := httpapi.SetupRoutes(application)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 Ajna server starting on port %s", port)

	// Configure HTTP server with timeouts for production use
	server := &http.Server{
		Addr:           ":" + port,
		Handler:        router,
		ReadTimeout:    15 * time.Second,  // Max time to read request
		WriteTimeout:   15 * time.Second,  // Max time to write response
		IdleTimeout:    120 * time.Second, // Max time for keep-alive
		MaxHeaderBytes: 1 << 20,           // 1 MB
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
