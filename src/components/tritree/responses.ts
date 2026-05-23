import { listArtifactTypes, type ArtifactType } from "@/lib/artifacts";
import {
  ArtifactSchema,
  DEFAULT_ARTIFACT_TYPE_ID,
  InspirationSchema,
  SessionStateSchema,
  type ArtifactTypeId,
  type BranchOption,
  type Inspiration,
  isCustomBranchOptionId,
  isPrimaryBranchOptionId
} from "@/lib/domain";
import type { ProcessMaterial } from "@/components/artifacts/ArtifactWorkspace";
import type { ArtifactStreamEvent, OptionsStreamEvent, RootSetupDefaults } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isAbortError(error: unknown) {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  if (!error || typeof error !== "object" || !("name" in error)) return false;
  return error.name === "AbortError" || error.name === "ResponseAborted";
}

function isBranchOption(value: unknown): value is BranchOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (isPrimaryBranchOptionId(value.id) || isCustomBranchOptionId(value.id)) &&
    typeof value.label === "string" &&
    typeof value.description === "string" &&
    typeof value.impact === "string" &&
    (value.kind === "explore" || value.kind === "deepen" || value.kind === "reframe" || value.kind === "finish") &&
    (value.mode == null || value.mode === "divergent" || value.mode === "balanced" || value.mode === "focused")
  );
}

export function normalizeInspirationsResponse(value: unknown): Inspiration[] {
  if (!isRecord(value) || !Array.isArray(value.inspirations)) return [];

  return value.inspirations.flatMap((item) => {
    const parsed = InspirationSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

export function normalizeArtifactTypesResponse(value: unknown): ArtifactType[] {
  const allArtifactTypes = listArtifactTypes();
  if (!Array.isArray(value)) return allArtifactTypes;

  const artifactTypeById = new Map(allArtifactTypes.map((artifactType) => [artifactType.id, artifactType]));
  const seenArtifactTypeIds = new Set<ArtifactTypeId>();
  const artifactTypes = value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const artifactType = artifactTypeById.get(item.id as ArtifactTypeId);
    if (!artifactType || seenArtifactTypeIds.has(artifactType.id)) return [];
    seenArtifactTypeIds.add(artifactType.id);
    // 保留服务端返回的 publishPlatforms（已经过服务端环境变量过滤）
    if (Array.isArray(item.publishPlatforms)) {
      return [{ ...artifactType, publishPlatforms: item.publishPlatforms as ArtifactType["publishPlatforms"] }];
    }
    return [artifactType];
  });

  return artifactTypes.length > 0 ? artifactTypes : allArtifactTypes;
}

function resolveArtifactTypeId(
  artifactTypes: ArtifactType[],
  preferredArtifactTypeId: ArtifactTypeId | null | undefined
): ArtifactTypeId {
  if (preferredArtifactTypeId && artifactTypes.some((artifactType) => artifactType.id === preferredArtifactTypeId)) {
    return preferredArtifactTypeId;
  }

  return artifactTypes[0]?.id ?? DEFAULT_ARTIFACT_TYPE_ID;
}

export function resolveRootSetupDefaults(
  defaults: RootSetupDefaults | null | undefined,
  artifactTypes: ArtifactType[]
): RootSetupDefaults {
  return {
    artifactTypeId: resolveArtifactTypeId(artifactTypes, defaults?.artifactTypeId),
    creationRequest: defaults?.creationRequest ?? "",
    enabledSkillIds: defaults?.enabledSkillIds,
    seed: defaults?.seed ?? ""
  };
}

export function isArtifactStreamEvent(value: unknown): value is ArtifactStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "artifact.replace":
      return ArtifactSchema.safeParse(value.artifact).success;
    case "artifact.patch":
      return typeof value.path === "string";
    case "options":
      return (
        typeof value.nodeId === "string" &&
        Array.isArray(value.options) &&
        value.options.every((option) => isBranchOption(option)) &&
        (value.roundIntent == null || typeof value.roundIntent === "string")
      );
    case "thinking":
      return (
        typeof value.text === "string" &&
        (value.nodeId == null || typeof value.nodeId === "string") &&
        (value.stage == null || value.stage === "artifact" || value.stage === "options")
      );
    case "process_data":
      return (value.nodeId == null || typeof value.nodeId === "string") && isProcessMaterial(value.data);
    case "done":
      return SessionStateSchema.safeParse(value.state).success;
    case "error":
      return typeof value.error === "string";
    default:
      return false;
  }
}

export function isOptionsStreamEvent(value: unknown): value is OptionsStreamEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;

  switch (value.type) {
    case "done":
      return SessionStateSchema.safeParse(value.state).success;
    case "options":
      return (
        typeof value.nodeId === "string" &&
        Array.isArray(value.options) &&
        value.options.every((option) => isBranchOption(option)) &&
        (value.roundIntent == null || typeof value.roundIntent === "string")
      );
    case "thinking":
      return typeof value.text === "string" && (value.nodeId == null || typeof value.nodeId === "string");
    case "process_data":
      return (value.nodeId == null || typeof value.nodeId === "string") && isProcessMaterial(value.data);
    case "error":
      return typeof value.error === "string";
    default:
      return false;
  }
}

function isProcessMaterial(value: unknown): value is ProcessMaterial {
  if (!isRecord(value)) return false;
  if (typeof value.title !== "string" || !value.title.trim()) return false;
  if (!Array.isArray(value.sourceToolCallIds) || !value.sourceToolCallIds.every((item) => typeof item === "string")) {
    return false;
  }
  if (value.note != null && typeof value.note !== "string") return false;
  if (!Array.isArray(value.items) || value.items.length === 0) return false;

  return value.items.every((item) => {
    if (!isRecord(item)) return false;
    if (typeof item.title !== "string" || !item.title.trim()) return false;
    if (item.subtitle != null && typeof item.subtitle !== "string") return false;
    if (item.meta != null && typeof item.meta !== "string") return false;
    if (item.url != null && typeof item.url !== "string") return false;
    return true;
  });
}
