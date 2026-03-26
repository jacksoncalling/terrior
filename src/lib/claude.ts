import Anthropic from "@anthropic-ai/sdk";
import type { GraphState, GraphUpdate, AttractorPreset } from "@/types";
import { toolDefinitions, executeTool, resetNodeCounter } from "./tools";
import { buildSystemPrompt } from "./system-prompt";

const MAX_TOOL_ITERATIONS = 10;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface ConversationResult {
  response: string;
  graphUpdates: GraphUpdate[];
  updatedGraph: GraphState;
}

export async function runConversation(
  messages: ConversationMessage[],
  graphState: GraphState,
  attractorPreset?: AttractorPreset
): Promise<ConversationResult> {
  let currentGraph = structuredClone(graphState);
  const allUpdates: GraphUpdate[] = [];
  resetNodeCounter();

  // Build system prompt ONCE per request (perf fix)
  const systemPrompt = buildSystemPrompt(currentGraph, attractorPreset);

  // Trim message history to last 20 messages (perf fix)
  const trimmedMessages = messages.length > 20
    ? messages.slice(-20)
    : messages;

  const claudeMessages: Anthropic.MessageParam[] = trimmedMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    tools: toolDefinitions as Anthropic.Tool[],
    messages: claudeMessages,
  });

  let iterations = 0;

  // Tool use loop with iteration cap
  while (response.stop_reason === "tool_use" && iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    const toolUseBlocks = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const toolUse of toolUseBlocks) {
      const result = executeTool(
        toolUse.name,
        toolUse.input as Record<string, unknown>,
        currentGraph
      );
      currentGraph = result.updatedGraph;
      allUpdates.push(...result.updates);

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.output,
      });
    }

    claudeMessages.push({ role: "assistant", content: response.content });
    claudeMessages.push({ role: "user", content: toolResults });

    // Reuse same system prompt (don't regenerate — perf fix)
    response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools: toolDefinitions as Anthropic.Tool[],
      messages: claudeMessages,
    });
  }

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  const responseText = textBlocks.map((b) => b.text).join("\n\n");

  return {
    response: responseText,
    graphUpdates: allUpdates,
    updatedGraph: currentGraph,
  };
}
