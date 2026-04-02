import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import worker from '../src';

function patchTimingSafeEqual(): void {
	const subtle = (globalThis.crypto as any).subtle;
	if (!subtle.timingSafeEqual) {
		subtle.timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
			if (a.byteLength !== b.byteLength) return false;
			let diff = 0;
			for (let i = 0; i < a.byteLength; i += 1) {
				diff |= a[i] ^ b[i];
			}
			return diff === 0;
		};
	}
}

function makeContext(): ExecutionContext {
	return {
		waitUntil: (_promise: Promise<unknown>) => {}
	} as ExecutionContext;
}

function makeRequest(path: string, init?: RequestInit): Request {
	return new Request(`http://example.com${path}`, init);
}

describe('worker HTTP routes', () => {
	let tempDir = '';
	let env: any;

	beforeAll(() => {
		patchTimingSafeEqual();
	});

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), 'brain-worker-routes-'));
		env = {
			API_KEY: 'test-api-key',
			STORAGE_BACKEND: 'sqlite',
			SQLITE_PATH: join(tempDir, 'brain.sqlite')
		};
	});

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	it('/health responds without auth', async () => {
		const response = await worker.fetch(makeRequest('/health', { method: 'GET' }), env, makeContext());
		expect(response.status).toBe(200);
		const payload = await response.json() as { status?: string };
		expect(['ok', 'degraded']).toContain(payload.status);
	});

	it('/mcp rejects invalid auth', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(401);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Unauthorized');
	});

	it('/mcp rejects invalid tenant', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'hacker'
				},
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid tenant');
	});

	it('/mcp rejects malformed JSON payloads', async () => {
		const response = await worker.fetch(
			makeRequest('/mcp', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'rook'
				},
				body: '{bad json'
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid JSON');
	});

	it('/mcp tools/list succeeds and replay is stable', async () => {
		const requestInit: RequestInit = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-api-key',
				'X-Brain-Tenant': 'rook'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
		};

		const first = await worker.fetch(makeRequest('/mcp', requestInit), env, makeContext());
		const second = await worker.fetch(makeRequest('/mcp', requestInit), env, makeContext());

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);

		const firstPayload = await first.json() as { result?: { tools?: unknown[] } };
		const secondPayload = await second.json() as { result?: { tools?: unknown[] } };

		expect(Array.isArray(firstPayload.result?.tools)).toBe(true);
		expect((firstPayload.result?.tools?.length ?? 0)).toBeGreaterThan(0);
		expect(secondPayload.result?.tools?.length).toBe(firstPayload.result?.tools?.length);
	});

	it('/runtime/trigger rejects invalid auth', async () => {
		const response = await worker.fetch(
			makeRequest('/runtime/trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
				body: JSON.stringify({ wake_kind: 'duty' })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(401);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Unauthorized');
	});

	it('/runtime/trigger rejects invalid tenant', async () => {
		const response = await worker.fetch(
			makeRequest('/runtime/trigger', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'hacker'
				},
				body: JSON.stringify({ wake_kind: 'duty' })
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Invalid tenant');
	});

	it('/runtime/trigger rejects invalid payload shape', async () => {
		const response = await worker.fetch(
			makeRequest('/runtime/trigger', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer test-api-key',
					'X-Brain-Tenant': 'rook'
				},
				body: JSON.stringify([])
			}),
			env,
			makeContext()
		);

		expect(response.status).toBe(400);
		const payload = await response.json() as { error?: string };
		expect(payload.error).toBe('Body must be a JSON object');
	});

	it('/runtime/trigger returns stable validation error on replay payload', async () => {
		const requestInit: RequestInit = {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer test-api-key',
				'X-Brain-Tenant': 'rook'
			},
			body: JSON.stringify({ wake_kind: 'not-real' })
		};

		const first = await worker.fetch(makeRequest('/runtime/trigger', requestInit), env, makeContext());
		const second = await worker.fetch(makeRequest('/runtime/trigger', requestInit), env, makeContext());

		expect(first.status).toBe(400);
		expect(second.status).toBe(400);

		const firstPayload = await first.json() as { error?: string };
		const secondPayload = await second.json() as { error?: string };
		expect(firstPayload.error).toMatch(/wake_kind must be one of/i);
		expect(secondPayload.error).toBe(firstPayload.error);
	});
});
