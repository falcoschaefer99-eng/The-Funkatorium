// ============ STORAGE INTERFACE ============
// IBrainStorage defines the full contract for all storage backends.
// Every method in BrainStorage (R2) has a counterpart here, plus new
// Postgres-native capabilities (vector search, filtered queries, bulk ops).
//
// No imports from storage implementations — pure interface file.

import type {
	Observation,
	Link,
	OpenLoop,
	BrainState,
	Letter,
	IdentityCore,
	Anchor,
	Desire,
	WakeLogEntry,
	RelationalState,
	SubconsciousState,
	TriggerCondition,
	ConsentState,
	TerritoryOverview,
	IronGripEntry
} from "../types";

// ============ FILTER / QUERY TYPES ============

/** Filter options for queryObservations — all fields optional, AND-combined. */
export interface ObservationFilter {
	territory?: string;
	/** Exact grip match. */
	grip?: string;
	/** Match observations that have ALL of these charges (superset). */
	charges_all?: string[];
	/** Match observations that have ANY of these charges (intersection). */
	charges_any?: string[];
	/** ISO 8601 — observations created on or after this timestamp. */
	created_after?: string;
	/** ISO 8601 — observations created on or before this timestamp. */
	created_before?: string;
	/** Observation subtype: "journal", "whisper", etc. */
	type?: string;
	/** User-assigned tag filter — any match. */
	tags?: string[];
	limit?: number;
	offset?: number;
	/** Column to sort by. Defaults to "created". */
	order_by?: "created" | "last_accessed" | "access_count";
	order_dir?: "asc" | "desc";
}

/** Options for vector similarity search. */
export interface SimilarSearchOptions {
	/** 768-dimension embedding vector as a flat number array. */
	embedding: number[];
	/** Narrow search to a specific territory. */
	territory?: string;
	/** Narrow search to specific grip levels. */
	grip?: string[];
	/** Minimum cosine similarity threshold (0–1). Defaults to 0 (no threshold). */
	min_similarity?: number;
	limit?: number;
}

/** A search result observation with its similarity score. */
export interface SimilarResult {
	observation: Observation;
	territory: string;
	similarity: number;
}

/** Options for hybrid search (vector + full-text + Neural Surfacing modulation). */
export interface HybridSearchOptions {
	query: string;
	/** Pre-computed query embedding — if omitted, vector search is skipped. */
	embedding?: number[];
	territory?: string;
	grip?: string[];
	charge_phase?: string;
	/** Minimum composite score threshold. Defaults to 0.3. */
	min_similarity?: number;
	/** Max results to return. Defaults to 10. */
	limit?: number;
	/** Current circadian phase name — used for territory bias modulation. */
	circadian_phase?: string;
}

/** A hybrid search result with composite score and source indicators. */
export interface HybridSearchResult {
	observation: Observation;
	territory: string;
	/** Composite score after all Neural Surfacing modulations. */
	score: number;
	/** Which search paths returned this observation. */
	match_sources: string[];
	/** Raw cosine similarity before modulation (if vector search ran). */
	vector_similarity?: number;
	/** Raw ts_rank score before modulation (if keyword search ran). */
	keyword_rank?: number;
}

/** Options for bulk texture updates (decay daemon). */
export interface TextureUpdate {
	id: string;
	texture: Partial<Observation["texture"]>;
	/** Update last_accessed timestamp. */
	touch?: boolean;
}

/** Config passed to createStorage. */
export interface StorageConfig {
	backend: "postgres" | "r2" | "sqlite";
	/** Neon DATABASE_URL — required for postgres backend. */
	databaseUrl?: string;
	/** R2Bucket — required for r2 backend. */
	bucket?: R2Bucket;
}

// ============ MAIN INTERFACE ============

export interface IBrainStorage {
	// --- Tenant ---

	/** Return the current tenant identifier. */
	getTenant(): string;

	/** Return a new IBrainStorage scoped to a different tenant (for cross-brain letters). */
	forTenant(tenant: string): IBrainStorage;

	// --- Territory Validation ---

	/** Validate and return territory string. Throws on invalid value. */
	validateTerritory(territory: string): string;

	// --- Brain State ---

	/** Read brain state, applying momentum decay and afterglow fade. */
	readBrainState(): Promise<BrainState>;

	/** Persist brain state. Stamps last_updated before writing. */
	writeBrainState(state: BrainState): Promise<void>;

	// --- Territories ---

	/** Read all observations for a territory. */
	readTerritory(territory: string): Promise<Observation[]>;

	/** Overwrite all observations for a territory. */
	writeTerritory(territory: string, observations: Observation[]): Promise<void>;

	/** Append a single observation to a territory. */
	appendToTerritory(territory: string, observation: Observation): Promise<void>;

	/** Read all territories in parallel. Returns territory + observations pairs. */
	readAllTerritories(): Promise<{ territory: string; observations: Observation[] }[]>;

	/** Find a single observation by ID, searching across all territories. */
	findObservation(id: string): Promise<{ observation: Observation; territory: string } | null>;

	// --- Observation Queries (new Postgres-native capabilities) ---

	/** Filtered query across observations. All filter fields are optional (AND-combined). */
	queryObservations(filter: ObservationFilter): Promise<{ observation: Observation; territory: string }[]>;

	/** Batch-update texture dimensions for multiple observations (decay daemon). */
	bulkUpdateTexture(updates: TextureUpdate[]): Promise<void>;

	/** Overwrite the full texture for a single observation by ID (safe, no destructive territory rewrite). */
	updateObservationTexture(id: string, texture: Observation["texture"]): Promise<void>;

	/** Increment access_count and stamp last_accessed_at for a single observation (safe, no territory rewrite). */
	updateObservationAccess(id: string): Promise<void>;

	/** Delete a single observation by ID. Returns true if found and deleted. */
	deleteObservation(id: string): Promise<boolean>;

	// --- Vector Search (new — embeddings nullable until populated) ---

	/** Update the embedding vector for a single observation (called after generation). */
	updateObservationEmbedding(id: string, embedding: number[]): Promise<void>;

	/** Bulk update embeddings for multiple observations. */
	bulkUpdateEmbeddings(updates: Array<{id: string; embedding: number[]}>): Promise<void>;

	/** Query observations missing embeddings for backfill. */
	queryUnembedded(limit: number): Promise<{id: string; content: string}[]>;

	/** Count observations missing embeddings. */
	countUnembedded(): Promise<number>;

	/** Find observations semantically similar to the provided embedding. */
	searchSimilar(options: SimilarSearchOptions): Promise<SimilarResult[]>;

	/**
	 * Auto-discovery: find observations similar to the given observation ID
	 * that are not yet linked to it. Returns candidates sorted by similarity.
	 */
	findUnlinkedSimilar(id: string, limit?: number): Promise<SimilarResult[]>;

	/**
	 * Hybrid search: combines vector similarity + full-text keyword search,
	 * then applies Neural Surfacing v1 score modulations (grip, charge phase,
	 * novelty, circadian territory bias).
	 */
	hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult[]>;

	/**
	 * Record co-surfacing pairs for observations that appeared together in a
	 * search result set. Increments count if pair already exists.
	 * Only records pairs from the top 5 results (canonical ordering: id_a < id_b).
	 */
	recordCoSurfacing(observationIds: string[]): Promise<void>;

	/**
	 * Apply post-search surfacing effects to a set of returned observation IDs:
	 * decrement novelty_score by 0.05 (min 0), increment surface_count, stamp last_surfaced_at.
	 */
	updateSurfacingEffects(observationIds: string[]): Promise<void>;

	// --- Open Loops ---

	readOpenLoops(): Promise<OpenLoop[]>;
	writeOpenLoops(loops: OpenLoop[]): Promise<void>;
	appendOpenLoop(loop: OpenLoop): Promise<void>;

	// --- Links ---

	readLinks(): Promise<Link[]>;
	writeLinks(links: Link[]): Promise<void>;
	appendLink(link: Link): Promise<void>;

	// --- Letters ---

	readLetters(): Promise<Letter[]>;
	writeLetters(letters: Letter[]): Promise<void>;
	appendLetter(letter: Letter): Promise<void>;

	// --- Identity Cores ---

	readIdentityCores(): Promise<IdentityCore[]>;
	writeIdentityCores(cores: IdentityCore[]): Promise<void>;

	// --- Anchors ---

	readAnchors(): Promise<Anchor[]>;
	writeAnchors(anchors: Anchor[]): Promise<void>;

	// --- Desires ---

	readDesires(): Promise<Desire[]>;
	writeDesires(desires: Desire[]): Promise<void>;

	// --- Wake Log (append-only) ---

	appendWakeLog(entry: WakeLogEntry): Promise<void>;
	readWakeLog(): Promise<WakeLogEntry[]>;

	// --- Conversation Context ---

	readConversationContext(): Promise<unknown>;
	writeConversationContext(context: unknown): Promise<void>;

	// --- Relational State ---

	readRelationalState(): Promise<RelationalState[]>;
	writeRelationalState(states: RelationalState[]): Promise<void>;

	// --- Subconscious ---

	readSubconscious(): Promise<SubconsciousState | null>;
	writeSubconscious(state: SubconsciousState): Promise<void>;

	// --- Triggers ---

	readTriggers(): Promise<TriggerCondition[]>;
	writeTriggers(triggers: TriggerCondition[]): Promise<void>;

	// --- Consent ---

	readConsent(): Promise<ConsentState>;
	writeConsent(consent: ConsentState): Promise<void>;

	// --- Backfill Tracking ---

	readBackfillFlag(version: string): Promise<unknown>;
	writeBackfillFlag(version: string, data: unknown): Promise<void>;

	// --- Territory Overviews (Phase B) ---

	readOverviews(): Promise<TerritoryOverview[]>;
	writeOverviews(overviews: TerritoryOverview[]): Promise<void>;

	// --- Iron Grip Index (Phase B) ---

	readIronGripIndex(): Promise<IronGripEntry[]>;
	writeIronGripIndex(entries: IronGripEntry[]): Promise<void>;
	appendIronGripEntry(entry: IronGripEntry): Promise<void>;
}
