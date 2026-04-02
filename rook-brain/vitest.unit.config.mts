import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['test/**/*.spec.ts'],
		exclude: ['test/index.spec.ts', '**/node_modules/**']
	}
});
