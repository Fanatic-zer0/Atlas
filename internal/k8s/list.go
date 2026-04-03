package k8s

import (
	"context"
	"fmt"
	"sort"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

func GetClusterInfo(ctx context.Context, cs *kubernetes.Clientset, meta KubeMeta) (ClusterInfo, error) {
	nsList, err := cs.CoreV1().Namespaces().List(ctx, metav1.ListOptions{})
	if err != nil {
		return ClusterInfo{}, err
	}
	namespaces := make([]string, 0, len(nsList.Items))
	for _, ns := range nsList.Items {
		namespaces = append(namespaces, ns.Name)
	}
	sort.Strings(namespaces)

	return ClusterInfo{
		ClusterName: meta.ClusterName,
		ContextName: meta.ContextName,
		Connected:   true,
		Namespaces:  namespaces,
	}, nil
}

func ListIngresses(ctx context.Context, cs *kubernetes.Clientset, namespace string) ([]IngressResponse, error) {
	list, err := cs.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]IngressResponse, 0, len(list.Items))
	for _, ing := range list.Items {
		out = append(out, ingressToResponse(&ing))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func ListServices(ctx context.Context, cs *kubernetes.Clientset, namespace string) ([]ServiceResponse, error) {
	list, err := cs.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	// Fetch all endpoints at once for better performance
	endpointsList, err := cs.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{})
	endpointsMap := make(map[string]*corev1.Endpoints)
	if err == nil {
		for i := range endpointsList.Items {
			ep := &endpointsList.Items[i]
			endpointsMap[ep.Name] = ep
		}
	}

	out := make([]ServiceResponse, 0, len(list.Items))
	for _, svc := range list.Items {
		resp := serviceToResponseNoEndpoints(&svc)

		// ExternalName services don't have endpoints
		if svc.Spec.Type == corev1.ServiceTypeExternalName {
			// For ExternalName, health is already set based on whether external_name is configured
			if resp.ExternalName != nil && *resp.ExternalName != "" {
				resp.StatusEmoji = "🟢"
				resp.HealthScore = 100
			} else {
				resp.StatusEmoji = "🔴"
				resp.HealthScore = 0
			}
		} else {
			// For all other service types, check endpoints
			count := 0
			if ep, ok := endpointsMap[svc.Name]; ok {
				// Endpoint object exists, count addresses
				if ep.Subsets != nil {
					for _, ss := range ep.Subsets {
						count += len(ss.Addresses)
					}
				}
			}
			// If no endpoint object exists, count remains 0

			resp.EndpointCount = count

			// health heuristic: if endpoints=0, it's critical-ish
			if count == 0 {
				resp.HealthScore = 0
			} else {
				resp.HealthScore = 100
			}
			resp.StatusEmoji = emojiForService(count, resp.HealthScore)
		}

		out = append(out, resp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func ListPods(ctx context.Context, cs *kubernetes.Clientset, namespace string, limit int) ([]PodResponse, error) {
	list, err := cs.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{
		Limit: int64(limit),
	})
	if err != nil {
		return nil, err
	}
	out := make([]PodResponse, 0, len(list.Items))
	for _, pod := range list.Items {
		out = append(out, podToResponse(&pod))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func ListDeployments(ctx context.Context, cs *kubernetes.Clientset, namespace string) ([]DeploymentResponse, error) {
	list, err := cs.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	out := make([]DeploymentResponse, 0, len(list.Items))
	for _, dep := range list.Items {
		out = append(out, deploymentToResponse(&dep))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func ingressToResponse(ing *netv1.Ingress) IngressResponse {
	hosts := []string{}
	backends := map[string]struct{}{}
	if ing.Spec.Rules != nil {
		for _, rule := range ing.Spec.Rules {
			if rule.Host != "" {
				hosts = append(hosts, rule.Host)
			}
			if rule.HTTP != nil {
				for _, p := range rule.HTTP.Paths {
					if p.Backend.Service != nil && p.Backend.Service.Name != "" {
						backends[p.Backend.Service.Name] = struct{}{}
					}
				}
			}
		}
	}
	bs := make([]string, 0, len(backends))
	for k := range backends {
		bs = append(bs, k)
	}
	sort.Strings(hosts)
	sort.Strings(bs)

	lbips := []string{}
	if ing.Status.LoadBalancer.Ingress != nil {
		for _, i := range ing.Status.LoadBalancer.Ingress {
			if i.IP != "" {
				lbips = append(lbips, i.IP)
			} else if i.Hostname != "" {
				lbips = append(lbips, i.Hostname)
			}
		}
	}
	tlsEnabled := len(ing.Spec.TLS) > 0

	// Basic health heuristic aligned with python spirit [file:1]
	health := 100
	if len(bs) == 0 {
		health -= 40
	}
	if len(lbips) == 0 {
		health -= 20
	}
	if !tlsEnabled && len(hosts) > 0 {
		health -= 10
	}
	if health < 0 {
		health = 0
	}

	return IngressResponse{
		Name:            ing.Name,
		Namespace:       ing.Namespace,
		Hosts:           hosts,
		TLSEnabled:      tlsEnabled,
		BackendServices: bs,
		LoadBalancerIPs: lbips,
		HealthScore:     health,
		StatusEmoji:     emojiForHealth(health),
	}
}

func serviceToResponseNoEndpoints(svc *corev1.Service) ServiceResponse {
	var cip *string
	if svc.Spec.ClusterIP != "" && svc.Spec.ClusterIP != "None" {
		c := svc.Spec.ClusterIP
		cip = &c
	}

	var externalName *string
	if svc.Spec.Type == corev1.ServiceTypeExternalName && svc.Spec.ExternalName != "" {
		en := svc.Spec.ExternalName
		externalName = &en
	}

	var externalIPs []string
	if len(svc.Spec.ExternalIPs) > 0 {
		externalIPs = append(externalIPs, svc.Spec.ExternalIPs...)
	}

	ports := make([]ServicePort, 0, len(svc.Spec.Ports))
	for _, p := range svc.Spec.Ports {
		ports = append(ports, ServicePort{
			Name:       p.Name,
			Protocol:   string(p.Protocol),
			Port:       p.Port,
			TargetPort: p.TargetPort.String(),
			NodePort:   p.NodePort,
		})
	}
	selector := map[string]string{}
	for k, v := range svc.Spec.Selector {
		selector[k] = v
	}

	health := 100
	// ExternalName services don't have selectors or endpoints, but that's expected
	if svc.Spec.Type == corev1.ServiceTypeExternalName {
		if externalName != nil && *externalName != "" {
			health = 100 // Healthy if external name is configured
		} else {
			health = 0 // Unhealthy if external name is missing
		}
	} else {
		// If selector missing for non-ExternalName services, degrade
		if len(selector) == 0 {
			health -= 20
		}
		if len(ports) == 0 {
			health -= 10
		}
	}
	if health < 0 {
		health = 0
	}

	return ServiceResponse{
		Name:          svc.Name,
		Namespace:     svc.Namespace,
		Type:          string(svc.Spec.Type),
		ClusterIP:     cip,
		ExternalName:  externalName,
		ExternalIPs:   externalIPs,
		Ports:         ports,
		Selector:      selector,
		EndpointCount: 0,
		HealthScore:   health,
		StatusEmoji:   emojiForService(0, health),
	}
}

func serviceToResponse(ctx context.Context, cs *kubernetes.Clientset, svc *corev1.Service) (ServiceResponse, error) {
	resp := serviceToResponseNoEndpoints(svc)

	ep, err := cs.CoreV1().Endpoints(svc.Namespace).Get(ctx, svc.Name, metav1.GetOptions{})
	if err != nil {
		return resp, err
	}
	count := 0
	if ep.Subsets != nil {
		for _, ss := range ep.Subsets {
			count += len(ss.Addresses)
		}
	}
	resp.EndpointCount = count

	// health heuristic: if endpoints=0, it’s critical-ish (matches python feel) [file:8][file:1]
	if count == 0 {
		resp.HealthScore = 0
	} else {
		resp.HealthScore = 100
	}
	resp.StatusEmoji = emojiForService(count, resp.HealthScore)
	return resp, nil
}

func podToResponse(pod *corev1.Pod) PodResponse {
	var ip *string
	if pod.Status.PodIP != "" {
		v := pod.Status.PodIP
		ip = &v
	}
	var node *string
	if pod.Spec.NodeName != "" {
		v := pod.Spec.NodeName
		node = &v
	}

	ready := true
	var restarts int32 = 0
	containers := []string{}
	for _, cs := range pod.Status.ContainerStatuses {
		containers = append(containers, cs.Name)
		restarts += cs.RestartCount
		if !cs.Ready {
			ready = false
		}
	}
	if len(pod.Status.ContainerStatuses) == 0 {
		ready = false
	}

	health := 100
	if pod.Status.Phase != corev1.PodRunning {
		health -= 40
	}
	if !ready {
		health -= 30
	}
	if restarts >= 10 {
		health -= 20
	} else if restarts >= 5 {
		health -= 10
	} else if restarts > 0 {
		health -= 5
	}
	if health < 0 {
		health = 0
	}

	return PodResponse{
		Name:        pod.Name,
		Namespace:   pod.Namespace,
		Phase:       string(pod.Status.Phase),
		IP:          ip,
		Node:        node,
		Ready:       ready,
		Restarts:    restarts,
		Containers:  containers,
		HealthScore: health,
		StatusEmoji: emojiForHealth(health),
	}
}

func deploymentToResponse(dep *appsv1.Deployment) DeploymentResponse {
	desired := int32(0)
	if dep.Spec.Replicas != nil {
		desired = *dep.Spec.Replicas
	}
	ready := dep.Status.ReadyReplicas
	available := dep.Status.AvailableReplicas

	health := 100
	if desired == 0 {
		health = 50
	} else {
		if ready < desired {
			health -= 40
		}
		if available < desired {
			health -= 20
		}
	}
	if health < 0 {
		health = 0
	}

	strategy := "RollingUpdate"
	if dep.Spec.Strategy.Type != "" {
		strategy = string(dep.Spec.Strategy.Type)
	}

	return DeploymentResponse{
		Name:              dep.Name,
		Namespace:         dep.Namespace,
		ReplicasDesired:   desired,
		ReplicasReady:     ready,
		ReplicasAvailable: available,
		StrategyType:      strategy,
		HealthScore:       health,
		StatusEmoji:       emojiForHealth(health),
	}
}

func emojiForHealth(score int) string {
	if score >= 90 {
		return "✅"
	}
	if score >= 60 {
		return "⚠️"
	}
	return "❌"
}

func emojiForService(endpoints int, score int) string {
	if endpoints == 0 {
		return "❌"
	}
	return emojiForHealth(score)
}

// GetHealthDashboard returns comprehensive health metrics for the cluster
func GetHealthDashboard(ctx context.Context, cs *kubernetes.Clientset, namespace string) (HealthResponse, error) {
	resp := HealthResponse{
		PodHealth:        HealthStats{},
		DeploymentHealth: &HealthStats{},
		ServiceHealth:    &ServiceHealthStats{},
	}

	// Get nodes
	nodeList, err := cs.CoreV1().Nodes().List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.Nodes = len(nodeList.Items)
		for _, node := range nodeList.Items {
			status := "NotReady"
			for _, cond := range node.Status.Conditions {
				if cond.Type == corev1.NodeReady && cond.Status == corev1.ConditionTrue {
					status = "Ready"
					break
				}
			}
			cpu := "N/A"
			memory := "N/A"
			if cap := node.Status.Capacity; cap != nil {
				if c, ok := cap[corev1.ResourceCPU]; ok {
					cpu = c.String()
				}
				if m, ok := cap[corev1.ResourceMemory]; ok {
					memory = m.String()
				}
			}
			osInfo := node.Status.NodeInfo.OSImage
			if osInfo == "" {
				osInfo = node.Status.NodeInfo.OperatingSystem
			}

			resp.Nodes = append(resp.Nodes, NodeInfo{
				Name:   node.Name,
				Status: status,
				CPU:    cpu,
				Memory: memory,
				OS:     osInfo,
			})
		}
	}

	// Get ingresses
	ingList, err := cs.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.Ingresses = len(ingList.Items)
	}

	// Get statefulsets
	ssList, err := cs.AppsV1().StatefulSets(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.StatefulSets = len(ssList.Items)
		for _, ss := range ssList.Items {
			desired := int32(1)
			if ss.Spec.Replicas != nil {
				desired = *ss.Spec.Replicas
			}
			if ss.Status.ReadyReplicas >= desired {
				resp.Summary.StatefulSetsReady++
			}
		}
	}

	// Get daemonsets
	dsList, err := cs.AppsV1().DaemonSets(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.DaemonSets = len(dsList.Items)
		for _, ds := range dsList.Items {
			if ds.Status.NumberReady >= ds.Status.DesiredNumberScheduled {
				resp.Summary.DaemonSetsReady++
			}
		}
	}

	// Get jobs
	jobList, err := cs.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.Jobs = len(jobList.Items)
		for _, job := range jobList.Items {
			if job.Status.Succeeded > 0 {
				resp.Summary.JobsSucceeded++
			}
		}
	}

	// Get cronjobs
	cjList, err := cs.BatchV1().CronJobs(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.CronJobs = len(cjList.Items)
		for _, cj := range cjList.Items {
			if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
				resp.Summary.CronJobsSuspended++
			}
		}
	}

	// Get configmaps
	cmList, err := cs.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.ConfigMaps = len(cmList.Items)
	}

	// Get secrets
	secList, err := cs.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.Secrets = len(secList.Items)
	}

	// Get PVCs
	pvcList, err := cs.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.PVCs = len(pvcList.Items)
		for _, pvc := range pvcList.Items {
			if pvc.Status.Phase == corev1.ClaimBound {
				resp.Summary.PVCsBound++
			}
		}
	}

	// Get services
	svcList, err := cs.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.Services = len(svcList.Items)
		for _, svc := range svcList.Items {
			ep, err := cs.CoreV1().Endpoints(svc.Namespace).Get(ctx, svc.Name, metav1.GetOptions{})
			count := 0
			if err == nil && ep.Subsets != nil {
				for _, ss := range ep.Subsets {
					count += len(ss.Addresses)
				}
			}
			if count > 0 {
				resp.ServiceHealth.WithEndpoints++
			} else {
				resp.ServiceHealth.WithoutEndpoints++
			}
		}
	}

	// Get deployments
	depList, err := cs.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.Deployments = len(depList.Items)
		for _, dep := range depList.Items {
			desired := int32(0)
			if dep.Spec.Replicas != nil {
				desired = *dep.Spec.Replicas
			}
			ready := dep.Status.ReadyReplicas
			available := dep.Status.AvailableReplicas

			if desired > 0 && ready == desired && available == desired {
				resp.DeploymentHealth.Healthy++
			} else if ready > 0 {
				resp.DeploymentHealth.Degraded++
			} else {
				resp.DeploymentHealth.Critical++
			}
		}
	}

	// Get pods
	podList, err := cs.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err == nil {
		resp.Summary.Pods = len(podList.Items)
		for _, pod := range podList.Items {
			health := podToResponse(&pod).HealthScore
			if health >= 80 {
				resp.PodHealth.Healthy++
			} else if health >= 40 {
				resp.PodHealth.Degraded++
			} else {
				resp.PodHealth.Critical++
			}
		}
	}

	// Get recent events
	eventList, err := cs.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
		Limit: 50,
	})
	if err == nil {
		for _, event := range eventList.Items {
			resp.ClusterEvents = append(resp.ClusterEvents, ClusterEvent{
				Type:     event.Type,
				Reason:   event.Reason,
				Message:  event.Message,
				Resource: event.InvolvedObject.Kind + "/" + event.InvolvedObject.Name,
				Time:     event.LastTimestamp.Time.Format("2006-01-02 15:04:05"),
				Count:    event.Count,
			})
		}
		// Sort by timestamp, most recent first
		sort.Slice(resp.ClusterEvents, func(i, j int) bool {
			return resp.ClusterEvents[i].Time > resp.ClusterEvents[j].Time
		})
		// Limit to 20 most recent
		if len(resp.ClusterEvents) > 20 {
			resp.ClusterEvents = resp.ClusterEvents[:20]
		}
	}

	// Identify issues
	if resp.PodHealth.Critical > 0 {
		resp.Issues = append(resp.Issues, HealthIssue{
			ResourceName: "Pods",
			Severity:     "critical",
			Message:      fmt.Sprintf("%d pods are in critical state", resp.PodHealth.Critical),
			Emoji:        "🔴",
		})
	}
	if resp.ServiceHealth.WithoutEndpoints > 0 {
		resp.Issues = append(resp.Issues, HealthIssue{
			ResourceName: "Services",
			Severity:     "warning",
			Message:      fmt.Sprintf("%d services have no endpoints", resp.ServiceHealth.WithoutEndpoints),
			Emoji:        "⚠️",
		})
	}
	if resp.DeploymentHealth.Critical > 0 {
		resp.Issues = append(resp.Issues, HealthIssue{
			ResourceName: "Deployments",
			Severity:     "critical",
			Message:      fmt.Sprintf("%d deployments have no ready replicas", resp.DeploymentHealth.Critical),
			Emoji:        "🔴",
		})
	}

	return resp, nil
}

// GetReleases returns deployment version information
func GetReleases(ctx context.Context, cs *kubernetes.Clientset, namespace string) ([]ReleaseResponse, error) {
	depList, err := cs.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	releases := make([]ReleaseResponse, 0, len(depList.Items))
	for _, dep := range depList.Items {
		release := ReleaseResponse{
			DeploymentName: dep.Name,
			Namespace:      dep.Namespace,
			Replicas:       dep.Status.Replicas,
			CreatedAt:      dep.CreationTimestamp.Time.Format("2006-01-02T15:04:05Z"),
		}

		// Get last deployed time - only when image tags changed (actual code deployment)
		var lastDeployedTime *metav1.Time

		// Get all ReplicaSets owned by this deployment
		rsList, err := cs.AppsV1().ReplicaSets(dep.Namespace).List(ctx, metav1.ListOptions{
			LabelSelector: metav1.FormatLabelSelector(dep.Spec.Selector),
		})
		if err == nil && len(rsList.Items) > 0 {
			// Build a map of revision -> ReplicaSet with images
			type rsWithRevision struct {
				revision  int
				rs        appsv1.ReplicaSet
				images    []string
				timestamp metav1.Time
			}

			replicaSets := []rsWithRevision{}

			for _, rs := range rsList.Items {
				// Check if this ReplicaSet is owned by this deployment
				isOwned := false
				for _, owner := range rs.OwnerReferences {
					if owner.UID == dep.UID {
						isOwned = true
						break
					}
				}

				if !isOwned {
					continue
				}

				// Get revision number from annotation
				if revisionStr, ok := rs.Annotations["deployment.kubernetes.io/revision"]; ok {
					revision := 0
					if _, err := fmt.Sscanf(revisionStr, "%d", &revision); err == nil {
						// Extract images from this ReplicaSet
						images := []string{}
						for _, container := range rs.Spec.Template.Spec.Containers {
							images = append(images, container.Image)
						}

						replicaSets = append(replicaSets, rsWithRevision{
							revision:  revision,
							rs:        rs,
							images:    images,
							timestamp: rs.CreationTimestamp,
						})
					}
				}
			}

			// Sort by revision number (descending - newest first)
			sort.Slice(replicaSets, func(i, j int) bool {
				return replicaSets[i].revision > replicaSets[j].revision
			})

			// Find the most recent revision where images changed
			if len(replicaSets) > 0 {
				// Start with the current (highest) revision
				lastDeployedTime = &replicaSets[0].timestamp

				// Look backwards to find when images last changed
				for i := 0; i < len(replicaSets)-1; i++ {
					currentImages := replicaSets[i].images
					previousImages := replicaSets[i+1].images

					// Check if images are different
					imagesChanged := false
					if len(currentImages) != len(previousImages) {
						imagesChanged = true
					} else {
						for j := range currentImages {
							if currentImages[j] != previousImages[j] {
								imagesChanged = true
								break
							}
						}
					}

					// If images changed, this is when we last deployed
					if imagesChanged {
						lastDeployedTime = &replicaSets[i].timestamp
						break
					}
				}
			}
		}

		if lastDeployedTime != nil {
			release.LastDeployed = lastDeployedTime.Time.Format("2006-01-02T15:04:05Z")
		} else {
			release.LastDeployed = release.CreatedAt
		}

		// Extract labels
		if appName, ok := dep.Labels["app"]; ok {
			release.AppName = appName
		} else if appName, ok := dep.Labels["app.kubernetes.io/name"]; ok {
			release.AppName = appName
		}

		if instance, ok := dep.Labels["app.kubernetes.io/instance"]; ok {
			release.Instance = instance
		}

		// Extract image tags and use main container tag as version
		imageTags := []string{}
		if dep.Spec.Template.Spec.Containers != nil {
			for idx, container := range dep.Spec.Template.Spec.Containers {
				if container.Image != "" {
					// Extract tag from image
					parts := splitLast(container.Image, ":")
					var tag string
					if len(parts) == 2 {
						tag = parts[1]
					} else {
						tag = "latest"
					}
					imageTags = append(imageTags, tag)
					// Use first container's image tag as version
					if idx == 0 && tag != "latest" {
						release.Version = tag
					}
				}
			}
		}
		release.ImageTags = imageTags

		releases = append(releases, release)
	}

	sort.Slice(releases, func(i, j int) bool {
		return releases[i].DeploymentName < releases[j].DeploymentName
	})

	return releases, nil
}

func splitLast(s, sep string) []string {
	idx := -1
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == sep[0] {
			idx = i
			break
		}
	}
	if idx == -1 {
		return []string{s}
	}
	return []string{s[:idx], s[idx+1:]}
}

// GetDeploymentHistory returns revision history for a deployment by querying ReplicaSets
func GetDeploymentHistory(ctx context.Context, cs *kubernetes.Clientset, namespace, deploymentName string) ([]DeploymentRevision, error) {
	// Get the deployment
	deployment, err := cs.AppsV1().Deployments(namespace).Get(ctx, deploymentName, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}

	// Get all ReplicaSets owned by this deployment
	rsList, err := cs.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{
		LabelSelector: metav1.FormatLabelSelector(deployment.Spec.Selector),
	})
	if err != nil {
		return nil, err
	}

	revisions := []DeploymentRevision{}

	// Process each ReplicaSet
	for _, rs := range rsList.Items {
		// Check if this ReplicaSet is owned by this deployment
		isOwned := false
		for _, owner := range rs.OwnerReferences {
			if owner.UID == deployment.UID && owner.Kind == "Deployment" {
				isOwned = true
				break
			}
		}

		if !isOwned {
			continue
		}

		// Extract revision number from annotations
		revisionStr, ok := rs.Annotations["deployment.kubernetes.io/revision"]
		if !ok {
			continue
		}

		revision := 0
		if _, err := fmt.Sscanf(revisionStr, "%d", &revision); err != nil {
			continue
		}

		// Extract images from containers
		images := []string{}
		if rs.Spec.Template.Spec.Containers != nil {
			for _, container := range rs.Spec.Template.Spec.Containers {
				images = append(images, container.Image)
			}
		}

		// Extract replicas (use desired replicas from spec)
		replicas := int32(0)
		if rs.Spec.Replicas != nil {
			replicas = *rs.Spec.Replicas
		}

		// Get reason for change from annotations if available
		reason := ""
		if changeReason, ok := rs.Annotations["kubernetes.io/change-cause"]; ok {
			reason = changeReason
		}

		revisions = append(revisions, DeploymentRevision{
			Revision:  revision,
			CreatedAt: rs.CreationTimestamp.Time.Format("2006-01-02T15:04:05Z"),
			Images:    images,
			Replicas:  replicas,
			Reason:    reason,
		})
	}

	// Sort by revision number (descending - newest first)
	sort.Slice(revisions, func(i, j int) bool {
		return revisions[i].Revision > revisions[j].Revision
	})

	// Limit to last 10 revisions
	if len(revisions) > 10 {
		revisions = revisions[:10]
	}

	return revisions, nil
}
