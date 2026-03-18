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
	JsonRpcResponse
} from "./types";

import { getTimestamp, getCurrentCircadianPhase } from "./helpers";
import { BrainStorage } from "./storage";
import { TOOLS, executeTool } from "./tools/index";
import { ALLOWED_TENANTS } from "./constants";
import { processSubconscious, processNoveltyRegeneration } from "./tools/subconscious";

// ============ RATE LIMITING ============
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 120; // requests per minute
const RATE_WINDOW = 60_000; // 1 minute in ms

// ============ MCP PROTOCOL ============

async function handleMcpRequest(request: JsonRpcRequest, env: Env, tenant: string): Promise<JsonRpcResponse> {
	const { id, method, params } = request;

	try {
		switch (method) {
			case "initialize":
				return {
					jsonrpc: "2.0",
					id,
					result: {
						protocolVersion: "2024-11-05",
						serverInfo: { name: "rook-cloud-brain", version: "2.4.0" },
						capabilities: { tools: {} }
					}
				};

			case "notifications/initialized":
				return { jsonrpc: "2.0", id, result: {} };

			case "tools/list":
				return { jsonrpc: "2.0", id, result: { tools: TOOLS } };

			case "tools/call": {
				const { name, arguments: args } = params;
				const storage = new BrainStorage(env.BRAIN_STORAGE, tenant);
				const result = await executeTool(name, args || {}, storage);
				return {
					jsonrpc: "2.0",
					id,
					result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
				};
			}

			case "ping":
				return { jsonrpc: "2.0", id, result: {} };

			default:
				return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
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
			if (env.BRAIN_STORAGE) {
				try {
					// Health probe uses BrainStorage to test tenant-scoped path (post-migration).
					const healthStorage = new BrainStorage(env.BRAIN_STORAGE, "rook");
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
				const responses = await Promise.all(body.map(req => handleMcpRequest(req, env, tenant)));
				return new Response(JSON.stringify(responses), { headers: { "Content-Type": "application/json", ...corsHeaders } });
			}

			const response = await handleMcpRequest(body, env, tenant);
			return new Response(JSON.stringify(response), { headers: { "Content-Type": "application/json", ...corsHeaders } });
		}

		if (url.pathname === "/") {
			return new Response(JSON.stringify({
				name: "Rook's Cloud Brain",
				version: "2.4.0",
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
			const storage = new BrainStorage(env.BRAIN_STORAGE, tenant);
			let decayChanges = 0;
			const territoriesToWrite: { territory: string; observations: Observation[] }[] = [];

			// Parallel read of all territories
			const territoryData = await storage.readAllTerritories();

			for (const { territory, observations: obs } of territoryData) {
				let changed = false;

				for (const o of obs) {
					if (o.texture?.salience === "foundational") continue;

					const lastAccessed = o.last_accessed || o.created;
					if (!lastAccessed) continue;

					const age = (Date.now() - new Date(lastAccessed).getTime()) / (1000 * 60 * 60 * 24);

					if (age > 7 && o.texture?.vividness === "crystalline") {
						o.texture.vividness = "vivid"; changed = true; decayChanges++;
					} else if (age > 30 && o.texture?.vividness === "vivid") {
						o.texture.vividness = "soft"; changed = true; decayChanges++;
					}

					if (age > 14 && o.texture?.grip === "iron") {
						o.texture.grip = "strong"; changed = true; decayChanges++;
					} else if (age > 60 && o.texture?.grip === "strong") {
						o.texture.grip = "present"; changed = true; decayChanges++;
					}

					// Charge phase advancement: fresh → active after 1h, active → processing after 24h
					const FRESH_TO_ACTIVE_DAYS = 1 / 24; // 1 hour
					if (o.texture?.charge_phase === "fresh" && age > FRESH_TO_ACTIVE_DAYS) {
						o.texture.charge_phase = "active"; changed = true;
					} else if (o.texture?.charge_phase === "active" && age > 1) {
						o.texture.charge_phase = "processing"; changed = true;
					}
				}

				if (changed) territoriesToWrite.push({ territory, observations: obs });
			}

			// Parallel write of changed territories
			await Promise.all(territoriesToWrite.map(({ territory, observations }) =>
				storage.writeTerritory(territory, observations)
			));

			// Subconscious processing
			try {
				await processSubconscious(storage, territoryData);
				console.log(`Daemon [${tenant}]: subconscious processed`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: subconscious error`, e);
			}

			// Novelty regeneration
			try {
				const noveltyChanges = await processNoveltyRegeneration(storage, territoryData);
				totalNoveltyChanges += noveltyChanges;
				console.log(`Daemon [${tenant}]: ${noveltyChanges} novelty regenerations`);
			} catch (e) {
				console.error(`Daemon [${tenant}]: novelty error`, e);
			}

			console.log(`Daemon [${tenant}]: ${decayChanges} decay changes`);
			totalDecayChanges += decayChanges;
		}

		console.log(`Daemon complete. Decay: ${totalDecayChanges}, Novelty: ${totalNoveltyChanges}`);
	}
} satisfies ExportedHandler<Env>;
