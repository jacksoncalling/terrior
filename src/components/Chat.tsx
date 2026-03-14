"use client";

import { useState, useRef, useEffect } from "react";
import ChatMessage from "./ChatMessage";
import type { ChatMessage as ChatMessageType, GraphUpdate } from "@/types";

interface ChatProps {
  messages: ChatMessageType[];
  onSend: (message: string) => void;
  onExtract: (text: string) => void;
  isLoading: boolean;
  graphUpdatesMap: Record<string, GraphUpdate[]>;
}

export default function Chat({
  messages,
  onSend,
  onExtract,
  isLoading,
  graphUpdatesMap,
}: ChatProps) {
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"chat" | "narrative">("chat");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    if (textareaRef.current && mode === "chat") {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input, mode]);

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;

    if (mode === "narrative") {
      onExtract(trimmed);
    } else {
      onSend(trimmed);
    }
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && mode === "chat") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
        <div>
          <h2 className="text-sm font-semibold text-stone-800">TERROIR</h2>
          <p className="text-[10px] text-stone-500">Organisational listening</p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setMode("chat")}
            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
              mode === "chat"
                ? "bg-stone-800 text-white"
                : "bg-stone-100 text-stone-500 hover:bg-stone-200"
            }`}
          >
            Chat
          </button>
          <button
            onClick={() => setMode("narrative")}
            className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
              mode === "narrative"
                ? "bg-stone-800 text-white"
                : "bg-stone-100 text-stone-500 hover:bg-stone-200"
            }`}
          >
            Extract
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && mode === "chat" && (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-[280px] text-center">
              <p className="text-xs text-stone-500">
                Tell me about the organisation you&apos;re working with. Who are they, what do they do, and what are you trying to help them build?
              </p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            graphUpdates={graphUpdatesMap[msg.id]}
          />
        ))}
        {isLoading && (
          <div className="flex justify-start mb-3">
            <div className="rounded-2xl bg-stone-100 px-4 py-3">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-stone-400 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-stone-200 px-4 py-2.5">
        {mode === "narrative" ? (
          <div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste a narrative, interview transcript, or meeting notes..."
              rows={6}
              className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
              disabled={isLoading}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              className="mt-2 w-full rounded-xl bg-stone-800 py-2 text-xs font-medium text-white hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? "Extracting..." : "Extract entities & relationships"}
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe the organisation..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-800 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none"
              disabled={isLoading}
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isLoading}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-stone-800 text-white transition-colors hover:bg-stone-700 disabled:bg-stone-300 disabled:cursor-not-allowed"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
