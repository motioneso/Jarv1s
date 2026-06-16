export type MemoryFactProvenance = "volunteered" | "inferred" | "confirmed";

export function getMemoryFactProvenanceLabel(provenance: MemoryFactProvenance): string {
  switch (provenance) {
    case "volunteered":
      return "said";
    case "confirmed":
      return "confirmed";
    case "inferred":
      return "inferred";
  }
}

export function getMemoryFactProvenanceTone(provenance: MemoryFactProvenance): string {
  switch (provenance) {
    case "volunteered":
      return "memory-fact__provenance--said";
    case "confirmed":
      return "memory-fact__provenance--confirmed";
    case "inferred":
      return "memory-fact__provenance--inferred";
  }
}
