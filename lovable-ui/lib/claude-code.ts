// Re-export AI generation as the main code generation API.
// This file is kept for backward compatibility and routes to the current AI Gateway-backed implementation.
export {
  generateCodeWithPerplexity as generateCode,
  streamGenerateCodeWithPerplexity as streamGenerateCode,
  type CodeGenerationResult,
  type PerplexityMessage,
  type PerplexityResponse
} from "./perplexity";
