"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "@xyflow/react";

function OntologyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  selected,
  style,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const edgeData = data as Record<string, unknown> | undefined;
  const label = (edgeData?.label as string) || "";
  const isHighlighted = edgeData?.highlighted === true;

  // Use inline style from graphStateToFlow (carries highlight/dimmed opacity)
  const edgeStyle = style ?? {
    stroke: selected || isHighlighted ? "#1c1917" : "#d6d3d1",
    strokeWidth: selected || isHighlighted ? 2 : 1.5,
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={edgeStyle}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "all",
              opacity: edgeStyle?.opacity ?? 1,
              transition: "opacity 150ms",
            }}
            className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] text-stone-500 backdrop-blur-sm border border-stone-100"
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(OntologyEdgeComponent);
