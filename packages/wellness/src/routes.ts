import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AccessContext, DataContextRunner } from "@jarv1s/db";
import { HttpError, handleRouteError } from "@jarv1s/module-sdk";
import {
  createCheckinRouteSchema,
  createMedicationLogRouteSchema,
  createMedicationRouteSchema,
  listCheckinsRouteSchema,
  listMedicationsRouteSchema,
  medicationScheduleRouteSchema,
  updateMedicationRouteSchema,
  WELLNESS_FEELING_CORES,
  MEDICATION_FREQUENCY_TYPES,
  MEDICATION_LOG_STATUSES,
  isValidFeelingPath,
  type MedicationFrequencyTypeApi,
  type MedicationLogStatusApi,
  type WellnessFeelingCore
} from "@jarv1s/shared";

import type {
  CreateCheckinInput,
  CreateMedicationInput,
  LogDoseInput,
  UpdateMedicationInput
} from "./repository.js";
import { WellnessRepository } from "./repository.js";
import { WellnessRecallContributor } from "./recall-context.js";
import { computeSchedule } from "./schedule.js";
import { serializeCheckin, serializeMedication, serializeMedicationLog } from "./serialize.js";

export interface WellnessRoutesDependencies {
  readonly resolveAccessContext: (request: FastifyRequest) => Promise<AccessContext>;
  readonly dataContext: DataContextRunner;
  readonly repository?: WellnessRepository;
}

interface MedParams {
  readonly id: string;
}

export function registerWellnessRoutes(
  server: FastifyInstance,
  dependencies: WellnessRoutesDependencies
): void {
  const repo = dependencies.repository ?? new WellnessRepository();
  const recallContributor = new WellnessRecallContributor();

  // ── Check-ins ────────────────────────────────────────────────────────────
  server.post(
    "/api/wellness/checkins",
    { schema: createCheckinRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseCheckinBody(request.body);
        const checkin = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const created = await repo.createCheckin(scopedDb, input);
            await recallContributor.refreshEnergyTrendFact(scopedDb, accessContext.actorUserId);
            return created;
          }
        );
        return reply.code(201).send({ checkin: serializeCheckin(checkin) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/wellness/checkins",
    { schema: listCheckinsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const query = request.query as Record<string, unknown>;
        const since = parseSince(query["since"]);
        const limit = parseLimit(query["limit"]);
        const checkins = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repo.listCheckins(scopedDb, { since, limit })
        );
        return { checkins: checkins.map(serializeCheckin) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  // ── Medications ──────────────────────────────────────────────────────────
  server.get(
    "/api/wellness/medications",
    { schema: listMedicationsRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const meds = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repo.listMedications(scopedDb)
        );
        return { medications: meds.map(serializeMedication) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post(
    "/api/wellness/medications",
    { schema: createMedicationRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseCreateMedicationBody(request.body);
        const med = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repo.createMedication(scopedDb, input)
        );
        return reply.code(201).send({ medication: serializeMedication(med) });
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.patch<{ Params: MedParams }>(
    "/api/wellness/medications/:id",
    { schema: updateMedicationRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseUpdateMedicationBody(request.body);
        const med = await dependencies.dataContext.withDataContext(accessContext, (scopedDb) =>
          repo.updateMedication(scopedDb, request.params.id, input)
        );
        if (!med) return reply.code(404).send({ error: "Medication not found" });
        return { medication: serializeMedication(med) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.get(
    "/api/wellness/medications/schedule",
    { schema: medicationScheduleRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const query = request.query as Record<string, unknown>;
        const dateStr = parseDateParam(query["date"]);
        const date = new Date(`${dateStr}T00:00:00.000Z`);
        const { meds, logs } = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => ({
            meds: await repo.listMedications(scopedDb),
            logs: await repo.listLogsForDate(scopedDb, date)
          })
        );
        return { date: dateStr, slots: computeSchedule(meds, logs, date) };
      } catch (error) {
        return handleRouteError(error, reply);
      }
    }
  );

  server.post<{ Params: MedParams }>(
    "/api/wellness/medications/:id/logs",
    { schema: createMedicationLogRouteSchema },
    async (request, reply) => {
      try {
        const accessContext = await dependencies.resolveAccessContext(request);
        const input = parseLogDoseBody(request.body);
        const result = await dependencies.dataContext.withDataContext(
          accessContext,
          async (scopedDb) => {
            const med = await repo.getMedication(scopedDb, request.params.id);
            if (!med) return null;
            return repo.logDose(scopedDb, request.params.id, input);
          }
        );
        if (!result) return reply.code(404).send({ error: "Medication not found" });
        return reply.code(201).send({ log: serializeMedicationLog(result) });
      } catch (error) {
        // A repeat log of the same scheduled slot trips the partial unique index
        // (medication_logs_scheduled_unique) — map it to an idempotent 409, not a 500.
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: "This scheduled dose is already logged" });
        }
        return handleRouteError(error, reply);
      }
    }
  );
}

function isUniqueViolation(error: unknown): boolean {
  // Postgres unique_violation. The driver surfaces `.code` on the error object.
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
  );
}

// ── Body parsers ─────────────────────────────────────────────────────────────

function parseCheckinBody(body: unknown): CreateCheckinInput {
  const value = requireObject(body);
  const feelingCore = value["feelingCore"];
  if (!isFeelingCore(feelingCore)) {
    throw new HttpError(400, `feelingCore must be one of ${WELLNESS_FEELING_CORES.join(", ")}`);
  }
  const intensity = value["intensity"];
  if (intensity !== undefined && intensity !== null) {
    if (
      typeof intensity !== "number" ||
      !Number.isInteger(intensity) ||
      intensity < 1 ||
      intensity > 5
    ) {
      throw new HttpError(400, "intensity must be an integer from 1 to 5");
    }
  }
  const energy = value["energy"];
  if (energy !== undefined && energy !== null) {
    if (typeof energy !== "number" || !Number.isInteger(energy) || energy < 1 || energy > 5) {
      throw new HttpError(400, "energy must be an integer from 1 to 5");
    }
  }
  const identifiedVia = value["identifiedVia"];
  if (identifiedVia !== undefined && identifiedVia !== "wheel" && identifiedVia !== "assisted") {
    throw new HttpError(400, "identifiedVia must be wheel or assisted");
  }
  const feelingSecondary = optionalNullableString(value["feelingSecondary"], "feelingSecondary");
  const feelingTertiary = optionalNullableString(value["feelingTertiary"], "feelingTertiary");
  // Validate the (core, secondary?, tertiary?) PATH against the taxonomy — not just each field
  // individually (Codex R2): reject e.g. a tertiary that isn't a leaf of its secondary, or a
  // tertiary supplied without its secondary. `undefined`/`null`/`""` normalize to no selection.
  if (!isValidFeelingPath(feelingCore, feelingSecondary ?? null, feelingTertiary ?? null)) {
    throw new HttpError(
      400,
      "feelingSecondary/feelingTertiary must form a valid path under feelingCore"
    );
  }
  return {
    feelingCore,
    feelingSecondary,
    feelingTertiary,
    sensations: parseStringArray(value["sensations"], "sensations"),
    intensity: intensity === undefined ? undefined : (intensity as number | null),
    energy: energy === undefined ? undefined : (energy as number | null),
    note: optionalNullableString(value["note"], "note"),
    identifiedVia: identifiedVia as "wheel" | "assisted" | undefined
  };
}

function parseCreateMedicationBody(body: unknown): CreateMedicationInput {
  const value = requireObject(body);
  const name = requiredString(value["name"], "name");
  const frequencyType = value["frequencyType"];
  if (!isFrequencyType(frequencyType)) {
    throw new HttpError(
      400,
      `frequencyType must be one of ${MEDICATION_FREQUENCY_TYPES.join(", ")}`
    );
  }
  if (frequencyType === "times_per_day" && value["timesPerDay"] == null) {
    throw new HttpError(400, "timesPerDay is required for times_per_day");
  }
  if (frequencyType === "every_n_hours" && value["intervalHours"] == null) {
    throw new HttpError(400, "intervalHours is required for every_n_hours");
  }
  if (frequencyType === "specific_weekdays") {
    if (!isNonEmptyArray(value["weekdays"])) {
      throw new HttpError(400, "weekdays is required for specific_weekdays");
    }
    if ((value["weekdays"] as number[]).some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
      throw new HttpError(400, "weekdays must be ISO weekday integers 1 (Mon) to 7 (Sun)");
    }
  }
  // Scheduled families must carry at least one clock time (matches the DB CHECK).
  const scheduledFamilies = ["once_daily", "times_per_day", "specific_weekdays", "cyclical"];
  if (scheduledFamilies.includes(frequencyType) && !isNonEmptyArray(value["scheduleTimes"])) {
    throw new HttpError(400, `scheduleTimes is required for ${frequencyType}`);
  }
  // times_per_day must enumerate exactly that many clock times (matches the DB CHECK).
  if (
    frequencyType === "times_per_day" &&
    isNonEmptyArray(value["scheduleTimes"]) &&
    (value["scheduleTimes"] as unknown[]).length !== value["timesPerDay"]
  ) {
    throw new HttpError(400, "scheduleTimes length must equal timesPerDay");
  }
  if (
    frequencyType === "cyclical" &&
    (value["cycleAnchorDate"] == null || value["cycleDaysOn"] == null)
  ) {
    throw new HttpError(400, "cycleAnchorDate and cycleDaysOn are required for cyclical");
  }
  // as_needed (PRN) is unscheduled — reject scheduling/cycle fields (matches the DB CHECK).
  if (frequencyType === "as_needed") {
    for (const f of [
      "scheduleTimes",
      "timesPerDay",
      "intervalHours",
      "weekdays",
      "cycleAnchorDate",
      "cycleDaysOn",
      "cycleDaysOff"
    ]) {
      if (value[f] != null) throw new HttpError(400, `${f} is not allowed for as_needed`);
    }
  }
  return {
    name,
    dosage: optionalNullableString(value["dosage"], "dosage"),
    form: optionalNullableString(value["form"], "form"),
    frequencyType,
    timesPerDay: optionalNumber(value["timesPerDay"]),
    intervalHours: optionalNumber(value["intervalHours"]),
    weekdays: optionalNumberArray(value["weekdays"]),
    scheduleTimes: optionalStringArrayOrNull(value["scheduleTimes"], "scheduleTimes"),
    cycleDaysOn: optionalNumber(value["cycleDaysOn"]),
    cycleDaysOff: optionalNumber(value["cycleDaysOff"]),
    cycleAnchorDate: optionalNullableString(value["cycleAnchorDate"], "cycleAnchorDate"),
    notes: optionalNullableString(value["notes"], "notes")
  };
}

function parseUpdateMedicationBody(body: unknown): UpdateMedicationInput {
  const value = requireObject(body);
  const active = value["active"];
  if (active !== undefined && typeof active !== "boolean") {
    throw new HttpError(400, "active must be a boolean");
  }
  return {
    name: value["name"] === undefined ? undefined : requiredString(value["name"], "name"),
    dosage: optionalNullableString(value["dosage"], "dosage"),
    form: optionalNullableString(value["form"], "form"),
    active: active as boolean | undefined,
    notes: optionalNullableString(value["notes"], "notes")
  };
}

function parseLogDoseBody(body: unknown): LogDoseInput {
  const value = requireObject(body);
  const status = value["status"];
  if (!isLogStatus(status)) {
    throw new HttpError(400, `status must be one of ${MEDICATION_LOG_STATUSES.join(", ")}`);
  }
  const prnReason = optionalNullableString(value["prnReason"], "prnReason");
  if (status === "prn" && !prnReason) {
    throw new HttpError(400, "prnReason is required when status is prn");
  }
  const scheduledFor = optionalNullableString(value["scheduledFor"], "scheduledFor");
  // Non-PRN logs satisfy a scheduled slot — reject at the route (friendly 400) rather than
  // letting the DB CHECK surface a 500 (Codex R2).
  if (status !== "prn" && !scheduledFor) {
    throw new HttpError(400, "scheduledFor is required for taken/skipped doses");
  }
  return {
    status,
    dose: optionalNullableString(value["dose"], "dose"),
    prnReason,
    scheduledFor
  };
}

function isFeelingCore(value: unknown): value is WellnessFeelingCore {
  return typeof value === "string" && (WELLNESS_FEELING_CORES as readonly string[]).includes(value);
}
function isFrequencyType(value: unknown): value is MedicationFrequencyTypeApi {
  return (
    typeof value === "string" && (MEDICATION_FREQUENCY_TYPES as readonly string[]).includes(value)
  );
}
function isLogStatus(value: unknown): value is MedicationLogStatusApi {
  return (
    typeof value === "string" && (MEDICATION_LOG_STATUSES as readonly string[]).includes(value)
  );
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected JSON object body");
  }
  return value as Record<string, unknown>;
}
function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${field} is required`);
  }
  return value.trim();
}
function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be a string`);
  return value.trim();
}
function optionalNumber(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number") throw new HttpError(400, "expected a number");
  return value;
}
function optionalNumberArray(value: unknown): number[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((n) => typeof n !== "number")) {
    throw new HttpError(400, "expected an array of numbers");
  }
  return value as number[];
}
function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((s) => typeof s !== "string")) {
    throw new HttpError(400, `${field} must be an array of strings`);
  }
  return value as string[];
}
function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}
function optionalStringArrayOrNull(value: unknown, field: string): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseStringArray(value, field);
}
function parseSince(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new HttpError(400, "since must be an ISO timestamp");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "since must be an ISO timestamp");
  return date;
}
function parseLimit(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new HttpError(400, "limit must be 1–500");
  return n;
}
function parseDateParam(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "date must be an ISO date (YYYY-MM-DD)");
  }
  return value;
}
