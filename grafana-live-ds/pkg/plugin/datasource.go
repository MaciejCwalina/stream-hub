package plugin

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ backend.StreamHandler         = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

const defaultHubURL = "ws://127.0.0.1:9797/stream"

// NewDatasource is the instance factory used by datasource.Manage.
func NewDatasource(_ context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	ds := &Datasource{cfg: DSCfg{HubURL: defaultHubURL}}
	if len(settings.JSONData) > 0 {
		var cfg DSCfg
		if err := json.Unmarshal(settings.JSONData, &cfg); err != nil {
			return nil, fmt.Errorf("unmarshal jsonData: %w", err)
		}

		if cfg.HubURL != "" {
			ds.cfg.HubURL = cfg.HubURL
		}
	}

	return ds, nil
}

type DSCfg struct {
	HubURL string `json:"hubUrl"`
}

type Query struct {
	Pattern string `json:"pattern"`
}

type Datasource struct {
	cfg DSCfg
}

func (d *Datasource) Init(_ backend.DataSourceInstanceSettings) error {
	// Configuration is applied in NewDatasource; kept for interface satisfaction.
	return nil
}

func (d *Datasource) Dispose() {}

func (d *Datasource) CheckHealth(_ context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	client := &http.Client{Timeout: 2 * time.Second}
	healthURL := strings.TrimSuffix(d.cfg.HubURL, "/stream") + "/healthz"
	healthURL = strings.Replace(healthURL, "ws://", "http://", 1)
	healthURL = strings.Replace(healthURL, "wss://", "https://", 1)
	resp, err := client.Get(healthURL)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("cannot reach stream-hub at %s: %v", d.cfg.HubURL, err),
		}, nil
	}

	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: fmt.Sprintf("stream-hub returned HTTP %d", resp.StatusCode),
		}, nil
	}

	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "stream-hub reachable"}, nil
}

// QueryData is not used: this datasource is streaming-only.
func (d *Datasource) QueryData(_ context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	responses := make(backend.Responses, len(req.Queries))
	for _, query := range req.Queries {
		responses[query.RefID] = backend.DataResponse{
			Frames: data.Frames{data.NewFrame("empty")},
		}
	}

	return &backend.QueryDataResponse{Responses: responses}, nil
}
