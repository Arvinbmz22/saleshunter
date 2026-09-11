"use client";

import { STAGE_LABELS } from "@/lib/pipeline/labels";
import type { PipelineStage, ProgressEvent } from "@/types/lead";

const ORDER = Object.keys(STAGE_LABELS) as PipelineStage[];

export function SearchStatus({
  running,
  events,
}: {
  running: boolean;
  events: ProgressEvent[];
}) {
  const current = events.at(-1)?.stage;
  if (!running && events.length === 0) return null;
  return (
    <div className="stages">
      {ORDER.map((stage) => {
        const hit = events.find((e) => e.stage === stage);
        return (
          <span key={stage} className={`stage ${current === stage ? "active" : ""}`}>
            {STAGE_LABELS[stage]}
            {hit?.detail && current === stage ? ` — ${hit.detail}` : ""}
          </span>
        );
      })}
    </div>
  );
}
