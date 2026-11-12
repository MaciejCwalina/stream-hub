package plugin

import (
	"context"
	"encoding/json"
	"log"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func (d *Datasource) SubscribeStream(_ context.Context, _ *backend.SubscribeStreamRequest) (*backend.SubscribeStreamResponse, error) {
	return &backend.SubscribeStreamResponse{Status: backend.SubscribeStreamStatusOK}, nil
}

func (d *Datasource) PublishStream(_ context.Context, _ *backend.PublishStreamRequest) (*backend.PublishStreamResponse, error) {
	return &backend.PublishStreamResponse{Status: backend.PublishStreamStatusPermissionDenied}, nil
}

type hubMessage struct {
	Type string  `json:"type"`
	Data [][]any `json:"data"` // rows: [metric, unix_ms, value]
}

// RunStream subscribes to the stream-hub and pushes one frame per metric update
// until the channel is closed. Reconnects with a 1s backoff on hub restarts.
func (d *Datasource) RunStream(ctx context.Context, req *backend.RunStreamRequest, sender *backend.StreamSender) error {
	var query Query
	_ = json.Unmarshal(req.Data, &query)

	wsURL := d.cfg.HubURL
	if pattern := strings.TrimSpace(query.Pattern); pattern != "" {
		wsURL += "?metrics=" + url.QueryEscape(pattern)
	}

	for ctx.Err() == nil {
		conn, _, err := websocket.DefaultDialer.DialContext(ctx, wsURL, nil)
		if err != nil {
			log.Printf("home-llm-live: hub dial: %v", err)
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(time.Second):
			}

			continue
		}

		streamErr := d.runConnection(ctx, conn, sender)
		conn.Close()
		if ctx.Err() != nil {
			return ctx.Err()
		}

		if streamErr != nil {
			log.Printf("home-llm-live: stream: %v", streamErr)
		}
	}

	return ctx.Err()
}

func (d *Datasource) runConnection(ctx context.Context, conn *websocket.Conn, sender *backend.StreamSender) error {
	for {
		var msg hubMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return err
		}

		for _, row := range msg.Data {
			if len(row) != 3 {
				continue
			}

			metric, ok1 := row[0].(string)
			ts, ok2 := row[1].(float64)
			value, ok3 := row[2].(float64)
			if !ok1 || !ok2 || !ok3 || metric == "" {
				continue
			}

			frame := data.NewFrame(metric,
				data.NewField("time", nil, []time.Time{time.UnixMilli(int64(ts))}),
				data.NewField(metric, nil, []float64{value}))
			if err := sender.SendFrame(frame, data.IncludeAll); err != nil {
				return err
			}
		}
	}
}
