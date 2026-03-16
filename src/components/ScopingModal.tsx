"use client";

/**
 * ScopingModal — focused scoping dialogue with Haiku.
 *
 * A full-screen overlay with a centred conversation panel. Separate from
 * the main Chat tab — different visual style, separate message state.
 *
 * Flow:
 *   1. Modal opens empty → consultant clicks "Begin" to start
 *   2. Haiku asks 4-5 focused questions one at a time
 *   3. When Haiku produces a brief, a preview card appears below the messages
 *   4. Consultant clicks "Save to project" → brief is persisted, modal closes
 *
 * The <brief> JSON block is stripped from the displayed message text — only
 * the natural language portion is shown to the consultant.
 */

import { useState, useRef, useEffect } from "react";
import type { ProjectBrief } from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScopingMessage {
  id: string;
  role: "user" | "assistant";
  content: string; // already stripped of <brief> blocks
}

interface ScopingModalProps {
  isOpen: boolean;
  messages: ScopingMessage[];
  isLoading: boolean;
  pendingBrief?: ProjectBrief;       // set when Haiku signals completion
  onSend: (text: string) => void;    // called for each user message
  onSaveBrief: (brief: ProjectBrief) => void;
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ScopingModal({
  isOpen,
  messages,
  isLoading,
  pendingBrief,
  onSend,
  onSaveBrief,
  onClose,
}: ScopingModalProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && messages.length > 0) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, messages.length]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasStarted = messages.length > 0;

  return (
    // Full-screen dark overlay
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 backdrop-blur-sm"
      onClick={(e) => {
        // Close on backdrop click (only if no pending brief awaiting save)
        if (e.target === e.currentTarget && !pendingBrief) onClose();
      }}
    >
      {/* Panel */}
      <div className="relative flex flex-col bg-white rounded-2xl shadow-2xl w-full max-w-[460px] mx-4 h-[600px]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-100">
          <div>
            <h2 className="text-sm font-semibold text-stone-800">
              Project Scoping
            </h2>
            <p className="text-[10px] text-stone-400">
              Haiku will ask 4–5 questions to configure your project brief
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700 text-sm leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Message area */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {!hasStarted ? (
            // Empty state — begin button
            <div className="h-full flex flex-col items-center justify-center text-center gap-4">
              <div className="space-y-1">
                <p className="text-sm text-stone-700 font-medium">
                  Ready to set up your project
                </p>
                <p className="text-xs text-stone-400 max-w-[280px] leading-relaxed">
                  A short conversation will produce a project brief that guides
                  how the AI extracts and synthesises your documents.
                </p>
              </div>
              <button
                onClick={() => onSend("Hello, let's set up this project.")}
                className="rounded-xl bg-stone-800 px-5 py-2 text-xs font-medium text-white hover:bg-stone-700 transition-colors"
              >
                Begin
              </button>
            </div>
          ) : (
            <>
              {/* Message bubbles */}
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      msg.role === "user"
                        ? "bg-stone-800 text-white"
                        : "bg-stone-100 text-stone-700"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl bg-stone-100 px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}

              {/* Pending brief preview card */}
              {pendingBrief && (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-stone-600 uppercase tracking-wide">
                      Brief ready
                    </p>
                    <span className="text-[10px] text-stone-400">
                      {pendingBrief.abstractionLayer.replace(/_/g, " ")}
                    </span>
                  </div>

                  {pendingBrief.sector && (
                    <p className="text-xs text-stone-600">
                      <span className="font-medium">Sector:</span>{" "}
                      {pendingBrief.sector}
                    </p>
                  )}
                  {pendingBrief.discoveryGoal && (
                    <p className="text-xs text-stone-600">
                      <span className="font-medium">Goal:</span>{" "}
                      {pendingBrief.discoveryGoal}
                    </p>
                  )}
                  {pendingBrief.summary && (
                    <p className="text-xs text-stone-500 leading-relaxed">
                      {pendingBrief.summary}
                    </p>
                  )}

                  <button
                    onClick={() => onSaveBrief(pendingBrief)}
                    className="w-full rounded-lg bg-stone-800 py-2 text-xs font-medium text-white hover:bg-stone-700 transition-colors"
                  >
                    Save to project
                  </button>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input — only visible after dialogue has started and no pending brief */}
        {hasStarted && !pendingBrief && (
          <div className="border-t border-stone-100 px-4 py-3 flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Your answer…"
              disabled={isLoading}
              className="flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none disabled:bg-stone-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-stone-800 text-white transition-colors hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
