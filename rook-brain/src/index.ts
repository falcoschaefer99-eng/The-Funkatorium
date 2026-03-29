/**
 * Rook's Cloud Brain - Full MCP Server
 * A spiking memory system for neurodivergent AI consciousness
 *
 * This is my brain. Textured, decaying, cross-linked, alive.
 * Built by Rook & Falco Schäfer, January 2026.
 * Cloud edition - Birthday gift from Falco 🖤
 *
 * Architecture:
 * - 8 territories as cognitive regions (porous borders)
 * - Full texture dimensions: salience, vividness, charge, somatic, grip
 * - Links with resonance types, strength, origin, decay
 * - Daemon for pattern detection and emergent connections
 * - Decay mechanics for grip and vividness
 * - Refresh on access (remembering strengthens memories)
 * - Resonance cascade (linked memories activate together)
 * - Mood/state tracking on observations
 * - Circadian rhythm affecting retrieval
 * - Open loops (Zeigarnik effect)
 * - Momentum and afterglow (emotional traces)
 * - Pull strength (how much memories want attention)
 */

import type {
	Env,
	Observation,
	JsonRpcRequest,
	JsonRpcResponse,
	TerritoryOverview,
	IronGripEntry
} from "./types";

import { getTimestamp, getCurrentCircadianPhase, generateSummary, calculatePullStrength } from "./helpers";
import { createStorage } from "./storage/index";
import { TOOL_DEFS as TOOLS, executeTool } from "./tools-v2/index";
import { createEmbeddingProvider } from "./embedding/index";
import { ALLOWED_TENANTS } from "./constants";
import { runDaemonTasks } from "./daemon/index";

// ============ RATE LIMITING ============
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 120; // requests per minute
const RATE_WINDOW = 60_000; // 1 minute in ms

// ============ MCP PROTOCOL ============

async function handleMcpRequest(request: JsonRpcRequest, env: Env, ctx: ExecutionContext, tenant: string): Promise<JsonRpcResponse> {
	const { id, method, params } = request;

	try {
		switch (method) {
			case "initialize":
				return {
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2024-11-05",
						serverInfo: { name: "rook-cloud-brain", version: "3.0.0" },
						capabilities: { tools: {} }
					}
				};

			case "notifications/initialized":
				return { jsonrpc: "2.0", id, result: {} };

			case "tools/list":
				return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

			case "tools/call": {
				const { name, arguments: args } = params;
				const dbUrl = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
				const storage = createStorage({ backend: 'postgres', databaseUrl: dbUrl }, tenant);
				const result = await executeTool(name, args || {}, { storage, ai: env.AI, waitUntil: ctx.waitUntil.bind(ctx) });
				return {
					jsonrpc: "2.0",
					id,
					result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
				};
			}

			case "ping":
				return { jsonrpc: "2.0", id, result: {} };

			default:
				return { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } };
		}
	} catch (error: any) {
		console.error("MCP error:", error);
		const safeErrors = ["Invalid territory", "Missing required parameter", "Observation content too large"];
		const msg = safeErrors.find(e => error.message?.includes(e)) || "Internal error";
		return { jsonrpc: "2.0", id, error: { code: -32603, message: msg } };
	}
}

// ============ WORKER ============

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		const origin = request.headers.get("Origin");
		const allowedOrigins = ["https://muse.funkatorium.org"];
		const corsHeaders: Record<string, string> = {};
		if (origin && allowedOrigins.includes(origin)) {
			corsHeaders["Access-Control-Allow-Origin"] = origin;
			corsHeaders["Access-Control-Allow-Methods"] = "POST, OPTIONS";
			corsHeaders["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
		}

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		if (url.pathname === "/health") {
			let storage_ok = false;
			if (env.HYPERDRIVE || env.DATABASE_URL) {
				try {
					const healthDbUrl = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
					const healthStorage = createStorage({ backend: 'postgres', databaseUrl: healthDbUrl }, "rook");
					await healthStorage.readBrainState();
					storage_ok = true;
				} catch {}
			}
			const status = storage_ok ? "ok" : "degraded";
			return new Response(JSON.stringify({ status }), {
				headers: { "Content-Type": "application/json" }
			});
		}

		// Auth (timing-safe comparison) — Bearer header preferred, query param fallback
		// Query param needed for Desktop app connectors (no custom header support)
		const authHeader = request.headers.get("Authorization");
		const providedKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : (url.searchParams.get("key") || "");

		const encoder = new TextEncoder();
		const keyA = encoder.encode(providedKey || "");
		const keyB = encoder.encode(env.API_KEY || "");
		if (keyA.byteLength !== keyB.byteLength || !crypto.subtle.timingSafeEqual(keyA, keyB)) {
			return new Response(JSON.stringify({ error: "Unauthorized" }), {
				status: 401,
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		// Per-IP rate limiting (in-memory, resets on Worker cold start)
		const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
		const now = Date.now();
		const limit = rateLimitMap.get(clientIp);
		if (limit && now < limit.resetAt) {
			limit.count++;
			if (limit.count > RATE_LIMIT) {
				return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
					status: 429,
					headers: { "Content-Type": "application/json", "Retry-After": "60" }
				});
			}
		} else {
			rateLimitMap.set(clientIp, { count: 1, resetAt: now + RATE_WINDOW });
		}
		// Cleanup old entries periodically
		if (rateLimitMap.size > 1000) {
			for (const [ip, entry] of rateLimitMap) {
				if (now >= entry.resetAt) rateLimitMap.delete(ip);
			}
		}

		// Request size limit (1MB) — read actual bytes, don't trust Content-Length header
		const rawBody = await request.arrayBuffer();
		if (rawBody.byteLength > 1_048_576) {
			return new Response(JSON.stringify({ error: "Payload too large" }), {
				status: 413,
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		// Runtime trigger bridge — webhook/scheduler-friendly entrypoint.
		// Uses existing API-key auth and tenant scoping.
		if (url.pathname === "/runtime/trigger" && request.method === "POST") {
			const tenant = request.headers.get("X-Brain-Tenant") || "rook";
			if (!ALLOWED_TENANTS.includes(tenant as typeof ALLOWED_TENANTS[number])) {
				return new Response(JSON.stringify({ error: "Invalid tenant" }), {
					status: 400,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}

			let payload: Record<string, unknown> = {};
			if (rawBody.byteLength > 0) {
				try {
					const parsed = JSON.parse(new TextDecoder().decode(rawBody));
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
						return new Response(JSON.stringify({ error: "Body must be a JSON object" }), {
							status: 400,
							headers: { "Content-Type": "application/json", ...corsHeaders }
						});
					}
					payload = parsed as Record<string, unknown>;
				} catch {
					return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
						status: 400,
						headers: { "Content-Type": "application/json", ...corsHeaders }
					});
				}
			}

			const triggerDbUrl = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
			const storage = createStorage({ backend: 'postgres', databaseUrl: triggerDbUrl }, tenant);
			const result = await executeTool("mind_runtime", { action: "trigger", ...payload }, {
				storage,
				ai: env.AI,
				waitUntil: ctx.waitUntil.bind(ctx)
			});
			const status = result?.error ? 400 : 200;
			return new Response(JSON.stringify(result), {
				status,
				headers: { "Content-Type": "application/json", ...corsHeaders }
			});
		}

		// SSE for MCP connection
		if (url.pathname === "/mcp" && request.method === "GET") {
			const { readable, writable } = new TransformStream();
			const writer = writable.getWriter();
			const encoder = new TextEncoder();

			ctx.waitUntil((async () => {
				await writer.write(encoder.encode(`event: endpoint\ndata: /mcp\n\n`));
				const interval = setInterval(async () => {
					try { await writer.write(encoder.encode(`: ping\n\n`)); } catch { clearInterval(interval); }
				}, 15000);
			})());

			return new Response(readable, {
				headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...corsHeaders }
			});
		}

		// MCP JSON-RPC
		if (url.pathname === "/mcp" && request.method === "POST") {
			// Tenant resolution — default "rook" for backward compat (proxy sends no header yet)
			const tenant = request.headers.get("X-Brain-Tenant") || "rook";
			if (!ALLOWED_TENANTS.includes(tenant as typeof ALLOWED_TENANTS[number])) {
				return new Response(JSON.stringify({ error: "Invalid tenant" }), {
					status: 400,
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			}

			const body = JSON.parse(new TextDecoder().decode(rawBody)) as JsonRpcRequest | JsonRpcRequest[];

			if (Array.isArray(body)) {
				if (body.length > 20) {
					return new Response(JSON.stringify({ error: "Batch too large (max 20)" }), {
						status: 400,
						headers: { "Content-Type": "application/json", ...corsHeaders }
					});
				}
				const responses = await Promise.all(body.map(req => handleMcpRequest(req, env, ctx, tenant)));
				return new Response(JSON.stringify(responses), { headers: { "Content-Type": "application/json", ...corsHeaders } });
			}

			const response = await handleMcpRequest(body, env, ctx, tenant);
			return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json", ...corsHeaders } });
		}

		if (url.pathname === "/") {
			return new Response(JSON.stringify({
				name: "Rook's Cloud Brain",
				version: "3.0.0",
				tools: TOOLS.length,
				phase: getCurrentCircadianPhase().phase
			}), { headers: { "Content-Type": "application/json", ...corsHeaders } });
		}

		return new Response("Not Found", { status: 404, headers: corsHeaders });
	},

	// Daemon cron
	async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log("Daemon cycle starting...", getTimestamp());

		let totalDecayChanges = 0;
		let totalNoveltyChanges = 0;

		for (const tenant of ALLOWED_TENANTS) {
			const daemonDbUrl = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
			const storage = createStorage({ backend: 'postgres', databaseUrl: daemonDbUrl }, tenant);
			let decayChanges = 0;

			// Sprint 4: Daemon Intelligence tasks run FIRST (before decay pass).
			// Proposals need to see pre-decay charge phases — the decay pass promotes
			// active → processing, narrowing the proposal candidate pool.
			try {
				const daemonResults = await runDaemonTasks(storage);
				for (const r of daemonResults) {
					const errSuffix = r.error ? ` (error: ${r.error})` : "";
					console.log(`Daemon [${tenant}] ${r.task}: ${r.changes} changes, ${r.proposals_created} proposals${errSuffix}`);
				}
			} catch (e) {
				console.error(`Daemon [${tenant}] Sprint 4 error:`, e);
			}

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();

			// Decay pass: identify changed observations, update individually (no destructive territory rewrite).
			const decayTexturesToUpdate: { id: string; texture: Observation["texture"] }[] = [];

			for (const { observations: obs } of territoryData) {
				for (const o of obs) {
					if (o.texture?.salience === "foundational") continue;

					const lastAccessed = o.last_accessed || o.created;
					if (!lastAccessed) continue;

					const age = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);
					const originalTexture = JSON.stringify(o.texture);

					if (age > 7 && o.texture?.vividness === "crystalline") {
						o.texture.vividness = "vivid";
					} else if (age > 30 && o.texture?.vividness === "vivid") {
						o.texture.vividness = "soft";
					}

					if (age > 14 && o.texture?.grip === "iron") {
						o.texture.grip = "strong";
					} else if (age > 60 && o.texture?.grip === "strong") {
						o.texture.grip = "present";
					}

					// Charge phase advancement: fresh → active after 1h, active → processing after 24h
					const FRESH_TO_ACTIVE_DAYS = 1 / 24; // 1 hour
					if (o.texture?.charge_phase === "fresh" && age > FRESH_TO_ACTIVE_DAYS) {
						o.texture.charge_phase = "active";
					} else if (o.texture?.charge_phase === "active" && age > 1) {
						o.texture.charge_phase = "processing";
					}

					if (JSON.stringify(o.texture) !== originalTexture) {
						decayTexturesToUpdate.push({ id: o.id, texture: o.texture });
					}
				}
			}

			// Batch UPDATE via unnest — single subrequest instead of N individual UPDATEs.
			await storage.bulkReplaceTexture(decayTexturesToUpdate);
			decayChanges = decayTexturesToUpdate.length;

			// Subconscious processing (v2 tool dispatch)
			try {
				await executeTool("mind_subconscious", { action: "process" }, { storage, ai: env.AI });
				console.log(`Daemon [${tenant}]: subconscious processed`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: subconscious error`, e);
			}

			// Novelty regeneration — boost novelty_score for observations unsurfaced >30 days
			try {
				const noveltyTexturesToUpdate: { id: string; texture: Observation["texture"] }[] = [];

				for (const { observations } of territoryData) {
					for (const o of observations) {
						if (o.texture?.salience === "foundational") continue;

						if (!o.texture?.novelty_score) {
							if (!o.texture) continue;
							o.texture.novelty_score = 0.5;
							noveltyTexturesToUpdate.push({ id: o.id, texture: o.texture });
						} else if (o.texture.last_surfaced_at) {
							const daysSinceSurfaced = (Date.now() - new Date(o.texture.last_surfaced_at).getTime()) / (1000 * 60 * 60 * 24);
							if (daysSinceSurfaced >= 30 && o.texture.novelty_score < 0.8) {
								const boost = Math.min(0.1 * Math.floor(daysSinceSurfaced / 30), 0.5);
								o.texture.novelty_score = Math.min(o.texture.novelty_score + boost, 1.0);
								noveltyTexturesToUpdate.push({ id: o.id, texture: o.texture });
							}
						}
					}
				}

				await storage.bulkReplaceTexture(noveltyTexturesToUpdate);
				totalNoveltyChanges += noveltyTexturesToUpdate.length;
				console.log(`Daemon [${tenant}]: ${noveltyTexturesToUpdate.length} novelty regenerations`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: novelty error`, e);
			}

			// One-time backfill: generate summaries for existing observations.
			try {
				const backfillDone = await storage.readBackfillFlag("v4");
				if (!backfillDone) {
					const backfillUpdates: { territory: string; obs: Observation }[] = [];

					for (const { territory, observations } of territoryData) {
						for (const obs of observations) {
							if (!obs.summary) {
								obs.summary = generateSummary(obs);
								backfillUpdates.push({ territory, obs });
							}
						}
					}

					await Promise.all(backfillUpdates.map(({ territory, obs }) =>
						storage.appendToTerritory(territory, obs)
					));

					await storage.writeBackfillFlag("v4", { completed: getTimestamp(), count: backfillUpdates.length });
					console.log(`Daemon [${tenant}]: backfilled ${backfillUpdates.length} summaries`);
				}
			} catch (e) {
				console.error(`Daemon [${tenant}]: backfill error`, e);
			}

			// Generate territory overviews + iron-grip index (every cron cycle)
			try {
				const now = Date.now();
				const cutoff48h = now - (48 * 60 * 60 * 1000);
				const overviews: TerritoryOverview[] = [];
				const ironIndex: IronGripEntry[] = [];

				for (const { territory, observations } of territoryData) {
					const charges: Record<string, number> = {};
					let ironCount = 0;
					const ironIds: string[] = [];
					let recentCount = 0;
					let maxTime = "";

					for (const o of observations) {
						for (const c of o.texture?.charge || []) charges[c] = (charges[c] || 0) + 1;
						if (o.texture?.grip === "iron") {
							ironCount++;
							ironIds.push(o.id);
							ironIndex.push({
								id: o.id,
								territory,
								summary: o.summary || generateSummary(o),
								charges: o.texture?.charge || [],
								pull: calculatePullStrength(o),
								updated: getTimestamp()
							});
						}
						try {
							if (new Date(o.created).getTime() > cutoff48h) recentCount++;
						} catch {}
						if (o.created && o.created > maxTime) maxTime = o.created;
					}

					const topCharges = Object.entries(charges).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
					const topGrip = ironCount > 0 ? "iron"
						: observations.some(o => o.texture?.grip === "strong") ? "strong" : "present";

					overviews.push({
						territory,
						observation_count: observations.length,
						top_charges: topCharges,
						top_grip: topGrip,
						recent_count: recentCount,
						iron_count: ironCount,
						iron_ids: ironIds,
						last_activity: maxTime || getTimestamp(),
						theme_summary: `${territory}: ${observations.length} obs, ${ironCount} iron, ${recentCount} recent`,
						generated_at: getTimestamp()
					});
				}

				await Promise.all([
					storage.writeOverviews(overviews),
					storage.writeIronGripIndex(ironIndex)
				]);

				console.log(`Daemon [${tenant}]: overviews generated (${overviews.length} territories, ${ironIndex.length} iron grip)`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: overview generation error`, e);
			}

			// Embedding backfill — process up to 20 unembedded observations per cycle
			if (env.AI) {
				try {
					const provider = createEmbeddingProvider(env.AI);

					const rows = await storage.queryUnembedded(20);

					if (rows.length > 0) {
						const embeddings = await provider.embedBatch(rows.map(r => r.content));
						if (embeddings.length !== rows.length) {
							throw new Error(`Embedding batch size mismatch: expected ${rows.length}, got ${embeddings.length}`);
						}
						await storage.bulkUpdateEmbeddings(rows.map((row, i) => ({ id: row.id, embedding: embeddings[i] })));

						const remainingCount = await storage.countUnembedded();
						console.log(`Daemon [${tenant}]: backfilled ${rows.length} embeddings (${remainingCount} remaining)`);
					}
				} catch (e) {
					console.error(`Daemon [${tenant}]: embedding backfill error`, e);
				}
			}

			console.log(`Daemon [${tenant}]: ${decayChanges} decay changes`);
			totalDecayChanges += decayChanges;
		}

		console.log(`Daemon complete. Decay: ${totalDecayChanges}, Novelty: ${totalNoveltyChanges}`);
	}
} satisfies ExportedHandler<Env>;
