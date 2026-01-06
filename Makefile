.PHONY: run build clean test

# Run the application
run:
	go run ./cmd/ajna/main.go

# Build the application
build:
	go build -o bin/ajna ./cmd/ajna

# Run the built application
start: build
	./bin/ajna

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
