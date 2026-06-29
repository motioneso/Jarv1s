import type { SourceVerifier, SourceVerifierRegistry } from "./types.js";

export class DefaultSourceVerifierRegistry implements SourceVerifierRegistry {
  private readonly verifiers = new Map<string, SourceVerifier>();

  public register(verifier: SourceVerifier): void {
    this.verifiers.set(verifier.sourceKind, verifier);
  }

  public async verify(
    sourceKind: string,
    sourceRef: string,
    actorUserId: string
  ): Promise<boolean> {
    const verifier = this.verifiers.get(sourceKind);
    if (!verifier) {
      return false;
    }
    return verifier.verify(sourceRef, actorUserId);
  }
}
