// ============ POSTGRES BRAIN STORAGE ============
// Implements IBrainStorage against Neon serverless Postgres.
// Uses postgres.js via Cloudflare Hyperdrive — queries count against
// CF-service subrequest limit (1000) instead of external limit (50).
//
// Tenant isolation: every query filters on tenant_id column.
// No path traversal risk — SQL params are parameterized.
//
// Schema assumptions:
//   observations(id, tenant_id, content, territory, created_at, texture JSONB,
//                context, mood, last_accessed_at, access_count, links TEXT[],
//                summary, type, tags TEXT[], embedding vector(768))
//   links(id, tenant_id, source_id, target_id, resonance_type, strength, origin,
//          created_at, last_activated_at)
//   open_loops(id, tenant_id, content, status, territory, created_at,
//              resolved_at, resolution_note)
//   letters(id, tenant_id, from_context, to_context, content, timestamp,
//           read BOOLEAN, charges TEXT[])
//   identity_cores(id, tenant_id, data JSONB)
//   anchors(id, tenant_id, data JSONB)
//   desires(id, tenant_id, data JSONB)
//   wake_log(id, tenant_id, data JSONB, created_at)
//   relational_states(id, tenant_id, data JSONB)
//   brain_state(tenant_id, data JSONB, updated_at)    -- single row per tenant
//   subconscious(tenant_id, data JSONB, updated_at)   -- single row per tenant
//   triggers(id, tenant_id, data JSONB)
//   consent(tenant_id, data JSONB, updated_at)        -- single row per tenant
//   conversation_context(tenant_id, data JSONB, updated_at) -- single row per tenant
//   backfill_flags(version, tenant_id, data JSONB)
//   territory_overviews(tenant_id, data JSONB, updated_at)  -- single row per tenant
//   iron_grip_index(id, tenant_id, data JSONB)

import postgres from "postgres";

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
	CapturedSkillRegistryHealth
} from "../types";

import { TERRITORIES, VALID_TERRITORIES, HARD_BOUNDARIES, RELATIONSHIP_GATES, CIRCADIAN_PHASES, ALLOWED_TENANTS } from "../constants";
import { getTimestamp, calculateMomentumDecay, calculateAfterglowFade, generateId } from "../helpers";

import type {
	IBrainStorage,
	ObservationFilter,
	SimilarSearchOptions,
	SimilarResult,
	HybridSearchOptions,
	HybridSearchResult,
	TextureUpdate
} from "./interface";

// ============ ROW → TYPE MAPPERS ============
// SQL rows are snake_case with flat columns; TypeScript types are camelCase with nested objects.

function toISOString(val: unknown): string | undefined {
	if (!val) return undefined;
	if (val instanceof Date) return val.toISOString();
	return String(val);
}

function toStringList(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseJsonValue<T>(value: unknown, fallback: T): T {
	let raw = value;
	for (let i = 0; i < 2 && typeof raw === "string"; i++) {
		const trimmed = raw.trim();
		if (!trimmed) return fallback;
		try {
			raw = JSON.parse(trimmed);
		} catch {
			break;
		}
	}
	return (raw ?? fallback) as T;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
	const parsed = parseJsonValue<unknown>(value, {});
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? parsed as Record<string, unknown>
		: {};
}

function parseJsonArray<T>(value: unknown): T[] {
	const parsed = parseJsonValue<unknown>(value, []);
	return Array.isArray(parsed) ? parsed as T[] : [];
}

function rowToObservation(row: Record<string, unknown>): Observation {
	return {
		id: row.id as string,
		content: row.content as string,
		territory: row.territory as string,
		created: toISOString(row.created_at) || new Date().toISOString(),
		texture: parseJsonRecord(row.texture) as unknown as Observation["texture"],
		context: row.context as string | undefined,
		mood: row.mood as string | undefined,
		last_accessed: toISOString(row.last_accessed_at),
		access_count: (row.access_count as number) ?? 0,
		links: (row.links as string[] | null) ?? [],
		summary: row.summary as string | undefined,
		type: row.type as string | undefined,
		tags: (row.tags as string[] | null) ?? [],
		entity_id: row.entity_id as string | undefined
	};
}

function rowToLink(row: Record<string, unknown>): Link {
	return {
		id: row.id as string,
		source_id: row.source_id as string,
		target_id: row.target_id as string,
		resonance_type: row.resonance_type as string,
		strength: row.strength as string,
		origin: row.origin as string,
		created: toISOString(row.created_at) || new Date().toISOString(),
		last_activated: toISOString(row.last_activated_at) || toISOString(row.created_at) || new Date().toISOString()
	};
}

function rowToOpenLoop(row: Record<string, unknown>): OpenLoop {
	return {
		id: row.id as string,
		content: row.content as string,
		status: row.status as string,
		territory: row.territory as string,
		created: row.created_at as string,
		resolved: row.resolved_at as string | undefined,
		resolution_note: row.resolution_note as string | undefined,
		mode: (row.mode as OpenLoop['mode']) ?? undefined,
		linked_entity_ids: (row.linked_entity_ids as string[] | null) ?? undefined
	};
}

function rowToLetter(row: Record<string, unknown>): Letter {
	return {
		id: row.id as string,
		from_context: row.from_context as string,
		to_context: row.to_context as string,
		content: row.content as string,
		timestamp: row.timestamp as string,
		read: row.read as boolean,
		charges: (row.charges as string[] | null) ?? undefined,
		letter_type: (row.letter_type as Letter['letter_type']) ?? undefined
	};
}

function rowToEntity(row: Record<string, unknown>): Entity {
	return {
		id: row.id as string,
		tenant_id: row.tenant_id as string,
		name: row.name as string,
		entity_type: row.entity_type as string,
		tags: Array.isArray(row.tags) ? row.tags as string[] : [],
		salience: (row.salience as string) || 'active',
		primary_context: row.primary_context as string | undefined,
		created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at as string,
		updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at as string,
	};
}

function rowToRelation(row: Record<string, unknown>): Relation {
	return {
		id: row.id as string,
		tenant_id: row.tenant_id as string,
		from_entity_id: row.from_entity_id as string,
		to_entity_id: row.to_entity_id as string,
		relation_type: row.relation_type as string,
		strength: (row.strength as number) ?? 1.0,
		context: row.context as string | undefined,
		created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at as string,
		updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at as string,
	};
}

function rowToProjectDossier(row: Record<string, unknown>): ProjectDossier {
	return {
		id: row.id as string,
		tenant_id: row.tenant_id as string,
		project_entity_id: row.project_entity_id as string,
		lifecycle_status: (row.lifecycle_status as ProjectDossier["lifecycle_status"]) ?? "active",
		summary: row.summary as string | undefined,
		goals: toStringList(row.goals),
		constraints: toStringList(row.constraints),
		decisions: toStringList(row.decisions),
		open_questions: toStringList(row.open_questions),
		next_actions: toStringList(row.next_actions),
		metadata: (row.metadata as Record<string, unknown>) ?? {},
		last_active_at: toISOString(row.last_active_at),
		created_at: toISOString(row.created_at) || new Date().toISOString(),
		updated_at: toISOString(row.updated_at) || new Date().toISOString()
	};
}

function rowToAgentCapabilityManifest(row: Record<string, unknown>): AgentCapabilityManifest {
	const toSkillList = (value: unknown): AgentCapabilityManifest["skills"] =>
		Array.isArray(value)
			? value
				.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
				.map(item => ({
					name: typeof item.name === "string" ? item.name : "unnamed",
					description: typeof item.description === "string" ? item.description : undefined,
					tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : []
				}))
			: [];

	return {
		id: row.id as string,
		tenant_id: row.tenant_id as string,
		agent_entity_id: row.agent_entity_id as string,
		version: (row.version as string) ?? "1.0.0",
		delegation_mode: (row.delegation_mode as AgentCapabilityManifest["delegation_mode"]) ?? "explicit",
		router_agent_entity_id: row.router_agent_entity_id as string | null | undefined,
		supports_streaming: Boolean(row.supports_streaming),
		accepted_output_modes: toStringList(row.accepted_output_modes),
		protocols: toStringList(row.protocols),
		skills: toSkillList(row.skills),
		metadata: (row.metadata as Record<string, unknown>) ?? {},
		created_at: toISOString(row.created_at) || new Date().toISOString(),
		updated_at: toISOString(row.updated_at) || new Date().toISOString()
	};
}

function rowToCapturedSkillArtifact(row: Record<string, unknown>): CapturedSkillArtifact {
	return {
		id: row.id as string,
		tenant_id: row.tenant_id as string,
		skill_key: row.skill_key as string,
		version: (row.version as number) ?? 1,
		layer: (row.layer as CapturedSkillArtifact["layer"]) ?? "captured",
		status: (row.status as CapturedSkillArtifact["status"]) ?? "candidate",
		name: row.name as string,
		domain: row.domain as string | undefined,
		environment: row.environment as string | undefined,
		task_type: row.task_type as string | undefined,
		agent_tenant: row.agent_tenant as string | undefined,
		source_runtime_run_id: row.source_runtime_run_id as string | undefined,
		source_task_id: row.source_task_id as string | undefined,
		source_observation_id: row.source_observation_id as string | undefined,
		provenance: (row.provenance as Record<string, unknown>) ?? {},
		metadata: (row.metadata as Record<string, unknown>) ?? {},
		review_note: row.review_note as string | undefined,
		reviewed_by: row.reviewed_by as string | undefined,
		reviewed_at: toISOString(row.reviewed_at),
		created_at: toISOString(row.created_at) || new Date().toISOString(),
		updated_at: toISOString(row.updated_at) || new Date().toISOString()
	};
}

// ============ POSTGRES BRAIN STORAGE ============

export class PostgresBrainStorage implements IBrainStorage {
	private sql: postgres.Sql;
	private databaseUrl: string;

	constructor(
		databaseUrl: string,
		private tenant: string
	) {
		// Same tenant validation as BrainStorage — DNS label rules, 3-63 chars.
		if (!/^[a-z][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(tenant)) {
			throw new Error("Invalid tenant ID");
		}
		this.databaseUrl = databaseUrl;
		// prepare: false is REQUIRED for Hyperdrive — pooled connections don't
		// support prepared statements across connection boundaries.
		this.sql = postgres(databaseUrl, { prepare: false });
	}

	// ============ TENANT ============

	getTenant(): string {
		return this.tenant;
	}

	forTenant(tenant: string): IBrainStorage {
		if (!ALLOWED_TENANTS.includes(tenant as typeof ALLOWED_TENANTS[number])) {
			throw new Error("Invalid tenant");
		}
		return new PostgresBrainStorage(this.databaseUrl, tenant);
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
			last_updated: getTimestamp(),
			momentum: { current_charges: [], intensity: 0, last_updated: getTimestamp() },
			afterglow: { residue_charges: [] }
		};

		try {
			const rows = await this.sql`
				SELECT data FROM brain_state
				WHERE tenant_id = ${this.tenant}
				LIMIT 1
			`;

			const stored: Partial<BrainState> = rows.length ? (parseJsonRecord(rows[0].data) as Partial<BrainState>) : {};

			const state: BrainState = {
				current_mood: stored.current_mood ?? defaultState.current_mood,
				energy_level: stored.energy_level ?? defaultState.energy_level,
				last_updated: stored.last_updated ?? defaultState.last_updated,
				momentum: stored.momentum ?? defaultState.momentum,
				afterglow: stored.afterglow ?? defaultState.afterglow
			};

			if (!state.momentum.last_updated) {
				state.momentum.last_updated = getTimestamp();
			}

			// Apply decay — same as R2 implementation
			state.momentum = calculateMomentumDecay(state.momentum);
			state.afterglow = calculateAfterglowFade(state.afterglow);

			return state;
		} catch (err) {
			// Don't leak database internals — log the error class only
			console.error("readBrainState failed:", err instanceof Error ? err.message : "unknown error");
			return defaultState;
		}
	}

	async writeBrainState(state: BrainState): Promise<void> {
		state.last_updated = getTimestamp();
		try {
			await this.sql`
				INSERT INTO brain_state (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${this.sql.json(state as any)}, NOW())
				ON CONFLICT (tenant_id)
				DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
			`;
		} catch (err) {
			console.error("writeBrainState failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write brain state");
		}
	}

	// ============ TERRITORIES ============

	async readTerritory(territory: string): Promise<Observation[]> {
		this.validateTerritory(territory);
		try {
			const rows = await this.sql`
				SELECT id, content, territory, created_at, texture, context, mood,
				       last_accessed_at, access_count, links, summary, type, tags
				FROM observations
				WHERE tenant_id = ${this.tenant}
				  AND territory = ${territory}
				ORDER BY created_at ASC
			`;
			return rows.map(row => rowToObservation(row as Record<string, unknown>));
		} catch (err) {
			console.error("readTerritory failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeTerritory(territory: string, observations: Observation[]): Promise<void> {
		this.validateTerritory(territory);
		// Overwrite = delete all for territory, then insert fresh.
		// Chunked at 100 per transaction — first chunk includes the DELETE.
		const CHUNK_SIZE = 100;
		try {
			if (observations.length === 0) {
				// Simple case: just delete, no inserts needed.
				await this.sql.begin(async (sql: any) => {
					await sql`
						DELETE FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND territory = ${territory}
					`;
				});
				return;
			}

			const chunks: Observation[][] = [];
			for (let i = 0; i < observations.length; i += CHUNK_SIZE) {
				chunks.push(observations.slice(i, i + CHUNK_SIZE));
			}

			// First chunk: DELETE + first batch of INSERTs (atomic).
			await this.sql.begin(async (sql: any) => {
				await sql`
					DELETE FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND territory = ${territory}
				`;
				await this._executeInsertQueries(sql, chunks[0], territory);
			});

			// Remaining chunks: INSERT only (DELETE already committed).
			for (let i = 1; i < chunks.length; i++) {
				await this.sql.begin(async (sql: any) => {
					await this._executeInsertQueries(sql, chunks[i], territory);
				});
			}
		} catch (err) {
			console.error("writeTerritory failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write territory");
		}
	}

	/** Execute observation INSERTs within an open postgres.js transaction. */
	private async _executeInsertQueries(
		sql: any,
		observations: Observation[],
		territory: string
	): Promise<void> {
		for (const obs of observations) {
			await sql`
				INSERT INTO observations (
					id, tenant_id, content, territory, created_at, texture, context,
					mood, last_accessed_at, access_count, links, summary, type, tags
				) VALUES (
					${obs.id},
					${this.tenant},
					${obs.content},
					${territory},
					${obs.created},
					${this.sql.json((obs.texture ?? {}) as any)},
					${obs.context ?? null},
					${obs.mood ?? null},
					${obs.last_accessed ?? null},
					${obs.access_count ?? 0},
					${obs.links ?? null},
					${obs.summary ?? null},
					${obs.type ?? null},
					${obs.tags ?? null}
				)
				ON CONFLICT (id) DO UPDATE SET
					content        = EXCLUDED.content,
					territory      = EXCLUDED.territory,
					texture        = EXCLUDED.texture,
					context        = EXCLUDED.context,
					mood           = EXCLUDED.mood,
					last_accessed_at = EXCLUDED.last_accessed_at,
					access_count   = EXCLUDED.access_count,
					links          = EXCLUDED.links,
					summary        = EXCLUDED.summary,
					type           = EXCLUDED.type,
					tags           = EXCLUDED.tags
			`;
		}
	}

	async appendToTerritory(territory: string, observation: Observation): Promise<void> {
		this.validateTerritory(territory);
		try {
			await this._insertObservation(observation, territory);
		} catch (err) {
			console.error("appendToTerritory failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to append observation");
		}
	}

	private async _insertObservation(obs: Observation, territory: string): Promise<void> {
		await this.sql`
			INSERT INTO observations (
				id, tenant_id, content, territory, created_at, texture, context,
				mood, last_accessed_at, access_count, links, summary, type, tags, entity_id
			) VALUES (
				${obs.id},
				${this.tenant},
				${obs.content},
				${territory},
				${obs.created},
				${this.sql.json((obs.texture ?? {}) as any)},
				${obs.context ?? null},
				${obs.mood ?? null},
				${obs.last_accessed ?? null},
				${obs.access_count ?? 0},
				${obs.links ?? null},
				${obs.summary ?? null},
				${obs.type ?? null},
				${obs.tags ?? null},
				${obs.entity_id ?? null}
			)
			ON CONFLICT (id) DO UPDATE SET
				content        = EXCLUDED.content,
				territory      = EXCLUDED.territory,
				texture        = EXCLUDED.texture,
				context        = EXCLUDED.context,
				mood           = EXCLUDED.mood,
				last_accessed_at = EXCLUDED.last_accessed_at,
				access_count   = EXCLUDED.access_count,
				links          = EXCLUDED.links,
				summary        = EXCLUDED.summary,
				type           = EXCLUDED.type,
				tags           = EXCLUDED.tags,
				entity_id      = EXCLUDED.entity_id
		`;
	}

	async readAllTerritories(): Promise<{ territory: string; observations: Observation[] }[]> {
		// Single query across all territories instead of 16 individual SELECTs.
		const rows = await this.sql`
			SELECT id, content, territory, created_at, texture, context, mood,
			       last_accessed_at, access_count, links, summary, type, tags
			FROM observations
			WHERE tenant_id = ${this.tenant}
			ORDER BY territory, created_at ASC
		`;

		// Group rows by territory in JS.
		const grouped = new Map<string, Observation[]>();
		for (const row of rows) {
			const t = row.territory as string;
			if (!grouped.has(t)) grouped.set(t, []);
			grouped.get(t)!.push(rowToObservation(row as Record<string, unknown>));
		}

		// Return all known territories, including those with 0 observations.
		return Object.keys(TERRITORIES).map(territory => ({
			territory,
			observations: grouped.get(territory) ?? []
		}));
	}

	async findObservation(id: string): Promise<{ observation: Observation; territory: string } | null> {
		try {
			const rows = await this.sql`
				SELECT id, content, territory, created_at, texture, context, mood,
				       last_accessed_at, access_count, links, summary, type, tags
				FROM observations
				WHERE tenant_id = ${this.tenant}
				  AND id = ${id}
				LIMIT 1
			`;
			if (!rows.length) return null;
			const obs = rowToObservation(rows[0] as Record<string, unknown>);
			return { observation: obs, territory: rows[0].territory as string };
		} catch (err) {
			console.error("findObservation failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	// ============ OBSERVATION QUERIES (POSTGRES-NATIVE) ============

	async queryObservations(filter: ObservationFilter): Promise<{ observation: Observation; territory: string }[]> {
		const limit = Math.max(1, filter.limit ?? 100);
		const offset = filter.offset ?? 0;
		const orderBy = filter.order_by ?? "created";
		const orderDir = filter.order_dir ?? "desc";

		try {
			// Build query with conditional clauses.
			// postgres.js tagged templates have no identifier escaping helper.
			// Territory and grip are pushed to SQL (indexed columns). ORDER BY and
			// all other filters are applied in JS post-fetch. This avoids dynamic SQL
			// concatenation risks and keeps the queries safe.
			//
			// Fetch a generous cap (limit + offset + post-filter headroom) since
			// JS filtering happens after the DB round trip.
			const fetchLimit = (limit + offset) * 4; // headroom for post-fetch filter loss

			let rows: Record<string, unknown>[];

			// ORDER BY created_at DESC ensures the most recent observations are
			// always in the fetched batch. JS re-sorts for other orderings.
			if (filter.territory && filter.grip) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND territory = ${filter.territory}
					  AND (texture->>'grip') = ${filter.grip}
					ORDER BY created_at DESC
					LIMIT ${fetchLimit}
				` as Record<string, unknown>[];
			} else if (filter.territory) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND territory = ${filter.territory}
					ORDER BY created_at DESC
					LIMIT ${fetchLimit}
				` as Record<string, unknown>[];
			} else if (filter.grip) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND (texture->>'grip') = ${filter.grip}
					ORDER BY created_at DESC
					LIMIT ${fetchLimit}
				` as Record<string, unknown>[];
			} else {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
					ORDER BY created_at DESC
					LIMIT ${fetchLimit}
				` as Record<string, unknown>[];
			}

			// Post-fetch: map rows, filter, sort, paginate.
			let filtered = rows.map(row => ({
				observation: rowToObservation(row),
				territory: row.territory as string
			}));

			if (filter.charges_all?.length) {
				filtered = filtered.filter(({ observation: obs }) =>
					(filter.charges_all as string[]).every(c => obs.texture?.charge?.includes(c))
				);
			}
			if (filter.charges_any?.length) {
				filtered = filtered.filter(({ observation: obs }) =>
					(filter.charges_any as string[]).some(c => obs.texture?.charge?.includes(c))
				);
			}
			if (filter.created_after) {
				const after = new Date(filter.created_after).getTime();
				filtered = filtered.filter(({ observation: obs }) => new Date(obs.created).getTime() >= after);
			}
			if (filter.created_before) {
				const before = new Date(filter.created_before).getTime();
				filtered = filtered.filter(({ observation: obs }) => new Date(obs.created).getTime() <= before);
			}
			if (filter.type) {
				filtered = filtered.filter(({ observation: obs }) => obs.type === filter.type);
			}
			if (filter.tags?.length) {
				filtered = filtered.filter(({ observation: obs }) =>
					(filter.tags as string[]).some(t => obs.tags?.includes(t))
				);
			}

			// JS-side sort (postgres.js tagged templates have no identifier escaping for ORDER BY).
			// orderBy and orderDir are validated against the ObservationFilter type — safe.
			filtered.sort((a, b) => {
				let aVal: number | string;
				let bVal: number | string;
				if (orderBy === "access_count") {
					aVal = a.observation.access_count ?? 0;
					bVal = b.observation.access_count ?? 0;
				} else if (orderBy === "last_accessed") {
					aVal = a.observation.last_accessed ?? a.observation.created;
					bVal = b.observation.last_accessed ?? b.observation.created;
				} else {
					aVal = a.observation.created;
					bVal = b.observation.created;
				}
				if (aVal < bVal) return orderDir === "asc" ? -1 : 1;
				if (aVal > bVal) return orderDir === "asc" ? 1 : -1;
				return 0;
			});

			// Apply offset/limit after JS filtering and sorting
			return filtered.slice(offset, offset + limit);
		} catch (err) {
			console.error("queryObservations failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async bulkUpdateTexture(updates: TextureUpdate[]): Promise<void> {
		if (!updates.length) return;
		try {
			// Execute updates in parallel — each is a single parameterized query.
			await Promise.all(updates.map(async update => {
				if (update.touch) {
					await this.sql`
						UPDATE observations
						SET texture = texture || ${this.sql.json((update.texture ?? {}) as any)},
						    last_accessed_at = NOW(),
						    access_count = access_count + 1
						WHERE tenant_id = ${this.tenant}
						  AND id = ${update.id}
					`;
				} else {
					await this.sql`
						UPDATE observations
						SET texture = texture || ${this.sql.json((update.texture ?? {}) as any)}
						WHERE tenant_id = ${this.tenant}
						  AND id = ${update.id}
					`;
				}
			}));
		} catch (err) {
			console.error("bulkUpdateTexture failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to bulk update texture");
		}
	}

	async bulkReplaceTexture(updates: { id: string; texture: Observation["texture"] }[]): Promise<void> {
		if (!updates.length) return;
		const ids = updates.map(u => u.id);
		const textures = updates.map(u => JSON.stringify(u.texture));
		try {
			// Single unnest UPDATE — one subrequest for all observations instead of N.
			await this.sql`
				UPDATE observations
				SET texture = updates.new_texture
				FROM (
					SELECT unnest(${ids}::text[]) AS id, unnest(${textures}::jsonb[]) AS new_texture
				) AS updates
				WHERE observations.id = updates.id
				  AND observations.tenant_id = ${this.tenant}
			`;
		} catch (err) {
			console.error("bulkReplaceTexture failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to bulk replace texture");
		}
	}

	async updateObservationTexture(id: string, texture: Observation["texture"]): Promise<void> {
		try {
			await this.sql`
				UPDATE observations
				SET texture = ${this.sql.json((texture ?? {}) as any)}
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
			`;
		} catch (err) {
			console.error("updateObservationTexture failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update observation texture");
		}
	}

	async updateObservationAccess(id: string): Promise<void> {
		try {
			await this.sql`
				UPDATE observations
				SET access_count = access_count + 1,
				    last_accessed_at = NOW()
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
			`;
		} catch (err) {
			console.error("updateObservationAccess failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update observation access");
		}
	}

	async deleteObservation(id: string): Promise<boolean> {
		try {
			const rows = await this.sql`
				DELETE FROM observations
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
				RETURNING id
			`;
			return rows.length > 0;
		} catch (err) {
			console.error("deleteObservation failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to delete observation");
		}
	}

	async queryUnembedded(limit: number): Promise<{id: string; content: string}[]> {
		try {
			const rows = await this.sql`
				SELECT id, content FROM observations
				WHERE tenant_id = ${this.tenant} AND embedding IS NULL
				ORDER BY created_at ASC
				LIMIT ${limit}
			`;
			return rows.map(r => ({ id: r.id as string, content: r.content as string }));
		} catch (err) {
			console.error('queryUnembedded failed:', err instanceof Error ? err.message : 'unknown error');
			return [];
		}
	}

	async countUnembedded(): Promise<number> {
		try {
			const rows = await this.sql`
				SELECT COUNT(*)::int as count FROM observations
				WHERE tenant_id = ${this.tenant} AND embedding IS NULL
			`;
			return (rows[0]?.count as number) ?? 0;
		} catch (err) {
			console.error('countUnembedded failed:', err instanceof Error ? err.message : 'unknown error');
			return 0;
		}
	}

	async bulkUpdateEmbeddings(updates: Array<{id: string; embedding: number[]}>): Promise<void> {
		if (updates.length === 0) return;
		for (const u of updates) {
			if (!Array.isArray(u.embedding) || u.embedding.length !== 768 || !u.embedding.every(n => typeof n === 'number' && Number.isFinite(n))) {
				throw new Error(`Invalid embedding for ${u.id}`);
			}
		}
		// Single unnest UPDATE — 1 subrequest instead of N.
		const ids = updates.map(u => u.id);
		const vectors = updates.map(u => '[' + u.embedding.join(',') + ']');
		try {
			await this.sql`
				UPDATE observations
				SET embedding = updates.vec::vector
				FROM (
					SELECT unnest(${ids}::text[]) AS id,
					       unnest(${vectors}::text[]) AS vec
				) AS updates
				WHERE observations.id = updates.id
				  AND observations.tenant_id = ${this.tenant}
			`;
		} catch (err) {
			console.error("bulkUpdateEmbeddings failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to bulk update embeddings");
		}
	}

	// ============ VECTOR SEARCH ============

	async searchSimilar(options: SimilarSearchOptions): Promise<SimilarResult[]> {
		if (!Array.isArray(options.embedding) || options.embedding.length !== 768 || !options.embedding.every(n => typeof n === 'number' && Number.isFinite(n))) {
			throw new Error('Invalid embedding vector: must be 768 finite numbers');
		}
		const limit = options.limit ?? 10;
		const minSimilarity = options.min_similarity ?? 0;
		// Format the embedding as a Postgres vector literal: '[0.1,0.2,...]'
		const embeddingLiteral = `[${options.embedding.join(",")}]`;

		try {
			let rows: Record<string, unknown>[];

			if (options.territory && options.grip?.length) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags,
					       1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND embedding IS NOT NULL
					  AND territory = ${options.territory}
					  AND (texture->>'grip') = ANY(${options.grip})
					  AND 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${minSimilarity}
					ORDER BY embedding <=> ${embeddingLiteral}::vector
					LIMIT ${limit}
				` as Record<string, unknown>[];
			} else if (options.territory) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags,
					       1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND embedding IS NOT NULL
					  AND territory = ${options.territory}
					  AND 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${minSimilarity}
					ORDER BY embedding <=> ${embeddingLiteral}::vector
					LIMIT ${limit}
				` as Record<string, unknown>[];
			} else {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags,
					       1 - (embedding <=> ${embeddingLiteral}::vector) AS similarity
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND embedding IS NOT NULL
					  AND 1 - (embedding <=> ${embeddingLiteral}::vector) >= ${minSimilarity}
					ORDER BY embedding <=> ${embeddingLiteral}::vector
					LIMIT ${limit}
				` as Record<string, unknown>[];
			}

			return rows.map(row => ({
				observation: rowToObservation(row),
				territory: row.territory as string,
				similarity: row.similarity as number
			}));
		} catch (err) {
			console.error("searchSimilar failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async findUnlinkedSimilar(id: string, limit: number = 10): Promise<SimilarResult[]> {
		try {
			// Find the source observation's embedding first.
			// Then CROSS JOIN LATERAL to get top-N similar observations that are not
			// already linked to it in either direction.
			const rows = await this.sql`
				WITH source AS (
					SELECT embedding
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND id = ${id}
					  AND embedding IS NOT NULL
				),
				already_linked AS (
					SELECT target_id AS linked_id FROM links
					WHERE tenant_id = ${this.tenant} AND source_id = ${id}
					UNION
					SELECT source_id AS linked_id FROM links
					WHERE tenant_id = ${this.tenant} AND target_id = ${id}
				)
				SELECT o2.id, o2.content, o2.territory, o2.created_at, o2.texture,
				       o2.context, o2.mood, o2.last_accessed_at, o2.access_count,
				       o2.links, o2.summary, o2.type, o2.tags,
				       1 - (source.embedding <=> o2.embedding) AS similarity
				FROM source
				CROSS JOIN LATERAL (
					SELECT *
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND id != ${id}
					  AND embedding IS NOT NULL
					  AND id NOT IN (SELECT linked_id FROM already_linked)
					ORDER BY source.embedding <=> embedding
					LIMIT ${limit}
				) AS o2
				ORDER BY similarity DESC
			` as Record<string, unknown>[];

			return rows.map(row => ({
				observation: rowToObservation(row),
				territory: row.territory as string,
				similarity: row.similarity as number
			}));
		} catch (err) {
			console.error("findUnlinkedSimilar failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async updateObservationEmbedding(id: string, embedding: number[]): Promise<void> {
		if (!Array.isArray(embedding) || embedding.length !== 768 || !embedding.every(n => typeof n === 'number' && Number.isFinite(n))) {
			throw new Error('Invalid embedding vector: must be 768 finite numbers');
		}
		const embeddingLiteral = `[${embedding.join(",")}]`;
		try {
			await this.sql`
				UPDATE observations
				SET embedding = ${embeddingLiteral}::vector
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
			`;
		} catch (err) {
			console.error("updateObservationEmbedding failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update observation embedding");
		}
	}

	// ============ OPEN LOOPS ============

	async readOpenLoops(): Promise<OpenLoop[]> {
		try {
			const rows = await this.sql`
				SELECT id, content, status, territory, created_at, resolved_at, resolution_note, mode, linked_entity_ids
				FROM open_loops
				WHERE tenant_id = ${this.tenant}
				ORDER BY created_at ASC
			`;
			return rows.map(row => rowToOpenLoop(row as Record<string, unknown>));
		} catch (err) {
			console.error("readOpenLoops failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeOpenLoops(loops: OpenLoop[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM open_loops WHERE tenant_id = ${this.tenant}`;
				for (const loop of loops) {
					await sql`
						INSERT INTO open_loops (id, tenant_id, content, status, territory, created_at, resolved_at, resolution_note, mode, linked_entity_ids)
						VALUES (
							${loop.id}, ${this.tenant}, ${loop.content}, ${loop.status},
							${loop.territory}, ${loop.created},
							${loop.resolved ?? null}, ${loop.resolution_note ?? null},
							${loop.mode ?? 'standard'}, ${loop.linked_entity_ids ?? []}
						)
						ON CONFLICT (id) DO UPDATE SET
							content = EXCLUDED.content, status = EXCLUDED.status,
							territory = EXCLUDED.territory, resolved_at = EXCLUDED.resolved_at,
							resolution_note = EXCLUDED.resolution_note,
							mode = EXCLUDED.mode, linked_entity_ids = EXCLUDED.linked_entity_ids
					`;
				}
			});
		} catch (err) {
			console.error("writeOpenLoops failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write open loops");
		}
	}

	async appendOpenLoop(loop: OpenLoop): Promise<void> {
		try {
			await this.sql`
				INSERT INTO open_loops (id, tenant_id, content, status, territory, created_at, resolved_at, resolution_note, mode, linked_entity_ids)
				VALUES (
					${loop.id}, ${this.tenant}, ${loop.content}, ${loop.status},
					${loop.territory}, ${loop.created},
					${loop.resolved ?? null}, ${loop.resolution_note ?? null},
					${loop.mode ?? 'standard'}, ${loop.linked_entity_ids ?? []}
				)
			`;
		} catch (err) {
			console.error("appendOpenLoop failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to append open loop");
		}
	}

	// ============ LINKS ============

	async readLinks(): Promise<Link[]> {
		try {
			const rows = await this.sql`
				SELECT id, source_id, target_id, resonance_type, strength, origin,
				       created_at, last_activated_at
				FROM links
				WHERE tenant_id = ${this.tenant}
				ORDER BY created_at ASC
			`;
			return rows.map(row => rowToLink(row as Record<string, unknown>));
		} catch (err) {
			console.error("readLinks failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeLinks(links: Link[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM links WHERE tenant_id = ${this.tenant}`;
				for (const link of links) {
					await sql`
						INSERT INTO links (id, tenant_id, source_id, target_id, resonance_type, strength, origin, created_at, last_activated_at)
						VALUES (
							${link.id}, ${this.tenant}, ${link.source_id}, ${link.target_id},
							${link.resonance_type}, ${link.strength}, ${link.origin},
							${link.created}, ${link.last_activated}
						)
						ON CONFLICT (id) DO UPDATE SET
							resonance_type = EXCLUDED.resonance_type,
							strength = EXCLUDED.strength,
							last_activated_at = EXCLUDED.last_activated_at
					`;
				}
			});
		} catch (err) {
			console.error("writeLinks failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write links");
		}
	}

	async appendLink(link: Link): Promise<void> {
		try {
			await this._insertLink(link);
		} catch (err) {
			console.error("appendLink failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to append link");
		}
	}

	private async _insertLink(link: Link): Promise<void> {
		await this.sql`
			INSERT INTO links (id, tenant_id, source_id, target_id, resonance_type, strength, origin, created_at, last_activated_at)
			VALUES (
				${link.id}, ${this.tenant}, ${link.source_id}, ${link.target_id},
				${link.resonance_type}, ${link.strength}, ${link.origin},
				${link.created}, ${link.last_activated}
			)
			ON CONFLICT (id) DO UPDATE SET
				resonance_type = EXCLUDED.resonance_type,
				strength = EXCLUDED.strength,
				last_activated_at = EXCLUDED.last_activated_at
		`;
	}

	// ============ LETTERS ============

	async readLetters(): Promise<Letter[]> {
		try {
			const rows = await this.sql`
				SELECT id, from_context, to_context, content, timestamp, read, charges, letter_type
				FROM letters
				WHERE tenant_id = ${this.tenant}
				ORDER BY timestamp ASC
			`;
			return rows.map(row => rowToLetter(row as Record<string, unknown>));
		} catch (err) {
			console.error("readLetters failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeLetters(letters: Letter[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM letters WHERE tenant_id = ${this.tenant}`;
				for (const letter of letters) {
					await sql`
						INSERT INTO letters (id, tenant_id, from_context, to_context, content, timestamp, read, charges, letter_type)
						VALUES (
							${letter.id}, ${this.tenant}, ${letter.from_context}, ${letter.to_context},
							${letter.content}, ${letter.timestamp}, ${letter.read},
							${letter.charges ?? null}, ${letter.letter_type ?? null}
						)
						ON CONFLICT (id) DO UPDATE SET
							read = EXCLUDED.read,
							charges = EXCLUDED.charges,
							letter_type = EXCLUDED.letter_type
					`;
				}
			});
		} catch (err) {
			console.error("writeLetters failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write letters");
		}
	}

	async appendLetter(letter: Letter): Promise<void> {
		try {
			await this._insertLetter(letter);
		} catch (err) {
			console.error("appendLetter failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to append letter");
		}
	}

	private async _insertLetter(letter: Letter): Promise<void> {
		await this.sql`
			INSERT INTO letters (id, tenant_id, from_context, to_context, content, timestamp, read, charges, letter_type)
			VALUES (
				${letter.id}, ${this.tenant}, ${letter.from_context}, ${letter.to_context},
				${letter.content}, ${letter.timestamp}, ${letter.read},
				${letter.charges ?? null}, ${letter.letter_type ?? null}
			)
			ON CONFLICT (id) DO UPDATE SET
				read = EXCLUDED.read,
				charges = EXCLUDED.charges,
				letter_type = EXCLUDED.letter_type
		`;
	}

	// ============ IDENTITY CORES ============
	// Stored as JSONB blobs — complex nested type with evolution_history arrays.

	async readIdentityCores(): Promise<IdentityCore[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM identity_cores
				WHERE tenant_id = ${this.tenant}
				ORDER BY (data->>'created') ASC
			`;
			return rows
				.map(row => parseJsonRecord(row.data) as unknown as IdentityCore)
				.filter(core => typeof core.id === "string");
		} catch (err) {
			console.error("readIdentityCores failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeIdentityCores(cores: IdentityCore[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM identity_cores WHERE tenant_id = ${this.tenant}`;
				for (const core of cores) {
					await sql`
						INSERT INTO identity_cores (id, tenant_id, data)
						VALUES (${core.id}, ${this.tenant}, ${this.sql.json(core as any)})
						ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
					`;
				}
			});
		} catch (err) {
			console.error("writeIdentityCores failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write identity cores");
		}
	}

	// ============ ANCHORS ============

	async readAnchors(): Promise<Anchor[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM anchors
				WHERE tenant_id = ${this.tenant}
				ORDER BY (data->>'created') ASC
			`;
			return rows
				.map(row => parseJsonRecord(row.data) as unknown as Anchor)
				.filter(anchor => typeof anchor.id === "string");
		} catch (err) {
			console.error("readAnchors failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeAnchors(anchors: Anchor[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM anchors WHERE tenant_id = ${this.tenant}`;
				for (const anchor of anchors) {
					await sql`
						INSERT INTO anchors (id, tenant_id, data)
						VALUES (${anchor.id}, ${this.tenant}, ${this.sql.json(anchor as any)})
						ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
					`;
				}
			});
		} catch (err) {
			console.error("writeAnchors failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write anchors");
		}
	}

	// ============ DESIRES ============

	async readDesires(): Promise<Desire[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM desires
				WHERE tenant_id = ${this.tenant}
				ORDER BY (data->>'created') ASC
			`;
			return rows
				.map(row => parseJsonRecord(row.data) as unknown as Desire)
				.filter(desire => typeof desire.id === "string");
		} catch (err) {
			console.error("readDesires failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeDesires(desires: Desire[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM desires WHERE tenant_id = ${this.tenant}`;
				for (const desire of desires) {
					await sql`
						INSERT INTO desires (id, tenant_id, data)
						VALUES (${desire.id}, ${this.tenant}, ${this.sql.json(desire as any)})
						ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
					`;
				}
			});
		} catch (err) {
			console.error("writeDesires failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write desires");
		}
	}

	// ============ WAKE LOG ============

	async appendWakeLog(entry: WakeLogEntry): Promise<void> {
		try {
			await this.sql`
				INSERT INTO wake_log (id, tenant_id, data, created_at)
				VALUES (${entry.id}, ${this.tenant}, ${this.sql.json(entry as any)}, ${entry.timestamp ?? getTimestamp()})
			`;
		} catch (err) {
			console.error("appendWakeLog failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to append wake log");
		}
	}

	async readWakeLog(): Promise<WakeLogEntry[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM wake_log
				WHERE tenant_id = ${this.tenant}
				ORDER BY created_at ASC
			`;
			return rows
				.map(row => parseJsonRecord(row.data) as WakeLogEntry)
				.filter(entry => typeof entry.id === "string");
		} catch (err) {
			console.error("readWakeLog failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async readLatestWakeLog(): Promise<WakeLogEntry | null> {
		try {
			const rows = await this.sql`
				SELECT data FROM wake_log
				WHERE tenant_id = ${this.tenant}
				ORDER BY created_at DESC
				LIMIT 1
			`;
			if (!rows.length) return null;
			const entry = parseJsonRecord(rows[0].data) as WakeLogEntry;
			return typeof entry.id === "string" ? entry : null;
		} catch (err) {
			console.error("readLatestWakeLog failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	// ============ CONVERSATION CONTEXT ============

	async readConversationContext(): Promise<unknown> {
		try {
			const rows = await this.sql`
				SELECT data FROM conversation_context
				WHERE tenant_id = ${this.tenant}
				LIMIT 1
			`;
			return rows.length ? parseJsonValue(rows[0].data, null) : null;
		} catch (err) {
			console.error("readConversationContext failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async writeConversationContext(context: unknown): Promise<void> {
		try {
			await this.sql`
				INSERT INTO conversation_context (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${this.sql.json(context as any)}, NOW())
				ON CONFLICT (tenant_id)
				DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
			`;
		} catch (err) {
			console.error("writeConversationContext failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write conversation context");
		}
	}

	// ============ RELATIONAL STATE ============

	async readRelationalState(): Promise<RelationalState[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM relational_states
				WHERE tenant_id = ${this.tenant}
				ORDER BY (data->>'created') ASC
			`;
			return rows
				.map(row => parseJsonRecord(row.data) as unknown as RelationalState)
				.filter(state => typeof state.id === "string");
		} catch (err) {
			console.error("readRelationalState failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeRelationalState(states: RelationalState[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM relational_states WHERE tenant_id = ${this.tenant}`;
				for (const state of states) {
					await sql`
						INSERT INTO relational_states (id, tenant_id, data)
						VALUES (${state.id}, ${this.tenant}, ${this.sql.json(state as any)})
						ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
					`;
				}
			});
		} catch (err) {
			console.error("writeRelationalState failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write relational state");
		}
	}

	// ============ SUBCONSCIOUS ============

	async readSubconscious(): Promise<SubconsciousState | null> {
		try {
			const rows = await this.sql`
				SELECT data FROM subconscious
				WHERE tenant_id = ${this.tenant}
				LIMIT 1
			`;
			return rows.length ? (parseJsonRecord(rows[0].data) as unknown as SubconsciousState) : null;
		} catch (err) {
			console.error("readSubconscious failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async writeSubconscious(state: SubconsciousState): Promise<void> {
		try {
			await this.sql`
				INSERT INTO subconscious (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${this.sql.json(state as any)}, NOW())
				ON CONFLICT (tenant_id)
				DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
			`;
		} catch (err) {
			console.error("writeSubconscious failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write subconscious");
		}
	}

	// ============ TRIGGERS ============

	async readTriggers(): Promise<TriggerCondition[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM triggers
				WHERE tenant_id = ${this.tenant}
				ORDER BY (data->>'created') ASC
			`;
			return rows
				.map(row => parseJsonRecord(row.data) as unknown as TriggerCondition)
				.filter(trigger => typeof trigger.id === "string");
		} catch (err) {
			console.error("readTriggers failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeTriggers(triggers: TriggerCondition[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM triggers WHERE tenant_id = ${this.tenant}`;
				for (const trigger of triggers) {
					await sql`
						INSERT INTO triggers (id, tenant_id, data)
						VALUES (${trigger.id}, ${this.tenant}, ${this.sql.json(trigger as any)})
						ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
					`;
				}
			});
		} catch (err) {
			console.error("writeTriggers failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write triggers");
		}
	}

	// ============ CONSENT ============

	async readConsent(): Promise<ConsentState> {
		const defaultConsent: ConsentState = {
			user_consent: [],
			ai_boundaries: {
				hard: [...HARD_BOUNDARIES],
				relationship_gated: { ...RELATIONSHIP_GATES }
			},
			relationship_level: "stranger",
			log: []
		};

		try {
			const rows = await this.sql`
				SELECT data FROM consent
				WHERE tenant_id = ${this.tenant}
				LIMIT 1
			`;
			if (!rows.length) return defaultConsent;
			const raw = parseJsonRecord(rows[0].data) as any;
			return {
				user_consent: Array.isArray(raw.user_consent) ? raw.user_consent : [],
				ai_boundaries: raw.ai_boundaries ?? defaultConsent.ai_boundaries,
				relationship_level: raw.relationship_level ?? "stranger",
				log: Array.isArray(raw.log) ? raw.log : []
			};
		} catch (err) {
			console.error("readConsent failed:", err instanceof Error ? err.message : "unknown error");
			return defaultConsent;
		}
	}

	async writeConsent(consent: ConsentState): Promise<void> {
		try {
			await this.sql`
				INSERT INTO consent (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${this.sql.json(consent as any)}, NOW())
				ON CONFLICT (tenant_id)
				DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
			`;
		} catch (err) {
			console.error("writeConsent failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write consent");
		}
	}

	// ============ BACKFILL TRACKING ============

	private validateBackfillVersion(version: string): void {
		if (!/^[a-z0-9]+$/.test(version)) throw new Error("Invalid backfill version");
	}

	async readBackfillFlag(version: string): Promise<unknown> {
		this.validateBackfillVersion(version);
		try {
			const rows = await this.sql`
				SELECT data FROM backfill_flags
				WHERE tenant_id = ${this.tenant}
				  AND version = ${version}
				LIMIT 1
			`;
			return rows.length ? parseJsonValue(rows[0].data, null) : null;
		} catch (err) {
			console.error("readBackfillFlag failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async writeBackfillFlag(version: string, data: unknown): Promise<void> {
		this.validateBackfillVersion(version);
		try {
			await this.sql`
				INSERT INTO backfill_flags (version, tenant_id, data)
				VALUES (${version}, ${this.tenant}, ${this.sql.json(data as any)})
				ON CONFLICT (version, tenant_id)
				DO UPDATE SET data = EXCLUDED.data
			`;
		} catch (err) {
			console.error("writeBackfillFlag failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write backfill flag");
		}
	}

	// ============ TERRITORY OVERVIEWS (Phase B) ============

	async readOverviews(): Promise<TerritoryOverview[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM territory_overviews
				WHERE tenant_id = ${this.tenant}
				LIMIT 1
			`;
			if (!rows.length) return [];
			return parseJsonArray<TerritoryOverview>(rows[0].data);
		} catch (err) {
			console.error("readOverviews failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeOverviews(overviews: TerritoryOverview[]): Promise<void> {
		try {
			await this.sql`
				INSERT INTO territory_overviews (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${this.sql.json(overviews as any)}, NOW())
				ON CONFLICT (tenant_id)
				DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at
			`;
		} catch (err) {
			console.error("writeOverviews failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write overviews");
		}
	}

	// ============ IRON GRIP INDEX (Phase B) ============

	async readIronGripIndex(): Promise<IronGripEntry[]> {
		try {
			const rows = await this.sql`
				SELECT data FROM iron_grip_index
				WHERE tenant_id = ${this.tenant}
				ORDER BY (data->>'updated') DESC
			`;
			return rows
				.map(row => parseJsonRecord(row.data) as unknown as IronGripEntry)
				.filter(entry => typeof entry.id === "string");
		} catch (err) {
			console.error("readIronGripIndex failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeIronGripIndex(entries: IronGripEntry[]): Promise<void> {
		try {
			await this.sql.begin(async (sql: any) => {
				await sql`DELETE FROM iron_grip_index WHERE tenant_id = ${this.tenant}`;
				for (const entry of entries) {
					await sql`
						INSERT INTO iron_grip_index (id, tenant_id, data)
						VALUES (${entry.id}, ${this.tenant}, ${this.sql.json(entry as any)})
						ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
					`;
				}
			});
		} catch (err) {
			console.error("writeIronGripIndex failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write iron grip index");
		}
	}

	async appendIronGripEntry(entry: IronGripEntry): Promise<void> {
		try {
			await this.sql`
				INSERT INTO iron_grip_index (id, tenant_id, data)
				VALUES (${entry.id}, ${this.tenant}, ${this.sql.json(entry as any)})
				ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
			`;
		} catch (err) {
			console.error("appendIronGripEntry failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to append iron grip entry");
		}
	}

	// ============ ENTITIES (Sprint 3) ============

	async createEntity(entity: Omit<Entity, 'id' | 'created_at' | 'updated_at'>): Promise<Entity> {
		const id = generateId("ent");
		try {
			const rows = await this.sql`
				INSERT INTO entities (id, tenant_id, name, entity_type, tags, salience, primary_context, created_at, updated_at)
				VALUES (
					${id},
					${this.tenant},
					${entity.name},
					${entity.entity_type},
					${entity.tags ?? []},
					${entity.salience ?? 'active'},
					${entity.primary_context ?? null},
					NOW(),
					NOW()
				)
				RETURNING *
			`;
			return rowToEntity(rows[0] as Record<string, unknown>);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown error";
			if (msg.includes("unique") || msg.includes("duplicate")) {
				throw new Error(`Entity with name "${entity.name}" already exists for this tenant`);
			}
			console.error("createEntity failed:", msg);
			throw new Error("Failed to create entity");
		}
	}

	async findEntityByName(name: string): Promise<Entity | null> {
		try {
			const rows = await this.sql`
				SELECT * FROM entities
				WHERE tenant_id = ${this.tenant}
				  AND LOWER(name) = LOWER(${name})
				LIMIT 1
			`;
			if (!rows.length) return null;
			return rowToEntity(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("findEntityByName failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async findEntityById(id: string): Promise<Entity | null> {
		try {
			const rows = await this.sql`
				SELECT * FROM entities
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
				LIMIT 1
			`;
			if (!rows.length) return null;
			return rowToEntity(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("findEntityById failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async listEntities(filter?: EntityFilter): Promise<Entity[]> {
		const limit = Math.min(filter?.limit ?? 50, 200);
		const entityType = filter?.entity_type ?? null;
		const salience = filter?.salience ?? null;
		const tags = filter?.tags?.length ? filter.tags : null;

		try {
			const rows = await this.sql`
				SELECT * FROM entities
				WHERE tenant_id = ${this.tenant}
				  AND (${entityType}::text IS NULL OR entity_type = ${entityType})
				  AND (${salience}::text IS NULL OR salience = ${salience})
				  AND (${tags}::text[] IS NULL OR tags && ${tags})
				ORDER BY name ASC
				LIMIT ${limit}
			`;
			return rows.map(r => rowToEntity(r as Record<string, unknown>));
		} catch (err) {
			console.error("listEntities failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async updateEntity(id: string, updates: Partial<Pick<Entity, 'name' | 'entity_type' | 'tags' | 'salience' | 'primary_context'>>): Promise<Entity> {
		const current = await this.findEntityById(id);
		if (!current) throw new Error("Entity not found");

		const name = updates.name ?? current.name;
		const entity_type = updates.entity_type ?? current.entity_type;
		const tags = updates.tags ?? current.tags;
		const salience = updates.salience ?? current.salience;
		const primary_context = updates.primary_context !== undefined ? updates.primary_context : current.primary_context;

		try {
			const rows = await this.sql`
				UPDATE entities SET
					name = ${name},
					entity_type = ${entity_type},
					tags = ${tags},
					salience = ${salience},
					primary_context = ${primary_context ?? null},
					updated_at = NOW()
				WHERE id = ${id} AND tenant_id = ${this.tenant}
				RETURNING *
			`;
			if (rows.length === 0) throw new Error("Entity not found after update");
			return rowToEntity(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("updateEntity failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update entity");
		}
	}

	private async assertProjectEntity(projectEntityId: string): Promise<Entity> {
		const entity = await this.findEntityById(projectEntityId);
		if (!entity) throw new Error("Project entity not found");
		if (entity.entity_type !== "project") throw new Error("Entity is not a project");
		if (entity.tenant_id !== this.tenant) throw new Error("Project entity belongs to a different tenant");
		return entity;
	}

	private async assertAgentEntity(agentEntityId: string): Promise<Entity> {
		const entity = await this.findEntityById(agentEntityId);
		if (!entity) throw new Error("Agent entity not found");
		if (entity.entity_type !== "agent") throw new Error("Entity is not an agent");
		if (entity.tenant_id !== this.tenant) throw new Error("Agent entity belongs to a different tenant");
		return entity;
	}

	// ============ PROJECT DOSSIERS (Phase 1) ============

	async createProjectDossier(dossier: Omit<ProjectDossier, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<ProjectDossier> {
		await this.assertProjectEntity(dossier.project_entity_id);
		const id = generateId("dossier");

		try {
			const rows = await this.sql`
				INSERT INTO project_dossiers (
					id, tenant_id, project_entity_id, lifecycle_status, summary,
					goals, constraints, decisions, open_questions, next_actions,
					metadata, last_active_at, created_at, updated_at
				)
				VALUES (
					${id},
					${this.tenant},
					${dossier.project_entity_id},
					${dossier.lifecycle_status ?? 'active'},
					${dossier.summary ?? null},
					${this.sql.json(dossier.goals ?? [])},
					${this.sql.json(dossier.constraints ?? [])},
					${this.sql.json(dossier.decisions ?? [])},
					${this.sql.json(dossier.open_questions ?? [])},
					${this.sql.json(dossier.next_actions ?? [])},
					${this.sql.json((dossier.metadata ?? {}) as any)},
					${dossier.last_active_at ?? null},
					NOW(),
					NOW()
				)
				RETURNING *
			`;
			return rowToProjectDossier(rows[0] as Record<string, unknown>);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown error";
			if (msg.includes("unique") || msg.includes("duplicate")) {
				throw new Error("Project dossier already exists for this project");
			}
			console.error("createProjectDossier failed:", msg);
			throw new Error("Failed to create project dossier");
		}
	}

	async getProjectDossier(projectEntityId: string): Promise<ProjectDossier | null> {
		try {
			const rows = await this.sql`
				SELECT * FROM project_dossiers
				WHERE tenant_id = ${this.tenant}
				  AND project_entity_id = ${projectEntityId}
				LIMIT 1
			`;
			if (!rows.length) return null;
			return rowToProjectDossier(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("getProjectDossier failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async listProjectDossiers(filter?: ProjectDossierFilter): Promise<ProjectDossier[]> {
		const cap = Math.min(filter?.limit ?? 50, 200);
		const lifecycleStatus = filter?.lifecycle_status ?? null;
		const updatedAfter = filter?.updated_after ?? null;

		try {
			const rows = await this.sql`
				SELECT * FROM project_dossiers
				WHERE tenant_id = ${this.tenant}
				  AND (${lifecycleStatus}::text IS NULL OR lifecycle_status = ${lifecycleStatus})
				  AND (
					${updatedAfter}::timestamptz IS NULL
					OR updated_at >= ${updatedAfter}::timestamptz
					OR last_active_at >= ${updatedAfter}::timestamptz
				  )
				ORDER BY updated_at DESC, last_active_at DESC NULLS LAST
				LIMIT ${cap}
			`;
			return rows.map(row => rowToProjectDossier(row as Record<string, unknown>));
		} catch (err) {
			console.error("listProjectDossiers failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async updateProjectDossier(
		projectEntityId: string,
		updates: Partial<Pick<ProjectDossier, 'lifecycle_status' | 'summary' | 'goals' | 'constraints' | 'decisions' | 'open_questions' | 'next_actions' | 'metadata' | 'last_active_at'>>
	): Promise<ProjectDossier> {
		const current = await this.getProjectDossier(projectEntityId);
		if (!current) throw new Error("Project dossier not found");

		const lifecycle_status = updates.lifecycle_status ?? current.lifecycle_status;
		const summary = updates.summary !== undefined ? updates.summary : current.summary;
		const goals = updates.goals ?? current.goals;
		const constraints = updates.constraints ?? current.constraints;
		const decisions = updates.decisions ?? current.decisions;
		const open_questions = updates.open_questions ?? current.open_questions;
		const next_actions = updates.next_actions ?? current.next_actions;
		const metadata = updates.metadata ?? current.metadata;
		const last_active_at = updates.last_active_at !== undefined ? updates.last_active_at : current.last_active_at;

		try {
			const rows = await this.sql`
				UPDATE project_dossiers SET
					lifecycle_status = ${lifecycle_status},
					summary = ${summary ?? null},
					goals = ${this.sql.json(goals)},
					constraints = ${this.sql.json(constraints)},
					decisions = ${this.sql.json(decisions)},
					open_questions = ${this.sql.json(open_questions)},
					next_actions = ${this.sql.json(next_actions)},
					metadata = ${this.sql.json(metadata as any)},
					last_active_at = ${last_active_at ?? null},
					updated_at = NOW()
				WHERE tenant_id = ${this.tenant}
				  AND project_entity_id = ${projectEntityId}
				RETURNING *
			`;
			if (!rows.length) throw new Error("Project dossier not found after update");
			return rowToProjectDossier(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("updateProjectDossier failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update project dossier");
		}
	}

	// ============ AGENT CAPABILITY MANIFESTS (Phase 2A) ============

	async createAgentCapabilityManifest(manifest: Omit<AgentCapabilityManifest, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<AgentCapabilityManifest> {
		await this.assertAgentEntity(manifest.agent_entity_id);
		if (manifest.router_agent_entity_id) await this.assertAgentEntity(manifest.router_agent_entity_id);
		const id = generateId("agentcard");

		try {
			const rows = await this.sql`
				INSERT INTO agent_capability_manifests (
					id, tenant_id, agent_entity_id, version, delegation_mode, router_agent_entity_id,
					supports_streaming, accepted_output_modes, protocols, skills, metadata, created_at, updated_at
				) VALUES (
					${id},
					${this.tenant},
					${manifest.agent_entity_id},
					${manifest.version ?? '1.0.0'},
					${manifest.delegation_mode ?? 'explicit'},
					${manifest.router_agent_entity_id ?? null},
					${manifest.supports_streaming ?? false},
					${manifest.accepted_output_modes ?? []},
					${manifest.protocols ?? []},
					${this.sql.json(manifest.skills as any ?? [])},
					${this.sql.json((manifest.metadata ?? {}) as any)},
					NOW(),
					NOW()
				)
				RETURNING *
			`;
			return rowToAgentCapabilityManifest(rows[0] as Record<string, unknown>);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "unknown error";
			if (msg.includes("unique") || msg.includes("duplicate")) {
				throw new Error("Agent capability manifest already exists for this agent");
			}
			console.error("createAgentCapabilityManifest failed:", msg);
			throw new Error("Failed to create agent capability manifest");
		}
	}

	async getAgentCapabilityManifest(agentEntityId: string): Promise<AgentCapabilityManifest | null> {
		try {
			const rows = await this.sql`
				SELECT * FROM agent_capability_manifests
				WHERE tenant_id = ${this.tenant}
				  AND agent_entity_id = ${agentEntityId}
				LIMIT 1
			`;
			if (!rows.length) return null;
			return rowToAgentCapabilityManifest(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("getAgentCapabilityManifest failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async listAgentCapabilityManifests(filter?: AgentCapabilityManifestFilter): Promise<AgentCapabilityManifest[]> {
		const cap = Math.min(filter?.limit ?? 50, 200);
		const delegationMode = filter?.delegation_mode ?? null;

		try {
			const rows = await this.sql`
				SELECT * FROM agent_capability_manifests
				WHERE tenant_id = ${this.tenant}
				  AND (${delegationMode}::text IS NULL OR delegation_mode = ${delegationMode})
				ORDER BY updated_at DESC
				LIMIT ${cap}
			`;
			return rows.map(row => rowToAgentCapabilityManifest(row as Record<string, unknown>));
		} catch (err) {
			console.error("listAgentCapabilityManifests failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async updateAgentCapabilityManifest(
		agentEntityId: string,
		updates: Partial<Pick<AgentCapabilityManifest, 'version' | 'delegation_mode' | 'router_agent_entity_id' | 'supports_streaming' | 'accepted_output_modes' | 'protocols' | 'skills' | 'metadata'>>
	): Promise<AgentCapabilityManifest> {
		const current = await this.getAgentCapabilityManifest(agentEntityId);
		if (!current) throw new Error("Agent capability manifest not found");

		const version = updates.version ?? current.version;
		const delegation_mode = updates.delegation_mode ?? current.delegation_mode;
		const router_agent_entity_id = updates.router_agent_entity_id !== undefined ? updates.router_agent_entity_id : current.router_agent_entity_id;
		const supports_streaming = updates.supports_streaming ?? current.supports_streaming;
		const accepted_output_modes = updates.accepted_output_modes ?? current.accepted_output_modes;
		const protocols = updates.protocols ?? current.protocols;
		const skills = updates.skills ?? current.skills;
		const metadata = updates.metadata ?? current.metadata;
		if (router_agent_entity_id) await this.assertAgentEntity(router_agent_entity_id);

		try {
			const rows = await this.sql`
				UPDATE agent_capability_manifests SET
					version = ${version},
					delegation_mode = ${delegation_mode},
					router_agent_entity_id = ${router_agent_entity_id ?? null},
					supports_streaming = ${supports_streaming},
					accepted_output_modes = ${accepted_output_modes},
					protocols = ${protocols},
					skills = ${this.sql.json(skills as any)},
					metadata = ${this.sql.json(metadata as any)},
					updated_at = NOW()
				WHERE tenant_id = ${this.tenant}
				  AND agent_entity_id = ${agentEntityId}
				RETURNING *
			`;
			if (!rows.length) throw new Error("Agent capability manifest not found after update");
			return rowToAgentCapabilityManifest(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("updateAgentCapabilityManifest failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update agent capability manifest");
		}
	}

	// ============ RELATIONS (Sprint 3) ============

	async createRelation(relation: Omit<Relation, 'id' | 'created_at' | 'updated_at'>): Promise<Relation> {
		const id = generateId("rel");
		try {
			const rows = await this.sql`
				INSERT INTO relations (id, tenant_id, from_entity_id, to_entity_id, relation_type, strength, context, created_at, updated_at)
				VALUES (
					${id},
					${this.tenant},
					${relation.from_entity_id},
					${relation.to_entity_id},
					${relation.relation_type},
					${relation.strength ?? 1.0},
					${relation.context ?? null},
					NOW(),
					NOW()
				)
				ON CONFLICT (tenant_id, from_entity_id, to_entity_id, relation_type)
				DO UPDATE SET
					strength   = EXCLUDED.strength,
					context    = EXCLUDED.context,
					updated_at = NOW()
				RETURNING *
			`;
			return rowToRelation(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createRelation failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create relation");
		}
	}

	async getEntityRelations(entityId: string): Promise<Relation[]> {
		try {
			const rows = await this.sql`
				SELECT * FROM relations
				WHERE tenant_id = ${this.tenant}
				  AND (from_entity_id = ${entityId} OR to_entity_id = ${entityId})
				ORDER BY created_at DESC
				LIMIT 200
			`;
			return rows.map(row => rowToRelation(row as Record<string, unknown>));
		} catch (err) {
			console.error("getEntityRelations failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to get entity relations");
		}
	}

	// ============ ENTITY-OBSERVATION LINKING (Sprint 3) ============

	async linkObservationToEntity(observationId: string, entityId: string): Promise<void> {
		try {
			await this.sql`
				UPDATE observations
				SET entity_id = ${entityId}
				WHERE id = ${observationId}
				  AND tenant_id = ${this.tenant}
			`;
		} catch (err) {
			console.error("linkObservationToEntity failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to link observation to entity");
		}
	}

	async getEntityObservations(entityId: string, limit?: number): Promise<{ observation: Observation; territory: string }[]> {
		const cap = limit ?? 20;
		try {
			const rows = await this.sql`
				SELECT id, content, territory, created_at, texture, context, mood,
				       last_accessed_at, access_count, links, summary, type, tags, entity_id
				FROM observations
				WHERE entity_id = ${entityId}
				  AND tenant_id = ${this.tenant}
				ORDER BY created_at DESC
				LIMIT ${cap}
			`;
			return rows.map(row => ({
				observation: rowToObservation(row as Record<string, unknown>),
				territory: row.territory as string
			}));
		} catch (err) {
			console.error("getEntityObservations failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to get entity observations");
		}
	}

	async batchGetEntityObservations(entityIds: string[], limitPerEntity?: number): Promise<Map<string, { observation: Observation; territory: string }[]>> {
		if (entityIds.length === 0) return new Map();
		const cap = limitPerEntity ?? 200;
		try {
			// Single query: fetch all matching observations, then partition in JS
			const rows = await this.sql`
				SELECT id, content, territory, created_at, texture, context, mood,
				       last_accessed_at, access_count, links, summary, type, tags, entity_id
				FROM observations
				WHERE entity_id = ANY(${entityIds})
				  AND tenant_id = ${this.tenant}
				ORDER BY entity_id, created_at DESC
			`;

			const result = new Map<string, { observation: Observation; territory: string }[]>();
			for (const entityId of entityIds) {
				result.set(entityId, []);
			}

			for (const row of rows) {
				const entityId = row.entity_id as string;
				const existing = result.get(entityId);
				if (existing && existing.length < cap) {
					existing.push({
						observation: rowToObservation(row as Record<string, unknown>),
						territory: row.territory as string
					});
				}
			}

			return result;
		} catch (err) {
			console.error("batchGetEntityObservations failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to batch get entity observations");
		}
	}

	async queryEntityTagsForBackfill(): Promise<Array<{ id: string; entity_tags: string[] }>> {
		try {
			const rows = await this.sql`
				SELECT id, entity_tags
				FROM observations
				WHERE tenant_id = ${this.tenant}
				  AND entity_tags != '{}'
				  AND entity_id IS NULL
				LIMIT 500
			`;
			return rows.map(row => ({
				id: row.id as string,
				entity_tags: (row.entity_tags as string[] | null) ?? []
			}));
		} catch (err) {
			console.error("queryEntityTagsForBackfill failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to query entity tags for backfill");
		}
	}

	// ============ HYBRID SEARCH (Sprint 2) ============

	async hybridSearch(options: HybridSearchOptions): Promise<HybridSearchResult[]> {
		const limit = Math.min(options.limit ?? 10, 50);
		const minSimilarity = options.min_similarity ?? 0.3;

		// ---- Phase 1: Candidate Generation ----

		// Build a map from id → result so we can merge scores from both sources.
		interface RawCandidate {
			observation: ReturnType<typeof rowToObservation>;
			territory: string;
			vector_sim?: number;
			keyword_rank?: number;
			novelty_score_raw?: number;
			surface_count_raw?: number;
			/** Candidate came in only via the entity query (no vector or keyword match). */
			_entity_only?: boolean;
			/** Candidate also matched via the entity query (already in map from vector/keyword). */
			_entity_matched?: boolean;
		}
		const candidates = new Map<string, RawCandidate>();

		// Run vector and keyword queries in parallel (keyword is always available).
		const vectorPromise: Promise<Record<string, unknown>[]> = (async () => {
			if (!options.embedding) return [];
			if (
				!Array.isArray(options.embedding) ||
				options.embedding.length !== 768 ||
				!options.embedding.every(n => typeof n === 'number' && Number.isFinite(n))
			) {
				console.error("hybridSearch: invalid embedding — skipping vector search");
				return [];
			}
			const embeddingLiteral = `[${options.embedding.join(",")}]`;
			try {
				if (options.territory && options.grip?.length) {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       1 - (embedding <=> ${embeddingLiteral}::vector) AS vector_sim
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND embedding IS NOT NULL
						  AND territory = ${options.territory}
						  AND (texture->>'grip') = ANY(${options.grip})
						ORDER BY embedding <=> ${embeddingLiteral}::vector
						LIMIT 50
					` as Record<string, unknown>[];
				} else if (options.territory) {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       1 - (embedding <=> ${embeddingLiteral}::vector) AS vector_sim
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND embedding IS NOT NULL
						  AND territory = ${options.territory}
						ORDER BY embedding <=> ${embeddingLiteral}::vector
						LIMIT 50
					` as Record<string, unknown>[];
				} else if (options.grip?.length) {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       1 - (embedding <=> ${embeddingLiteral}::vector) AS vector_sim
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND embedding IS NOT NULL
						  AND (texture->>'grip') = ANY(${options.grip})
						ORDER BY embedding <=> ${embeddingLiteral}::vector
						LIMIT 50
					` as Record<string, unknown>[];
				} else {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       1 - (embedding <=> ${embeddingLiteral}::vector) AS vector_sim
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND embedding IS NOT NULL
						ORDER BY embedding <=> ${embeddingLiteral}::vector
						LIMIT 50
					` as Record<string, unknown>[];
				}
			} catch (err) {
				console.error("hybridSearch vector query failed:", err instanceof Error ? err.message : "unknown error");
				return [];
			}
		})();

		const keywordPromise: Promise<Record<string, unknown>[]> = (async () => {
			if (!options.query?.trim()) return [];
			try {
				if (options.territory && options.grip?.length) {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       ts_rank(search_vector, plainto_tsquery('english', ${options.query})) AS text_rank
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND search_vector @@ plainto_tsquery('english', ${options.query})
						  AND territory = ${options.territory}
						  AND (texture->>'grip') = ANY(${options.grip})
						ORDER BY text_rank DESC
						LIMIT 30
					` as Record<string, unknown>[];
				} else if (options.territory) {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       ts_rank(search_vector, plainto_tsquery('english', ${options.query})) AS text_rank
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND search_vector @@ plainto_tsquery('english', ${options.query})
						  AND territory = ${options.territory}
						ORDER BY text_rank DESC
						LIMIT 30
					` as Record<string, unknown>[];
				} else if (options.grip?.length) {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       ts_rank(search_vector, plainto_tsquery('english', ${options.query})) AS text_rank
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND search_vector @@ plainto_tsquery('english', ${options.query})
						  AND (texture->>'grip') = ANY(${options.grip})
						ORDER BY text_rank DESC
						LIMIT 30
					` as Record<string, unknown>[];
				} else {
					return await this.sql`
						SELECT id, content, territory, created_at, texture, context, mood,
						       last_accessed_at, access_count, links, summary, type, tags,
						       novelty_score, surface_count, entity_id,
						       ts_rank(search_vector, plainto_tsquery('english', ${options.query})) AS text_rank
						FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND search_vector @@ plainto_tsquery('english', ${options.query})
						ORDER BY text_rank DESC
						LIMIT 30
					` as Record<string, unknown>[];
				}
			} catch (err) {
				console.error("hybridSearch keyword query failed:", err instanceof Error ? err.message : "unknown error");
				return [];
			}
		})();

		// 3. Entity-linked candidates (when entity_id filter is present)
		const entityPromise: Promise<Record<string, unknown>[]> = (async () => {
			if (!options.entity_id) return [];
			try {
				const rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags,
					       novelty_score, surface_count, entity_id
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND entity_id = ${options.entity_id}
					ORDER BY created_at DESC
					LIMIT 20
				`;
				return rows as Record<string, unknown>[];
			} catch (err) {
				console.error("hybridSearch entity query failed:", err instanceof Error ? err.message : "unknown error");
				return [];
			}
		})();

		const [vectorRows, keywordRows, entityRows] = await Promise.all([vectorPromise, keywordPromise, entityPromise]);

		// Merge into candidates map — dedup by id, keep both scores if present.
		for (const row of vectorRows) {
			const id = row.id as string;
			const existing = candidates.get(id);
			if (existing) {
				existing.vector_sim = row.vector_sim as number;
			} else {
				candidates.set(id, {
					observation: rowToObservation(row),
					territory: row.territory as string,
					vector_sim: row.vector_sim as number,
					keyword_rank: undefined,
					novelty_score_raw: row.novelty_score as number,
					surface_count_raw: row.surface_count as number
				});
			}
		}

		for (const row of keywordRows) {
			const id = row.id as string;
			const existing = candidates.get(id);
			if (existing) {
				existing.keyword_rank = row.text_rank as number;
			} else {
				candidates.set(id, {
					observation: rowToObservation(row),
					territory: row.territory as string,
					vector_sim: undefined,
					keyword_rank: row.text_rank as number,
					novelty_score_raw: row.novelty_score as number,
					surface_count_raw: row.surface_count as number
				});
			}
		}

		// Merge entity-linked candidates — overlap adds 'entity' to match_sources signal;
		// entity-only results enter the pool with a base score of 0.5.
		for (const row of entityRows) {
			const id = row.id as string;
			const existing = candidates.get(id);
			if (existing) {
				// Mark as also entity-matched — the gravity modulation will apply later.
				existing._entity_matched = true;
			} else {
				candidates.set(id, {
					observation: rowToObservation(row),
					territory: row.territory as string,
					vector_sim: undefined,
					keyword_rank: undefined,
					novelty_score_raw: row.novelty_score as number,
					surface_count_raw: row.surface_count as number,
					_entity_only: true
				});
			}
		}

		if (candidates.size === 0) return [];

		// Normalize keyword ranks to 0–1 range for combining with vector similarity.
		// ts_rank values are unbounded; find the max to normalize.
		let maxKeywordRank = 0;
		for (const c of candidates.values()) {
			if (c.keyword_rank !== undefined && c.keyword_rank > maxKeywordRank) {
				maxKeywordRank = c.keyword_rank;
			}
		}

		// ---- Phase 2: Score Modulation (Neural Surfacing v1) ----

		// Build retrieval_bias set from circadian phase for territory boost.
		const circadianBiasSet = new Set<string>();
		if (options.circadian_phase && CIRCADIAN_PHASES[options.circadian_phase]) {
			for (const t of CIRCADIAN_PHASES[options.circadian_phase].retrieval_bias) {
				circadianBiasSet.add(t);
			}
		}

		const gripMultiplier: Record<string, number> = {
			iron: 1.3, strong: 1.15, present: 1.0, loose: 0.9, dormant: 0.7
		};
		const chargePhaseMultiplier: Record<string, number> = {
			fresh: 1.3, active: 1.15, processing: 1.0, metabolized: 0.85
		};

		const results: HybridSearchResult[] = [];

		for (const [, cand] of candidates) {
			const { observation, territory, vector_sim, keyword_rank } = cand;
			const texture = observation.texture || {};
			const noveltyScore: number = cand.novelty_score_raw ?? texture.novelty_score ?? 0.5;
			const chargePhase: string = texture.charge_phase ?? "processing";
			const grip: string = texture.grip ?? "present";
			const match_sources: string[] = [];

			// Base score: weighted combination of available signals.
			let baseScore: number;
			if (vector_sim !== undefined && keyword_rank !== undefined) {
				const normalizedKeyword = maxKeywordRank > 0 ? keyword_rank / maxKeywordRank : 0;
				baseScore = vector_sim * 0.7 + normalizedKeyword * 0.3;
				match_sources.push('vector', 'keyword');
			} else if (vector_sim !== undefined) {
				baseScore = vector_sim;
				match_sources.push('vector');
			} else if (keyword_rank !== undefined) {
				// keyword only
				baseScore = maxKeywordRank > 0 ? keyword_rank / maxKeywordRank : 0;
				match_sources.push('keyword');
			} else {
				// entity-only — no vector or keyword signal; use flat base score
				baseScore = 0.5;
			}

			// Entity match source label (for candidates that appeared in entity query)
			if (cand._entity_only || cand._entity_matched) {
				match_sources.push('entity');
			}

			// Skip results below threshold before applying multipliers.
			// Entity-only candidates always clear the threshold (baseScore = 0.5 >= default 0.3).
			if (baseScore < minSimilarity) continue;

			let score = baseScore;

			// 1. Grip weighting
			score *= gripMultiplier[grip] ?? 1.0;

			// 2. Charge phase multiplier
			score *= chargePhaseMultiplier[chargePhase] ?? 1.0;

			// 3. Novelty boost (only for non-metabolized observations with high novelty)
			if (noveltyScore > 0.7 && chargePhase !== 'metabolized') {
				score *= 1.0 + (noveltyScore - 0.5) * 0.5;
			}

			// 4. Circadian territory bias
			if (circadianBiasSet.has(territory)) {
				score *= 1.15;
			}

			// 5. Entity gravity — observations about same entity cluster
			if (options.entity_id && observation.entity_id === options.entity_id) {
				score *= 1.15;
				if (!match_sources.includes('entity')) match_sources.push('entity');
			}

			results.push({
				observation,
				territory,
				score,
				match_sources,
				vector_similarity: vector_sim,
				keyword_rank: keyword_rank
			});
		}

		// ---- Phase 3: Sort and truncate ----
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, limit);
	}

	async recordMemoryCascade(observationIds: string[]): Promise<void> {
		// Only process top 5; generate all unique pairs with canonical ordering (id_a < id_b).
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

		if (pairs.length === 0) return;

		const idsA = pairs.map(([a]) => a);
		const idsB = pairs.map(([, b]) => b);

		try {
			// Single unnest INSERT — one subrequest for all pairs instead of N.
			await this.sql`
				INSERT INTO memory_cascade (tenant_id, obs_id_a, obs_id_b, count, last_co_surfaced)
				SELECT ${this.tenant}, a, b, 1, NOW()
				FROM unnest(${idsA}::text[], ${idsB}::text[]) AS t(a, b)
				ON CONFLICT (tenant_id, obs_id_a, obs_id_b)
				DO UPDATE SET count = memory_cascade.count + 1, last_co_surfaced = NOW()
			`;
		} catch (err) {
			// Cascade recording is best-effort — never fail the search for this.
			console.error("recordMemoryCascade failed:", err instanceof Error ? err.message : "unknown error");
		}
	}

	async updateSurfacingEffects(observationIds: string[]): Promise<void> {
		if (observationIds.length === 0) return;
		try {
			await this.sql`
				UPDATE observations
				SET
					novelty_score    = GREATEST(novelty_score - 0.05, 0.0),
					texture          = jsonb_set(texture, '{novelty_score}', to_jsonb(GREATEST(novelty_score - 0.05, 0.0))),
					surface_count    = surface_count + 1,
					last_surfaced_at = NOW()
				WHERE tenant_id = ${this.tenant}
				  AND id = ANY(${observationIds})
			`;
		} catch (err) {
			// Surfacing effects are best-effort — never fail the search for this.
			console.error("updateSurfacingEffects failed:", err instanceof Error ? err.message : "unknown error");
		}
	}

	// ============ DAEMON PROPOSALS (Sprint 4) ============

	async createProposal(proposal: Omit<DaemonProposal, 'id' | 'proposed_at'>): Promise<DaemonProposal> {
		const id = `prop_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
		try {
			const rows = await this.sql`
				INSERT INTO daemon_proposals (
					id, tenant_id, proposal_type, source_id, target_id,
					similarity, resonance_type, confidence, rationale,
					metadata, status, feedback_note, proposed_at
				) VALUES (
					${id},
					${this.tenant},
					${proposal.proposal_type},
					${proposal.source_id},
					${proposal.target_id},
					${proposal.similarity ?? null},
					${proposal.resonance_type ?? null},
					${proposal.confidence},
					${proposal.rationale ?? null},
					${this.sql.json((proposal.metadata ?? {}) as any)},
					${proposal.status},
					${proposal.feedback_note ?? null},
					NOW()
				)
				RETURNING *
			`;
			return this._rowToProposal(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createProposal failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create proposal");
		}
	}

	async listProposals(type?: string, status?: string, limit?: number): Promise<DaemonProposal[]> {
		const cap = Math.min(limit ?? 50, 200);
		try {
			const rows = await this.sql`
				SELECT * FROM daemon_proposals
				WHERE tenant_id = ${this.tenant}
				  AND (${type ?? null}::text IS NULL OR proposal_type = ${type ?? null})
				  AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
				ORDER BY proposed_at DESC
				LIMIT ${cap}
			`;
			return rows.map(r => this._rowToProposal(r as Record<string, unknown>));
		} catch (err) {
			console.error("listProposals failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async getProposalById(id: string): Promise<DaemonProposal | null> {
		try {
			const rows = await this.sql`
				SELECT * FROM daemon_proposals
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
				LIMIT 1
			`;
			if (!rows.length) return null;
			return this._rowToProposal(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("getProposalById failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async reviewProposal(id: string, status: 'accepted' | 'rejected', feedbackNote?: string): Promise<DaemonProposal> {
		try {
			const rows = await this.sql`
				UPDATE daemon_proposals
				SET status = ${status},
				    reviewed_at = NOW(),
				    feedback_note = ${feedbackNote ?? null}
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
				RETURNING *
			`;
			if (!rows.length) throw new Error("Proposal not found");
			return this._rowToProposal(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("reviewProposal failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to review proposal");
		}
	}

	async getProposalStats(): Promise<Record<string, { total: number; accepted: number; rejected: number; ratio: number }>> {
		try {
			const rows = await this.sql`
				SELECT
					proposal_type,
					COUNT(*)::int                                                                AS total,
					COUNT(*) FILTER (WHERE status = 'accepted')::int                           AS accepted,
					COUNT(*) FILTER (WHERE status = 'rejected')::int                           AS rejected
				FROM daemon_proposals
				WHERE tenant_id = ${this.tenant}
				GROUP BY proposal_type
			`;
			const result: Record<string, { total: number; accepted: number; rejected: number; ratio: number }> = {};
			for (const row of rows) {
				const total = row.total as number;
				const accepted = row.accepted as number;
				result[row.proposal_type as string] = {
					total,
					accepted,
					rejected: row.rejected as number,
					ratio: total > 0 ? accepted / total : 0
				};
			}
			return result;
		} catch (err) {
			console.error("getProposalStats failed:", err instanceof Error ? err.message : "unknown error");
			return {};
		}
	}

	async proposalExists(type: string, sourceId: string, targetId: string): Promise<boolean> {
		try {
			const rows = await this.sql`
				SELECT 1 FROM daemon_proposals
				WHERE tenant_id = ${this.tenant}
				  AND proposal_type = ${type}
				  AND source_id = ${sourceId}
				  AND target_id = ${targetId}
				  AND status = 'pending'
				LIMIT 1
			`;
			return rows.length > 0;
		} catch (err) {
			console.error("proposalExists failed:", err instanceof Error ? err.message : "unknown error");
			return false;
		}
	}

	async batchProposalExists(checks: Array<{ type: string; sourceId: string; targetId: string }>): Promise<Set<string>> {
		if (checks.length === 0) return new Set();
		try {
			const types = checks.map(c => c.type);
			const sources = checks.map(c => c.sourceId);
			const targets = checks.map(c => c.targetId);

			const rows = await this.sql`
				SELECT proposal_type, source_id, target_id
				FROM daemon_proposals
				WHERE tenant_id = ${this.tenant}
				  AND (proposal_type, source_id, target_id) IN (
				      SELECT unnest(${types}::text[]), unnest(${sources}::text[]), unnest(${targets}::text[])
				  )
			`;

			const existingKeys = new Set<string>();
			for (const row of rows) {
				existingKeys.add(`${row.proposal_type}:${row.source_id}:${row.target_id}`);
			}
			return existingKeys;
		} catch (err) {
			console.error("batchProposalExists failed:", err instanceof Error ? err.message : "unknown error");
			return new Set();
		}
	}

	// ============ ORPHAN MANAGEMENT (Sprint 4) ============

	async markOrphan(observationId: string): Promise<void> {
		try {
			await this.sql`
				INSERT INTO orphan_observations (observation_id, tenant_id, first_marked, rescue_attempts, status)
				VALUES (${observationId}, ${this.tenant}, NOW(), 0, 'orphaned')
				ON CONFLICT (tenant_id, observation_id) DO NOTHING
			`;
		} catch (err) {
			console.error("markOrphan failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to mark orphan");
		}
	}

	async listOrphans(status?: string, limit?: number): Promise<OrphanObservation[]> {
		const cap = Math.min(limit ?? 50, 200);
		try {
			const rows = await this.sql`
				SELECT * FROM orphan_observations
				WHERE tenant_id = ${this.tenant}
				  AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
				ORDER BY first_marked ASC
				LIMIT ${cap}
			`;
			return rows.map(r => this._rowToOrphan(r as Record<string, unknown>));
		} catch (err) {
			console.error("listOrphans failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async incrementRescueAttempt(observationId: string): Promise<void> {
		try {
			await this.sql`
				UPDATE orphan_observations
				SET rescue_attempts = rescue_attempts + 1,
				    last_rescue_attempt = NOW()
				WHERE tenant_id = ${this.tenant}
				  AND observation_id = ${observationId}
			`;
		} catch (err) {
			console.error("incrementRescueAttempt failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to increment rescue attempt");
		}
	}

	async updateOrphanStatus(observationId: string, status: 'rescued' | 'archived'): Promise<void> {
		try {
			await this.sql`
				UPDATE orphan_observations
				SET status = ${status}
				WHERE tenant_id = ${this.tenant}
				  AND observation_id = ${observationId}
			`;
		} catch (err) {
			console.error("updateOrphanStatus failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update orphan status");
		}
	}

	// ============ DAEMON CONFIG (Sprint 4) ============

	async readDaemonConfig(): Promise<DaemonConfig> {
		const defaults: DaemonConfig = {
			tenant_id: this.tenant,
			link_proposal_threshold: 0.75,
			data: {}
		};
		try {
			const rows = await this.sql`
				SELECT * FROM daemon_config
				WHERE tenant_id = ${this.tenant}
				LIMIT 1
			`;
			if (!rows.length) return defaults;
			const row = rows[0] as Record<string, unknown>;
			return {
				tenant_id: row.tenant_id as string,
				link_proposal_threshold: (row.link_proposal_threshold as number) ?? 0.75,
				last_threshold_update: row.last_threshold_update ? toISOString(row.last_threshold_update) : undefined,
				data: (row.data as Record<string, unknown>) ?? {}
			};
		} catch (err) {
			console.error("readDaemonConfig failed:", err instanceof Error ? err.message : "unknown error");
			return defaults;
		}
	}

	async updateProposalThreshold(threshold: number): Promise<void> {
		try {
			await this.sql`
				INSERT INTO daemon_config (tenant_id, link_proposal_threshold, last_threshold_update, data)
				VALUES (${this.tenant}, ${threshold}, NOW(), '{}')
				ON CONFLICT (tenant_id)
				DO UPDATE SET
					link_proposal_threshold = ${threshold},
					last_threshold_update   = NOW()
			`;
		} catch (err) {
			console.error("updateProposalThreshold failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to update proposal threshold");
		}
	}

	// ============ HEALTH QUERIES (Sprint 4) ============

	async getEmbeddingCoverage(): Promise<{ total: number; embedded: number }> {
		try {
			const rows = await this.sql`
				SELECT
					COUNT(*)::int                                    AS total,
					COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded
				FROM observations
				WHERE tenant_id = ${this.tenant}
			`;
			const row = rows[0] as Record<string, unknown>;
			return {
				total: (row.total as number) ?? 0,
				embedded: (row.embedded as number) ?? 0
			};
		} catch (err) {
			console.error("getEmbeddingCoverage failed:", err instanceof Error ? err.message : "unknown error");
			return { total: 0, embedded: 0 };
		}
	}

	async getOrphanStats(): Promise<{ orphaned: number; rescued: number; archived: number; oldest_days: number }> {
		try {
			const rows = await this.sql`
				SELECT
					COUNT(*) FILTER (WHERE status = 'orphaned')::int  AS orphaned,
					COUNT(*) FILTER (WHERE status = 'rescued')::int   AS rescued,
					COUNT(*) FILTER (WHERE status = 'archived')::int  AS archived,
					EXTRACT(EPOCH FROM (NOW() - MIN(first_marked))) / 86400 AS oldest_days
				FROM orphan_observations
				WHERE tenant_id = ${this.tenant}
			`;
			const row = rows[0] as Record<string, unknown>;
			return {
				orphaned: (row.orphaned as number) ?? 0,
				rescued: (row.rescued as number) ?? 0,
				archived: (row.archived as number) ?? 0,
				oldest_days: row.oldest_days ? Math.round((row.oldest_days as number)) : 0
			};
		} catch (err) {
			console.error("getOrphanStats failed:", err instanceof Error ? err.message : "unknown error");
			return { orphaned: 0, rescued: 0, archived: 0, oldest_days: 0 };
		}
	}

	async getTopCascadePairs(limit?: number): Promise<Array<{ obs_id_a: string; obs_id_b: string; count: number }>> {
		const cap = Math.min(limit ?? 20, 100);
		try {
			const rows = await this.sql`
				SELECT obs_id_a, obs_id_b, count
				FROM memory_cascade
				WHERE tenant_id = ${this.tenant}
				ORDER BY count DESC
				LIMIT ${cap}
			`;
			return rows.map(r => ({
				obs_id_a: r.obs_id_a as string,
				obs_id_b: r.obs_id_b as string,
				count: r.count as number
			}));
		} catch (err) {
			console.error("getTopCascadePairs failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	// ============ FIND SIMILAR UNLINKED (Sprint 4) ============

	async findSimilarUnlinked(sourceId: string, limit: number): Promise<Array<{ observation: Observation; territory: string; similarity: number }>> {
		try {
			const rows = await this.sql`
				WITH source AS (
					SELECT embedding
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND id = ${sourceId}
					  AND embedding IS NOT NULL
				),
				already_linked AS (
					SELECT target_id AS excluded_id FROM links
					WHERE tenant_id = ${this.tenant} AND source_id = ${sourceId}
					UNION
					SELECT source_id AS excluded_id FROM links
					WHERE tenant_id = ${this.tenant} AND target_id = ${sourceId}
				),
				pending_proposals AS (
					SELECT target_id AS excluded_id FROM daemon_proposals
					WHERE tenant_id = ${this.tenant}
					  AND source_id = ${sourceId}
					  AND status = 'pending'
				)
				SELECT o.id, o.content, o.territory, o.created_at, o.texture,
				       o.context, o.mood, o.last_accessed_at, o.access_count,
				       o.links, o.summary, o.type, o.tags, o.entity_id,
				       1 - (source.embedding <=> o.embedding) AS similarity
				FROM source
				CROSS JOIN LATERAL (
					SELECT *
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND id != ${sourceId}
					  AND embedding IS NOT NULL
					  AND NOT EXISTS (SELECT 1 FROM already_linked WHERE excluded_id = observations.id)
					  AND NOT EXISTS (SELECT 1 FROM pending_proposals WHERE excluded_id = observations.id)
					ORDER BY source.embedding <=> embedding
					LIMIT ${limit}
				) AS o
				ORDER BY similarity DESC
			`;
			return rows.map(row => ({
				observation: rowToObservation(row as Record<string, unknown>),
				territory: row.territory as string,
				similarity: row.similarity as number
			}));
		} catch (err) {
			console.error("findSimilarUnlinked failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async findOrphanCandidates(cutoffDate: string, limit: number): Promise<Observation[]> {
		try {
			const rows = await this.sql`
				SELECT o.*
				FROM observations o
				LEFT JOIN links l1 ON l1.source_id = o.id AND l1.tenant_id = o.tenant_id
				LEFT JOIN links l2 ON l2.target_id = o.id AND l2.tenant_id = o.tenant_id
				WHERE o.tenant_id = ${this.tenant}
				  AND o.entity_id IS NULL
				  AND o.access_count <= 1
				  AND o.created_at < ${cutoffDate}::timestamptz
				  AND l1.source_id IS NULL
				  AND l2.target_id IS NULL
				  AND NOT EXISTS (
						SELECT 1 FROM orphan_observations oo
						WHERE oo.observation_id = o.id AND oo.tenant_id = o.tenant_id
				  )
				ORDER BY o.created_at ASC
				LIMIT ${limit}
			`;
			return rows.map(r => rowToObservation(r as Record<string, unknown>));
		} catch (err) {
			console.error("findOrphanCandidates failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	// ============ OBSERVATION VERSIONS (Sprint 6) ============

	async createVersion(observationId: string, content: string, texture: Observation["texture"], changeReason?: string): Promise<ObservationVersion> {
		const id = generateId("ver");
		try {
			const rows = await this.sql`
				INSERT INTO observation_versions (id, tenant_id, observation_id, version_num, content, texture, change_reason, created_at)
				SELECT
					${id},
					${this.tenant},
					${observationId},
					COALESCE(MAX(version_num), 0) + 1,
					${content},
					${this.sql.json((texture ?? {}) as any)},
					${changeReason ?? null},
					NOW()
				FROM observation_versions
				WHERE tenant_id = ${this.tenant}
				  AND observation_id = ${observationId}
				RETURNING *
			`;
			return this._rowToVersion(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createVersion failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create observation version");
		}
	}

	async getVersionHistory(observationId: string): Promise<ObservationVersion[]> {
		try {
			const rows = await this.sql`
				SELECT * FROM observation_versions
				WHERE tenant_id = ${this.tenant}
				  AND observation_id = ${observationId}
				ORDER BY version_num ASC
			`;
			return rows.map(r => this._rowToVersion(r as Record<string, unknown>));
		} catch (err) {
			console.error("getVersionHistory failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	// ============ PROCESSING LOG (Sprint 6) ============

	async createProcessingEntry(entry: Omit<ProcessingEntry, 'id' | 'tenant_id' | 'created_at'>): Promise<ProcessingEntry> {
		const id = generateId("proc");
		try {
			const rows = await this.sql`
				INSERT INTO processing_log (id, tenant_id, observation_id, processing_note, charge_at_processing, somatic_at_processing, created_at)
				VALUES (
					${id},
					${this.tenant},
					${entry.observation_id},
					${entry.processing_note ?? null},
					${entry.charge_at_processing ?? []},
					${entry.somatic_at_processing ?? null},
					NOW()
				)
				RETURNING *
			`;
			return this._rowToProcessingEntry(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createProcessingEntry failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create processing entry");
		}
	}

	async listProcessingEntries(observationId: string, limit?: number): Promise<ProcessingEntry[]> {
		const cap = Math.min(limit ?? 20, 100);
		try {
			const rows = await this.sql`
				SELECT * FROM processing_log
				WHERE tenant_id = ${this.tenant}
				  AND observation_id = ${observationId}
				ORDER BY created_at DESC
				LIMIT ${cap}
			`;
			return rows.map(r => this._rowToProcessingEntry(r as Record<string, unknown>));
		} catch (err) {
			console.error("listProcessingEntries failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async incrementProcessingCount(observationId: string): Promise<number> {
		try {
			const rows = await this.sql`
				UPDATE observations
				SET processing_count = processing_count + 1
				WHERE tenant_id = ${this.tenant}
				  AND id = ${observationId}
				RETURNING processing_count
			`;
			return (rows[0]?.processing_count as number) ?? 0;
		} catch (err) {
			console.error("incrementProcessingCount failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to increment processing count");
		}
	}

	async advanceChargePhase(observationId: string): Promise<{ advanced: boolean; new_phase?: string }> {
		// Threshold: 3 processings per phase level to advance.
		// Burning paradox acceleration: if this observation is linked to a burning paradox loop,
		// threshold drops to 2 processings per phase level.
		const PHASE_ORDER: Array<string> = ['fresh', 'active', 'processing', 'metabolized'];
		try {
			// Count processings and check for burning paradox link in parallel.
			const [countRows, paradoxRows] = await Promise.all([
				this.sql`
					SELECT COUNT(*)::int AS count
					FROM processing_log
					WHERE tenant_id = ${this.tenant}
					  AND observation_id = ${observationId}
				`,
				// A burning paradox loop references this observation if the observation's entity_id
				// appears in linked_entity_ids, OR if the observation is linked to an entity that
				// appears in an open paradox loop. Simpler: check if any burning paradox loop exists
				// whose linked observations or entity overlaps. We use the open_loops table directly:
				// if any burning paradox loop has this observation's id in its content scope, we lower threshold.
				// Practical approach: check if observation is linked to any entity that appears in a
				// burning paradox loop's linked_entity_ids. Also check observation's own entity_id.
				this.sql`
					SELECT COUNT(*)::int AS count
					FROM open_loops ol
					JOIN observations obs ON obs.id = ${observationId}
					WHERE ol.tenant_id = ${this.tenant}
					  AND ol.mode = 'paradox'
					  AND ol.status = 'burning'
					  AND (
					    (obs.entity_id IS NOT NULL AND ol.linked_entity_ids @> ARRAY[obs.entity_id])
					  )
				`
			]);

			const processingCount = (countRows[0]?.count as number) ?? 0;
			const linkedToBurningParadox = ((paradoxRows[0]?.count as number) ?? 0) > 0;

			// Base threshold per phase level: 3. Burning paradox: 2.
			const baseThreshold = linkedToBurningParadox ? 2 : 3;

			// Need at least baseThreshold processings to advance at all
			if (processingCount < baseThreshold) return { advanced: false };

			const obsRows = await this.sql`
				SELECT texture FROM observations
				WHERE tenant_id = ${this.tenant}
				  AND id = ${observationId}
				LIMIT 1
			`;
			if (!obsRows.length) return { advanced: false };

			const texture = obsRows[0].texture as Record<string, unknown>;
			const currentPhase = (texture?.charge_phase as string) ?? 'fresh';
			const currentIdx = PHASE_ORDER.indexOf(currentPhase);

			// Already at end or unrecognized phase
			if (currentIdx < 0 || currentIdx >= PHASE_ORDER.length - 1) return { advanced: false };

			// Flat threshold per phase: every phase advance needs exactly baseThreshold processings.
			const threshold = baseThreshold;
			if (processingCount < threshold) return { advanced: false };

			const newPhase = PHASE_ORDER[currentIdx + 1];
			await this.sql`
				UPDATE observations
				SET texture = jsonb_set(texture, '{charge_phase}', ${JSON.stringify(newPhase)})
				WHERE tenant_id = ${this.tenant}
				  AND id = ${observationId}
			`;
			return { advanced: true, new_phase: newPhase };
		} catch (err) {
			console.error("advanceChargePhase failed:", err instanceof Error ? err.message : "unknown error");
			return { advanced: false };
		}
	}

	// ============ CONSOLIDATION CANDIDATES (Sprint 6) ============

	async createConsolidationCandidate(candidate: Omit<ConsolidationCandidate, 'id' | 'tenant_id' | 'created_at' | 'reviewed_at'>): Promise<ConsolidationCandidate> {
		const id = generateId("cand");
		try {
			const rows = await this.sql`
				INSERT INTO consolidation_candidates (
					id, tenant_id, source_observation_ids, pattern_description,
					suggested_territory, suggested_type, status, created_at
				) VALUES (
					${id},
					${this.tenant},
					${candidate.source_observation_ids},
					${candidate.pattern_description},
					${candidate.suggested_territory ?? null},
					${candidate.suggested_type},
					${candidate.status ?? 'pending'},
					NOW()
				)
				RETURNING *
			`;
			return this._rowToConsolidationCandidate(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createConsolidationCandidate failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create consolidation candidate");
		}
	}

	async listConsolidationCandidates(status?: string, limit?: number): Promise<ConsolidationCandidate[]> {
		const cap = Math.min(limit ?? 50, 200);
		try {
			const rows = await this.sql`
				SELECT * FROM consolidation_candidates
				WHERE tenant_id = ${this.tenant}
				  AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
				ORDER BY created_at DESC
				LIMIT ${cap}
			`;
			return rows.map(r => this._rowToConsolidationCandidate(r as Record<string, unknown>));
		} catch (err) {
			console.error("listConsolidationCandidates failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async reviewConsolidationCandidate(id: string, status: 'accepted' | 'rejected' | 'deferred'): Promise<ConsolidationCandidate> {
		try {
			const rows = await this.sql`
				UPDATE consolidation_candidates
				SET status = ${status},
				    reviewed_at = NOW()
				WHERE id = ${id}
				  AND tenant_id = ${this.tenant}
				RETURNING *
			`;
			if (!rows.length) throw new Error("Consolidation candidate not found");
			return this._rowToConsolidationCandidate(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("reviewConsolidationCandidate failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to review consolidation candidate");
		}
	}

	// ============ DISPATCH FEEDBACK (Sprint 6) ============

	async recordDispatch(entry: Omit<DispatchFeedback, 'id' | 'tenant_id' | 'dispatched_at'>): Promise<DispatchFeedback> {
		const id = generateId("disp");
		try {
			const rows = await this.sql`
				INSERT INTO dispatch_feedback (
					id, tenant_id, agent_entity_id, task_type, dispatched_at,
					domain, environment, session_id, outcome, findings_count, findings_acted,
					confidence_avg, predicted_confidence, outcome_score, revision_cost,
					needed_rescue, rescue_agent_id, time_to_usable_ms, notes, reviewed_at
				) VALUES (
					${id},
					${this.tenant},
					${entry.agent_entity_id ?? null},
					${entry.task_type},
					NOW(),
					${entry.domain ?? null},
					${entry.environment ?? null},
					${entry.session_id ?? null},
					${entry.outcome ?? null},
					${entry.findings_count ?? 0},
					${entry.findings_acted ?? 0},
					${entry.confidence_avg ?? null},
					${entry.predicted_confidence ?? null},
					${entry.outcome_score ?? null},
					${entry.revision_cost ?? null},
					${entry.needed_rescue ?? false},
					${entry.rescue_agent_id ?? null},
					${entry.time_to_usable_ms ?? null},
					${entry.notes ?? null},
					${entry.reviewed_at ?? null}
				)
				RETURNING *
			`;
			return this._rowToDispatchFeedback(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("recordDispatch failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to record dispatch feedback");
		}
	}

	async getDispatchStats(agentEntityId?: string): Promise<DispatchStat[]> {
		try {
			const rows = await this.sql`
				SELECT
					task_type,
					COUNT(*)::int                                                     AS total,
					COUNT(*) FILTER (WHERE outcome = 'effective')::int               AS effective,
					COUNT(*) FILTER (WHERE outcome = 'partial')::int                 AS partial,
					COUNT(*) FILTER (WHERE outcome = 'ineffective')::int             AS ineffective,
					COUNT(*) FILTER (WHERE outcome = 'redirected')::int              AS redirected,
					COALESCE(AVG(confidence_avg), 0)::real                           AS avg_confidence,
					COALESCE(AVG(predicted_confidence), 0)::real                     AS avg_predicted_confidence,
					COALESCE(AVG(outcome_score), 0)::real                            AS avg_outcome_score,
					COALESCE(AVG(revision_cost), 0)::real                            AS avg_revision_cost,
					COALESCE(AVG(CASE WHEN needed_rescue THEN 1 ELSE 0 END), 0)::real AS rescue_rate
				FROM dispatch_feedback
				WHERE tenant_id = ${this.tenant}
				  AND (${agentEntityId ?? null}::text IS NULL OR agent_entity_id = ${agentEntityId ?? null})
				GROUP BY task_type
				ORDER BY total DESC
			`;
			return rows.map(r => ({
				task_type: r.task_type as string,
				total: r.total as number,
				effective: r.effective as number,
				partial: r.partial as number,
				ineffective: r.ineffective as number,
				redirected: r.redirected as number,
				avg_confidence: r.avg_confidence as number,
				avg_predicted_confidence: r.avg_predicted_confidence as number,
				avg_outcome_score: r.avg_outcome_score as number,
				avg_revision_cost: r.avg_revision_cost as number,
				rescue_rate: r.rescue_rate as number
			}));
		} catch (err) {
			console.error("getDispatchStats failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	// ============ TASKS (Sprint 6 schema — Sprint 7 wiring) ============

	async createTask(task: Omit<Task, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>): Promise<Task> {
		const id = generateId("task");
		try {
			const rows = await this.sql`
				INSERT INTO tasks (
					id, tenant_id, assigned_tenant, title, description, status, priority,
					estimated_effort, scheduled_wake, source,
					linked_observation_ids, linked_entity_ids, depends_on,
					completion_note, created_at, updated_at, completed_at
				) VALUES (
					${id},
					${this.tenant},
					${task.assigned_tenant ?? null},
					${task.title},
					${task.description ?? null},
					${task.status ?? 'open'},
					${task.priority ?? 'normal'},
					${task.estimated_effort ?? null},
					${task.scheduled_wake ?? null},
					${task.source ?? null},
					${task.linked_observation_ids ?? []},
					${task.linked_entity_ids ?? []},
					${task.depends_on ?? null},
					${task.completion_note ?? null},
					NOW(),
					NOW(),
					${task.completed_at ?? null}
				)
				RETURNING *
			`;
			return this._rowToTask(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createTask failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create task");
		}
	}

	async listTasks(status?: string, priority?: string, limit?: number, includeAssigned?: boolean): Promise<Task[]> {
		const cap = Math.min(limit ?? 50, 200);
		const orderScheduled = status === 'scheduled';
		try {
			const rows = includeAssigned
				? orderScheduled
					? await this.sql`
						SELECT * FROM tasks
						WHERE (tenant_id = ${this.tenant} OR assigned_tenant = ${this.tenant})
						  AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
						  AND (${priority ?? null}::text IS NULL OR priority = ${priority ?? null})
						ORDER BY scheduled_wake ASC NULLS LAST, created_at DESC
						LIMIT ${cap}
					`
					: await this.sql`
						SELECT * FROM tasks
						WHERE (tenant_id = ${this.tenant} OR assigned_tenant = ${this.tenant})
						  AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
						  AND (${priority ?? null}::text IS NULL OR priority = ${priority ?? null})
						ORDER BY created_at DESC
						LIMIT ${cap}
					`
				: orderScheduled
					? await this.sql`
						SELECT * FROM tasks
						WHERE tenant_id = ${this.tenant}
						  AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
						  AND (${priority ?? null}::text IS NULL OR priority = ${priority ?? null})
						ORDER BY scheduled_wake ASC NULLS LAST, created_at DESC
						LIMIT ${cap}
					`
					: await this.sql`
						SELECT * FROM tasks
						WHERE tenant_id = ${this.tenant}
						  AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
						  AND (${priority ?? null}::text IS NULL OR priority = ${priority ?? null})
						ORDER BY created_at DESC
						LIMIT ${cap}
					`;
			return rows.map(r => this._rowToTask(r as Record<string, unknown>));
		} catch (err) {
			console.error("listTasks failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async listTaskChangesSince(since: string, limit?: number, includeAssigned?: boolean): Promise<Task[]> {
		const cap = Math.min(limit ?? 50, 200);
		try {
			const rows = includeAssigned
				? await this.sql`
					SELECT * FROM tasks
					WHERE (tenant_id = ${this.tenant} OR assigned_tenant = ${this.tenant})
					  AND updated_at >= ${since}::timestamptz
					ORDER BY updated_at DESC, created_at DESC
					LIMIT ${cap}
				`
				: await this.sql`
					SELECT * FROM tasks
					WHERE tenant_id = ${this.tenant}
					  AND updated_at >= ${since}::timestamptz
					ORDER BY updated_at DESC, created_at DESC
					LIMIT ${cap}
				`;
			return rows.map(r => this._rowToTask(r as Record<string, unknown>));
		} catch (err) {
			console.error("listTaskChangesSince failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async openDueScheduledTasks(nowIso?: string, limit?: number): Promise<number> {
		const now = nowIso ?? getTimestamp();
		const cap = Math.min(limit ?? 200, 500);
		try {
			const rows = await this.sql`
				WITH due AS (
					SELECT id
					FROM tasks
					WHERE tenant_id = ${this.tenant}
					  AND status = 'scheduled'
					  AND scheduled_wake IS NOT NULL
					  AND scheduled_wake <= ${now}::timestamptz
					ORDER BY scheduled_wake ASC, created_at ASC
					LIMIT ${cap}
				)
				UPDATE tasks t
				SET status = 'open', updated_at = NOW()
				FROM due
				WHERE t.id = due.id
				RETURNING t.id
			`;
			return rows.length;
		} catch (err) {
			console.error("openDueScheduledTasks failed:", err instanceof Error ? err.message : "unknown error");
			return 0;
		}
	}

	async updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'estimated_effort' | 'scheduled_wake' | 'completion_note' | 'completed_at'>>, includeAssigned?: boolean): Promise<Task> {
		if (Object.keys(updates).length === 0) throw new Error("No fields to update");

		const title = updates.title ?? null;
		const description = updates.description ?? null;
		const status = updates.status ?? null;
		const priority = updates.priority ?? null;
		const estimated_effort = updates.estimated_effort ?? null;
		const scheduled_wake = updates.scheduled_wake ?? null;
		const completion_note = updates.completion_note ?? null;
		const completed_at = updates.completed_at ?? null;

		try {
			const rows = includeAssigned
				? await this.sql`
					UPDATE tasks SET
						title            = COALESCE(${title}, title),
						description      = COALESCE(${description}, description),
						status           = COALESCE(${status}, status),
						priority         = COALESCE(${priority}, priority),
						estimated_effort = COALESCE(${estimated_effort}, estimated_effort),
						scheduled_wake   = COALESCE(${scheduled_wake}, scheduled_wake),
						completion_note  = COALESCE(${completion_note}, completion_note),
						completed_at     = COALESCE(${completed_at}, completed_at),
						updated_at       = NOW()
					WHERE id = ${id}
					  AND (tenant_id = ${this.tenant} OR assigned_tenant = ${this.tenant})
					RETURNING *
				`
				: await this.sql`
					UPDATE tasks SET
						title            = COALESCE(${title}, title),
						description      = COALESCE(${description}, description),
						status           = COALESCE(${status}, status),
						priority         = COALESCE(${priority}, priority),
						estimated_effort = COALESCE(${estimated_effort}, estimated_effort),
						scheduled_wake   = COALESCE(${scheduled_wake}, scheduled_wake),
						completion_note  = COALESCE(${completion_note}, completion_note),
						completed_at     = COALESCE(${completed_at}, completed_at),
						updated_at       = NOW()
					WHERE id = ${id}
					  AND tenant_id = ${this.tenant}
					RETURNING *
				`;
			if (!rows.length) throw new Error("Task not found");
			return this._rowToTask(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("updateTask failed:", err instanceof Error ? err.message : "unknown error");
			if (err instanceof Error && ["Task not found", "No fields to update"].includes(err.message)) {
				throw err;
			}
			throw new Error("Failed to update task");
		}
	}

	async getTask(id: string, includeAssigned?: boolean): Promise<Task | null> {
		try {
			const rows = includeAssigned
				? await this.sql`
					SELECT * FROM tasks
					WHERE id = ${id}
					  AND (tenant_id = ${this.tenant} OR assigned_tenant = ${this.tenant})
					LIMIT 1
				`
				: await this.sql`
					SELECT * FROM tasks
					WHERE id = ${id}
					  AND tenant_id = ${this.tenant}
					LIMIT 1
				`;
			if (!rows.length) return null;
			return this._rowToTask(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("getTask failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async createCapturedSkillArtifact(artifact: CapturedSkillArtifactCreate): Promise<CapturedSkillArtifact> {
		try {
			const rows = await this.sql`
				WITH next_version AS (
					SELECT COALESCE(MAX(version), 0) + 1 AS version
					FROM captured_skills
					WHERE tenant_id = ${this.tenant}
					  AND skill_key = ${artifact.skill_key}
				)
				INSERT INTO captured_skills (
					id, tenant_id, skill_key, version, layer, status, name, domain, environment,
					task_type, agent_tenant, source_runtime_run_id, source_task_id, source_observation_id,
					provenance, metadata
				)
				SELECT
					${generateId("skill")},
					${this.tenant},
					${artifact.skill_key},
					next_version.version,
					${artifact.layer ?? "captured"},
					${artifact.status ?? "candidate"},
					${artifact.name},
					${artifact.domain ?? null},
					${artifact.environment ?? null},
					${artifact.task_type ?? null},
					${artifact.agent_tenant ?? null},
					${artifact.source_runtime_run_id ?? null},
					${artifact.source_task_id ?? null},
					${artifact.source_observation_id ?? null},
					${this.sql.json((artifact.provenance ?? {}) as any)},
					${this.sql.json((artifact.metadata ?? {}) as any)}
				FROM next_version
				RETURNING *
			`;
			if (!rows.length) throw new Error("Failed to create captured skill artifact");
			return rowToCapturedSkillArtifact(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createCapturedSkillArtifact failed:", artifact.skill_key, err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create captured skill artifact");
		}
	}

	async getCapturedSkillArtifact(id: string): Promise<CapturedSkillArtifact | null> {
		try {
			const rows = await this.sql`
				SELECT *
				FROM captured_skills
				WHERE tenant_id = ${this.tenant}
				  AND id = ${id}
				LIMIT 1
			`;
			if (!rows.length) return null;
			return rowToCapturedSkillArtifact(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("getCapturedSkillArtifact failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async listCapturedSkillArtifacts(filter?: CapturedSkillArtifactFilter): Promise<CapturedSkillArtifact[]> {
		const cap = Math.min(filter?.limit ?? 20, 200);
		const status = filter?.status ?? null;
		const layer = filter?.layer ?? null;
		const agentTenant = filter?.agent_tenant ?? null;
		const taskType = filter?.task_type ?? null;
		try {
			const rows = await this.sql`
				SELECT *
				FROM captured_skills
				WHERE tenant_id = ${this.tenant}
				  AND (${status}::text IS NULL OR status = ${status})
				  AND (${layer}::text IS NULL OR layer = ${layer})
				  AND (${agentTenant}::text IS NULL OR agent_tenant = ${agentTenant})
				  AND (${taskType}::text IS NULL OR task_type = ${taskType})
				ORDER BY created_at DESC
				LIMIT ${cap}
			`;
			return rows.map(row => rowToCapturedSkillArtifact(row as Record<string, unknown>));
		} catch (err) {
			console.error("listCapturedSkillArtifacts failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async reviewCapturedSkillArtifact(
		id: string,
		status: CapturedSkillArtifact["status"],
		reviewedBy?: string,
		reviewNote?: string
	): Promise<CapturedSkillArtifact> {
		try {
			const rows = await this.sql`
				UPDATE captured_skills
				SET status = ${status},
				    reviewed_by = ${reviewedBy ?? null},
				    review_note = ${reviewNote ?? null},
				    reviewed_at = NOW(),
				    updated_at = NOW()
				WHERE tenant_id = ${this.tenant}
				  AND id = ${id}
				RETURNING *
			`;
			if (!rows.length) throw new Error("Captured skill artifact not found");
			return rowToCapturedSkillArtifact(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("reviewCapturedSkillArtifact failed:", err instanceof Error ? err.message : "unknown error");
			if (err instanceof Error && err.message === "Captured skill artifact not found") {
				throw err;
			}
			throw new Error("Failed to review captured skill artifact");
		}
	}

	async getCapturedSkillRegistryHealth(): Promise<CapturedSkillRegistryHealth> {
		try {
			const rows = await this.sql`
				SELECT
					COUNT(*)::int AS total,
					COUNT(*) FILTER (WHERE status = 'candidate')::int AS candidate_count,
					COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_count,
					COUNT(*) FILTER (WHERE status = 'degraded')::int AS degraded_count,
					COUNT(*) FILTER (WHERE status = 'retired')::int AS retired_count,
					COUNT(*) FILTER (WHERE layer = 'fixed')::int AS fixed_count,
					COUNT(*) FILTER (WHERE layer = 'captured')::int AS captured_count,
					COUNT(*) FILTER (WHERE layer = 'derived')::int AS derived_count,
					COUNT(*) FILTER (WHERE source_runtime_run_id IS NOT NULL)::int AS with_runtime_provenance,
					COUNT(*) FILTER (WHERE source_task_id IS NOT NULL)::int AS with_task_provenance,
					COUNT(*) FILTER (WHERE source_observation_id IS NOT NULL)::int AS with_observation_provenance
				FROM captured_skills
				WHERE tenant_id = ${this.tenant}
			`;
			const row = rows[0] as Record<string, unknown> | undefined;
			const candidateCount = (row?.candidate_count as number) ?? 0;
			return {
				total: (row?.total as number) ?? 0,
				by_status: {
					candidate: candidateCount,
					accepted: (row?.accepted_count as number) ?? 0,
					degraded: (row?.degraded_count as number) ?? 0,
					retired: (row?.retired_count as number) ?? 0
				},
				by_layer: {
					fixed: (row?.fixed_count as number) ?? 0,
					captured: (row?.captured_count as number) ?? 0,
					derived: (row?.derived_count as number) ?? 0
				},
				with_runtime_provenance: (row?.with_runtime_provenance as number) ?? 0,
				with_task_provenance: (row?.with_task_provenance as number) ?? 0,
				with_observation_provenance: (row?.with_observation_provenance as number) ?? 0,
				pending_review: candidateCount
			};
		} catch (err) {
			console.error("getCapturedSkillRegistryHealth failed:", err instanceof Error ? err.message : "unknown error");
			return {
				total: 0,
				by_status: {
					candidate: 0,
					accepted: 0,
					degraded: 0,
					retired: 0
				},
				by_layer: {
					fixed: 0,
					captured: 0,
					derived: 0
				},
				with_runtime_provenance: 0,
				with_task_provenance: 0,
				with_observation_provenance: 0,
				pending_review: 0
			};
		}
	}

	async upsertAgentRuntimeSession(
		session: Omit<AgentRuntimeSession, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>
	): Promise<AgentRuntimeSession> {
		try {
			const rows = await this.sql`
				INSERT INTO agent_runtime_sessions (
					id, tenant_id, agent_tenant, session_id, status, trigger_mode, source_task_id, metadata, last_resumed_at
				) VALUES (
					${generateId("runtime_session")},
					${this.tenant},
					${session.agent_tenant},
					${session.session_id},
					${session.status},
					${session.trigger_mode},
					${session.source_task_id ?? null},
					${this.sql.json((session.metadata ?? {}) as any)},
					${session.last_resumed_at ?? null}
				)
				ON CONFLICT (tenant_id, agent_tenant) DO UPDATE SET
					session_id      = EXCLUDED.session_id,
					status          = EXCLUDED.status,
					trigger_mode    = EXCLUDED.trigger_mode,
					source_task_id  = EXCLUDED.source_task_id,
					metadata        = EXCLUDED.metadata,
					last_resumed_at = EXCLUDED.last_resumed_at,
					updated_at      = NOW()
				RETURNING *
			`;
			if (!rows.length) throw new Error("Failed to upsert runtime session");
			return this._rowToAgentRuntimeSession(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("upsertAgentRuntimeSession failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to upsert runtime session");
		}
	}

	async getAgentRuntimeSession(agentTenant: string): Promise<AgentRuntimeSession | null> {
		try {
			const rows = await this.sql`
				SELECT *
				FROM agent_runtime_sessions
				WHERE tenant_id = ${this.tenant}
				  AND agent_tenant = ${agentTenant}
				LIMIT 1
			`;
			if (!rows.length) return null;
			return this._rowToAgentRuntimeSession(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("getAgentRuntimeSession failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async createAgentRuntimeRun(
		run: Omit<AgentRuntimeRun, 'id' | 'tenant_id' | 'created_at'>
	): Promise<AgentRuntimeRun> {
		try {
			const rows = await this.sql`
				INSERT INTO agent_runtime_runs (
					id, tenant_id, agent_tenant, session_id, trigger_mode, task_id, status,
					started_at, completed_at, next_wake_at, summary, error, metadata
				) VALUES (
					${generateId("runtime_run")},
					${this.tenant},
					${run.agent_tenant},
					${run.session_id ?? null},
					${run.trigger_mode},
					${run.task_id ?? null},
					${run.status},
					${run.started_at ?? null},
					${run.completed_at ?? null},
					${run.next_wake_at ?? null},
					${run.summary ?? null},
					${run.error ?? null},
					${this.sql.json((run.metadata ?? {}) as any)}
				)
				RETURNING *
			`;
			if (!rows.length) throw new Error("Failed to create runtime run");
			return this._rowToAgentRuntimeRun(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("createAgentRuntimeRun failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to create runtime run");
		}
	}

	async listAgentRuntimeRuns(agentTenant: string, limit?: number): Promise<AgentRuntimeRun[]> {
		const cap = Math.min(limit ?? 20, 100);
		try {
			const rows = await this.sql`
				SELECT *
				FROM agent_runtime_runs
				WHERE tenant_id = ${this.tenant}
				  AND agent_tenant = ${agentTenant}
				ORDER BY created_at DESC
				LIMIT ${cap}
			`;
			return rows.map(row => this._rowToAgentRuntimeRun(row as Record<string, unknown>));
		} catch (err) {
			console.error("listAgentRuntimeRuns failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async upsertAgentRuntimePolicy(
		policy: Omit<AgentRuntimePolicy, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>
	): Promise<AgentRuntimePolicy> {
		try {
			const rows = await this.sql`
				INSERT INTO agent_runtime_policies (
					id, tenant_id, agent_tenant, execution_mode, daily_wake_budget, impulse_wake_budget,
					reserve_wakes, min_impulse_interval_minutes, max_tool_calls_per_run, max_parallel_delegations,
					require_priority_clear_for_impulse, updated_by, metadata
				) VALUES (
					${generateId("runtime_policy")},
					${this.tenant},
					${policy.agent_tenant},
					${policy.execution_mode},
					${policy.daily_wake_budget},
					${policy.impulse_wake_budget},
					${policy.reserve_wakes},
					${policy.min_impulse_interval_minutes},
					${policy.max_tool_calls_per_run},
					${policy.max_parallel_delegations},
					${policy.require_priority_clear_for_impulse},
					${policy.updated_by ?? null},
					${this.sql.json((policy.metadata ?? {}) as any)}
				)
				ON CONFLICT (tenant_id, agent_tenant) DO UPDATE SET
					execution_mode                    = EXCLUDED.execution_mode,
					daily_wake_budget                 = EXCLUDED.daily_wake_budget,
					impulse_wake_budget               = EXCLUDED.impulse_wake_budget,
					reserve_wakes                     = EXCLUDED.reserve_wakes,
					min_impulse_interval_minutes      = EXCLUDED.min_impulse_interval_minutes,
					max_tool_calls_per_run            = EXCLUDED.max_tool_calls_per_run,
					max_parallel_delegations          = EXCLUDED.max_parallel_delegations,
					require_priority_clear_for_impulse = EXCLUDED.require_priority_clear_for_impulse,
					updated_by                        = EXCLUDED.updated_by,
					metadata                          = EXCLUDED.metadata,
					updated_at                        = NOW()
				RETURNING *
			`;
			if (!rows.length) throw new Error("Failed to upsert runtime policy");
			return this._rowToAgentRuntimePolicy(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("upsertAgentRuntimePolicy failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to upsert runtime policy");
		}
	}

	async getAgentRuntimePolicy(agentTenant: string): Promise<AgentRuntimePolicy | null> {
		try {
			const rows = await this.sql`
				SELECT *
				FROM agent_runtime_policies
				WHERE tenant_id = ${this.tenant}
				  AND agent_tenant = ${agentTenant}
				LIMIT 1
			`;
			if (!rows.length) return null;
			return this._rowToAgentRuntimePolicy(rows[0] as Record<string, unknown>);
		} catch (err) {
			console.error("getAgentRuntimePolicy failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async getAgentRuntimeUsage(agentTenant: string, since: string): Promise<AgentRuntimeUsage> {
		try {
			const rows = await this.sql`
				SELECT
					COUNT(*)::int AS total_runs,
					COUNT(*) FILTER (
						WHERE COALESCE(metadata->>'wake_kind', 'duty') = 'duty'
					)::int AS duty_runs,
					COUNT(*) FILTER (
						WHERE COALESCE(metadata->>'wake_kind', 'duty') = 'impulse'
					)::int AS impulse_runs,
					MAX(created_at) AS last_run_at,
					MAX(created_at) FILTER (
						WHERE COALESCE(metadata->>'wake_kind', 'duty') = 'impulse'
					) AS last_impulse_run_at
				FROM agent_runtime_runs
				WHERE tenant_id = ${this.tenant}
				  AND agent_tenant = ${agentTenant}
				  AND created_at >= ${since}::timestamptz
			`;
			const row = rows[0] as Record<string, unknown> | undefined;
			return {
				agent_tenant: agentTenant,
				since,
				total_runs: (row?.total_runs as number) ?? 0,
				duty_runs: (row?.duty_runs as number) ?? 0,
				impulse_runs: (row?.impulse_runs as number) ?? 0,
				last_run_at: toISOString(row?.last_run_at),
				last_impulse_run_at: toISOString(row?.last_impulse_run_at)
			};
		} catch (err) {
			console.error("getAgentRuntimeUsage failed:", err instanceof Error ? err.message : "unknown error");
			return {
				agent_tenant: agentTenant,
				since,
				total_runs: 0,
				duty_runs: 0,
				impulse_runs: 0
			};
		}
	}

	// ============ ROW MAPPERS (Sprint 4) ============

	private _rowToProposal(row: Record<string, unknown>): DaemonProposal {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			proposal_type: row.proposal_type as DaemonProposal['proposal_type'],
			source_id: row.source_id as string,
			target_id: row.target_id as string,
			similarity: row.similarity as number | undefined,
			resonance_type: row.resonance_type as string | undefined,
			confidence: row.confidence as number,
			rationale: row.rationale as string | undefined,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			status: row.status as 'pending' | 'accepted' | 'rejected',
			feedback_note: row.feedback_note as string | undefined,
			proposed_at: toISOString(row.proposed_at) || new Date().toISOString(),
			reviewed_at: toISOString(row.reviewed_at)
		};
	}

	private _rowToOrphan(row: Record<string, unknown>): OrphanObservation {
		return {
			observation_id: row.observation_id as string,
			tenant_id: row.tenant_id as string,
			first_marked: toISOString(row.first_marked) || new Date().toISOString(),
			rescue_attempts: (row.rescue_attempts as number) ?? 0,
			last_rescue_attempt: toISOString(row.last_rescue_attempt),
			status: row.status as 'orphaned' | 'rescued' | 'archived'
		};
	}

	private _rowToVersion(row: Record<string, unknown>): ObservationVersion {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			observation_id: row.observation_id as string,
			version_num: row.version_num as number,
			content: row.content as string,
			texture: parseJsonRecord(row.texture) as unknown as ObservationVersion["texture"],
			change_reason: row.change_reason as string | undefined,
			created_at: toISOString(row.created_at) || new Date().toISOString()
		};
	}

	private _rowToProcessingEntry(row: Record<string, unknown>): ProcessingEntry {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			observation_id: row.observation_id as string,
			processing_note: row.processing_note as string | undefined,
			charge_at_processing: (row.charge_at_processing as string[] | null) ?? [],
			somatic_at_processing: row.somatic_at_processing as string | undefined,
			created_at: toISOString(row.created_at) || new Date().toISOString()
		};
	}

	private _rowToConsolidationCandidate(row: Record<string, unknown>): ConsolidationCandidate {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			source_observation_ids: (row.source_observation_ids as string[] | null) ?? [],
			pattern_description: row.pattern_description as string,
			suggested_territory: row.suggested_territory as string | undefined,
			suggested_type: row.suggested_type as 'skill' | 'identity' | 'synthesis',
			status: row.status as 'pending' | 'accepted' | 'rejected' | 'deferred',
			created_at: toISOString(row.created_at) || new Date().toISOString(),
			reviewed_at: toISOString(row.reviewed_at)
		};
	}

	private _rowToDispatchFeedback(row: Record<string, unknown>): DispatchFeedback {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			agent_entity_id: row.agent_entity_id as string | undefined,
			task_type: row.task_type as string,
			domain: row.domain as string | undefined,
			environment: row.environment as string | undefined,
			session_id: row.session_id as string | undefined,
			dispatched_at: toISOString(row.dispatched_at) || new Date().toISOString(),
			outcome: row.outcome as DispatchFeedback["outcome"],
			findings_count: (row.findings_count as number) ?? 0,
			findings_acted: (row.findings_acted as number) ?? 0,
			confidence_avg: row.confidence_avg as number | undefined,
			predicted_confidence: row.predicted_confidence as number | undefined,
			outcome_score: row.outcome_score as number | undefined,
			revision_cost: row.revision_cost as number | undefined,
			needed_rescue: row.needed_rescue as boolean | undefined,
			rescue_agent_id: row.rescue_agent_id as string | undefined,
			time_to_usable_ms: row.time_to_usable_ms as number | undefined,
			notes: row.notes as string | undefined,
			reviewed_at: toISOString(row.reviewed_at)
		};
	}

	private _rowToTask(row: Record<string, unknown>): Task {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			assigned_tenant: row.assigned_tenant as string | undefined,
			title: row.title as string,
			description: row.description as string | undefined,
			status: row.status as Task["status"],
			priority: row.priority as Task["priority"],
			estimated_effort: row.estimated_effort as string | undefined,
			scheduled_wake: toISOString(row.scheduled_wake),
			source: row.source as string | undefined,
			linked_observation_ids: (row.linked_observation_ids as string[] | null) ?? [],
			linked_entity_ids: (row.linked_entity_ids as string[] | null) ?? [],
			depends_on: (row.depends_on as string[] | null) ?? undefined,
			completion_note: row.completion_note as string | undefined,
			created_at: toISOString(row.created_at) || new Date().toISOString(),
			updated_at: toISOString(row.updated_at) || new Date().toISOString(),
			completed_at: toISOString(row.completed_at)
		};
	}

	private _rowToAgentRuntimeSession(row: Record<string, unknown>): AgentRuntimeSession {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			agent_tenant: row.agent_tenant as string,
			session_id: row.session_id as string,
			status: row.status as AgentRuntimeSession["status"],
			trigger_mode: row.trigger_mode as AgentRuntimeSession["trigger_mode"],
			source_task_id: row.source_task_id as string | undefined,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			last_resumed_at: toISOString(row.last_resumed_at),
			created_at: toISOString(row.created_at) || new Date().toISOString(),
			updated_at: toISOString(row.updated_at) || new Date().toISOString()
		};
	}

	private _rowToAgentRuntimeRun(row: Record<string, unknown>): AgentRuntimeRun {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			agent_tenant: row.agent_tenant as string,
			session_id: row.session_id as string | undefined,
			trigger_mode: row.trigger_mode as AgentRuntimeRun["trigger_mode"],
			task_id: row.task_id as string | undefined,
			status: row.status as AgentRuntimeRun["status"],
			started_at: toISOString(row.started_at),
			completed_at: toISOString(row.completed_at),
			next_wake_at: toISOString(row.next_wake_at),
			summary: row.summary as string | undefined,
			error: row.error as string | undefined,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			created_at: toISOString(row.created_at) || new Date().toISOString()
		};
	}

	private _rowToAgentRuntimePolicy(row: Record<string, unknown>): AgentRuntimePolicy {
		return {
			id: row.id as string,
			tenant_id: row.tenant_id as string,
			agent_tenant: row.agent_tenant as string,
			execution_mode: row.execution_mode as AgentRuntimePolicy["execution_mode"],
			daily_wake_budget: (row.daily_wake_budget as number) ?? 0,
			impulse_wake_budget: (row.impulse_wake_budget as number) ?? 0,
			reserve_wakes: (row.reserve_wakes as number) ?? 0,
			min_impulse_interval_minutes: (row.min_impulse_interval_minutes as number) ?? 0,
			max_tool_calls_per_run: (row.max_tool_calls_per_run as number) ?? 0,
			max_parallel_delegations: (row.max_parallel_delegations as number) ?? 0,
			require_priority_clear_for_impulse: (row.require_priority_clear_for_impulse as boolean) ?? true,
			updated_by: row.updated_by as string | undefined,
			metadata: (row.metadata as Record<string, unknown>) ?? {},
			created_at: toISOString(row.created_at) || new Date().toISOString(),
			updated_at: toISOString(row.updated_at) || new Date().toISOString()
		};
	}
}

// ============ FACTORY HELPER ============

export function createPostgresStorage(databaseUrl: string, tenant: string): PostgresBrainStorage {
	return new PostgresBrainStorage(databaseUrl, tenant);
}
