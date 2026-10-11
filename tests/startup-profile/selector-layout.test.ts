import test from "node:test";
import assert from "node:assert/strict";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  profileIcon,
  renderProfileSelection,
  renderProfileSelector,
  type SelectorItem,
  type SelectorTheme,
  type SelectorWidth,
} from "../../extensions/startup-profile/selector-layout.ts";

const theme: SelectorTheme = {
  accent: text => text,
  text: text => text,
  muted: text => text,
  dim: text => text,
};
const widthTools: SelectorWidth = { visibleWidth, truncateToWidth, wrapTextWithAnsi };

const profiles: readonly SelectorItem[] = [
  { id: "research", label: "Research", description: "調査と情報整理を中心に支援" },
  { id: "specification", label: "Specification", description: "要件と仕様を明確化" },
  { id: "developer", label: "Development", description: "コード・設計・検証を中心に支援" },
  { id: "chore", label: "Chore", description: "日常的な雑務を支援" },
  { id: "standard", label: "Other", description: "用途別の指示を追加しない" },
];

function render(items: readonly SelectorItem[], selectedId: string, width = 80, height = 24) {
  return renderProfileSelector({
    items,
    selectedId,
    width,
    height,
    icons: true,
    hints: ["↑↓ 選択", "Enter 開始", "Esc Other"],
    theme,
    widthTools,
  });
}

test("keeps_description_rows_fixed_when_selection_changes", () => {
  const results = profiles.map(item => render(profiles, item.id));
  assert.deepEqual(new Set(results.map(result => result.lines.length)).size, 1);
  assert.deepEqual(new Set(results.map(result => result.descriptionStartRow)).size, 1);
  assert.notEqual(results[0].descriptionStartRow, null);

  for (const [index, result] of results.entries()) {
    assert.match(result.lines[result.selectedRow] ?? "", /●/);
    assert.ok(result.lines[result.selectedRow]?.includes(profiles[index].label));
    for (const [otherIndex, item] of profiles.entries()) {
      if (otherIndex !== index) assert.ok(!result.lines[result.selectedRow]?.includes(item.label));
    }
  }
});

test("fits_width_and_height_for_cjk_emoji_and_long_packages", () => {
  const items: readonly SelectorItem[] = Array.from({ length: 12 }, (_, index) => ({
    id: index === 6 ? "developer" : `custom-${index}`,
    label: `${index} 日本語 e\u0301 family 👨‍👩‍👧‍👦 ${"長い名前".repeat(index + 1)}`,
    description: `複合絵文字 👩🏽‍💻 と結合文字 e\u0301 を含む説明 ${"詳細".repeat(20)}`,
    packages: Array.from({ length: 16 }, (__, packageIndex) => `@example/非常に長い-package-${index}-${packageIndex}`),
  }));

  for (const requestedWidth of [1, 24, 39, 40, 79, 80, 120, 0, -10]) {
    for (const height of [1, 6, 12, 24]) {
      const result = renderProfileSelector({
        items,
        selectedId: "developer",
        width: requestedWidth,
        height,
        icons: true,
        hints: ["↑↓ 選択", "Enter 開始", "Esc Other", "Ctrl-C 中止"],
        theme,
        widthTools,
      });
      const width = Math.max(1, requestedWidth);
      assert.ok(result.lines.length <= height, `height ${height}, width ${requestedWidth}`);
      assert.ok(result.lines.every(line => visibleWidth(line) <= width), `width ${requestedWidth}, height ${height}`);
      assert.ok(result.firstVisibleIndex >= 0 && result.firstVisibleIndex <= 6);
      assert.ok(result.selectedRow >= 0 && result.selectedRow < result.lines.length);
    }
  }
});

test("unknown_id_and_icon_off_keep_labels_and_ids", () => {
  assert.equal(profileIcon("research", true), "🧭");
  assert.equal(profileIcon("specification", true), "📐");
  assert.equal(profileIcon("developer", true), "💻");
  assert.equal(profileIcon("chore", true), "🧹");
  assert.equal(profileIcon("standard", true), undefined);
  assert.equal(profileIcon("custom-focus", true), undefined);
  assert.equal(profileIcon("developer", false), undefined);

  const item = { id: "custom-focus", label: "独自 Focus", description: "custom" };
  const result = renderProfileSelector({
    items: [item], selectedId: item.id, width: 80, height: 24, icons: false,
    hints: ["Enter 開始"], theme, widthTools,
  });
  assert.ok(result.lines[result.selectedRow]?.includes(item.label));
  assert.ok(!result.lines.join("\n").includes(item.id));
  assert.equal(renderProfileSelection(item, 80, false, theme, widthTools), "◇ Profile  独自 Focus");
});

test("duplicate_labels_keep_distinct_selected_ids", () => {
  const items = [
    { id: "first", label: "同じ名前", description: "first description" },
    { id: "second", label: "同じ名前", description: "second description" },
  ] as const;
  const first = render(items, "first");
  const second = render(items, "second");
  assert.notEqual(first.selectedRow, second.selectedRow);
  assert.ok(first.lines[first.selectedRow]?.includes("●"));
  assert.ok(second.lines[second.selectedRow]?.includes("●"));
  assert.ok(first.lines.slice(first.descriptionStartRow ?? 0).join("\n").includes("first description"));
  assert.ok(second.lines.slice(second.descriptionStartRow ?? 0).join("\n").includes("second description"));
});

test("display_controls_are_removed_without_mutating_input", () => {
  const items: readonly SelectorItem[] = [{
    id: "developer",
    label: "Dev\x1b[31m red\x00",
    description: "line\nnext\x1b]0;title\x07 safe",
    packages: ["pkg\x1b[2J-name", "tab\tname"],
    packageWarning: "warn\r\x1b[1mbold",
  }];
  const hints = ["Enter\x1b[31m 開始", "Esc\nOther"] as const;
  const before = structuredClone({ items, hints });
  const result = renderProfileSelector({
    items, selectedId: "developer", width: 120, height: 24, icons: true,
    hints, theme, widthTools,
  });
  const selection = renderProfileSelection(items[0], 120, true, theme, widthTools);
  const output = [...result.lines, selection].join("\n");

  assert.deepEqual({ items, hints }, before);
  assert.ok(output.includes("Dev red"));
  assert.ok(output.includes("pkg-name") || output.includes("warnbold"));
  assert.doesNotMatch(output, /\x1b|\x00|\x07|\r|\t|\[31m|\[2J|\[1m/);
});
