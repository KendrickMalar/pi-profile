import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  renderProfileSelection,
  renderProfileSelector,
  type SelectorItem,
  type SelectorTheme,
  type SelectorWidth,
} from "../extensions/startup-profile/selector-layout.ts";
import type { PiHost } from "./pi-host.ts";
import type { ProfileChoice } from "./select-profile.ts";

export interface CliSelectorIO {
  stdin: Pick<NodeJS.ReadStream, "isTTY" | "isRaw" | "setRawMode" | "resume" | "pause" | "on" | "off">;
  stdout: Pick<NodeJS.WriteStream, "isTTY" | "columns" | "rows" | "write" | "on" | "off">;
}

interface CliProfileChooserInput {
  items: readonly SelectorItem[];
  env: NodeJS.ProcessEnv;
  widthTools: SelectorWidth;
  io: CliSelectorIO;
}

const ESCAPE_DELAY_MS = 40;
function cliTheme(color: boolean): SelectorTheme {
  if (!color) return { accent: value => value, text: value => value, muted: value => value, dim: value => value };
  return {
    accent: value => `\x1b[36;1m${value}\x1b[22;39m`,
    text: value => value,
    muted: value => `\x1b[2m${value}\x1b[22m`,
    dim: value => `\x1b[2m${value}\x1b[22m`,
  };
}

function selectorEntry(packageRoot: string): string {
  let directory = packageRoot;
  for (;;) {
    const root = join(directory, "node_modules/@earendil-works/pi-tui");
    const manifestPath = join(root, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const entry = manifest.exports?.["."]?.import ?? manifest.main;
      if (typeof entry !== "string") throw new Error("対象PiのTUI公開入口がありません");
      const path = realpathSync(resolve(root, entry));
      const rel = relative(root, path);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("対象PiのTUI公開入口がpackage rootから逸脱しています");
      return path;
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("対象PiのTUI依存が見つかりません");
    directory = parent;
  }
}

async function loadWidthTools(host: PiHost): Promise<SelectorWidth> {
  const tui = await import(pathToFileURL(selectorEntry(host.packageRoot)).href) as Partial<SelectorWidth>;
  if (
    typeof tui.visibleWidth !== "function"
    || typeof tui.truncateToWidth !== "function"
    || typeof tui.wrapTextWithAnsi !== "function"
  ) throw new Error("対象PiのTUI幅ユーティリティが不足しています");
  return {
    visibleWidth: tui.visibleWidth,
    truncateToWidth: tui.truncateToWidth,
    wrapTextWithAnsi: tui.wrapTextWithAnsi,
  };
}

export function createCliProfileChooser(input: CliProfileChooserInput): Promise<ProfileChoice> {
  const { items, env, widthTools, io } = input;
  if (!io.stdin.isTTY || !io.stdout.isTTY) {
    return Promise.reject(new Error("選択には端末が必要です。--sessionまたは--profileを指定してください"));
  }
  if (items.length === 0) return Promise.reject(new Error("選択候補がありません"));

  const icons = env.PI_PROFILE_ICONS !== "0";
  const color = !(env.NO_COLOR && env.NO_COLOR.length > 0) && env.TERM !== "dumb";
  const theme = cliTheme(color);
  const originalRawMode = Boolean(io.stdin.isRaw);
  let selectedIndex = 0;
  let renderedLines: string[] = [];
  let buffer = "";
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  return new Promise<ProfileChoice>((resolveChoice, rejectChoice) => {
    const clearEscapeTimer = () => {
      if (!escapeTimer) return;
      clearTimeout(escapeTimer);
      escapeTimer = undefined;
    };
    const occupiedRows = (lines: readonly string[], width: number) => lines.reduce(
      (count, line) => count + Math.max(1, Math.ceil(widthTools.visibleWidth(line) / width)),
      0,
    );
    const clearRenderedRows = () => {
      const width = Math.max(1, io.stdout.columns ?? 80);
      const height = Math.max(1, io.stdout.rows ?? 24);
      const rows = Math.min(height, occupiedRows(renderedLines, width));
      if (rows === 0) return;
      if (rows > 1) io.stdout.write(`\x1b[${rows - 1}A`);
      io.stdout.write("\r");
      for (let index = 0; index < rows; index++) {
        io.stdout.write("\x1b[2K");
        if (index < rows - 1) io.stdout.write("\x1b[1B\r");
      }
      if (rows > 1) io.stdout.write(`\x1b[${rows - 1}A`);
      io.stdout.write("\r");
      renderedLines = [];
    };
    const cleanup = () => {
      clearEscapeTimer();
      io.stdin.off("data", onData);
      io.stdout.off("resize", onResize);
      try {
        clearRenderedRows();
      } finally {
        try {
          io.stdin.setRawMode(originalRawMode);
        } finally {
          io.stdin.pause();
        }
      }
    };
    const finish = (choice: ProfileChoice, error?: unknown) => {
      if (finished) return;
      finished = true;
      try {
        cleanup();
        if (!error && choice.kind !== "cancel") {
          const selected = choice.kind === "selected"
            ? items.find(item => item.id === choice.id)
            : items.find(item => item.id === "standard") ?? { id: "standard", label: "Other", description: "" };
          if (selected) {
            const width = Math.max(1, io.stdout.columns ?? 80);
            io.stdout.write(`${renderProfileSelection(selected, width, icons, theme, widthTools)}\n`);
          }
        }
      } catch (cleanupError) {
        rejectChoice(error ?? cleanupError);
        return;
      }
      if (error) rejectChoice(error);
      else resolveChoice(choice);
    };
    const render = () => {
      const width = Math.max(1, io.stdout.columns ?? 80);
      const height = Math.max(1, io.stdout.rows ?? 24);
      const layout = renderProfileSelector({
        items,
        selectedId: items[selectedIndex].id,
        width,
        height,
        icons,
        hints: ["↑↓ 選択", "Enter 開始", "Esc Other", "Ctrl-C 中止"],
        theme,
        widthTools,
      });
      clearRenderedRows();
      for (let index = 0; index < layout.lines.length; index++) {
        io.stdout.write(`\x1b[2K${layout.lines[index]}`);
        if (index < layout.lines.length - 1) io.stdout.write("\r\n");
      }
      renderedLines = [...layout.lines];
    };
    const safelyRender = () => {
      try { render(); }
      catch (error) { finish({ kind: "cancel" }, error); }
    };
    const scheduleEscape = () => {
      clearEscapeTimer();
      escapeTimer = setTimeout(() => finish({ kind: "escape" }), ESCAPE_DELAY_MS);
    };
    const onData = (chunk: string | Buffer) => {
      if (finished) return;
      buffer += chunk.toString();
      clearEscapeTimer();
      while (buffer && !finished) {
        if (buffer.startsWith("\x1b[A")) {
          selectedIndex = Math.max(0, selectedIndex - 1);
          buffer = buffer.slice(3);
          safelyRender();
        } else if (buffer.startsWith("\x1b[B")) {
          selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
          buffer = buffer.slice(3);
          safelyRender();
        } else if (buffer === "\x1b" || buffer === "\x1b[") {
          scheduleEscape();
          break;
        } else {
          const key = buffer[0];
          buffer = buffer.slice(1);
          if (key === "\x03") finish({ kind: "cancel" });
          else if (key === "\r" || key === "\n") finish({ kind: "selected", id: items[selectedIndex].id });
          else if (key === "\x1b") finish({ kind: "escape" });
        }
      }
    };
    const onResize = () => {
      if (!finished) safelyRender();
    };

    try {
      io.stdin.setRawMode(true);
      io.stdin.resume();
      io.stdin.on("data", onData);
      io.stdout.on("resize", onResize);
      render();
    } catch (error) {
      finish({ kind: "cancel" }, error);
    }
  });
}

export async function chooseProfileInCli(
  items: readonly SelectorItem[],
  host: PiHost,
  env: NodeJS.ProcessEnv,
): Promise<ProfileChoice> {
  const widthTools = await loadWidthTools(host);
  return createCliProfileChooser({
    items,
    env,
    widthTools,
    io: { stdin: process.stdin, stdout: process.stdout },
  });
}
