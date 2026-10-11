import test from "node:test";
import assert from "node:assert/strict";
import { chooseProfileInPi } from "../../extensions/startup-profile/selector-ui.ts";
import type { SelectorItem } from "../../extensions/startup-profile/selector-layout.ts";

const ITEMS: readonly SelectorItem[] = [
  { id: "first", label: "同じ名前", description: "first description" },
  { id: "second", label: "同じ名前", description: "second description" },
];

type SelectorComponent = {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  dispose?(): void;
};

function selectorHarness(options: {
  rows?: number;
  bindings?: Partial<Record<"tui.select.up" | "tui.select.down" | "tui.select.confirm" | "tui.select.cancel", string[]>>;
} = {}) {
  const bindings = {
    "tui.select.up": ["up"],
    "tui.select.down": ["down"],
    "tui.select.confirm": ["enter"],
    "tui.select.cancel": ["escape"],
    ...options.bindings,
  };
  let accent = "accent-1";
  let component: SelectorComponent | undefined;
  let customCalls = 0;
  let doneCalls = 0;
  let renders = 0;
  const tui = {
    terminal: { rows: options.rows ?? 24 },
    requestRender: () => { renders++; },
  };
  const theme = {
    fg: (_color: string, text: string) => `\x1b[${accent === "accent-1" ? "31" : "32"}m${text}\x1b[0m`,
    bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  };
  const keybindings = {
    matches: (data: string, action: keyof typeof bindings) => bindings[action].includes(data),
    getKeys: (action: keyof typeof bindings) => bindings[action],
  };
  const ctx: any = {
    ui: {
      custom: (factory: Function) => {
        customCalls++;
        return new Promise(resolve => {
          const done = (value: string | undefined) => {
            doneCalls++;
            component?.dispose?.();
            resolve(value);
          };
          component = factory(tui, theme, keybindings, done);
        });
      },
    },
  };
  return {
    ctx,
    tui,
    get component() { return component; },
    get customCalls() { return customCalls; },
    get doneCalls() { return doneCalls; },
    get renders() { return renders; },
    setAccent(value: string) { accent = value; },
  };
}

function trackedSignal(controller: AbortController) {
  const signal = controller.signal;
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  let listeners = 0;
  Object.defineProperty(signal, "addEventListener", {
    configurable: true,
    value(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean) {
      if (type === "abort") listeners++;
      return originalAdd(type, listener, options);
    },
  });
  Object.defineProperty(signal, "removeEventListener", {
    configurable: true,
    value(type: string, listener: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean) {
      if (type === "abort") listeners--;
      return originalRemove(type, listener, options);
    },
  });
  return { signal, get listeners() { return listeners; } };
}

test("keydown returns the selected ID even when labels are duplicated", async () => {
  const h = selectorHarness();
  const pending = chooseProfileInPi(h.ctx, ITEMS, new AbortController().signal, true);
  h.component?.handleInput?.("down");
  h.component?.handleInput?.("enter");
  assert.equal(await pending, "second");
  assert.equal(h.doneCalls, 1);
});

test("abort_before_open_skips_custom", async () => {
  const h = selectorHarness();
  const controller = new AbortController();
  controller.abort();
  assert.equal(await chooseProfileInPi(h.ctx, ITEMS, controller.signal, true), undefined);
  assert.equal(h.customCalls, 0);
  assert.equal(h.doneCalls, 0);
});

test("dispose_removes_abort_listener_and_late_keys_are_ignored", async () => {
  const h = selectorHarness();
  const controller = new AbortController();
  const tracked = trackedSignal(controller);
  const pending = chooseProfileInPi(h.ctx, ITEMS, tracked.signal, true);
  const component = h.component;
  assert.equal(tracked.listeners, 1);
  component?.dispose?.();
  assert.equal(await pending, undefined);
  assert.equal(tracked.listeners, 0);
  assert.equal(h.doneCalls, 1);
  component?.handleInput?.("down");
  component?.handleInput?.("enter");
  controller.abort();
  assert.equal(h.doneCalls, 1);
});

test("custom_keybindings_drive_input_and_footer", async () => {
  const h = selectorHarness({ bindings: {
    "tui.select.up": ["k"],
    "tui.select.down": ["j"],
    "tui.select.confirm": ["y"],
    "tui.select.cancel": ["n"],
  } });
  const pending = chooseProfileInPi(h.ctx, ITEMS, new AbortController().signal, false);
  const initial = h.component?.render(80).join("\n") ?? "";
  assert.match(initial, /k\/j 選択/);
  assert.match(initial, /y 開始/);
  assert.match(initial, /n Other/);
  h.component?.handleInput?.("j");
  assert.match(h.component?.render(80).join("\n") ?? "", /● 同じ名前[\s\S]*second description/);
  h.component?.handleInput?.("y");
  assert.equal(await pending, "second");
});

test("theme_invalidation_rebuilds_colors", async () => {
  const h = selectorHarness();
  const pending = chooseProfileInPi(h.ctx, ITEMS, new AbortController().signal, false);
  assert.match(h.component?.render(80).join("\n") ?? "", /\x1b\[31m/);
  h.setAccent("accent-2");
  h.component?.invalidate();
  const recolored = h.component?.render(80).join("\n") ?? "";
  assert.match(recolored, /\x1b\[32m/);
  assert.doesNotMatch(recolored, /\x1b\[31m/);
  h.component?.dispose?.();
  await pending;
});

test("resize_keeps_selected_id", async () => {
  const h = selectorHarness();
  const pending = chooseProfileInPi(h.ctx, ITEMS, new AbortController().signal, true);
  h.component?.handleInput?.("down");
  assert.match(h.component?.render(80).join("\n") ?? "", /second description/);
  assert.match(h.component?.render(24).join("\n") ?? "", /同じ名前/);
  h.component?.handleInput?.("enter");
  assert.equal(await pending, "second");
});
