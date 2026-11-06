export {
  InMemoryCredentialStore,
  WindowsCredentialStore,
  maskSecret,
  type CredentialStore,
} from './credential-store.js';
export { buildAdapter, resolveAdapter, resolveApiKey } from './credential-resolver.js';
export {
  OllamaAdapter,
  OpenAICompatibleAdapter,
  type ChatChunk,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ChatUsage,
  type ModelAdapter,
} from './adapter.js';
export {
  ModelError,
  normalizeModelError,
  parseStructuredOutput,
  type ModelErrorKind,
} from './error-normalization.js';
export { probeProvider, type ProbeOptions, type ProbeResult } from './probe.js';
export {
  assertCapabilities,
  resolveModelProfileId,
  type ModelResolutionContext,
} from './resolution.js';
