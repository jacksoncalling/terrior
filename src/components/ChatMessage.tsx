"use client";

import type { GraphUpdate } from "@/types";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
  graphUpdates?: GraphUpdate[];
}

const updateLabels: Record<string, string> = {
  node_created: "Added",
  node_updated: "Updated",
  node_deleted: "Removed",
  relationship_created: "Linked",
  relationship_deleted: "Unlinked",
  tension_flagged: "Tension",
  tension_resolved: "Resolved",
  evaluative_signal_set: "Signal",
};

export default function ChatMessage({
  role,
  content,
  graphUpdates,
}: ChatMessageProps) {
  return (
    <div
      className={`flex ${role === "user" ? "justify-end" : "justify-start"} mb-3`}
    >
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          role === "user"
            ? "bg-stone-800 text-stone-100"
            : "bg-stone-100 text-stone-800"
        }`}
      >
        <div className="whitespace-pre-wrap">{content}</div>
        {graphUpdates && graphUpdates.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-stone-200/50 pt-2">
            {graphUpdates.map((update, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-stone-200/60 px-2 py-0.5 text-xs text-stone-600"
              >
                <span className="font-medium">
                  {updateLabels[update.type] || update.type}:
                </span>
                <span className="truncate max-w-[120px]">{update.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
