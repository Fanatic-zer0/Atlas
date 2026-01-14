# Ajna - Kubernetes Cluster Dashboard

**Ajna** (Sanskrit: अज्ञ, meaning "perception" or "third eye") is a fast, lightweight, read-only Kubernetes cluster monitoring and visualization tool. It provides SREs and developers with instant visibility into cluster health, resources, relationships, and deployment status through a beautiful web interface.

![Go Version](https://img.shields.io/badge/Go-1.21-00ADD8?logo=go)
![Kubernetes](https://img.shields.io/badge/Kubernetes-0.28-326CE5?logo=kubernetes)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ Features

### 🔍 **Read-Only Cluster Monitoring**
- **Safe by Design**: Zero write operations - pure observation mode
- No risk of accidental cluster modifications
- Perfect for read-only RBAC configurations

### 🚀 **High Performance - Optimized for 50+ Concurrent Users**
- **ResourceVersion Change Detection**: 50-70% reduction in K8s API calls
- **Concurrent API Fetching**: Parallel goroutines reduce response time by 3-6x
- **Intelligent Caching**: 30-second cache with ResourceVersion tracking
- **Connection Pool Tuning**: 200 max idle connections, 50 QPS, 100 burst
- **HTTP Server Timeouts**: Production-ready with proper read/write timeouts
- **Auto Cache Cleanup**: Periodic cleanup prevents memory leaks
- **Near-Instant Responses**: <10ms for cached resources with unchanged ResourceVersion

### 📊 **Comprehensive Resource Monitoring**
- **Resource Viewer**: Unified view of all cluster resources with relationship mapping
  - Pods, Deployments, Services, Ingresses
  - StatefulSets, DaemonSets
  - Jobs, CronJobs
  - PersistentVolumes & PersistentVolumeClaims
  - ConfigMaps & Secrets
- **Relationship Tracking**: Click any resource to see dependencies and connections
  - Which pods use which ConfigMaps/Secrets
  - Which services expose which pods
  - Which ingresses route to which services
  - PVC to Pod mappings
  - Deployment to Pod relationships
- **Resource Type Filtering**: Filter by specific resource types
- **Search Functionality**: Quick search across all resources

### 🌐 **Enhanced Ingress Monitoring**
- **LoadBalancer IPs**: Display external IPs and hostnames
- **Kong Plugin Detection**: Automatically extract Kong plugins from annotations
- **Rules & Backends**: Detailed routing rules with:
  - Host-based routing with TLS indicators
  - Path patterns (including regex)
  - Backend service and port mappings
  - Clickable links to test endpoints
  - Path type indicators (Exact, Prefix, ImplementationSpecific)

### 💾 **Storage Monitoring (PV/PVC)**
- **Volume Type Detection**: 13+ volume types supported
  - HostPath, NFS, CSI, AWS EBS, GCE PD
  - Azure Disk/File, iSCSI, Glusterfs
  - CephFS, FC, Local
- **Pod Usage Tracking**: See which pods use each PVC with:
  - Pod status and health
  - Node assignment
  - Restart counts
  - Age information
- **Volume Mode & Node Affinity**: Display advanced volume configurations
- **Unbound PV Tracking**: Identify unused persistent volumes

### 🎨 **Modern UI**
- Beautiful gradient-based Ayu Dark theme
- Real-time status indicators with emojis (🟢 🟡 🔴)
- Health score visualization
- Namespace switching
- Collapsible sections for clean layout
- Responsive design
- Color-coded resource cards

### 🔧 **Network Diagnostics**
- Built-in connectivity testing (within-cluster)
- DNS resolution tests
- TCP port connectivity checks
- HTTP/HTTPS endpoint validation

## 🏗️ Architecture

```
ajna/
├── cmd/
│   └── ajna/           # Main application entry point
├── internal/
│   ├── app/            # Application core, caching with ResourceVersion
│   ├── httpapi/        # HTTP handlers, routes, relationships
│   ├── k8s/            # Kubernetes client (QPS tuning, connection pool)
│   └── network/        # Network diagnostic tools
├── ui/
│   └── index.html      # Single-page web interface (Ayu Dark theme)
├── test_load.go        # Load testing utility
├── PERFORMANCE_ANALYSIS.md  # Detailed performance analysis
└── Makefile
```

## 🚀 Quick Start

### Prerequisites

- Go 1.21 or higher
- Access to a Kubernetes cluster
- `kubectl` configured with valid kubeconfig

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ajna.git
cd ajna

# Install dependencies
make deps

# Build the application
make build
```

### Running Ajna

#### Local Development

```bash
# Run directly with Go
make run

# Or build and run the binary
make start
```

#### Production Deployment

```bash
# Build the binary
make build

# Run the binary
./bin/ajna
```

The server will start on port `8080` by default. Access the dashboard at `http://localhost:8080`

### Configuration

#### Environment Variables

**Server Configuration:**
- `PORT`: Server port (default: `8080`)
- `KUBECONFIG`: Path to kubeconfig file (default: `~/.kube/config`)

**Example:**
```bash
PORT=8080 ./ajna
```

#### Kubernetes Access

Ajna automatically detects your Kubernetes configuration:
1. **Local Development**: Uses `~/.kube/config`
2. **In-Cluster**: Uses service account when running as a pod
3. **Custom Path**: Set `KUBECONFIG` environment variable

#### Performance Tuning

Ajna is pre-configured for 50+ concurrent users with:
- **QPS**: 50 queries per second
- **Burst**: 100 for spike traffic
- **Connection Pool**: 200 max idle connections, 50 per host
- **HTTP Timeouts**: 15s read/write, 120s idle
- **Cache TTL**: 30 seconds with ResourceVersion tracking

## 📡 API Endpoints

### Cluster Information
- `GET /api/cluster` - Get cluster information

### Resource Viewer
- `GET /api/resources/{namespace}` - List all resources (with caching)
  - Query params: `resource_type` (Pod, Deployment, Service, Ingress, StatefulSet, DaemonSet, Job, CronJob, etc.)
  - Query params: `lightweight=true` for faster responses
  - Response includes: `resources`, `total`, `cached`, `fetch_time`, `version` (ResourceVersion)
- `GET /api/resource/{type}/{namespace}/{name}` - Get resource details with relationships

### Resource-Specific Endpoints
- `GET /api/ingresses/{namespace}` - List ingresses with Kong plugins and rules
- `GET /api/services/{namespace}` - List services
- `GET /api/pods/{namespace}` - List pods
- `GET /api/deployments/{namespace}` - List deployments
- `GET /api/configmaps/{namespace}` - List ConfigMaps
- `GET /api/secrets/{namespace}` - List secrets (metadata only)
- `GET /api/pvpvc/{namespace}` - List PVs and PVCs with pod usage

### Health & Monitoring
- `GET /api/health/{namespace}` - Cluster health dashboard
- `GET /api/releases/{namespace}` - Deployment release information

### Network Diagnostics
- `POST /api/network/test` - Test DNS or TCP connectivity
  - Body: `{"hostname": "example.com", "test_type": "dns|tcp|http|https"}`

### Cache Management
- `GET /api/cache/stats` - Get cache statistics
- `POST /api/cache/clear` - Clear cache

## � UI Tabs & Features

### 🔍 Resource Viewer
- **Unified Resource View**: All Kubernetes resources in one place
- **Type Filtering**: Filter by Pod, Deployment, Service, Ingress, StatefulSet, DaemonSet, Job, CronJob
- **Search**: Quick search by resource name
- **Relationship Explorer**: Click any resource to see:
  - Dependencies (ConfigMaps, Secrets, PVCs)
  - Connections (Services, Ingresses, Pods)
  - Health and status
  - Detailed configuration
- **Performance**: Shows cache status and fetch time

### 🌐 Ingresses
- **LoadBalancer Information**: External IPs and hostnames
- **Kong Plugin Detection**: Auto-extracted from annotations
- **Routing Rules**: Detailed host-based routing with:
  - TLS indicators
  - Path patterns (including regex)
  - Backend services with ports
  - Clickable endpoint links
  - Path type badges

### 🔗 Services
- **Service Types**: ClusterIP, NodePort, LoadBalancer, ExternalName
- **Endpoint Health**: Number of ready endpoints
- **Port Mappings**: Detailed port configurations with target ports
- **Selectors**: Pod selector labels
- **Health Scores**: Visual health indicators

### 💾 Pods
- **Status Monitoring**: Running, Pending, Failed, Succeeded
- **Container Health**: Ready/Total containers
- **Resource Usage**: CPU and memory requests/limits
- **Restart Tracking**: Container restart counts
- **Node Assignment**: Which node the pod runs on

### 🚀 Deployments
- **Replica Status**: Desired vs Ready vs Available
- **Container Images**: All container images in use
- **Resource Allocation**: CPU and memory per container
- **Health Scores**: Deployment health percentage
- **Update Strategy**: RollingUpdate or Recreate

### ⚙️ ConfigMaps & Secrets
- **Key Listings**: All keys in the resource
- **Key Count**: Number of configuration entries
- **Creation Time**: Resource age
- **Usage Tracking**: See which pods use them (via Resource Viewer)

### 🗄️ PV/PVC
- **Volume Types**: NFS, iSCSI, CSI, Cloud (AWS/GCE/Azure), Local, HostPath
- **Capacity**: Storage size
- **Access Modes**: ReadWriteOnce, ReadOnlyMany, ReadWriteMany
- **Status**: Bound, Available, Released, Failed
- **Pod Usage**: Which pods mount each PVC with pod health
- **Unbound PVs**: Track unused persistent volumes

### 🌍 Network Tests
- **DNS Resolution**: Test hostname resolution
- **TCP Connectivity**: Test port reachability
- **HTTP/HTTPS**: Test endpoint accessibility
- **Latency Metrics**: Response times for each test

## 🐳 Docker Deployment

```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o ajna ./cmd/ajna

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/ajna .
COPY --from=builder /app/ui ./ui
EXPOSE 8080
CMD ["./ajna"]
```

## 🧪 Load Testing

A load testing utility is included to validate performance:

```bash
# Edit test_load.go to set your namespace
go run test_load.go
```

Tests various concurrent user loads (10, 30, 50, 100 users) and reports:
- Total time
- Successful/failed requests
- Requests per second
- Average response time
- Success rate

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- Built with [client-go](https://github.com/kubernetes/client-go)
- Routing powered by [Gorilla Mux](https://github.com/gorilla/mux)
- UI powered by vanilla JavaScript with Ayu Dark theme
- Inspired by the need for fast, safe cluster visibility with relationship tracking

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/yourusername/ajna/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/ajna/discussions)

---

**Made with ❤️ for SREs and Platform Engineers**

*Ajna - See everything, change nothing.*

## 🔧 Development

### Project Structure

```
internal/
├── app/
│   └── app.go          # Application context, caching with ResourceVersion
├── httpapi/
│   ├── handlers.go     # HTTP handlers (optimized with goroutines & ResourceVersion)
│   ├── helpers.go      # Helper functions (health, relationships, details)
│   └── routes.go       # Route definitions
├── k8s/
│   ├── client.go       # K8s client (QPS tuning, connection pool)
│   ├── list.go         # Batch resource fetching (optimized)
│   └── types.go        # Response type definitions
└── network/
    └── test.go         # Network diagnostic utilities
```

### Performance Optimizations

#### 1. ResourceVersion-Based Change Detection (NEW)
```go
// Quick check if resources changed before fetching full data
cachedVersion, _ := application.Cache.GetResourceVersion(cacheKey)
quickCheck, _ := clientset.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{Limit: 1})
if quickCheck.ResourceVersion == cachedVersion {
    return cached // No changes, return instantly
}
// Otherwise fetch full data
```
**Impact**: 50-70% reduction in API calls, <10ms response time for unchanged resources

#### 2. Concurrent Resource Fetching
```go
// Fetches all resource types in parallel
var wg sync.WaitGroup
wg.Add(9) // Pods, Deployments, Services, Ingresses, StatefulSets, DaemonSets, Jobs, CronJobs, PVCs
go func() { /* Fetch Pods */ }()
go func() { /* Fetch Deployments */ }()
// ... etc
wg.Wait()
```
**Impact**: 3-6x faster than sequential fetching

#### 3. Response Caching with ResourceVersion Tracking
```go
// Cache with version tracking
response := map[string]interface{}{
    "resources": resources,
    "version": resourceVersion,
    "cached": false,
}
application.Cache.SetWithVersion(cacheKey, response, resourceVersion, 30*time.Second)
```
**Impact**: 30-second cache window, instant responses for repeat requests

#### 4. Connection Pool Tuning
```go
// K8s client configuration
config.QPS = 50.0   // Queries per second
config.Burst = 100  // Burst allowance
config.WrapTransport = ... // 200 max idle connections, 50 per host
```
**Impact**: Handles 50+ concurrent users without throttling

#### 5. HTTP Server Optimization
```go
server := &http.Server{
    ReadTimeout:    15 * time.Second,
    WriteTimeout:   15 * time.Second,
    IdleTimeout:    120 * time.Second,
    MaxHeaderBytes: 1 << 20,
}
```
**Impact**: Prevents resource exhaustion from slow clients

### Running Tests

```bash
make test
```

### Code Formatting

```bash
make fmt
```

### Linting

```bash
make lint
```

## 🛡️ Security

### Read-Only Operations
Ajna performs **only** the following Kubernetes operations:
- `List()` - Enumerate resources
- `Get()` - Retrieve specific resources

**No write operations** (`Create`, `Update`, `Delete`, `Patch`) are performed.

### RBAC Configuration

Recommended minimal RBAC for Ajna:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ajna-viewer
rules:
- apiGroups: [""]
  resources:
    - namespaces
    - pods
    - services
    - endpoints
    - events
    - nodes
    - configmaps
    - secrets
  verbs: ["get", "list"]
- apiGroups: ["apps"]
  resources:
    - deployments
  verbs: ["get", "list"]
- apiGroups: ["networking.k8s.io"]
  resources:
    - ingresses
  verbs: ["get", "list"]
```

## 📈 Performance Metrics

### Capacity
| Concurrent Users | Expected Performance | Notes |
|-----------------|---------------------|-------|
| 10-30 | ✅ Excellent | <100ms avg response |
| 30-50 | ✅ Good | 100-200ms avg response |
| 50-70 | ✅ Acceptable | 200-300ms avg, ResourceVersion helps |
| 70-100 | ⚠️ Degraded | May need request deduplication |
| 100+ | ⚠️ Requires scaling | Need horizontal scaling + Redis |

### Response Times (50 concurrent users)
- **Cache Hit (within 30s)**: <5ms (0 API calls)
- **ResourceVersion Match**: 5-10ms (1 lightweight API call)
- **Full Fetch Required**: 300-500ms (7-10 concurrent API calls)

### Expected Distribution
- 70% requests: Cache hit → **instant response**
- 25% requests: ResourceVersion match → **5-10ms**
- 5% requests: Full fetch → **300-500ms**

### API Call Reduction
- **Before Optimizations**: Every request = full data fetch
- **After ResourceVersion**: 50-70% fewer full fetches
- **Network Savings**: Significant reduction in data transfer

For detailed performance analysis, see [PERFORMANCE_ANALYSIS.md](PERFORMANCE_ANALYSIS.md)

## 🛡️ Security

### Read-Only Operations
Ajna performs **only** the following Kubernetes operations:
- `List()` - Enumerate resources (with Limit=1 for ResourceVersion checks)
- `Get()` - Retrieve specific resources

**No write operations** (`Create`, `Update`, `Delete`, `Patch`) are performed.

### RBAC Configuration

Recommended minimal RBAC for Ajna:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ajna-viewer
rules:
- apiGroups: [""]
  resources:
    - namespaces
    - pods
    - services
    - endpoints
    - events
    - nodes
    - configmaps
    - secrets
    - persistentvolumes
    - persistentvolumeclaims
  verbs: ["get", "list"]
- apiGroups: ["apps"]
  resources:
    - deployments
    - statefulsets
    - daemonsets
  verbs: ["get", "list"]
- apiGroups: ["batch"]
  resources:
    - jobs
    - cronjobs
  verbs: ["get", "list"]
- apiGroups: ["networking.k8s.io"]
  resources:
    - ingresses
  verbs: ["get", "list"]
```
