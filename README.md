# 𖤓 Ajna - Kubernetes Quick Web-Based Dashboard

**Ajna** (Sanskrit: अज्ञ, meaning "perception" or "third eye") is a fast, lightweight, read-only Kubernetes cluster monitoring and visualization tool. It provides SREs and developers with instant visibility into cluster health, resources, and deployment status through a beautiful web interface.

![Go Version](https://img.shields.io/badge/Go-1.21-00ADD8?logo=go)
![Kubernetes](https://img.shields.io/badge/Kubernetes-0.28-326CE5?logo=kubernetes)
![License](https://img.shields.io/badge/license-MIT-green)

<img width="1393" height="935" alt="image" src="https://github.com/user-attachments/assets/12ba1c7b-5ad6-40c1-a0ba-247357e3e01a" />


## ✨ Features 

### 🔍 **Read-Only Cluster Monitoring**
- **Safe by Design**: Zero write operations - pure observation mode
- No risk of accidental cluster modifications
- Perfect for read-only RBAC configurations

### 🚀 **High Performance**
- **Concurrent API Fetching**: Parallel goroutines reduce response time by 3-6x
- **Intelligent Caching**: 30-second cache for frequently accessed data
- **Batch Endpoint Lookups**: Single API call instead of N+1 queries
- **Auto Cache Cleanup**: Periodic cleanup prevents memory leaks

### 📊 **Comprehensive Monitoring**
- **Health Dashboard**: Real-time cluster health with visual indicators
- **Resource Views**: Ingresses, Services, Pods, Deployments
- **Network Testing**: Built-in DNS and TCP connectivity tests
- **Event Tracking**: Recent cluster events and issues
- **Release Management**: Track deployment versions and images

### 🎨 **Modern UI**
- Beautiful gradient-based interface
- Real-time status indicators (✅ ⚠️ ❌)
- Health score visualization
- Namespace filtering
- Responsive design

## 🏗️ Architecture

```
ajna/
├── cmd/
│   └── ajna/           # Main application entry point
├── internal/
│   ├── app/            # Application core & caching
│   ├── httpapi/        # HTTP handlers & routes
│   ├── k8s/            # Kubernetes client & operations
│   └── network/        # Network diagnostic tools
├── ui/
│   └── index.html      # Single-page web interface
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
git clone https://github.com/Fanatic-zer0/ajna.git
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

- `PORT`: Server port (default: `8080`)
- `KUBECONFIG`: Path to kubeconfig file (default: `~/.kube/config`)

#### Kubernetes Access

Ajna automatically detects your Kubernetes configuration:
1. **Local Development**: Uses `~/.kube/config`
2. **In-Cluster**: Uses service account when running as a pod
3. **Custom Path**: Set `KUBECONFIG` environment variable

## 📡 API Endpoints

### Cluster Information
- `GET /api/cluster-info` - Get cluster and namespace information

### Resources
- `GET /api/resources/{namespace}?resource_type={type}` - List resources by type
- `GET /api/resource/{type}/{namespace}/{name}` - Get resource details

### Resource Types
- `GET /api/ingresses/{namespace}` - List ingresses
- `GET /api/services/{namespace}` - List services
- `GET /api/pods/{namespace}` - List pods
- `GET /api/deployments/{namespace}` - List deployments

### Health & Monitoring
- `GET /api/health/{namespace}` - Cluster health dashboard
- `GET /api/releases/{namespace}` - Deployment release information

### Network Diagnostics
- `POST /api/network/test` - Test DNS or TCP connectivity

### Cache Management
- `GET /api/cache/stats` - Get cache statistics
- `POST /api/cache/clear` - Clear cache

## 🔧 Development

### Project Structure

```
internal/
├── app/
│   └── app.go          # Application context, caching logic
├── httpapi/
│   ├── handlers.go     # HTTP request handlers (optimized with goroutines)
│   ├── helpers.go      # Helper functions for health calculations
│   └── routes.go       # Route definitions
├── k8s/
│   ├── client.go       # Kubernetes client initialization
│   ├── list.go         # Batch resource fetching (optimized)
│   └── types.go        # Response type definitions
└── network/
    └── test.go         # Network diagnostic utilities
```

### Performance Optimizations

#### 1. Concurrent Resource Fetching
```go
// Fetches all resource types in parallel
var wg sync.WaitGroup
wg.Add(4)
go func() { /* Fetch Pods */ }()
go func() { /* Fetch Deployments */ }()
go func() { /* Fetch Services */ }()
go func() { /* Fetch Ingresses */ }()
wg.Wait()
```

#### 2. Batch Endpoint Lookups
```go
// Single List() call for all endpoints instead of N Get() calls
endpointsList, _ := cs.CoreV1().Endpoints(namespace).List(ctx, metav1.ListOptions{})
endpointsMap := make(map[string]*corev1.Endpoints)
for i := range endpointsList.Items {
    ep := &endpointsList.Items[i]
    endpointsMap[ep.Name] = ep
}
```

#### 3. Response Caching
```go
// 30-second cache with automatic cleanup every 5 minutes
application.Cache.Set(cacheKey, data, 30*time.Second)
application.Cache.StartCleanupRoutine(ctx, 5*time.Minute)
```

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

### Before Optimizations
- Services endpoint: 5-10 seconds (50 services)
- Health dashboard: 8-12 seconds
- API calls: N+1 queries per resource type

### After Optimizations
- Services endpoint: 0.5-1 second (50 services) - **10x faster**
- Health dashboard: 1-2 seconds - **6x faster**
- API calls: Reduced by 70-96%
- Memory: Stable with automatic cache cleanup

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
- UI powered by vanilla JavaScript (no frameworks!)
- Inspired by the need for fast, safe cluster visibility

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Fanatic-zer0/ajna/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Fanatic-zer0/ajna/discussions)

---

**Made with ❤️ for SREs and Platform Engineers**
