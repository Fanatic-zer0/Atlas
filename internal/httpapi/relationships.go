package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"atlas/internal/app"

	"encoding/json"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// getResourceRelationships returns a comprehensive relationship map for troubleshooting
func getResourceRelationships(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		vars := mux.Vars(r)
		namespace := vars["namespace"]
		ctx := r.Context()

		// Add caching for relationships endpoint
		cacheKey := fmt.Sprintf("relationships:%s", namespace)
		if cached, ok := application.Cache.Get(cacheKey); ok {
			json.NewEncoder(w).Encode(cached)
			return
		}

		relationships := map[string]interface{}{
			"deployments_to_pods":   buildDeploymentToPodMap(application, ctx, namespace),
			"services_to_pods":      buildServiceToPodMap(application, ctx, namespace),
			"ingresses_to_services": buildIngressToServiceMap(application, ctx, namespace),
			"pvcs_to_pods":          buildPVCToPodMap(application, ctx, namespace),
			"configmaps_to_pods":    buildConfigMapToPodMap(application, ctx, namespace),
			"secrets_to_pods":       buildSecretToPodMap(application, ctx, namespace),
			"pods_to_nodes":         buildPodToNodeMap(application, ctx, namespace),
			"orphaned_resources":    findOrphanedResources(application, ctx, namespace),
			"service_dependencies":  buildServiceDependencies(application, ctx, namespace),
		}

		// Cache for 30 seconds
		application.Cache.Set(cacheKey, relationships, 30*time.Second)

		json.NewEncoder(w).Encode(relationships)
	}
}

func buildDeploymentToPodMap(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	deployments, err := application.K8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	for _, dep := range deployments.Items {
		pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: metav1.FormatLabelSelector(dep.Spec.Selector),
		})

		podList := []map[string]interface{}{}
		for _, pod := range pods.Items {
			restartCount := 0
			for _, cs := range pod.Status.ContainerStatuses {
				restartCount += int(cs.RestartCount)
			}

			podList = append(podList, map[string]interface{}{
				"name":          pod.Name,
				"status":        string(pod.Status.Phase),
				"node":          pod.Spec.NodeName,
				"restart_count": restartCount,
				"pod_ip":        pod.Status.PodIP,
			})
		}

		results = append(results, map[string]interface{}{
			"deployment": dep.Name,
			"replicas":   fmt.Sprintf("%d/%d", dep.Status.ReadyReplicas, *dep.Spec.Replicas),
			"pods":       podList,
			"pod_count":  len(podList),
		})
	}

	return results
}

func buildServiceToPodMap(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	services, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	for _, svc := range services.Items {
		if svc.Spec.Type == "ExternalName" {
			continue
		}

		podList := []map[string]interface{}{}
		if svc.Spec.Selector != nil {
			selector := labels.Set(svc.Spec.Selector).AsSelector()
			pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
				LabelSelector: selector.String(),
			})

			for _, pod := range pods.Items {
				podList = append(podList, map[string]interface{}{
					"name":   pod.Name,
					"status": string(pod.Status.Phase),
					"pod_ip": pod.Status.PodIP,
				})
			}
		}

		// Get endpoints info using EndpointSlices
		endpointCount := 0
		labelSelector := fmt.Sprintf("kubernetes.io/service-name=%s", svc.Name)
		endpointSlices, _ := application.K8sClient.Clientset.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: labelSelector,
		})
		if endpointSlices != nil {
			for _, slice := range endpointSlices.Items {
				for _, endpoint := range slice.Endpoints {
					if endpoint.Conditions.Ready != nil && *endpoint.Conditions.Ready {
						endpointCount++
					}
				}
			}
		}

		results = append(results, map[string]interface{}{
			"service":        svc.Name,
			"type":           string(svc.Spec.Type),
			"cluster_ip":     svc.Spec.ClusterIP,
			"selector":       svc.Spec.Selector,
			"pods":           podList,
			"pod_count":      len(podList),
			"endpoint_count": endpointCount,
		})
	}

	return results
}

func buildIngressToServiceMap(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	ingresses, err := application.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	for _, ing := range ingresses.Items {
		serviceMap := make(map[string][]string)

		for _, rule := range ing.Spec.Rules {
			host := rule.Host
			if rule.HTTP != nil {
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service != nil {
						serviceName := path.Backend.Service.Name
						serviceMap[serviceName] = append(serviceMap[serviceName], fmt.Sprintf("%s%s", host, path.Path))
					}
				}
			}
		}

		services := []map[string]interface{}{}
		for svcName, paths := range serviceMap {
			svc, _ := application.K8sClient.Clientset.CoreV1().Services(namespace).Get(ctx, svcName, metav1.GetOptions{})
			svcInfo := map[string]interface{}{
				"name":  svcName,
				"paths": paths,
			}
			if svc != nil {
				svcInfo["cluster_ip"] = svc.Spec.ClusterIP
				svcInfo["type"] = string(svc.Spec.Type)
			}
			services = append(services, svcInfo)
		}

		results = append(results, map[string]interface{}{
			"ingress":  ing.Name,
			"services": services,
		})
	}

	return results
}

func buildPVCToPodMap(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	pvcs, err := application.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	for _, pvc := range pvcs.Items {
		pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

		podList := []map[string]interface{}{}
		for _, pod := range pods.Items {
			for _, vol := range pod.Spec.Volumes {
				if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvc.Name {
					podList = append(podList, map[string]interface{}{
						"name":        pod.Name,
						"status":      string(pod.Status.Phase),
						"node":        pod.Spec.NodeName,
						"volume_name": vol.Name,
					})
					break
				}
			}
		}

		storageSize := ""
		if storage, ok := pvc.Status.Capacity["storage"]; ok {
			storageSize = storage.String()
		}

		results = append(results, map[string]interface{}{
			"pvc":          pvc.Name,
			"status":       string(pvc.Status.Phase),
			"volume_name":  pvc.Spec.VolumeName,
			"storage_size": storageSize,
			"pods":         podList,
			"pod_count":    len(podList),
		})
	}

	return results
}

func buildConfigMapToPodMap(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	configMaps, err := application.K8sClient.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

	for _, cm := range configMaps.Items {
		podList := []map[string]interface{}{}

		for _, pod := range pods.Items {
			usageType := ""

			// Check volumes
			for _, vol := range pod.Spec.Volumes {
				if vol.ConfigMap != nil && vol.ConfigMap.Name == cm.Name {
					usageType = "volume"
					break
				}
			}

			// Check env from
			if usageType == "" {
				for _, container := range pod.Spec.Containers {
					for _, envFrom := range container.EnvFrom {
						if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name == cm.Name {
							usageType = "env"
							break
						}
					}
					if usageType != "" {
						break
					}
				}
			}

			if usageType != "" {
				podList = append(podList, map[string]interface{}{
					"name":       pod.Name,
					"status":     string(pod.Status.Phase),
					"usage_type": usageType,
				})
			}
		}

		if len(podList) > 0 {
			results = append(results, map[string]interface{}{
				"configmap": cm.Name,
				"pods":      podList,
				"pod_count": len(podList),
			})
		}
	}

	return results
}

func buildSecretToPodMap(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	secrets, err := application.K8sClient.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

	for _, secret := range secrets.Items {
		// Skip service account tokens
		if secret.Type == "kubernetes.io/service-account-token" {
			continue
		}

		podList := []map[string]interface{}{}

		for _, pod := range pods.Items {
			usageType := ""

			// Check volumes
			for _, vol := range pod.Spec.Volumes {
				if vol.Secret != nil && vol.Secret.SecretName == secret.Name {
					usageType = "volume"
					break
				}
			}

			// Check env from
			if usageType == "" {
				for _, container := range pod.Spec.Containers {
					for _, envFrom := range container.EnvFrom {
						if envFrom.SecretRef != nil && envFrom.SecretRef.Name == secret.Name {
							usageType = "env"
							break
						}
					}
					if usageType != "" {
						break
					}
				}
			}

			if usageType != "" {
				podList = append(podList, map[string]interface{}{
					"name":       pod.Name,
					"status":     string(pod.Status.Phase),
					"usage_type": usageType,
				})
			}
		}

		if len(podList) > 0 {
			results = append(results, map[string]interface{}{
				"secret":    secret.Name,
				"type":      string(secret.Type),
				"pods":      podList,
				"pod_count": len(podList),
			})
		}
	}

	return results
}

func buildPodToNodeMap(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	pods, err := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	nodeMap := make(map[string][]map[string]interface{})

	for _, pod := range pods.Items {
		nodeName := pod.Spec.NodeName
		if nodeName == "" {
			nodeName = "Unscheduled"
		}

		restartCount := 0
		for _, cs := range pod.Status.ContainerStatuses {
			restartCount += int(cs.RestartCount)
		}

		nodeMap[nodeName] = append(nodeMap[nodeName], map[string]interface{}{
			"name":          pod.Name,
			"status":        string(pod.Status.Phase),
			"restart_count": restartCount,
			"pod_ip":        pod.Status.PodIP,
		})
	}

	for nodeName, podList := range nodeMap {
		results = append(results, map[string]interface{}{
			"node":      nodeName,
			"pods":      podList,
			"pod_count": len(podList),
		})
	}

	return results
}

func findOrphanedResources(application *app.App, ctx context.Context, namespace string) map[string]interface{} {
	orphaned := map[string]interface{}{
		"pvcs":       []string{},
		"configmaps": []string{},
		"secrets":    []string{},
		"services":   []string{},
	}

	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

	// Find unused PVCs
	pvcs, _ := application.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	for _, pvc := range pvcs.Items {
		used := false
		for _, pod := range pods.Items {
			for _, vol := range pod.Spec.Volumes {
				if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvc.Name {
					used = true
					break
				}
			}
			if used {
				break
			}
		}
		if !used {
			if pvcList, ok := orphaned["pvcs"].([]string); ok {
				orphaned["pvcs"] = append(pvcList, pvc.Name)
			}
		}
	}

	// Find unused ConfigMaps
	configMaps, _ := application.K8sClient.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	for _, cm := range configMaps.Items {
		used := false
		for _, pod := range pods.Items {
			for _, vol := range pod.Spec.Volumes {
				if vol.ConfigMap != nil && vol.ConfigMap.Name == cm.Name {
					used = true
					break
				}
			}
			if !used {
				for _, container := range pod.Spec.Containers {
					for _, envFrom := range container.EnvFrom {
						if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name == cm.Name {
							used = true
							break
						}
					}
				}
			}
			if used {
				break
			}
		}
		if !used {
			if cmList, ok := orphaned["configmaps"].([]string); ok {
				orphaned["configmaps"] = append(cmList, cm.Name)
			}
		}
	}

	// Find services without endpoints
	services, _ := application.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	for _, svc := range services.Items {
		if svc.Spec.Type == "ExternalName" {
			continue
		}

		// Use EndpointSlices to check for endpoints
		labelSelector := fmt.Sprintf("kubernetes.io/service-name=%s", svc.Name)
		endpointSlices, _ := application.K8sClient.Clientset.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{
			LabelSelector: labelSelector,
		})
		hasEndpoints := false
		if endpointSlices != nil {
			for _, slice := range endpointSlices.Items {
				for _, endpoint := range slice.Endpoints {
					if endpoint.Conditions.Ready != nil && *endpoint.Conditions.Ready && len(endpoint.Addresses) > 0 {
						hasEndpoints = true
						break
					}
				}
				if hasEndpoints {
					break
				}
			}
		}

		if !hasEndpoints {
			if svcList, ok := orphaned["services"].([]string); ok {
				orphaned["services"] = append(svcList, svc.Name)
			}
		}
	}

	return orphaned
}

func buildServiceDependencies(application *app.App, ctx context.Context, namespace string) []map[string]interface{} {
	results := []map[string]interface{}{}

	// Get all services
	services, err := application.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return results
	}

	// Get all pods to check their dependencies
	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})

	for _, svc := range services.Items {
		dependencies := []string{}

		// Check which pods might be calling this service (based on env variables)
		for _, pod := range pods.Items {
			for _, container := range pod.Spec.Containers {
				for _, env := range container.Env {
					if env.Value != "" && (env.Value == svc.Name || env.Value == fmt.Sprintf("%s.%s", svc.Name, namespace)) {
						dependencies = append(dependencies, pod.Name)
						break
					}
				}
			}
		}

		if len(dependencies) > 0 {
			results = append(results, map[string]interface{}{
				"service":             svc.Name,
				"dependent_pods":      dependencies,
				"dependent_pod_count": len(dependencies),
			})
		}
	}

	return results
}
