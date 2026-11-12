import { DataSourcePlugin } from "@grafana/data";

import { LiveDatasource } from "./datasource";
import { QueryEditor } from "./components/QueryEditor";
import { LiveDSOptions } from "./datasource";
import { LiveQuery } from "./types";

export const plugin = new DataSourcePlugin<LiveDatasource, LiveQuery, LiveDSOptions>(LiveDatasource).setQueryEditor(
  QueryEditor
);
