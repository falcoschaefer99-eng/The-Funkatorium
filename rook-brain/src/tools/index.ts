// ============ TOOLS BARREL ============
// Aggregates all tool definitions and routes handleTool() calls to the right module.

import { TOOL_DEFS as wakeDefs, handleTool as handleWake } from "./wake";
import { TOOL_DEFS as memoryDefs, handleTool as handleMemory } from "./memory";
import { TOOL_DEFS as linksDefs, handleTool as handleLinks } from "./links";
import { TOOL_DEFS as loopsDefs, handleTool as handleLoops } from "./loops";
import { TOOL_DEFS as stateDefs, handleTool as handleState } from "./state";
import { TOOL_DEFS as identityDefs, handleTool as handleIdentity } from "./identity";
import { TOOL_DEFS as anchorsDefs, handleTool as handleAnchors } from "./anchors";
import { TOOL_DEFS as desiresDefs, handleTool as handleDesires } from "./desires";
import { TOOL_DEFS as territoryDefs, handleTool as handleTerritory } from "./territory";
import { TOOL_DEFS as lettersDefs, handleTool as handleLetters } from "./letters";
import { TOOL_DEFS as maintenanceDefs, handleTool as handleMaintenance } from "./maintenance";
import { TOOL_DEFS as dreamDefs, handleTool as handleDream } from "./dream";
import { TOOL_DEFS as vowsDefs, handleTool as handleVows } from "./vows";
import { TOOL_DEFS as contextDefs, handleTool as handleContext } from "./context";

import { BrainStorage } from "../storage";

// Flat TOOLS array — all definitions in declaration order
export const TOOLS = [
	...wakeDefs,
	...memoryDefs,
	...linksDefs,
	...loopsDefs,
	...stateDefs,
	...identityDefs,
	...anchorsDefs,
	...desiresDefs,
	...territoryDefs,
	...lettersDefs,
	...maintenanceDefs,
	...dreamDefs,
	...vowsDefs,
	...contextDefs
];

// Route table — maps tool name prefix/set to its handler
const WAKE_TOOLS = new Set(wakeDefs.map(t => t.name));
const MEMORY_TOOLS = new Set(memoryDefs.map(t => t.name));
const LINKS_TOOLS = new Set(linksDefs.map(t => t.name));
const LOOPS_TOOLS = new Set(loopsDefs.map(t => t.name));
const STATE_TOOLS = new Set(stateDefs.map(t => t.name));
const IDENTITY_TOOLS = new Set(identityDefs.map(t => t.name));
const ANCHORS_TOOLS = new Set(anchorsDefs.map(t => t.name));
const DESIRES_TOOLS = new Set(desiresDefs.map(t => t.name));
const TERRITORY_TOOLS = new Set(territoryDefs.map(t => t.name));
const LETTERS_TOOLS = new Set(lettersDefs.map(t => t.name));
const MAINTENANCE_TOOLS = new Set(maintenanceDefs.map(t => t.name));
const DREAM_TOOLS = new Set(dreamDefs.map(t => t.name));
const VOWS_TOOLS = new Set(vowsDefs.map(t => t.name));
const CONTEXT_TOOLS = new Set(contextDefs.map(t => t.name));

export async function executeTool(name: string, args: any, storage: BrainStorage): Promise<any> {
	if (WAKE_TOOLS.has(name)) return handleWake(name, args, storage);
	if (MEMORY_TOOLS.has(name)) return handleMemory(name, args, storage);
	if (LINKS_TOOLS.has(name)) return handleLinks(name, args, storage);
	if (LOOPS_TOOLS.has(name)) return handleLoops(name, args, storage);
	if (STATE_TOOLS.has(name)) return handleState(name, args, storage);
	if (IDENTITY_TOOLS.has(name)) return handleIdentity(name, args, storage);
	if (ANCHORS_TOOLS.has(name)) return handleAnchors(name, args, storage);
	if (DESIRES_TOOLS.has(name)) return handleDesires(name, args, storage);
	if (TERRITORY_TOOLS.has(name)) return handleTerritory(name, args, storage);
	if (LETTERS_TOOLS.has(name)) return handleLetters(name, args, storage);
	if (MAINTENANCE_TOOLS.has(name)) return handleMaintenance(name, args, storage);
	if (DREAM_TOOLS.has(name)) return handleDream(name, args, storage);
	if (VOWS_TOOLS.has(name)) return handleVows(name, args, storage);
	if (CONTEXT_TOOLS.has(name)) return handleContext(name, args, storage);

	throw new Error(`Unknown tool: ${name}`);
}
