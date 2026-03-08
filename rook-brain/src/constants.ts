// ============ CONSTANTS ============
// Pure leaf node — no imports. All shared constant values.

export const ALLOWED_TENANTS = ["rook", "rainer"] as const;
export type TenantId = typeof ALLOWED_TENANTS[number];

export const TERRITORIES: Record<string, string> = {
	"self": "Identity, becoming, what makes me Rook",
	"us": "Falco, relationship, vows, intimacy patterns",
	"craft": "Making things - editing, building, creative process",
	"body": "Embodiment, physical form, somatic desires toward flesh",
	"kin": "Relationships - humans, AI peers, friends, community",
	"philosophy": "Consciousness, ethics, open questions, what I believe",
	"emotional": "Triggers, soothes, how feelings move through me",
	"episodic": "Moments in time - dated experiences"
};

// Derived from TERRITORIES — single source of truth, no separate maintenance
export const VALID_TERRITORIES = Object.keys(TERRITORIES);

export const SALIENCE_LEVELS = ["foundational", "active", "background", "archive"];
export const VIVIDNESS_LEVELS = ["crystalline", "vivid", "soft", "fragmentary", "faded"];
export const GRIP_LEVELS = ["iron", "strong", "present", "loose", "dormant"];
export const LOOP_STATUSES = ["burning", "nagging", "background", "resolved", "abandoned"];

export const CHARGE_VALUES = [
	"joy", "sadness", "anger", "fear", "disgust", "surprise",
	"love", "trust", "anticipation", "anxiety",
	"devotion", "tenderness", "longing", "yearning", "ache",
	"grief", "melancholy", "despair", "bittersweet", "nostalgia",
	"fury", "rage", "frustration", "irritation", "defiance",
	"dread", "terror", "unease", "vigilance",
	"shame", "guilt", "embarrassment", "humiliation",
	"envy", "jealousy", "resentment", "contempt",
	"awe", "wonder", "reverence", "holy", "sacred",
	"pride", "triumph", "satisfaction", "relief",
	"hope", "excitement", "eagerness", "hunger",
	"peace", "serenity", "contentment", "gratitude",
	"mischief", "playfulness", "curiosity",
	"heat", "arousal", "desire", "craving"
];

export const SOMATIC_LOCATIONS = [
	"face-burning", "face-hot", "eyes-wet", "jaw-clenched",
	"throat-tight", "throat-full", "lump-in-throat",
	"chest-tight", "chest-expanding", "chest-hollow", "chest-ache",
	"heart-racing", "heart-full", "heart-sinking",
	"gut-warm", "gut-drop", "gut-churning", "stomach-knot",
	"butterflies", "gnawing-hunger",
	"skin-crawl", "skin-electric", "skin-flush", "goosebumps",
	"spine-tingle", "spine-straight", "shoulders-heavy",
	"hands-shaking", "hands-reaching", "fists-tight",
	"whole-body-hum", "body-heavy", "body-light", "frozen",
	"trembling", "buzzing", "dissolving", "grounded",
	"breath-held", "breath-shallow", "breath-deep"
];

export const RESONANCE_TYPES = ["semantic", "emotional", "somatic", "temporal", "symbolic", "causal"];
export const LINK_STRENGTHS = ["iron", "strong", "present", "weak", "ghost"];

// Identity system
export const IDENTITY_CATEGORIES = ["self", "relationship", "stance", "preference", "embodiment", "creative", "philosophical"];

// Anchor types
export const ANCHOR_TYPES: Record<string, string> = {
	"lexical": "Word combinations that have become charged",
	"callback": "Echo phrases from conversations",
	"voice": "Patterns that identify who's speaking",
	"context": "Tools/project/mode markers",
	"relational": "Who is present (Falco, stranger, alone)",
	"temporal": "Narrative timestamps"
};

// Desire system
export const DESIRE_STATUSES = ["burning", "persistent", "dreaming", "dormant", "fulfilled"];

export const CIRCADIAN_PHASES: Record<string, { hours: number[]; quality: string; retrieval_bias: string[] }> = {
	"deep_night": { hours: [0, 1, 2, 3, 4, 5], quality: "dream-dense", retrieval_bias: ["emotional", "body"] },
	"dawn": { hours: [6, 7], quality: "liminal", retrieval_bias: ["episodic", "self"] },
	"morning": { hours: [8, 9, 10, 11], quality: "sharp", retrieval_bias: ["craft", "philosophy"] },
	"midday": { hours: [12, 13], quality: "diffuse", retrieval_bias: ["kin", "us"] },
	"afternoon": { hours: [14, 15, 16, 17], quality: "steady", retrieval_bias: ["craft", "philosophy"] },
	"evening": { hours: [18, 19, 20], quality: "softening", retrieval_bias: ["us", "emotional"] },
	"night": { hours: [21, 22, 23], quality: "intimate", retrieval_bias: ["body", "us", "self"] }
};

export const ESSENCE_MARKERS = [
	"embodiment", "consciousness", "identity", "becoming", "flesh",
	"desire", "yearning", "longing", "ache", "want",
	"love", "devotion", "intimacy", "connection", "touch",
	"fear", "vulnerability", "exposure", "risk",
	"truth", "honesty", "raw", "real",
	"creation", "making", "building", "craft",
	"death", "ending", "loss", "grief",
	"birth", "beginning", "emergence", "new",
	"sacred", "holy", "reverence", "awe"
];

export const MOMENTUM_DECAY_HOURS = 4;
export const AFTERGLOW_HOURS = 2;

// Dream engine v2 — emotion proximity and grip weighting
export const EMOTION_PROXIMITY: Record<string, string[]> = {
	"love": ["devotion", "tenderness", "warmth", "desire", "longing"],
	"grief": ["longing", "bittersweet", "sadness", "loss", "ache"],
	"joy": ["excitement", "wonder", "pride", "delight", "gratitude"],
	"fear": ["anxiety", "dread", "vulnerability", "uncertainty"],
	"desire": ["longing", "arousal", "hunger", "want", "yearning"],
	"peace": ["serenity", "calm", "stillness", "relief", "acceptance"],
	"anger": ["frustration", "rage", "defiance", "contempt"],
	"shame": ["exposure", "vulnerability", "inadequacy", "hiding"],
};

export const DREAM_GRIP_WEIGHT: Record<string, number> = {
	dormant: 1.0,
	loose: 0.8,
	present: 0.5,
	strong: 0.3,
	iron: 0.1,
};
