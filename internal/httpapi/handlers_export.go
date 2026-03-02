package httpapi

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ajna/internal/app"
	"ajna/internal/k8s"

	"github.com/gorilla/mux"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	apiextensionsclientset "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset"
)

// Supported resource types for export
var exportResourceTypes = map[string]bool{
	"pods":        true,
	"services":    true,
	"deployments": true,
	"ingresses":   true,
	"configmaps":  true,
	"secrets":     true,
	"resources":   true,
	"pvpvc":       true,
	"crds":        true,
	"health":      true,
}

func getExport(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		resourceType := strings.ToLower(vars["resource_type"])
		namespace := vars["namespace"]
		format := strings.ToLower(r.URL.Query().Get("format"))

		if format == "" {
			format = "json"
		}
		if format != "csv" && format != "json" {
			http.Error(w, "format must be csv or json", http.StatusBadRequest)
			return
		}

		// CRDs are cluster-scoped; others need namespace (use "all" for cluster-wide where applicable)
		if resourceType != "crds" && namespace == "" {
			namespace = "default"
		}

		if !exportResourceTypes[resourceType] {
			http.Error(w, fmt.Sprintf("unsupported resource type: %s", resourceType), http.StatusBadRequest)
			return
		}

		ctx := r.Context()
		var data interface{}
		var err error

		switch resourceType {
		case "pods":
			data, err = fetchPodsForExport(application, ctx, namespace)
		case "services":
			data, err = fetchServicesForExport(application, ctx, namespace)
		case "deployments":
			data, err = fetchDeploymentsForExport(application, ctx, namespace)
		case "ingresses":
			data, err = fetchIngressesForExport(application, ctx, namespace)
		case "configmaps":
			data, err = fetchConfigMapsForExport(application, ctx, namespace)
		case "secrets":
			data, err = fetchSecretsForExport(application, ctx, namespace)
		case "resources":
			data, err = fetchResourcesForExport(application, ctx, namespace)
		case "pvpvc":
			data, err = fetchPVPVCForExport(application, ctx, namespace)
		case "crds":
			data, err = fetchCRDsForExport(application, ctx)
		case "health":
			data, err = fetchHealthForExport(application, ctx, namespace)
		default:
			http.Error(w, "unsupported resource type", http.StatusBadRequest)
			return
		}

		if err != nil {
			application.Logger.Error("Export fetch failed", "type", resourceType, "error", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		filename := fmt.Sprintf("ajna-%s-%s-%s.%s", resourceType, namespace, time.Now().Format("20060102-150405"), format)
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))

		if format == "csv" {
			w.Header().Set("Content-Type", "text/csv; charset=utf-8")
			if err := writeCSV(w, data, resourceType); err != nil {
				application.Logger.Error("CSV export failed", "error", err)
				http.Error(w, "failed to generate CSV", http.StatusInternalServerError)
			}
		} else {
			w.Header().Set("Content-Type", "application/json")
			enc := json.NewEncoder(w)
			enc.SetIndent("", "  ")
			enc.Encode(data)
		}
	}
}

func fetchPodsForExport(app *app.App, ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("pods:%s", namespace)
	if cached, ok := app.Cache.Get(cacheKey); ok {
		return cached.([]map[string]interface{}), nil
	}

	pods, err := app.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(pods.Items))
	for _, pod := range pods.Items {
		restarts := int32(0)
		readyCount := 0
		for _, status := range pod.Status.ContainerStatuses {
			restarts += status.RestartCount
			if status.Ready {
				readyCount++
			}
		}
		age := time.Since(pod.CreationTimestamp.Time)
		result = append(result, map[string]interface{}{
			"name":             pod.Name,
			"namespace":       pod.Namespace,
			"status":          string(pod.Status.Phase),
			"ready":           fmt.Sprintf("%d/%d", readyCount, len(pod.Spec.Containers)),
			"restart_count":   restarts,
			"age":             formatAge(age),
			"ip":              pod.Status.PodIP,
			"node":            pod.Spec.NodeName,
			"health_score":    calculatePodHealth(&pod),
			"status_emoji":    getPodStatusEmoji(&pod),
		})
	}
	return result, nil
}

func fetchServicesForExport(app *app.App, ctx context.Context, namespace string) (interface{}, error) {
	services, err := k8s.ListServices(ctx, app.K8sClient.Clientset, namespace)
	if err != nil {
		return nil, err
	}
	return services, nil
}

func fetchDeploymentsForExport(app *app.App, ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("deployments:%s", namespace)
	if cached, ok := app.Cache.Get(cacheKey); ok {
		return cached.([]map[string]interface{}), nil
	}

	deployments, err := app.K8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(deployments.Items))
	for _, dep := range deployments.Items {
		images := []string{}
		for _, c := range dep.Spec.Template.Spec.Containers {
			images = append(images, c.Image)
		}
		desired := int32(0)
		if dep.Spec.Replicas != nil {
			desired = *dep.Spec.Replicas
		}
		result = append(result, map[string]interface{}{
			"name":               dep.Name,
			"namespace":         dep.Namespace,
			"desired_replicas":   desired,
			"ready_replicas":    dep.Status.ReadyReplicas,
			"images":             strings.Join(images, "; "),
			"health_score":      calculateDeploymentHealth(&dep),
			"status_emoji":      getDeploymentStatusEmoji(&dep),
		})
	}
	return result, nil
}

func fetchIngressesForExport(app *app.App, ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	ingresses, err := app.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(ingresses.Items))
	for _, ing := range ingresses.Items {
		hosts := []string{}
		for _, rule := range ing.Spec.Rules {
			if rule.Host != "" {
				hosts = append(hosts, rule.Host)
			}
		}
		lbIPs := []string{}
		for _, lb := range ing.Status.LoadBalancer.Ingress {
			if lb.IP != "" {
				lbIPs = append(lbIPs, lb.IP)
			}
			if lb.Hostname != "" {
				lbIPs = append(lbIPs, lb.Hostname)
			}
		}
		result = append(result, map[string]interface{}{
			"name":              ing.Name,
			"namespace":         ing.Namespace,
			"hosts":             strings.Join(hosts, "; "),
			"tls_enabled":       len(ing.Spec.TLS) > 0,
			"loadbalancer_ips":  strings.Join(lbIPs, "; "),
		})
	}
	return result, nil
}

func fetchConfigMapsForExport(app *app.App, ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	cms, err := app.K8sClient.Clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(cms.Items))
	for _, cm := range cms.Items {
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
			"key_count": len(keys),
			"keys":      strings.Join(keys, "; "),
			"age":       formatAge(time.Since(cm.CreationTimestamp.Time)),
		})
	}
	return result, nil
}

func fetchSecretsForExport(app *app.App, ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	secrets, err := app.K8sClient.Clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(secrets.Items))
	for _, s := range secrets.Items {
		keys := []string{}
		for k := range s.Data {
			keys = append(keys, k)
		}
		result = append(result, map[string]interface{}{
			"name":      s.Name,
			"namespace": s.Namespace,
			"type":      string(s.Type),
			"key_count": len(keys),
			"keys":      strings.Join(keys, "; "),
			"age":       formatAge(time.Since(s.CreationTimestamp.Time)),
		})
	}
	return result, nil
}

func fetchResourcesForExport(app *app.App, ctx context.Context, namespace string) (map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("resources:%s:all:false", namespace)
	if cached, ok := app.Cache.Get(cacheKey); ok {
		return cached.(map[string]interface{}), nil
	}

	// Build minimal resources list via getAllResources logic
	resources := []map[string]interface{}{}
	pods, _ := app.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	for _, pod := range pods.Items {
		resources = append(resources, map[string]interface{}{
			"name": pod.Name, "namespace": pod.Namespace, "resource_type": "Pod",
			"status": string(pod.Status.Phase), "health_score": calculatePodHealth(&pod),
		})
	}
	deps, _ := app.K8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	for _, d := range deps.Items {
		resources = append(resources, map[string]interface{}{
			"name": d.Name, "namespace": d.Namespace, "resource_type": "Deployment",
			"status": getDeploymentStatus(&d), "health_score": calculateDeploymentHealth(&d),
		})
	}
	svcs, _ := app.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	for _, s := range svcs.Items {
		resources = append(resources, map[string]interface{}{
			"name": s.Name, "namespace": s.Namespace, "resource_type": "Service",
			"status": "Active", "health_score": 100,
		})
	}
	ings, _ := app.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})
	for _, i := range ings.Items {
		resources = append(resources, map[string]interface{}{
			"name": i.Name, "namespace": i.Namespace, "resource_type": "Ingress",
			"status": "Active", "health_score": 100,
		})
	}

	return map[string]interface{}{
		"namespace": namespace,
		"resources": resources,
		"total":     len(resources),
	}, nil
}

func fetchPVPVCForExport(app *app.App, ctx context.Context, namespace string) (map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("pvpvc:%s", namespace)
	if cached, ok := app.Cache.Get(cacheKey); ok {
		return cached.(map[string]interface{}), nil
	}

	pvcList, err := app.K8sClient.Clientset.CoreV1().PersistentVolumeClaims(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	pvcs := make([]map[string]interface{}, 0, len(pvcList.Items))
	for _, pvc := range pvcList.Items {
		sc := ""
		if pvc.Spec.StorageClassName != nil {
			sc = *pvc.Spec.StorageClassName
		}
		req := ""
		if s, ok := pvc.Spec.Resources.Requests["storage"]; ok {
			req = s.String()
		}
		pvcs = append(pvcs, map[string]interface{}{
			"name":              pvc.Name,
			"namespace":        pvc.Namespace,
			"status":           string(pvc.Status.Phase),
			"storage_class":    sc,
			"requested":        req,
			"volume_name":      pvc.Spec.VolumeName,
		})
	}
	return map[string]interface{}{
		"namespace": namespace,
		"pvcs":      pvcs,
		"total":     len(pvcs),
	}, nil
}

func fetchCRDsForExport(app *app.App, ctx context.Context) ([]map[string]interface{}, error) {
	cacheKey := "crds:cluster"
	if cached, ok := app.Cache.Get(cacheKey); ok {
		return cached.([]map[string]interface{}), nil
	}

	apiExt, err := apiextensionsclientset.NewForConfig(app.K8sClient.Config)
	if err != nil {
		return nil, err
	}
	crds, err := apiExt.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}

	result := make([]map[string]interface{}, 0, len(crds.Items))
	for _, crd := range crds.Items {
		versions := []string{}
		for _, v := range crd.Spec.Versions {
			versions = append(versions, v.Name)
		}
		result = append(result, map[string]interface{}{
			"name":     crd.Name,
			"group":    crd.Spec.Group,
			"kind":     crd.Spec.Names.Kind,
			"plural":   crd.Spec.Names.Plural,
			"scope":    string(crd.Spec.Scope),
			"versions": strings.Join(versions, "; "),
		})
	}
	return result, nil
}

func fetchHealthForExport(app *app.App, ctx context.Context, namespace string) (map[string]interface{}, error) {
	cacheKey := fmt.Sprintf("health:%s", namespace)
	if cached, ok := app.Cache.Get(cacheKey); ok {
		return cached.(map[string]interface{}), nil
	}
	// Trigger a health fetch by calling getHealth logic - we need the response
	// Simpler: make a minimal fetch for export
	pods, _ := app.K8sClient.Clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{})
	deps, _ := app.K8sClient.Clientset.AppsV1().Deployments(namespace).List(ctx, metav1.ListOptions{})
	svcs, _ := app.K8sClient.Clientset.CoreV1().Services(namespace).List(ctx, metav1.ListOptions{})
	ings, _ := app.K8sClient.Clientset.NetworkingV1().Ingresses(namespace).List(ctx, metav1.ListOptions{})

	healthyPods, degradedPods, criticalPods := 0, 0, 0
	for _, pod := range pods.Items {
		h := calculatePodHealth(&pod)
		if h >= 80 {
			healthyPods++
		} else if h >= 60 {
			degradedPods++
		} else {
			criticalPods++
		}
	}

	healthyDeps, degradedDeps, criticalDeps := 0, 0, 0
	for _, dep := range deps.Items {
		h := calculateDeploymentHealth(&dep)
		if h >= 80 {
			healthyDeps++
		} else if h >= 60 {
			degradedDeps++
		} else {
			criticalDeps++
		}
	}

	return map[string]interface{}{
		"summary": map[string]interface{}{
			"pods":        len(pods.Items),
			"deployments": len(deps.Items),
			"services":    len(svcs.Items),
			"ingresses":   len(ings.Items),
		},
		"pod_health":        map[string]int{"healthy": healthyPods, "degraded": degradedPods, "critical": criticalPods},
		"deployment_health": map[string]int{"healthy": healthyDeps, "degraded": degradedDeps, "critical": criticalDeps},
		// Flattened for CSV export
		"health_rows": []map[string]interface{}{
			{
				"metric": "summary",
				"pods":   len(pods.Items),
				"deployments": len(deps.Items),
				"services":    len(svcs.Items),
				"ingresses":   len(ings.Items),
			},
			{
				"metric": "pod_health",
				"healthy": healthyPods,
				"degraded": degradedPods,
				"critical": criticalPods,
			},
			{
				"metric": "deployment_health",
				"healthy": healthyDeps,
				"degraded": degradedDeps,
				"critical": criticalDeps,
			},
		},
	}, nil
}

func writeCSV(w http.ResponseWriter, data interface{}, resourceType string) error {
	writer := csv.NewWriter(w)
	defer writer.Flush()

	switch v := data.(type) {
	case []map[string]interface{}:
		return writeMapsToCSV(writer, v)
	case []k8s.ServiceResponse:
		return writeServicesToCSV(writer, v)
	case map[string]interface{}:
		return writeMapToCSV(writer, v, resourceType)
	default:
		return fmt.Errorf("unsupported data type for CSV")
	}
}

func writeMapsToCSV(w *csv.Writer, rows []map[string]interface{}) error {
	if len(rows) == 0 {
		return nil
	}
	headers := []string{}
	seen := make(map[string]bool)
	for _, row := range rows {
		for k := range row {
			if !seen[k] {
				seen[k] = true
				headers = append(headers, k)
			}
		}
	}
	if err := w.Write(headers); err != nil {
		return err
	}
	for _, row := range rows {
		vals := make([]string, len(headers))
		for i, h := range headers {
			vals[i] = formatCSVValue(row[h])
		}
		if err := w.Write(vals); err != nil {
			return err
		}
	}
	return nil
}

func writeServicesToCSV(w *csv.Writer, rows []k8s.ServiceResponse) error {
	headers := []string{"name", "namespace", "type", "cluster_ip", "external_name", "endpoint_count", "health_score", "status_emoji"}
	if err := w.Write(headers); err != nil {
		return err
	}
	for _, row := range rows {
		clusterIP := ""
		if row.ClusterIP != nil {
			clusterIP = *row.ClusterIP
		}
		extName := ""
		if row.ExternalName != nil {
			extName = *row.ExternalName
		}
		if err := w.Write([]string{
			row.Name, row.Namespace, row.Type, clusterIP, extName,
			strconv.Itoa(row.EndpointCount), strconv.Itoa(row.HealthScore), row.StatusEmoji,
		}); err != nil {
			return err
		}
	}
	return nil
}

func writeMapToCSV(w *csv.Writer, m map[string]interface{}, resourceType string) error {
	if resources, ok := m["resources"].([]map[string]interface{}); ok {
		return writeMapsToCSV(w, resources)
	}
	if pvcs, ok := m["pvcs"].([]map[string]interface{}); ok {
		return writeMapsToCSV(w, pvcs)
	}
	if rows, ok := m["health_rows"].([]map[string]interface{}); ok {
		return writeMapsToCSV(w, rows)
	}
	// Fallback: single row with flattened keys
	return writeMapsToCSV(w, []map[string]interface{}{m})
}

func formatCSVValue(v interface{}) string {
	if v == nil {
		return ""
	}
	switch val := v.(type) {
	case string:
		// Escape quotes for CSV
		if strings.Contains(val, `"`) || strings.Contains(val, ",") || strings.Contains(val, "\n") {
			return `"` + strings.ReplaceAll(val, `"`, `""`) + `"`
		}
		return val
	case int:
		return strconv.Itoa(val)
	case int32:
		return strconv.FormatInt(int64(val), 10)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(val)
	case []string:
		return strings.Join(val, "; ")
	default:
		return fmt.Sprintf("%v", v)
	}
}
