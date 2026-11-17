/**
 * Import surface for code that must not load the OpenAI SDK (capabilities,
 * validators): the targets table and the types prompts are built from.
 */
export * from "./length-targets";
export { BANNED_PHRASES, GENERIC_HASHTAGS, type PlaybookTargets } from "./shared-rules";
