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

# Docker build
docker-build:
	docker build -t atlas:latest .

# Docker run (uses current kubeconfig)
docker-run:
	docker run -p 8080:8080 \
		-v ~/.kube/config:/home/appuser/.kube/config:ro \
		-e KUBECONFIG=/home/appuser/.kube/config \
		atlas:latest
