import type { GraphState, GraphUpdate } from "@/types";
import {
  addNode,
  updateNode,
  deleteNode,
  addRelationship,
  deleteRelationship,
  flagTension,
  resolveTension,
  setEvaluativeSignal,
} from "./graph-state";

export const toolDefinitions = [
  {
    name: "create_node",
    description:
      "Create a new entity node in the knowledge graph. IMPORTANT: Before calling this tool, check the Current Knowledge Graph in your context for any node with the same or a very similar label. If a matching node already exists, do NOT create a duplicate — instead use create_relationship to connect to that existing node using its ID. Only call create_node when the entity is genuinely absent from the graph. Use the organisation's own vocabulary for labels. The type can be any descriptive category — use existing types from the palette when appropriate, or create new ones that fit the domain.",
    input_schema: {
      type: "object" as const,
      properties: {
        label: {
          type: "string",
          description: "The name/label of the entity in the organisation's own language",
        },
        type: {
          type: "string",
          description: "The entity type (e.g., 'organisation', 'platform', 'process', 'role', 'document_type', 'goal', 'initiative', or any domain-specific type). Use existing types when possible.",
        },
        description: {
          type: "string",
          description: "A brief description of this entity in the organisation's context",
        },
      },
      required: ["label", "type", "description"],
    },
  },
  {
    name: "update_node",
    description:
      "Update an existing node's label, type, or description when new information refines your understanding.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The node ID to update" },
        label: { type: "string", description: "Updated label" },
        type: { type: "string", description: "Updated type" },
        description: { type: "string", description: "Updated description" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_node",
    description: "Remove a node that was created in error or is no longer relevant.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The node ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_relationship",
    description: "Create a relationship between two existing nodes. Use this when you discover how entities relate.",
    input_schema: {
      type: "object" as const,
      properties: {
        source_id: { type: "string", description: "The source node ID" },
        target_id: { type: "string", description: "The target node ID" },
        type: {
          type: "string",
          description: 'The relationship type (e.g., "uses", "contains", "produces", "depends_on", "conflicts_with", "manages", "stores", "enables", "constrains")',
        },
        description: { type: "string", description: "Optional description" },
      },
      required: ["source_id", "target_id", "type"],
    },
  },
  {
    name: "delete_relationship",
    description: "Remove a relationship that was created in error.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The relationship ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "flag_tension",
    description: "Flag a tension or divergence — where perspectives conflict, platform structures don't match practice, or old and new coexist.",
    input_schema: {
      type: "object" as const,
      properties: {
        description: { type: "string", description: "Description of the tension" },
        related_node_ids: {
          type: "array",
          items: { type: "string" },
          description: "IDs of nodes involved in this tension",
        },
      },
      required: ["description", "related_node_ids"],
    },
  },
  {
    name: "resolve_tension",
    description: "Mark a tension as resolved after clarification.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The tension marker ID to resolve" },
      },
      required: ["id"],
    },
  },
  {
    name: "set_evaluative_signal",
    description: "Capture what the organisation values, fears, or is moving toward. Detected through the natural language of conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        label: { type: "string", description: 'The evaluative concept (e.g., "Verlässlichkeit", "speed of delivery")' },
        direction: {
          type: "string",
          enum: ["toward", "away_from", "protecting"],
          description: "Is the organisation moving toward, away from, or protecting this?",
        },
        strength: { type: "number", description: "Signal strength 1 (weak) to 5 (very strong)" },
        source_description: { type: "string", description: "What in the conversation revealed this signal" },
      },
      required: ["label", "direction", "strength", "source_description"],
    },
  },
];

interface ToolResult {
  output: string;
  updates: GraphUpdate[];
  updatedGraph: GraphState;
}

// Counter for auto-positioning new nodes from agent
let nodeCounter = 0;

function getAutoPosition(): { x: number; y: number } {
  const col = nodeCounter % 4;
  const row = Math.floor(nodeCounter / 4);
  nodeCounter++;
  return { x: 150 + col * 250, y: 150 + row * 200 };
}

export function resetNodeCounter(): void {
  nodeCounter = 0;
}

export function executeTool(
  name: string,
  input: Record<string, unknown>,
  graphState: GraphState
): ToolResult {
  switch (name) {
    case "create_node": {
      const { state, node } = addNode(
        graphState,
        input.label as string,
        input.type as string,
        input.description as string,
        getAutoPosition(),
        input.properties as Record<string, string> | undefined
      );
      return {
        output: `Node created: "${node.label}" (${node.type}) with id ${node.id}`,
        updates: [{ type: "node_created", label: node.label }],
        updatedGraph: state,
      };
    }
    case "update_node": {
      const updates: Partial<{ label: string; description: string; type: string }> = {};
      if (input.label) updates.label = input.label as string;
      if (input.description) updates.description = input.description as string;
      if (input.type) updates.type = input.type as string;
      const state = updateNode(graphState, input.id as string, updates);
      return {
        output: `Node ${input.id} updated`,
        updates: [{ type: "node_updated", label: (input.label as string) || (input.id as string) }],
        updatedGraph: state,
      };
    }
    case "delete_node": {
      const node = graphState.nodes.find((n) => n.id === input.id);
      const state = deleteNode(graphState, input.id as string);
      return {
        output: `Node ${input.id} deleted`,
        updates: [{ type: "node_deleted", label: node?.label || (input.id as string) }],
        updatedGraph: state,
      };
    }
    case "create_relationship": {
      const source = graphState.nodes.find((n) => n.id === input.source_id);
      const target = graphState.nodes.find((n) => n.id === input.target_id);
      if (!source || !target) {
        return {
          output: `Error: source or target node not found. Available nodes: ${graphState.nodes.map((n) => `${n.id} ("${n.label}")`).join(", ")}`,
          updates: [],
          updatedGraph: graphState,
        };
      }
      const { state, relationship } = addRelationship(
        graphState,
        input.source_id as string,
        input.target_id as string,
        input.type as string,
        input.description as string | undefined
      );
      return {
        output: `Relationship created: "${source.label}" --[${relationship.type}]--> "${target.label}" with id ${relationship.id}`,
        updates: [{ type: "relationship_created", label: `${source.label} → ${target.label}` }],
        updatedGraph: state,
      };
    }
    case "delete_relationship": {
      const state = deleteRelationship(graphState, input.id as string);
      return {
        output: `Relationship ${input.id} deleted`,
        updates: [{ type: "relationship_deleted", label: input.id as string }],
        updatedGraph: state,
      };
    }
    case "flag_tension": {
      const { state, tension } = flagTension(
        graphState,
        input.description as string,
        input.related_node_ids as string[]
      );
      return {
        output: `Tension flagged: "${tension.description}" (id: ${tension.id})`,
        updates: [{ type: "tension_flagged", label: tension.description }],
        updatedGraph: state,
      };
    }
    case "resolve_tension": {
      const state = resolveTension(graphState, input.id as string);
      return {
        output: `Tension ${input.id} resolved`,
        updates: [{ type: "tension_resolved", label: input.id as string }],
        updatedGraph: state,
      };
    }
    case "set_evaluative_signal": {
      const { state, signal } = setEvaluativeSignal(
        graphState,
        input.label as string,
        input.direction as "toward" | "away_from" | "protecting",
        input.strength as number,
        input.source_description as string
      );
      return {
        output: `Evaluative signal set: "${signal.label}" (${signal.direction}, strength ${signal.strength})`,
        updates: [{ type: "evaluative_signal_set", label: signal.label }],
        updatedGraph: state,
      };
    }
    default:
      return { output: `Unknown tool: ${name}`, updates: [], updatedGraph: graphState };
  }
}
