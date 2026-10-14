/**
 * The provider seam for anything model-shaped.
 *
 * Kept deliberately narrow. The server holds the API key and implements this
 * against a real model; the client implements the same interface against the
 * server's proxy. Nothing above this line knows which one it is talking to, and
 * every caller must work when the provider is unavailable — the app is offline-first.
 */
export interface StructuredRequest {
  system: string
  prompt: string
}

export interface LLMProvider {
  readonly name: string
  /** Whether the provider can be used right now. Never throws. */
  available(): Promise<boolean>
  /** Returns the model's raw text. Callers parse and validate it. */
  completeStructured(request: StructuredRequest): Promise<string>
  embed(texts: string[]): Promise<number[][]>
}
