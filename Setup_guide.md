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




# Production Setup Guide - AWS EKS Clusters

This guide walks you through deploying Atlas for production use with multiple AWS EKS clusters.

---

## 📋 Prerequisites

1. **AWS CLI** installed and configured
2. **kubectl** installed
3. **Docker** and **Docker Compose** installed
4. **AWS IAM permissions** to access EKS clusters
5. Multiple **EKS clusters** already deployed

---

## 🔐 Step 1: Generate EKS Kubeconfig Files

For each EKS cluster, generate a kubeconfig file:

```bash
# Create kubeconfigs directory
mkdir -p kubeconfigs

# Generate kubeconfig for each cluster
aws eks update-kubeconfig \
  --name prod-us-east-1 \
  --region us-east-1 \
  --kubeconfig kubeconfigs/eks-prod-us-east-1.yaml

aws eks update-kubeconfig \
  --name prod-us-west-2 \
  --region us-west-2 \
  --kubeconfig kubeconfigs/eks-prod-us-west-2.yaml

aws eks update-kubeconfig \
  --name prod-eu-west-1 \
  --region eu-west-1 \
  --kubeconfig kubeconfigs/eks-prod-eu-west-1.yaml

aws eks update-kubeconfig \
  --name staging-us-east-1 \
  --region us-east-1 \
  --kubeconfig kubeconfigs/eks-staging-us-east-1.yaml
```

**Verify the generated files:**
```bash
ls -lh kubeconfigs/
cat kubeconfigs/eks-prod-us-east-1.yaml
```

---

## 📝 Step 2: Configure Atlas

### 2.1 Copy Production Configuration

```bash
# Copy production templates
cp config.yaml.production config.yaml
cp .env.production .env
```

### 2.2 Update config.yaml

Edit `config.yaml` and replace the placeholder EKS API server URLs:

```yaml
clusters:
  - id: prod-us-east-1
    name: "Production US East 1"
    kubeconfig: /app/kubeconfigs/eks-prod-us-east-1.yaml
    api_server: https://ABCD1234.gr7.us-east-1.eks.amazonaws.com  # ← Replace this
    region: us-east-1
```

**To find your EKS API server URLs:**
```bash
aws eks describe-cluster --name prod-us-east-1 --region us-east-1 --query "cluster.endpoint" --output text
```

### 2.3 Update .env

Edit `.env` and set secure values:

```bash
# Required
REDIS_PASSWORD=your-strong-random-password-here

# Optional (defaults are fine)
AWS_REGION=us-east-1
LOG_LEVEL=info
```

**Generate a secure Redis password:**
```bash
openssl rand -base64 32
```

---

## 🔑 Step 3: AWS Credentials Setup

### Option A: Using IAM Roles (Recommended for EKS/EC2)

If running Atlas on an EC2 instance or EKS pod, use IAM roles:

1. **Create IAM policy** with EKS read permissions:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "eks:DescribeCluster",
        "eks:ListClusters"
      ],
      "Resource": "*"
    }
  ]
}
```

2. **Attach policy** to your EC2 instance role or EKS service account

3. **No additional configuration needed** - AWS SDK will use the role automatically

### Option B: Using AWS Credentials (For Docker on Non-AWS Hosts)

If running on a non-AWS machine, mount your AWS credentials:

**Uncomment in `docker-compose.production.yml`:**
```yaml
volumes:
  - ~/.aws:/home/appuser/.aws:ro
```

**Or set environment variables in `.env`:**
```bash
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

⚠️ **Security Warning**: Never commit AWS credentials to version control!

---

## 🚀 Step 4: Deploy Atlas

### 4.1 Build and Start Services

```bash
# Set version and build metadata
export VERSION=1.0.0
export BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
export VCS_REF=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build and start
docker-compose -f docker-compose.production.yml up -d --build
```

### 4.2 Verify Deployment

```bash
# Check container status
docker-compose -f docker-compose.production.yml ps

# Check logs
docker-compose -f docker-compose.production.yml logs -f atlas

# Expected output:
# ✅ Redis cache initialized successfully
# ✅ Cluster added successfully id=prod-us-east-1
# ✅ Starting HTTP server port=8080
```

### 4.3 Test API

```bash
# Health check
curl http://localhost:8080/api/health

# List clusters
curl http://localhost:8080/api/clusters | jq

# Get pods from default namespace
curl http://localhost:8080/api/pods | jq '.items[0].metadata.name'
```

---

## 🔍 Step 5: Troubleshooting

### Issue: "TLS certificate verification failed"

**Cause**: Kubeconfig contains incorrect certificate data or paths

**Solution 1** - Regenerate kubeconfig:
```bash
aws eks update-kubeconfig --name your-cluster --kubeconfig kubeconfigs/eks-your-cluster.yaml --dry-run
```

**Solution 2** - Add insecure-skip-tls-verify (NOT recommended for production):
```yaml
# In kubeconfig file
clusters:
- cluster:
    insecure-skip-tls-verify: true
    server: https://xxx.eks.amazonaws.com
```

### Issue: "unable to authenticate"

**Cause**: AWS credentials not available or expired

**Check credentials:**
```bash
# Inside container
docker exec atlas-prod aws sts get-caller-identity

# Should return your AWS account and role
```

**Solutions:**
- Verify IAM role has EKS access
- Check AWS credentials are mounted correctly
- Regenerate kubeconfig with latest credentials
- Verify AWS_REGION environment variable

### Issue: "failed to dial after 5 attempts: dial tcp: lookup redis"

**Cause**: Redis container not running or wrong address

**Solution:**
```bash
# Check Redis is running
docker ps | grep redis

# Check Redis connection from Atlas container
docker exec atlas-prod redis-cli -h redis -a your-password ping

# Should return: PONG
```

### Issue: "Cannot connect to Kubernetes cluster"

**Check cluster accessibility:**
```bash
# Test from your machine
kubectl --kubeconfig kubeconfigs/eks-prod-us-east-1.yaml get nodes

# Test from container
docker exec atlas-prod cat /app/kubeconfigs/eks-prod-us-east-1.yaml
```

**Verify security groups:**
- EKS cluster security group must allow inbound traffic from Atlas host
- Check EKS cluster endpoint is set to "Public" or "Public and Private"

---

## 📊 Step 6: Production Hardening

### 6.1 Enable HTTPS with Nginx

**Create nginx configuration:**
```nginx
# nginx-production.conf
events {
    worker_connections 1024;
}

http {
    upstream atlas {
        server atlas:8080;
    }

    server {
        listen 80;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name atlas.example.com;

        ssl_certificate /etc/nginx/certs/tls.crt;
        ssl_certificate_key /etc/nginx/certs/tls.key;
        ssl_protocols TLSv1.2 TLSv1.3;

        location / {
            proxy_pass http://atlas;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

**Uncomment nginx service** in `docker-compose.production.yml`

### 6.2 Set Up Monitoring

```bash
# View logs
docker-compose -f docker-compose.production.yml logs -f

# Monitor resource usage
docker stats atlas-prod atlas-redis-prod

# Check application metrics
curl http://localhost:8080/api/cache/stats | jq
```

### 6.3 Backup Configuration

```bash
# Backup kubeconfigs (encrypted)
tar czf atlas-kubeconfigs-backup.tar.gz kubeconfigs/
gpg -c atlas-kubeconfigs-backup.tar.gz
rm atlas-kubeconfigs-backup.tar.gz

# Backup Redis data
docker run --rm -v atlas_redis-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/redis-backup.tar.gz /data
```

---

## 🔄 Step 7: Maintenance

### Updating Atlas

```bash
# Pull latest code
git pull origin main

# Rebuild with version tag
export VERSION=1.1.0
docker-compose -f docker-compose.production.yml up -d --build

# Verify new version
docker exec atlas-prod /app/atlas --version
```

### Scaling Redis

For high-traffic deployments, consider:
- **Redis Sentinel** for high availability
- **Redis Cluster** for horizontal scaling
- **AWS ElastiCache** for managed Redis

### Log Rotation

Logs are automatically rotated (configured in docker-compose):
```yaml
logging:
  driver: "json-file"
  options:
    max-size: "50m"
    max-file: "5"
```

---

## 📁 File Structure

Your production deployment should look like:

```
Atlas/
├── config.yaml                          # Production config (from config.yaml.production)
├── .env                                 # Environment variables (from .env.production)
├── docker-compose.production.yml        # Production compose file
├── Dockerfile                           # Atlas image definition
├── kubeconfigs/                         # EKS kubeconfig files
│   ├── eks-prod-us-east-1.yaml
│   ├── eks-prod-us-west-2.yaml
│   ├── eks-prod-eu-west-1.yaml
│   └── eks-staging-us-east-1.yaml
├── certs/                               # (Optional) TLS certificates
│   ├── tls.crt
│   └── tls.key
└── nginx-production.conf                # (Optional) Nginx config
```

---

## ✅ Production Checklist

Before going live:

- [ ] All EKS kubeconfig files generated and tested
- [ ] config.yaml updated with correct API server URLs
- [ ] Strong REDIS_PASSWORD set in .env
- [ ] AWS credentials configured (IAM role or mounted credentials)
- [ ] Security groups allow Atlas to reach EKS clusters
- [ ] Redis persistence enabled and tested
- [ ] Health checks passing for all services
- [ ] HTTPS configured (if using Nginx)
- [ ] Monitoring and alerting set up
- [ ] Backup procedures documented and tested
- [ ] Log aggregation configured
- [ ] Resource limits set appropriately

---

## 🆘 Support

For issues:
1. Check logs: `docker-compose -f docker-compose.production.yml logs -f`
2. Verify connectivity: Test kubectl access from host machine first
3. Review troubleshooting section above
4. Check AWS CloudWatch logs for EKS cluster issues

---

## 📚 Additional Resources

- [EKS User Guide](https://docs.aws.amazon.com/eks/latest/userguide/)
- [kubectl Configuration](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-multiple-clusters/)
- [AWS IAM for EKS](https://docs.aws.amazon.com/eks/latest/userguide/security-iam.html)
- [Redis Best Practices](https://redis.io/topics/admin)
