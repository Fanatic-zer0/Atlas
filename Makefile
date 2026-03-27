.PHONY: run build clean test

# Run the application
run:
	go run ./cmd/atlas/main.go

# Build the application
build:
	go build -o bin/atlas ./cmd/atlas

# Run the built application
start: build
	./bin/atlas

# Clean build artifacts
clean:
	rm -rf bin/

# Run tests
test:
	go test ./...

# Install dependencies
deps:
	go mod download
	go mod tidy

# Development mode with auto-reload (requires air)
dev:
	air

# Format code
fmt:
	go fmt ./...

# Lint code (requires golangci-lint)
lint:
	golangci-lint run

# Docker build (single-arch, current platform)
docker-build:
	docker build -t atlas:latest .

# Multi-arch build — pushes to a registry, set IMAGE to override (e.g. make docker-buildx IMAGE=myrepo/atlas:latest)
IMAGE ?= atlas:latest
docker-buildx:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--tag $(IMAGE) \
		--push \
		.

# Multi-arch build — load into local Docker daemon (single platform only, useful for local testing)
docker-buildx-load:
	docker buildx build \
		--platform linux/$(shell go env GOARCH) \
		--tag atlas:latest \
		--load \
		.

# Docker run (uses current kubeconfig)
docker-run:
	docker run -p 8080:8080 \
		-v ~/.kube/config:/home/appuser/.kube/config:ro \
		-e KUBECONFIG=/home/appuser/.kube/config \
		atlas:latest
