package network

import (
    "crypto/tls"
    "fmt"
    "net"
    "net/http"
    "strings"
    "time"
)

type NetworkTestResponse struct {
    Success     bool    `json:"success"`
    Message     string  `json:"message"`
    LatencyMS   float64 `json:"latency_ms"`
    StatusEmoji string  `json:"status_emoji"`
    StatusCode  int     `json:"status_code,omitempty"`
    ResolvedIP  string  `json:"resolved_ip,omitempty"`
}

type TestRequest struct {
    TestType string `json:"test_type"` // "dns", "tcp", "http", or "https"
    Hostname string `json:"hostname"`
    Port     int    `json:"port"`
    Protocol string `json:"protocol,omitempty"` // "http" or "https"
}

// DNS resolution with IP addresses returned
func TestDNS(hostname string) map[string]interface{} {
    startTime := time.Now()
    ips, err := net.LookupHost(hostname)
    latency := time.Since(startTime).Milliseconds()

    if err != nil {
        return map[string]interface{}{
            "success":      false,
            "message":      "DNS resolution failed: " + err.Error(),
            "latency_ms":   float64(latency),
            "status_emoji": "✗",
        }
    }

    resolvedIP := ""
    if len(ips) > 0 {
        resolvedIP = ips[0]
    }

    return map[string]interface{}{
        "success":      true,
        "message":      fmt.Sprintf("DNS resolved to %s", resolvedIP),
        "latency_ms":   float64(latency),
        "status_emoji": "✓",
        "resolved_ip":  resolvedIP,
    }
}

// TCP connect
func TestTCP(hostname string, port int) map[string]interface{} {
    startTime := time.Now()
    conn, err := net.DialTimeout("tcp",
        fmt.Sprintf("%s:%d", hostname, port),
        5*time.Second)
    latency := time.Since(startTime).Milliseconds()

    if err != nil {
        return map[string]interface{}{
            "success":      false,
            "message":      "TCP connection failed: " + err.Error(),
            "latency_ms":   float64(latency),
            "status_emoji": "✗",
        }
    }

    conn.Close()
    return map[string]interface{}{
        "success":      true,
        "message":      fmt.Sprintf("TCP connection successful to %s:%d", hostname, port),
        "latency_ms":   float64(latency),
        "status_emoji": "✓",
    }
}

// HTTP/HTTPS connectivity test
func TestHTTP(hostname string, useTLS bool) map[string]interface{} {
    protocol := "http"
    if useTLS {
        protocol = "https"
    }

    url := fmt.Sprintf("%s://%s", protocol, hostname)
    
    startTime := time.Now()
    
    // Create HTTP client with timeout and TLS config
    client := &http.Client{
        Timeout: 10 * time.Second,
        Transport: &http.Transport{
            TLSClientConfig: &tls.Config{
                InsecureSkipVerify: false, // Verify certificates by default
            },
            DialContext: (&net.Dialer{
                Timeout: 5 * time.Second,
            }).DialContext,
        },
        // Don't follow redirects for testing
        CheckRedirect: func(req *http.Request, via []*http.Request) error {
            return http.ErrUseLastResponse
        },
    }

    resp, err := client.Get(url)
    latency := time.Since(startTime).Milliseconds()

    if err != nil {
        return map[string]interface{}{
            "success":      false,
            "message":      fmt.Sprintf("%s request failed: %v", protocol, err),
            "latency_ms":   float64(latency),
            "status_emoji": "✗",
        }
    }
    defer resp.Body.Close()

    // Consider 2xx, 3xx, 401, 403 as "reachable" (server responded)
    success := resp.StatusCode < 500
    emoji := "✓"
    if !success {
        emoji = "✗"
    } else if resp.StatusCode >= 400 {
        emoji = "⚠"
    }

    return map[string]interface{}{
        "success":      success,
        "message":      fmt.Sprintf("%s %d: %s", strings.ToUpper(protocol), resp.StatusCode, resp.Status),
        "latency_ms":   float64(latency),
        "status_emoji": emoji,
        "status_code":  resp.StatusCode,
    }
}