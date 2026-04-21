export function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	if (value < min) return min;
	if (value > max) return max;
	return value;
}

export function clamp01(value: number): number {
	return clamp(value, 0, 1);
}

export function unique<T>(items: Iterable<T>): T[] {
	const seen = new Set<T>();
	const out: T[] = [];
	for (const item of items) {
		if (seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}
	return out;
}

export function uniqueNonEmptyStrings(items: Iterable<string>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of items) {
		if (!item || seen.has(item)) continue;
		seen.add(item);
		out.push(item);
	}
	return out;
}
