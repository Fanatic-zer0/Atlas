package httpapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	"atlas/internal/app"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// resolveNamespace converts the frontend sentinel "_all" to an empty string,
// which the Kubernetes client interprets as all-namespaces.
func resolveNamespace(ns string) string {
	if ns == "_all" {
		return ""
	}
	return ns
}

func formatAge(d time.Duration) string {
	days := int(d.Hours() / 24)
	hours := int(d.Hours()) % 24
	minutes := int(d.Minutes()) % 60

	if days > 0 {
		return fmt.Sprintf("%dd", days)
	}
	if hours > 0 {
		return fmt.Sprintf("%dh", hours)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm", minutes)
	}
	return fmt.Sprintf("%ds", int(d.Seconds()))
}

// calculateNextRunIn estimates time until next cron execution based on schedule
func calculateNextRunIn(schedule string, lastScheduleTime *time.Time) string {
	// Parse common cron patterns and estimate next run
	// Format: minute hour day month weekday
	// For simplicity, we estimate based on common patterns

	if schedule == "" {
		return "-"
	}

	// Parse schedule to estimate interval
	var interval time.Duration
	var fixedMinute, fixedHour int = -1, -1

	// Parse the schedule parts
	parts := strings.Fields(schedule)
	if len(parts) >= 2 {
		// Parse minute field
		minPart := parts[0]
		hourPart := parts[1]

		// Check for */N patterns
		if strings.HasPrefix(minPart, "*/") {
			var n int
			if _, err := fmt.Sscanf(minPart, "*/%d", &n); err == nil && n > 0 {
				interval = time.Duration(n) * time.Minute
			}
		} else if minPart == "*" {
			interval = time.Minute
		} else if n, err := fmt.Sscanf(minPart, "%d", &fixedMinute); err == nil && n == 1 {
			// Fixed minute, check hour
			if strings.HasPrefix(hourPart, "*/") {
				var h int
				if _, err := fmt.Sscanf(hourPart, "*/%d", &h); err == nil && h > 0 {
					interval = time.Duration(h) * time.Hour
				}
			} else if hourPart == "*" {
				interval = time.Hour
			} else if n, err := fmt.Sscanf(hourPart, "%d", &fixedHour); err == nil && n == 1 {
				// Fixed hour and minute - daily schedule
				interval = 24 * time.Hour
			}
		}
	}

	// If we couldn't parse, return a simple estimate based on last schedule
	if interval == 0 {
		if lastScheduleTime != nil {
			// Estimate based on time since last schedule (assume daily if unknown)
			interval = 24 * time.Hour
		} else {
			return "-"
		}
	}

	// Calculate time until next run
	var nextRun time.Time
	if lastScheduleTime != nil {
		nextRun = lastScheduleTime.Add(interval)
	} else {
		// If never scheduled, estimate from now
		nextRun = time.Now().Add(interval)
	}

	timeUntil := time.Until(nextRun)
	if timeUntil < 0 {
		// Already past, next interval
		timeUntil = interval + timeUntil
		if timeUntil < 0 {
			timeUntil = interval
		}
	}

	// Format the duration appropriately
	if timeUntil < time.Minute {
		return fmt.Sprintf("%ds", int(timeUntil.Seconds()))
	}
	if timeUntil < time.Hour {
		return fmt.Sprintf("%dm", int(timeUntil.Minutes()))
	}
	if timeUntil < 24*time.Hour {
		hours := int(timeUntil.Hours())
		mins := int(timeUntil.Minutes()) % 60
		if mins > 0 {
			return fmt.Sprintf("%dh %dm", hours, mins)
		}
		return fmt.Sprintf("%dh", hours)
	}
	days := int(timeUntil.Hours() / 24)
	hours := int(timeUntil.Hours()) % 24
	if hours > 0 {
		return fmt.Sprintf("%dd %dh", days, hours)
	}
	return fmt.Sprintf("%dd", days)
}

func calculatePodHealth(pod *corev1.Pod) int {
	if pod.Status.Phase == "Running" {
		ready := 0
		total := len(pod.Status.ContainerStatuses)
		for _, status := range pod.Status.ContainerStatuses {
			if status.Ready {
				ready++
			}
		}
		if total > 0 {
			return (ready * 100) / total
		}
	}
	if pod.Status.Phase == "Succeeded" {
		return 100
	}
	return 0
}

func calculateDeploymentHealth(dep *appsv1.Deployment) int {
	if dep.Spec.Replicas == nil || *dep.Spec.Replicas == 0 {
		return 100
	}
	return int((dep.Status.ReadyReplicas * 100) / *dep.Spec.Replicas)
}

func getPodStatusEmoji(pod *corev1.Pod) string {
	health := calculatePodHealth(pod)
	if health >= 80 {
		return "✓"
	}
	if health >= 60 {
		return "⚠"
	}
	return "✗"
}

// getContainerStatusDetails returns detailed status info for pod containers
func getContainerStatusDetails(pod *corev1.Pod) string {
	var details []string

	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil {
			details = append(details, fmt.Sprintf("%s: Waiting - %s", cs.Name, cs.State.Waiting.Reason))
		} else if cs.State.Terminated != nil {
			t := cs.State.Terminated
			if t.ExitCode != 0 {
				details = append(details, fmt.Sprintf("%s: Terminated - %s (exit code: %d)", cs.Name, t.Reason, t.ExitCode))
			} else {
				details = append(details, fmt.Sprintf("%s: Completed", cs.Name))
			}
		} else if cs.State.Running != nil {
			if !cs.Ready {
				details = append(details, fmt.Sprintf("%s: Running (not ready)", cs.Name))
			}
		}

		// Check last termination state
		if cs.LastTerminationState.Terminated != nil {
			lt := cs.LastTerminationState.Terminated
			if lt.ExitCode != 0 {
				details = append(details, fmt.Sprintf("%s: Last exit - %s (code: %d)", cs.Name, lt.Reason, lt.ExitCode))
			}
		}
	}

	// Check init containers
	for _, cs := range pod.Status.InitContainerStatuses {
		if cs.State.Waiting != nil {
			details = append(details, fmt.Sprintf("Init %s: Waiting - %s", cs.Name, cs.State.Waiting.Reason))
		} else if cs.State.Terminated != nil && cs.State.Terminated.ExitCode != 0 {
			details = append(details, fmt.Sprintf("Init %s: Failed (exit code: %d)", cs.Name, cs.State.Terminated.ExitCode))
		}
	}

	if len(details) == 0 {
		return "OK"
	}
	return strings.Join(details, "; ")
}

func getDeploymentStatusEmoji(dep *appsv1.Deployment) string {
	health := calculateDeploymentHealth(dep)
	if health >= 80 {
		return "✓"
	}
	if health >= 60 {
		return "⚠"
	}
	return "✗"
}

func getDeploymentStatus(dep *appsv1.Deployment) string {
	if dep.Spec.Replicas != nil && dep.Status.ReadyReplicas == *dep.Spec.Replicas {
		return "Ready"
	}
	return "Degraded"
}

func buildPodDetails(pod *corev1.Pod, application *app.App, ctx context.Context) map[string]interface{} {
	// Build init containers information
	initContainers := []map[string]interface{}{}
	for _, c := range pod.Spec.InitContainers {
		initContainer := map[string]interface{}{
			"name":    c.Name,
			"image":   c.Image,
			"command": c.Command,
			"args":    c.Args,
		}

		// Add ports
		if len(c.Ports) > 0 {
			ports := []map[string]interface{}{}
			for _, p := range c.Ports {
				ports = append(ports, map[string]interface{}{
					"name":           p.Name,
					"container_port": p.ContainerPort,
					"protocol":       string(p.Protocol),
				})
			}
			initContainer["ports"] = ports
		}

		// Add resource requirements
		if c.Resources.Requests != nil || c.Resources.Limits != nil {
			resources := map[string]interface{}{}
			if c.Resources.Requests != nil {
				requests := map[string]string{}
				if cpu, ok := c.Resources.Requests["cpu"]; ok {
					requests["cpu"] = cpu.String()
				}
				if mem, ok := c.Resources.Requests["memory"]; ok {
					requests["memory"] = mem.String()
				}
				resources["requests"] = requests
			}
			if c.Resources.Limits != nil {
				limits := map[string]string{}
				if cpu, ok := c.Resources.Limits["cpu"]; ok {
					limits["cpu"] = cpu.String()
				}
				if mem, ok := c.Resources.Limits["memory"]; ok {
					limits["memory"] = mem.String()
				}
				resources["limits"] = limits
			}
			initContainer["resources"] = resources
		}
		initContainers = append(initContainers, initContainer)
	}

	// Build init container statuses
	initContainerStatuses := []map[string]interface{}{}
	for _, cs := range pod.Status.InitContainerStatuses {
		status := map[string]interface{}{
			"name":          cs.Name,
			"ready":         cs.Ready,
			"restart_count": cs.RestartCount,
		}
		if cs.State.Running != nil {
			status["state"] = "Running"
		} else if cs.State.Waiting != nil {
			status["state"] = "Waiting"
			status["reason"] = cs.State.Waiting.Reason
			status["message"] = cs.State.Waiting.Message
		} else if cs.State.Terminated != nil {
			if cs.State.Terminated.ExitCode == 0 {
				status["state"] = "Completed"
			} else {
				status["state"] = "Failed"
			}
			status["exit_code"] = cs.State.Terminated.ExitCode
			status["reason"] = cs.State.Terminated.Reason
			status["message"] = cs.State.Terminated.Message
		}
		initContainerStatuses = append(initContainerStatuses, status)
	}

	// Build main containers information
	containers := []map[string]interface{}{}
	for _, c := range pod.Spec.Containers {
		container := map[string]interface{}{
			"name":    c.Name,
			"image":   c.Image,
			"command": c.Command,
			"args":    c.Args,
		}

		// Add ports
		if len(c.Ports) > 0 {
			ports := []map[string]interface{}{}
			for _, p := range c.Ports {
				ports = append(ports, map[string]interface{}{
					"name":           p.Name,
					"container_port": p.ContainerPort,
					"protocol":       string(p.Protocol),
				})
			}
			container["ports"] = ports
		}

		// Add resource requirements
		if c.Resources.Requests != nil || c.Resources.Limits != nil {
			resources := map[string]interface{}{}
			if c.Resources.Requests != nil {
				requests := map[string]string{}
				if cpu, ok := c.Resources.Requests["cpu"]; ok {
					requests["cpu"] = cpu.String()
				}
				if mem, ok := c.Resources.Requests["memory"]; ok {
					requests["memory"] = mem.String()
				}
				resources["requests"] = requests
			}
			if c.Resources.Limits != nil {
				limits := map[string]string{}
				if cpu, ok := c.Resources.Limits["cpu"]; ok {
					limits["cpu"] = cpu.String()
				}
				if mem, ok := c.Resources.Limits["memory"]; ok {
					limits["memory"] = mem.String()
				}
				resources["limits"] = limits
			}
			container["resources"] = resources
		}
		containers = append(containers, container)
	}

	containerStatuses := []map[string]interface{}{}
	for _, cs := range pod.Status.ContainerStatuses {
		status := map[string]interface{}{
			"name":          cs.Name,
			"ready":         cs.Ready,
			"restart_count": cs.RestartCount,
			"image":         cs.Image,
		}
		if cs.State.Running != nil {
			status["state"] = "Running"
			if cs.State.Running.StartedAt.Time.Unix() > 0 {
				status["started_at"] = cs.State.Running.StartedAt.Format("2006-01-02 15:04:05")
			}
		} else if cs.State.Waiting != nil {
			status["state"] = "Waiting"
			status["reason"] = cs.State.Waiting.Reason
			status["message"] = cs.State.Waiting.Message
		} else if cs.State.Terminated != nil {
			status["state"] = "Terminated"
			status["exit_code"] = cs.State.Terminated.ExitCode
			status["reason"] = cs.State.Terminated.Reason
			status["message"] = cs.State.Terminated.Message
		}
		containerStatuses = append(containerStatuses, status)
	}

	conditions := []map[string]interface{}{}
	for _, c := range pod.Status.Conditions {
		conditions = append(conditions, map[string]interface{}{
			"type":               string(c.Type),
			"status":             string(c.Status),
			"reason":             c.Reason,
			"message":            c.Message,
			"last_transition_at": c.LastTransitionTime.Format("2006-01-02 15:04:05"),
		})
	}

	// Extract app info from labels/annotations
	appInfo := map[string]string{}
	if appName, ok := pod.Labels["app"]; ok {
		appInfo["app_name"] = appName
	} else if appName, ok := pod.Labels["app.kubernetes.io/name"]; ok {
		appInfo["app_name"] = appName
	}
	if version, ok := pod.Labels["version"]; ok {
		appInfo["version"] = version
	} else if version, ok := pod.Labels["app.kubernetes.io/version"]; ok {
		appInfo["version"] = version
	}
	if component, ok := pod.Labels["component"]; ok {
		appInfo["component"] = component
	} else if component, ok := pod.Labels["app.kubernetes.io/component"]; ok {
		appInfo["component"] = component
	}

	details := map[string]interface{}{
		"phase":                   string(pod.Status.Phase),
		"node_name":               pod.Spec.NodeName,
		"pod_ip":                  pod.Status.PodIP,
		"host_ip":                 pod.Status.HostIP,
		"qos_class":               string(pod.Status.QOSClass),
		"service_account":         pod.Spec.ServiceAccountName,
		"restart_policy":          string(pod.Spec.RestartPolicy),
		"labels":                  pod.Labels,
		"annotations":             pod.Annotations,
		"init_containers":         initContainers,
		"init_container_statuses": initContainerStatuses,
		"containers":              containers,
		"container_statuses":      containerStatuses,
		"conditions":              conditions,
		"app_info":                appInfo,
	}

	// Add creation timestamp
	if !pod.CreationTimestamp.Time.IsZero() {
		details["created_at"] = pod.CreationTimestamp.Format("2006-01-02 15:04:05")
	}

	// Calculate ready containers
	readyCount := 0
	totalCount := len(pod.Spec.Containers)
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Ready {
			readyCount++
		}
	}

	return map[string]interface{}{
		"name":             pod.Name,
		"namespace":        pod.Namespace,
		"resource_type":    "Pod",
		"status":           string(pod.Status.Phase),
		"health_score":     calculatePodHealth(pod),
		"ready_containers": readyCount,
		"total_containers": totalCount,
		"details":          details,
		"relationships":    buildPodRelationships(pod, application, ctx),
	}
}

func buildDeploymentDetails(dep *appsv1.Deployment, application *app.App, ctx context.Context) map[string]interface{} {
	details := map[string]interface{}{
		"replicas_desired":   *dep.Spec.Replicas,
		"replicas_ready":     dep.Status.ReadyReplicas,
		"replicas_available": dep.Status.AvailableReplicas,
		"replicas_updated":   dep.Status.UpdatedReplicas,
		"labels":             dep.Labels,
	}

	if dep.Spec.Strategy.Type != "" {
		details["strategy"] = map[string]interface{}{
			"type": string(dep.Spec.Strategy.Type),
		}
	}

	conditions := []map[string]interface{}{}
	for _, c := range dep.Status.Conditions {
		conditions = append(conditions, map[string]interface{}{
			"type":    string(c.Type),
			"status":  string(c.Status),
			"reason":  c.Reason,
			"message": c.Message,
		})
	}
	details["conditions"] = conditions

	return map[string]interface{}{
		"name":          dep.Name,
		"namespace":     dep.Namespace,
		"resource_type": "Deployment",
		"status":        getDeploymentStatus(dep),
		"health_score":  calculateDeploymentHealth(dep),
		"details":       details,
		"relationships": buildDeploymentRelationships(dep, application, ctx),
	}
}

func buildServiceDetails(svc *corev1.Service, application *app.App, ctx context.Context) map[string]interface{} {
	ports := []map[string]interface{}{}
	for _, p := range svc.Spec.Ports {
		ports = append(ports, map[string]interface{}{
			"name":        p.Name,
			"port":        p.Port,
			"target_port": p.TargetPort.String(),
			"protocol":    string(p.Protocol),
			"node_port":   p.NodePort,
		})
	}

	endpoints, _ := application.K8sClient.Clientset.CoreV1().Endpoints(svc.Namespace).Get(ctx, svc.Name, metav1.GetOptions{})
	endpointCount := 0
	if endpoints != nil {
		for _, subset := range endpoints.Subsets {
			endpointCount += len(subset.Addresses)
		}
	}

	details := map[string]interface{}{
		"type":           string(svc.Spec.Type),
		"cluster_ip":     svc.Spec.ClusterIP,
		"external_ips":   svc.Spec.ExternalIPs,
		"ports":          ports,
		"endpoint_count": endpointCount,
		"labels":         svc.Labels,
	}

	return map[string]interface{}{
		"name":          svc.Name,
		"namespace":     svc.Namespace,
		"resource_type": "Service",
		"status":        "Active",
		"health_score":  100,
		"details":       details,
		"relationships": buildServiceRelationships(svc, application, ctx),
	}
}

func buildIngressDetails(ing *networkingv1.Ingress, application *app.App, ctx context.Context) map[string]interface{} {
	hosts := []string{}
	backends := []string{}
	for _, rule := range ing.Spec.Rules {
		hosts = append(hosts, rule.Host)
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				backends = append(backends, path.Backend.Service.Name)
			}
		}
	}

	details := map[string]interface{}{
		"hosts":            hosts,
		"tls_enabled":      len(ing.Spec.TLS) > 0,
		"backend_services": backends,
		"labels":           ing.Labels,
	}

	return map[string]interface{}{
		"name":          ing.Name,
		"namespace":     ing.Namespace,
		"resource_type": "Ingress",
		"status":        "Active",
		"health_score":  100,
		"details":       details,
		"relationships": buildIngressRelationships(ing, application, ctx),
	}
}

func buildPodRelationships(pod *corev1.Pod, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Owner references (Deployment, ReplicaSet, etc.)
	for _, owner := range pod.OwnerReferences {
		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Owned By",
			"resource_type":     owner.Kind,
			"resource_name":     owner.Name,
			"target_type":       owner.Kind,
			"target_namespace":  pod.Namespace,
			"icon":              "👤",
		})
	}

	// PersistentVolumeClaims
	for _, vol := range pod.Spec.Volumes {
		if vol.PersistentVolumeClaim != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses PVC",
				"resource_type":     "PersistentVolumeClaim",
				"resource_name":     vol.PersistentVolumeClaim.ClaimName,
				"target_type":       "PersistentVolumeClaim",
				"target_namespace":  pod.Namespace,
				"mount_name":        vol.Name,
				"icon":              "💾",
			})
		}
	}

	// ConfigMaps (from volumes)
	for _, vol := range pod.Spec.Volumes {
		if vol.ConfigMap != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Mounts ConfigMap",
				"resource_type":     "ConfigMap",
				"resource_name":     vol.ConfigMap.Name,
				"target_type":       "ConfigMap",
				"target_namespace":  pod.Namespace,
				"mount_name":        vol.Name,
				"icon":              "⚙️",
			})
		}
	}

	// Secrets (from volumes)
	for _, vol := range pod.Spec.Volumes {
		if vol.Secret != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Mounts Secret",
				"resource_type":     "Secret",
				"resource_name":     vol.Secret.SecretName,
				"target_type":       "Secret",
				"target_namespace":  pod.Namespace,
				"mount_name":        vol.Name,
				"icon":              "🔐",
			})
		}
	}

	// ConfigMaps and Secrets from envFrom
	for _, container := range pod.Spec.Containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Uses ConfigMap (Env)",
					"resource_type":     "ConfigMap",
					"resource_name":     envFrom.ConfigMapRef.Name,
					"target_type":       "ConfigMap",
					"target_namespace":  pod.Namespace,
					"container":         container.Name,
					"icon":              "⚙️",
				})
			}
			if envFrom.SecretRef != nil {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Uses Secret (Env)",
					"resource_type":     "Secret",
					"resource_name":     envFrom.SecretRef.Name,
					"target_type":       "Secret",
					"target_namespace":  pod.Namespace,
					"container":         container.Name,
					"icon":              "🔐",
				})
			}
		}
	}

	// ServiceAccount
	if pod.Spec.ServiceAccountName != "" && pod.Spec.ServiceAccountName != "default" {
		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Uses ServiceAccount",
			"resource_type":     "ServiceAccount",
			"resource_name":     pod.Spec.ServiceAccountName,
			"target_type":       "ServiceAccount",
			"target_namespace":  pod.Namespace,
			"icon":              "🎫",
		})
	}

	return relationships
}

func buildDeploymentRelationships(dep *appsv1.Deployment, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Pods managed by this deployment
	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(dep.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: metav1.FormatLabelSelector(dep.Spec.Selector),
	})
	for _, pod := range pods.Items {
		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Manages Pod",
			"resource_type":     "Pod",
			"resource_name":     pod.Name,
			"target_type":       "Pod",
			"target_namespace":  dep.Namespace,
			"icon":              "📦",
			"details": map[string]interface{}{
				"status": string(pod.Status.Phase),
				"node":   pod.Spec.NodeName,
			},
		})
	}

	// ConfigMaps and Secrets used by the deployment template
	for _, vol := range dep.Spec.Template.Spec.Volumes {
		if vol.ConfigMap != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses ConfigMap",
				"resource_type":     "ConfigMap",
				"resource_name":     vol.ConfigMap.Name,
				"target_type":       "ConfigMap",
				"target_namespace":  dep.Namespace,
				"icon":              "⚙️",
			})
		}
		if vol.Secret != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses Secret",
				"resource_type":     "Secret",
				"resource_name":     vol.Secret.SecretName,
				"target_type":       "Secret",
				"target_namespace":  dep.Namespace,
				"icon":              "🔐",
			})
		}
		if vol.PersistentVolumeClaim != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses PVC",
				"resource_type":     "PersistentVolumeClaim",
				"resource_name":     vol.PersistentVolumeClaim.ClaimName,
				"target_type":       "PersistentVolumeClaim",
				"target_namespace":  dep.Namespace,
				"icon":              "💾",
			})
		}
	}

	return relationships
}

func buildServiceRelationships(svc *corev1.Service, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Deployments that this service routes to (top-down)
	if svc.Spec.Selector != nil {
		selector := labels.Set(svc.Spec.Selector).AsSelector()

		// Find deployments that match the service selector
		deployments, _ := application.K8sClient.Clientset.AppsV1().Deployments(svc.Namespace).List(ctx, metav1.ListOptions{})
		for _, dep := range deployments.Items {
			if selector.Matches(labels.Set(dep.Spec.Template.Labels)) {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Routes To Deployment",
					"resource_type":     "Deployment",
					"resource_name":     dep.Name,
					"target_type":       "Deployment",
					"target_namespace":  svc.Namespace,
					"icon":              "🏗️",
					"details": map[string]interface{}{
						"replicas": fmt.Sprintf("%d/%d", dep.Status.ReadyReplicas, *dep.Spec.Replicas),
						"status":   fmt.Sprintf("%d available", dep.Status.AvailableReplicas),
					},
				})
			}
		}

		// Find StatefulSets that match the service selector
		statefulsets, _ := application.K8sClient.Clientset.AppsV1().StatefulSets(svc.Namespace).List(ctx, metav1.ListOptions{})
		for _, sts := range statefulsets.Items {
			if selector.Matches(labels.Set(sts.Spec.Template.Labels)) {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Routes To StatefulSet",
					"resource_type":     "StatefulSet",
					"resource_name":     sts.Name,
					"target_type":       "StatefulSet",
					"target_namespace":  svc.Namespace,
					"icon":              "📊",
					"details": map[string]interface{}{
						"replicas": fmt.Sprintf("%d/%d", sts.Status.ReadyReplicas, *sts.Spec.Replicas),
					},
				})
			}
		}

		// If no deployments/statefulsets found, show pods directly
		if len(relationships) == 0 {
			pods, _ := application.K8sClient.Clientset.CoreV1().Pods(svc.Namespace).List(ctx, metav1.ListOptions{
				LabelSelector: selector.String(),
			})
			for _, pod := range pods.Items {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Routes To Pod",
					"resource_type":     "Pod",
					"resource_name":     pod.Name,
					"target_type":       "Pod",
					"target_namespace":  svc.Namespace,
					"icon":              "📦",
					"details": map[string]interface{}{
						"status": string(pod.Status.Phase),
						"pod_ip": pod.Status.PodIP,
						"node":   pod.Spec.NodeName,
					},
				})
			}
		}
	}

	return relationships
}

func buildIngressRelationships(ing *networkingv1.Ingress, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Use a map to deduplicate services and collect their paths
	serviceMap := make(map[string][]map[string]string)

	for _, rule := range ing.Spec.Rules {
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service != nil {
					serviceName := path.Backend.Service.Name
					pathInfo := map[string]string{
						"host": rule.Host,
						"path": path.Path,
					}
					serviceMap[serviceName] = append(serviceMap[serviceName], pathInfo)
				}
			}
		}
	}

	// Create one relationship per unique service with all its paths
	for serviceName, paths := range serviceMap {
		svc, _ := application.K8sClient.Clientset.CoreV1().Services(ing.Namespace).Get(ctx, serviceName, metav1.GetOptions{})

		details := map[string]interface{}{
			"paths": paths,
		}
		if svc != nil {
			details["cluster_ip"] = svc.Spec.ClusterIP
			details["service_type"] = string(svc.Spec.Type)
		}

		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Routes To Service",
			"resource_type":     "Service",
			"resource_name":     serviceName,
			"target_type":       "Service",
			"target_namespace":  ing.Namespace,
			"icon":              "🌐",
			"details":           details,
		})
	}

	return relationships
}

func buildStatefulSetDetails(sts *appsv1.StatefulSet, application *app.App, ctx context.Context) map[string]interface{} {
	desired := int32(0)
	if sts.Spec.Replicas != nil {
		desired = *sts.Spec.Replicas
	}

	health := 100
	if desired > 0 {
		health = int((sts.Status.ReadyReplicas * 100) / desired)
	}

	return map[string]interface{}{
		"name":          sts.Name,
		"namespace":     sts.Namespace,
		"resource_type": "StatefulSet",
		"status":        getStatefulSetStatus(sts),
		"health_score":  health,
		"details": map[string]interface{}{
			"replicas_desired": desired,
			"replicas_ready":   sts.Status.ReadyReplicas,
			"replicas_current": sts.Status.CurrentReplicas,
			"service_name":     sts.Spec.ServiceName,
			"update_strategy":  string(sts.Spec.UpdateStrategy.Type),
		},
		"relationships": buildStatefulSetRelationships(sts, application, ctx),
	}
}

func buildDaemonSetDetails(ds *appsv1.DaemonSet, application *app.App, ctx context.Context) map[string]interface{} {
	health := 100
	if ds.Status.DesiredNumberScheduled > 0 {
		health = int((ds.Status.NumberReady * 100) / ds.Status.DesiredNumberScheduled)
	}

	return map[string]interface{}{
		"name":          ds.Name,
		"namespace":     ds.Namespace,
		"resource_type": "DaemonSet",
		"status":        getDaemonSetStatus(ds),
		"health_score":  health,
		"details": map[string]interface{}{
			"desired_scheduled": ds.Status.DesiredNumberScheduled,
			"current_scheduled": ds.Status.CurrentNumberScheduled,
			"ready":             ds.Status.NumberReady,
			"available":         ds.Status.NumberAvailable,
			"update_strategy":   string(ds.Spec.UpdateStrategy.Type),
		},
		"relationships": buildDaemonSetRelationships(ds, application, ctx),
	}
}

func buildJobDetails(job *batchv1.Job, application *app.App, ctx context.Context) map[string]interface{} {
	status := "Running"
	health := 50
	if job.Status.Succeeded > 0 {
		status = "Completed"
		health = 100
	} else if job.Status.Failed > 0 {
		status = "Failed"
		health = 0
	}

	return map[string]interface{}{
		"name":          job.Name,
		"namespace":     job.Namespace,
		"resource_type": "Job",
		"status":        status,
		"health_score":  health,
		"details": map[string]interface{}{
			"completions": job.Spec.Completions,
			"parallelism": job.Spec.Parallelism,
			"succeeded":   job.Status.Succeeded,
			"failed":      job.Status.Failed,
			"active":      job.Status.Active,
		},
		"relationships": buildJobRelationships(job, application, ctx),
	}
}

func buildCronJobDetails(cj *batchv1.CronJob, application *app.App, ctx context.Context) map[string]interface{} {
	status := "Active"
	health := 100
	if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
		status = "Suspended"
		health = 50
	}

	return map[string]interface{}{
		"name":          cj.Name,
		"namespace":     cj.Namespace,
		"resource_type": "CronJob",
		"status":        status,
		"health_score":  health,
		"details": map[string]interface{}{
			"schedule":           cj.Spec.Schedule,
			"suspend":            cj.Spec.Suspend != nil && *cj.Spec.Suspend,
			"last_schedule_time": cj.Status.LastScheduleTime,
			"active_jobs":        len(cj.Status.Active),
			"concurrency_policy": string(cj.Spec.ConcurrencyPolicy),
		},
		"relationships": buildCronJobRelationships(cj, application, ctx),
	}
}

func getStatefulSetStatus(sts *appsv1.StatefulSet) string {
	desired := int32(0)
	if sts.Spec.Replicas != nil {
		desired = *sts.Spec.Replicas
	}
	if sts.Status.ReadyReplicas == desired {
		return "Healthy"
	}
	return "Degraded"
}

func getDaemonSetStatus(ds *appsv1.DaemonSet) string {
	if ds.Status.NumberReady == ds.Status.DesiredNumberScheduled {
		return "Healthy"
	}
	return "Degraded"
}

func buildStatefulSetRelationships(sts *appsv1.StatefulSet, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Find pods managed by this StatefulSet
	if sts.Spec.Selector != nil {
		selector := labels.SelectorFromSet(sts.Spec.Selector.MatchLabels)
		pods, _ := application.K8sClient.Clientset.CoreV1().Pods(sts.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector.String(),
		})

		for _, pod := range pods.Items {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Manages Pod",
				"resource_type":     "Pod",
				"resource_name":     pod.Name,
				"icon":              "💾",
			})
		}
	}

	return relationships
}

func buildDaemonSetRelationships(ds *appsv1.DaemonSet, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Find pods managed by this DaemonSet
	if ds.Spec.Selector != nil {
		selector := labels.SelectorFromSet(ds.Spec.Selector.MatchLabels)
		pods, _ := application.K8sClient.Clientset.CoreV1().Pods(ds.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector.String(),
		})

		for _, pod := range pods.Items {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Manages Pod",
				"resource_type":     "Pod",
				"resource_name":     pod.Name,
				"icon":              "💾",
			})
		}
	}

	return relationships
}

func buildJobRelationships(job *batchv1.Job, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Check if this job is owned by a CronJob
	for _, owner := range job.OwnerReferences {
		if owner.Kind == "CronJob" {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Owned By CronJob",
				"resource_type":     "CronJob",
				"resource_name":     owner.Name,
				"target_type":       "CronJob",
				"target_namespace":  job.Namespace,
				"icon":              "⏰",
			})
		}
	}

	// Find pods created by this Job
	if job.Spec.Selector != nil {
		selector := labels.SelectorFromSet(job.Spec.Selector.MatchLabels)
		pods, _ := application.K8sClient.Clientset.CoreV1().Pods(job.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector.String(),
		})

		for _, pod := range pods.Items {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Created Pod",
				"resource_type":     "Pod",
				"resource_name":     pod.Name,
				"target_type":       "Pod",
				"target_namespace":  job.Namespace,
				"icon":              "📦",
				"details": map[string]interface{}{
					"status": string(pod.Status.Phase),
					"node":   pod.Spec.NodeName,
				},
			})
		}
	}

	// Find ConfigMaps used by this Job's pod template
	for _, vol := range job.Spec.Template.Spec.Volumes {
		if vol.ConfigMap != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses ConfigMap",
				"resource_type":     "ConfigMap",
				"resource_name":     vol.ConfigMap.Name,
				"target_type":       "ConfigMap",
				"target_namespace":  job.Namespace,
				"icon":              "📋",
			})
		}
		if vol.Secret != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses Secret",
				"resource_type":     "Secret",
				"resource_name":     vol.Secret.SecretName,
				"target_type":       "Secret",
				"target_namespace":  job.Namespace,
				"icon":              "🔐",
			})
		}
		if vol.PersistentVolumeClaim != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses PVC",
				"resource_type":     "PersistentVolumeClaim",
				"resource_name":     vol.PersistentVolumeClaim.ClaimName,
				"target_type":       "PersistentVolumeClaim",
				"target_namespace":  job.Namespace,
				"icon":              "💾",
			})
		}
	}

	return relationships
}

func buildCronJobRelationships(cj *batchv1.CronJob, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Find ALL jobs created by this CronJob (not just active ones)
	jobs, _ := application.K8sClient.Clientset.BatchV1().Jobs(cj.Namespace).List(ctx, metav1.ListOptions{})
	for _, job := range jobs.Items {
		// Check if this job is owned by the CronJob
		for _, owner := range job.OwnerReferences {
			if owner.Kind == "CronJob" && owner.Name == cj.Name {
				jobStatus := "Running"
				if job.Status.Succeeded > 0 {
					jobStatus = "Completed"
				} else if job.Status.Failed > 0 {
					jobStatus = "Failed"
				}

				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Manages Job",
					"resource_type":     "Job",
					"resource_name":     job.Name,
					"target_type":       "Job",
					"target_namespace":  cj.Namespace,
					"icon":              "⚙️",
					"details": map[string]interface{}{
						"status":    jobStatus,
						"succeeded": job.Status.Succeeded,
						"failed":    job.Status.Failed,
						"active":    job.Status.Active,
					},
				})
				break
			}
		}
	}

	return relationships
}

func buildConfigMapRelationships(cm *corev1.ConfigMap, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Find pods that use this ConfigMap (bottom-up)
	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(cm.Namespace).List(ctx, metav1.ListOptions{})

	for _, pod := range pods.Items {
		usageType := ""

		// Check volumes
		for _, vol := range pod.Spec.Volumes {
			if vol.ConfigMap != nil && vol.ConfigMap.Name == cm.Name {
				usageType = "volume"
				break
			}
		}

		// Check envFrom
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
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Used By Pod",
				"resource_type":     "Pod",
				"resource_name":     pod.Name,
				"target_type":       "Pod",
				"target_namespace":  cm.Namespace,
				"icon":              "📦",
				"details": map[string]interface{}{
					"usage_type": usageType,
					"status":     string(pod.Status.Phase),
				},
			})
		}
	}

	return relationships
}

func buildSecretRelationships(secret *corev1.Secret, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Skip service account tokens
	if secret.Type == "kubernetes.io/service-account-token" {
		return relationships
	}

	// Find pods that use this Secret (bottom-up)
	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(secret.Namespace).List(ctx, metav1.ListOptions{})

	for _, pod := range pods.Items {
		usageType := ""

		// Check volumes
		for _, vol := range pod.Spec.Volumes {
			if vol.Secret != nil && vol.Secret.SecretName == secret.Name {
				usageType = "volume"
				break
			}
		}

		// Check envFrom
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
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Used By Pod",
				"resource_type":     "Pod",
				"resource_name":     pod.Name,
				"target_type":       "Pod",
				"target_namespace":  secret.Namespace,
				"icon":              "📦",
				"details": map[string]interface{}{
					"usage_type": usageType,
					"status":     string(pod.Status.Phase),
				},
			})
		}
	}

	return relationships
}

func buildPVCRelationships(pvc *corev1.PersistentVolumeClaim, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Add PersistentVolume relationship if bound
	if pvc.Spec.VolumeName != "" {
		pv, err := application.K8sClient.Clientset.CoreV1().PersistentVolumes().Get(ctx, pvc.Spec.VolumeName, metav1.GetOptions{})
		if err == nil {
			pvDetails := map[string]interface{}{
				"reclaim_policy": string(pv.Spec.PersistentVolumeReclaimPolicy),
				"status":         string(pv.Status.Phase),
			}
			if capacity, ok := pv.Spec.Capacity["storage"]; ok {
				pvDetails["capacity"] = capacity.String()
			}
			if pv.Spec.StorageClassName != "" {
				pvDetails["storage_class"] = pv.Spec.StorageClassName
			}

			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Bound To PV",
				"resource_type":     "PersistentVolume",
				"resource_name":     pvc.Spec.VolumeName,
				"target_type":       "PersistentVolume",
				"icon":              "💿",
				"details":           pvDetails,
			})
		}
	}

	// Find pods that use this PVC (bottom-up)
	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(pvc.Namespace).List(ctx, metav1.ListOptions{})

	for _, pod := range pods.Items {
		for _, vol := range pod.Spec.Volumes {
			if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvc.Name {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Used By Pod",
					"resource_type":     "Pod",
					"resource_name":     pod.Name,
					"target_type":       "Pod",
					"target_namespace":  pvc.Namespace,
					"icon":              "📦",
					"details": map[string]interface{}{
						"volume_name": vol.Name,
						"status":      string(pod.Status.Phase),
						"node":        pod.Spec.NodeName,
					},
				})
				break
			}
		}
	}

	// Find Deployments/StatefulSets using this PVC
	deployments, _ := application.K8sClient.Clientset.AppsV1().Deployments(pvc.Namespace).List(ctx, metav1.ListOptions{})
	for _, deploy := range deployments.Items {
		for _, vol := range deploy.Spec.Template.Spec.Volumes {
			if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvc.Name {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Used By Deployment",
					"resource_type":     "Deployment",
					"resource_name":     deploy.Name,
					"target_type":       "Deployment",
					"target_namespace":  pvc.Namespace,
					"icon":              "🚀",
				})
				break
			}
		}
	}

	statefulsets, _ := application.K8sClient.Clientset.AppsV1().StatefulSets(pvc.Namespace).List(ctx, metav1.ListOptions{})
	for _, sts := range statefulsets.Items {
		for _, vol := range sts.Spec.Template.Spec.Volumes {
			if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvc.Name {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Used By StatefulSet",
					"resource_type":     "StatefulSet",
					"resource_name":     sts.Name,
					"target_type":       "StatefulSet",
					"target_namespace":  pvc.Namespace,
					"icon":              "📊",
				})
				break
			}
		}
	}

	return relationships
}

func buildConfigMapDetails(cm *corev1.ConfigMap, application *app.App, ctx context.Context) map[string]interface{} {
	details := map[string]interface{}{
		"keys":       len(cm.Data),
		"data_keys":  getMapKeys(cm.Data),
		"labels":     cm.Labels,
		"created_at": cm.CreationTimestamp.Time,
	}

	return map[string]interface{}{
		"name":          cm.Name,
		"namespace":     cm.Namespace,
		"resource_type": "ConfigMap",
		"status":        "Active",
		"health_score":  100,
		"details":       details,
		"relationships": buildConfigMapRelationships(cm, application, ctx),
	}
}

func buildSecretDetails(secret *corev1.Secret, application *app.App, ctx context.Context) map[string]interface{} {
	details := map[string]interface{}{
		"type":       string(secret.Type),
		"keys":       len(secret.Data),
		"data_keys":  getMapKeys(secret.Data),
		"labels":     secret.Labels,
		"created_at": secret.CreationTimestamp.Time,
	}

	return map[string]interface{}{
		"name":          secret.Name,
		"namespace":     secret.Namespace,
		"resource_type": "Secret",
		"status":        "Active",
		"health_score":  100,
		"details":       details,
		"relationships": buildSecretRelationships(secret, application, ctx),
	}
}

func buildPVCDetails(pvc *corev1.PersistentVolumeClaim, application *app.App, ctx context.Context) map[string]interface{} {
	// Access modes
	accessModes := []string{}
	for _, mode := range pvc.Spec.AccessModes {
		accessModes = append(accessModes, string(mode))
	}

	storageClass := getStringPointer(pvc.Spec.StorageClassName)

	requestedStorage := ""
	if storage, ok := pvc.Spec.Resources.Requests["storage"]; ok {
		requestedStorage = storage.String()
	}

	actualStorage := ""
	if storage, ok := pvc.Status.Capacity["storage"]; ok {
		actualStorage = storage.String()
	}

	volumeMode := "Filesystem"
	if pvc.Spec.VolumeMode != nil {
		volumeMode = string(*pvc.Spec.VolumeMode)
	}

	// Fetch full PV details when bound
	var pvDetails map[string]interface{}
	if pvc.Spec.VolumeName != "" {
		pv, err := application.K8sClient.Clientset.CoreV1().PersistentVolumes().Get(ctx, pvc.Spec.VolumeName, metav1.GetOptions{})
		if err == nil {
			pvCapacity := ""
			if capacity, ok := pv.Spec.Capacity["storage"]; ok {
				pvCapacity = capacity.String()
			}
			pvAccessModes := []string{}
			for _, mode := range pv.Spec.AccessModes {
				pvAccessModes = append(pvAccessModes, string(mode))
			}

			// Detect volume type and driver-specific details
			volumeType := "Unknown"
			volumeTypeDetails := map[string]interface{}{}
			if pv.Spec.HostPath != nil {
				volumeType = "HostPath"
				volumeTypeDetails["path"] = pv.Spec.HostPath.Path
			} else if pv.Spec.NFS != nil {
				volumeType = "NFS"
				volumeTypeDetails["server"] = pv.Spec.NFS.Server
				volumeTypeDetails["path"] = pv.Spec.NFS.Path
				volumeTypeDetails["readOnly"] = pv.Spec.NFS.ReadOnly
			} else if pv.Spec.CSI != nil {
				volumeType = "CSI"
				volumeTypeDetails["driver"] = pv.Spec.CSI.Driver
				volumeTypeDetails["volumeHandle"] = pv.Spec.CSI.VolumeHandle
				if pv.Spec.CSI.FSType != "" {
					volumeTypeDetails["fsType"] = pv.Spec.CSI.FSType
				}
			} else if pv.Spec.AWSElasticBlockStore != nil {
				volumeType = "AWS EBS"
				volumeTypeDetails["volumeID"] = pv.Spec.AWSElasticBlockStore.VolumeID
				volumeTypeDetails["fsType"] = pv.Spec.AWSElasticBlockStore.FSType
			} else if pv.Spec.Local != nil {
				volumeType = "Local"
				volumeTypeDetails["path"] = pv.Spec.Local.Path
			} else if pv.Spec.AzureDisk != nil {
				volumeType = "Azure Disk"
				volumeTypeDetails["diskName"] = pv.Spec.AzureDisk.DiskName
				volumeTypeDetails["diskURI"] = pv.Spec.AzureDisk.DataDiskURI
			} else if pv.Spec.AzureFile != nil {
				volumeType = "Azure File"
				volumeTypeDetails["shareName"] = pv.Spec.AzureFile.ShareName
			} else if pv.Spec.GCEPersistentDisk != nil {
				volumeType = "GCE PD"
				volumeTypeDetails["pdName"] = pv.Spec.GCEPersistentDisk.PDName
				volumeTypeDetails["fsType"] = pv.Spec.GCEPersistentDisk.FSType
			}

			pvVolumeMode := "Filesystem"
			if pv.Spec.VolumeMode != nil {
				pvVolumeMode = string(*pv.Spec.VolumeMode)
			}

			pvDetails = map[string]interface{}{
				"name":           pv.Name,
				"status":         string(pv.Status.Phase),
				"capacity":       pvCapacity,
				"reclaim_policy": string(pv.Spec.PersistentVolumeReclaimPolicy),
				"volume_type":    volumeType,
				"volume_details": volumeTypeDetails,
				"volume_mode":    pvVolumeMode,
				"access_modes":   pvAccessModes,
				"storage_class":  pv.Spec.StorageClassName,
				"created_at":     pv.CreationTimestamp.Format(time.RFC3339),
				"age_days":       int(time.Since(pv.CreationTimestamp.Time).Hours() / 24),
			}
		}
	}

	// Fetch pods using this PVC
	usingPods := []string{}
	podDetails := []map[string]interface{}{}
	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(pvc.Namespace).List(ctx, metav1.ListOptions{})
	for _, pod := range pods.Items {
		for _, vol := range pod.Spec.Volumes {
			if vol.PersistentVolumeClaim != nil && vol.PersistentVolumeClaim.ClaimName == pvc.Name {
				usingPods = append(usingPods, pod.Name)
				restartCount := 0
				for _, cs := range pod.Status.ContainerStatuses {
					restartCount += int(cs.RestartCount)
				}
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

	healthScore := 100
	if pvc.Status.Phase != "Bound" {
		healthScore = 50
	}

	return map[string]interface{}{
		"name":              pvc.Name,
		"namespace":         pvc.Namespace,
		"resource_type":     "PersistentVolumeClaim",
		"status":            string(pvc.Status.Phase),
		"health_score":      healthScore,
		"volume_name":       pvc.Spec.VolumeName,
		"storage_class":     storageClass,
		"access_modes":      accessModes,
		"requested_storage": requestedStorage,
		"actual_storage":    actualStorage,
		"volume_mode":       volumeMode,
		"pod_count":         len(usingPods),
		"using_pods":        usingPods,
		"pod_details":       podDetails,
		"pv_details":        pvDetails,
		"labels":            pvc.Labels,
		"annotations":       pvc.Annotations,
		"created_at":        pvc.CreationTimestamp.Format(time.RFC3339),
		"age_days":          int(time.Since(pvc.CreationTimestamp.Time).Hours() / 24),
		"relationships":     buildPVCRelationships(pvc, application, ctx),
	}
}

func getMapKeys(m interface{}) []string {
	keys := []string{}
	switch v := m.(type) {
	case map[string]string:
		for k := range v {
			keys = append(keys, k)
		}
	case map[string][]byte:
		for k := range v {
			keys = append(keys, k)
		}
	}
	return keys
}

func getStringPointer(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
