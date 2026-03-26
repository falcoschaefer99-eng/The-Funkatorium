// ============ TOOLS V2 — BARREL ============
// Aggregates all TOOL_DEFS and dispatches executeTool(name, args, context).
// 13 files → ~32 tools (collapsed from ~50 old tools via action dispatch pattern).

import type { ToolContext } from "./context";

import { TOOL_DEFS as wakeDefs, handleTool as handleWake } from "./wake";
import { TOOL_DEFS as memoryDefs, handleTool as handleMemory } from "./memory";
import { TOOL_DEFS as connectionsDefs, handleTool as handleConnections } from "./connections";
import { TOOL_DEFS as identityDefs, handleTool as handleIdentity } from "./identity";
import { TOOL_DEFS as feelingDefs, handleTool as handleFeeling } from "./feeling";
import { TOOL_DEFS as commsDefs, handleTool as handleComms } from "./comms";
import { TOOL_DEFS as deeperDefs, handleTool as handleDeeper } from "./deeper";
import { TOOL_DEFS as safetyDefs, handleTool as handleSafety } from "./safety";
import { TOOL_DEFS as territoryDefs, handleTool as handleTerritory } from "./territory";
import { TOOL_DEFS as searchDefs, handleTool as handleSearch } from "./search";
import { TOOL_DEFS as entityDefs, handleTool as handleEntity } from "./entity";
import { TOOL_DEFS as proposeDefs, handleTool as handlePropose } from "./propose";
import { TOOL_DEFS as healthDefs, handleTool as handleHealth } from "./health";
import { TOOL_DEFS as timelineDefs, handleTool as handleTimeline } from "./timeline";

// ============ AGGREGATED TOOL DEFINITIONS ============

export const TOOL_DEFS = [
	...wakeDefs,
	...memoryDefs,
	...connectionsDefs,
	...identityDefs,
	...feelingDefs,
	...commsDefs,
	...deeperDefs,
	...safetyDefs,
	...territoryDefs,
	...searchDefs,
	...entityDefs,
	...proposeDefs,
	...healthDefs,
	...timelineDefs
];

// ============ TOOL DISPATCH TABLE ============
// Maps tool name → handler module. Each module handles all its own action variants.

const TOOL_MODULES: Record<string, (name: string, args: any, context: ToolContext) => Promise<any>> = {
	// Wake
	mind_wake: handleWake,
	mind_wake_log: handleWake,

	// Memory
	mind_observe: handleMemory,
	mind_query: handleMemory,
	mind_pull: handleMemory,
	mind_edit: handleMemory,

	// Connections
	mind_link: handleConnections,
	mind_loop: handleConnections,

	// Identity
	mind_identity: handleIdentity,
	mind_anchor: handleIdentity,
	mind_vow: handleIdentity,

	// Feeling
	mind_desire: handleFeeling,
	mind_relate: handleFeeling,
	mind_state: handleFeeling,

	// Comms
	mind_letter: handleComms,
	mind_context: handleComms,

	// Deeper
	mind_dream: handleDeeper,
	mind_subconscious: handleDeeper,
	mind_maintain: handleDeeper,

	// Safety
	mind_consent: handleSafety,
	mind_trigger: handleSafety,

	// Territory
	mind_territory: handleTerritory,

	// Search
	mind_search: handleSearch,

	// Entity
	mind_entity: handleEntity,

	// Daemon Intelligence (Sprint 4)
	mind_propose: handlePropose,
	mind_health: handleHealth,

	// Timeline (Sprint 6)
	mind_timeline: handleTimeline
};

// ============ EXECUTE TOOL ============

export async function executeTool(name: string, args: any, context: ToolContext): Promise<any> {
	const handler = TOOL_MODULES[name];

	if (!handler) {
		throw new Error(`Unknown tool: ${name}. Available: ${Object.keys(TOOL_MODULES).join(", ")}`);
	}

	return handler(name, args ?? {}, context);
}

// ============ EXPORTS ============

export type { ToolContext };
