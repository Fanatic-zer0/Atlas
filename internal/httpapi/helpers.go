package httpapi

import (
	"context"

	"ajna/internal/app"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
)

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
	containers := []map[string]interface{}{}
	for _, c := range pod.Spec.Containers {
		container := map[string]interface{}{
			"name":  c.Name,
			"image": c.Image,
		}
		if c.Resources.Requests != nil || c.Resources.Limits != nil {
			container["resources"] = map[string]interface{}{
				"requests": c.Resources.Requests,
				"limits":   c.Resources.Limits,
			}
		}
		containers = append(containers, container)
	}

	containerStatuses := []map[string]interface{}{}
	for _, cs := range pod.Status.ContainerStatuses {
		status := map[string]interface{}{
			"name":          cs.Name,
			"ready":         cs.Ready,
			"restart_count": cs.RestartCount,
		}
		if cs.State.Running != nil {
			status["state_info"] = map[string]interface{}{"state": "running"}
		} else if cs.State.Waiting != nil {
			status["state_info"] = map[string]interface{}{
				"state":   "waiting",
				"reason":  cs.State.Waiting.Reason,
				"message": cs.State.Waiting.Message,
			}
		} else if cs.State.Terminated != nil {
			status["state_info"] = map[string]interface{}{
				"state":   "terminated",
				"reason":  cs.State.Terminated.Reason,
				"message": cs.State.Terminated.Message,
			}
		}
		containerStatuses = append(containerStatuses, status)
	}

	conditions := []map[string]interface{}{}
	for _, c := range pod.Status.Conditions {
		conditions = append(conditions, map[string]interface{}{
			"type":    string(c.Type),
			"status":  string(c.Status),
			"reason":  c.Reason,
			"message": c.Message,
		})
	}

	details := map[string]interface{}{
		"node_name":          pod.Spec.NodeName,
		"pod_ip":             pod.Status.PodIP,
		"host_ip":            pod.Status.HostIP,
		"labels":             pod.Labels,
		"containers":         containers,
		"container_statuses": containerStatuses,
		"conditions":         conditions,
	}

	return map[string]interface{}{
		"name":          pod.Name,
		"namespace":     pod.Namespace,
		"resource_type": "Pod",
		"status":        string(pod.Status.Phase),
		"health_score":  calculatePodHealth(pod),
		"details":       details,
		"relationships": buildPodRelationships(pod, application, ctx),
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

	for _, owner := range pod.OwnerReferences {
		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Owned By",
			"resource_type":     owner.Kind,
			"resource_name":     owner.Name,
		})
	}

	return relationships
}

func buildDeploymentRelationships(dep *appsv1.Deployment, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	pods, _ := application.K8sClient.Clientset.CoreV1().Pods(dep.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: metav1.FormatLabelSelector(dep.Spec.Selector),
	})
	for _, pod := range pods.Items {
		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Manages",
			"resource_type":     "Pod",
			"resource_name":     pod.Name,
			"details": map[string]interface{}{
				"status": string(pod.Status.Phase),
			},
		})
	}

	return relationships
}

func buildServiceRelationships(svc *corev1.Service, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	if svc.Spec.Selector != nil {
		selector := labels.Set(svc.Spec.Selector).AsSelector()
		pods, _ := application.K8sClient.Clientset.CoreV1().Pods(svc.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector.String(),
		})
		for _, pod := range pods.Items {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Routes To",
				"resource_type":     "Pod",
				"resource_name":     pod.Name,
			})
		}
	}

	return relationships
}

func buildIngressRelationships(ing *networkingv1.Ingress, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	for _, rule := range ing.Spec.Rules {
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Routes To",
					"resource_type":     "Service",
					"resource_name":     path.Backend.Service.Name,
				})
			}
		}
	}

	return relationships
}
