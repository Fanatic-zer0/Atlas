package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"ajna/internal/app"
	"ajna/internal/k8s"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// getClusterInfo moved to handlers_cluster.go

func getAllResources(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		resourceType := r.URL.Query().Get("resource_type")
		lightweight := r.URL.Query().Get("lightweight") == "true"

		cacheKey := fmt.Sprintf("resources:%s:%s:%v", namespace, resourceType, lightweight)
		ctx := r.Context()

		// Check if we have cached version
		cachedVersion, hasCachedVersion := application.Cache.GetResourceVersion(cacheKey)

		// Quick ResourceVersion check to see if anything changed
		if hasCachedVersion && cachedVersion != "" {
			// Do a lightweight List with Limit=1 to just get the ResourceVersion
			quickCheck, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{Limit: 1})
			if quickCheck != nil && quickCheck.ResourceVersion == cachedVersion {
				// Nothing changed, return cached data
				if cached, ok := application.Cache.Get(cacheKey); ok {
					json.NewEncoder(w).Encode(cached)
					return
				}
			}
		}

		// Check full cache (in case ResourceVersion check was skipped)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		startTime := time.Now()
		resources := []map[string]interface{}{}

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

		// Fetch PersistentVolumes (cluster-scoped, regardless of namespace)
		if resourceType == "" || resourceType == "all" || resourceType == "PersistentVolume" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				pvs, err := application.K8sClient.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, pv := range pvs.Items {
						details := map[string]interface{}{}
						if !lightweight {
							details["spec"] = map[string]interface{}{
								"storageClassName": pv.Spec.StorageClassName,
								"capacity": map[string]interface{}{
									"storage": func() string {
										if storage, ok := pv.Spec.Capacity["storage"]; ok {
											return storage.String()
										}
										return ""
									}(),
								},
								"claimRef": func() map[string]interface{} {
									if pv.Spec.ClaimRef != nil {
										return map[string]interface{}{
											"name":      pv.Spec.ClaimRef.Name,
											"namespace": pv.Spec.ClaimRef.Namespace,
										}
									}
									return nil
								}(),
							}
							details["status"] = map[string]interface{}{
								"phase": string(pv.Status.Phase),
							}
						}
						resources = append(resources, map[string]interface{}{
							"name":          pv.Name,
							"namespace":     "", // PVs are cluster-scoped
							"resource_type": "PersistentVolume",
							"kind":          "PersistentVolume",
							"status":        string(pv.Status.Phase),
							"health_score":  100,
							"created_at":    pv.CreationTimestamp.Format(time.RFC3339),
							"details":       details,
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch PersistentVolumeClaims (namespace-scoped)
		if resourceType == "" || resourceType == "all" || resourceType == "PersistentVolumeClaim" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				pvcs, err := application.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, pvc := range pvcs.Items {
						details := map[string]interface{}{}
						if !lightweight {
							details["spec"] = map[string]interface{}{
								"volumeName": pvc.Spec.VolumeName,
								"storageClassName": func() string {
									if pvc.Spec.StorageClassName != nil {
										return *pvc.Spec.StorageClassName
									}
									return ""
								}(),
								"resources": map[string]interface{}{
									"requests": map[string]interface{}{
										"storage": func() string {
											if storage, ok := pvc.Spec.Resources.Requests["storage"]; ok {
												return storage.String()
											}
											return ""
										}(),
									},
								},
							}
							details["status"] = map[string]interface{}{
								"phase": string(pvc.Status.Phase),
								"capacity": map[string]interface{}{
									"storage": func() string {
										if storage, ok := pvc.Status.Capacity["storage"]; ok {
											return storage.String()
										}
										return ""
									}(),
								},
							}
						}
						resources = append(resources, map[string]interface{}{
							"name":          pvc.Name,
							"namespace":     pvc.Namespace,
							"resource_type": "PersistentVolumeClaim",
							"kind":          "PersistentVolumeClaim",
							"status":        string(pvc.Status.Phase),
							"health_score":  100,
							"created_at":    pvc.CreationTimestamp.Format(time.RFC3339),
							"details":       details,
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch StatefulSets
		if resourceType == "" || resourceType == "all" || resourceType == "StatefulSet" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				statefulSets, err := application.K8sClient.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, sts := range statefulSets.Items {
						desired := int32(0)
						if sts.Spec.Replicas != nil {
							desired = *sts.Spec.Replicas
						}
						status := "Healthy"
						health := 100
						if sts.Status.ReadyReplicas < desired {
							status = "Degraded"
							health = int((float64(sts.Status.ReadyReplicas) / float64(desired)) * 100)
						}
						resources = append(resources, map[string]interface{}{
							"name":          sts.Name,
							"namespace":     sts.Namespace,
							"resource_type": "StatefulSet",
							"status":        status,
							"health_score":  health,
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch DaemonSets
		if resourceType == "" || resourceType == "all" || resourceType == "DaemonSet" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				daemonSets, err := application.K8sClient.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, ds := range daemonSets.Items {
						status := "Healthy"
						health := 100
						if ds.Status.NumberReady < ds.Status.DesiredNumberScheduled {
							status = "Degraded"
							if ds.Status.DesiredNumberScheduled > 0 {
								health = int((float64(ds.Status.NumberReady) / float64(ds.Status.DesiredNumberScheduled)) * 100)
							}
						}
						resources = append(resources, map[string]interface{}{
							"name":          ds.Name,
							"namespace":     ds.Namespace,
							"resource_type": "DaemonSet",
							"status":        status,
							"health_score":  health,
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch Jobs
		if resourceType == "" || resourceType == "all" || resourceType == "Job" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				jobs, err := application.K8sClient.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, job := range jobs.Items {
						status := "Running"
						health := 50
						if job.Status.Succeeded > 0 {
							status = "Completed"
							health = 100
						} else if job.Status.Failed > 0 {
							status = "Failed"
							health = 0
						}
						resources = append(resources, map[string]interface{}{
							"name":          job.Name,
							"namespace":     job.Namespace,
							"resource_type": "Job",
							"status":        status,
							"health_score":  health,
						})
					}
					mu.Unlock()
				}
			}()
		}

		// Fetch CronJobs
		if resourceType == "" || resourceType == "all" || resourceType == "CronJob" {
			wg.Add(1)
			go func() {
				defer wg.Done()
				cronJobs, err := application.K8sClient.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
				if err == nil {
					mu.Lock()
					for _, cj := range cronJobs.Items {
						status := "Active"
						health := 100
						if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
							status = "Suspended"
							health = 50
						}
						resources = append(resources, map[string]interface{}{
							"name":          cj.Name,
							"namespace":     cj.Namespace,
							"resource_type": "CronJob",
							"status":        status,
							"health_score":  health,
						})
					}
					mu.Unlock()
				}
			}()
		}

		wg.Wait()

		// Get current ResourceVersion from one of the lists
		currentVersion := ""
		if resourceType == "" || resourceType == "all" || resourceType == "Pod" {
			if podsList, err := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{Limit: 1}); err == nil {
				currentVersion = podsList.ResourceVersion
			}
		}

		fetchTime := time.Since(startTime)
		response := map[string]interface{}{
			"resources":  resources,
			"total":      len(resources),
			"cached":     false,
			"fetch_time": fmt.Sprintf("%.2fs", fetchTime.Seconds()),
			"version":    currentVersion,
		}
		application.Cache.SetWithVersion(cacheKey, response, currentVersion, 30*time.Second)

		json.NewEncoder(w).Encode(response)
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
		case "StatefulSet":
			sts, err := application.K8sClient.Clientset.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildStatefulSetDetails(sts, application, ctx)
		case "DaemonSet":
			ds, err := application.K8sClient.Clientset.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildDaemonSetDetails(ds, application, ctx)
		case "Job":
			job, err := application.K8sClient.Clientset.BatchV1().Jobs(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildJobDetails(job, application, ctx)
		case "CronJob":
			cj, err := application.K8sClient.Clientset.BatchV1().CronJobs(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildCronJobDetails(cj, application, ctx)
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
				if rule.Host != "" {
					hosts = append(hosts, rule.Host)
				}
			}

			// Build detailed rules with paths and backends
			rules := []map[string]interface{}{}
			for _, rule := range ing.Spec.Rules {
				if rule.HTTP != nil {
					paths := []map[string]interface{}{}
					for _, p := range rule.HTTP.Paths {
						pathInfo := map[string]interface{}{
							"path":      p.Path,
							"path_type": string(*p.PathType),
						}
						if p.Backend.Service != nil {
							pathInfo["service_name"] = p.Backend.Service.Name
							if p.Backend.Service.Port.Number != 0 {
								pathInfo["service_port"] = p.Backend.Service.Port.Number
							} else {
								pathInfo["service_port"] = p.Backend.Service.Port.Name
							}
						}
						paths = append(paths, pathInfo)
					}
					rules = append(rules, map[string]interface{}{
						"host":  rule.Host,
						"paths": paths,
					})
				}
			}

			// Extract Kong plugins from annotations
			kongPlugins := []string{}
			if ing.Annotations != nil {
				for key, value := range ing.Annotations {
					if strings.Contains(key, "konghq.com/plugins") || strings.Contains(key, "plugins.konghq.com") {
						// Parse comma-separated plugin names
						plugins := strings.Split(value, ",")
						for _, plugin := range plugins {
							trimmed := strings.TrimSpace(plugin)
							if trimmed != "" {
								kongPlugins = append(kongPlugins, trimmed)
							}
						}
					}
				}
			}

			// Extract LoadBalancer IPs from status
			loadBalancerIPs := []string{}
			for _, lbIngress := range ing.Status.LoadBalancer.Ingress {
				if lbIngress.IP != "" {
					loadBalancerIPs = append(loadBalancerIPs, lbIngress.IP)
				}
				if lbIngress.Hostname != "" {
					loadBalancerIPs = append(loadBalancerIPs, lbIngress.Hostname)
				}
			}

			// IngressClass
			ingressClass := ""
			if ing.Spec.IngressClassName != nil {
				ingressClass = *ing.Spec.IngressClassName
			}

			result = append(result, map[string]interface{}{
				"name":             ing.Name,
				"namespace":        ing.Namespace,
				"ingress_class":    ingressClass,
				"hosts":            hosts,
				"rules":            rules,
				"tls_enabled":      len(ing.Spec.TLS) > 0,
				"kong_plugins":     kongPlugins,
				"loadbalancer_ips": loadBalancerIPs,
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
		ctx := r.Context()

		// Use helper function for ResourceVersion check
		if serveFromCacheIfUnchanged(w, ctx, application, cacheKey, "services", namespace) {
			return
		}

		// Fallback to regular cache check
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

		// Get ResourceVersion for cache
		currentVersion := ""
		if svcList, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(r.Context(), metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = svcList.ResourceVersion
		}

		// Cache for 30 seconds with version
		application.Cache.SetWithVersion(cacheKey, services, currentVersion, 30*time.Second)

		json.NewEncoder(w).Encode(services)
	}
}

func getPods(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		// Check cache first
		cacheKey := fmt.Sprintf("pods:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

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

		// Cache for 15 seconds
		application.Cache.Set(cacheKey, result, 15*time.Second)

		json.NewEncoder(w).Encode(result)
	}
}

func getDeployments(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		// Check cache first
		cacheKey := fmt.Sprintf("deployments:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		deployments, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, dep := range deployments.Items {
			// Extract container images
			images := []string{}
			for _, container := range dep.Spec.Template.Spec.Containers {
				images = append(images, container.Image)
			}

			// Extract resource requests/limits
			resources := []map[string]interface{}{}
			for _, container := range dep.Spec.Template.Spec.Containers {
				containerRes := map[string]interface{}{
					"name": container.Name,
				}
				if container.Resources.Requests != nil {
					requests := map[string]string{}
					if cpu, ok := container.Resources.Requests["cpu"]; ok {
						requests["cpu"] = cpu.String()
					}
					if mem, ok := container.Resources.Requests["memory"]; ok {
						requests["memory"] = mem.String()
					}
					containerRes["requests"] = requests
				}
				if container.Resources.Limits != nil {
					limits := map[string]string{}
					if cpu, ok := container.Resources.Limits["cpu"]; ok {
						limits["cpu"] = cpu.String()
					}
					if mem, ok := container.Resources.Limits["memory"]; ok {
						limits["memory"] = mem.String()
					}
					containerRes["limits"] = limits
				}
				resources = append(resources, containerRes)
			}

			desired := int32(0)
			if dep.Spec.Replicas != nil {
				desired = *dep.Spec.Replicas
			}

			result = append(result, map[string]interface{}{
				"name":               dep.Name,
				"namespace":          dep.Namespace,
				"replicas_desired":   desired,
				"replicas_ready":     dep.Status.ReadyReplicas,
				"replicas_available": dep.Status.AvailableReplicas,
				"images":             images,
				"resources":          resources,
				"health_score":       calculateDeploymentHealth(&dep),
				"status_emoji":       getDeploymentStatusEmoji(&dep),
			})
		}

		// Cache for 30 seconds
		application.Cache.Set(cacheKey, result, 30*time.Second)

		json.NewEncoder(w).Encode(result)
	}
}

func getHealth(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		ctx := r.Context()

		// Check cache first
		cacheKey := fmt.Sprintf("health:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

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

		// Fetch nodes (cache for 5 minutes - nodes don't change often)
		wg.Add(1)
		go func() {
			defer wg.Done()
			nodeCacheKey := "nodes:cluster"
			if cachedNodes, ok := application.Cache.Get(nodeCacheKey); ok {
				mu.Lock()
				nodeList = cachedNodes.([]map[string]interface{})
				mu.Unlock()
				return
			}

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
				application.Cache.Set(nodeCacheKey, nodeList, 5*time.Minute)
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

		// Fetch services with endpoints (batch fetch endpoints for performance)
		wg.Add(1)
		go func() {
			defer wg.Done()
			services, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				// Batch fetch all endpoints at once
				endpointsList, _ := application.K8sClient.Clientset.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{})
				endpointsMap := make(map[string]bool)
				for _, ep := range endpointsList.Items {
					hasAddresses := false
					for _, subset := range ep.Subsets {
						if len(subset.Addresses) > 0 {
							hasAddresses = true
							break
						}
					}
					endpointsMap[ep.Name] = hasAddresses
				}

				localWithEndpoints := 0
				localWithoutEndpoints := 0
				for _, svc := range services.Items {
					if svc.Spec.Type == "ExternalName" || endpointsMap[svc.Name] {
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

		// Cache for 30 seconds
		application.Cache.Set(cacheKey, response, 30*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

func getReleases(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		releases, err := k8s.GetReleases(r.Context(), application.K8sClient.Clientset, namespace)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(releases)
	}
}

// testNetwork moved to handlers_network.go
// clearCache moved to handlers_cache.go
// getCacheStats moved to handlers_cache.go

func getConfigMaps(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		// Check cache
		cacheKey := fmt.Sprintf("configmaps:%s", namespace)
		ctx := r.Context()

		// Use helper function for ResourceVersion check
		if serveFromCacheIfUnchanged(w, ctx, application, cacheKey, "configmaps", namespace) {
			return
		}

		// Fallback to regular cache check
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		configMaps, err := application.K8sClient.Clientset.CoreV1().ConfigMaps(namespace).List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, cm := range configMaps.Items {
			keys := []string{}
			for k := range cm.Data {
				keys = append(keys, k)
			}
			for k := range cm.BinaryData {
				keys = append(keys, k)
			}

			result = append(result, map[string]interface{}{
				"name":      cm.Name,
				"namespace": cm.Namespace,
				"keys":      keys,
				"key_count": len(keys),
				"created":   cm.CreationTimestamp.Format(time.RFC3339),
			})
		}

		// Get ResourceVersion
		currentVersion := ""
		if cmList, err := application.K8sClient.Clientset.CoreV1().ConfigMaps(namespace).List(r.Context(), metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = cmList.ResourceVersion
		}

		// Cache the result for 30 seconds with version
		response := map[string]interface{}{"configmaps": result}
		application.Cache.SetWithVersion(cacheKey, response, currentVersion, 30*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

func getSecrets(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]

		// Check cache
		cacheKey := fmt.Sprintf("secrets:%s", namespace)
		ctx := r.Context()

		// Use helper function for ResourceVersion check
		if serveFromCacheIfUnchanged(w, ctx, application, cacheKey, "secrets", namespace) {
			return
		}

		// Fallback to regular cache check
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		secrets, err := application.K8sClient.Clientset.CoreV1().Secrets(namespace).List(r.Context(), metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, secret := range secrets.Items {
			keys := []string{}
			for k := range secret.Data {
				keys = append(keys, k)
			}

			result = append(result, map[string]interface{}{
				"name":      secret.Name,
				"namespace": secret.Namespace,
				"type":      string(secret.Type),
				"keys":      keys,
				"key_count": len(keys),
				"created":   secret.CreationTimestamp.Format(time.RFC3339),
			})
		}

		// Get ResourceVersion
		currentVersion := ""
		if secretList, err := application.K8sClient.Clientset.CoreV1().Secrets(namespace).List(r.Context(), metav1.ListOptions{Limit: 1}); err == nil {
			currentVersion = secretList.ResourceVersion
		}

		// Cache the result for 30 seconds with version
		response := map[string]interface{}{"secrets": result}
		application.Cache.SetWithVersion(cacheKey, response, currentVersion, 30*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

func getPVPVC(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		ctx := r.Context()

		// Check cache
		cacheKey := fmt.Sprintf("pvpvc:%s", namespace)

		// ResourceVersion check
		cachedVersion, hasCachedVersion := application.Cache.GetResourceVersion(cacheKey)
		if hasCachedVersion && cachedVersion != "" {
			quickCheck, _ := application.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{Limit: 1})
			if quickCheck != nil && quickCheck.ResourceVersion == cachedVersion {
				if cached, ok := application.Cache.Get(cacheKey); ok {
					json.NewEncoder(w).Encode(cached)
					return
				}
			}
		}

		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		// Fetch all PVs (cluster-wide)
		pvList, err := application.K8sClient.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to fetch PVs: %v", err), http.StatusInternalServerError)
			return
		}

		// Fetch all PVCs in the namespace
		pvcList, err := application.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to fetch PVCs: %v", err), http.StatusInternalServerError)
			return
		}

		// Create a map of PVs for quick lookup
		pvMap := make(map[string]interface{})
		for _, pv := range pvList.Items {
			accessModes := []string{}
			for _, mode := range pv.Spec.AccessModes {
				accessModes = append(accessModes, string(mode))
			}

			reclaimPolicy := ""
			if pv.Spec.PersistentVolumeReclaimPolicy != "" {
				reclaimPolicy = string(pv.Spec.PersistentVolumeReclaimPolicy)
			}

			// Determine volume type
			volumeType := "Unknown"
			volumeDetails := map[string]interface{}{}
			if pv.Spec.HostPath != nil {
				volumeType = "HostPath"
				volumeDetails["path"] = pv.Spec.HostPath.Path
				if pv.Spec.HostPath.Type != nil {
					volumeDetails["type"] = string(*pv.Spec.HostPath.Type)
				}
			} else if pv.Spec.NFS != nil {
				volumeType = "NFS"
				volumeDetails["server"] = pv.Spec.NFS.Server
				volumeDetails["path"] = pv.Spec.NFS.Path
				volumeDetails["readOnly"] = pv.Spec.NFS.ReadOnly
			} else if pv.Spec.CSI != nil {
				volumeType = "CSI"
				volumeDetails["driver"] = pv.Spec.CSI.Driver
				volumeDetails["volumeHandle"] = pv.Spec.CSI.VolumeHandle
				if pv.Spec.CSI.FSType != "" {
					volumeDetails["fsType"] = pv.Spec.CSI.FSType
				}
			} else if pv.Spec.AWSElasticBlockStore != nil {
				volumeType = "AWS EBS"
				volumeDetails["volumeID"] = pv.Spec.AWSElasticBlockStore.VolumeID
				volumeDetails["fsType"] = pv.Spec.AWSElasticBlockStore.FSType
			} else if pv.Spec.GCEPersistentDisk != nil {
				volumeType = "GCE PD"
				volumeDetails["pdName"] = pv.Spec.GCEPersistentDisk.PDName
				volumeDetails["fsType"] = pv.Spec.GCEPersistentDisk.FSType
			} else if pv.Spec.AzureDisk != nil {
				volumeType = "Azure Disk"
				volumeDetails["diskName"] = pv.Spec.AzureDisk.DiskName
				volumeDetails["diskURI"] = pv.Spec.AzureDisk.DataDiskURI
			} else if pv.Spec.AzureFile != nil {
				volumeType = "Azure File"
				volumeDetails["shareName"] = pv.Spec.AzureFile.ShareName
				volumeDetails["secretName"] = pv.Spec.AzureFile.SecretName
			} else if pv.Spec.ISCSI != nil {
				volumeType = "iSCSI"
				volumeDetails["targetPortal"] = pv.Spec.ISCSI.TargetPortal
				volumeDetails["iqn"] = pv.Spec.ISCSI.IQN
				volumeDetails["lun"] = pv.Spec.ISCSI.Lun
			} else if pv.Spec.Glusterfs != nil {
				volumeType = "Glusterfs"
				volumeDetails["endpoints"] = pv.Spec.Glusterfs.EndpointsName
				volumeDetails["path"] = pv.Spec.Glusterfs.Path
			} else if pv.Spec.CephFS != nil {
				volumeType = "CephFS"
				volumeDetails["monitors"] = pv.Spec.CephFS.Monitors
			} else if pv.Spec.FC != nil {
				volumeType = "Fibre Channel"
				volumeDetails["targetWWNs"] = pv.Spec.FC.TargetWWNs
			} else if pv.Spec.Local != nil {
				volumeType = "Local"
				volumeDetails["path"] = pv.Spec.Local.Path
			}

			// Volume mode
			volumeMode := "Filesystem"
			if pv.Spec.VolumeMode != nil {
				volumeMode = string(*pv.Spec.VolumeMode)
			}

			// Node affinity
			nodeAffinity := ""
			if pv.Spec.NodeAffinity != nil && pv.Spec.NodeAffinity.Required != nil {
				if len(pv.Spec.NodeAffinity.Required.NodeSelectorTerms) > 0 {
					nodeAffinity = "Required"
				}
			}

			pvInfo := map[string]interface{}{
				"name":   pv.Name,
				"status": string(pv.Status.Phase),
				"capacity": func() string {
					if storage, ok := pv.Spec.Capacity["storage"]; ok {
						return storage.String()
					}
					return "Unknown"
				}(),
				"storage_class":  pv.Spec.StorageClassName,
				"access_modes":   accessModes,
				"reclaim_policy": reclaimPolicy,
				"volume_type":    volumeType,
				"volume_mode":    volumeMode,
				"volume_details": volumeDetails,
				"node_affinity":  nodeAffinity,
				"claim_ref":      nil,
				"created_at":     pv.CreationTimestamp.Format(time.RFC3339),
				"age_days":       int(time.Since(pv.CreationTimestamp.Time).Hours() / 24),
			}

			if pv.Spec.ClaimRef != nil {
				pvInfo["claim_ref"] = map[string]interface{}{
					"name":      pv.Spec.ClaimRef.Name,
					"namespace": pv.Spec.ClaimRef.Namespace,
				}
			}

			pvMap[pv.Name] = pvInfo
		}

		// Build PVC information with associated PV details
		pvcData := []map[string]interface{}{}
		for _, pvc := range pvcList.Items {
			accessModes := []string{}
			for _, mode := range pvc.Spec.AccessModes {
				accessModes = append(accessModes, string(mode))
			}

			storageClass := ""
			if pvc.Spec.StorageClassName != nil {
				storageClass = *pvc.Spec.StorageClassName
			}

			requestedStorage := ""
			if storage, ok := pvc.Spec.Resources.Requests["storage"]; ok {
				requestedStorage = storage.String()
			}

			actualStorage := ""
			if storage, ok := pvc.Status.Capacity["storage"]; ok {
				actualStorage = storage.String()
			}

			// Find pods using this PVC with detailed information
			pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
			usingPods := []string{}
			podDetails := []map[string]interface{}{}
			for _, pod := range pods.Items {
				for _, vol := range pod.Spec.Volumes {
					if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvc.Name {
						usingPods = append(usingPods, pod.Name)

						// Calculate restart count
						restartCount := 0
						for _, cs := range pod.Status.ContainerStatuses {
							restartCount += int(cs.RestartCount)
						}

						// Determine pod status
						podStatus := string(pod.Status.Phase)
						if pod.DeletionTimestamp != nil {
							podStatus = "Terminating"
						}

						podDetails = append(podDetails, map[string]interface{}{
							"name":          pod.Name,
							"status":        podStatus,
							"node":          pod.Spec.NodeName,
							"restart_count": restartCount,
							"age_days":      int(time.Since(pod.CreationTimestamp.Time).Hours() / 24),
							"created_at":    pod.CreationTimestamp.Format(time.RFC3339),
						})
						break
					}
				}
			}

			pvcInfo := map[string]interface{}{
				"name":              pvc.Name,
				"namespace":         pvc.Namespace,
				"status":            string(pvc.Status.Phase),
				"volume_name":       pvc.Spec.VolumeName,
				"storage_class":     storageClass,
				"access_modes":      accessModes,
				"requested_storage": requestedStorage,
				"actual_storage":    actualStorage,
				"created_at":        pvc.CreationTimestamp.Format(time.RFC3339),
				"age_days":          int(time.Since(pvc.CreationTimestamp.Time).Hours() / 24),
				"using_pods":        usingPods,
				"pod_count":         len(usingPods),
				"pod_details":       podDetails,
				"pv_details":        nil,
			}

			// Add associated PV details if bound
			if pvc.Spec.VolumeName != "" {
				if pvInfo, ok := pvMap[pvc.Spec.VolumeName]; ok {
					pvcInfo["pv_details"] = pvInfo
				}
			}

			pvcData = append(pvcData, pvcInfo)
		}

		// Find unbound/available PVs that could be bound to this namespace
		// Only show: Available PVs, or Released PVs that were in this namespace
		unboundPVs := []map[string]interface{}{}
		for _, pv := range pvList.Items {
			// Only include truly available PVs or Released PVs from this namespace
			if pv.Status.Phase == "Available" {
				if pvInfo, ok := pvMap[pv.Name]; ok {
					unboundPVs = append(unboundPVs, pvInfo.(map[string]interface{}))
				}
			} else if pv.Status.Phase == "Released" && pv.Spec.ClaimRef != nil && pv.Spec.ClaimRef.Namespace == namespace {
				if pvInfo, ok := pvMap[pv.Name]; ok {
					unboundPVs = append(unboundPVs, pvInfo.(map[string]interface{}))
				}
			}
		}

		// Storage summary
		summary := map[string]interface{}{
			"total_pvcs":          len(pvcList.Items),
			"total_pvs":           len(pvList.Items),
			"unbound_pvs":         len(unboundPVs),
			"bound_pvcs":          0,
			"pending_pvcs":        0,
			"lost_pvcs":           0,
			"total_capacity":      "0Gi",
			"total_used_capacity": "0Gi",
		}

		for _, pvc := range pvcList.Items {
			switch pvc.Status.Phase {
			case "Bound":
				summary["bound_pvcs"] = summary["bound_pvcs"].(int) + 1
			case "Pending":
				summary["pending_pvcs"] = summary["pending_pvcs"].(int) + 1
			case "Lost":
				summary["lost_pvcs"] = summary["lost_pvcs"].(int) + 1
			}
		}

		response := map[string]interface{}{
			"summary":     summary,
			"pvcs":        pvcData,
			"unbound_pvs": unboundPVs,
		}

		// Get ResourceVersion
		currentVersion := ""
		if len(pvcList.Items) > 0 {
			currentVersion = pvcList.ResourceVersion
		}

		// Cache for 30 seconds with version
		application.Cache.SetWithVersion(cacheKey, response, currentVersion, 30*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

// Helper functions
// ...existing helper functions from k8s package...
