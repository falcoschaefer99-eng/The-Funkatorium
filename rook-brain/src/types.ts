// ============ TYPES ============
// Pure leaf node — no imports. All types used across the brain.

export interface Env {
	BRAIN_STORAGE: R2Bucket;
	API_KEY: string;
}

export interface Texture {
	salience: string;
	vividness: string;
	charge: string[];
	somatic?: string;
	grip: string;
}

export interface Observation {
	id: string;
	content: string;
	territory: string;
	created: string;
	texture: Texture;
	context?: string;
	mood?: string;
	last_accessed?: string;
	access_count: number;
	links?: string[];
}

export interface Link {
	id: string;
	source_id: string;
	target_id: string;
	resonance_type: string;
	strength: string;
	origin: string;
	created: string;
	last_activated: string;
}

export interface OpenLoop {
	id: string;
	content: string;
	status: string;
	territory: string;
	created: string;
	resolved?: string;
	resolution_note?: string;
}

export interface BrainState {
	current_mood: string;
	energy_level: number;
	last_updated: string;
	momentum: {
		current_charges: string[];
		intensity: number;
		last_updated: string;
	};
	afterglow: {
		residue_charges: string[];
		source_id?: string;
		fading_since?: string;
	};
}

export interface Letter {
	id: string;
	from_context: string;
	to_context: string;
	content: string;
	timestamp: string;
	read: boolean;
	charges?: string[];
}

export interface IdentityCore {
	id: string;
	type: string;
	name: string;
	content: string;
	category: string;
	weight: number;
	created: string;
	last_reinforced: string;
	reinforcement_count: number;
	challenge_count: number;
	evolution_history: Array<{
		from_name: string;
		from_content: string;
		to_name: string;
		to_content: string;
		reason: string;
		date: string;
	}>;
	linked_observations: string[];
	challenges?: Array<{
		description: string;
		observation_id?: string;
		date: string;
	}>;
	charge: string[];
	somatic?: string;
}

export interface Anchor {
	id: string;
	type: string;
	anchor_type: string;
	content: string;
	charge: string[];
	triggers_memory_id?: string;
	created: string;
	activation_count: number;
	last_activated?: string;
}

export interface Desire {
	id: string;
	type: string;
	want: string;
	category: string;
	intensity: string;
	somatic?: string;
	detail?: string;
	created: string;
	last_felt: string;
	times_surfaced: number;
}

export interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: string | number;
	method: string;
	params?: any;
}

export interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: string | number;
	result?: any;
	error?: { code: number; message: string; data?: any };
}

export interface ParsedObservation {
	content: string;           // Cleaned content (syntax removed)
	territory: string;         // Detected or default
	charge: string[];          // Extracted charges
	somatic?: string;          // Detected somatic
	grip: string;              // Detected or default
	was_parsed: boolean;       // Whether smart parsing was applied
}
