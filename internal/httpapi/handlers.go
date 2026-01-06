package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"ajna/internal/app"
	"ajna/internal/k8s"
	"ajna/internal/network"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/clientcmd"
)

func getClusterInfo(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		namespaces, err := application.K8sClient.Clientset.CoreV1().Namespaces().List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		var nsList []string
		for _, ns := range namespaces.Items {
			nsList = append(nsList, ns.Name)
		}

		config, _ := clientcmd.NewDefaultClientConfigLoadingRules().Load()
		currentContext := ""
		clusterName := ""
		if config != nil {
			currentContext = config.CurrentContext
			if ctx, ok := config.Contexts[currentContext]; ok {
				clusterName = ctx.Cluster
			}
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"cluster_name": clusterName,
			"context_name": currentContext,
			"namespaces":   nsList,
		})
	}
}

func getAllResources(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		resourceType := r.URL.Query().Get("resource_type")
		lightweight := r.URL.Query().Get("lightweight") == "true"

		cacheKey := fmt.Sprintf("resources:%s:%s:%v", namespace, resourceType, lightweight)

		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"resources":  cached,
				"total":      len(cached.([]map[string]interface{})),
				"cached":     true,
				"fetch_time": "0s",
			})
			return
		}

		startTime := time.Now()
		resources := []map[string]interface{}{}
		ctx := r.Context()

		// Fetch resources concurrently for better performance
		var mu sync.Mutex
		var wg sync.WaitGroup

		// Fetch Pods
		if resourceType == "" || resourceType == "all" || resourceType == "Pod" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				pods, err := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, pod := range pods.Items {
						resources = append(resources, map[string]interface{}{
							"name":          pod.Name,
							"namespace":     pod.Namespace,
							"resource_type": "Pod",
							"status":        string(pod.Status.Phase),
							"health_score":  calculatePodHealth(&pod),
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch Deployments
		if resourceType == "" || resourceType == "all" || resourceType == "Deployment" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				deployments, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, dep := range deployments.Items {
						resources = append(resources, map[string]interface{}{
							"name":          dep.Name,
							"namespace":     dep.Namespace,
							"resource_type": "Deployment",
							"status":        getDeploymentStatus(&dep),
							"health_score":  calculateDeploymentHealth(&dep),
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch Services
		if resourceType == "" || resourceType == "all" || resourceType == "Service" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				services, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, svc := range services.Items {
						resources = append(resources, map[string]interface{}{
							"name":          svc.Name,
							"namespace":     svc.Namespace,
							"resource_type": "Service",
							"status":        "Active",
							"health_score":  100,
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch Ingresses
		if resourceType == "" || resourceType == "all" || resourceType == "Ingress" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				ingresses, err := application.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, ing := range ingresses.Items {
						resources = append(resources, map[string]interface{}{
							"name":          ing.Name,
							"namespace":     ing.Namespace,
							"resource_type": "Ingress",
							"status":        "Active",
							"health_score":  100,
						})
					}
					mu.Unlock()
				}
			}()
		}

		wg.Wait()

		fetchTime := time.Since(startTime)
		application.Cache.Set(cacheKey, resources, 30*time.Second)

		json.NewEncoder(w).Encode(map[string]interface{}{
			"resources":  resources,
			"total":      len(resources),
			"cached":     false,
			"fetch_time": fmt.Sprintf("%.2fs", fetchTime.Seconds()),
		})
	}
}

func getResourceDetails(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		resourceType := vars["type"]
		namespace := vars["namespace"]
		name := vars["name"]

		ctx := r.Context()
		var details map[string]interface{}

		switch resourceType {
		case "Pod":
			pod, err := application.K8sClient.Clientset.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildPodDetails(pod, application, ctx)
		case "Deployment":
			dep, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildDeploymentDetails(dep, application, ctx)
		case "Service":
			svc, err := application.K8sClient.Clientset.CoreV1().Services(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildServiceDetails(svc, application, ctx)
		case "Ingress":
			ing, err := application.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildIngressDetails(ing, application, ctx)
		default:
			http.Error(w, "Unsupported resource type", http.StatusBadRequest)
			return
		}

		json.NewEncoder(w).Encode(details)
	}
}

func getIngresses(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		ingresses, err := application.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, ing := range ingresses.Items {
			hosts := []string{}
			for _, rule := range ing.Spec.Rules {
				hosts = append(hosts, rule.Host)
			}

			backends := []string{}
			for _, rule := range ing.Spec.Rules {
				if rule.HTTP != nil {
					for _, path := range rule.HTTP.Paths {
						backends = append(backends, path.Backend.Service.Name)
					}
				}
			}

			result = append(result, map[string]interface{}{
				"name":             ing.Name,
				"namespace":        ing.Namespace,
				"hosts":            hosts,
				"tls_enabled":      len(ing.Spec.TLS) > 0,
				"backend_services": backends,
				"health_score":     100,
				"status_emoji":     "✓",
			})
		}

		json.NewEncoder(w).Encode(result)
	}
}

func getServices(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		// Check cache first
		cacheKey := fmt.Sprintf("services:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		// Use optimized batch endpoint lookup from k8s package
		services, err := k8s.ListServices(r.Context(), application.K8sClient.Clientset, namespace)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Transform to response format
		result := []map[string]interface{}{}
		for _, svc := range services {
			result = append(result, map[string]interface{}{
				"name":           svc.Name,
				"namespace":      svc.Namespace,
				"type":           svc.Type,
				"cluster_ip":     svc.ClusterIP,
				"endpoint_count": svc.EndpointCount,
				"health_score":   svc.HealthScore,
				"status_emoji":   svc.StatusEmoji,
			})
		}

		// Cache for 30 seconds
		application.Cache.Set(cacheKey, result, 30*time.Second)

		json.NewEncoder(w).Encode(result)
	}
}

func getPods(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		pods, err := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, pod := range pods.Items {
			restarts := int32(0)
			ready := true
			for _, status := range pod.Status.ContainerStatuses {
				restarts += status.RestartCount
				if !status.Ready {
					ready = false
				}
			}

			result = append(result, map[string]interface{}{
				"name":         pod.Name,
				"namespace":    pod.Namespace,
				"phase":        string(pod.Status.Phase),
				"ready":        ready,
				"restarts":     restarts,
				"ip":           pod.Status.PodIP,
				"health_score": calculatePodHealth(&pod),
				"status_emoji": getPodStatusEmoji(&pod),
			})
		}

		json.NewEncoder(w).Encode(result)
	}
}

func getDeployments(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		deployments, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, dep := range deployments.Items {
			result = append(result, map[string]interface{}{
				"name":               dep.Name,
				"namespace":          dep.Namespace,
				"replicas_desired":   *dep.Spec.Replicas,
				"replicas_ready":     dep.Status.ReadyReplicas,
				"replicas_available": dep.Status.AvailableReplicas,
				"health_score":       calculateDeploymentHealth(&dep),
				"status_emoji":       getDeploymentStatusEmoji(&dep),
			})
		}

		json.NewEncoder(w).Encode(result)
	}
}

func getHealth(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		ctx := r.Context()

		// Fetch all data concurrently
		var wg sync.WaitGroup
		var mu sync.Mutex

		var nodeList []map[string]interface{}
		var healthyPods, degradedPods, criticalPods int
		var healthyDeps, degradedDeps, criticalDeps int
		var servicesWithEndpoints, servicesWithoutEndpoints int
		var ingressCount int
		var eventList []map[string]interface{}
		var podCount, depCount, svcCount int

		// Fetch nodes
		wg.Add(1)
		go func() {
			defer wg.Done()
			nodes, err := application.K8sClient.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				for _, node := range nodes.Items {
					status := "NotReady"
					for _, cond := range node.Status.Conditions {
						if cond.Type == "Ready" && cond.Status == "True" {
							status = "Ready"
						}
					}
					nodeList = append(nodeList, map[string]interface{}{
						"name":   node.Name,
						"status": status,
						"cpu":    node.Status.Capacity.Cpu().String(),
						"memory": node.Status.Capacity.Memory().String(),
						"os":     node.Status.NodeInfo.OSImage,
					})
				}
				mu.Unlock()
			}
		}()

		// Fetch pods
		wg.Add(1)
		go func() {
			defer wg.Done()
			pods, err := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				localHealthy := 0
				localDegraded := 0
				localCritical := 0
				for _, pod := range pods.Items {
					health := calculatePodHealth(&pod)
					if health >= 80 {
						localHealthy++
					} else if health >= 60 {
						localDegraded++
					} else {
						localCritical++
					}
				}
				mu.Lock()
				healthyPods = localHealthy
				degradedPods = localDegraded
				criticalPods = localCritical
				podCount = len(pods.Items)
				mu.Unlock()
			}
		}()

		// Fetch deployments
		wg.Add(1)
		go func() {
			defer wg.Done()
			deployments, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				localHealthy := 0
				localDegraded := 0
				localCritical := 0
				for _, dep := range deployments.Items {
					health := calculateDeploymentHealth(&dep)
					if health >= 80 {
						localHealthy++
					} else if health >= 60 {
						localDegraded++
					} else {
						localCritical++
					}
				}
				mu.Lock()
				healthyDeps = localHealthy
				degradedDeps = localDegraded
				criticalDeps = localCritical
				depCount = len(deployments.Items)
				mu.Unlock()
			}
		}()

		// Fetch services with endpoints
		wg.Add(1)
		go func() {
			defer wg.Done()
			services, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				localWithEndpoints := 0
				localWithoutEndpoints := 0
				for _, svc := range services.Items {
					endpoints, _ := application.K8sClient.Clientset.CoreV1().Endpoints(namespace).Get(ctx, svc.Name, metav1.GetOptions{})
					hasEndpoints := false
					if endpoints != nil {
						for _, subset := range endpoints.Subsets {
							if len(subset.Addresses) > 0 {
								hasEndpoints = true
								break
							}
						}
					}
					if hasEndpoints || svc.Spec.Type == "ExternalName" {
						localWithEndpoints++
					} else {
						localWithoutEndpoints++
					}
				}
				mu.Lock()
				servicesWithEndpoints = localWithEndpoints
				servicesWithoutEndpoints = localWithoutEndpoints
				svcCount = len(services.Items)
				mu.Unlock()
			}
		}()

		// Fetch ingresses
		wg.Add(1)
		go func() {
			defer wg.Done()
			ingresses, err := application.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				ingressCount = len(ingresses.Items)
				mu.Unlock()
			}
		}()

		// Fetch recent events
		wg.Add(1)
		go func() {
			defer wg.Done()
			events, err := application.K8sClient.Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
				Limit: 50,
			})
			if err == nil {
				mu.Lock()
				for _, event := range events.Items {
					eventList = append(eventList, map[string]interface{}{
						"type":     event.Type,
						"reason":   event.Reason,
						"message":  event.Message,
						"resource": event.InvolvedObject.Kind + "/" + event.InvolvedObject.Name,
						"count":    event.Count,
						"time":     event.LastTimestamp.Format(time.RFC3339),
					})
				}
				mu.Unlock()
			}
		}()

		wg.Wait()
		wg.Wait()

		response := map[string]interface{}{
			"summary": map[string]interface{}{
				"nodes":       len(nodeList),
				"ingresses":   ingressCount,
				"services":    svcCount,
				"deployments": depCount,
				"pods":        podCount,
			},
			"nodes": nodeList,
			"pod_health": map[string]int{
				"healthy":  healthyPods,
				"degraded": degradedPods,
				"critical": criticalPods,
			},
			"deployment_health": map[string]int{
				"healthy":  healthyDeps,
				"degraded": degradedDeps,
				"critical": criticalDeps,
			},
			"service_health": map[string]int{
				"with_endpoints":    servicesWithEndpoints,
				"without_endpoints": servicesWithoutEndpoints,
			},
			"cluster_events": eventList,
			"issues":         []map[string]interface{}{},
		}

		json.NewEncoder(w).Encode(response)
	}
}

func getReleases(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		deployments, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		releases := []map[string]interface{}{}
		for _, dep := range deployments.Items {
			version := dep.Labels["version"]
			if version == "" {
				version = dep.Labels["app.kubernetes.io/version"]
			}

			imageTags := []string{}
			for _, container := range dep.Spec.Template.Spec.Containers {
				imageTags = append(imageTags, container.Image)
			}

			release := map[string]interface{}{
				"deployment_name": dep.Name,
				"namespace":       dep.Namespace,
				"version":         version,
				"app_name":        dep.Labels["app"],
				"instance":        dep.Labels["instance"],
				"replicas":        *dep.Spec.Replicas,
				"image_tags":      imageTags,
				"created_at":      dep.CreationTimestamp.Format(time.RFC3339),
			}

			releases = append(releases, release)
		}

		json.NewEncoder(w).Encode(releases)
	}
}

func testNetwork(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		var req network.TestRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		var result map[string]interface{}

		if req.TestType == "dns" {
			result = network.TestDNS(req.Hostname)
		} else if req.TestType == "tcp" {
			result = network.TestTCP(req.Hostname, req.Port)
		} else {
			http.Error(w, "Invalid test type", http.StatusBadRequest)
			return
		}

		json.NewEncoder(w).Encode(result)
	}
}

func clearCache(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		count := application.Cache.Clear()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"message": fmt.Sprintf("Cache cleared: %d items removed", count),
		})
	}
}

func getCacheStats(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"size": application.Cache.Size(),
		})
	}
}

// Helper functions
// ...existing helper functions from k8s package...
