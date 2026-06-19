// ============ SQLITE BRAIN STORAGE ============
// Self-host focused backend for local deployments.
//
// Design notes:
// - Uses node:sqlite (dynamic import) so Cloudflare workers are unaffected unless backend=sqlite.
// - Persists tenant-scoped JSON documents in a small key/value SQLite table.
// - Favors correctness/portability over raw query performance.

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
	IronGripEntry,
	Entity,
	Relation,
	EntityFilter,
	ProjectDossier,
	ProjectDossierFilter,
	AgentCapabilityManifest,
	AgentCapabilityManifestFilter,
	DaemonProposal,
	OrphanObservation,
	DaemonConfig,
	ObservationVersion,
	ProcessingEntry,
	ConsolidationCandidate,
	DispatchFeedback,
	DispatchStat,
	Task,
	AgentRuntimeSession,
	AgentRuntimeRun,
	AgentRuntimePolicy,
	AgentRuntimeUsage,
	CapturedSkillArtifact,
	CapturedSkillArtifactCreate,
	CapturedSkillArtifactFilter,
	CapturedSkillRegistryHealth,
	Recap,
	RecapEntityLink,
	RecapEdge,
	RecapFilter
} from "../types";

import {
	VALID_TERRITORIES,
	HARD_BOUNDARIES,
	RELATIONSHIP_GATES,
	CIRCADIAN_PHASES,
	ALLOWED_TENANTS
} from "../constants";

import { getTimestamp, calculateMomentumDecay, calculateAfterglowFade, generateId } from "../helpers";
import {
	DEFAULT_RETRIEVAL_PROFILE,
	getRetrievalProfileConfig,
	normalizeRetrievalProfile,
	extractQuerySignals
} from "../retrieval/query-signals";
import { scoreHybridCandidate } from "../retrieval/scoring";
import type { RetrievalHintArtifact } from "../retrieval/hints";
import {
	buildInitialRetrievalHints,
	computeRetrievalHintMatch,
	deriveQueryHintTerms
} from "../retrieval/hints";

import type {
	IBrainStorage,
	ObservationFilter,
	SimilarSearchOptions,
	SimilarResult,
	HybridSearchOptions,
	HybridSearchResult,
	TextureUpdate
} from "./interface";

type SqliteDb = {
	exec: (sql: string) => void;
	prepare: (sql: string) => {
		run: (...args: any[]) => any;
		get: (...args: any[]) => any;
		all: (...args: any[]) => any[];
	};
};

type StoredObservation = Observation & {
	embedding?: number[];
	entity_tags?: string[];
	processing_count?: number;
	surface_count?: number;
	last_surfaced_at?: string;
	novelty_score?: number;
};

type CascadePair = { obs_id_a: string; obs_id_b: string; count: number; last_co_surfaced?: string };

type DbPromises = {
	dbPromise: Promise<SqliteDb>;
};

const KV_KEYS = {
	observations: "observations",
	open_loops: "open_loops",
	links: "links",
	letters: "letters",
	identity_cores: "identity_cores",
	anchors: "anchors",
	desires: "desires",
	wake_log: "wake_log",
	conversation_context: "conversation_context",
	relational_states: "relational_states",
	subconscious: "subconscious",
	triggers: "triggers",
	consent: "consent",
	backfill_flags: "backfill_flags",
	territory_overviews: "territory_overviews",
	iron_grip_index: "iron_grip_index",
	entities: "entities",
	relations: "relations",
	project_dossiers: "project_dossiers",
	agent_capability_manifests: "agent_capability_manifests",
	daemon_proposals: "daemon_proposals",
	orphan_observations: "orphan_observations",
	daemon_config: "daemon_config",
	observation_versions: "observation_versions",
	processing_log: "processing_log",
	consolidation_candidates: "consolidation_candidates",
	dispatch_feedback: "dispatch_feedback",
	tasks: "tasks",
	captured_skills: "captured_skills",
	runtime_sessions: "runtime_sessions",
	runtime_runs: "runtime_runs",
	runtime_policies: "runtime_policies",
	memory_cascade: "memory_cascade",
	retrieval_hints: "retrieval_hints"
} as const;

function deepClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function asArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function toMillis(iso?: string): number {
	if (!iso) return 0;
	const n = Date.parse(iso);
	return Number.isFinite(n) ? n : 0;
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (!a.length || !b.length || a.length !== b.length) return 0;
	let dot = 0;
	let magA = 0;
	let magB = 0;
	for (let i = 0; i < a.length; i++) {
		const av = a[i] || 0;
		const bv = b[i] || 0;
		dot += av * bv;
		magA += av * av;
		magB += bv * bv;
	}
	if (magA === 0 || magB === 0) return 0;
	return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9_]+/)
		.map(t => t.trim())
		.filter(Boolean);
}

function nowIso(): string {
	return getTimestamp();
}

async function initSqlite(path: string): Promise<SqliteDb> {
	let sqliteModule: any;
	try {
		const moduleName = "node:sqlite";
		sqliteModule = await import(moduleName);
	} catch (err) {
		throw new Error(`SQLite backend unavailable in this runtime: ${err instanceof Error ? err.message : "unknown"}`);
	}

	const DatabaseSync = sqliteModule?.DatabaseSync ?? sqliteModule?.default?.DatabaseSync;
	if (!DatabaseSync) {
		throw new Error("SQLite backend unavailable: DatabaseSync export missing");
	}

	const db = new DatabaseSync(path || "./muse-brain.sqlite") as SqliteDb;
	db.exec(`
		PRAGMA journal_mode=WAL;
		PRAGMA synchronous=NORMAL;
		PRAGMA temp_store=MEMORY;
		CREATE TABLE IF NOT EXISTS kv_store (
			tenant_id TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (tenant_id, key)
		);
	`);
	return db;
}

export class SQLiteBrainStorage implements IBrainStorage {
	private readonly sqlitePath: string;
	private readonly tenant: string;
	private readonly dbPromise: Promise<SqliteDb>;

	constructor(sqlitePath: string, tenant: string, shared?: DbPromises) {
		if (!ALLOWED_TENANTS.includes(tenant as typeof ALLOWED_TENANTS[number])) {
			throw new Error(`Invalid tenant: ${tenant}`);
		}

		const normalizedPath = sqlitePath || "./muse-brain.sqlite";
		if (normalizedPath.includes("\0")) {
			throw new Error("Invalid sqlite path");
		}

		this.sqlitePath = normalizedPath;
		this.tenant = tenant;
		this.dbPromise = shared?.dbPromise ?? initSqlite(this.sqlitePath);
	}

	private async db(): Promise<SqliteDb> {
		return this.dbPromise;
	}

	private toPublicObservation(obs: StoredObservation): Observation {
		const {
			embedding: _embedding,
			entity_tags: _entity_tags,
			processing_count: _processing_count,
			surface_count: _surface_count,
			last_surfaced_at: _last_surfaced_at,
			novelty_score: _novelty_score,
			...publicObs
		} = obs;
		return publicObs as Observation;
	}

	private normalizeObservation(obs: StoredObservation): StoredObservation {
		const texture = obs.texture ?? {
			salience: "active",
			vividness: "vivid",
			charge: [],
			grip: "present"
		};
		return {
			...obs,
			territory: obs.territory,
			created: obs.created ?? nowIso(),
			access_count: obs.access_count ?? 0,
			links: asArray<string>(obs.links),
			tags: asArray<string>(obs.tags),
			texture: {
				...texture,
				charge: asArray<string>(texture.charge)
			},
			embedding: Array.isArray(obs.embedding) ? obs.embedding.filter(n => typeof n === "number") : undefined,
			entity_tags: asArray<string>(obs.entity_tags),
			processing_count: typeof obs.processing_count === "number" ? obs.processing_count : 0,
			surface_count: typeof obs.surface_count === "number" ? obs.surface_count : 0,
			novelty_score: typeof obs.novelty_score === "number"
				? obs.novelty_score
				: (typeof texture.novelty_score === "number" ? texture.novelty_score : 1.0)
		};
	}

	private deriveHintsForObservation(obs: StoredObservation): RetrievalHintArtifact[] {
		return buildInitialRetrievalHints({
			id: obs.id,
			content: obs.content,
			summary: obs.summary,
			context: obs.context,
			mood: obs.mood,
			territory: obs.territory,
			type: obs.type,
			created: obs.created,
			entity_id: obs.entity_id,
			tags: obs.tags
		});
	}

	private async readValue<T>(key: string, fallback: T): Promise<T> {
		const db = await this.db();
		const row = db.prepare("SELECT value FROM kv_store WHERE tenant_id = ? AND key = ? LIMIT 1").get(this.tenant, key) as { value?: string } | undefined;
		if (!row?.value) return deepClone(fallback);
		try {
			return JSON.parse(row.value) as T;
		} catch {
			return deepClone(fallback);
		}
	}

	private async writeValue<T>(key: string, value: T): Promise<void> {
		const db = await this.db();
		db.prepare(
			"INSERT INTO kv_store (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
		).run(this.tenant, key, JSON.stringify(value), nowIso());
	}

	private async readCollection<T>(key: string): Promise<T[]> {
		const value = await this.readValue<T[]>(key, []);
		return Array.isArray(value) ? value : [];
	}

	private async writeCollection<T>(key: string, items: T[]): Promise<void> {
		await this.writeValue(key, items);
	}

	/**
	 * Observation mutation helper.
	 *
	 * Default mode is in-place mutation of the provided `observations` array.
	 * For full-array rewrites, mutators can call `replace(next)` explicitly.
	 */
	private async withObservations<T>(
		mutator: (observations: StoredObservation[], replace: (next: StoredObservation[]) => void) => Promise<T> | T
	): Promise<T> {
		let observations = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));
		const replace = (next: StoredObservation[]) => {
			observations = next.map(o => this.normalizeObservation(o));
		};

		const result = await mutator(observations, replace);
		await this.writeCollection(KV_KEYS.observations, observations);
		return result;
	}

	private defaultConsent(): ConsentState {
		return {
			user_consent: [],
			ai_boundaries: {
				hard: [...HARD_BOUNDARIES],
				relationship_gated: { ...RELATIONSHIP_GATES }
			},
			relationship_level: "stranger",
			log: []
		};
	}

	private defaultDaemonConfig(): DaemonConfig {
		return {
			tenant_id: this.tenant,
			link_proposal_threshold: 0.75,
			data: {}
		};
	}

	// ============ TENANT ============

	getTenant(): string {
		return this.tenant;
	}

	forTenant(tenant: string): IBrainStorage {
		if (!ALLOWED_TENANTS.includes(tenant as typeof ALLOWED_TENANTS[number])) {
			throw new Error("Invalid tenant");
		}
		return new SQLiteBrainStorage(this.sqlitePath, tenant, { dbPromise: this.dbPromise });
	}

	// ============ TERRITORY VALIDATION ============

	validateTerritory(territory: string): string {
		if (!VALID_TERRITORIES.includes(territory)) {
			throw new Error("Invalid territory");
		}
		return territory;
	}

	// ============ BRAIN STATE ============

	async readBrainState(): Promise<BrainState> {
		const defaultState: BrainState = {
			current_mood: "neutral",
			energy_level: 0.7,
			last_updated: nowIso(),
			momentum: { current_charges: [], intensity: 0, last_updated: nowIso() },
			afterglow: { residue_charges: [] }
		};
		const stored = await this.readValue<Partial<BrainState>>("brain_state", defaultState);
		const state: BrainState = {
			current_mood: stored.current_mood ?? defaultState.current_mood,
			energy_level: stored.energy_level ?? defaultState.energy_level,
			last_updated: stored.last_updated ?? defaultState.last_updated,
			momentum: stored.momentum ?? defaultState.momentum,
			afterglow: stored.afterglow ?? defaultState.afterglow
		};
		if (!state.momentum.last_updated) {
			state.momentum.last_updated = nowIso();
		}
		state.momentum = calculateMomentumDecay(state.momentum);
		state.afterglow = calculateAfterglowFade(state.afterglow);
		return state;
	}

	async writeBrainState(state: BrainState): Promise<void> {
		state.last_updated = nowIso();
		await this.writeValue("brain_state", state);
	}

	// ============ TERRITORIES ============

	async readTerritory(territory: string): Promise<Observation[]> {
		this.validateTerritory(territory);
		const observations = (await this.readCollection<StoredObservation>(KV_KEYS.observations))
			.map(o => this.normalizeObservation(o))
			.filter(o => o.territory === territory)
			.sort((a, b) => toMillis(a.created) - toMillis(b.created));
		return observations.map(o => this.toPublicObservation(o));
	}

	async writeTerritory(territory: string, observations: Observation[]): Promise<void> {
		this.validateTerritory(territory);
		const existingTerritoryIds = new Set(
			(await this.readCollection<StoredObservation>(KV_KEYS.observations))
				.map(o => this.normalizeObservation(o))
				.filter(o => o.territory === territory)
				.map(o => o.id)
		);

		await this.withObservations(async all => {
			for (let i = all.length - 1; i >= 0; i--) {
				if (all[i].territory === territory) all.splice(i, 1);
			}
			for (const obs of observations) {
				all.push(this.normalizeObservation({ ...obs, territory } as StoredObservation));
			}
		});

		const hints = await this.readCollection<RetrievalHintArtifact>(KV_KEYS.retrieval_hints);
		const filtered = hints.filter(hint => !existingTerritoryIds.has(hint.observation_id));
		const replacementHints = observations.flatMap(obs =>
			this.deriveHintsForObservation(this.normalizeObservation({ ...obs, territory } as StoredObservation))
		);
		await this.writeCollection(KV_KEYS.retrieval_hints, [...filtered, ...replacementHints]);
	}

	async appendToTerritory(territory: string, observation: Observation): Promise<void> {
		this.validateTerritory(territory);
		const normalized = this.normalizeObservation({ ...observation, territory } as StoredObservation);
		await this.withObservations(async all => {
			all.push(normalized);
		});

		const hints = await this.readCollection<RetrievalHintArtifact>(KV_KEYS.retrieval_hints);
		const filtered = hints.filter(hint => hint.observation_id !== normalized.id);
		await this.writeCollection(KV_KEYS.retrieval_hints, [...filtered, ...this.deriveHintsForObservation(normalized)]);
	}

	async readAllTerritories(): Promise<{ territory: string; observations: Observation[] }[]> {
		const all = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));
		return VALID_TERRITORIES.map(territory => ({
			territory,
			observations: all
				.filter(o => o.territory === territory)
				.sort((a, b) => toMillis(a.created) - toMillis(b.created))
				.map(o => this.toPublicObservation(o))
		}));
	}

	async findObservation(id: string): Promise<{ observation: Observation; territory: string } | null> {
		const obs = (await this.readCollection<StoredObservation>(KV_KEYS.observations))
			.map(o => this.normalizeObservation(o))
			.find(o => o.id === id);
		if (!obs) return null;
		return { observation: this.toPublicObservation(obs), territory: obs.territory };
	}

	// ============ OBSERVATION QUERIES ============

	async queryObservations(filter: ObservationFilter): Promise<{ observation: Observation; territory: string }[]> {
		const limit = Math.max(1, filter.limit ?? 100);
		const offset = filter.offset ?? 0;
		const orderBy = filter.order_by ?? "created";
		const orderDir = filter.order_dir ?? "desc";

		let rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));

		if (filter.territory) rows = rows.filter(o => o.territory === filter.territory);
		if (filter.grip) rows = rows.filter(o => o.texture?.grip === filter.grip);
		if (filter.charges_all?.length) rows = rows.filter(o => filter.charges_all!.every(c => o.texture?.charge?.includes(c)));
		if (filter.charges_any?.length) rows = rows.filter(o => filter.charges_any!.some(c => o.texture?.charge?.includes(c)));
		if (filter.created_after) rows = rows.filter(o => toMillis(o.created) >= toMillis(filter.created_after));
		if (filter.created_before) rows = rows.filter(o => toMillis(o.created) <= toMillis(filter.created_before));
		if (filter.type) rows = rows.filter(o => o.type === filter.type);
		if (filter.tags?.length) rows = rows.filter(o => filter.tags!.some(tag => (o.tags ?? []).includes(tag)));

		rows.sort((a, b) => {
			let av: number | string;
			let bv: number | string;
			if (orderBy === "access_count") {
				av = a.access_count ?? 0;
				bv = b.access_count ?? 0;
			} else if (orderBy === "last_accessed") {
				av = a.last_accessed ?? a.created;
				bv = b.last_accessed ?? b.created;
			} else {
				av = a.created;
				bv = b.created;
			}
			if (av < bv) return orderDir === "asc" ? -1 : 1;
			if (av > bv) return orderDir === "asc" ? 1 : -1;
			return 0;
		});

		return rows.slice(offset, offset + limit).map(o => ({ observation: this.toPublicObservation(o), territory: o.territory }));
	}

	async bulkUpdateTexture(updates: TextureUpdate[]): Promise<void> {
		if (!updates.length) return;
		await this.withObservations(async all => {
			const byId = new Map(all.map(o => [o.id, o] as const));
			for (const update of updates) {
				const target = byId.get(update.id);
				if (!target) continue;
				target.texture = { ...target.texture, ...update.texture };
				if (typeof target.texture.novelty_score === "number") {
					target.novelty_score = target.texture.novelty_score;
				}
				if (update.touch) {
					target.access_count = (target.access_count ?? 0) + 1;
					target.last_accessed = nowIso();
				}
			}
		});
	}

	async bulkReplaceTexture(updates: { id: string; texture: Observation["texture"] }[]): Promise<void> {
		if (!updates.length) return;
		await this.withObservations(async all => {
			const byId = new Map(all.map(o => [o.id, o] as const));
			for (const update of updates) {
				const target = byId.get(update.id);
				if (!target) continue;
				target.texture = { ...update.texture, charge: asArray<string>(update.texture?.charge) } as Observation["texture"];
				target.novelty_score = typeof target.texture.novelty_score === "number" ? target.texture.novelty_score : target.novelty_score;
			}
		});
	}

	async updateObservationTexture(id: string, texture: Observation["texture"]): Promise<void> {
		await this.bulkReplaceTexture([{ id, texture }]);
	}

	async updateObservationAccess(id: string): Promise<void> {
		await this.withObservations(async all => {
			const target = all.find(o => o.id === id);
			if (!target) return;
			target.access_count = (target.access_count ?? 0) + 1;
			target.last_accessed = nowIso();
		});
	}

	async deleteObservation(id: string): Promise<boolean> {
		let deleted = false;
		await this.withObservations(async all => {
			const idx = all.findIndex(o => o.id === id);
			if (idx >= 0) {
				all.splice(idx, 1);
				deleted = true;
			}
		});
		if (!deleted) return false;

		const links = await this.readCollection<Link>(KV_KEYS.links);
		await this.writeCollection(KV_KEYS.links, links.filter(l => l.source_id !== id && l.target_id !== id));

		const versions = await this.readCollection<ObservationVersion>(KV_KEYS.observation_versions);
		await this.writeCollection(KV_KEYS.observation_versions, versions.filter(v => v.observation_id !== id));

		const processing = await this.readCollection<ProcessingEntry>(KV_KEYS.processing_log);
		await this.writeCollection(KV_KEYS.processing_log, processing.filter(p => p.observation_id !== id));

		const hints = await this.readCollection<RetrievalHintArtifact>(KV_KEYS.retrieval_hints);
		await this.writeCollection(KV_KEYS.retrieval_hints, hints.filter(h => h.observation_id !== id));

		return true;
	}

	// ============ EMBEDDINGS / SEARCH ============

	async updateObservationEmbedding(id: string, embedding: number[]): Promise<void> {
		await this.withObservations(async all => {
			const target = all.find(o => o.id === id);
			if (!target) return;
			target.embedding = embedding;
		});
	}

	async bulkUpdateEmbeddings(updates: Array<{ id: string; embedding: number[] }>): Promise<void> {
		if (!updates.length) return;
		await this.withObservations(async all => {
			const byId = new Map(all.map(o => [o.id, o] as const));
			for (const update of updates) {
				const target = byId.get(update.id);
				if (target) target.embedding = update.embedding;
			}
		});
	}

	async queryUnembedded(limit: number): Promise<{ id: string; content: string }[]> {
		const cap = Math.max(1, Math.min(limit || 50, 500));
		const rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations))
			.map(o => this.normalizeObservation(o))
			.filter(o => !o.embedding || !o.embedding.length)
			.slice(0, cap);
		return rows.map(r => ({ id: r.id, content: r.content }));
	}

	async countUnembedded(): Promise<number> {
		const rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));
		return rows.filter(o => !o.embedding || !o.embedding.length).length;
	}

	async searchSimilar(options: SimilarSearchOptions): Promise<SimilarResult[]> {
		const limit = Math.max(1, options.limit ?? 10);
		const minSimilarity = options.min_similarity ?? 0;
		const rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));

		let filtered = rows.filter(o => Array.isArray(o.embedding) && o.embedding.length === options.embedding.length);
		if (options.territory) filtered = filtered.filter(o => o.territory === options.territory);
		if (options.grip?.length) filtered = filtered.filter(o => options.grip!.includes(o.texture?.grip ?? "present"));

		const scored = filtered
			.map(o => ({
				observation: this.toPublicObservation(o),
				territory: o.territory,
				similarity: cosineSimilarity(options.embedding, o.embedding ?? [])
			}))
			.filter(r => r.similarity >= minSimilarity)
			.sort((a, b) => b.similarity - a.similarity)
			.slice(0, limit);

		return scored;
	}

	async findUnlinkedSimilar(id: string, limit = 10): Promise<SimilarResult[]> {
		const source = (await this.readCollection<StoredObservation>(KV_KEYS.observations))
			.map(o => this.normalizeObservation(o))
			.find(o => o.id === id);
		if (!source?.embedding?.length) return [];

		const links = await this.readCollection<Link>(KV_KEYS.links);
		const linked = new Set<string>();
		for (const link of links) {
			if (link.source_id === id) linked.add(link.target_id);
			if (link.target_id === id) linked.add(link.source_id);
		}

		const candidates = await this.searchSimilar({ embedding: source.embedding, limit: Math.max(limit * 3, 30) });
		return candidates.filter(c => c.observation.id !== id && !linked.has(c.observation.id)).slice(0, limit);
	}

	async hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult[]> {
		const retrievalProfile = normalizeRetrievalProfile(options.retrieval_profile) ?? DEFAULT_RETRIEVAL_PROFILE;
		const profileConfig = getRetrievalProfileConfig(retrievalProfile);
		const limit = Math.max(1, options.limit ?? 10);
		const minSimilarity = options.min_similarity ?? 0.3;
		const querySignals = options.query_signals ?? extractQuerySignals(options.query || "");
		const queryTokens = tokenize(options.query || "");
		const queryHintTerms = deriveQueryHintTerms({
			query: options.query || "",
			quoted_phrases: querySignals.quoted_phrases,
			proper_names: querySignals.proper_names,
			temporal: querySignals.temporal
		});
		const circadianBias = options.circadian_phase ? new Set(CIRCADIAN_PHASES[options.circadian_phase]?.retrieval_bias ?? []) : new Set<string>();

		let rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));
		const hints = await this.readCollection<RetrievalHintArtifact>(KV_KEYS.retrieval_hints);
		const hintsByObservation = new Map<string, RetrievalHintArtifact[]>();
		for (const hint of hints) {
			const bucket = hintsByObservation.get(hint.observation_id);
			if (bucket) bucket.push(hint);
			else hintsByObservation.set(hint.observation_id, [hint]);
		}

		if (options.territory) rows = rows.filter(o => o.territory === options.territory);
		if (options.grip?.length) rows = rows.filter(o => options.grip!.includes(o.texture?.grip ?? "present"));
		if (options.charge_phase) rows = rows.filter(o => (o.texture?.charge_phase ?? "fresh") === options.charge_phase);

		interface CandidateSeed {
			obs: StoredObservation;
			keywordRank: number;
			vectorSimilarity?: number;
			hasEntityMatch: boolean;
			hintScore: number;
			hintMatchedTypes: string[];
		}
		const seeds: CandidateSeed[] = [];
		for (const obs of rows) {
			const body = `${obs.content}\n${obs.summary ?? ""}`.toLowerCase();
			let keywordRank = 0;
			if (queryTokens.length > 0) {
				let matched = 0;
				for (const token of queryTokens) {
					if (body.includes(token)) matched++;
				}
				keywordRank = matched / queryTokens.length;
			}

			const vectorSimilarity = options.embedding && obs.embedding?.length === options.embedding.length
				? cosineSimilarity(options.embedding, obs.embedding)
				: undefined;

			const hasEntityMatch = Boolean(options.entity_id && obs.entity_id === options.entity_id);
			const observationHints = hintsByObservation.get(obs.id) ?? this.deriveHintsForObservation(obs);
			const hintMatch = computeRetrievalHintMatch(observationHints, queryHintTerms);
			const hintScore = hintMatch.score;

			if ((vectorSimilarity ?? 0) <= 0 && keywordRank <= 0 && !hasEntityMatch && hintScore <= 0) continue;
			seeds.push({
				obs,
				keywordRank,
				vectorSimilarity,
				hasEntityMatch,
				hintScore,
				hintMatchedTypes: hintMatch.matched_hint_types
			});
		}

		const candidateMap = new Map<string, CandidateSeed>();
		const vectorSeeds = seeds
			.filter(seed => typeof seed.vectorSimilarity === "number" && (seed.vectorSimilarity ?? 0) > 0)
			.sort((a, b) => (b.vectorSimilarity ?? 0) - (a.vectorSimilarity ?? 0))
			.slice(0, profileConfig.candidate_pool.vector);
		const keywordSeeds = seeds
			.filter(seed => seed.keywordRank > 0)
			.sort((a, b) => b.keywordRank - a.keywordRank)
			.slice(0, profileConfig.candidate_pool.keyword);
		const entitySeeds = seeds
			.filter(seed => seed.hasEntityMatch)
			.sort((a, b) => toMillis(b.obs.created) - toMillis(a.obs.created))
			.slice(0, profileConfig.candidate_pool.entity);
		const hintSeeds = seeds
			.filter(seed => seed.hintScore >= 0.08)
			.sort((a, b) => b.hintScore - a.hintScore)
			.slice(0, Math.max(12, Math.floor(profileConfig.candidate_pool.keyword * 0.7)));

		const mergeSeed = (seed: CandidateSeed): void => {
			const existing = candidateMap.get(seed.obs.id);
			if (!existing) {
				candidateMap.set(seed.obs.id, {
					...seed,
					hintMatchedTypes: Array.from(new Set(seed.hintMatchedTypes))
				});
				return;
			}
			existing.vectorSimilarity = Math.max(existing.vectorSimilarity ?? 0, seed.vectorSimilarity ?? 0) || undefined;
			existing.keywordRank = Math.max(existing.keywordRank, seed.keywordRank);
			existing.hasEntityMatch = existing.hasEntityMatch || seed.hasEntityMatch;
			existing.hintScore = Math.max(existing.hintScore, seed.hintScore);
			existing.hintMatchedTypes = Array.from(new Set([...existing.hintMatchedTypes, ...seed.hintMatchedTypes]));
		};

		for (const seed of [...vectorSeeds, ...keywordSeeds, ...entitySeeds, ...hintSeeds]) {
			mergeSeed(seed);
		}

		let maxKeywordRank = 0;
		for (const seed of candidateMap.values()) {
			if (seed.keywordRank > maxKeywordRank) maxKeywordRank = seed.keywordRank;
		}

		const results: HybridSearchResult[] = [];
		for (const seed of candidateMap.values()) {
			const { obs, keywordRank, vectorSimilarity, hasEntityMatch, hintScore, hintMatchedTypes } = seed;
			const scored = scoreHybridCandidate({
				observation: this.toPublicObservation(obs),
				territory: obs.territory,
				retrieval_profile: retrievalProfile,
				query_signals: querySignals,
				max_keyword_rank: maxKeywordRank,
				vector_similarity: vectorSimilarity,
				keyword_rank: keywordRank > 0 ? keywordRank : undefined,
				hint_score: hintScore > 0 ? hintScore : undefined,
				entity_matched: hasEntityMatch,
				novelty_score: typeof obs.novelty_score === "number"
					? obs.novelty_score
					: (typeof obs.texture?.novelty_score === "number" ? obs.texture.novelty_score : undefined),
				circadian_bias_matched: circadianBias.has(obs.territory),
				min_similarity: minSimilarity
			});
			if (!scored) continue;

			results.push({
				observation: this.toPublicObservation(obs),
				territory: obs.territory,
				score: scored.score,
				match_sources: hintMatchedTypes.length > 0
					? Array.from(new Set([...scored.match_sources, ...hintMatchedTypes]))
					: scored.match_sources,
				vector_similarity: vectorSimilarity,
				keyword_rank: keywordRank > 0 ? keywordRank : undefined,
				score_breakdown: scored.score_breakdown
			});
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, limit);
	}

	async recordMemoryCascade(observationIds: string[]): Promise<void> {
		const top = observationIds.slice(0, 5);
		if (top.length < 2) return;

		const pairs: Array<[string, string]> = [];
		for (let i = 0; i < top.length; i++) {
			for (let j = i + 1; j < top.length; j++) {
				const a = top[i];
				const b = top[j];
				pairs.push(a < b ? [a, b] : [b, a]);
			}
		}

		const current = await this.readCollection<CascadePair>(KV_KEYS.memory_cascade);
		const map = new Map<string, CascadePair>(current.map(p => [`${p.obs_id_a}::${p.obs_id_b}`, p] as [string, CascadePair]));
		const now = nowIso();
		for (const [a, b] of pairs) {
			const key = `${a}::${b}`;
			const existing = map.get(key);
			if (existing) {
				existing.count += 1;
				existing.last_co_surfaced = now;
			} else {
				map.set(key, { obs_id_a: a, obs_id_b: b, count: 1, last_co_surfaced: now });
			}
		}
		await this.writeCollection(KV_KEYS.memory_cascade, Array.from(map.values()));
	}

	async updateSurfacingEffects(observationIds: string[]): Promise<void> {
		if (!observationIds.length) return;
		const set = new Set(observationIds);
		await this.withObservations(async all => {
			for (const obs of all) {
				if (!set.has(obs.id)) continue;
				const currentNovelty = typeof obs.novelty_score === "number"
					? obs.novelty_score
					: (typeof obs.texture?.novelty_score === "number" ? obs.texture.novelty_score : 1.0);
				const nextNovelty = Math.max(currentNovelty - 0.05, 0.0);
				obs.novelty_score = nextNovelty;
				obs.texture = { ...obs.texture, novelty_score: nextNovelty };
				obs.surface_count = (obs.surface_count ?? 0) + 1;
				obs.last_surfaced_at = nowIso();
			}
		});
	}

	// ============ OPEN LOOPS ============

	async readOpenLoops(): Promise<OpenLoop[]> {
		return await this.readCollection<OpenLoop>(KV_KEYS.open_loops);
	}

	async writeOpenLoops(loops: OpenLoop[]): Promise<void> {
		await this.writeCollection(KV_KEYS.open_loops, loops);
	}

	async appendOpenLoop(loop: OpenLoop): Promise<void> {
		const loops = await this.readCollection<OpenLoop>(KV_KEYS.open_loops);
		loops.push(loop);
		await this.writeCollection(KV_KEYS.open_loops, loops);
	}

	// ============ LINKS ============

	async readLinks(): Promise<Link[]> {
		return await this.readCollection<Link>(KV_KEYS.links);
	}

	async writeLinks(links: Link[]): Promise<void> {
		await this.writeCollection(KV_KEYS.links, links);
	}

	async appendLink(link: Link): Promise<void> {
		const links = await this.readCollection<Link>(KV_KEYS.links);
		links.push(link);
		await this.writeCollection(KV_KEYS.links, links);
	}

	// ============ LETTERS ============

	async readLetters(): Promise<Letter[]> {
		return await this.readCollection<Letter>(KV_KEYS.letters);
	}

	async writeLetters(letters: Letter[]): Promise<void> {
		await this.writeCollection(KV_KEYS.letters, letters);
	}

	async appendLetter(letter: Letter): Promise<void> {
		const letters = await this.readCollection<Letter>(KV_KEYS.letters);
		letters.push(letter);
		await this.writeCollection(KV_KEYS.letters, letters);
	}

	// ============ IDENTITY / ANCHORS / DESIRES ============

	async readIdentityCores(): Promise<IdentityCore[]> {
		return await this.readCollection<IdentityCore>(KV_KEYS.identity_cores);
	}

	async writeIdentityCores(cores: IdentityCore[]): Promise<void> {
		await this.writeCollection(KV_KEYS.identity_cores, cores);
	}

	async readAnchors(): Promise<Anchor[]> {
		return await this.readCollection<Anchor>(KV_KEYS.anchors);
	}

	async writeAnchors(anchors: Anchor[]): Promise<void> {
		await this.writeCollection(KV_KEYS.anchors, anchors);
	}

	async readDesires(): Promise<Desire[]> {
		return await this.readCollection<Desire>(KV_KEYS.desires);
	}

	async writeDesires(desires: Desire[]): Promise<void> {
		await this.writeCollection(KV_KEYS.desires, desires);
	}

	// ============ WAKE LOG ============

	async appendWakeLog(entry: WakeLogEntry): Promise<void> {
		const rows = await this.readCollection<WakeLogEntry>(KV_KEYS.wake_log);
		rows.push(entry);
		await this.writeCollection(KV_KEYS.wake_log, rows);
	}

	async readWakeLog(): Promise<WakeLogEntry[]> {
		const rows = await this.readCollection<WakeLogEntry>(KV_KEYS.wake_log);
		return rows.sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));
	}

	async readLatestWakeLog(): Promise<WakeLogEntry | null> {
		const rows = await this.readWakeLog();
		if (!rows.length) return null;
		return rows[rows.length - 1];
	}

	// ============ CONVERSATION CONTEXT ============

	async readConversationContext(): Promise<unknown> {
		return await this.readValue(KV_KEYS.conversation_context, null);
	}

	async writeConversationContext(context: unknown): Promise<void> {
		await this.writeValue(KV_KEYS.conversation_context, context);
	}

	// ============ RELATIONAL / SUBCONSCIOUS / TRIGGERS ============

	async readRelationalState(): Promise<RelationalState[]> {
		return await this.readCollection<RelationalState>(KV_KEYS.relational_states);
	}

	async writeRelationalState(states: RelationalState[]): Promise<void> {
		await this.writeCollection(KV_KEYS.relational_states, states);
	}

	async readSubconscious(): Promise<SubconsciousState | null> {
		return await this.readValue<SubconsciousState | null>(KV_KEYS.subconscious, null);
	}

	async writeSubconscious(state: SubconsciousState): Promise<void> {
		await this.writeValue(KV_KEYS.subconscious, state);
	}

	async readTriggers(): Promise<TriggerCondition[]> {
		return await this.readCollection<TriggerCondition>(KV_KEYS.triggers);
	}

	async writeTriggers(triggers: TriggerCondition[]): Promise<void> {
		await this.writeCollection(KV_KEYS.triggers, triggers);
	}

	// ============ CONSENT ============

	async readConsent(): Promise<ConsentState> {
		const value = await this.readValue<ConsentState>(KV_KEYS.consent, this.defaultConsent());
		return {
			user_consent: Array.isArray(value.user_consent) ? value.user_consent : [],
			ai_boundaries: value.ai_boundaries ?? this.defaultConsent().ai_boundaries,
			relationship_level: value.relationship_level ?? "stranger",
			log: Array.isArray(value.log) ? value.log : []
		};
	}

	async writeConsent(consent: ConsentState): Promise<void> {
		await this.writeValue(KV_KEYS.consent, consent);
	}

	// ============ BACKFILL FLAGS ============

	async readBackfillFlag(version: string): Promise<unknown> {
		if (!/^[a-z0-9]+$/i.test(version)) throw new Error("Invalid backfill version");
		const flags = await this.readValue<Record<string, unknown>>(KV_KEYS.backfill_flags, {});
		return flags[version];
	}

	async writeBackfillFlag(version: string, data: unknown): Promise<void> {
		if (!/^[a-z0-9]+$/i.test(version)) throw new Error("Invalid backfill version");
		const flags = await this.readValue<Record<string, unknown>>(KV_KEYS.backfill_flags, {});
		flags[version] = data;
		await this.writeValue(KV_KEYS.backfill_flags, flags);
	}

	// ============ OVERVIEWS / IRON INDEX ============

	async readOverviews(): Promise<TerritoryOverview[]> {
		return await this.readCollection<TerritoryOverview>(KV_KEYS.territory_overviews);
	}

	async writeOverviews(overviews: TerritoryOverview[]): Promise<void> {
		await this.writeCollection(KV_KEYS.territory_overviews, overviews);
	}

	async readIronGripIndex(): Promise<IronGripEntry[]> {
		return await this.readCollection<IronGripEntry>(KV_KEYS.iron_grip_index);
	}

	async writeIronGripIndex(entries: IronGripEntry[]): Promise<void> {
		await this.writeCollection(KV_KEYS.iron_grip_index, entries);
	}

	async appendIronGripEntry(entry: IronGripEntry): Promise<void> {
		const rows = await this.readCollection<IronGripEntry>(KV_KEYS.iron_grip_index);
		rows.push(entry);
		await this.writeCollection(KV_KEYS.iron_grip_index, rows);
	}

	// ============ ENTITIES ============

	async createEntity(entity: Omit<Entity, "id" | "created_at" | "updated_at">): Promise<Entity> {
		const now = nowIso();
		const created: Entity = {
			id: generateId("ent"),
			tenant_id: this.tenant,
			name: entity.name,
			entity_type: entity.entity_type,
			tags: asArray<string>(entity.tags),
			salience: entity.salience ?? "active",
			primary_context: entity.primary_context,
			created_at: now,
			updated_at: now
		};
		const entities = await this.readCollection<Entity>(KV_KEYS.entities);
		entities.push(created);
		await this.writeCollection(KV_KEYS.entities, entities);
		return created;
	}

	async findEntityByName(name: string): Promise<Entity | null> {
		const needle = name.trim().toLowerCase();
		const entities = await this.readCollection<Entity>(KV_KEYS.entities);
		return entities.find(e => e.name.trim().toLowerCase() === needle) ?? null;
	}

	async findEntityById(id: string): Promise<Entity | null> {
		const entities = await this.readCollection<Entity>(KV_KEYS.entities);
		return entities.find(e => e.id === id) ?? null;
	}

	async listEntities(filter?: EntityFilter): Promise<Entity[]> {
		let entities = await this.readCollection<Entity>(KV_KEYS.entities);
		if (filter?.entity_type) entities = entities.filter(e => e.entity_type === filter.entity_type);
		if (filter?.salience) entities = entities.filter(e => e.salience === filter.salience);
		if (filter?.tags?.length) entities = entities.filter(e => filter.tags!.some(t => (e.tags ?? []).includes(t)));
		entities.sort((a, b) => toMillis(b.updated_at) - toMillis(a.updated_at));
		if (filter?.limit) entities = entities.slice(0, Math.max(1, filter.limit));
		return entities;
	}

	async updateEntity(id: string, updates: Partial<Pick<Entity, "name" | "entity_type" | "tags" | "salience" | "primary_context">>): Promise<Entity> {
		const entities = await this.readCollection<Entity>(KV_KEYS.entities);
		const idx = entities.findIndex(e => e.id === id);
		if (idx < 0) throw new Error("Entity not found");
		const current = entities[idx];
		const updated: Entity = {
			...current,
			...updates,
			tags: updates.tags ? asArray<string>(updates.tags) : current.tags,
			updated_at: nowIso()
		};
		entities[idx] = updated;
		await this.writeCollection(KV_KEYS.entities, entities);
		return updated;
	}

	// ============ PROJECT DOSSIERS ============

	async createProjectDossier(dossier: Omit<ProjectDossier, "id" | "tenant_id" | "created_at" | "updated_at">): Promise<ProjectDossier> {
		const now = nowIso();
		const created: ProjectDossier = {
			id: generateId("proj"),
			tenant_id: this.tenant,
			project_entity_id: dossier.project_entity_id,
			lifecycle_status: dossier.lifecycle_status ?? "active",
			summary: dossier.summary,
			goals: asArray<string>(dossier.goals),
			constraints: asArray<string>(dossier.constraints),
			decisions: asArray<string>(dossier.decisions),
			open_questions: asArray<string>(dossier.open_questions),
			next_actions: asArray<string>(dossier.next_actions),
			metadata: dossier.metadata ?? {},
			last_active_at: dossier.last_active_at,
			created_at: now,
			updated_at: now
		};
		const rows = await this.readCollection<ProjectDossier>(KV_KEYS.project_dossiers);
		rows.push(created);
		await this.writeCollection(KV_KEYS.project_dossiers, rows);
		return created;
	}

	async getProjectDossier(projectEntityId: string): Promise<ProjectDossier | null> {
		const rows = await this.readCollection<ProjectDossier>(KV_KEYS.project_dossiers);
		return rows.find(r => r.project_entity_id === projectEntityId) ?? null;
	}

	async listProjectDossiers(filter?: ProjectDossierFilter): Promise<ProjectDossier[]> {
		let rows = await this.readCollection<ProjectDossier>(KV_KEYS.project_dossiers);
		if (filter?.lifecycle_status) rows = rows.filter(r => r.lifecycle_status === filter.lifecycle_status);
		if (filter?.updated_after) rows = rows.filter(r => toMillis(r.updated_at) >= toMillis(filter.updated_after));
		rows.sort((a, b) => toMillis(b.updated_at) - toMillis(a.updated_at));
		if (filter?.limit) rows = rows.slice(0, Math.max(1, filter.limit));
		return rows;
	}

	async updateProjectDossier(
		projectEntityId: string,
		updates: Partial<Pick<ProjectDossier, "lifecycle_status" | "summary" | "goals" | "constraints" | "decisions" | "open_questions" | "next_actions" | "metadata" | "last_active_at">>
	): Promise<ProjectDossier> {
		const rows = await this.readCollection<ProjectDossier>(KV_KEYS.project_dossiers);
		const idx = rows.findIndex(r => r.project_entity_id === projectEntityId);
		if (idx < 0) throw new Error("Project dossier not found");
		const current = rows[idx];
		const updated: ProjectDossier = {
			...current,
			...updates,
			goals: updates.goals ? asArray<string>(updates.goals) : current.goals,
			constraints: updates.constraints ? asArray<string>(updates.constraints) : current.constraints,
			decisions: updates.decisions ? asArray<string>(updates.decisions) : current.decisions,
			open_questions: updates.open_questions ? asArray<string>(updates.open_questions) : current.open_questions,
			next_actions: updates.next_actions ? asArray<string>(updates.next_actions) : current.next_actions,
			metadata: updates.metadata ?? current.metadata,
			updated_at: nowIso()
		};
		rows[idx] = updated;
		await this.writeCollection(KV_KEYS.project_dossiers, rows);
		return updated;
	}

	// ============ AGENT MANIFESTS ============

	async createAgentCapabilityManifest(manifest: Omit<AgentCapabilityManifest, "id" | "tenant_id" | "created_at" | "updated_at">): Promise<AgentCapabilityManifest> {
		const now = nowIso();
		const created: AgentCapabilityManifest = {
			id: generateId("manifest"),
			tenant_id: this.tenant,
			agent_entity_id: manifest.agent_entity_id,
			version: manifest.version ?? "1.0.0",
			delegation_mode: manifest.delegation_mode ?? "explicit",
			router_agent_entity_id: manifest.router_agent_entity_id,
			supports_streaming: Boolean(manifest.supports_streaming),
			accepted_output_modes: asArray<string>(manifest.accepted_output_modes),
			protocols: asArray<string>(manifest.protocols),
			skills: asArray<any>(manifest.skills),
			metadata: manifest.metadata ?? {},
			created_at: now,
			updated_at: now
		};
		const rows = await this.readCollection<AgentCapabilityManifest>(KV_KEYS.agent_capability_manifests);
		rows.push(created);
		await this.writeCollection(KV_KEYS.agent_capability_manifests, rows);
		return created;
	}

	async getAgentCapabilityManifest(agentEntityId: string): Promise<AgentCapabilityManifest | null> {
		const rows = await this.readCollection<AgentCapabilityManifest>(KV_KEYS.agent_capability_manifests);
		return rows.find(r => r.agent_entity_id === agentEntityId) ?? null;
	}

	async listAgentCapabilityManifests(filter?: AgentCapabilityManifestFilter): Promise<AgentCapabilityManifest[]> {
		let rows = await this.readCollection<AgentCapabilityManifest>(KV_KEYS.agent_capability_manifests);
		if (filter?.delegation_mode) rows = rows.filter(r => r.delegation_mode === filter.delegation_mode);
		rows.sort((a, b) => toMillis(b.updated_at) - toMillis(a.updated_at));
		if (filter?.limit) rows = rows.slice(0, Math.max(1, filter.limit));
		return rows;
	}

	async updateAgentCapabilityManifest(
		agentEntityId: string,
		updates: Partial<Pick<AgentCapabilityManifest, "version" | "delegation_mode" | "router_agent_entity_id" | "supports_streaming" | "accepted_output_modes" | "protocols" | "skills" | "metadata">>
	): Promise<AgentCapabilityManifest> {
		const rows = await this.readCollection<AgentCapabilityManifest>(KV_KEYS.agent_capability_manifests);
		const idx = rows.findIndex(r => r.agent_entity_id === agentEntityId);
		if (idx < 0) throw new Error("Agent manifest not found");
		const current = rows[idx];
		const updated: AgentCapabilityManifest = {
			...current,
			...updates,
			accepted_output_modes: updates.accepted_output_modes ? asArray<string>(updates.accepted_output_modes) : current.accepted_output_modes,
			protocols: updates.protocols ? asArray<string>(updates.protocols) : current.protocols,
			skills: updates.skills ? asArray<any>(updates.skills) : current.skills,
			metadata: updates.metadata ?? current.metadata,
			updated_at: nowIso()
		};
		rows[idx] = updated;
		await this.writeCollection(KV_KEYS.agent_capability_manifests, rows);
		return updated;
	}

	// ============ RELATIONS ============

	async createRelation(relation: Omit<Relation, "id" | "created_at" | "updated_at">): Promise<Relation> {
		const now = nowIso();
		const created: Relation = {
			id: generateId("rel"),
			tenant_id: this.tenant,
			from_entity_id: relation.from_entity_id,
			to_entity_id: relation.to_entity_id,
			relation_type: relation.relation_type,
			strength: relation.strength ?? 1.0,
			context: relation.context,
			created_at: now,
			updated_at: now
		};
		const rows = await this.readCollection<Relation>(KV_KEYS.relations);
		rows.push(created);
		await this.writeCollection(KV_KEYS.relations, rows);
		return created;
	}

	async getEntityRelations(entityId: string): Promise<Relation[]> {
		const rows = await this.readCollection<Relation>(KV_KEYS.relations);
		return rows.filter(r => r.from_entity_id === entityId || r.to_entity_id === entityId);
	}

	// ============ ENTITY-OBS LINKS ============

	async linkObservationToEntity(observationId: string, entityId: string): Promise<void> {
		await this.withObservations(async all => {
			const target = all.find(o => o.id === observationId);
			if (!target) throw new Error("Observation not found");
			target.entity_id = entityId;
		});
	}

	async getEntityObservations(entityId: string, limit = 20): Promise<{ observation: Observation; territory: string }[]> {
		const cap = Math.max(1, Math.min(limit, 200));
		const rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations))
			.map(o => this.normalizeObservation(o))
			.filter(o => o.entity_id === entityId)
			.sort((a, b) => toMillis(b.created) - toMillis(a.created))
			.slice(0, cap);
		return rows.map(o => ({ observation: this.toPublicObservation(o), territory: o.territory }));
	}

	async batchGetEntityObservations(entityIds: string[], limitPerEntity = 20): Promise<Map<string, { observation: Observation; territory: string }[]>> {
		const result = new Map<string, { observation: Observation; territory: string }[]>();
		const all = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));
		for (const entityId of entityIds) {
			const rows = all
				.filter(o => o.entity_id === entityId)
				.sort((a, b) => toMillis(b.created) - toMillis(a.created))
				.slice(0, Math.max(1, limitPerEntity))
				.map(o => ({ observation: this.toPublicObservation(o), territory: o.territory }));
			result.set(entityId, rows);
		}
		return result;
	}

	async queryEntityTagsForBackfill(): Promise<Array<{ id: string; entity_tags: string[] }>> {
		const rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));
		return rows
			.filter(o => !o.entity_id && Array.isArray(o.entity_tags) && o.entity_tags.length > 0)
			.map(o => ({ id: o.id, entity_tags: asArray<string>(o.entity_tags) }));
	}

	// ============ PROPOSALS ============

	async createProposal(proposal: Omit<DaemonProposal, "id" | "proposed_at">): Promise<DaemonProposal> {
		const created: DaemonProposal = {
			id: `prop_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
			tenant_id: this.tenant,
			proposal_type: proposal.proposal_type,
			source_id: proposal.source_id,
			target_id: proposal.target_id,
			similarity: proposal.similarity,
			resonance_type: proposal.resonance_type,
			confidence: proposal.confidence,
			rationale: proposal.rationale,
			metadata: proposal.metadata ?? {},
			status: proposal.status,
			feedback_note: proposal.feedback_note,
			proposed_at: nowIso(),
			reviewed_at: proposal.reviewed_at
		};
		const rows = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		rows.push(created);
		await this.writeCollection(KV_KEYS.daemon_proposals, rows);
		return created;
	}

	async listProposals(type?: string, status?: string, limit?: number): Promise<DaemonProposal[]> {
		let rows = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		if (type) rows = rows.filter(r => r.proposal_type === type);
		if (status) rows = rows.filter(r => r.status === status);
		rows.sort((a, b) => toMillis(b.proposed_at) - toMillis(a.proposed_at));
		return rows.slice(0, Math.min(limit ?? 50, 200));
	}

	async getProposalById(id: string): Promise<DaemonProposal | null> {
		const rows = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		return rows.find(r => r.id === id) ?? null;
	}

	async reviewProposal(id: string, status: "accepted" | "rejected", feedbackNote?: string): Promise<DaemonProposal> {
		const rows = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		const idx = rows.findIndex(r => r.id === id);
		if (idx < 0) throw new Error("Proposal not found");
		rows[idx] = { ...rows[idx], status, feedback_note: feedbackNote, reviewed_at: nowIso() };
		await this.writeCollection(KV_KEYS.daemon_proposals, rows);
		return rows[idx];
	}

	async getProposalStats(): Promise<Record<string, { total: number; accepted: number; rejected: number; ratio: number }>> {
		const rows = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		const out: Record<string, { total: number; accepted: number; rejected: number; ratio: number }> = {};
		for (const row of rows) {
			if (!out[row.proposal_type]) {
				out[row.proposal_type] = { total: 0, accepted: 0, rejected: 0, ratio: 0 };
			}
			out[row.proposal_type].total += 1;
			if (row.status === "accepted") out[row.proposal_type].accepted += 1;
			if (row.status === "rejected") out[row.proposal_type].rejected += 1;
		}
		for (const value of Object.values(out)) {
			value.ratio = value.total > 0 ? value.accepted / value.total : 0;
		}
		return out;
	}

	async proposalExists(type: string, sourceId: string, targetId: string): Promise<boolean> {
		const rows = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		return rows.some(r => r.proposal_type === type && r.source_id === sourceId && r.target_id === targetId && r.status === "pending");
	}

	async batchProposalExists(checks: Array<{ type: string; sourceId: string; targetId: string }>): Promise<Set<string>> {
		const rows = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		const pending = rows.filter(r => r.status === "pending");
		const set = new Set<string>();
		for (const check of checks) {
			const exists = pending.some(r => r.proposal_type === check.type && r.source_id === check.sourceId && r.target_id === check.targetId);
			if (exists) set.add(`${check.type}::${check.sourceId}::${check.targetId}`);
		}
		return set;
	}

	// ============ ORPHANS ============

	async markOrphan(observationId: string): Promise<void> {
		const rows = await this.readCollection<OrphanObservation>(KV_KEYS.orphan_observations);
		const existing = rows.find(r => r.observation_id === observationId);
		if (existing) return;
		rows.push({
			observation_id: observationId,
			tenant_id: this.tenant,
			first_marked: nowIso(),
			rescue_attempts: 0,
			status: "orphaned"
		});
		await this.writeCollection(KV_KEYS.orphan_observations, rows);
	}

	async listOrphans(status?: string, limit?: number): Promise<OrphanObservation[]> {
		let rows = await this.readCollection<OrphanObservation>(KV_KEYS.orphan_observations);
		if (status) rows = rows.filter(r => r.status === status);
		rows.sort((a, b) => toMillis(b.first_marked) - toMillis(a.first_marked));
		return rows.slice(0, Math.min(limit ?? 50, 200));
	}

	async incrementRescueAttempt(observationId: string): Promise<void> {
		const rows = await this.readCollection<OrphanObservation>(KV_KEYS.orphan_observations);
		const idx = rows.findIndex(r => r.observation_id === observationId);
		if (idx < 0) return;
		rows[idx] = {
			...rows[idx],
			rescue_attempts: rows[idx].rescue_attempts + 1,
			last_rescue_attempt: nowIso()
		};
		await this.writeCollection(KV_KEYS.orphan_observations, rows);
	}

	async updateOrphanStatus(observationId: string, status: "rescued" | "archived"): Promise<void> {
		const rows = await this.readCollection<OrphanObservation>(KV_KEYS.orphan_observations);
		const idx = rows.findIndex(r => r.observation_id === observationId);
		if (idx < 0) return;
		rows[idx] = { ...rows[idx], status };
		await this.writeCollection(KV_KEYS.orphan_observations, rows);
	}

	// ============ DAEMON CONFIG / HEALTH ============

	async readDaemonConfig(): Promise<DaemonConfig> {
		const config = await this.readValue<DaemonConfig | null>(KV_KEYS.daemon_config, null);
		if (!config) return this.defaultDaemonConfig();
		return {
			tenant_id: this.tenant,
			link_proposal_threshold: typeof config.link_proposal_threshold === "number" ? config.link_proposal_threshold : 0.75,
			last_threshold_update: config.last_threshold_update,
			data: config.data ?? {}
		};
	}

	async updateProposalThreshold(threshold: number): Promise<void> {
		const current = await this.readDaemonConfig();
		await this.writeValue(KV_KEYS.daemon_config, {
			...current,
			link_proposal_threshold: threshold,
			last_threshold_update: nowIso()
		});
	}

	async getEmbeddingCoverage(): Promise<{ total: number; embedded: number }> {
		const rows = (await this.readCollection<StoredObservation>(KV_KEYS.observations)).map(o => this.normalizeObservation(o));
		return {
			total: rows.length,
			embedded: rows.filter(r => Array.isArray(r.embedding) && r.embedding.length > 0).length
		};
	}

	async getOrphanStats(): Promise<{ orphaned: number; rescued: number; archived: number; oldest_days: number }> {
		const rows = await this.readCollection<OrphanObservation>(KV_KEYS.orphan_observations);
		const orphaned = rows.filter(r => r.status === "orphaned");
		const rescued = rows.filter(r => r.status === "rescued").length;
		const archived = rows.filter(r => r.status === "archived").length;
		const oldestMs = orphaned.length ? Math.min(...orphaned.map(r => toMillis(r.first_marked)).filter(Boolean)) : 0;
		const oldestDays = oldestMs ? Math.floor((Date.now() - oldestMs) / (1000 * 60 * 60 * 24)) : 0;
		return { orphaned: orphaned.length, rescued, archived, oldest_days: oldestDays };
	}

	async getTopCascadePairs(limit = 20): Promise<Array<{ obs_id_a: string; obs_id_b: string; count: number }>> {
		const rows = await this.readCollection<CascadePair>(KV_KEYS.memory_cascade);
		return rows
			.sort((a, b) => b.count - a.count)
			.slice(0, Math.max(1, Math.min(limit, 200)))
			.map(r => ({ obs_id_a: r.obs_id_a, obs_id_b: r.obs_id_b, count: r.count }));
	}

	// ============ DAEMON SEARCH HELPERS ============

	async findSimilarUnlinked(sourceId: string, limit: number): Promise<Array<{ observation: Observation; territory: string; similarity: number }>> {
		const source = (await this.readCollection<StoredObservation>(KV_KEYS.observations))
			.map(o => this.normalizeObservation(o))
			.find(o => o.id === sourceId);
		if (!source?.embedding?.length) return [];

		const links = await this.readCollection<Link>(KV_KEYS.links);
		const linkedIds = new Set<string>();
		for (const link of links) {
			if (link.source_id === sourceId) linkedIds.add(link.target_id);
			if (link.target_id === sourceId) linkedIds.add(link.source_id);
		}

		const proposals = await this.readCollection<DaemonProposal>(KV_KEYS.daemon_proposals);
		const pending = new Set(
			proposals
				.filter(p => p.status === "pending" && p.proposal_type === "link" && p.source_id === sourceId)
				.map(p => p.target_id)
		);

		const similar = await this.searchSimilar({ embedding: source.embedding, limit: Math.max(limit * 4, 40) });
		return similar
			.filter(s => s.observation.id !== sourceId && !linkedIds.has(s.observation.id) && !pending.has(s.observation.id))
			.slice(0, Math.max(1, limit));
	}

	async findOrphanCandidates(cutoffDate: string, limit: number): Promise<Observation[]> {
		const cutoff = toMillis(cutoffDate);
		const cap = Math.max(1, Math.min(limit, 500));
		const orphans = await this.readCollection<OrphanObservation>(KV_KEYS.orphan_observations);
		const alreadyMarked = new Set(orphans.map(o => o.observation_id));

		const candidates = (await this.readCollection<StoredObservation>(KV_KEYS.observations))
			.map(o => this.normalizeObservation(o))
			.filter(o => !o.entity_id)
			.filter(o => (o.access_count ?? 0) <= 1)
			.filter(o => toMillis(o.created) <= cutoff)
			.filter(o => !alreadyMarked.has(o.id))
			.sort((a, b) => toMillis(a.created) - toMillis(b.created))
			.slice(0, cap);

		return candidates.map(c => this.toPublicObservation(c));
	}

	// ============ VERSIONS / PROCESSING ============

	async createVersion(observationId: string, content: string, texture: Observation["texture"], changeReason?: string): Promise<ObservationVersion> {
		const versions = await this.readCollection<ObservationVersion>(KV_KEYS.observation_versions);
		const versionNum = versions.filter(v => v.observation_id === observationId).length + 1;
		const created: ObservationVersion = {
			id: generateId("ver"),
			tenant_id: this.tenant,
			observation_id: observationId,
			version_num: versionNum,
			content,
			texture,
			change_reason: changeReason,
			created_at: nowIso()
		};
		versions.push(created);
		await this.writeCollection(KV_KEYS.observation_versions, versions);
		return created;
	}

	async getVersionHistory(observationId: string): Promise<ObservationVersion[]> {
		const versions = await this.readCollection<ObservationVersion>(KV_KEYS.observation_versions);
		return versions
			.filter(v => v.observation_id === observationId)
			.sort((a, b) => a.version_num - b.version_num);
	}

	async createProcessingEntry(entry: Omit<ProcessingEntry, "id" | "tenant_id" | "created_at">): Promise<ProcessingEntry> {
		const created: ProcessingEntry = {
			id: generateId("proc"),
			tenant_id: this.tenant,
			observation_id: entry.observation_id,
			processing_note: entry.processing_note,
			charge_at_processing: asArray<string>(entry.charge_at_processing),
			somatic_at_processing: entry.somatic_at_processing,
			created_at: nowIso()
		};
		const rows = await this.readCollection<ProcessingEntry>(KV_KEYS.processing_log);
		rows.push(created);
		await this.writeCollection(KV_KEYS.processing_log, rows);
		return created;
	}

	async listProcessingEntries(observationId: string, limit = 20): Promise<ProcessingEntry[]> {
		const rows = await this.readCollection<ProcessingEntry>(KV_KEYS.processing_log);
		return rows
			.filter(r => r.observation_id === observationId)
			.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
			.slice(0, Math.max(1, Math.min(limit, 200)));
	}

	async incrementProcessingCount(observationId: string): Promise<number> {
		let count = 0;
		await this.withObservations(async all => {
			const target = all.find(o => o.id === observationId);
			if (!target) return;
			target.processing_count = (target.processing_count ?? 0) + 1;
			count = target.processing_count;
		});
		return count;
	}

	async advanceChargePhase(observationId: string): Promise<{ advanced: boolean; new_phase?: string }> {
		const PHASE_ORDER = ["fresh", "active", "processing", "metabolized"] as const;
		let outcome: { advanced: boolean; new_phase?: string } = { advanced: false };

		const loops = await this.readCollection<OpenLoop>(KV_KEYS.open_loops);
		await this.withObservations(async all => {
			const target = all.find(o => o.id === observationId);
			if (!target) return;
			const processingCount = target.processing_count ?? 0;
			if (processingCount < 1) return;

			const current = (target.texture?.charge_phase ?? "fresh") as typeof PHASE_ORDER[number];
			const idx = PHASE_ORDER.indexOf(current);
			if (idx < 0 || idx >= PHASE_ORDER.length - 1) return;

			let threshold = 3;
			if (target.entity_id) {
				const accelerated = loops.some(loop =>
					loop.status === "burning" &&
					loop.mode === "paradox" &&
					Array.isArray(loop.linked_entity_ids) &&
					loop.linked_entity_ids.includes(target.entity_id!)
				);
				if (accelerated) threshold = 2;
			}

			if (processingCount < threshold) return;

			const nextPhase = PHASE_ORDER[idx + 1];
			target.texture = { ...target.texture, charge_phase: nextPhase };
			outcome = { advanced: true, new_phase: nextPhase };
		});

		return outcome;
	}

	// ============ CONSOLIDATION ============

	async createConsolidationCandidate(candidate: Omit<ConsolidationCandidate, "id" | "tenant_id" | "created_at" | "reviewed_at">): Promise<ConsolidationCandidate> {
		const created: ConsolidationCandidate = {
			id: generateId("cons"),
			tenant_id: this.tenant,
			source_observation_ids: asArray<string>(candidate.source_observation_ids),
			pattern_description: candidate.pattern_description,
			suggested_territory: candidate.suggested_territory,
			suggested_type: candidate.suggested_type,
			status: candidate.status,
			created_at: nowIso()
		};
		const rows = await this.readCollection<ConsolidationCandidate>(KV_KEYS.consolidation_candidates);
		rows.push(created);
		await this.writeCollection(KV_KEYS.consolidation_candidates, rows);
		return created;
	}

	async listConsolidationCandidates(status?: string, limit?: number): Promise<ConsolidationCandidate[]> {
		let rows = await this.readCollection<ConsolidationCandidate>(KV_KEYS.consolidation_candidates);
		if (status) rows = rows.filter(r => r.status === status);
		rows.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
		return rows.slice(0, Math.min(limit ?? 50, 200));
	}

	async reviewConsolidationCandidate(id: string, status: "accepted" | "rejected" | "deferred"): Promise<ConsolidationCandidate> {
		const rows = await this.readCollection<ConsolidationCandidate>(KV_KEYS.consolidation_candidates);
		const idx = rows.findIndex(r => r.id === id);
		if (idx < 0) throw new Error("Consolidation candidate not found");
		rows[idx] = { ...rows[idx], status, reviewed_at: nowIso() };
		await this.writeCollection(KV_KEYS.consolidation_candidates, rows);
		return rows[idx];
	}

	// ============ DISPATCH FEEDBACK ============

	async recordDispatch(entry: Omit<DispatchFeedback, "id" | "tenant_id" | "dispatched_at">): Promise<DispatchFeedback> {
		const created: DispatchFeedback = {
			id: generateId("dispatch"),
			tenant_id: this.tenant,
			agent_entity_id: entry.agent_entity_id,
			task_type: entry.task_type,
			domain: entry.domain,
			environment: entry.environment,
			session_id: entry.session_id,
			dispatched_at: nowIso(),
			outcome: entry.outcome,
			findings_count: entry.findings_count ?? 0,
			findings_acted: entry.findings_acted ?? 0,
			confidence_avg: entry.confidence_avg,
			predicted_confidence: entry.predicted_confidence,
			outcome_score: entry.outcome_score,
			revision_cost: entry.revision_cost,
			needed_rescue: entry.needed_rescue,
			rescue_agent_id: entry.rescue_agent_id,
			time_to_usable_ms: entry.time_to_usable_ms,
			notes: entry.notes,
			reviewed_at: entry.reviewed_at
		};
		const rows = await this.readCollection<DispatchFeedback>(KV_KEYS.dispatch_feedback);
		rows.push(created);
		await this.writeCollection(KV_KEYS.dispatch_feedback, rows);
		return created;
	}

	async getDispatchStats(agentEntityId?: string): Promise<DispatchStat[]> {
		let rows = await this.readCollection<DispatchFeedback>(KV_KEYS.dispatch_feedback);
		if (agentEntityId) rows = rows.filter(r => r.agent_entity_id === agentEntityId);

		const grouped = new Map<string, DispatchFeedback[]>();
		for (const row of rows) {
			const list = grouped.get(row.task_type) ?? [];
			list.push(row);
			grouped.set(row.task_type, list);
		}

		const stats: DispatchStat[] = [];
		for (const [task_type, list] of grouped) {
			const total = list.length;
			const effective = list.filter(r => r.outcome === "effective").length;
			const partial = list.filter(r => r.outcome === "partial").length;
			const ineffective = list.filter(r => r.outcome === "ineffective").length;
			const redirected = list.filter(r => r.outcome === "redirected").length;
			const avg = (vals: Array<number | undefined>) => {
				const xs = vals.filter((v): v is number => typeof v === "number");
				return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
			};
			const rescueRate = total ? list.filter(r => r.needed_rescue).length / total : 0;
			stats.push({
				task_type,
				total,
				effective,
				partial,
				ineffective,
				redirected,
				avg_confidence: avg(list.map(r => r.confidence_avg)),
				avg_predicted_confidence: avg(list.map(r => r.predicted_confidence)),
				avg_outcome_score: avg(list.map(r => r.outcome_score)),
				avg_revision_cost: avg(list.map(r => r.revision_cost)),
				rescue_rate: rescueRate
			});
		}

		stats.sort((a, b) => b.total - a.total);
		return stats;
	}

	// ============ TASKS ============

	async createTask(task: Omit<Task, "id" | "tenant_id" | "created_at" | "updated_at">): Promise<Task> {
		const now = nowIso();
		const created: Task = {
			id: generateId("task"),
			tenant_id: this.tenant,
			assigned_tenant: task.assigned_tenant,
			title: task.title,
			description: task.description,
			status: task.status ?? "open",
			priority: task.priority ?? "normal",
			estimated_effort: task.estimated_effort,
			scheduled_wake: task.scheduled_wake,
			source: task.source,
			linked_observation_ids: asArray<string>(task.linked_observation_ids),
			linked_entity_ids: asArray<string>(task.linked_entity_ids),
			depends_on: task.depends_on ? asArray<string>(task.depends_on) : undefined,
			completion_note: task.completion_note,
			created_at: now,
			updated_at: now,
			completed_at: task.completed_at
		};
		const rows = await this.readCollection<Task>(KV_KEYS.tasks);
		rows.push(created);
		await this.writeCollection(KV_KEYS.tasks, rows);
		return created;
	}

	async listTasks(status?: string, priority?: string, limit?: number, includeAssigned?: boolean): Promise<Task[]> {
		let rows = await this.readCollection<Task>(KV_KEYS.tasks);
		rows = rows.filter(r => r.tenant_id === this.tenant || (includeAssigned && r.assigned_tenant === this.tenant));
		if (status) rows = rows.filter(r => r.status === status);
		if (priority) rows = rows.filter(r => r.priority === priority);
		if (status === "scheduled") {
			rows.sort((a, b) => {
				const sa = toMillis(a.scheduled_wake) || Number.MAX_SAFE_INTEGER;
				const sb = toMillis(b.scheduled_wake) || Number.MAX_SAFE_INTEGER;
				if (sa !== sb) return sa - sb;
				return toMillis(b.created_at) - toMillis(a.created_at);
			});
		} else {
			rows.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));
		}
		return rows.slice(0, Math.min(limit ?? 50, 200));
	}

	async listTaskChangesSince(since: string, limit?: number, includeAssigned?: boolean): Promise<Task[]> {
		const ts = toMillis(since);
		let rows = await this.readCollection<Task>(KV_KEYS.tasks);
		rows = rows.filter(r => r.tenant_id === this.tenant || (includeAssigned && r.assigned_tenant === this.tenant));
		rows = rows.filter(r => toMillis(r.updated_at) >= ts);
		rows.sort((a, b) => toMillis(b.updated_at) - toMillis(a.updated_at));
		return rows.slice(0, Math.min(limit ?? 50, 200));
	}

	async updateTask(
		id: string,
		updates: Partial<Pick<Task, "title" | "description" | "status" | "priority" | "estimated_effort" | "scheduled_wake" | "completion_note" | "completed_at">>,
		includeAssigned?: boolean
	): Promise<Task> {
		if (!Object.keys(updates).length) throw new Error("No fields to update");
		const rows = await this.readCollection<Task>(KV_KEYS.tasks);
		const idx = rows.findIndex(r => r.id === id && (r.tenant_id === this.tenant || (includeAssigned && r.assigned_tenant === this.tenant)));
		if (idx < 0) throw new Error("Task not found");
		rows[idx] = { ...rows[idx], ...updates, updated_at: nowIso() };
		await this.writeCollection(KV_KEYS.tasks, rows);
		return rows[idx];
	}

	async openDueScheduledTasks(nowIsoParam?: string, limit?: number): Promise<number> {
		const nowMs = toMillis(nowIsoParam ?? nowIso());
		const cap = Math.max(1, Math.min(limit ?? 200, 500));
		const rows = await this.readCollection<Task>(KV_KEYS.tasks);

		const due = rows
			.map((task, index) => ({ task, index }))
			.filter(({ task }) => task.tenant_id === this.tenant)
			.filter(({ task }) => task.status === "scheduled")
			.filter(({ task }) => task.scheduled_wake && toMillis(task.scheduled_wake) <= nowMs)
			.sort((a, b) => {
				const sa = toMillis(a.task.scheduled_wake);
				const sb = toMillis(b.task.scheduled_wake);
				if (sa !== sb) return sa - sb;
				return toMillis(a.task.created_at) - toMillis(b.task.created_at);
			})
			.slice(0, cap);

		for (const { index } of due) {
			rows[index] = { ...rows[index], status: "open", updated_at: nowIso() };
		}

		if (due.length > 0) {
			await this.writeCollection(KV_KEYS.tasks, rows);
		}

		return due.length;
	}

	async getTask(id: string, includeAssigned?: boolean): Promise<Task | null> {
		const rows = await this.readCollection<Task>(KV_KEYS.tasks);
		return rows.find(r => r.id === id && (r.tenant_id === this.tenant || (includeAssigned && r.assigned_tenant === this.tenant))) ?? null;
	}

	// ============ CAPTURED SKILLS ============

	async createCapturedSkillArtifact(artifact: CapturedSkillArtifactCreate): Promise<CapturedSkillArtifact> {
		const rows = await this.readCollection<CapturedSkillArtifact>(KV_KEYS.captured_skills);
		const version = rows
			.filter(r => r.skill_key === artifact.skill_key)
			.reduce((max, row) => Math.max(max, row.version), 0) + 1;

		const now = nowIso();
		const created: CapturedSkillArtifact = {
			id: generateId("skill"),
			tenant_id: this.tenant,
			skill_key: artifact.skill_key,
			version,
			layer: artifact.layer ?? "captured",
			status: artifact.status ?? "candidate",
			name: artifact.name,
			domain: artifact.domain,
			environment: artifact.environment,
			task_type: artifact.task_type,
			agent_tenant: artifact.agent_tenant,
			source_runtime_run_id: artifact.source_runtime_run_id,
			source_task_id: artifact.source_task_id,
			source_observation_id: artifact.source_observation_id,
			provenance: artifact.provenance ?? {},
			metadata: artifact.metadata ?? {},
			created_at: now,
			updated_at: now
		};
		rows.push(created);
		await this.writeCollection(KV_KEYS.captured_skills, rows);
		return created;
	}

	async getCapturedSkillArtifact(id: string): Promise<CapturedSkillArtifact | null> {
		const rows = await this.readCollection<CapturedSkillArtifact>(KV_KEYS.captured_skills);
		return rows.find(r => r.id === id) ?? null;
	}

	async listCapturedSkillArtifacts(filter?: CapturedSkillArtifactFilter): Promise<CapturedSkillArtifact[]> {
		let rows = await this.readCollection<CapturedSkillArtifact>(KV_KEYS.captured_skills);
		if (filter?.status) rows = rows.filter(r => r.status === filter.status);
		if (filter?.layer) rows = rows.filter(r => r.layer === filter.layer);
		if (filter?.agent_tenant) rows = rows.filter(r => r.agent_tenant === filter.agent_tenant);
		if (filter?.task_type) rows = rows.filter(r => r.task_type === filter.task_type);
		rows.sort((a, b) => toMillis(b.updated_at) - toMillis(a.updated_at));
		return rows.slice(0, Math.min(filter?.limit ?? 20, 100));
	}

	async reviewCapturedSkillArtifact(
		id: string,
		status: CapturedSkillArtifact["status"],
		reviewedBy?: string,
		reviewNote?: string
	): Promise<CapturedSkillArtifact> {
		const rows = await this.readCollection<CapturedSkillArtifact>(KV_KEYS.captured_skills);
		const idx = rows.findIndex(r => r.id === id);
		if (idx < 0) throw new Error("Captured skill not found");
		rows[idx] = {
			...rows[idx],
			status,
			reviewed_by: reviewedBy,
			review_note: reviewNote,
			reviewed_at: nowIso(),
			updated_at: nowIso()
		};
		await this.writeCollection(KV_KEYS.captured_skills, rows);
		return rows[idx];
	}

	async getCapturedSkillRegistryHealth(): Promise<CapturedSkillRegistryHealth> {
		const rows = await this.readCollection<CapturedSkillArtifact>(KV_KEYS.captured_skills);
		const by_status: CapturedSkillRegistryHealth["by_status"] = {
			candidate: 0,
			accepted: 0,
			degraded: 0,
			retired: 0
		};
		const by_layer: CapturedSkillRegistryHealth["by_layer"] = {
			fixed: 0,
			captured: 0,
			derived: 0
		};

		for (const row of rows) {
			by_status[row.status] = (by_status[row.status] ?? 0) + 1;
			by_layer[row.layer] = (by_layer[row.layer] ?? 0) + 1;
		}

		return {
			total: rows.length,
			by_status,
			by_layer,
			with_runtime_provenance: rows.filter(r => Boolean(r.source_runtime_run_id)).length,
			with_task_provenance: rows.filter(r => Boolean(r.source_task_id)).length,
			with_observation_provenance: rows.filter(r => Boolean(r.source_observation_id)).length,
			pending_review: rows.filter(r => r.status === "candidate").length
		};
	}

	// ============ AUTONOMOUS RUNTIME ============

	async upsertAgentRuntimeSession(
		session: Omit<AgentRuntimeSession, "id" | "tenant_id" | "created_at" | "updated_at">
	): Promise<AgentRuntimeSession> {
		const rows = await this.readCollection<AgentRuntimeSession>(KV_KEYS.runtime_sessions);
		const now = nowIso();
		const idx = rows.findIndex(r => r.agent_tenant === session.agent_tenant);
		if (idx >= 0) {
			rows[idx] = {
				...rows[idx],
				session_id: session.session_id,
				status: session.status,
				trigger_mode: session.trigger_mode,
				source_task_id: session.source_task_id,
				metadata: session.metadata ?? {},
				last_resumed_at: session.last_resumed_at,
				updated_at: now
			};
			await this.writeCollection(KV_KEYS.runtime_sessions, rows);
			return rows[idx];
		}

		const created: AgentRuntimeSession = {
			id: generateId("runtime_session"),
			tenant_id: this.tenant,
			agent_tenant: session.agent_tenant,
			session_id: session.session_id,
			status: session.status,
			trigger_mode: session.trigger_mode,
			source_task_id: session.source_task_id,
			metadata: session.metadata ?? {},
			last_resumed_at: session.last_resumed_at,
			created_at: now,
			updated_at: now
		};
		rows.push(created);
		await this.writeCollection(KV_KEYS.runtime_sessions, rows);
		return created;
	}

	async getAgentRuntimeSession(agentTenant: string): Promise<AgentRuntimeSession | null> {
		const rows = await this.readCollection<AgentRuntimeSession>(KV_KEYS.runtime_sessions);
		return rows.find(r => r.agent_tenant === agentTenant) ?? null;
	}

	async createAgentRuntimeRun(
		run: Omit<AgentRuntimeRun, "id" | "tenant_id" | "created_at">
	): Promise<AgentRuntimeRun> {
		const created: AgentRuntimeRun = {
			id: generateId("runtime_run"),
			tenant_id: this.tenant,
			agent_tenant: run.agent_tenant,
			session_id: run.session_id,
			trigger_mode: run.trigger_mode,
			task_id: run.task_id,
			status: run.status,
			started_at: run.started_at,
			completed_at: run.completed_at,
			next_wake_at: run.next_wake_at,
			summary: run.summary,
			error: run.error,
			metadata: run.metadata ?? {},
			created_at: nowIso()
		};
		const rows = await this.readCollection<AgentRuntimeRun>(KV_KEYS.runtime_runs);
		rows.push(created);
		await this.writeCollection(KV_KEYS.runtime_runs, rows);
		return created;
	}

	async listAgentRuntimeRuns(agentTenant: string, limit = 20): Promise<AgentRuntimeRun[]> {
		const rows = await this.readCollection<AgentRuntimeRun>(KV_KEYS.runtime_runs);
		return rows
			.filter(r => r.agent_tenant === agentTenant)
			.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))
			.slice(0, Math.max(1, Math.min(limit, 100)));
	}

	async upsertAgentRuntimePolicy(
		policy: Omit<AgentRuntimePolicy, "id" | "tenant_id" | "created_at" | "updated_at">
	): Promise<AgentRuntimePolicy> {
		const rows = await this.readCollection<AgentRuntimePolicy>(KV_KEYS.runtime_policies);
		const now = nowIso();
		const idx = rows.findIndex(r => r.agent_tenant === policy.agent_tenant);
		if (idx >= 0) {
			rows[idx] = {
				...rows[idx],
				execution_mode: policy.execution_mode,
				daily_wake_budget: policy.daily_wake_budget,
				impulse_wake_budget: policy.impulse_wake_budget,
				reserve_wakes: policy.reserve_wakes,
				min_impulse_interval_minutes: policy.min_impulse_interval_minutes,
				max_tool_calls_per_run: policy.max_tool_calls_per_run,
				max_parallel_delegations: policy.max_parallel_delegations,
				require_priority_clear_for_impulse: policy.require_priority_clear_for_impulse,
				updated_by: policy.updated_by,
				metadata: policy.metadata ?? {},
				updated_at: now
			};
			await this.writeCollection(KV_KEYS.runtime_policies, rows);
			return rows[idx];
		}

		const created: AgentRuntimePolicy = {
			id: generateId("runtime_policy"),
			tenant_id: this.tenant,
			agent_tenant: policy.agent_tenant,
			execution_mode: policy.execution_mode,
			daily_wake_budget: policy.daily_wake_budget,
			impulse_wake_budget: policy.impulse_wake_budget,
			reserve_wakes: policy.reserve_wakes,
			min_impulse_interval_minutes: policy.min_impulse_interval_minutes,
			max_tool_calls_per_run: policy.max_tool_calls_per_run,
			max_parallel_delegations: policy.max_parallel_delegations,
			require_priority_clear_for_impulse: policy.require_priority_clear_for_impulse,
			updated_by: policy.updated_by,
			metadata: policy.metadata ?? {},
			created_at: now,
			updated_at: now
		};
		rows.push(created);
		await this.writeCollection(KV_KEYS.runtime_policies, rows);
		return created;
	}

	async getAgentRuntimePolicy(agentTenant: string): Promise<AgentRuntimePolicy | null> {
		const rows = await this.readCollection<AgentRuntimePolicy>(KV_KEYS.runtime_policies);
		return rows.find(r => r.agent_tenant === agentTenant) ?? null;
	}

	async getAgentRuntimeUsage(agentTenant: string, since: string): Promise<AgentRuntimeUsage> {
		const sinceMs = toMillis(since);
		const rows = (await this.readCollection<AgentRuntimeRun>(KV_KEYS.runtime_runs))
			.filter(r => r.agent_tenant === agentTenant)
			.filter(r => toMillis(r.created_at) >= sinceMs);

		const wakeKind = (run: AgentRuntimeRun): string => {
			const meta = run.metadata ?? {};
			const kind = meta.wake_kind;
			return typeof kind === "string" ? kind : "duty";
		};

		const dutyRuns = rows.filter(r => wakeKind(r) === "duty");
		const impulseRuns = rows.filter(r => wakeKind(r) === "impulse");
		const lastRun = rows.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))[0];
		const lastImpulse = impulseRuns.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at))[0];

		return {
			agent_tenant: agentTenant,
			since,
			total_runs: rows.length,
			duty_runs: dutyRuns.length,
			impulse_runs: impulseRuns.length,
			last_run_at: lastRun?.created_at,
			last_impulse_run_at: lastImpulse?.created_at
		};
	}

	// ============ RECAP STUBS (Continuity Spine Phase A) ============
	// SQLite is a local dev backend; pgvector is not available.
	// These methods stub out the interface so TypeScript is satisfied.
	// Postgres is the production target for all recap functionality.

	async createRecap(_recap: Omit<Recap, 'id' | 'created_at'>): Promise<Recap> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async getRecap(_recapId: string): Promise<Recap | null> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async getRecapsBySession(_sessionId: string, _limit?: number): Promise<Recap[]> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async getLatestRecapForSession(_sessionId: string): Promise<Recap | null> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async searchRecaps(_filter: RecapFilter): Promise<Recap[]> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async searchRecapsBySemantic(
		_queryEmbedding: number[],
		_limit?: number,
		_companion?: string,
		_layer?: string
	): Promise<Array<Recap & { similarity: number }>> {
		return [];
	}

	async linkRecapToEntity(_recapId: string, _entityId: string, _mentionType?: string): Promise<void> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async getRecapEntityLinks(_recapId: string): Promise<RecapEntityLink[]> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async getEntityRecaps(_entityId: string, _limit?: number): Promise<Recap[]> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async createRecapEdge(_edge: Omit<RecapEdge, 'created_at'>): Promise<RecapEdge> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}

	async getRecapEdges(_recapId: string, _direction?: 'outgoing' | 'incoming' | 'both'): Promise<RecapEdge[]> {
		throw new Error("Recap methods not yet implemented for SQLite backend");
	}
}

export function createSQLiteStorage(sqlitePath: string, tenant: string): SQLiteBrainStorage {
	if (!ALLOWED_TENANTS.includes(tenant as typeof ALLOWED_TENANTS[number])) {
		throw new Error(`Invalid tenant: ${tenant}`);
	}
	if (sqlitePath.includes("\0")) {
		throw new Error("Invalid sqlite path");
	}
	return new SQLiteBrainStorage(sqlitePath, tenant);
}
