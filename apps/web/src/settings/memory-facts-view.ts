import type { MemoryFact } from "../api/memory-client.js";

export interface PartitionedMemoryFacts {
  readonly remembered: MemoryFact[];
  readonly inferred: MemoryFact[];
}

export function partitionMemoryFacts(facts: readonly MemoryFact[]): PartitionedMemoryFacts {
  const remembered: MemoryFact[] = [];
  const inferred: MemoryFact[] = [];

  for (const fact of facts) {
    if (fact.provenance === "inferred") {
      inferred.push(fact);
    } else {
      remembered.push(fact);
    }
  }

  return { remembered, inferred };
}
