import type { GraphState, GraphUpdate } from "@/types";
import { HUB_RELATIONSHIP_TYPE } from "@/types";
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
import { getHubNodes, getHubMembers, getHubSummaries } from "./entity-types";

export const toolDefinitions = [
  {
    name: "create_node",
    description:
      "Create a new entity node in the knowledge graph. IMPORTANT: Before calling this tool, check the Hub Summaries in your context for the current graph structure. If a node with the same label already exists, do NOT create a duplicate — instead use create_relationship. Every node MUST be connected to a hub. Use get_hub_context to see available hubs and their members before creating nodes.",
    input_schema: {
      type: "object" as const,
      properties: {
        label: {
          type: "string",
          description: "The name/label of the entity in the organisation's own language",
        },
        type: {
          type: "string",
          description: "Freeform descriptive type (e.g., 'role', 'workflow', 'concept', 'tool', 'aspiration'). Use existing types when possible.",
        },
        hub_id: {
          type: "string",
          description: "ID of the hub node this entity belongs to. Check 'Hub Nodes' in your context for available hubs and their IDs. Use the Emergent hub if unsure where the entity belongs.",
        },
        hub_description: {
          type: "string",
          description: "Optional: why this entity belongs to this hub (e.g., 'core delivery method', 'primary customer segment')",
        },
        description: {
          type: "string",
          description: "A brief description of this entity in the organisation's context",
        },
      },
      required: ["label", "type", "hub_id", "description"],
    },
  },
  {
    name: "update_node",
    description:
      "Update an existing node's label, type, description, or hub assignment when new information refines your understanding.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "The node ID to update" },
        label: { type: "string", description: "Updated label" },
        type: { type: "string", description: "Updated descriptive type" },
        new_hub_id: { type: "string", description: "Move node to a different hub (replaces current primary hub)" },
        description: { type: "string", description: "Updated description" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_node",
    description: "Remove a node that was created in error or is no longer relevant. Cannot delete hub nodes.",
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
    description: "Create a relationship between two existing nodes. Use this when you discover how entities relate. Can also connect hub nodes to each other.",
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
    name: "get_hub_context",
    description: "Retrieve detailed context for a specific hub — its member nodes, their relationships, and tensions. Use this before answering questions about a specific area of the ontology.",
    input_schema: {
      type: "object" as const,
      properties: {
        hub_id: { type: "string", description: "The hub node ID to get context for" },
      },
      required: ["hub_id"],
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
  return { x: 150 + col * 250, y: 250 + row * 200 }; // y=250 to leave room for hub row at top
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
      // Validate hub_id exists and is a hub node
      const hubId = input.hub_id as string;
      const hubNode = graphState.nodes.find((n) => n.id === hubId && n.is_hub);
      if (!hubNode) {
        // Try to find by attractor_id (backwards compat with old attractor slugs)
        const hubBySlug = graphState.nodes.find(
          (n) => n.is_hub && n.properties?.attractor_id === hubId
        );
        if (!hubBySlug) {
          const availableHubs = getHubNodes(graphState)
            .map((h) => `${h.id} ("${h.label}")`)
            .join(", ");
          return {
            output: `Error: hub_id "${hubId}" not found. Available hubs: ${availableHubs}`,
            updates: [],
            updatedGraph: graphState,
          };
        }
      }

      const { state, node } = addNode(
        graphState,
        input.label as string,
        input.type as string,
        input.description as string,
        getAutoPosition(),
        input.properties as Record<string, string> | undefined,
        hubId,
        input.hub_description as string | undefined
      );

      const hubLabel = hubNode?.label ?? graphState.nodes.find(
        (n) => n.is_hub && n.properties?.attractor_id === hubId
      )?.label ?? hubId;

      return {
        output: `Node created: "${node.label}" (${node.type}) → hub "${hubLabel}" with id ${node.id}`,
        updates: [{ type: "node_created", label: node.label }],
        updatedGraph: state,
      };
    }
    case "update_node": {
      const targetNode = graphState.nodes.find((n) => n.id === input.id);
      if (targetNode?.is_hub) {
        // Hub nodes can only have label and description updated
        const hubUpdates: Partial<{ label: string; description: string }> = {};
        if (input.label) hubUpdates.label = input.label as string;
        if (input.description) hubUpdates.description = input.description as string;
        const state = updateNode(graphState, input.id as string, hubUpdates);
        return {
          output: `Hub node ${input.id} updated`,
          updates: [{ type: "node_updated", label: (input.label as string) || (input.id as string) }],
          updatedGraph: state,
        };
      }

      const updates: Partial<{ label: string; description: string; type: string }> = {};
      if (input.label) updates.label = input.label as string;
      if (input.description) updates.description = input.description as string;
      if (input.type) updates.type = input.type as string;

      const state = updateNode(
        graphState,
        input.id as string,
        updates,
        input.new_hub_id as string | undefined
      );
      return {
        output: `Node ${input.id} updated`,
        updates: [{ type: "node_updated", label: (input.label as string) || (input.id as string) }],
        updatedGraph: state,
      };
    }
    case "delete_node": {
      const node = graphState.nodes.find((n) => n.id === input.id);
      if (node?.is_hub) {
        return {
          output: `Error: cannot delete hub node "${node.label}". Hub nodes are structural anchors.`,
          updates: [],
          updatedGraph: graphState,
        };
      }
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
      // Prevent deleting belongs_to_hub relationships via this tool
      const rel = graphState.relationships.find((r) => r.id === input.id);
      if (rel?.type === HUB_RELATIONSHIP_TYPE) {
        return {
          output: `Error: cannot delete hub membership relationship. Use update_node with new_hub_id to reassign hubs.`,
          updates: [],
          updatedGraph: graphState,
        };
      }
      const state = deleteRelationship(graphState, input.id as string);
      return {
        output: `Relationship ${input.id} deleted`,
        updates: [{ type: "relationship_deleted", label: input.id as string }],
        updatedGraph: state,
      };
    }
    case "get_hub_context": {
      const hub = graphState.nodes.find((n) => n.id === input.hub_id && n.is_hub);
      if (!hub) {
        return {
          output: `Error: hub "${input.hub_id}" not found.`,
          updates: [],
          updatedGraph: graphState,
        };
      }

      const members = getHubMembers(hub.id, graphState);
      const memberIds = new Set(members.map((m) => m.id));

      // Get relationships between members (not hub relationships)
      const memberRels = graphState.relationships.filter(
        (r) =>
          r.type !== HUB_RELATIONSHIP_TYPE &&
          (memberIds.has(r.sourceId) || memberIds.has(r.targetId))
      );

      // Get tensions involving members
      const tensions = graphState.tensions.filter(
        (t) => t.status === "unresolved" && t.relatedNodeIds.some((id) => memberIds.has(id))
      );

      const memberLines = members.map(
        (m) => `  - "${m.label}" (type: ${m.type}, id: ${m.id}) — ${m.description}`
      );
      const relLines = memberRels.map((r) => {
        const src = graphState.nodes.find((n) => n.id === r.sourceId);
        const tgt = graphState.nodes.find((n) => n.id === r.targetId);
        return `  - "${src?.label}" --[${r.type}]--> "${tgt?.label}"${r.description ? ` (${r.description})` : ""} (id: ${r.id})`;
      });
      const tensionLines = tensions.map((t) => {
        const labels = t.relatedNodeIds
          .map((id) => graphState.nodes.find((n) => n.id === id)?.label || id)
          .join(", ");
        return `  - "${t.description}" (involves: ${labels})`;
      });

      const output = [
        `Hub: "${hub.label}" (${hub.description})`,
        `Members (${members.length}):`,
        memberLines.length > 0 ? memberLines.join("\n") : "  (no members yet)",
        `\nRelationships (${memberRels.length}):`,
        relLines.length > 0 ? relLines.join("\n") : "  (none)",
        `\nUnresolved Tensions (${tensions.length}):`,
        tensionLines.length > 0 ? tensionLines.join("\n") : "  (none)",
      ].join("\n");

      return {
        output,
        updates: [],
        updatedGraph: graphState,
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
