package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"atlas/internal/app"
	"atlas/internal/k8s"

	"github.com/gorilla/mux"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// getClusterInfo moved to handlers_cluster.go

func getAllResources(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])

		// Get k8s client (supports both single and multi-cluster modes)
		k8sClient, err := getK8sClient(application, r)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get k8s client: %v", err), http.StatusInternalServerError)
			return
		}

		resourceType := r.URL.Query().Get("resource_type")
		lightweight := r.URL.Query().Get("lightweight") == "true"

		cacheKey := fmt.Sprintf("resources:%s:%s:%v", namespace, resourceType, lightweight)
		ctx := r.Context()

		// Check if we have cached version
		cachedVersion, hasCachedVersion := application.Cache.GetResourceVersion(cacheKey)

		// Quick ResourceVersion check to see if anything changed
		if hasCachedVersion && cachedVersion != "" {
			// Do a lightweight List with Limit=1 to just get the ResourceVersion
			quickCheck, _ := k8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{Limit: 1})
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
				pods, err := k8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
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
				deployments, err := k8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
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
				services, err := k8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
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
				ingresses, err := k8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
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
				pvs, err := k8sClient.Clientset.CoreV1().PersistentVolumes().List(ctx, metav1.ListOptions{})
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
				pvcs, err := k8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
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
				statefulSets, err := k8sClient.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
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
				daemonSets, err := k8sClient.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
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
				jobs, err := k8sClient.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
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
				cronJobs, err := k8sClient.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
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
		namespace := resolveNamespace(vars["namespace"])
		name := vars["name"]

		// Cache key for resource details (15 second TTL - details change less frequently than lists)
		cacheKey := fmt.Sprintf("resource-details:%s:%s:%s", resourceType, namespace, name)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

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
		case "ConfigMap":
			cm, err := application.K8sClient.Clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildConfigMapDetails(cm, application, ctx)
		case "Secret":
			secret, err := application.K8sClient.Clientset.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildSecretDetails(secret, application, ctx)
		case "PersistentVolumeClaim":
			pvc, err := application.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildPVCDetails(pvc, application, ctx)
		case "Endpoints":
			ep, err := application.K8sClient.Clientset.CoreV1().Endpoints(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildEndpointsDetails(ep, application, ctx)
		case "StorageClass":
			sc, err := application.K8sClient.Clientset.StorageV1().StorageClasses().Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildStorageClassDetails(sc, application, ctx)
		case "HorizontalPodAutoscaler":
			hpa, err := application.K8sClient.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildHPADetails(hpa, application, ctx)
		case "PodDisruptionBudget":
			pdb, err := application.K8sClient.Clientset.PolicyV1().PodDisruptionBudgets(namespace).Get(ctx, name, metav1.GetOptions{})
			if err != nil {
				http.Error(w, err.Error(), http.StatusNotFound)
				return
			}
			details = buildPDBDetails(pdb, application, ctx)
		default:
			http.Error(w, "Unsupported resource type", http.StatusBadRequest)
			return
		}

		// Cache the result (15 second TTL)
		application.Cache.Set(cacheKey, details, 15*time.Second)

		json.NewEncoder(w).Encode(details)
	}
}

func getIngresses(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])

		// Check cache first
		cacheKey := fmt.Sprintf("ingresses:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

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

		// Cache for 30 seconds
		application.Cache.Set(cacheKey, result, 30*time.Second)

		json.NewEncoder(w).Encode(result)
	}
}

func getServices(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])

		// Parse pagination parameters
		limitStr := r.URL.Query().Get("limit")
		continueToken := r.URL.Query().Get("continue")

		var limit int64 = 0 // 0 means no limit (fetch all)
		if limitStr != "" {
			if parsedLimit, err := strconv.ParseInt(limitStr, 10, 64); err == nil {
				limit = parsedLimit
			}
		}

		// Build cache key including pagination params
		cacheKey := fmt.Sprintf("services:%s:limit=%d:continue=%s", namespace, limit, continueToken)
		ctx := r.Context()

		// Only use cache for non-paginated requests
		if limit == 0 && continueToken == "" {
			cacheKey = fmt.Sprintf("services:%s", namespace)
			// Use helper function for ResourceVersion check
			if serveFromCacheIfUnchanged(w, ctx, application, cacheKey, "services", namespace) {
				return
			}

			// Fallback to regular cache check
			if cached, ok := application.Cache.Get(cacheKey); ok {
				json.NewEncoder(w).Encode(cached)
				return
			}
		}

		// Set up list options with pagination
		listOpts := metav1.ListOptions{
			Limit:    limit,
			Continue: continueToken,
		}

		// Fetch services with pagination
		servicesList, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(r.Context(), listOpts)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Batch fetch all EndpointSlices once to avoid N+1 queries
		allEndpointSlices, _ := application.K8sClient.Clientset.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{})
		endpointCountMap := make(map[string]int)
		if allEndpointSlices != nil {
			for _, slice := range allEndpointSlices.Items {
				serviceName := slice.Labels["kubernetes.io/service-name"]
				if serviceName == "" {
					continue
				}
				for _, endpoint := range slice.Endpoints {
					if endpoint.Conditions.Ready != nil && *endpoint.Conditions.Ready {
						endpointCountMap[serviceName]++
					}
				}
			}
		}

		// Convert to our format
		services := []map[string]interface{}{}
		for _, svc := range servicesList.Items {
			ports := []map[string]interface{}{}
			for _, port := range svc.Spec.Ports {
				ports = append(ports, map[string]interface{}{
					"name":        port.Name,
					"port":        port.Port,
					"target_port": port.TargetPort.String(),
					"protocol":    string(port.Protocol),
					"node_port":   port.NodePort,
				})
			}

			// Get endpoint count from pre-fetched map
			endpointCount := endpointCountMap[svc.Name]

			services = append(services, map[string]interface{}{
				"name":           svc.Name,
				"namespace":      svc.Namespace,
				"type":           string(svc.Spec.Type),
				"cluster_ip":     svc.Spec.ClusterIP,
				"ports":          ports,
				"selector":       svc.Spec.Selector,
				"endpoint_count": endpointCount,
			})
		}

		// Build response with pagination metadata
		response := map[string]interface{}{
			"items":            services,
			"count":            len(services),
			"continue":         servicesList.Continue,
			"has_more":         servicesList.Continue != "",
			"limit":            limit,
			"resource_version": servicesList.ResourceVersion,
		}

		// Get ResourceVersion for cache (only for non-paginated)
		if limit == 0 && continueToken == "" {
			application.Cache.SetWithVersion(cacheKey, response, servicesList.ResourceVersion, 30*time.Second)
		}

		json.NewEncoder(w).Encode(response)
	}
}

func getPods(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])

		// Get k8s client (supports both single and multi-cluster modes)
		k8sClient, err := getK8sClient(application, r)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get k8s client: %v", err), http.StatusInternalServerError)
			return
		}

		// Parse pagination parameters
		limitStr := r.URL.Query().Get("limit")
		continueToken := r.URL.Query().Get("continue")

		var limit int64 = 0 // 0 means no limit (fetch all)
		if limitStr != "" {
			if parsedLimit, err := strconv.ParseInt(limitStr, 10, 64); err == nil {
				limit = parsedLimit
			}
		}

		// Build cache key including pagination params
		cacheKey := fmt.Sprintf("pods:%s:limit=%d:continue=%s", namespace, limit, continueToken)

		// Only use cache for non-paginated requests to avoid complexity
		if limit == 0 && continueToken == "" {
			if cached, ok := application.Cache.Get(cacheKey); ok {
				json.NewEncoder(w).Encode(cached)
				return
			}
		}

		// Set up list options with pagination
		listOpts := metav1.ListOptions{
			Limit:    limit,
			Continue: continueToken,
		}

		pods, err := k8sClient.Clientset.CoreV1().Pods(namespace).List(r.Context(), listOpts)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, pod := range pods.Items {
			restarts := int32(0)
			readyCount := 0
			totalContainers := len(pod.Spec.Containers)

			for _, status := range pod.Status.ContainerStatuses {
				restarts += status.RestartCount
				if status.Ready {
					readyCount++
				}
			}

			// Calculate age
			age := time.Since(pod.CreationTimestamp.Time)
			ageStr := formatAge(age)

			// Build detailed status info
			statusDetails := getContainerStatusDetails(&pod)

			result = append(result, map[string]interface{}{
				"name":             pod.Name,
				"namespace":        pod.Namespace,
				"status":           string(pod.Status.Phase),
				"ready_containers": readyCount,
				"total_containers": totalContainers,
				"restart_count":    restarts,
				"age":              ageStr,
				"ip":               pod.Status.PodIP,
				"node":             pod.Spec.NodeName,
				"health_score":     calculatePodHealth(&pod),
				"status_emoji":     getPodStatusEmoji(&pod),
				"status_details":   statusDetails,
			})
		}

		// Build response with pagination metadata
		response := map[string]interface{}{
			"items":            result,
			"count":            len(result),
			"continue":         pods.Continue,
			"has_more":         pods.Continue != "",
			"limit":            limit,
			"resource_version": pods.ResourceVersion,
		}

		// Cache for 15 seconds (only non-paginated requests)
		if limit == 0 && continueToken == "" {
			application.Cache.Set(cacheKey, response, 15*time.Second)
		}

		json.NewEncoder(w).Encode(response)
	}
}

func getDeployments(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])

		// Parse pagination parameters
		limitStr := r.URL.Query().Get("limit")
		continueToken := r.URL.Query().Get("continue")

		var limit int64 = 0 // 0 means no limit (fetch all)
		if limitStr != "" {
			if parsedLimit, err := strconv.ParseInt(limitStr, 10, 64); err == nil {
				limit = parsedLimit
			}
		}

		// Build cache key including pagination params
		cacheKey := fmt.Sprintf("deployments:%s:limit=%d:continue=%s", namespace, limit, continueToken)

		// Only use cache for non-paginated requests to avoid complexity
		if limit == 0 && continueToken == "" {
			cacheKey = fmt.Sprintf("deployments:%s", namespace)
			if cached, ok := application.Cache.Get(cacheKey); ok {
				json.NewEncoder(w).Encode(cached)
				return
			}
		}

		// Set up list options with pagination
		listOpts := metav1.ListOptions{
			Limit:    limit,
			Continue: continueToken,
		}

		deployments, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).List(r.Context(), listOpts)
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
				"desired_replicas":   desired,
				"ready_replicas":     dep.Status.ReadyReplicas,
				"updated_replicas":   dep.Status.UpdatedReplicas,
				"available_replicas": dep.Status.AvailableReplicas,
				"images":             images,
				"resources":          resources,
				"pod_labels":         dep.Spec.Template.Labels,
				"health_score":       calculateDeploymentHealth(&dep),
				"status_emoji":       getDeploymentStatusEmoji(&dep),
			})
		}

		// Build response with pagination metadata
		response := map[string]interface{}{
			"items":            result,
			"count":            len(result),
			"continue":         deployments.Continue,
			"has_more":         deployments.Continue != "",
			"limit":            limit,
			"resource_version": deployments.ResourceVersion,
		}

		// Cache for 30 seconds (only non-paginated requests)
		if limit == 0 && continueToken == "" {
			application.Cache.Set(cacheKey, response, 30*time.Second)
		}

		json.NewEncoder(w).Encode(response)
	}
}

func getHealth(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		// Get k8s client (supports both single and multi-cluster modes)
		k8sClient, err := getK8sClient(application, r)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to get k8s client: %v", err), http.StatusInternalServerError)
			return
		}

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
		var statefulSetCount, statefulSetsReady int
		var daemonSetCount, daemonSetsReady int
		var jobCount, jobsSucceeded int
		var cronJobCount, cronJobsSuspended int
		var configMapCount, secretCount int
		var pvcCount, pvcsBound int

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

			nodes, err := k8sClient.Clientset.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				for _, node := range nodes.Items {
					status := "NotReady"
					isReady := false
					for _, cond := range node.Status.Conditions {
						if cond.Type == "Ready" && cond.Status == "True" {
							status = "Ready"
							isReady = true
						}
					}

					roles := []string{}
					for label := range node.Labels {
						if label == "node-role.kubernetes.io/control-plane" || label == "node-role.kubernetes.io/master" {
							roles = append(roles, "control-plane")
						} else if label == "node-role.kubernetes.io/worker" {
							roles = append(roles, "worker")
						}
					}

					nodeList = append(nodeList, map[string]interface{}{
						"name":            node.Name,
						"status":          status,
						"ready":           isReady,
						"cpu":             node.Status.Capacity.Cpu().String(),
						"memory":          node.Status.Capacity.Memory().String(),
						"os":              node.Status.NodeInfo.OSImage,
						"kernel_version":  node.Status.NodeInfo.KernelVersion,
						"kubelet_version": node.Status.NodeInfo.KubeletVersion,
						"roles":           roles,
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
			pods, err := k8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
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
			deployments, err := k8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
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

		// Fetch services with endpoints (batch fetch endpoints using EndpointSlices)
		wg.Add(1)
		go func() {
			defer wg.Done()
			services, err := k8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				// Batch fetch all EndpointSlices at once
				endpointSlicesList, _ := k8sClient.Clientset.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{})
				endpointsMap := make(map[string]bool)
				for _, slice := range endpointSlicesList.Items {
					serviceName := slice.Labels["kubernetes.io/service-name"]
					if serviceName == "" {
						continue
					}
					hasReady := false
					for _, endpoint := range slice.Endpoints {
						if endpoint.Conditions.Ready != nil && *endpoint.Conditions.Ready && len(endpoint.Addresses) > 0 {
							hasReady = true
							break
						}
					}
					if hasReady {
						endpointsMap[serviceName] = true
					}
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
			ingresses, err := k8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				ingressCount = len(ingresses.Items)
				mu.Unlock()
			}
		}()

		// Fetch statefulsets
		wg.Add(1)
		go func() {
			defer wg.Done()
			ssList, err := k8sClient.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				statefulSetCount = len(ssList.Items)
				for _, ss := range ssList.Items {
					desired := int32(1)
					if ss.Spec.Replicas != nil {
						desired = *ss.Spec.Replicas
					}
					if ss.Status.ReadyReplicas >= desired {
						statefulSetsReady++
					}
				}
				mu.Unlock()
			}
		}()

		// Fetch daemonsets
		wg.Add(1)
		go func() {
			defer wg.Done()
			dsList, err := k8sClient.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				daemonSetCount = len(dsList.Items)
				for _, ds := range dsList.Items {
					if ds.Status.NumberReady >= ds.Status.DesiredNumberScheduled {
						daemonSetsReady++
					}
				}
				mu.Unlock()
			}
		}()

		// Fetch jobs
		wg.Add(1)
		go func() {
			defer wg.Done()
			jobList, err := k8sClient.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				jobCount = len(jobList.Items)
				for _, job := range jobList.Items {
					if job.Status.Succeeded > 0 {
						jobsSucceeded++
					}
				}
				mu.Unlock()
			}
		}()

		// Fetch cronjobs
		wg.Add(1)
		go func() {
			defer wg.Done()
			cjList, err := k8sClient.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				cronJobCount = len(cjList.Items)
				for _, cj := range cjList.Items {
					if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
						cronJobsSuspended++
					}
				}
				mu.Unlock()
			}
		}()

		// Fetch configmaps
		wg.Add(1)
		go func() {
			defer wg.Done()
			cmList, err := k8sClient.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				configMapCount = len(cmList.Items)
				mu.Unlock()
			}
		}()

		// Fetch secrets
		wg.Add(1)
		go func() {
			defer wg.Done()
			secList, err := k8sClient.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				secretCount = len(secList.Items)
				mu.Unlock()
			}
		}()

		// Fetch PVCs
		wg.Add(1)
		go func() {
			defer wg.Done()
			pvcList, err := k8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
			if err == nil {
				mu.Lock()
				pvcCount = len(pvcList.Items)
				for _, pvc := range pvcList.Items {
					if pvc.Status.Phase == "Bound" {
						pvcsBound++
					}
				}
				mu.Unlock()
			}
		}()

		// Fetch recent events
		wg.Add(1)
		go func() {
			defer wg.Done()
			events, err := k8sClient.Clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
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

		// Calculate pod statuses for display
		podRunning := 0
		podPending := 0
		podFailed := 0
		for i := 0; i < healthyPods; i++ {
			podRunning++
		}
		for i := 0; i < degradedPods; i++ {
			podPending++
		}
		for i := 0; i < criticalPods; i++ {
			podFailed++
		}

		response := map[string]interface{}{
			// Flat structure for frontend compatibility
			"pod_count":        podCount,
			"deployment_count": depCount,
			"service_count":    svcCount,
			"ingress_count":    ingressCount,
			"pod_running":      podRunning,
			"pod_pending":      podPending,
			"pod_failed":       podFailed,

			// Nested structures for detailed info
			"summary": map[string]interface{}{
				"nodes":              len(nodeList),
				"ingresses":          ingressCount,
				"services":           svcCount,
				"deployments":        depCount,
				"pods":               podCount,
				"statefulsets":       statefulSetCount,
				"statefulsets_ready": statefulSetsReady,
				"daemonsets":         daemonSetCount,
				"daemonsets_ready":   daemonSetsReady,
				"jobs":               jobCount,
				"jobs_succeeded":     jobsSucceeded,
				"cronjobs":           cronJobCount,
				"cronjobs_suspended": cronJobsSuspended,
				"configmaps":         configMapCount,
				"secrets":            secretCount,
				"pvcs":               pvcCount,
				"pvcs_bound":         pvcsBound,
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
		namespace := resolveNamespace(vars["namespace"])

		// Check cache first (30 second TTL for releases)
		cacheKey := fmt.Sprintf("releases:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		// Fetch from K8s API
		releases, err := k8s.GetReleases(r.Context(), application.K8sClient.Clientset, namespace)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Cache the result
		application.Cache.Set(cacheKey, releases, 30*time.Second)

		json.NewEncoder(w).Encode(releases)
	}
}

func getDeploymentHistory(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		deploymentName := vars["deployment"]

		// Cache key for deployment history
		cacheKey := fmt.Sprintf("deployment-history:%s:%s", namespace, deploymentName)

		// Check cache first (30 second TTL - revisions don't change often)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		// Fetch from K8s API
		history, err := k8s.GetDeploymentHistory(r.Context(), application.K8sClient.Clientset, namespace, deploymentName)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Cache the result
		application.Cache.Set(cacheKey, history, 30*time.Second)

		json.NewEncoder(w).Encode(history)
	}
}

// testNetwork moved to handlers_network.go
// clearCache moved to handlers_cache.go
// getCacheStats moved to handlers_cache.go

func getConfigMaps(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])

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

			// Calculate age
			age := time.Since(cm.CreationTimestamp.Time)
			ageStr := formatAge(age)

			// For security, we don't include the actual data values
			// Only send metadata and key names
			result = append(result, map[string]interface{}{
				"name":      cm.Name,
				"namespace": cm.Namespace,
				"keys":      keys,
				"key_count": len(keys),
				"age":       ageStr,
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
		namespace := resolveNamespace(vars["namespace"])

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

			// Calculate age
			age := time.Since(secret.CreationTimestamp.Time)
			ageStr := formatAge(age)

			result = append(result, map[string]interface{}{
				"name":      secret.Name,
				"namespace": secret.Namespace,
				"type":      string(secret.Type),
				"keys":      keys,
				"key_count": len(keys),
				"age":       ageStr,
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
		namespace := resolveNamespace(vars["namespace"])
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

func getCRDs(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		// Check cache first
		cacheKey := "crds:cluster"
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		// Get CRDs using apiextensions client
		apiextensionsClient, err := apiextensionsclientset.NewForConfig(application.K8sClient.Config)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to create apiextensions client: %v", err), http.StatusInternalServerError)
			return
		}

		crds, err := apiextensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, crd := range crds.Items {
			// Build version details
			versionDetails := []map[string]interface{}{}
			versions := []string{}
			storageVersion := ""
			for _, v := range crd.Spec.Versions {
				versions = append(versions, v.Name)
				versionInfo := map[string]interface{}{
					"name":       v.Name,
					"served":     v.Served,
					"storage":    v.Storage,
					"deprecated": v.Deprecated,
				}
				if v.DeprecationWarning != nil {
					versionInfo["deprecation_warning"] = *v.DeprecationWarning
				}
				if v.Storage {
					storageVersion = v.Name
				}
				versionDetails = append(versionDetails, versionInfo)
			}

			// Calculate age
			age := ""
			createdAt := crd.CreationTimestamp.Time
			duration := time.Since(createdAt)
			days := int(duration.Hours() / 24)
			if days > 0 {
				age = fmt.Sprintf("%dd", days)
			} else {
				hours := int(duration.Hours())
				if hours > 0 {
					age = fmt.Sprintf("%dh", hours)
				} else {
					age = fmt.Sprintf("%dm", int(duration.Minutes()))
				}
			}

			// Extract conditions
			conditions := []map[string]interface{}{}
			for _, cond := range crd.Status.Conditions {
				conditions = append(conditions, map[string]interface{}{
					"type":    string(cond.Type),
					"status":  string(cond.Status),
					"reason":  cond.Reason,
					"message": cond.Message,
				})
			}

			// Conversion strategy
			conversionStrategy := "None"
			if crd.Spec.Conversion != nil {
				conversionStrategy = string(crd.Spec.Conversion.Strategy)
			}

			// Extract subresources info
			hasStatus := false
			hasScale := false
			for _, v := range crd.Spec.Versions {
				if v.Subresources != nil {
					if v.Subresources.Status != nil {
						hasStatus = true
					}
					if v.Subresources.Scale != nil {
						hasScale = true
					}
				}
			}

			subresources := []string{}
			if hasStatus {
				subresources = append(subresources, "status")
			}
			if hasScale {
				subresources = append(subresources, "scale")
			}

			// Additional printer columns
			additionalColumns := []string{}
			for _, v := range crd.Spec.Versions {
				if v.AdditionalPrinterColumns != nil {
					for _, col := range v.AdditionalPrinterColumns {
						additionalColumns = append(additionalColumns, col.Name)
					}
					break // Just get from first version
				}
			}

			result = append(result, map[string]interface{}{
				"name":                crd.Name,
				"group":               crd.Spec.Group,
				"kind":                crd.Spec.Names.Kind,
				"plural":              crd.Spec.Names.Plural,
				"singular":            crd.Spec.Names.Singular,
				"list_kind":           crd.Spec.Names.ListKind,
				"versions":            versions,
				"version_details":     versionDetails,
				"storage_version":     storageVersion,
				"scope":               string(crd.Spec.Scope),
				"categories":          crd.Spec.Names.Categories,
				"short_names":         crd.Spec.Names.ShortNames,
				"conditions":          conditions,
				"conversion_strategy": conversionStrategy,
				"subresources":        subresources,
				"additional_columns":  additionalColumns,
				"age":                 age,
			})
		}

		// Cache for 5 minutes (CRDs don't change often)
		application.Cache.Set(cacheKey, result, 5*time.Minute)

		json.NewEncoder(w).Encode(result)
	}
}

// getCronJobsAndJobs returns cronjobs with nested jobs
func getCronJobsAndJobs(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		// Fetch CronJobs
		cronJobs := []map[string]interface{}{}
		cjList, err := application.K8sClient.Clientset.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, cj := range cjList.Items {
				suspend := false
				if cj.Spec.Suspend != nil {
					suspend = *cj.Spec.Suspend
				}
				var lastScheduleTime *time.Time
				if cj.Status.LastScheduleTime != nil {
					lastScheduleTime = &cj.Status.LastScheduleTime.Time
				}
				age := formatAge(time.Since(cj.CreationTimestamp.Time))

				// Calculate next run time based on schedule
				nextRunIn := calculateNextRunIn(cj.Spec.Schedule, lastScheduleTime)

				cronJobs = append(cronJobs, map[string]interface{}{
					"name":               cj.Name,
					"namespace":          cj.Namespace,
					"schedule":           cj.Spec.Schedule,
					"suspend":            suspend,
					"last_schedule_time": lastScheduleTime,
					"next_run_in":        nextRunIn,
					"age":                age,
					"active_count":       len(cj.Status.Active),
					"concurrency_policy": string(cj.Spec.ConcurrencyPolicy),
					"jobs":               []map[string]interface{}{},
				})
			}
		}

		// Fetch Jobs and group under their owner CronJob
		jobList, err := application.K8sClient.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
		if err == nil {
			// Build cronjob map for quick lookup
			cjMap := map[string]map[string]interface{}{}
			for i := range cronJobs {
				cjName := cronJobs[i]["name"].(string)
				cjMap[cjName] = cronJobs[i]
			}

			for _, job := range jobList.Items {
				// Find owner CronJob
				var ownerCronJob string
				for _, ref := range job.OwnerReferences {
					if ref.Kind == "CronJob" {
						ownerCronJob = ref.Name
						break
					}
				}

				// Skip jobs that don't belong to a CronJob
				if ownerCronJob == "" {
					continue
				}

				// Skip if parent CronJob not found
				cj, found := cjMap[ownerCronJob]
				if !found {
					continue
				}

				status := "Pending"
				if job.Status.Succeeded > 0 {
					status = "Completed"
				} else if job.Status.Failed > 0 {
					status = "Failed"
				} else if job.Status.Active > 0 {
					status = "Active"
				}
				completions := int32(1)
				if job.Spec.Completions != nil {
					completions = *job.Spec.Completions
				}
				var duration string
				if job.Status.StartTime != nil {
					endTime := time.Now()
					if job.Status.CompletionTime != nil {
						endTime = job.Status.CompletionTime.Time
					}
					duration = formatAge(endTime.Sub(job.Status.StartTime.Time))
				}
				age := formatAge(time.Since(job.CreationTimestamp.Time))

				jobData := map[string]interface{}{
					"name":        job.Name,
					"namespace":   job.Namespace,
					"status":      status,
					"completions": completions,
					"succeeded":   job.Status.Succeeded,
					"failed":      job.Status.Failed,
					"active":      job.Status.Active,
					"duration":    duration,
					"age":         age,
				}

				cj["jobs"] = append(cj["jobs"].([]map[string]interface{}), jobData)
			}
		}

		json.NewEncoder(w).Encode(cronJobs)
	}
}

// Helper functions
// ...existing helper functions from k8s package...
