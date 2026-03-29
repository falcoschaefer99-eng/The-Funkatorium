// ============ TYPES ============
// Pure leaf node — no imports. All types used across the brain.

export interface Env {
	DATABASE_URL: string;     // Neon Postgres — fallback for local dev
	HYPERDRIVE?: Hyperdrive;  // Cloudflare Hyperdrive binding — production
	API_KEY: string;
	AI?: Ai;                  // Workers AI — for embeddings generation (optional during migration)
}

export interface Texture {
	salience: string;
	vividness: string;
	charge: string[];
	somatic?: string;
	grip: string;
	charge_phase?: "fresh" | "active" | "processing" | "metabolized";
	novelty_score?: number;
	last_surfaced_at?: string;
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
	summary?: string;  // L0: truncated excerpt with grip/charge markers. NOT sanitized — escape before HTML rendering.
	type?: string;     // Observation subtype: "journal", "whisper", etc.
	tags?: string[];   // User-assigned tags
	entity_id?: string; // Optional link to a structured entity
}

// Phase B — not yet used by any tool
export interface TerritoryOverview {
	territory: string;
	observation_count: number;
	top_charges: string[];
	top_grip: string;
	recent_count: number;
	iron_count: number;
	iron_ids: string[];           // IDs of iron-grip observations
	last_activity: string;
	theme_summary: string;
	generated_at: string;
}

// Phase B — not yet used by any tool
export interface IronGripEntry {
	id: string;
	territory: string;
	summary: string;
	charges: string[];
	pull: number;
	updated: string;
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
	mode?: 'standard' | 'learning_objective' | 'paradox';
	linked_entity_ids?: string[];
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
	letter_type?: 'personal' | 'handoff' | 'proposal';
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

export interface WakeLogEntry {
	id: string;
	timestamp: string;
	summary?: unknown;
	actions?: string[];
	iron_pulls?: string[];
	mood?: unknown;
	phase?: string;
	[key: string]: unknown;    // Allow additional fields from different wake types
}

export interface RelationalState {
	id: string;
	entity: string;
	direction: "toward" | "from" | "mutual";
	feeling: string;
	intensity: number; // 0-1
	charges: string[];
	context?: string;
	created: string;
	updated: string;
	history: Array<{
		feeling: string;
		intensity: number;
		charges: string[];
		timestamp: string;
	}>;
}

export interface SubconsciousState {
	last_processed: string;
	hot_entities: Array<{ entity: string; mention_count: number; recent_charges: string[] }>;
	memory_cascade: Array<{ pair: [string, string]; count: number }>;
	mood_inference: { suggested_mood: string; confidence: number; based_on: string[] };
	orphans: Array<{ id: string; territory: string; reason: string }>;
}

export interface TriggerCondition {
	id: string;
	type: "no_contact" | "presence_transition" | "time_window";
	entity?: string;
	config: Record<string, unknown>;
	created: string;
	last_checked: string;
	last_fired?: string;
	active: boolean;
}

export interface ConsentEntry {
	domain: string;
	level: "standing" | "session" | "ask_each_time" | "prohibited";
	granted_at: string;
	expires_at?: string;
}

export interface ConsentLogEntry {
	timestamp: string;
	domain: string;
	action: "granted" | "revoked" | "checked" | "denied";
	level: string;
	context?: string;
}

export interface ConsentState {
	user_consent: ConsentEntry[];
	ai_boundaries: {
		hard: string[];
		relationship_gated: Record<string, string>;
	};
	relationship_level: "stranger" | "familiar" | "close" | "bonded";
	log: ConsentLogEntry[];
}

// --- Entity Model (Brain v5 Sprint 3) ---

export interface Entity {
	id: string;
	tenant_id: string;
	name: string;
	entity_type: string;
	tags: string[];
	salience: string;
	primary_context?: string;
	created_at: string;
	updated_at: string;
}

export interface Relation {
	id: string;
	tenant_id: string;
	from_entity_id: string;
	to_entity_id: string;
	relation_type: string;
	strength: number;
	context?: string;
	created_at: string;
	updated_at: string;
}

export interface EntityFilter {
	entity_type?: string;
	salience?: string;
	tags?: string[];
	limit?: number;
}

export interface ProjectDossier {
	id: string;
	tenant_id: string;
	project_entity_id: string;
	lifecycle_status: 'active' | 'paused' | 'archived';
	summary?: string;
	goals: string[];
	constraints: string[];
	decisions: string[];
	open_questions: string[];
	next_actions: string[];
	metadata: Record<string, unknown>;
	last_active_at?: string;
	created_at: string;
	updated_at: string;
}

export interface ProjectDossierFilter {
	lifecycle_status?: 'active' | 'paused' | 'archived';
	updated_after?: string;
	limit?: number;
}

export interface AgentSkillDescriptor {
	name: string;
	description?: string;
	tags?: string[];
}

export interface AgentCapabilityManifest {
	id: string;
	tenant_id: string;
	agent_entity_id: string;
	version: string;
	delegation_mode: 'auto' | 'explicit' | 'router';
	router_agent_entity_id?: string | null;
	supports_streaming: boolean;
	accepted_output_modes: string[];
	protocols: string[];
	skills: AgentSkillDescriptor[];
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export interface AgentCapabilityManifestFilter {
	delegation_mode?: 'auto' | 'explicit' | 'router';
	limit?: number;
}

export interface A2ATaskMessagePart {
	type: string;
	text?: string;
	data?: Record<string, unknown>;
}

export interface A2ATaskEnvelope {
	id: string;
	task_type: string;
	from_agent_entity_id?: string;
	to_agent_entity_id?: string;
	session_id?: string;
	correlation_id?: string;
	message: {
		role: string;
		parts: A2ATaskMessagePart[];
	};
	accepted_output_modes: string[];
	history_length?: number;
	status?: 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
	metadata?: Record<string, unknown>;
	created_at?: string;
}

// --- Daemon Intelligence (Brain v5 Sprint 4) ---

export interface DaemonProposal {
	id: string;
	tenant_id: string;
	proposal_type: 'link' | 'orphan_rescue' | 'consolidation' | 'dedup' | 'cross_agent' | 'cross_tenant' | 'paradox_detected';
	source_id: string;
	target_id: string;
	similarity?: number;
	resonance_type?: string;
	confidence: number;
	rationale?: string;
	metadata: Record<string, unknown>;
	status: 'pending' | 'accepted' | 'rejected';
	feedback_note?: string;
	proposed_at: string;
	reviewed_at?: string;
}

export interface OrphanObservation {
	observation_id: string;
	tenant_id: string;
	first_marked: string;
	rescue_attempts: number;
	last_rescue_attempt?: string;
	status: 'orphaned' | 'rescued' | 'archived';
}

export interface DaemonConfig {
	tenant_id: string;
	link_proposal_threshold: number;
	last_threshold_update?: string;
	data: Record<string, unknown>;
}

// --- Sprint 6: New primitives ---

export interface ObservationVersion {
	id: string;
	tenant_id: string;
	observation_id: string;
	version_num: number;
	content: string;
	texture: Texture;
	change_reason?: string;
	created_at: string;
}

export interface ProcessingEntry {
	id: string;
	tenant_id: string;
	observation_id: string;
	processing_note?: string;
	charge_at_processing: string[];
	somatic_at_processing?: string;
	created_at: string;
}

export interface ConsolidationCandidate {
	id: string;
	tenant_id: string;
	source_observation_ids: string[];
	pattern_description: string;
	suggested_territory?: string;
	suggested_type: 'skill' | 'identity' | 'synthesis';
	status: 'pending' | 'accepted' | 'rejected' | 'deferred';
	created_at: string;
	reviewed_at?: string;
}

export interface DispatchFeedback {
	id: string;
	tenant_id: string;
	agent_entity_id?: string;
	task_type: string;
	domain?: string;
	environment?: string;
	session_id?: string;
	dispatched_at: string;
	outcome?: 'effective' | 'partial' | 'ineffective' | 'redirected';
	findings_count: number;
	findings_acted: number;
	confidence_avg?: number;
	predicted_confidence?: number;
	outcome_score?: number;
	revision_cost?: number;
	needed_rescue?: boolean;
	rescue_agent_id?: string;
	time_to_usable_ms?: number;
	notes?: string;
	reviewed_at?: string;
}

export interface DispatchStat {
	task_type: string;
	total: number;
	effective: number;
	partial: number;
	ineffective: number;
	redirected: number;
	avg_confidence: number;
	avg_predicted_confidence: number;
	avg_outcome_score: number;
	avg_revision_cost: number;
	rescue_rate: number;
}

export interface Task {
	id: string;
	tenant_id: string;
	assigned_tenant?: string;
	title: string;
	description?: string;
	status: 'open' | 'scheduled' | 'in_progress' | 'done' | 'deferred' | 'cancelled';
	priority: 'burning' | 'high' | 'normal' | 'low' | 'someday';
	estimated_effort?: string;
	scheduled_wake?: string;
	source?: string;
	linked_observation_ids: string[];
	linked_entity_ids: string[];
	depends_on?: string[];
	completion_note?: string;
	created_at: string;
	updated_at: string;
	completed_at?: string;
}

export type AgentRuntimeTriggerMode = 'schedule' | 'webhook' | 'manual' | 'delegated';
export type AgentRuntimeSessionStatus = 'active' | 'paused' | 'ended' | 'failed';
export type AgentRuntimeRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'deferred';
export type AgentRuntimeExecutionMode = 'lean' | 'balanced' | 'explore';
export type AgentRuntimeWakeKind = 'duty' | 'impulse';

export interface AgentRuntimeSession {
	id: string;
	tenant_id: string;
	agent_tenant: string;
	session_id: string;
	status: AgentRuntimeSessionStatus;
	trigger_mode: AgentRuntimeTriggerMode;
	source_task_id?: string;
	metadata: Record<string, unknown>;
	last_resumed_at?: string;
	created_at: string;
	updated_at: string;
}

export interface AgentRuntimeRun {
	id: string;
	tenant_id: string;
	agent_tenant: string;
	session_id?: string;
	trigger_mode: AgentRuntimeTriggerMode;
	task_id?: string;
	status: AgentRuntimeRunStatus;
	started_at?: string;
	completed_at?: string;
	next_wake_at?: string;
	summary?: string;
	error?: string;
	metadata: Record<string, unknown>;
	created_at: string;
}

export interface AgentRuntimePolicy {
	id: string;
	tenant_id: string;
	agent_tenant: string;
	execution_mode: AgentRuntimeExecutionMode;
	daily_wake_budget: number;
	impulse_wake_budget: number;
	reserve_wakes: number;
	min_impulse_interval_minutes: number;
	max_tool_calls_per_run: number;
	max_parallel_delegations: number;
	require_priority_clear_for_impulse: boolean;
	updated_by?: string;
	metadata: Record<string, unknown>;
	created_at: string;
	updated_at: string;
}

export interface AgentRuntimeUsage {
	agent_tenant: string;
	since: string;
	total_runs: number;
	duty_runs: number;
	impulse_runs: number;
	last_run_at?: string;
	last_impulse_run_at?: string;
}
