package app

import "time"

// GetOrFetch retrieves data from cache or fetches it using the provided function.
// This method uses singleflight to deduplicate concurrent requests for the same key.
func (c *Cache) GetOrFetch(key string, ttl time.Duration, fetch func() (interface{}, string, error)) (interface{}, error) {
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
