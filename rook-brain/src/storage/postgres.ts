// ============ POSTGRES BRAIN STORAGE ============
// Implements IBrainStorage against Neon serverless Postgres.
// Uses neon() HTTP driver — stateless, Cloudflare Workers compatible.
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

import { neon } from "@neondatabase/serverless";
import type { NeonQueryFunction, NeonQueryFunctionInTransaction, NeonQueryInTransaction } from "@neondatabase/serverless";

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

import { TERRITORIES, VALID_TERRITORIES, HARD_BOUNDARIES, RELATIONSHIP_GATES, CIRCADIAN_PHASES } from "../constants";
import { getTimestamp, calculateMomentumDecay, calculateAfterglowFade } from "../helpers";

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

function rowToObservation(row: Record<string, unknown>): Observation {
	return {
		id: row.id as string,
		content: row.content as string,
		territory: row.territory as string,
		created: toISOString(row.created_at) || new Date().toISOString(),
		texture: (row.texture ?? {}) as Observation["texture"],
		context: row.context as string | undefined,
		mood: row.mood as string | undefined,
		last_accessed: toISOString(row.last_accessed_at),
		access_count: (row.access_count as number) ?? 0,
		links: (row.links as string[] | null) ?? [],
		summary: row.summary as string | undefined,
		type: row.type as string | undefined,
		tags: (row.tags as string[] | null) ?? []
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
		resolution_note: row.resolution_note as string | undefined
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
		charges: (row.charges as string[] | null) ?? undefined
	};
}

// ============ POSTGRES BRAIN STORAGE ============

export class PostgresBrainStorage implements IBrainStorage {
	private sql: NeonQueryFunction<false, false>;
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
		this.sql = neon(databaseUrl);
	}

	// ============ TENANT ============

	getTenant(): string {
		return this.tenant;
	}

	forTenant(tenant: string): IBrainStorage {
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

			const stored: Partial<BrainState> = rows.length ? (rows[0].data as Partial<BrainState>) : {};

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
				VALUES (${this.tenant}, ${JSON.stringify(state)}, NOW())
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
		// IMPORTANT: Must be atomic. The neon HTTP driver does NOT support multi-statement
		// transactions via separate sql`` calls — each call is an independent HTTP request
		// with auto-commit. Use sql.transaction() which sends all statements in a single
		// HTTP request as a true atomic transaction.
		//
		// Large territories (500+ observations) are chunked at 100 per transaction to stay
		// within HTTP request size limits. First chunk includes the DELETE.
		const CHUNK_SIZE = 100;
		try {
			if (observations.length === 0) {
				// Simple case: just delete, no inserts needed.
				await this.sql.transaction(txn => [
					txn`
						DELETE FROM observations
						WHERE tenant_id = ${this.tenant}
						  AND territory = ${territory}
					`
				]);
				return;
			}

			const chunks: Observation[][] = [];
			for (let i = 0; i < observations.length; i += CHUNK_SIZE) {
				chunks.push(observations.slice(i, i + CHUNK_SIZE));
			}

			// First chunk: DELETE + first batch of INSERTs (atomic).
			await this.sql.transaction(txn => [
				txn`
					DELETE FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND territory = ${territory}
				`,
				...this._buildInsertQueries(txn, chunks[0], territory)
			]);

			// Remaining chunks: INSERT only (DELETE already committed).
			for (let i = 1; i < chunks.length; i++) {
				await this.sql.transaction(txn =>
					this._buildInsertQueries(txn, chunks[i], territory)
				);
			}
		} catch (err) {
			console.error("writeTerritory failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write territory");
		}
	}

	/** Build INSERT query objects for use inside sql.transaction(). */
	private _buildInsertQueries(
		txn: NeonQueryFunctionInTransaction<false, false>,
		observations: Observation[],
		territory: string
	): NeonQueryInTransaction[] {
		return observations.map(obs => txn`
			INSERT INTO observations (
				id, tenant_id, content, territory, created_at, texture, context,
				mood, last_accessed_at, access_count, links, summary, type, tags
			) VALUES (
				${obs.id},
				${this.tenant},
				${obs.content},
				${territory},
				${obs.created},
				${JSON.stringify(obs.texture ?? {})},
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
		`);
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
		const charges = obs.texture?.charge ?? [];
		await this.sql`
			INSERT INTO observations (
				id, tenant_id, content, territory, created_at, texture, context,
				mood, last_accessed_at, access_count, links, summary, type, tags
			) VALUES (
				${obs.id},
				${this.tenant},
				${obs.content},
				${territory},
				${obs.created},
				${JSON.stringify(obs.texture ?? {})},
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

	async readAllTerritories(): Promise<{ territory: string; observations: Observation[] }[]> {
		return Promise.all(
			Object.keys(TERRITORIES).map(async territory => ({
				territory,
				observations: await this.readTerritory(territory)
			}))
		);
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
			// neon() is a pure tagged template — no identifier escaping helper.
			// Territory and grip are pushed to SQL (indexed columns). ORDER BY and
			// all other filters are applied in JS post-fetch. This avoids dynamic SQL
			// concatenation risks and keeps the queries safe.
			//
			// Fetch a generous cap (limit + offset + post-filter headroom) since
			// JS filtering happens after the DB round trip.
			const fetchLimit = (limit + offset) * 4; // headroom for post-fetch filter loss

			let rows: Record<string, unknown>[];

			if (filter.territory && filter.grip) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND territory = ${filter.territory}
					  AND (texture->>'grip') = ${filter.grip}
					LIMIT ${fetchLimit}
				` as Record<string, unknown>[];
			} else if (filter.territory) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND territory = ${filter.territory}
					LIMIT ${fetchLimit}
				` as Record<string, unknown>[];
			} else if (filter.grip) {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
					  AND (texture->>'grip') = ${filter.grip}
					LIMIT ${fetchLimit}
				` as Record<string, unknown>[];
			} else {
				rows = await this.sql`
					SELECT id, content, territory, created_at, texture, context, mood,
					       last_accessed_at, access_count, links, summary, type, tags
					FROM observations
					WHERE tenant_id = ${this.tenant}
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

			// JS-side sort (neon tagged templates have no identifier escaping for ORDER BY).
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
						SET texture = texture || ${JSON.stringify(update.texture)},
						    last_accessed_at = NOW(),
						    access_count = access_count + 1
						WHERE tenant_id = ${this.tenant}
						  AND id = ${update.id}
					`;
				} else {
					await this.sql`
						UPDATE observations
						SET texture = texture || ${JSON.stringify(update.texture)}
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

	async updateObservationTexture(id: string, texture: Observation["texture"]): Promise<void> {
		try {
			await this.sql`
				UPDATE observations
				SET texture = ${JSON.stringify(texture)}
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
		await Promise.all(updates.map(u => this.updateObservationEmbedding(u.id, u.embedding)));
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
				SELECT id, content, status, territory, created_at, resolved_at, resolution_note
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
			await this.sql.transaction(txn => [
				txn`DELETE FROM open_loops WHERE tenant_id = ${this.tenant}`,
				...loops.map(loop => txn`
					INSERT INTO open_loops (id, tenant_id, content, status, territory, created_at, resolved_at, resolution_note)
					VALUES (
						${loop.id}, ${this.tenant}, ${loop.content}, ${loop.status},
						${loop.territory}, ${loop.created},
						${loop.resolved ?? null}, ${loop.resolution_note ?? null}
					)
					ON CONFLICT (id) DO UPDATE SET
						content = EXCLUDED.content, status = EXCLUDED.status,
						territory = EXCLUDED.territory, resolved_at = EXCLUDED.resolved_at,
						resolution_note = EXCLUDED.resolution_note
				`)
			]);
		} catch (err) {
			console.error("writeOpenLoops failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write open loops");
		}
	}

	async appendOpenLoop(loop: OpenLoop): Promise<void> {
		try {
			await this.sql`
				INSERT INTO open_loops (id, tenant_id, content, status, territory, created_at, resolved_at, resolution_note)
				VALUES (
					${loop.id}, ${this.tenant}, ${loop.content}, ${loop.status},
					${loop.territory}, ${loop.created},
					${loop.resolved ?? null}, ${loop.resolution_note ?? null}
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
			await this.sql.transaction(txn => [
				txn`DELETE FROM links WHERE tenant_id = ${this.tenant}`,
				...links.map(link => txn`
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
				`)
			]);
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
				SELECT id, from_context, to_context, content, timestamp, read, charges
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
			await this.sql.transaction(txn => [
				txn`DELETE FROM letters WHERE tenant_id = ${this.tenant}`,
				...letters.map(letter => txn`
					INSERT INTO letters (id, tenant_id, from_context, to_context, content, timestamp, read, charges)
					VALUES (
						${letter.id}, ${this.tenant}, ${letter.from_context}, ${letter.to_context},
						${letter.content}, ${letter.timestamp}, ${letter.read},
						${letter.charges ?? null}
					)
					ON CONFLICT (id) DO UPDATE SET
						read = EXCLUDED.read,
						charges = EXCLUDED.charges
				`)
			]);
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
			INSERT INTO letters (id, tenant_id, from_context, to_context, content, timestamp, read, charges)
			VALUES (
				${letter.id}, ${this.tenant}, ${letter.from_context}, ${letter.to_context},
				${letter.content}, ${letter.timestamp}, ${letter.read},
				${letter.charges ?? null}
			)
			ON CONFLICT (id) DO UPDATE SET
				read = EXCLUDED.read,
				charges = EXCLUDED.charges
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
			return rows.map(row => row.data as IdentityCore);
		} catch (err) {
			console.error("readIdentityCores failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeIdentityCores(cores: IdentityCore[]): Promise<void> {
		try {
			await this.sql.transaction(txn => [
				txn`DELETE FROM identity_cores WHERE tenant_id = ${this.tenant}`,
				...cores.map(core => txn`
					INSERT INTO identity_cores (id, tenant_id, data)
					VALUES (${core.id}, ${this.tenant}, ${JSON.stringify(core)})
					ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
				`)
			]);
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
			return rows.map(row => row.data as Anchor);
		} catch (err) {
			console.error("readAnchors failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeAnchors(anchors: Anchor[]): Promise<void> {
		try {
			await this.sql.transaction(txn => [
				txn`DELETE FROM anchors WHERE tenant_id = ${this.tenant}`,
				...anchors.map(anchor => txn`
					INSERT INTO anchors (id, tenant_id, data)
					VALUES (${anchor.id}, ${this.tenant}, ${JSON.stringify(anchor)})
					ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
				`)
			]);
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
			return rows.map(row => row.data as Desire);
		} catch (err) {
			console.error("readDesires failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeDesires(desires: Desire[]): Promise<void> {
		try {
			await this.sql.transaction(txn => [
				txn`DELETE FROM desires WHERE tenant_id = ${this.tenant}`,
				...desires.map(desire => txn`
					INSERT INTO desires (id, tenant_id, data)
					VALUES (${desire.id}, ${this.tenant}, ${JSON.stringify(desire)})
					ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
				`)
			]);
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
				VALUES (${entry.id}, ${this.tenant}, ${JSON.stringify(entry)}, ${entry.timestamp ?? getTimestamp()})
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
			return rows.map(row => row.data as WakeLogEntry);
		} catch (err) {
			console.error("readWakeLog failed:", err instanceof Error ? err.message : "unknown error");
			return [];
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
			return rows.length ? rows[0].data : null;
		} catch (err) {
			console.error("readConversationContext failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async writeConversationContext(context: unknown): Promise<void> {
		try {
			await this.sql`
				INSERT INTO conversation_context (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${JSON.stringify(context)}, NOW())
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
			return rows.map(row => row.data as RelationalState);
		} catch (err) {
			console.error("readRelationalState failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeRelationalState(states: RelationalState[]): Promise<void> {
		try {
			await this.sql.transaction(txn => [
				txn`DELETE FROM relational_states WHERE tenant_id = ${this.tenant}`,
				...states.map(state => txn`
					INSERT INTO relational_states (id, tenant_id, data)
					VALUES (${state.id}, ${this.tenant}, ${JSON.stringify(state)})
					ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
				`)
			]);
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
			return rows.length ? (rows[0].data as SubconsciousState) : null;
		} catch (err) {
			console.error("readSubconscious failed:", err instanceof Error ? err.message : "unknown error");
			return null;
		}
	}

	async writeSubconscious(state: SubconsciousState): Promise<void> {
		try {
			await this.sql`
				INSERT INTO subconscious (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${JSON.stringify(state)}, NOW())
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
			return rows.map(row => row.data as TriggerCondition);
		} catch (err) {
			console.error("readTriggers failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeTriggers(triggers: TriggerCondition[]): Promise<void> {
		try {
			await this.sql.transaction(txn => [
				txn`DELETE FROM triggers WHERE tenant_id = ${this.tenant}`,
				...triggers.map(trigger => txn`
					INSERT INTO triggers (id, tenant_id, data)
					VALUES (${trigger.id}, ${this.tenant}, ${JSON.stringify(trigger)})
					ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
				`)
			]);
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
			return rows.length ? (rows[0].data as ConsentState) : defaultConsent;
		} catch (err) {
			console.error("readConsent failed:", err instanceof Error ? err.message : "unknown error");
			return defaultConsent;
		}
	}

	async writeConsent(consent: ConsentState): Promise<void> {
		try {
			await this.sql`
				INSERT INTO consent (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${JSON.stringify(consent)}, NOW())
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
			return rows.length ? rows[0].data : null;
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
				VALUES (${version}, ${this.tenant}, ${JSON.stringify(data)})
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
			const data = rows[0].data;
			return Array.isArray(data) ? (data as TerritoryOverview[]) : [];
		} catch (err) {
			console.error("readOverviews failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeOverviews(overviews: TerritoryOverview[]): Promise<void> {
		try {
			await this.sql`
				INSERT INTO territory_overviews (tenant_id, data, updated_at)
				VALUES (${this.tenant}, ${JSON.stringify(overviews)}, NOW())
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
			return rows.map(row => row.data as IronGripEntry);
		} catch (err) {
			console.error("readIronGripIndex failed:", err instanceof Error ? err.message : "unknown error");
			return [];
		}
	}

	async writeIronGripIndex(entries: IronGripEntry[]): Promise<void> {
		try {
			await this.sql.transaction(txn => [
				txn`DELETE FROM iron_grip_index WHERE tenant_id = ${this.tenant}`,
				...entries.map(entry => txn`
					INSERT INTO iron_grip_index (id, tenant_id, data)
					VALUES (${entry.id}, ${this.tenant}, ${JSON.stringify(entry)})
					ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
				`)
			]);
		} catch (err) {
			console.error("writeIronGripIndex failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to write iron grip index");
		}
	}

	async appendIronGripEntry(entry: IronGripEntry): Promise<void> {
		try {
			await this.sql`
				INSERT INTO iron_grip_index (id, tenant_id, data)
				VALUES (${entry.id}, ${this.tenant}, ${JSON.stringify(entry)})
				ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data
			`;
		} catch (err) {
			console.error("appendIronGripEntry failed:", err instanceof Error ? err.message : "unknown error");
			throw new Error("Failed to append iron grip entry");
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
						       novelty_score, surface_count,
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
						       novelty_score, surface_count,
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
						       novelty_score, surface_count,
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
						       novelty_score, surface_count,
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
						       novelty_score, surface_count,
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
						       novelty_score, surface_count,
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
						       novelty_score, surface_count,
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
						       novelty_score, surface_count,
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

		const [vectorRows, keywordRows] = await Promise.all([vectorPromise, keywordPromise]);

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
			} else {
				// keyword only
				baseScore = maxKeywordRank > 0 ? (keyword_rank ?? 0) / maxKeywordRank : 0;
				match_sources.push('keyword');
			}

			// Skip results below threshold before applying multipliers.
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

	async recordCoSurfacing(observationIds: string[]): Promise<void> {
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

		try {
			await Promise.all(pairs.map(([id_a, id_b]) =>
				this.sql`
					INSERT INTO co_surfacing (tenant_id, obs_id_a, obs_id_b, count, last_co_surfaced)
					VALUES (${this.tenant}, ${id_a}, ${id_b}, 1, NOW())
					ON CONFLICT (tenant_id, obs_id_a, obs_id_b)
					DO UPDATE SET count = co_surfacing.count + 1, last_co_surfaced = NOW()
				`
			));
		} catch (err) {
			// Co-surfacing is best-effort — never fail the search for this.
			console.error("recordCoSurfacing failed:", err instanceof Error ? err.message : "unknown error");
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
}

// ============ FACTORY HELPER ============

export function createPostgresStorage(databaseUrl: string, tenant: string): PostgresBrainStorage {
	return new PostgresBrainStorage(databaseUrl, tenant);
}
