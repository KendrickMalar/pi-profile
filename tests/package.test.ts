import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
test("the distributable manifest exposes one existing extension with its catalog", () => {
  const path = new URL("package.json", root);
  assert.ok(existsSync(path), "standalone package manifest must exist");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(manifest.name, "pi-profile");
  assert.deepEqual(manifest.pi.extensions, ["./extensions/startup-profile/index.ts"]);
  assert.equal(manifest.peerDependencies["@earendil-works/pi-coding-agent"], "*");
  assert.equal(manifest.dependencies?.["@earendil-works/pi-coding-agent"], undefined);
  assert.ok(existsSync(new URL(manifest.pi.extensions[0], root)));
  const catalog = JSON.parse(readFileSync(new URL("extensions/startup-profile/profiles/catalog.json", root), "utf8"));
  assert.deepEqual(catalog.map((p: { id: string }) => p.id), ["research", "specification", "developer", "chore", "standard"]);
  for (const profile of catalog) {
    if (profile.instructionsFile) assert.ok(existsSync(fileURLToPath(new URL("extensions/startup-profile/profiles/" + profile.instructionsFile, root))));
  }
});
