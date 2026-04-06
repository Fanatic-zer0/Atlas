package httpapi

import (
	"context"
	"encoding/json"
	"net/http"

	"atlas/internal/app"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// serveFromCacheIfUnchanged checks if cached data is still valid using ResourceVersion
// Returns true if cache was served, false if caller should fetch fresh data
func serveFromCacheIfUnchanged(
	w http.ResponseWriter,
	ctx context.Context,
	application *app.App,
	cacheKey string,
	resourceType string, // "pods", "services", "configmaps", etc.
	namespace string,
) bool {
	// Get cached ResourceVersion
	cachedVersion, hasCachedVersion := application.Cache.GetResourceVersion(cacheKey)
	if !hasCachedVersion || cachedVersion == "" {
		return false
	}

	// Quick check: Get current ResourceVersion with Limit=1
	var currentVersion string
	switch resourceType {
	case "pods":
		if list, err := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = list.ResourceVersion
		}
	case "services":
		if list, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = list.ResourceVersion
		}
	case "configmaps":
		if list, err := application.K8sClient.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = list.ResourceVersion
		}
	case "secrets":
		if list, err := application.K8sClient.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = list.ResourceVersion
		}
	case "pvcs":
		if list, err := application.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = list.ResourceVersion
		}
	default:
		// Unknown resource type, can't check version
		return false
	}

	// If version unchanged, serve from cache
	if currentVersion != "" && currentVersion == cachedVersion {
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return true
		}
	}

	return false
}

// GetSliceFromCache safely retrieves a slice from cache with type conversion.
// Handles both []map[string]interface{} and []interface{} types from Redis deserialization.
// This prevents type assertion panics when using Redis cache.
func GetSliceFromCache(application *app.App, key string) ([]map[string]interface{}, bool) {
	data, ok := application.Cache.Get(key)
	if !ok {
		return nil, false
	}

	// Try direct type assertion first (memory cache)
	if slice, ok := data.([]map[string]interface{}); ok {
		return slice, true
	}

	// Try interface{} slice and convert (Redis cache)
	if interfaceSlice, ok := data.([]interface{}); ok {
		result := make([]map[string]interface{}, 0, len(interfaceSlice))
		for _, item := range interfaceSlice {
			if mapItem, ok := item.(map[string]interface{}); ok {
				result = append(result, mapItem)
			}
		}
		return result, len(result) > 0
	}

	return nil, false
}

// GetMapFromCache safely retrieves a map from cache with type conversion.
func GetMapFromCache(application *app.App, key string) (map[string]interface{}, bool) {
	data, ok := application.Cache.Get(key)
	if !ok {
		return nil, false
	}

	if mapData, ok := data.(map[string]interface{}); ok {
		return mapData, true
	}

	return nil, false
}
