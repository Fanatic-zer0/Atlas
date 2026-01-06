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

	// Start background cache cleanup (every 5 minutes)
	ctx := context.Background()
	application.Cache.StartCleanupRoutine(ctx, 5*time.Minute)

	// Setup HTTP routes
	router := httpapi.SetupRoutes(application)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("🚀 Ajna server starting on port %s", port)
	if err := http.ListenAndServe(":"+port, router); err != nil {
		log.Fatal(err)
	}
}
