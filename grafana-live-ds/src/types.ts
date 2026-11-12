import { DataQuery } from "@grafana/data";

export interface LiveQuery extends DataQuery {
  pattern?: string;
}
