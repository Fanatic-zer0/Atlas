# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apk add --no-cache ca-certificates

# Copy go mod files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build the binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/bin/ajna ./cmd/ajna

# Runtime stage
FROM alpine:3.19

WORKDIR /app

# Install ca-certificates for HTTPS and kubectl communication
RUN apk add --no-cache ca-certificates

# Copy binary from builder
COPY --from=builder /app/bin/ajna /app/ajna

# Copy UI static files
COPY --from=builder /app/ui /app/ui

# Create non-root user
RUN adduser -D -u 1000 appuser
USER appuser

# Expose port
EXPOSE 8080

# Set default environment variables
ENV PORT=8080

# Run the application
ENTRYPOINT ["/app/ajna"]
