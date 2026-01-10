package app

import (
	"context"
	"sync"
	"time"

	"ajna/internal/k8s"

	"k8s.io/client-go/kubernetes"
)

type App struct {
	Addr  string
	UIDir string

	Connected bool
	ConnErr   string

	Kube      *kubernetes.Clientset
	Meta      k8s.KubeMeta
	K8sClient *k8s.Client
	Cache     *Cache
}

type Cache struct {
	data map[string]CacheEntry
	mu   sync.RWMutex
}

type CacheEntry struct {
	Data            interface{}
	ResourceVersion string
	ExpiresAt       time.Time
}

func New(client *k8s.Client) *App {
	return &App{
		K8sClient: client,
		Cache:     NewCache(),
	}
}

func NewCache() *Cache {
	return &Cache{
		data: make(map[string]CacheEntry),
	}
}

func (c *Cache) Get(key string) (interface{}, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.data[key]
	if !exists || time.Now().After(entry.ExpiresAt) {
		return nil, false
	}
	return entry.Data, true
}

func (c *Cache) Set(key string, data interface{}, ttl time.Duration) {
	c.SetWithVersion(key, data, "", ttl)
}

func (c *Cache) SetWithVersion(key string, data interface{}, resourceVersion string, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.data[key] = CacheEntry{
		Data:            data,
		ResourceVersion: resourceVersion,
		ExpiresAt:       time.Now().Add(ttl),
	}
}

func (c *Cache) GetResourceVersion(key string) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.data[key]
	if !exists || time.Now().After(entry.ExpiresAt) {
		return "", false
	}
	return entry.ResourceVersion, true
}

func (c *Cache) Clear() int {
	c.mu.Lock()
	defer c.mu.Unlock()

	count := len(c.data)
	c.data = make(map[string]CacheEntry)
	return count
}

func (c *Cache) CleanExpired() int {
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
	return count
}

func (c *Cache) StartCleanupRoutine(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	go func() {
		for {
			select {
			case <-ticker.C:
				c.CleanExpired()
			case <-ctx.Done():
				ticker.Stop()
				return
			}
		}
	}()
}

func (c *Cache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.data)
}
