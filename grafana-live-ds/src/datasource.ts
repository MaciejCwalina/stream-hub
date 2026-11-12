import {
  DataSourceApi,
  DataSourceInstanceSettings,
  DataQueryRequest,
  DataSourceJsonData,
  DataQueryResponse,
  LiveChannelScope,
  TestDataSourceResponse,
} from "@grafana/data";
import { getGrafanaLiveSrv } from "@grafana/runtime";
import { Observable, merge } from "rxjs";

import { LiveQuery } from "./types";

export interface LiveDSOptions extends DataSourceJsonData {
  hubUrl?: string;
}

/**
 * Streaming datasource: each query opens a Grafana Live channel (scoped to this
 * datasource) that the Go backend subscribes to on the stream-hub WebSocket.
 * Frames are pushed to the browser as they arrive — no polling.
 */
export class LiveDatasource extends DataSourceApi<LiveQuery, LiveDSOptions> {
  constructor(instanceSettings: DataSourceInstanceSettings<LiveDSOptions>) {
    super(instanceSettings);
  }

  query(request: DataQueryRequest<LiveQuery>): Observable<DataQueryResponse> {
    const streams = request.targets.map((target) =>
      getGrafanaLiveSrv().getDataStream({
        addr: {
          scope: LiveChannelScope.DataSource,
          stream: this.uid,
          path: `${target.refId}:${target.pattern ?? ""}`,
          data: { pattern: target.pattern ?? "" },
        },
      })
    );
    // Frames pushed over the live channel are valid streaming responses.
    return merge(...streams) as unknown as Observable<DataQueryResponse>;
  }

  async testDatasource(): Promise<TestDataSourceResponse> {
    // The Go backend CheckHealth already verifies hub reachability.
    return { status: "success", message: "ok" };
  }
}
