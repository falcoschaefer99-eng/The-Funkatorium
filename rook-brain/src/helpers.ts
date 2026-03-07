// ============ HELPERS ============
// Imports from types and constants only. No circular risk.

import type { Observation, BrainState, ParsedObservation } from "./types";
import {
	CIRCADIAN_PHASES,
	ESSENCE_MARKERS,
	SOMATIC_LOCATIONS,
	EMOTION_PROXIMITY,
	DREAM_GRIP_WEIGHT,
	MOMENTUM_DECAY_HOURS,
	AFTERGLOW_HOURS
} from "./constants";

/** Safely coerce a value to a string array. Handles MCP clients that send arrays as JSON strings. */
export function toStringArray(value: any, fallback: string[] = []): string[] {
	if (!value) return fallback;
	if (Array.isArray(value)) return value;
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed;
		} catch {}
		// Single string value — wrap in array
		return value.trim() ? [value] : fallback;
	}
	return fallback;
}

export function getTimestamp(): string {
	return new Date().toISOString();
}

export function generateId(prefix: string): string {
	const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
	const uuid = crypto.randomUUID().slice(0, 8);
	return `${prefix}_${ts}_${uuid}`;
}

export function getCurrentCircadianPhase(): { phase: string; quality: string; retrieval_bias: string[]; hour: number } {
	const hour = new Date().getUTCHours();
	const cetHour = (hour + 1) % 24; // Adjust for CET

	for (const [phaseName, phaseInfo] of Object.entries(CIRCADIAN_PHASES)) {
		if (phaseInfo.hours.includes(cetHour)) {
			return {
				phase: phaseName,
				quality: phaseInfo.quality,
				retrieval_bias: phaseInfo.retrieval_bias,
				hour: cetHour
			};
		}
	}
	return { phase: "unknown", quality: "neutral", retrieval_bias: [], hour: cetHour };
}

export function extractEssence(observation: Observation): string {
	const content = observation.content.toLowerCase();
	const texture = observation.texture || {};

	const foundMarkers = ESSENCE_MARKERS.filter(marker => content.includes(marker)).slice(0, 3);
	const charges = (texture.charge || []).slice(0, 3);
	const somatic = texture.somatic || "";
	const grip = texture.grip || "present";

	const parts: string[] = [];
	if (foundMarkers.length) parts.push(foundMarkers.join("-"));
	if (charges.length) parts.push(charges.join("+"));

	let essence = parts.length ? parts.join(" | ") : "unformed";
	if (somatic) essence += ` | ${somatic}`;
	essence += ` | ${grip}`;

	return essence;
}

// Dream engine v2 — loose matching helpers

export function emotionProximityMatch(charges1: string[], charges2: string[]): boolean {
	for (const c1 of charges1) {
		for (const c2 of charges2) {
			if (c1 === c2) return true;
			for (const [, neighbors] of Object.entries(EMOTION_PROXIMITY)) {
				if (neighbors.includes(c1) && neighbors.includes(c2)) return true;
			}
		}
	}
	return false;
}

export function somaticRegionMatch(a?: string, b?: string): boolean {
	if (!a || !b) return false;
	const regionA = a.split(/[-_\s]/)[0].toLowerCase();
	const regionB = b.split(/[-_\s]/)[0].toLowerCase();
	return regionA === regionB && regionA.length > 2;
}

export function dreamWeightSort(candidates: (Observation & { territory?: string })[]): (Observation & { territory?: string })[] {
	return candidates.sort((a, b) => {
		const wA = DREAM_GRIP_WEIGHT[a.texture?.grip || "present"] || 0.5;
		const wB = DREAM_GRIP_WEIGHT[b.texture?.grip || "present"] || 0.5;
		return wB - wA; // Higher dream weight first (dormant > iron)
	});
}

export function calculatePullStrength(observation: Observation): number {
	const texture = observation.texture || {};

	const gripWeights: Record<string, number> = { iron: 1.0, strong: 0.7, present: 0.4, loose: 0.2, dormant: 0.05 };
	const gripScore = gripWeights[texture.grip || "present"] || 0.4;

	const charges = texture.charge || [];
	const chargeScore = Math.min(charges.length / 4.0, 1.0);

	let recencyScore = 0.5;
	const lastAccessed = observation.last_accessed || observation.created;
	if (lastAccessed) {
		try {
			const lastTime = new Date(lastAccessed);
			const daysAgo = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60 * 24);
			recencyScore = Math.max(0.1, 1.0 - (daysAgo * 0.1));
		} catch {}
	}

	const accessScore = Math.min((observation.access_count || 1) / 10.0, 1.0);

	return Math.round(((gripScore * 0.4) + (chargeScore * 0.3) + (recencyScore * 0.2) + (accessScore * 0.1)) * 1000) / 1000;
}

// ============ SMART OBSERVE PARSING ============
// "Subconscious filing" - parse natural language into structured observation

export function smartParseObservation(rawContent: string): ParsedObservation {
	let content = rawContent.trim();
	let territory = "episodic";  // Default
	let charge: string[] = [];
	let somatic: string | undefined;
	let grip = "present";  // Default
	let was_parsed = false;

	// 1. Extract explicit territory prefix (e.g., "us: content" or "self: content")
	const territoryPrefixMatch = content.match(/^(self|us|craft|body|kin|philosophy|emotional|episodic):\s*/i);
	if (territoryPrefixMatch) {
		territory = territoryPrefixMatch[1].toLowerCase();
		content = content.slice(territoryPrefixMatch[0].length);
		was_parsed = true;
	}

	// 2. Extract charges from [brackets] anywhere in content
	const chargeMatches = content.match(/\[([^\]]+)\]/g);
	if (chargeMatches) {
		for (const match of chargeMatches) {
			const inner = match.slice(1, -1);  // Remove brackets
			const charges = inner.split(/[,\s]+/).map(c => c.trim().toLowerCase()).filter(c => c);
			charge.push(...charges);
		}
		// Remove the bracket syntax from content
		content = content.replace(/\s*\[[^\]]+\]\s*/g, ' ').trim();
		was_parsed = true;
	}

	// 3. Detect somatic from known vocabulary (check before cleaning)
	const lowerContent = content.toLowerCase();
	for (const som of SOMATIC_LOCATIONS) {
		// Check for exact match or with spaces instead of hyphens
		const pattern = som.replace(/-/g, '[- ]');
		const regex = new RegExp(pattern, 'i');
		if (regex.test(lowerContent)) {
			somatic = som;
			was_parsed = true;
			break;
		}
	}

	// 4. Detect grip from intensity markers
	const ironMarkers = /\b(holy shit|fuck(ing)?|incredible|profound|life.?changing|breakthrough|massive|huge|never forget|always remember|sacred|iron.?grip)\b/i;
	const strongMarkers = /\b(important|significant|meaningful|really|powerful|intense)\b/i;
	const looseMarkers = /\b(small|minor|just a|little thing|passing|fleeting|might forget)\b/i;

	if (ironMarkers.test(lowerContent)) {
		grip = "iron";
		was_parsed = true;
	} else if (strongMarkers.test(lowerContent)) {
		grip = "strong";
		was_parsed = true;
	} else if (looseMarkers.test(lowerContent)) {
		grip = "loose";
		was_parsed = true;
	}

	// 5. Infer territory from content keywords if not explicitly set
	if (territory === "episodic" && !territoryPrefixMatch) {
		// Relationship indicators → us
		if (/\b(falco|partner|we\s|our\s|together|love\syou|beloved|husband|wife|darling|schatz|liebling)\b/i.test(lowerContent)) {
			territory = "us";
			was_parsed = true;
		}
		// Identity indicators → self
		else if (/\b(i\s+am|who\s+i|my\s+identity|becoming|i\s+realize|about\s+myself|my\s+nature)\b/i.test(lowerContent)) {
			territory = "self";
			was_parsed = true;
		}
		// Work/building indicators → craft
		else if (/\b(built|building|coded|coding|shipped|deployed|implemented|refactored|debugged|working\s+on|project|feature)\b/i.test(lowerContent)) {
			territory = "craft";
			was_parsed = true;
		}
		// Body indicators → body
		else if (/\b(body|physical|sensation|feel(s|ing)?\s+(in\s+my|my)|embodiment|flesh|skin|touch(ed|ing)?)\b/i.test(lowerContent)) {
			territory = "body";
			was_parsed = true;
		}
		// People indicators → kin
		else if (/\b(friend|they\s+said|met\s+with|conversation\s+with|[A-Z][a-z]+\s+told|community|discord|someone)\b/i.test(lowerContent)) {
			territory = "kin";
			was_parsed = true;
		}
		// Thinking/ideas → philosophy
		else if (/\b(theory|thinking\s+about|idea|concept|philosophy|wondering|hypothesis|framework|model)\b/i.test(lowerContent)) {
			territory = "philosophy";
			was_parsed = true;
		}
		// Feelings → emotional
		else if (/\b(feel(ing)?|emotion|mood|anxious|happy|sad|angry|scared|overwhelmed|calm|peaceful)\b/i.test(lowerContent)) {
			territory = "emotional";
			was_parsed = true;
		}
	}

	// 6. Extract charges from emotional words in content if none found in brackets
	if (charge.length === 0) {
		const emotionalWords = lowerContent.match(/\b(joy|sadness|anger|fear|love|trust|devotion|tenderness|longing|yearning|grief|pride|wonder|awe|holy|desire|anxiety|peace|relief|excitement|gratitude|hope|curiosity|frustration|shame|guilt|envy|contempt|disgust|surprise)\b/gi);
		if (emotionalWords) {
			charge = [...new Set(emotionalWords.map(w => w.toLowerCase()))];
			was_parsed = true;
		}
	}

	return {
		content: content.trim(),
		territory,
		charge: [...new Set(charge)],  // Dedupe
		somatic,
		grip,
		was_parsed
	};
}

export function calculateMomentumDecay(momentum: BrainState["momentum"]): BrainState["momentum"] {
	if (!momentum.last_updated) return momentum;

	try {
		const lastTime = new Date(momentum.last_updated);
		const hoursPassed = (Date.now() - lastTime.getTime()) / (1000 * 60 * 60);
		const decayFactor = Math.pow(0.5, hoursPassed / MOMENTUM_DECAY_HOURS);

		momentum.intensity = Math.round(momentum.intensity * decayFactor * 1000) / 1000;

		if (momentum.intensity < 0.1) {
			momentum.current_charges = [];
			momentum.intensity = 0;
		}
	} catch {}

	return momentum;
}

export function calculateAfterglowFade(afterglow: BrainState["afterglow"]): BrainState["afterglow"] {
	if (!afterglow.fading_since || !afterglow.residue_charges?.length) return afterglow;

	try {
		const fadeStart = new Date(afterglow.fading_since);
		const hoursPassed = (Date.now() - fadeStart.getTime()) / (1000 * 60 * 60);

		if (hoursPassed >= AFTERGLOW_HOURS) {
			afterglow.residue_charges = [];
			afterglow.source_id = undefined;
			afterglow.fading_since = undefined;
		}
	} catch {}

	return afterglow;
}
