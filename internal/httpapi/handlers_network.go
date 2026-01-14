package httpapi

import (
	"encoding/json"
	"net/http"

	"ajna/internal/app"
	"ajna/internal/network"
)

// testNetwork handles network connectivity testing
func testNetwork(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req network.TestRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			application.Logger.Error("Failed to decode network test request", "error", err)
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		var result map[string]interface{}

		application.Logger.Info("Network test requested",
			"test_type", req.TestType,
			"hostname", req.Hostname)

		switch req.TestType {
		case "dns":
			result = network.TestDNS(req.Hostname)
		case "tcp":
			result = network.TestTCP(req.Hostname, req.Port)
		case "http":
			result = network.TestHTTP(req.Hostname, false)
		case "https":
			result = network.TestHTTP(req.Hostname, true)
		default:
			application.Logger.Warn("Unknown network test type", "test_type", req.TestType)
			http.Error(w, "Unknown test type", http.StatusBadRequest)
			return
		}

		json.NewEncoder(w).Encode(result)
	}
}
