// src/module.ts
import { DataSourcePlugin } from "@grafana/data";

// src/datasource.ts
import {
  DataSourceApi,
  LiveChannelScope
} from "@grafana/data";
import { getGrafanaLiveSrv } from "@grafana/runtime";
import { merge } from "rxjs";
var LiveDatasource = class extends DataSourceApi {
  constructor(instanceSettings) {
    super(instanceSettings);
  }
  query(request) {
    const streams = request.targets.map(
      (target) => getGrafanaLiveSrv().getDataStream({
        addr: {
          scope: LiveChannelScope.DataSource,
          stream: this.uid,
          path: `${target.refId}-${sanitizeChannelPath(target.pattern ?? "")}`,
          data: { pattern: target.pattern ?? "" }
        }
      })
    );
    return merge(...streams);
  }
  async testDatasource() {
    return { status: "success", message: "ok" };
  }
};
function sanitizeChannelPath(pattern) {
  return pattern.replace(/[^A-z0-9_\-/=.]/g, "_");
}

// src/components/QueryEditor.tsx
import { InlineField, Input } from "@grafana/ui";
import { jsx } from "react/jsx-runtime";
function QueryEditor({ query, onChange, onRunQuery }) {
  const onPatternChange = (event) => {
    onChange({ ...query, pattern: event.target.value });
  };
  return /* @__PURE__ */ jsx(
    InlineField,
    {
      label: "Metric prefix",
      labelWidth: 24,
      tooltip: "Prefix match against stream-hub metric names, e.g. vllm., gpu.asus_dual, vram_oc.",
      children: /* @__PURE__ */ jsx(
        Input,
        {
          placeholder: "vllm.",
          value: query.pattern ?? "",
          onChange: onPatternChange,
          onBlur: onRunQuery
        }
      )
    }
  );
}

// src/module.ts
var plugin = new DataSourcePlugin(LiveDatasource).setQueryEditor(
  QueryEditor
);
export {
  plugin
};
//# sourceMappingURL=module.esm.js.map
