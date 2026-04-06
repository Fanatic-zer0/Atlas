package httpapi

import (
	"net/http"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Simple rate limiter using token bucket algorithm
// Limits: 100 requests per minute per IP address
type rateLimiter struct {
	limiters map[string]*rate.Limiter
	mu       sync.RWMutex
	rate     rate.Limit
	burst    int
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rate:     rate.Limit(100.0 / 60.0), // 100 requests per minute
		burst:    20,                       // Allow burst of 20 requests
	}
}

func (rl *rateLimiter) getLimiter(ip string) *rate.Limiter {
	rl.mu.RLock()
	limiter, exists := rl.limiters[ip]
	rl.mu.RUnlock()

	if exists {
		return limiter
	}

	rl.mu.Lock()
	defer rl.mu.Unlock()

	// Double-check after acquiring write lock
	if limiter, exists := rl.limiters[ip]; exists {
		return limiter
	}

	limiter = rate.NewLimiter(rl.rate, rl.burst)
	rl.limiters[ip] = limiter

	// Start cleanup goroutine on first use
	if len(rl.limiters) == 1 {
		go rl.cleanup()
	}

	return limiter
}

// cleanup removes old limiters every 5 minutes to prevent memory leak
func (rl *rateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		// Remove limiters that haven't been used recently
		for ip, limiter := range rl.limiters {
			if limiter.Tokens() == float64(rl.burst) {
				delete(rl.limiters, ip)
			}
		}
		rl.mu.Unlock()
	}
}

// rateLimitMiddleware enforces rate limiting per IP address
func rateLimitMiddleware() func(http.Handler) http.Handler {
	limiter := newRateLimiter()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Extract IP from request
			ip := r.RemoteAddr
			if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
				ip = forwarded // Use first IP in X-Forwarded-For if behind proxy
			}

			// Get limiter for this IP
			limiter := limiter.getLimiter(ip)

			// Check if request is allowed
			if !limiter.Allow() {
				http.Error(w, "Rate limit exceeded. Please try again later.", http.StatusTooManyRequests)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
