// Wellness REST contract. Part of the Vite-bundled @jarv1s/shared package — NO node:* imports.
import { errorResponseSchema, nullableStringSchema } from "./schema-fragments.js";

export const WELLNESS_FEELING_CORES = [
  "mad",
  "sad",
  "scared",
  "joyful",
  "powerful",
  "peaceful"
] as const;
export type WellnessFeelingCore = (typeof WELLNESS_FEELING_CORES)[number];

export const MEDICATION_FREQUENCY_TYPES = [
  "once_daily",
  "times_per_day",
  "specific_weekdays",
  "every_n_hours",
  "as_needed",
  "cyclical"
] as const;
export type MedicationFrequencyTypeApi = (typeof MEDICATION_FREQUENCY_TYPES)[number];

export const MEDICATION_LOG_STATUSES = ["taken", "skipped", "prn"] as const;
export type MedicationLogStatusApi = (typeof MEDICATION_LOG_STATUSES)[number];

// ── DTOs ──────────────────────────────────────────────────────────────────

export interface CheckinDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly checkedInAt: string | null;
  readonly feelingCore: WellnessFeelingCore;
  readonly feelingSecondary: string | null;
  readonly feelingTertiary: string | null;
  readonly wheelVersion: string;
  readonly sensations: readonly string[];
  readonly intensity: number | null;
  readonly energy: number | null;
  readonly note: string | null;
  readonly identifiedVia: "wheel" | "assisted";
  readonly createdAt: string | null;
}

export interface CreateCheckinRequest {
  readonly feelingCore: WellnessFeelingCore;
  readonly feelingSecondary?: string | null;
  readonly feelingTertiary?: string | null;
  readonly sensations?: readonly string[];
  readonly intensity?: number | null;
  readonly energy?: number | null;
  readonly note?: string | null;
  readonly identifiedVia?: "wheel" | "assisted";
}

export interface CreateCheckinResponse {
  readonly checkin: CheckinDto;
}
export interface ListCheckinsResponse {
  readonly checkins: readonly CheckinDto[];
}

export interface MedicationDto {
  readonly id: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly dosage: string | null;
  readonly form: string | null;
  readonly frequencyType: MedicationFrequencyTypeApi;
  readonly timesPerDay: number | null;
  readonly intervalHours: number | null;
  readonly weekdays: readonly number[] | null;
  readonly scheduleTimes: readonly string[] | null;
  readonly cycleDaysOn: number | null;
  readonly cycleDaysOff: number | null;
  readonly cycleAnchorDate: string | null;
  readonly active: boolean;
  readonly notes: string | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface CreateMedicationRequest {
  readonly name: string;
  readonly dosage?: string | null;
  readonly form?: string | null;
  readonly frequencyType: MedicationFrequencyTypeApi;
  readonly timesPerDay?: number | null;
  readonly intervalHours?: number | null;
  readonly weekdays?: readonly number[] | null;
  readonly scheduleTimes?: readonly string[] | null;
  readonly cycleDaysOn?: number | null;
  readonly cycleDaysOff?: number | null;
  readonly cycleAnchorDate?: string | null;
  readonly notes?: string | null;
}

// Update is intentionally limited to non-schedule fields this slice (Codex R3): editing
// schedule_times without re-validating the whole frequency discriminator could trip the DB
// CHECK as a 500. Schedule editing is deferred (delete + recreate the med, or a later slice
// that re-validates the full discriminator on update).
export interface UpdateMedicationRequest {
  readonly name?: string;
  readonly dosage?: string | null;
  readonly form?: string | null;
  readonly active?: boolean;
  readonly notes?: string | null;
}

export interface MedicationResponse {
  readonly medication: MedicationDto;
}
export interface ListMedicationsResponse {
  readonly medications: readonly MedicationDto[];
}

export interface MedicationLogDto {
  readonly id: string;
  readonly medicationId: string;
  readonly status: MedicationLogStatusApi;
  readonly dose: string | null;
  readonly prnReason: string | null;
  readonly scheduledFor: string | null;
  readonly loggedAt: string | null;
}

export interface CreateMedicationLogRequest {
  readonly status: MedicationLogStatusApi;
  readonly dose?: string | null;
  readonly prnReason?: string | null;
  readonly scheduledFor?: string | null;
}
export interface CreateMedicationLogResponse {
  readonly log: MedicationLogDto;
}

export interface ScheduleSlotDto {
  readonly medicationId: string;
  readonly name: string;
  readonly scheduledFor: string | null;
  readonly asNeeded: boolean;
  readonly status: "pending" | "taken" | "skipped";
}
export interface MedicationScheduleResponse {
  readonly date: string;
  readonly slots: readonly ScheduleSlotDto[];
}

// ── JSON schemas ────────────────────────────────────────────────────────────

const stringArraySchema = { type: "array", items: { type: "string" } } as const;
const nullableIntensitySchema = {
  anyOf: [{ type: "integer", minimum: 1, maximum: 5 }, { type: "null" }]
} as const;

export const feelingCoreSchema = { type: "string", enum: WELLNESS_FEELING_CORES } as const;
export const medicationFrequencyTypeSchema = {
  type: "string",
  enum: MEDICATION_FREQUENCY_TYPES
} as const;
export const medicationLogStatusSchema = {
  type: "string",
  enum: MEDICATION_LOG_STATUSES
} as const;

export const checkinDtoSchema = {
  type: "object",
  required: [
    "id",
    "ownerUserId",
    "checkedInAt",
    "feelingCore",
    "feelingSecondary",
    "feelingTertiary",
    "wheelVersion",
    "sensations",
    "intensity",
    "energy",
    "note",
    "identifiedVia",
    "createdAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    checkedInAt: nullableStringSchema,
    feelingCore: feelingCoreSchema,
    feelingSecondary: nullableStringSchema,
    feelingTertiary: nullableStringSchema,
    wheelVersion: { type: "string" },
    sensations: stringArraySchema,
    intensity: { anyOf: [{ type: "number" }, { type: "null" }] },
    energy: { anyOf: [{ type: "number" }, { type: "null" }] },
    note: nullableStringSchema,
    identifiedVia: { type: "string", enum: ["wheel", "assisted"] },
    createdAt: nullableStringSchema
  }
} as const;

export const createCheckinRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["feelingCore"],
  properties: {
    feelingCore: feelingCoreSchema,
    feelingSecondary: nullableStringSchema,
    feelingTertiary: nullableStringSchema,
    sensations: stringArraySchema,
    intensity: nullableIntensitySchema,
    energy: nullableIntensitySchema,
    note: nullableStringSchema,
    identifiedVia: { type: "string", enum: ["wheel", "assisted"] }
  }
} as const;

export const createCheckinResponseSchema = {
  type: "object",
  required: ["checkin"],
  properties: { checkin: checkinDtoSchema }
} as const;

export const listCheckinsResponseSchema = {
  type: "object",
  required: ["checkins"],
  properties: { checkins: { type: "array", items: checkinDtoSchema } }
} as const;

export const medicationDtoSchema = {
  type: "object",
  required: [
    "id",
    "ownerUserId",
    "name",
    "dosage",
    "form",
    "frequencyType",
    "timesPerDay",
    "intervalHours",
    "weekdays",
    "scheduleTimes",
    "cycleDaysOn",
    "cycleDaysOff",
    "cycleAnchorDate",
    "active",
    "notes",
    "createdAt",
    "updatedAt"
  ],
  properties: {
    id: { type: "string" },
    ownerUserId: { type: "string" },
    name: { type: "string" },
    dosage: nullableStringSchema,
    form: nullableStringSchema,
    frequencyType: medicationFrequencyTypeSchema,
    timesPerDay: { anyOf: [{ type: "number" }, { type: "null" }] },
    intervalHours: { anyOf: [{ type: "number" }, { type: "null" }] },
    weekdays: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }] },
    scheduleTimes: { anyOf: [stringArraySchema, { type: "null" }] },
    cycleDaysOn: { anyOf: [{ type: "number" }, { type: "null" }] },
    cycleDaysOff: { anyOf: [{ type: "number" }, { type: "null" }] },
    cycleAnchorDate: nullableStringSchema,
    active: { type: "boolean" },
    notes: nullableStringSchema,
    createdAt: nullableStringSchema,
    updatedAt: nullableStringSchema
  }
} as const;

export const createMedicationRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "frequencyType"],
  properties: {
    name: { type: "string" },
    dosage: nullableStringSchema,
    form: nullableStringSchema,
    frequencyType: medicationFrequencyTypeSchema,
    timesPerDay: { anyOf: [{ type: "integer", minimum: 1, maximum: 24 }, { type: "null" }] },
    intervalHours: { anyOf: [{ type: "integer", minimum: 1, maximum: 24 }, { type: "null" }] },
    weekdays: {
      anyOf: [
        { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } },
        { type: "null" }
      ]
    },
    scheduleTimes: { anyOf: [stringArraySchema, { type: "null" }] },
    cycleDaysOn: { anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }] },
    cycleDaysOff: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
    cycleAnchorDate: nullableStringSchema,
    notes: nullableStringSchema
  }
} as const;

export const updateMedicationRequestSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    dosage: nullableStringSchema,
    form: nullableStringSchema,
    active: { type: "boolean" },
    notes: nullableStringSchema
  }
} as const;

export const medicationResponseSchema = {
  type: "object",
  required: ["medication"],
  properties: { medication: medicationDtoSchema }
} as const;

export const listMedicationsResponseSchema = {
  type: "object",
  required: ["medications"],
  properties: { medications: { type: "array", items: medicationDtoSchema } }
} as const;

export const createMedicationLogRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: {
    status: medicationLogStatusSchema,
    dose: nullableStringSchema,
    prnReason: nullableStringSchema,
    scheduledFor: nullableStringSchema
  }
} as const;

export const medicationLogDtoSchema = {
  type: "object",
  required: ["id", "medicationId", "status", "dose", "prnReason", "scheduledFor", "loggedAt"],
  properties: {
    id: { type: "string" },
    medicationId: { type: "string" },
    status: medicationLogStatusSchema,
    dose: nullableStringSchema,
    prnReason: nullableStringSchema,
    scheduledFor: nullableStringSchema,
    loggedAt: nullableStringSchema
  }
} as const;

export const createMedicationLogResponseSchema = {
  type: "object",
  required: ["log"],
  properties: { log: medicationLogDtoSchema }
} as const;

export const scheduleSlotDtoSchema = {
  type: "object",
  required: ["medicationId", "name", "scheduledFor", "asNeeded", "status"],
  properties: {
    medicationId: { type: "string" },
    name: { type: "string" },
    scheduledFor: nullableStringSchema,
    asNeeded: { type: "boolean" },
    status: { type: "string", enum: ["pending", "taken", "skipped"] }
  }
} as const;

export const medicationScheduleResponseSchema = {
  type: "object",
  required: ["date", "slots"],
  properties: {
    date: { type: "string" },
    slots: { type: "array", items: scheduleSlotDtoSchema }
  }
} as const;

// ── Route schemas (Fastify {request?, response} envelopes) ───────────────────

export const createCheckinRouteSchema = {
  body: createCheckinRequestSchema,
  response: { 201: createCheckinResponseSchema, 400: errorResponseSchema }
} as const;
export const listCheckinsRouteSchema = {
  response: { 200: listCheckinsResponseSchema }
} as const;
export const createMedicationRouteSchema = {
  body: createMedicationRequestSchema,
  response: { 201: medicationResponseSchema, 400: errorResponseSchema }
} as const;
export const listMedicationsRouteSchema = {
  response: { 200: listMedicationsResponseSchema }
} as const;
export const updateMedicationRouteSchema = {
  body: updateMedicationRequestSchema,
  response: { 200: medicationResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema }
} as const;
export const medicationScheduleRouteSchema = {
  response: { 200: medicationScheduleResponseSchema }
} as const;
export const createMedicationLogRouteSchema = {
  body: createMedicationLogRequestSchema,
  response: {
    201: createMedicationLogResponseSchema,
    400: errorResponseSchema,
    404: errorResponseSchema,
    409: errorResponseSchema
  }
} as const;

// ── Browser-safe reference taxonomy ──────────────────────────────────────────
// Lives in @jarv1s/shared (NOT @jarv1s/wellness) so the web bundle never imports the
// server-only wellness index, whose manifest pulls `node:url` (Codex R1: bundle bloat/break).
// Reference data — NOT user-editable, NOT a table. Adapted SUBSET of the Willcox (1982)
// Feeling Wheel (not the exhaustive wheel — labeled as a subset, Codex R1).

export const WHEEL_VERSION = "willcox-1982";

export interface FeelingsWheelSecondary {
  readonly name: string;
  readonly tertiary: readonly string[];
}
export interface FeelingsWheelCore {
  readonly core: WellnessFeelingCore;
  readonly secondary: readonly FeelingsWheelSecondary[];
}

export const FEELINGS_WHEEL: readonly FeelingsWheelCore[] = [
  {
    core: "mad",
    secondary: [
      { name: "hurt", tertiary: ["embarrassed", "devastated"] },
      { name: "hostile", tertiary: ["irritated", "resentful"] },
      { name: "angry", tertiary: ["furious", "frustrated"] },
      { name: "critical", tertiary: ["skeptical", "dismissive"] }
    ]
  },
  {
    core: "sad",
    secondary: [
      { name: "lonely", tertiary: ["isolated", "abandoned"] },
      { name: "depressed", tertiary: ["empty", "hopeless"] },
      { name: "guilty", tertiary: ["ashamed", "remorseful"] },
      { name: "tired", tertiary: ["sleepy", "drained"] }
    ]
  },
  {
    core: "scared",
    secondary: [
      { name: "anxious", tertiary: ["overwhelmed", "worried"] },
      { name: "insecure", tertiary: ["inadequate", "inferior"] },
      { name: "rejected", tertiary: ["excluded", "persecuted"] },
      { name: "confused", tertiary: ["bewildered", "discouraged"] }
    ]
  },
  {
    core: "joyful",
    secondary: [
      { name: "excited", tertiary: ["energetic", "eager"] },
      { name: "content", tertiary: ["satisfied", "grateful"] },
      { name: "proud", tertiary: ["confident", "successful"] },
      { name: "playful", tertiary: ["cheerful", "creative"] }
    ]
  },
  {
    core: "powerful",
    secondary: [
      { name: "respected", tertiary: ["valued", "appreciated"] },
      { name: "confident", tertiary: ["worthy", "capable"] },
      { name: "hopeful", tertiary: ["optimistic", "inspired"] },
      { name: "faithful", tertiary: ["intimate", "courageous"] }
    ]
  },
  {
    core: "peaceful",
    secondary: [
      { name: "content", tertiary: ["thoughtful", "relaxed"] },
      { name: "thankful", tertiary: ["loving", "trusting"] },
      { name: "secure", tertiary: ["calm", "at ease"] },
      { name: "responsive", tertiary: ["engaged", "present"] }
    ]
  }
];

/** Curated interoception "body check" list (static reference data, NOT a table). */
export const BODY_SENSATIONS: readonly string[] = [
  "Tight chest",
  "Racing heart",
  "Lump in throat",
  "Clenched jaw",
  "Stiff shoulders",
  "Butterflies / fluttering stomach",
  "Sweating",
  "Dry mouth",
  "Shallow breathing",
  "Heaviness / fatigue",
  "Restlessness",
  "Temperature change (hot/cold)"
];

/**
 * Validate a (core, secondary?, tertiary?) selection against FEELINGS_WHEEL. Returns true
 * for a bare core, a core+valid-secondary, or a core+secondary+valid-tertiary. Browser-safe
 * (no node:*). This is the path-validation helper referenced by the data model.
 */
export function isValidFeelingPath(
  core: WellnessFeelingCore,
  secondary?: string | null,
  tertiary?: string | null
): boolean {
  const coreNode = FEELINGS_WHEEL.find((c) => c.core === core);
  if (!coreNode) return false;
  if (secondary == null) return tertiary == null;
  const secNode = coreNode.secondary.find((s) => s.name === secondary);
  if (!secNode) return false;
  if (tertiary == null) return true;
  return secNode.tertiary.includes(tertiary);
}
