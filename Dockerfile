# Build stage — always runs on the host's native arch for speed
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder

# Populated automatically by buildx
ARG TARGETOS
ARG TARGETARCH

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apk add --no-cache ca-certificates

# Copy go mod files first for better caching
COPY go.mod go.sum ./

# Clear any cached modules and download fresh
RUN go clean -modcache && \
    go mod download

# Copy source code
COPY . .

# Verify module and ensure atlas is the module name (not ajna)
RUN go list -m && \
    go mod verify && \
    go list -m all | head -1

# Build the binary — cross-compile for the target platform with verbose output
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} \
    go build -v -ldflags="-w -s" -o /app/bin/atlas ./cmd/atlas

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS and kubectl communication
RUN apk add --no-cache ca-certificates

# Copy binary from builder
COPY --from=builder /app/bin/atlas /app/atlas

# Copy UI static files
COPY --from=builder /app/ui /app/ui

# Create non-root user and pre-create .kube dir with correct ownership
RUN adduser -D -u 1000 appuser && mkdir -p /home/appuser/.kube
USER appuser

# Expose port
EXPOSE 8080

# Set default environment variables
ENV PORT=8080

# Run the application
ENTRYPOINT ["/app/atlas"]
