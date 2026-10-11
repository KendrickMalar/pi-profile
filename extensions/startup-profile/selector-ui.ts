import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
  SelectList,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type SelectItem,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  renderProfileSelector,
  type SelectorItem,
  type SelectorTheme,
  type SelectorWidth,
} from "./selector-layout.ts";

const widthTools: SelectorWidth = { visibleWidth, truncateToWidth, wrapTextWithAnsi };

function keyLabel(key: string): string {
  const known: Readonly<Record<string, string>> = {
    up: "↑",
    down: "↓",
    enter: "Enter",
    return: "Enter",
    escape: "Esc",
    esc: "Esc",
  };
  if (known[key]) return known[key];
  return key.replace(/^ctrl\+(.+)$/u, (_match, value: string) => `Ctrl+${value.toUpperCase()}`);
}

function keysFor(keybindings: KeybindingsManager, action: "tui.select.up" | "tui.select.down" | "tui.select.confirm" | "tui.select.cancel"): string {
  return keybindings.getKeys(action).map(key => keyLabel(String(key))).join("/");
}

function selectorTheme(theme: Theme): SelectorTheme {
  return {
    accent: text => theme.fg("accent", theme.bold(text)),
    text: text => theme.fg("text", text),
    muted: text => theme.fg("muted", text),
    dim: text => theme.fg("dim", text),
  };
}

class ProfileSelectorComponent {
  private readonly list: SelectList;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly keybindings: KeybindingsManager;
  private readonly layoutItems: readonly SelectorItem[];
  private readonly icons: boolean;
  private readonly finish: (value: string | undefined) => void;
  private closed = false;

  constructor(
    tui: TUI,
    theme: Theme,
    keybindings: KeybindingsManager,
    items: readonly SelectorItem[],
    layoutItems: readonly SelectorItem[],
    icons: boolean,
    finish: (value: string | undefined) => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.layoutItems = layoutItems;
    this.icons = icons;
    this.finish = finish;
    const selectItems: SelectItem[] = items.map(item => ({ value: item.id, label: item.label }));
    this.list = new SelectList(
      selectItems,
      Math.max(1, selectItems.length),
      {
        selectedPrefix: text => text,
        selectedText: text => text,
        description: text => text,
        scrollInfo: text => text,
        noMatch: text => text,
      },
    );
    this.list.onSelect = item => this.complete(item.value);
    this.list.onCancel = () => this.complete(undefined);
    this.list.onSelectionChange = () => this.tui.requestRender();
  }

  private complete(value: string | undefined): void {
    if (this.closed) return;
    this.closed = true;
    this.finish(value);
  }

  cancel(): void {
    this.complete(undefined);
  }

  handleInput(data: string): void {
    if (this.closed) return;
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.move(-1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      this.move(1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const selected = this.list.getSelectedItem();
      if (selected) this.complete(selected.value);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.complete(undefined);
      return;
    }
    this.list.handleInput(data);
  }

  private move(offset: -1 | 1): void {
    const selected = this.list.getSelectedItem();
    if (!selected || this.layoutItems.length === 0) return;
    const current = this.layoutItems.findIndex(item => item.id === selected.value);
    const next = (current + offset + this.layoutItems.length) % this.layoutItems.length;
    this.list.setSelectedIndex(next);
    const nextItem = this.list.getSelectedItem();
    if (nextItem) this.list.onSelectionChange?.(nextItem);
  }

  render(width: number): string[] {
    const selectedId = this.list.getSelectedItem()?.value ?? "";
    return renderProfileSelector({
      items: this.layoutItems,
      selectedId,
      width,
      height: this.tui.terminal.rows,
      icons: this.icons,
      hints: [
        `${keysFor(this.keybindings, "tui.select.up")}/${keysFor(this.keybindings, "tui.select.down")} 選択`,
        `${keysFor(this.keybindings, "tui.select.confirm")} 開始`,
        `${keysFor(this.keybindings, "tui.select.cancel")} Other`,
      ],
      theme: selectorTheme(this.theme),
      widthTools,
    }).lines;
  }

  invalidate(): void {
    this.list.invalidate();
  }

  dispose(): void {
    this.complete(undefined);
  }
}

/** Open the in-Pi profile selector. Selection values are profile IDs; cancellation and abort return undefined. */
export async function chooseProfileInPi(
  ctx: ExtensionContext,
  items: readonly SelectorItem[],
  signal: AbortSignal,
  icons: boolean,
): Promise<string | undefined> {
  if (signal.aborted) return undefined;
  return ctx.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
    let settled = false;
    let component: ProfileSelectorComponent | undefined;
    const settle = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      done(value);
    };
    const onAbort = () => component?.cancel();
    signal.addEventListener("abort", onAbort, { once: true });
    component = new ProfileSelectorComponent(tui, theme, keybindings, items, items, icons, settle);
    if (signal.aborted) component.cancel();
    return component;
  });
}
