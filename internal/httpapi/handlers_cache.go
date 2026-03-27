package httpapi

import (
	"encoding/json"
	"net/http"

	"atlas/internal/app"
)

// clearCache clears all cached data
func clearCache(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		count := application.Cache.Clear()

		application.Logger.Info("Cache cleared", "entries_removed", count)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"message":         "Cache cleared successfully",
			"entries_removed": count,
		})
	}
}

// getCacheStats returns cache statistics
func getCacheStats(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		size := application.Cache.Size()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"size": size,
		})
	}
}
