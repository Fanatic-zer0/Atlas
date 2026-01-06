package network

import (
	"fmt"
	"net"
	"time"
)

type NetworkTestResponse struct {
	Success     bool    `json:"success"`
	Message     string  `json:"message"`
	LatencyMS   float64 `json:"latency_ms"`
	StatusEmoji string  `json:"status_emoji"`
}

type TestRequest struct {
	TestType string `json:"test_type"` // "dns" or "tcp"
	Hostname string `json:"hostname"`
	Port     int    `json:"port"`
}

// DNS resolution (A/AAAA via OS resolver) – matches UI expectation [file:1]
func TestDNS(hostname string) map[string]interface{} {
	startTime := time.Now()
	_, err := net.LookupHost(hostname)
	latency := time.Since(startTime).Milliseconds()

	if err != nil {
		return map[string]interface{}{
			"success":      false,
			"message":      "DNS resolution failed: " + err.Error(),
			"latency_ms":   float64(latency),
			"status_emoji": "✗",
		}
	}

	return map[string]interface{}{
		"success":      true,
		"message":      "DNS resolution successful",
		"latency_ms":   float64(latency),
		"status_emoji": "✓",
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
		"message":      "TCP connection successful",
		"latency_ms":   float64(latency),
		"status_emoji": "✓",
	}
}
