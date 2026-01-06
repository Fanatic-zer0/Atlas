package k8s

type ClusterInfo struct {
	ClusterName string   `json:"cluster_name"`
	ContextName string   `json:"context_name"`
	Connected   bool     `json:"connected"`
	Namespaces  []string `json:"namespaces"`
}

// Matches fields used by UI tables in get_html_page() [file:1]
type IngressResponse struct {
	Name            string   `json:"name"`
	Namespace       string   `json:"namespace"`
	Hosts           []string `json:"hosts"`
	TLSEnabled      bool     `json:"tls_enabled"`
	BackendServices []string `json:"backend_services"`
	LoadBalancerIPs []string `json:"loadbalancer_ips"`
	HealthScore     int      `json:"health_score"`
	StatusEmoji     string   `json:"status_emoji"`
}

type KubeMeta struct {
    Mode        string // "kubeconfig" or "incluster"
    ContextName string
    ClusterName string
}

type ServicePort struct {
	Name       string `json:"name,omitempty"`
	Protocol   string `json:"protocol,omitempty"`
	Port       int32  `json:"port"`
	TargetPort string `json:"target_port,omitempty"`
	NodePort   int32  `json:"node_port,omitempty"`
}

type ServiceResponse struct {
	Name          string            `json:"name"`
	Namespace     string            `json:"namespace"`
	Type          string            `json:"type"`
	ClusterIP     *string           `json:"cluster_ip"`
	Ports         []ServicePort     `json:"ports"`
	Selector      map[string]string `json:"selector"`
	EndpointCount int               `json:"endpoint_count"`
	HealthScore   int               `json:"health_score"`
	StatusEmoji   string            `json:"status_emoji"`
}

type PodResponse struct {
	Name        string   `json:"name"`
	Namespace   string   `json:"namespace"`
	Phase       string   `json:"phase"`
	IP          *string  `json:"ip"`
	Node        *string  `json:"node"`
	Ready       bool     `json:"ready"`
	Restarts    int32    `json:"restarts"`
	Containers  []string `json:"containers"`
	HealthScore int      `json:"health_score"`
	StatusEmoji string   `json:"status_emoji"`
}

type DeploymentResponse struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	ReplicasDesired   int32  `json:"replicas_desired"`
	ReplicasReady     int32  `json:"replicas_ready"`
	ReplicasAvailable int32  `json:"replicas_available"`
	StrategyType      string `json:"strategy_type"`
	HealthScore       int    `json:"health_score"`
	StatusEmoji       string `json:"status_emoji"`
}

// Health Dashboard Types
type HealthResponse struct {
	Summary          HealthSummary       `json:"summary"`
	Nodes            []NodeInfo          `json:"nodes,omitempty"`
	PodHealth        HealthStats         `json:"pod_health"`
	DeploymentHealth *HealthStats        `json:"deployment_health,omitempty"`
	ServiceHealth    *ServiceHealthStats `json:"service_health,omitempty"`
	ClusterEvents    []ClusterEvent      `json:"cluster_events,omitempty"`
	Issues           []HealthIssue       `json:"issues,omitempty"`
}

type HealthSummary struct {
	Nodes       int `json:"nodes"`
	Ingresses   int `json:"ingresses"`
	Services    int `json:"services"`
	Deployments int `json:"deployments"`
	Pods        int `json:"pods"`
}

type NodeInfo struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	CPU    string `json:"cpu"`
	Memory string `json:"memory"`
	OS     string `json:"os"`
}

type HealthStats struct {
	Healthy  int `json:"healthy"`
	Degraded int `json:"degraded"`
	Critical int `json:"critical"`
}

type ServiceHealthStats struct {
	WithEndpoints    int `json:"with_endpoints"`
	WithoutEndpoints int `json:"without_endpoints"`
}

type ClusterEvent struct {
	Type     string `json:"type"`
	Reason   string `json:"reason"`
	Message  string `json:"message"`
	Resource string `json:"resource"`
	Time     string `json:"time"`
	Count    int32  `json:"count"`
}

type HealthIssue struct {
	ResourceName string `json:"resource_name"`
	Severity     string `json:"severity"`
	Message      string `json:"message"`
	Emoji        string `json:"emoji"`
}

// Release Types
type ReleaseResponse struct {
	DeploymentName string       `json:"deployment_name"`
	Namespace      string       `json:"namespace"`
	AppName        string       `json:"app_name,omitempty"`
	Version        string       `json:"version,omitempty"`
	Instance       string       `json:"instance,omitempty"`
	Replicas       int32        `json:"replicas"`
	CreatedAt      string       `json:"created_at"`
	ImageTags      []string     `json:"image_tags,omitempty"`
	HelmRelease    *HelmRelease `json:"helm_release,omitempty"`
}

type HelmRelease struct {
	Name         string `json:"name"`
	Chart        string `json:"chart"`
	ChartVersion string `json:"chart_version"`
	AppVersion   string `json:"app_version"`
	Status       string `json:"status"`
	Revision     int    `json:"revision"`
	Updated      string `json:"updated"`
	Description  string `json:"description,omitempty"`
}

// Resource Viewer Types
type ResourceListResponse struct {
	Resources []ResourceSummary `json:"resources"`
	Total     int               `json:"total"`
	Cached    bool              `json:"cached"`
	FetchTime string            `json:"fetch_time,omitempty"`
}

type ResourceSummary struct {
	ResourceType string `json:"resource_type"`
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Status       string `json:"status"`
	HealthScore  int    `json:"health_score"`
}

type ResourceDetail struct {
	ResourceType  string                 `json:"resource_type"`
	Name          string                 `json:"name"`
	Namespace     string                 `json:"namespace"`
	Status        string                 `json:"status"`
	HealthScore   int                    `json:"health_score"`
	Details       map[string]interface{} `json:"details"`
	Relationships []ResourceRelationship `json:"relationships,omitempty"`
}

type ResourceRelationship struct {
	RelationshipType string                 `json:"relationship_type"`
	ResourceType     string                 `json:"resource_type"`
	ResourceName     string                 `json:"resource_name"`
	Details          map[string]interface{} `json:"details,omitempty"`
}
