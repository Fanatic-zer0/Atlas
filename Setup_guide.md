# Atlas Deployment Guide

Complete guide for deploying Atlas Kubernetes Dashboard in single-cluster and multi-cluster configurations.

---

## Table of Contents

1. [Quick Start - Single Cluster](#quick-start---single-cluster)
2. [Multi-Cluster Setup](#multi-cluster-setup)
3. [Creating Separate Kubeconfig Files](#creating-separate-kubeconfig-files)
4. [Docker Compose Deployment](#docker-compose-deployment)
5. [Configuration Reference](#configuration-reference)
6. [Environment Variables](#environment-variables)
7. [Troubleshooting](#troubleshooting)

---

## Quick Start - Single Cluster

### 1. Create Configuration File

```bash
cp config.yaml.example config.yaml
```

Edit `config.yaml`:
```yaml
cache:
  type: memory

clusters: []  # Empty for single-cluster mode using default kubeconfig

server:
  port: 8080

features:
  multi_cluster: false
```

### 2. Run Atlas

```bash
# Build
make build

# Run
./bin/atlas
```

### 3. Access Dashboard

Open `http://localhost:8080`

---

## Multi-Cluster Setup

### Step 1: Prepare Kubeconfig Files

You need a separate kubeconfig file for each cluster. See [Creating Separate Kubeconfig Files](#creating-separate-kubeconfig-files) below.

### Step 2: Create config.yaml

```bash
cp config.yaml.example config.yaml
```

Edit `config.yaml`:

```yaml
cache:
  type: redis  # Use Redis for multi-cluster shared cache
  redis:
    addr: "localhost:6379"
    password: ""
    db: 0

clusters:
  - id: prod-us
    name: Production US East
    kubeconfig: /etc/atlas/kubeconfigs/prod-us-east.yaml
    api_server: https://api.prod-us-east.company.com
    region: us-east-1
    
  - id: prod-eu
    name: Production EU West
    kubeconfig: /etc/atlas/kubeconfigs/prod-eu-west.yaml
    api_server: https://api.prod-eu-west.company.com
    region: eu-west-1
    
  - id: staging
    name: Staging Environment
    kubeconfig: /etc/atlas/kubeconfigs/staging.yaml
    api_server: https://api.staging.company.com
    region: us-east-1

server:
  port: 8080

features:
  multi_cluster: true  # Enable cluster dropdown in UI
```

### Step 3: Start Redis

```bash
docker run -d \
  --name atlas-redis \
  -p 6379:6379 \
  redis:7-alpine
```

### Step 4: Run Atlas

```bash
./bin/atlas
```

The UI will now show a **cluster dropdown** in the header where users can switch between clusters.

---

## Creating Separate Kubeconfig Files

When managing multiple clusters, it's best practice to create separate kubeconfig files for each cluster instead of using a single merged kubeconfig.

### Method 1: Extract from Existing Kubeconfig

If you have a merged kubeconfig at `~/.kube/config`:

```bash
# Create directory for separate configs
mkdir -p kubeconfigs

# Extract specific cluster (example: prod-us-east)
kubectl config view \
  --kubeconfig=$HOME/.kube/config \
  --context=prod-us-east \
  --minify \
  --flatten > kubeconfigs/prod-us-east.yaml

# Verify
kubectl --kubeconfig=kubeconfigs/prod-us-east.yaml cluster-info
```

**Repeat for each cluster:**

```bash
# Production EU West
kubectl config view \
  --kubeconfig=$HOME/.kube/config \
  --context=prod-eu-west \
  --minify \
  --flatten > kubeconfigs/prod-eu-west.yaml

# Staging
kubectl config view \
  --kubeconfig=$HOME/.kube/config \
  --context=staging \
  --minify \
  --flatten > kubeconfigs/staging.yaml
```

### Method 2: Get from Cloud Providers

#### AWS EKS

```bash
aws eks update-kubeconfig \
  --region us-east-1 \
  --name prod-cluster \
  --kubeconfig kubeconfigs/eks-prod.yaml
```

#### Google GKE

```bash
gcloud container clusters get-credentials prod-cluster \
  --zone us-central1-a \
  --project my-project

# Then extract
kubectl config view \
  --context=gke_my-project_us-central1-a_prod-cluster \
  --minify \
  --flatten > kubeconfigs/gke-prod.yaml
```

#### Azure AKS

```bash
az aks get-credentials \
  --resource-group my-rg \
  --name prod-cluster \
  --file kubeconfigs/aks-prod.yaml
```

### Method 3: Create from Scratch

```yaml
# Example: kubeconfigs/prod-us-east.yaml
apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: LS0tLS1CRUdJT...  # Base64 encoded CA cert
    server: https://api.prod-us-east.company.com
  name: prod-us-east
contexts:
- context:
    cluster: prod-us-east
    user: prod-us-east-admin
  name: prod-us-east
current-context: prod-us-east
users:
- name: prod-us-east-admin
  user:
    client-certificate-data: LS0tLS1CRUdJTi...  # Base64 encoded client cert
    client-key-data: LS0tLS1CRUdJTiBSU0...      # Base64 encoded client key
```

### Best Practices for Kubeconfig Files

1. **Use embedded credentials:** Use `certificate-authority-data`, `client-certificate-data`, and `client-key-data` (base64 encoded) instead of file paths
2. **Store securely:** Keep kubeconfig files in a secure directory with restricted permissions
3. **Set proper permissions:**
   ```bash
   chmod 600 kubeconfigs/*.yaml
   ```
4. **Use service accounts:** For production, consider using Kubernetes service accounts instead of user credentials
5. **Rotate credentials:** Regularly rotate access keys and certificates

---

## Docker Compose Deployment

### Directory Structure

```
atlas/
├── docker-compose.yml
├── config.yaml
├── .env
├── kubeconfigs/
│   ├── prod-us-east.yaml
│   ├── prod-eu-west.yaml
│   └── staging.yaml
└── Dockerfile
```

### 1. Create .env File

```bash
# .env
# Optional environment variable overrides
CACHE_TYPE=redis
REDIS_ADDR=redis:6379
CONFIG_PATH=/app/config.yaml
```

### 2. Create config.yaml

See [Multi-Cluster Setup](#multi-cluster-setup) above, but adjust paths for Docker:

```yaml
cache:
  type: redis
  redis:
    addr: "redis:6379"  # Use service name in Docker network
    password: ""
    db: 0

clusters:
  - id: prod-us
    name: Production US East
    kubeconfig: /app/kubeconfigs/prod-us-east.yaml  # Docker volume mount path
    api_server: https://api.prod-us-east.company.com
    region: us-east-1
    
  - id: prod-eu
    name: Production EU West
    kubeconfig: /app/kubeconfigs/prod-eu-west.yaml
    api_server: https://api.prod-eu-west.company.com
    region: eu-west-1

server:
  port: 8080

features:
  multi_cluster: true
```

### 3. Create docker-compose.yml

```yaml
version: '3.8'

services:
  atlas:
    build: .
    image: atlas:latest
    container_name: atlas
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      # Mount config file
      - ./config.yaml:/app/config.yaml:ro
      # Mount kubeconfig files
      - ./kubeconfigs:/app/kubeconfigs:ro
    depends_on:
      - redis
    restart: unless-stopped
    networks:
      - atlas-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  redis:
    image: redis:7-alpine
    container_name: atlas-redis
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped
    networks:
      - atlas-network
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

networks:
  atlas-network:
    driver: bridge

volumes:
  redis-data:
    driver: local
```

### 4. Update Dockerfile

Ensure your Dockerfile copies the config:

```dockerfile
FROM golang:1.21-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o atlas ./cmd/atlas

FROM alpine:latest

RUN apk --no-cache add ca-certificates curl

WORKDIR /app

COPY --from=builder /build/atlas .
COPY --from=builder /build/ui ./ui

# Create directory for config
RUN mkdir -p /app/kubeconfigs

# Non-root user
RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser && \
    chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

CMD ["./atlas"]
```

### 5. Deploy

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f atlas

# Stop
docker-compose down

# Restart after config changes
docker-compose restart atlas
```

### 6. Verify Deployment

```bash
# Check health
curl http://localhost:8080/healthz

# Check cluster mode
curl http://localhost:8080/api/cluster/current

# List clusters
curl http://localhost:8080/api/clusters
```

---

## Configuration Reference

### config.yaml Structure

```yaml
cache:
  type: string           # "memory" or "redis"
  redis:
    addr: string         # Redis server address (e.g., "localhost:6379")
    password: string     # Redis password (optional)
    db: int             # Redis database number (0-15)

clusters:
  - id: string          # Unique cluster identifier (required)
    name: string        # Display name in UI (required)
    kubeconfig: string  # Path to kubeconfig file (required)
    api_server: string  # Kubernetes API server URL (optional)
    region: string      # Region/zone label (optional)

server:
  port: int            # HTTP server port (default: 8080)

features:
  multi_cluster: bool  # Enable multi-cluster mode (default: false)
```

### Field Descriptions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cache.type` | string | No | Cache backend: `memory` (single instance) or `redis` (multi-instance) |
| `cache.redis.addr` | string | If redis | Redis server address |
| `cache.redis.password` | string | No | Redis authentication password |
| `cache.redis.db` | int | No | Redis database number (0-15) |
| `clusters[].id` | string | Yes | Unique cluster identifier (alphanumeric, hyphens) |
| `clusters[].name` | string | Yes | Human-readable cluster name for UI |
| `clusters[].kubeconfig` | string | Yes | Absolute path to kubeconfig file |
| `clusters[].api_server` | string | No | Kubernetes API server URL (auto-detected if omitted) |
| `clusters[].region` | string | No | Region label (e.g., "us-east-1", "eu-west-1") |
| `server.port` | int | No | HTTP server port (default: 8080) |
| `features.multi_cluster` | bool | No | Enable cluster dropdown in UI (default: false) |

---

## Environment Variables

Environment variables **override** config.yaml settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `CONFIG_PATH` | Path to config file | `/etc/atlas/config.yaml` |
| `CACHE_TYPE` | Override cache type | `redis` |
| `REDIS_ADDR` | Override Redis address | `redis:6379` |
| `REDIS_PASSWORD` | Override Redis password | `mypassword` |
| `MULTI_CLUSTER` | Override multi-cluster flag | `true` |
| `PORT` | Override server port | `8080` |

### Usage Examples

```bash
# Override cache to use Redis
export CACHE_TYPE=redis
export REDIS_ADDR=my-redis:6379
./bin/atlas

# Use custom config location
export CONFIG_PATH=/etc/atlas/config.yaml
./bin/atlas

# Enable multi-cluster via environment
export MULTI_CLUSTER=true
./bin/atlas
```

---

## Troubleshooting

### Error: "configuration file not found"

```
Failed to load configuration: configuration file not found: config.yaml
Please create config.yaml from config.yaml.example
```

**Solution:**
```bash
cp config.yaml.example config.yaml
# Edit config.yaml with your settings
```

### Error: "kubeconfig file not found for cluster"

```
Invalid configuration: kubeconfig file not found for cluster 'prod-us': /path/to/prod-us.yaml
```

**Solution:**
1. Verify the file exists: `ls -la /path/to/prod-us.yaml`
2. Check file permissions: `chmod 600 /path/to/prod-us.yaml`
3. Use absolute paths in config.yaml
4. For Docker: ensure volume is mounted correctly

### Error: "multi-cluster mode is enabled but no clusters are defined"

```
Invalid configuration: multi-cluster mode is enabled but no clusters are defined in config.yaml
```

**Solution:**
Either:
1. Add cluster definitions to config.yaml
2. Set `features.multi_cluster: false` for single-cluster mode

### Redis Connection Refused

```
Failed to create cache: dial tcp 127.0.0.1:6379: connect: connection refused
```

**Solution:**
```bash
# Start Redis
docker run -d --name atlas-redis -p 6379:6379 redis:7-alpine

# Or use memory cache instead
# Edit config.yaml:
cache:
  type: memory
```

### Permission Denied on Kubeconfig

```
kubeconfig file not found for cluster 'prod': /app/kubeconfigs/prod.yaml
```

**Solution for Docker:**
```bash
# Set proper permissions
chmod 644 kubeconfigs/*.yaml

# Verify volume mount in docker-compose.yml:
volumes:
  - ./kubeconfigs:/app/kubeconfigs:ro
```

### Cluster Dropdown Not Appearing

**Check:**
1. `features.multi_cluster: true` in config.yaml
2. At least one cluster defined in `clusters` array
3. Browser console for errors: `http://localhost:8080/api/cluster/current` should return `{"mode":"multi-cluster"}`

### Test Configuration

```bash
# Validate config.yaml syntax
cat config.yaml | grep -v '^#' | grep -v '^$'

# Test kubeconfig access
kubectl --kubeconfig=/path/to/cluster.yaml cluster-info

# Test Redis connection
redis-cli -h localhost -p 6379 ping
```

---

## Example Configurations

### Single Cluster (Development)

```yaml
cache:
  type: memory

clusters: []

server:
  port: 8080

features:
  multi_cluster: false
```

### Multi-Cluster (Production)

```yaml
cache:
  type: redis
  redis:
    addr: "redis-cluster.internal:6379"
    password: "secure-password"
    db: 0

clusters:
  - id: prod-us-east-1
    name: Production US East (Primary)
    kubeconfig: /etc/atlas/kubeconfigs/prod-us-east-1.yaml
    api_server: https://api.prod.us-east-1.k8s.company.com
    region: us-east-1
    
  - id: prod-us-west-2
    name: Production US West (DR)
    kubeconfig: /etc/atlas/kubeconfigs/prod-us-west-2.yaml
    api_server: https://api.prod.us-west-2.k8s.company.com
    region: us-west-2
    
  - id: prod-eu-west-1
    name: Production EU West
    kubeconfig: /etc/atlas/kubeconfigs/prod-eu-west-1.yaml
    api_server: https://api.prod.eu-west-1.k8s.company.com
    region: eu-west-1

server:
  port: 8080

features:
  multi_cluster: true
```

---

## Security Best Practices

1. **Restrict kubeconfig permissions:**
   ```bash
   chmod 600 kubeconfigs/*.yaml
   chown atlas:atlas kubeconfigs/*.yaml
   ```

2. **Use read-only kubeconfigs:** Create service accounts with minimal permissions:
   ```bash
   kubectl create serviceaccount atlas-viewer -n kube-system
   kubectl create clusterrolebinding atlas-viewer \
     --clusterrole=view \
     --serviceaccount=kube-system:atlas-viewer
   ```

3. **Secure Redis:** Use password authentication in production
4. **Use TLS:** Deploy behind reverse proxy with TLS termination
5. **Network policies:** Restrict access to Redis and Kubernetes API
