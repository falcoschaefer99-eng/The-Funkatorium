import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('worker integration smoke (workerd pool)', () => {
	describe('GET /health', () => {
		it('responds with JSON status (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/health');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const payload = await response.json() as { status?: string };
			expect(['ok', 'degraded']).toContain(payload.status);
		});

		it('responds with JSON status (integration style)', async () => {
			const response = await SELF.fetch('http://example.com/health');
			expect(response.status).toBe(200);
			const payload = await response.json() as { status?: string };
			expect(['ok', 'degraded']).toContain(payload.status);
		});
	});

	describe('GET /', () => {
		it('returns API metadata (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const payload = await response.json() as { name?: string; tools?: number; version?: string };
			expect(payload.name).toBe('MUSE Brain');
			expect(typeof payload.tools).toBe('number');
			expect(payload.tools).toBeGreaterThan(0);
			expect(typeof payload.version).toBe('string');
		});

		it('returns API metadata (integration style)', async () => {
			const response = await SELF.fetch('http://example.com/');
			expect(response.status).toBe(200);
			const payload = await response.json() as { name?: string; tools?: number };
			expect(payload.name).toBe('MUSE Brain');
			expect(typeof payload.tools).toBe('number');
		});
	});
});
