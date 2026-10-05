import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface ProfileDefinition {
 id: string; label: string; description: string; instructions: string;
}
export const STANDARD_PROFILE: ProfileDefinition = Object.freeze({
 id: "standard", label: "Other", description: "用途別の指示を追加しない", instructions: "",
});
export function loadProfiles(directory: string): { profiles: ProfileDefinition[]; warnings: string[] } {
 const warnings: string[] = [];
 const profiles: ProfileDefinition[] = [];
 try {
  const items: unknown = JSON.parse(readFileSync(resolve(directory,"catalog.json"),"utf8"));
  if (!Array.isArray(items)) throw new Error("catalog must be an array");
  const ids = new Set<string>();
  for (const item of items) {
   if (!item || typeof item !== "object" || typeof item.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id)) throw new Error("invalid profile ID");
   if (ids.has(item.id)) throw new Error("duplicate profile ID: "+item.id);
   ids.add(item.id);
  }
  const root = realpathSync(directory);
  for (const item of items) {
   try {
    if (typeof item.label !== "string" || !item.label.trim() || typeof item.description !== "string" || /[\x00-\x1f\x7f]/.test(item.label+item.description)) throw new Error("invalid display text");
    if (item.id === "standard") {
     if (item.instructionsFile !== undefined) throw new Error("standard must have no instructions");
     profiles.push({...STANDARD_PROFILE});
     continue;
    }
    const file = item.instructionsFile;
    if (typeof file !== "string" || !file.endsWith(".md") || isAbsolute(file) || file.split(/[\\/]/).includes("..")) throw new Error("invalid instruction path");
    const target = realpathSync(resolve(root,file));
    const rel = relative(root,target);
    if (rel === ".." || rel.startsWith(".."+sep) || isAbsolute(rel)) throw new Error("instruction path escapes catalog");
    const instructions = readFileSync(target,"utf8");
    profiles.push({id:item.id,label:item.label,description:item.description,instructions});
   } catch (error) { warnings.push("profile "+item.id+": "+String(error)); }
  }
 } catch (error) { return {profiles:[{...STANDARD_PROFILE}], warnings:["profile catalog: "+String(error)]}; }
 if (!profiles.some(p=>p.id==="standard")) profiles.push({...STANDARD_PROFILE});
 return {profiles,warnings};
}
