package cache

import (
	"log"
	"time"
)

// Cache defines the interface for all cache implementations.
// This allows switching between in-memory and Redis-based caching.
type Cache interface {
	// Get retrieves data from cache by key.
	// Returns the data and true if found and not expired, nil and false otherwise.
	Get(key string) (interface{}, bool)

	// Set stores data in cache with the specified TTL.
	Set(key string, data interface{}, ttl time.Duration)

	// SetWithVersion stores data along with its Kubernetes resource version.
	// This is used for optimistic concurrency control and cache invalidation.
	SetWithVersion(key string, data interface{}, version string, ttl time.Duration)

	// GetResourceVersion retrieves the stored resource version for cached data.
	// Returns the version and true if found, empty string and false otherwise.
	GetResourceVersion(key string) (string, bool)

	// Clear removes all entries from the cache.
	// Returns the number of entries that were cleared.
	Clear() int

	// Delete removes a specific key from the cache.
	Delete(key string)

	// CleanExpired removes all expired entries from the cache.
	// Returns the number of entries that were removed.
	CleanExpired() int

	// GetOrFetch retrieves data from cache or fetches it using the provided function.
	// Uses singleflight pattern to deduplicate concurrent requests for the same key.
	// The fetch function should return (data, resourceVersion, error).
	GetOrFetch(key string, ttl time.Duration, fetch func() (interface{}, string, error)) (interface{}, error)

	// Stats returns cache statistics (hits, misses, size, etc.)
	Stats() Stats

	// HealthCheck verifies the cache is operational.
	// Returns nil if healthy, error otherwise.
	HealthCheck() error
}

// Stats holds cache performance metrics.
type Stats struct {
	Hits        int64   // Number of cache hits
	Misses      int64   // Number of cache misses
	Entries     int     // Current number of cached entries
	Type        string  // Cache type (memory, redis)
	ClusterID   string  // Current cluster ID (for Redis)
	MemoryBytes int64   // Approximate memory usage (if available)
	Evictions   int64   // Number of evictions
	HitRate     float64 // Hit rate percentage
}

// Config holds configuration for cache initialization.
type Config struct {
	// Type specifies the cache implementation: "memory" or "redis"
	Type string

	// Redis configuration (only used when Type = "redis")
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// ClusterID is used as namespace prefix for Redis keys
	ClusterID string

	// EnableMetrics enables detailed cache metrics collection
	EnableMetrics bool
}

// New creates a new cache instance based on the provided configuration.
// If Redis is unavailable, automatically falls back to in-memory cache.
func New(config Config) (Cache, error) {
	switch config.Type {
	case "redis":
		redisCache, err := NewRedisCache(config)
		if err != nil {
			// Automatically fallback to memory cache if Redis is unavailable
			log.Printf("WARNING: Redis cache initialization failed, falling back to in-memory cache: %v", err)
			return NewMemoryCache(config)
		}
		return redisCache, nil
	case "memory", "":
		return NewMemoryCache(config)
	default:
		// Default to memory cache for unknown types
		return NewMemoryCache(config)
	}
}
