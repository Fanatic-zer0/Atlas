package cache

import (
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"
)

// MemoryCache implements the Cache interface using in-memory storage.
// Suitable for single-instance deployments or when Redis is not available.
type MemoryCache struct {
	data         map[string]CacheEntry
	mu           sync.RWMutex
	requestGroup singleflight.Group
	stopCleanup  chan struct{}

	// Metrics
	hits      atomic.Int64
	misses    atomic.Int64
	evictions atomic.Int64
	metrics   bool
}

// CacheEntry represents a single cached item with its metadata.
type CacheEntry struct {
	Data            interface{}
	ResourceVersion string
	ExpiresAt       time.Time
}

// NewMemoryCache creates a new in-memory cache instance with auto-cleanup.
func NewMemoryCache(config Config) (*MemoryCache, error) {
	c := &MemoryCache{
		data:        make(map[string]CacheEntry),
		metrics:     config.EnableMetrics,
		stopCleanup: make(chan struct{}),
	}

	// Auto-start cleanup routine
	go c.autoCleanupRoutine()

	return c, nil
}

// autoCleanupRoutine automatically cleans expired entries every 5 minutes
func (c *MemoryCache) autoCleanupRoutine() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			c.CleanExpired()
		case <-c.stopCleanup:
			return
		}
	}
}

// StopCleanup stops the automatic cleanup routine (for graceful shutdown)
func (c *MemoryCache) StopCleanup() {
	close(c.stopCleanup)
}

// Get retrieves data from cache by key.
func (c *MemoryCache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.data[key]
	if !exists || time.Now().After(entry.ExpiresAt) {
		if c.metrics {
			c.misses.Add(1)
		}
		return nil, false
	}

	if c.metrics {
		c.hits.Add(1)
	}
	return entry.Data, true
}

// Set stores data in cache with the specified TTL.
func (c *MemoryCache) Set(key string, data interface{}, ttl time.Duration) {
	c.SetWithVersion(key, data, "", ttl)
}

// SetWithVersion stores data along with its Kubernetes resource version.
func (c *MemoryCache) SetWithVersion(key string, data interface{}, resourceVersion string, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.data[key] = CacheEntry{
		Data:            data,
		ResourceVersion: resourceVersion,
		ExpiresAt:       time.Now().Add(ttl),
	}
}

// GetResourceVersion retrieves the stored resource version for cached data.
func (c *MemoryCache) GetResourceVersion(key string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.data[key]
	if !exists || time.Now().After(entry.ExpiresAt) {
		return "", false
	}
	return entry.ResourceVersion, true
}

// Clear removes all entries from the cache.
func (c *MemoryCache) Clear() int {
	c.mu.Lock()
	defer c.mu.Unlock()

	count := len(c.data)
	c.data = make(map[string]CacheEntry)

	if c.metrics {
		c.evictions.Add(int64(count))
	}

	return count
}

// Delete removes a specific key from the cache.
func (c *MemoryCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if _, exists := c.data[key]; exists {
		delete(c.data, key)
		if c.metrics {
			c.evictions.Add(1)
		}
	}
}

// CleanExpired removes all expired entries from the cache.
func (c *MemoryCache) CleanExpired() int {
	c.mu.Lock()
	defer c.mu.Unlock()

	count := 0
	now := time.Now()
	for key, entry := range c.data {
		if now.After(entry.ExpiresAt) {
			delete(c.data, key)
			count++
		}
	}

	if c.metrics {
		c.evictions.Add(int64(count))
	}

	return count
}

// GetOrFetch retrieves data from cache or fetches it using the provided function.
// This method uses singleflight to deduplicate concurrent requests for the same key.
func (c *MemoryCache) GetOrFetch(key string, ttl time.Duration, fetch func() (interface{}, string, error)) (interface{}, error) {
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
func (c *MemoryCache) Stats() Stats {
	c.mu.RLock()
	entries := len(c.data)
	c.mu.RUnlock()

	hits := c.hits.Load()
	misses := c.misses.Load()
	total := hits + misses

	hitRate := 0.0
	if total > 0 {
		hitRate = float64(hits) / float64(total) * 100
	}

	// Estimate memory usage (rough approximation)
	memoryBytes := int64(entries * 1024) // Assume ~1KB per entry

	return Stats{
		Hits:        hits,
		Misses:      misses,
		Entries:     entries,
		Type:        "memory",
		ClusterID:   "",
		MemoryBytes: memoryBytes,
		Evictions:   c.evictions.Load(),
		HitRate:     hitRate,
	}
}

// HealthCheck verifies the cache is operational.
func (c *MemoryCache) HealthCheck() error {
	// Memory cache is always healthy if it exists
	return nil
}

// StartCleanupRoutine starts a background goroutine that periodically cleans expired entries.
// Returns a function that can be called to stop the cleanup routine.
func (c *MemoryCache) StartCleanupRoutine(interval time.Duration) func() {
	ticker := time.NewTicker(interval)
	done := make(chan bool)

	go func() {
		for {
			select {
			case <-ticker.C:
				c.CleanExpired()
			case <-done:
				ticker.Stop()
				return
			}
		}
	}()

	return func() {
		done <- true
	}
}
