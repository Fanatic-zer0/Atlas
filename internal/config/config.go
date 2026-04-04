package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Config represents the application configuration
type Config struct {
	Cache    CacheConfig    `yaml:"cache"`
	Clusters []ClusterEntry `yaml:"clusters"`
	Server   ServerConfig   `yaml:"server"`
	Features FeaturesConfig `yaml:"features"`
}

// CacheConfig defines cache settings
type CacheConfig struct {
	Type  string      `yaml:"type"` // "memory" or "redis"
	Redis RedisConfig `yaml:"redis"`
}

// RedisConfig defines Redis connection settings
type RedisConfig struct {
	Addr     string `yaml:"addr"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

// ClusterEntry defines a Kubernetes cluster
type ClusterEntry struct {
	ID         string `yaml:"id"`
	Name       string `yaml:"name"`
	Kubeconfig string `yaml:"kubeconfig"`
	APIServer  string `yaml:"api_server"`
	Region     string `yaml:"region"`
}

// ServerConfig defines HTTP server settings
type ServerConfig struct {
	Port int `yaml:"port"`
}

// FeaturesConfig defines feature flags
type FeaturesConfig struct {
	MultiCluster bool `yaml:"multi_cluster"`
}

// Load reads and parses the configuration file
func Load(configPath string) (*Config, error) {
	// Check if file exists
	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return nil, fmt.Errorf("configuration file not found: %s\nPlease create config.yaml from config.yaml.example", configPath)
	}

	// Read file
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	// Parse YAML
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	// Apply defaults
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Cache.Type == "" {
		cfg.Cache.Type = "memory"
	}
	if cfg.Cache.Redis.Addr == "" {
		cfg.Cache.Redis.Addr = "localhost:6379"
	}

	return &cfg, nil
}

// LoadWithEnvOverrides loads config and applies environment variable overrides
func LoadWithEnvOverrides(configPath string) (*Config, error) {
	cfg, err := Load(configPath)
	if err != nil {
		return nil, err
	}

	// Environment variable overrides
	if cacheType := os.Getenv("CACHE_TYPE"); cacheType != "" {
		cfg.Cache.Type = cacheType
	}
	if redisAddr := os.Getenv("REDIS_ADDR"); redisAddr != "" {
		cfg.Cache.Redis.Addr = redisAddr
	}
	if redisPass := os.Getenv("REDIS_PASSWORD"); redisPass != "" {
		cfg.Cache.Redis.Password = redisPass
	}
	if multiCluster := os.Getenv("MULTI_CLUSTER"); multiCluster == "true" {
		cfg.Features.MultiCluster = true
	} else if multiCluster == "false" {
		cfg.Features.MultiCluster = false
	}

	return cfg, nil
}

// Validate checks if the configuration is valid
func (c *Config) Validate() error {
	// If multi-cluster is enabled, require at least one cluster
	if c.Features.MultiCluster && len(c.Clusters) == 0 {
		return fmt.Errorf("multi-cluster mode is enabled but no clusters are defined in config.yaml")
	}

	// Validate cluster configurations
	clusterIDs := make(map[string]bool)
	for i, cluster := range c.Clusters {
		if cluster.ID == "" {
			return fmt.Errorf("cluster at index %d is missing 'id' field", i)
		}
		if cluster.Name == "" {
			return fmt.Errorf("cluster '%s' is missing 'name' field", cluster.ID)
		}
		if cluster.Kubeconfig == "" {
			return fmt.Errorf("cluster '%s' is missing 'kubeconfig' field", cluster.ID)
		}

		// Check for duplicate IDs
		if clusterIDs[cluster.ID] {
			return fmt.Errorf("duplicate cluster ID: %s", cluster.ID)
		}
		clusterIDs[cluster.ID] = true

		// Check if kubeconfig file exists
		if _, err := os.Stat(cluster.Kubeconfig); os.IsNotExist(err) {
			return fmt.Errorf("kubeconfig file not found for cluster '%s': %s", cluster.ID, cluster.Kubeconfig)
		}
	}

	// Validate cache type
	if c.Cache.Type != "memory" && c.Cache.Type != "redis" {
		return fmt.Errorf("invalid cache type: %s (must be 'memory' or 'redis')", c.Cache.Type)
	}

	return nil
}
