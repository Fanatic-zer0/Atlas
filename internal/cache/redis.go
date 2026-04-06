package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/singleflight"
)

// RedisCache implements the Cache interface using Redis as the backend.
// Supports multi-cluster deployments with cluster-namespaced keys.
type RedisCache struct {
	client       *redis.Client
	clusterID    string
	requestGroup singleflight.Group

	// Metrics
	hits      atomic.Int64
	misses    atomic.Int64
	evictions atomic.Int64
	metrics   bool
}

// NewRedisCache creates a new Redis-backed cache instance.
func NewRedisCache(config Config) (*RedisCache, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     config.RedisAddr,
		Password: config.RedisPassword,
		DB:       config.RedisDB,
		// Connection pool configuration for production
		PoolSize:     50,              // Max connections (default: 10*GOMAXPROCS)
		MinIdleConns: 10,              // Keep warm connections
		MaxRetries:   3,               // Retry failed commands
		DialTimeout:  5 * time.Second, // Connection timeout
		ReadTimeout:  3 * time.Second, // Read timeout
		WriteTimeout: 3 * time.Second, // Write timeout
		PoolTimeout:  4 * time.Second, // Pool get timeout
	})

	// Verify connection
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		log.Printf("WARNING: Redis unavailable at %s: %v - Application will fallback to in-memory cache", config.RedisAddr, err)
		return nil, fmt.Errorf("redis connection failed: %w", err)
	}

	log.Printf("Redis cache initialized successfully at %s (DB: %d, ClusterID: %s)", config.RedisAddr, config.RedisDB, config.ClusterID)

	return &RedisCache{
		client:    client,
		clusterID: config.ClusterID,
		metrics:   config.EnableMetrics,
	}, nil
}

// buildKey constructs a namespaced Redis key with cluster ID prefix.
// Format: atlas:{cluster_id}:{key}
func (c *RedisCache) buildKey(key string) string {
	if c.clusterID == "" {
		return fmt.Sprintf("atlas:%s", key)
	}
	return fmt.Sprintf("atlas:%s:%s", c.clusterID, key)
}

// Get retrieves data from Redis cache by key.
func (c *RedisCache) Get(key string) (interface{}, bool) {
	ctx := context.Background()
	val, err := c.client.Get(ctx, c.buildKey(key)).Result()

	if err == redis.Nil {
		if c.metrics {
			c.misses.Add(1)
		}
		return nil, false
	}

	if err != nil {
		log.Printf("ERROR: Redis Get failed for key '%s': %v", key, err)
		if c.metrics {
			c.misses.Add(1)
		}
		return nil, false
	}

	var data interface{}
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		log.Printf("ERROR: Failed to unmarshal Redis cache data for key '%s': %v", key, err)
		if c.metrics {
			c.misses.Add(1)
		}
		return nil, false
	}

	if c.metrics {
		c.hits.Add(1)
	}
	return data, true
}

// Set stores data in Redis with the specified TTL.
func (c *RedisCache) Set(key string, data interface{}, ttl time.Duration) {
	c.SetWithVersion(key, data, "", ttl)
}

// SetWithVersion stores data along with its Kubernetes resource version.
func (c *RedisCache) SetWithVersion(key string, data interface{}, resourceVersion string, ttl time.Duration) {
	ctx := context.Background()

	jsonData, err := json.Marshal(data)
	if err != nil {
		return
	}

	// Store data and version in a pipeline for atomicity
	pipe := c.client.Pipeline()
	pipe.Set(ctx, c.buildKey(key), jsonData, ttl)

	if resourceVersion != "" {
		pipe.Set(ctx, c.buildKey(key+":version"), resourceVersion, ttl)
	}

	_, err = pipe.Exec(ctx)
	if err != nil {
		log.Printf("[WARN] Redis cache: Failed to set key '%s': %v", key, err)
		return
	}
}

// GetResourceVersion retrieves the stored resource version for cached data.
func (c *RedisCache) GetResourceVersion(key string) (string, bool) {
	ctx := context.Background()

	// Check if main data exists first to avoid returning stale version
	exists, err := c.client.Exists(ctx, c.buildKey(key)).Result()
	if err != nil || exists == 0 {
		return "", false
	}

	val, err := c.client.Get(ctx, c.buildKey(key+":version")).Result()
	if err != nil {
		return "", false
	}

	return val, true
}

// Clear removes all entries for the current cluster from the cache.
func (c *RedisCache) Clear() int {
	ctx := context.Background()
	pattern := c.buildKey("*")

	var cursor uint64
	count := 0

	for {
		var keys []string
		var err error

		keys, cursor, err = c.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			break
		}

		if len(keys) > 0 {
			deleted, err := c.client.Del(ctx, keys...).Result()
			if err == nil {
				count += int(deleted)
				if c.metrics {
					c.evictions.Add(deleted)
				}
			}
		}

		if cursor == 0 {
			break
		}
	}

	return count
}

// Delete removes a specific key from the cache.
func (c *RedisCache) Delete(key string) {
	ctx := context.Background()

	// Delete both data and version keys
	pipe := c.client.Pipeline()
	pipe.Del(ctx, c.buildKey(key))
	pipe.Del(ctx, c.buildKey(key+":version"))

	deleted, err := pipe.Exec(ctx)
	if err != nil {
		log.Printf("[WARN] Redis cache: Failed to delete key '%s': %v", key, err)
	} else if c.metrics && len(deleted) > 0 {
		c.evictions.Add(1)
	}
}

// CleanExpired is a no-op for Redis since Redis handles expiration automatically.
func (c *RedisCache) CleanExpired() int {
	// Redis automatically evicts expired keys
	return 0
}

// GetOrFetch retrieves data from cache or fetches it using the provided function.
// Uses singleflight pattern to deduplicate concurrent requests.
func (c *RedisCache) GetOrFetch(key string, ttl time.Duration, fetch func() (interface{}, string, error)) (interface{}, error) {
	// Check cache first
	if data, ok := c.Get(key); ok {
		return data, nil
	}

	// Use singleflight to deduplicate concurrent requests
	v, err, _ := c.requestGroup.Do(key, func() (interface{}, error) {
		// Double-check cache in case another goroutine just populated it
		if data, ok := c.Get(key); ok {
			return data, nil
		}

		// Fetch the data
		data, resourceVersion, fetchErr := fetch()
		if fetchErr != nil {
			return nil, fetchErr
		}

		// Store in cache
		c.SetWithVersion(key, data, resourceVersion, ttl)
		return data, nil
	})

	return v, err
}

// Stats returns cache performance metrics.
func (c *RedisCache) Stats() Stats {
	ctx := context.Background()

	hits := c.hits.Load()
	misses := c.misses.Load()
	total := hits + misses

	hitRate := 0.0
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	// Get number of keys for this cluster
	pattern := c.buildKey("*")
	var cursor uint64
	entries := 0

	// Count keys (limited to avoid blocking)
	for i := 0; i < 10; i++ {
		keys, nextCursor, err := c.client.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			break
		}
		entries += len(keys)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	// Get memory info (this is server-wide, not cluster-specific)
	var memoryBytes int64
	_, err := c.client.Info(ctx, "memory").Result()
	if err == nil {
		// Parse used_memory from info string (simplified)
		// In production, you'd want a proper parser
		memoryBytes = 0 // TODO: Parse INFO output
	}

	return Stats{
		Hits:        hits,
		Misses:      misses,
		Entries:     entries,
		Type:        "redis",
		ClusterID:   c.clusterID,
		MemoryBytes: memoryBytes,
		Evictions:   c.evictions.Load(),
		HitRate:     hitRate,
	}
}

// HealthCheck verifies Redis connection is operational.
func (c *RedisCache) HealthCheck() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	return c.client.Ping(ctx).Err()
}

// Close closes the Redis connection.
func (c *RedisCache) Close() error {
	return c.client.Close()
}

// SwitchCluster changes the cluster namespace for subsequent operations.
// This allows the same Redis instance to serve multiple clusters.
func (c *RedisCache) SwitchCluster(clusterID string) {
	c.clusterID = clusterID
}

// GetClusterID returns the current cluster ID.
func (c *RedisCache) GetClusterID() string {
	return c.clusterID
}
