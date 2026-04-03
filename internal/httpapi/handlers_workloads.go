package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"atlas/internal/app"

	"github.com/gorilla/mux"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// getStatefulSets returns all StatefulSets in the specified namespace
func getStatefulSets(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		// Check cache first
		cacheKey := fmt.Sprintf("statefulsets:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		statefulSets, err := application.K8sClient.Clientset.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, sts := range statefulSets.Items {
			desired := int32(0)
			if sts.Spec.Replicas != nil {
				desired = *sts.Spec.Replicas
			}

			age := formatAge(time.Since(sts.CreationTimestamp.Time))

			result = append(result, map[string]interface{}{
				"name":               sts.Name,
				"namespace":          sts.Namespace,
				"desired_replicas":   desired,
				"ready_replicas":     sts.Status.ReadyReplicas,
				"current_replicas":   sts.Status.CurrentReplicas,
				"updated_replicas":   sts.Status.UpdatedReplicas,
				"available_replicas": sts.Status.AvailableReplicas,
				"status":             getStatefulSetStatus(&sts),
				"age":                age,
				"created":            sts.CreationTimestamp.Format(time.RFC3339),
			})
		}

		// Cache for 30 seconds
		response := map[string]interface{}{"statefulsets": result}
		application.Cache.Set(cacheKey, response, 30*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

// getDaemonSets returns all DaemonSets in the specified namespace
func getDaemonSets(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		// Check cache first
		cacheKey := fmt.Sprintf("daemonsets:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		daemonSets, err := application.K8sClient.Clientset.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, ds := range daemonSets.Items {
			age := formatAge(time.Since(ds.CreationTimestamp.Time))

			result = append(result, map[string]interface{}{
				"name":                     ds.Name,
				"namespace":                ds.Namespace,
				"desired_number_scheduled": ds.Status.DesiredNumberScheduled,
				"current_number_scheduled": ds.Status.CurrentNumberScheduled,
				"number_ready":             ds.Status.NumberReady,
				"updated_number_scheduled": ds.Status.UpdatedNumberScheduled,
				"number_available":         ds.Status.NumberAvailable,
				"number_misscheduled":      ds.Status.NumberMisscheduled,
				"status":                   getDaemonSetStatus(&ds),
				"age":                      age,
				"created":                  ds.CreationTimestamp.Format(time.RFC3339),
			})
		}

		// Cache for 30 seconds
		response := map[string]interface{}{"daemonsets": result}
		application.Cache.Set(cacheKey, response, 30*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

// getJobs returns all Jobs in the specified namespace
func getJobs(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		// Check cache first
		cacheKey := fmt.Sprintf("jobs:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		jobs, err := application.K8sClient.Clientset.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, job := range jobs.Items {
			status := "Running"
			if job.Status.Succeeded > 0 {
				status = "Completed"
			} else if job.Status.Failed > 0 {
				status = "Failed"
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

			// Find owner CronJob if any
			ownerCronJob := ""
			for _, ref := range job.OwnerReferences {
				if ref.Kind == "CronJob" {
					ownerCronJob = ref.Name
					break
				}
			}

			result = append(result, map[string]interface{}{
				"name":          job.Name,
				"namespace":     job.Namespace,
				"status":        status,
				"completions":   completions,
				"succeeded":     job.Status.Succeeded,
				"failed":        job.Status.Failed,
				"active":        job.Status.Active,
				"duration":      duration,
				"age":           age,
				"owner_cronjob": ownerCronJob,
				"created":       job.CreationTimestamp.Format(time.RFC3339),
			})
		}

		// Cache for 60 seconds
		response := map[string]interface{}{"jobs": result}
		application.Cache.Set(cacheKey, response, 60*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

// getEndpoints returns all Endpoints in the specified namespace
func getEndpoints(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		// Check cache first
		cacheKey := fmt.Sprintf("endpoints:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		// Use EndpointSlices (modern API) instead of deprecated Endpoints
		endpointSlices, err := application.K8sClient.Clientset.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Group EndpointSlices by service name
		serviceEndpoints := make(map[string]struct {
			total     int
			ready     int
			addresses []string
			created   time.Time
		})

		for _, slice := range endpointSlices.Items {
			serviceName := slice.Labels["kubernetes.io/service-name"]
			if serviceName == "" {
				continue
			}

			entry := serviceEndpoints[serviceName]
			if entry.created.IsZero() {
				entry.created = slice.CreationTimestamp.Time
			}

			for _, endpoint := range slice.Endpoints {
				entry.total++
				if endpoint.Conditions.Ready != nil && *endpoint.Conditions.Ready {
					entry.ready++
					for _, addr := range endpoint.Addresses {
						if endpoint.TargetRef != nil {
							entry.addresses = append(entry.addresses, fmt.Sprintf("%s (%s)", addr, endpoint.TargetRef.Name))
						} else {
							entry.addresses = append(entry.addresses, addr)
						}
					}
				}
			}
			serviceEndpoints[serviceName] = entry
		}

		result := []map[string]interface{}{}
		for serviceName, ep := range serviceEndpoints {
			age := formatAge(time.Since(ep.created))

			result = append(result, map[string]interface{}{
				"name":            serviceName,
				"namespace":       namespace,
				"total_endpoints": ep.total,
				"ready_endpoints": ep.ready,
				"addresses":       ep.addresses,
				"age":             age,
				"created":         ep.created.Format(time.RFC3339),
			})
		}

		// Cache for 20 seconds
		response := map[string]interface{}{"endpoints": result}
		application.Cache.Set(cacheKey, response, 20*time.Second)

		json.NewEncoder(w).Encode(response)
	}
}

// getStorageClasses returns all StorageClasses (cluster-scoped)
func getStorageClasses(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		ctx := r.Context()

		storageClasses, err := application.K8sClient.Clientset.StorageV1().StorageClasses().List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, sc := range storageClasses.Items {
			age := formatAge(time.Since(sc.CreationTimestamp.Time))

			isDefault := false
			if sc.Annotations != nil {
				if val, ok := sc.Annotations["storageclass.kubernetes.io/is-default-class"]; ok && val == "true" {
					isDefault = true
				} else if val, ok := sc.Annotations["storageclass.beta.kubernetes.io/is-default-class"]; ok && val == "true" {
					isDefault = true
				}
			}

			volumeBindingMode := ""
			if sc.VolumeBindingMode != nil {
				volumeBindingMode = string(*sc.VolumeBindingMode)
			}

			reclaimPolicy := ""
			if sc.ReclaimPolicy != nil {
				reclaimPolicy = string(*sc.ReclaimPolicy)
			}

			allowVolumeExpansion := false
			if sc.AllowVolumeExpansion != nil {
				allowVolumeExpansion = *sc.AllowVolumeExpansion
			}

			result = append(result, map[string]interface{}{
				"name":                   sc.Name,
				"provisioner":            sc.Provisioner,
				"reclaim_policy":         reclaimPolicy,
				"volume_binding_mode":    volumeBindingMode,
				"allow_volume_expansion": allowVolumeExpansion,
				"is_default":             isDefault,
				"parameters":             sc.Parameters,
				"age":                    age,
				"created":                sc.CreationTimestamp.Format(time.RFC3339),
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"storageclasses": result})
	}
}

// getHPAs returns all HorizontalPodAutoscalers in the specified namespace
func getHPAs(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		hpas, err := application.K8sClient.Clientset.AutoscalingV2().HorizontalPodAutoscalers(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, hpa := range hpas.Items {
			age := formatAge(time.Since(hpa.CreationTimestamp.Time))

			// Extract metrics
			metrics := []map[string]interface{}{}
			for _, metric := range hpa.Spec.Metrics {
				metricInfo := map[string]interface{}{
					"type": string(metric.Type),
				}

				switch metric.Type {
				case autoscalingv2.ResourceMetricSourceType:
					if metric.Resource != nil {
						metricInfo["resource_name"] = string(metric.Resource.Name)
						if metric.Resource.Target.AverageUtilization != nil {
							metricInfo["target"] = fmt.Sprintf("%d%%", *metric.Resource.Target.AverageUtilization)
						}
					}
				case autoscalingv2.PodsMetricSourceType:
					if metric.Pods != nil {
						metricInfo["metric_name"] = metric.Pods.Metric.Name
					}
				case autoscalingv2.ObjectMetricSourceType:
					if metric.Object != nil {
						metricInfo["metric_name"] = metric.Object.Metric.Name
						metricInfo["target_kind"] = metric.Object.DescribedObject.Kind
						metricInfo["target_name"] = metric.Object.DescribedObject.Name
					}
				}

				metrics = append(metrics, metricInfo)
			}

			// Extract current metrics
			currentMetrics := []map[string]interface{}{}
			for _, metric := range hpa.Status.CurrentMetrics {
				metricInfo := map[string]interface{}{
					"type": string(metric.Type),
				}

				switch metric.Type {
				case autoscalingv2.ResourceMetricSourceType:
					if metric.Resource != nil {
						metricInfo["resource_name"] = string(metric.Resource.Name)
						if metric.Resource.Current.AverageUtilization != nil {
							metricInfo["current"] = fmt.Sprintf("%d%%", *metric.Resource.Current.AverageUtilization)
						}
					}
				}

				currentMetrics = append(currentMetrics, metricInfo)
			}

			result = append(result, map[string]interface{}{
				"name":             hpa.Name,
				"namespace":        hpa.Namespace,
				"target_ref_kind":  hpa.Spec.ScaleTargetRef.Kind,
				"target_ref_name":  hpa.Spec.ScaleTargetRef.Name,
				"min_replicas":     *hpa.Spec.MinReplicas,
				"max_replicas":     hpa.Spec.MaxReplicas,
				"current_replicas": hpa.Status.CurrentReplicas,
				"desired_replicas": hpa.Status.DesiredReplicas,
				"metrics":          metrics,
				"current_metrics":  currentMetrics,
				"age":              age,
				"created":          hpa.CreationTimestamp.Format(time.RFC3339),
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"hpas": result})
	}
}

// getPDBs returns all PodDisruptionBudgets in the specified namespace
func getPDBs(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := resolveNamespace(vars["namespace"])
		ctx := r.Context()

		pdbs, err := application.K8sClient.Clientset.PolicyV1().PodDisruptionBudgets(namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		result := []map[string]interface{}{}
		for _, pdb := range pdbs.Items {
			age := formatAge(time.Since(pdb.CreationTimestamp.Time))

			minAvailable := ""
			if pdb.Spec.MinAvailable != nil {
				minAvailable = pdb.Spec.MinAvailable.String()
			}

			maxUnavailable := ""
			if pdb.Spec.MaxUnavailable != nil {
				maxUnavailable = pdb.Spec.MaxUnavailable.String()
			}

			result = append(result, map[string]interface{}{
				"name":                pdb.Name,
				"namespace":           pdb.Namespace,
				"min_available":       minAvailable,
				"max_unavailable":     maxUnavailable,
				"current_healthy":     pdb.Status.CurrentHealthy,
				"desired_healthy":     pdb.Status.DesiredHealthy,
				"expected_pods":       pdb.Status.ExpectedPods,
				"disruptions_allowed": pdb.Status.DisruptionsAllowed,
				"age":                 age,
				"created":             pdb.CreationTimestamp.Format(time.RFC3339),
			})
		}

		json.NewEncoder(w).Encode(map[string]interface{}{"pdbs": result})
	}
}
