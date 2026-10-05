import type { BeforeAgentStartEvent } from "@earendil-works/pi-coding-agent";
import type { ProfileSnapshot } from "./state.ts";
export function applyProfilePrompt(event: BeforeAgentStartEvent, snapshot: ProfileSnapshot): {systemPrompt:string} | undefined {
 if (!snapshot.instructions) return undefined;
 if (event.systemPromptOptions.forceSystemPrompt !== undefined) {
  return {systemPrompt:event.systemPrompt+"\n\n<startup_profile>\n"+snapshot.instructions+"\n</startup_profile>"};
 }
 event.systemPromptOptions.sections.startup_profile=snapshot.instructions;
 return undefined;
}
