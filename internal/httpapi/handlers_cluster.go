package httpapi

import (
	"encoding/json"
	"net/http"

	"atlas/internal/app"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
)

// getClusterInfo returns cluster information including namespaces
func getClusterInfo(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		namespaces, err := application.K8sClient.Clientset.CoreV1().Namespaces().List(r.Context(), metav1.ListOptions{})
		if err != nil {
			application.Logger.Error("Failed to list namespaces", "error", err)
			http.Error(w, "Failed to retrieve cluster information", http.StatusInternalServerError)
			return
		}

		var nsList []string
		for _, ns := range namespaces.Items {
			nsList = append(nsList, ns.Name)
		}

		config, err := clientcmd.NewDefaultClientConfigLoadingRules().Load()
		if err != nil {
			application.Logger.Warn("Failed to load kubeconfig", "error", err)
		}

		currentContext := ""
		clusterName := ""
		if config != nil {
			currentContext = config.CurrentContext
			if ctx, ok := config.Contexts[currentContext]; ok {
				clusterName = ctx.Cluster
			}
		}

		application.Logger.Info("Cluster info retrieved",
			"cluster", clusterName,
			"context", currentContext,
			"namespace_count", len(nsList))

		json.NewEncoder(w).Encode(map[string]interface{}{
			"cluster_name": clusterName,
			"context_name": currentContext,
			"namespaces":   nsList,
		})
	}
}
