package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"home-llm-server/grafana-live-ds/pkg/plugin"
)

func main() {
	// Manage listens for requests from Grafana and manages the lifecycle of
	// datasource instances: the factory is called per datasource ID, Dispose
	// when configuration changes.
	if err := datasource.Manage("home-llm-live", plugin.NewDatasource, datasource.ManageOpts{}); err != nil {
		log.DefaultLogger.Error(err.Error())
		os.Exit(1)
	}
}
