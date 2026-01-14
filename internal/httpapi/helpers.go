package httpapi

import (
	"context"

	"ajna/internal/app"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
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

	// Owner references (Deployment, ReplicaSet, etc.)
	for _, owner := range pod.OwnerReferences {
		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Owned By",
			"resource_type":     owner.Kind,
			"resource_name":     owner.Name,
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
					"container":         container.Name,
					"icon":              "⚙️",
				})
			}
			if envFrom.SecretRef != nil {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Uses Secret (Env)",
					"resource_type":     "Secret",
					"resource_name":     envFrom.SecretRef.Name,
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
			"icon":              "🎫",
		})
	}

	// Services that target this pod
	services, _ := application.K8sClient.Clientset.CoreV1().Services(pod.Namespace).List(ctx, metav1.ListOptions{})
	for _, svc := range services.Items {
		if svc.Spec.Selector != nil {
			selector := labels.Set(svc.Spec.Selector).AsSelector()
			if selector.Matches(labels.Set(pod.Labels)) {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Exposed By Service",
					"resource_type":     "Service",
					"resource_name":     svc.Name,
					"cluster_ip":        svc.Spec.ClusterIP,
					"icon":              "🌐",
				})
			}
		}
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
			"icon":              "📦",
			"details": map[string]interface{}{
				"status": string(pod.Status.Phase),
				"node":   pod.Spec.NodeName,
			},
		})
	}

	// Services that expose this deployment
	services, _ := application.K8sClient.Clientset.CoreV1().Services(dep.Namespace).List(ctx, metav1.ListOptions{})
	for _, svc := range services.Items {
		if svc.Spec.Selector != nil {
			svcSelector := labels.Set(svc.Spec.Selector).AsSelector()
			if svcSelector.Matches(labels.Set(dep.Spec.Template.Labels)) {
				relationships = append(relationships, map[string]interface{}{
					"relationship_type": "Exposed By Service",
					"resource_type":     "Service",
					"resource_name":     svc.Name,
					"icon":              "🌐",
					"details": map[string]interface{}{
						"cluster_ip": svc.Spec.ClusterIP,
						"type":       string(svc.Spec.Type),
					},
				})
			}
		}
	}

	// ConfigMaps and Secrets used by the deployment template
	for _, vol := range dep.Spec.Template.Spec.Volumes {
		if vol.ConfigMap != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses ConfigMap",
				"resource_type":     "ConfigMap",
				"resource_name":     vol.ConfigMap.Name,
				"icon":              "⚙️",
			})
		}
		if vol.Secret != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses Secret",
				"resource_type":     "Secret",
				"resource_name":     vol.Secret.SecretName,
				"icon":              "🔐",
			})
		}
		if vol.PersistentVolumeClaim != nil {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Uses PVC",
				"resource_type":     "PersistentVolumeClaim",
				"resource_name":     vol.PersistentVolumeClaim.ClaimName,
				"icon":              "💾",
			})
		}
	}

	return relationships
}

func buildServiceRelationships(svc *corev1.Service, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Pods targeted by this service
	if svc.Spec.Selector != nil {
		selector := labels.Set(svc.Spec.Selector).AsSelector()
		pods, _ := application.K8sClient.Clientset.CoreV1().Pods(svc.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: selector.String(),
		})
		for _, pod := range pods.Items {
			relationships = append(relationships, map[string]interface{}{
				"relationship_type": "Routes To Pod",
				"resource_type":     "Pod",
				"resource_name":     pod.Name,
				"icon":              "📦",
				"details": map[string]interface{}{
					"status": string(pod.Status.Phase),
					"pod_ip": pod.Status.PodIP,
					"node":   pod.Spec.NodeName,
				},
			})
		}
	}

	// Ingresses that route to this service
	ingresses, _ := application.K8sClient.Clientset.NetworkingV1().Ingresses(svc.Namespace).List(ctx, metav1.ListOptions{})
	for _, ing := range ingresses.Items {
		for _, rule := range ing.Spec.Rules {
			if rule.HTTP != nil {
				for _, path := range rule.HTTP.Paths {
					if path.Backend.Service != nil && path.Backend.Service.Name == svc.Name {
						relationships = append(relationships, map[string]interface{}{
							"relationship_type": "Exposed By Ingress",
							"resource_type":     "Ingress",
							"resource_name":     ing.Name,
							"icon":              "🌍",
							"details": map[string]interface{}{
								"host": rule.Host,
								"path": path.Path,
							},
						})
						break
					}
				}
			}
		}
	}

	return relationships
}

func buildIngressRelationships(ing *networkingv1.Ingress, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	for _, rule := range ing.Spec.Rules {
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				if path.Backend.Service != nil {
					svc, _ := application.K8sClient.Clientset.CoreV1().Services(ing.Namespace).Get(ctx, path.Backend.Service.Name, metav1.GetOptions{})

					details := map[string]interface{}{
						"host": rule.Host,
						"path": path.Path,
					}
					if svc != nil {
						details["cluster_ip"] = svc.Spec.ClusterIP
						details["service_type"] = string(svc.Spec.Type)
					}

					relationships = append(relationships, map[string]interface{}{
						"relationship_type": "Routes To Service",
						"resource_type":     "Service",
						"resource_name":     path.Backend.Service.Name,
						"icon":              "🌐",
						"details":           details,
					})
				}
			}
		}
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
				"icon":              "💾",
			})
		}
	}

	return relationships
}

func buildCronJobRelationships(cj *batchv1.CronJob, application *app.App, ctx context.Context) []map[string]interface{} {
	relationships := []map[string]interface{}{}

	// Find active jobs created by this CronJob
	for _, activeJob := range cj.Status.Active {
		relationships = append(relationships, map[string]interface{}{
			"relationship_type": "Manages Job",
			"resource_type":     "Job",
			"resource_name":     activeJob.Name,
			"icon":              "⚙️",
		})
	}

	return relationships
}
