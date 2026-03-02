package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"ajna/internal/app"

	"github.com/gorilla/mux"
)

// loggingMiddleware logs all HTTP requests
func loggingMiddleware(logger *slog.Logger) mux.MiddlewareFunc {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			logger.Info("HTTP Request",
				"method", r.Method,
				"path", r.URL.Path,
				"remote", r.RemoteAddr,
			)
			next.ServeHTTP(w, r)
			logger.Info("HTTP Response",
				"method", r.Method,
				"path", r.URL.Path,
				"duration_ms", time.Since(start).Milliseconds(),
			)
		})
	}
}

func SetupRoutes(application *app.App) *mux.Router {
	r := mux.NewRouter()

	// Add logging middleware
	r.Use(loggingMiddleware(application.Logger))

	// Serve static files
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("./ui"))))
	r.HandleFunc("/", serveIndex)

	// Health check endpoints
	r.HandleFunc("/healthz", healthCheck(application)).Methods("GET")
	r.HandleFunc("/readyz", readinessCheck(application)).Methods("GET")

	// API routes
	r.HandleFunc("/api/cluster", getClusterInfo(application)).Methods("GET")
	r.HandleFunc("/api/pvpvc/{namespace}", getPVPVC(application)).Methods("GET")
	r.HandleFunc("/api/resources/{namespace}", getAllResources(application)).Methods("GET")
	r.HandleFunc("/api/resource/{type}/{namespace}/{name}", getResourceDetails(application)).Methods("GET")
	r.HandleFunc("/api/ingresses/{namespace}", getIngresses(application)).Methods("GET")
	r.HandleFunc("/api/services/{namespace}", getServices(application)).Methods("GET")
	r.HandleFunc("/api/pods/{namespace}", getPods(application)).Methods("GET")
	r.HandleFunc("/api/deployments/{namespace}", getDeployments(application)).Methods("GET")
	r.HandleFunc("/api/health/{namespace}", getHealth(application)).Methods("GET")
	r.HandleFunc("/api/releases/{namespace}", getReleases(application)).Methods("GET")
	r.HandleFunc("/api/crds", getCRDs(application)).Methods("GET")
	r.HandleFunc("/api/configmaps/{namespace}", getConfigMaps(application)).Methods("GET")
	r.HandleFunc("/api/secrets/{namespace}", getSecrets(application)).Methods("GET")
	r.HandleFunc("/api/relationships/{namespace}", getResourceRelationships(application)).Methods("GET")
	r.HandleFunc("/api/network/test", testNetwork(application)).Methods("POST")
	r.HandleFunc("/api/cache/clear", clearCache(application)).Methods("POST")
	r.HandleFunc("/api/cache/stats", getCacheStats(application)).Methods("GET")

	// Export endpoints (CSV/JSON download)
	r.HandleFunc("/api/export/{resource_type}/{namespace}", getExport(application)).Methods("GET")

	return r
}

func serveIndex(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./ui/index.html")
}
