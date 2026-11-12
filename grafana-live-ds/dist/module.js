define(["@grafana/data","@grafana/runtime","rxjs","@grafana/ui","react/jsx-runtime"], function (__d0, __d1, __d2, __d3, __d4) {
// src/module.ts
var { DataSourcePlugin } = __d0;

// src/datasource.ts
var { DataSourceApi,
  LiveChannelScope } = __d0;
var { getGrafanaLiveSrv } = __d1;
var { merge } = __d2;
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
var { InlineField, Input } = __d3;
var { jsx } = __d4;
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
return { plugin };


});
