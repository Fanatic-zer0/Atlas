package httpapi

import (
	"encoding/json"
	"net/http"

	"atlas/internal/app"
)

// healthCheck provides a simple liveness probe
func healthCheck(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":        "ok",
			"cache_entries": application.Cache.Stats().Entries,
		})
	}
}

// readinessCheck verifies the application can connect to Kubernetes API
func readinessCheck(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// Check K8s connection
		_, err := application.K8sClient.Clientset.Discovery().ServerVersion()
		if err != nil {
			application.Logger.Error("Readiness check failed", "error", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status": "not_ready",
				"error":  err.Error(),
			})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":        "ready",
			"cache_entries": application.Cache.Stats().Entries,
		})
	}
}
