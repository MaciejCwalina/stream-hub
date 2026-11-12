import { ChangeEvent } from "react";
import { InlineField, Input } from "@grafana/ui";

import { LiveQuery } from "../types";

export interface Props {
  query: LiveQuery;
  onChange: (query: LiveQuery) => void;
  onRunQuery: () => void;
}

export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  const onPatternChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...query, pattern: event.target.value });
  };

  return (
    <InlineField
      label="Metric prefix"
      labelWidth={24}
      tooltip="Prefix match against stream-hub metric names, e.g. vllm., gpu.asus_dual, vram_oc."
    >
      <Input
        placeholder="vllm."
        value={query.pattern ?? ""}
        onChange={onPatternChange}
        onBlur={onRunQuery}
      />
    </InlineField>
  );
}
