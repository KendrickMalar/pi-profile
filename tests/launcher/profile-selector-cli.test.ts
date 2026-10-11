import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { SelectorItem, SelectorWidth } from "../../extensions/startup-profile/selector-layout.ts";
import type { CliSelectorIO } from "../../src/profile-selector-cli.ts";

async function api() {
  return import("../../src/profile-selector-cli.ts");
}

const items: readonly SelectorItem[] = [
  { id: "research", label: "Research", description: "調査", packages: ["npm:research"] },
  { id: "developer", label: "Development", description: "実装", packages: ["npm:tools"] },
  { id: "standard", label: "Other", description: "標準", packages: [] },
];

const widthTools: SelectorWidth = {
  visibleWidth: text => text.replace(/\x1b\[[0-9;]*m/g, "").length,
  truncateToWidth: (text, width, ellipsis = "") => {
    const plain = text.replace(/\x1b\[[0-9;]*m/g, "");
    return plain.length <= width ? text : plain.slice(0, Math.max(0, width - ellipsis.length)) + ellipsis;
  },
  wrapTextWithAnsi: (text, width) => {
    if (!text) return [""];
    const result: string[] = [];
    for (let offset = 0; offset < text.length; offset += Math.max(1, width)) result.push(text.slice(offset, offset + Math.max(1, width)));
    return result;
  },
};

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  rawCalls: boolean[] = [];
  resumeCalls = 0;
  pauseCalls = 0;
  setRawMode(value: boolean) { this.rawCalls.push(value); this.isRaw = value; return this; }
  resume() { this.resumeCalls++; return this; }
  pause() { this.pauseCalls++; return this; }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  writes: string[] = [];
  write(value: string | Uint8Array) { this.writes.push(String(value)); return true; }
}

function harness(env: NodeJS.ProcessEnv = {}) {
  const stdin = new FakeInput();
  const stdout = new FakeOutput();
  const io = { stdin, stdout } as unknown as CliSelectorIO;
  return { stdin, stdout, io, env };
}

function visibleOutput(output: FakeOutput): string {
  return output.writes.join("").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

class ReflowingScreen {
  width: number;
  private rows: string[][] = [[]];
  private row = 0;
  private column = 0;

  constructor(width: number) { this.width = width; }

  resize(width: number) {
    const logicalRows = this.rows.slice(0, this.row).map(cells => cells.join("").replace(/ +$/g, ""));
    const reflowed = logicalRows.flatMap(line => {
      if (!line) return [""];
      const chunks: string[] = [];
      for (let offset = 0; offset < line.length; offset += width) chunks.push(line.slice(offset, offset + width));
      return chunks;
    });
    this.width = width;
    this.rows = reflowed.map(line => [...line]);
    this.rows.push([]);
    this.row = reflowed.length;
    this.column = 0;
  }

  write(input: string) {
    for (let offset = 0; offset < input.length;) {
      if (input[offset] === "\x1b" && input[offset + 1] === "[") {
        const match = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(input.slice(offset));
        if (match) {
          const count = Number(match[1] || "1");
          if (match[2] === "A") this.row = Math.max(0, this.row - count);
          else if (match[2] === "K") this.rows[this.row] = [];
          offset += match[0].length;
          continue;
        }
      }
      const character = input[offset++];
      if (character === "\r") { this.column = 0; continue; }
      if (character === "\n") { this.row++; this.column = 0; this.rows[this.row] ??= []; continue; }
      if (this.column >= this.width) { this.row++; this.column = 0; this.rows[this.row] ??= []; }
      const cells = this.rows[this.row] ??= [];
      while (cells.length < this.column) cells.push(" ");
      cells[this.column++] = character;
    }
  }

  text(): string { return this.rows.map(cells => cells.join("")).join("\n"); }
}

async function settleAfter(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

test("enter_returns_id_and_writes_one_compact_selection", async () => {
  const a = await api(), h = harness();
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\x1b[B\r"));
  assert.deepEqual(await choice, { kind: "selected", id: "developer" });
  const output = visibleOutput(h.stdout);
  assert.equal((output.match(/◇ Profile/g) ?? []).length, 1);
  assert.match(output, /◇ Profile  Development 💻/);
  assert.deepEqual(h.stdin.rawCalls, [true, false]);
  assert.equal(h.stdin.listenerCount("data"), 0);
  assert.equal(h.stdout.listenerCount("resize"), 0);
  assert.equal(h.stdin.pauseCalls, 1);
});

test("escape_returns_other_without_exit", async () => {
  const a = await api(), h = harness();
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\x1b"));
  assert.deepEqual(await choice, { kind: "escape" });
  assert.match(visibleOutput(h.stdout), /◇ Profile  Other/);
  assert.deepEqual(h.stdin.rawCalls, [true, false]);
  assert.equal(h.stdin.listenerCount("data"), 0);
  assert.equal(h.stdout.listenerCount("resize"), 0);
  const writes = h.stdout.writes.length;
  await settleAfter(60);
  assert.equal(h.stdout.writes.length, writes);
});

test("ctrl_c_returns_cancel_without_selection_line", async () => {
  const a = await api(), h = harness();
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\x03"));
  assert.deepEqual(await choice, { kind: "cancel" });
  assert.doesNotMatch(visibleOutput(h.stdout), /◇ Profile/);
  assert.deepEqual(h.stdin.rawCalls, [true, false]);
  assert.equal(h.stdin.listenerCount("data"), 0);
  assert.equal(h.stdout.listenerCount("resize"), 0);
});

test("resize_shrink_clears_old_rows_and_preserves_id", async () => {
  const a = await api(), h = harness();
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\x1b[B"));
  const screen = new ReflowingScreen(80);
  for (const write of h.stdout.writes) screen.write(write);
  const before = h.stdout.writes.length;
  h.stdout.columns = 24;
  h.stdout.rows = 6;
  screen.resize(24);
  h.stdout.emit("resize");
  for (const write of h.stdout.writes.slice(before)) screen.write(write);
  assert.doesNotMatch(screen.text(), /pi-profile|Packages:/);
  assert.match(screen.text(), /● Development/);
  h.stdin.emit("data", Buffer.from("\r"));
  assert.deepEqual(await choice, { kind: "selected", id: "developer" });
});

test("fragmented_arrow_input_is_not_escape_and_edges_stop", async () => {
  const a = await api(), h = harness();
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\x1b"));
  h.stdin.emit("data", Buffer.from("["));
  h.stdin.emit("data", Buffer.from("B"));
  h.stdin.emit("data", Buffer.from("\x1b[B\x1b[B\x1b[B\r"));
  assert.deepEqual(await choice, { kind: "selected", id: "standard" });
});

test("error_restores_raw_mode", async () => {
  const a = await api(), h = harness();
  const broken = { ...widthTools, visibleWidth: () => { throw new Error("render failed"); } };
  await assert.rejects(
    a.createCliProfileChooser({ items, env: h.env, widthTools: broken, io: h.io }),
    /render failed/,
  );
  assert.deepEqual(h.stdin.rawCalls, [true, false]);
  assert.equal(h.stdin.listenerCount("data"), 0);
  assert.equal(h.stdout.listenerCount("resize"), 0);
});

test("no_color_removes_color_but_not_icons", async () => {
  const a = await api(), h = harness({ NO_COLOR: "1" });
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\r"));
  await choice;
  assert.doesNotMatch(h.stdout.writes.join(""), /\x1b\[[0-9;]*m/);
  assert.match(visibleOutput(h.stdout), /Research\s+🧭/);
});

test("icons_zero_removes_icons_only", async () => {
  const a = await api(), h = harness({ PI_PROFILE_ICONS: "0" });
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\r"));
  await choice;
  assert.doesNotMatch(visibleOutput(h.stdout), /🧭|💻/);
  assert.match(h.stdout.writes.join(""), /\x1b\[[0-9;]*m/);
  assert.match(visibleOutput(h.stdout), /Research/);
});

test("dumb_has_no_color", async () => {
  const a = await api(), h = harness({ TERM: "dumb" });
  const choice = a.createCliProfileChooser({ items, env: h.env, widthTools, io: h.io });
  h.stdin.emit("data", Buffer.from("\x03"));
  await choice;
  assert.doesNotMatch(h.stdout.writes.join(""), /\x1b\[[0-9;]*m/);
});
