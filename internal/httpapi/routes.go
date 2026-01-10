package httpapi

import (
	"net/http"

	"ajna/internal/app"

	"github.com/gorilla/mux"
)

func SetupRoutes(application *app.App) *mux.Router {
	r := mux.NewRouter()

	// Serve static files
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("./ui"))))
	r.HandleFunc("/", serveIndex)

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
	r.HandleFunc("/api/configmaps/{namespace}", getConfigMaps(application)).Methods("GET")
	r.HandleFunc("/api/secrets/{namespace}", getSecrets(application)).Methods("GET")
	r.HandleFunc("/api/network/test", testNetwork(application)).Methods("POST")
	r.HandleFunc("/api/cache/clear", clearCache(application)).Methods("POST")
	r.HandleFunc("/api/cache/stats", getCacheStats(application)).Methods("GET")

	return r
}

func serveIndex(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "./ui/index.html")
}
