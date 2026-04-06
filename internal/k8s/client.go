package k8s

import (
	"net/http"
	"os"
	"path/filepath"
	"time"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/util/homedir"
)

type Client struct {
	Clientset *kubernetes.Clientset
	Config    *rest.Config
}

func NewClient() (*Client, error) {
	config, err := rest.InClusterConfig()
	if err != nil {
		kubeconfig := filepath.Join(homedir.HomeDir(), ".kube", "config")
		config, err = clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, err
		}
	}

	// Tune for higher concurrent load (50+ users)
	config.QPS = 50.0  // Queries per second
	config.Burst = 100 // Burst allowance for spike traffic

	// Wrap the existing transport to configure connection pooling
	// Don't replace config.Transport as it may have TLS settings
	if config.WrapTransport != nil {
		baseTransport := config.WrapTransport(http.DefaultTransport)
		if httpTransport, ok := baseTransport.(*http.Transport); ok {
			httpTransport.MaxIdleConns = 200
			httpTransport.MaxIdleConnsPerHost = 50
			httpTransport.IdleConnTimeout = 90 * time.Second
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return &Client{
		Clientset: clientset,
		Config:    config,
	}, nil
}

func NewClientAuto() (*kubernetes.Clientset, KubeMeta, error) {
	// 1) Try kubeconfig (similar intent to config.load_kube_config()) [file:1]
	if cs, meta, err := newFromKubeconfig(); err == nil {
		return cs, meta, nil
	}

	// 2) Fallback to in-cluster
	cfg, err := rest.InClusterConfig()
	if err != nil {
		return nil, KubeMeta{Mode: "none"}, err
	}
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, KubeMeta{Mode: "incluster"}, err
	}
	return cs, KubeMeta{Mode: "incluster"}, nil
}

func newFromKubeconfig() (*kubernetes.Clientset, KubeMeta, error) {
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	// respect KUBECONFIG if set
	if kc := os.Getenv("KUBECONFIG"); kc != "" {
		loadingRules.ExplicitPath = kc
	} else {
		home, _ := os.UserHomeDir()
		if home != "" {
			loadingRules.ExplicitPath = filepath.Join(home, ".kube", "config")
		}
	}

	overrides := &clientcmd.ConfigOverrides{}
	cc := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, overrides)

	rawCfg, err := cc.RawConfig()
	if err != nil {
		return nil, KubeMeta{Mode: "kubeconfig"}, err
	}
	restCfg, err := cc.ClientConfig()
	if err != nil {
		return nil, KubeMeta{Mode: "kubeconfig"}, err
	}

	cs, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, KubeMeta{Mode: "kubeconfig"}, err
	}

	ctxName := rawCfg.CurrentContext
	clusterName := ""
	if c, ok := rawCfg.Contexts[ctxName]; ok && c != nil {
		clusterName = c.Cluster
	}

	return cs, KubeMeta{
		Mode:        "kubeconfig",
		ContextName: ctxName,
		ClusterName: clusterName,
	}, nil
}

// NewClientFromConfig creates a new client from a specific kubeconfig path.
// This is used for multi-cluster support where each cluster has its own kubeconfig.
func NewClientFromConfig(kubeconfigPath string) (*Client, error) {
	config, err := clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	if err != nil {
		return nil, err
	}

	// Tune for higher concurrent load
	config.QPS = 50.0
	config.Burst = 100

	// Configure connection pooling
	if config.WrapTransport != nil {
		baseTransport := config.WrapTransport(http.DefaultTransport)
		if httpTransport, ok := baseTransport.(*http.Transport); ok {
			httpTransport.MaxIdleConns = 200
			httpTransport.MaxIdleConnsPerHost = 50
			httpTransport.IdleConnTimeout = 90 * time.Second
		}
	}

	clientset, err := kubernetes.NewForConfig(config)
	if err != nil {
		return nil, err
	}

	return &Client{
		Clientset: clientset,
		Config:    config,
	}, nil
}
