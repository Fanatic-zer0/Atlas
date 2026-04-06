package httpapi

import (
	"net/http"
)

// securityHeadersMiddleware adds security headers to all HTTP responses
// to mitigate XSS, clickjacking, and other client-side attacks.
//
// Headers Applied:
// - Content-Security-Policy: Restricts resource loading to prevent XSS
// - X-Content-Type-Options: Prevents MIME-sniffing attacks
// - X-Frame-Options: Prevents clickjacking
// - X-XSS-Protection: Legacy XSS filter for older browsers
// - Strict-Transport-Security: Enforces HTTPS (only useful if TLS is enabled)
func securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Content Security Policy - Defense in depth against XSS
		// Allows inline scripts/styles (required for current UI implementation)
		// In production, consider migrating to nonce-based CSP for stronger protection
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' 'unsafe-inline'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data:; "+
				"connect-src 'self'; "+
				"font-src 'self'; "+
				"frame-ancestors 'none'")

		// Prevent MIME-sniffing attacks
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// Prevent clickjacking by disallowing iframe embedding
		w.Header().Set("X-Frame-Options", "DENY")

		// Legacy XSS Protection for older browsers (modern browsers rely on CSP)
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		// Strict-Transport-Security (HSTS)
		// Only effective if Atlas is served over HTTPS (recommended for production)
		// If behind a reverse proxy with TLS termination, this is safe to include
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

		// Referrer-Policy - Control referrer information leakage
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Permissions-Policy - Disable unnecessary browser features
		w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()")

		next.ServeHTTP(w, r)
	})
}
