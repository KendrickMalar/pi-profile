import type { ProfileDefinition } from "./catalog.ts";
export const STATE_ENTRY_TYPE = "startup-profile-state";
export interface ProfileSnapshot { version: 1; id: string; label: string; instructions: string }
export function snapshotProfile(profile: ProfileDefinition): ProfileSnapshot {
 return {version:1,id:profile.id,label:profile.label,instructions:profile.instructions};
}
export function readSnapshot(entries: readonly unknown[]): { snapshot?: ProfileSnapshot; invalid: boolean } {
 let snapshot: ProfileSnapshot | undefined;
 for (const value of entries) {
  if (!value || typeof value !== "object") continue;
  const e=value as Record<string,unknown>;
  if (e.customType !== STATE_ENTRY_TYPE) continue;
  const d=e.data as Partial<ProfileSnapshot> | null;
  if (e.type!=="custom" || !d || d.version!==1 || typeof d.id!=="string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.id) || typeof d.label!=="string" || !d.label.trim() || /[\x00-\x1f\x7f]/.test(d.label) || typeof d.instructions!=="string" || (d.id==="standard" && d.instructions!=="")) return {invalid:true};
  const next:ProfileSnapshot={version:1,id:d.id,label:d.label,instructions:d.instructions};
  if (snapshot && (snapshot.id!==next.id || snapshot.label!==next.label || snapshot.instructions!==next.instructions)) return {invalid:true};
  snapshot=next;
 }
 return snapshot ? {snapshot,invalid:false} : {invalid:false};
}
export function decideSessionProfile(input: {
 reason: "startup"|"reload"|"new"|"resume"|"fork";
 mode: "tui"|"rpc"|"json"|"print";
 existingFile: boolean; hasConversation: boolean;
 restored: ReturnType<typeof readSnapshot>;
}): "restore"|"select"|"standard" {
 if (input.restored.invalid) return "standard";
 if (input.restored.snapshot) return "restore";
 if (input.existingFile || input.hasConversation || !["startup","new"].includes(input.reason)) return "standard";
 return input.mode==="tui" ? "select" : "standard";
}
