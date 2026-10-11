export interface SelectorItem {
  id: string;
  label: string;
  description: string;
  packages?: readonly string[];
  packageWarning?: string;
}

export interface SelectorTheme {
  accent(text: string): string;
  text(text: string): string;
  muted(text: string): string;
  dim(text: string): string;
}

export interface SelectorWidth {
  visibleWidth(text: string): number;
  truncateToWidth(text: string, width: number, ellipsis?: string): string;
  wrapTextWithAnsi(text: string, width: number): string[];
}

export interface SelectorLayoutInput {
  items: readonly SelectorItem[];
  selectedId: string;
  width: number;
  height: number;
  icons: boolean;
  hints: readonly string[];
  theme: SelectorTheme;
  widthTools: SelectorWidth;
}

export interface SelectorLayout {
  lines: string[];
  firstVisibleIndex: number;
  selectedRow: number;
  descriptionStartRow: number | null;
}

const PROFILE_ICONS: Readonly<Record<string, string>> = Object.freeze({
  research: "🧭",
  specification: "📐",
  developer: "💻",
  chore: "🧹",
});

function terminalSize(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}

/** Strip terminal controls from catalog-owned text before applying trusted theme functions. */
function displayText(value: string): string {
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, "")
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b(?:[ -/][@-~]|[@-_])/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

function fit(text: string, width: number, widthTools: SelectorWidth): string {
  return widthTools.visibleWidth(text) <= width
    ? text
    : widthTools.truncateToWidth(text, width, "…");
}

function prefixedLine(
  prefix: string,
  text: string,
  width: number,
  style: (value: string) => string,
  theme: SelectorTheme,
  widthTools: SelectorWidth,
): string {
  return fit(theme.dim(prefix) + style(text), width, widthTools);
}

function wrappedContent(text: string, width: number, lines: number, widthTools: SelectorWidth): string[] {
  const wrapped = widthTools.wrapTextWithAnsi(displayText(text), Math.max(1, width));
  const result = wrapped.slice(0, lines);
  while (result.length < lines) result.push("");
  if (wrapped.length > lines && result.length > 0) {
    result[result.length - 1] = widthTools.truncateToWidth(`${result[result.length - 1]}…`, Math.max(1, width), "…");
  }
  return result;
}

export function profileIcon(id: string, enabled: boolean): string | undefined {
  return enabled && Object.hasOwn(PROFILE_ICONS, id) ? PROFILE_ICONS[id] : undefined;
}

function itemDisplay(
  item: SelectorItem,
  width: number,
  icons: boolean,
  alignedLabelWidth: number,
  availableWidth: number,
  widthTools: SelectorWidth,
): string {
  const label = displayText(item.label);
  const icon = profileIcon(item.id, icons && width >= 40);
  if (!icon) return label;
  const withIcon = width < 80
    ? `${label} ${icon}`
    : `${label}${" ".repeat(Math.max(1, alignedLabelWidth - widthTools.visibleWidth(label) + 1))}${icon}`;
  return widthTools.visibleWidth(withIcon) <= availableWidth ? withIcon : label;
}

function packageText(item: SelectorItem, width: number): string {
  if (width < 40) return "";
  if (item.packageWarning) return displayText(item.packageWarning);
  if (item.packages === undefined) return "";
  if (width < 80) return `Packages: ${item.packages.length}件`;
  return `Packages: ${item.packages.map(displayText).join(", ")}`;
}

function footerLines(
  hints: readonly string[],
  position: string | undefined,
  width: number,
  theme: SelectorTheme,
  widthTools: SelectorWidth,
): string[] {
  const parts = hints.map(displayText).filter(Boolean);
  if (position) parts.unshift(position);
  const content = parts.join("  ·  ");
  const contentWidth = Math.max(1, width - 3);
  const wrapped = widthTools.wrapTextWithAnsi(content, contentWidth);
  const rows = wrapped.length > 0 ? wrapped : [""];
  return rows.map((row, index) => fit(theme.dim(`${index === 0 ? "└  " : "   "}${row}`), width, widthTools));
}

interface Allocation {
  header: boolean;
  description: boolean;
  packageRow: boolean;
  footerSeparator: boolean;
  optionCapacity: number;
  footerCapacity: number;
}

function allocate(height: number, itemCount: number, requestedFooterRows: number): Allocation {
  let header = true;
  let description = true;
  let packageRow = true;
  let footerSeparator = true;
  let footerCapacity = requestedFooterRows;
  const details = () => (description || packageRow ? 1 : 0) + (description ? 2 : 0) + (packageRow ? 1 : 0);
  const total = () => (header ? 4 : 0) + itemCount + details() + (footerSeparator ? 1 : 0) + footerCapacity;

  if (total() > height) header = false;
  if (total() > height) packageRow = false;
  if (total() > height) description = false;
  if (total() > height) footerSeparator = false;

  const fixedRows = (header ? 4 : 0) + details() + (footerSeparator ? 1 : 0);
  let optionCapacity = Math.min(itemCount, Math.max(itemCount > 0 ? 1 : 0, height - fixedRows - footerCapacity));
  if (fixedRows + optionCapacity + footerCapacity > height) {
    footerCapacity = Math.max(0, height - fixedRows - optionCapacity);
  }
  if (fixedRows + optionCapacity + footerCapacity > height) {
    optionCapacity = Math.max(0, height - fixedRows - footerCapacity);
  }
  return { header, description, packageRow, footerSeparator, optionCapacity, footerCapacity };
}

export function renderProfileSelector(input: SelectorLayoutInput): SelectorLayout {
  const width = terminalSize(input.width);
  const height = terminalSize(input.height);
  const matchedIndex = input.items.findIndex(item => item.id === input.selectedId);
  const selectedIndex = matchedIndex >= 0 ? matchedIndex : 0;
  const selectedItem = input.items[selectedIndex];
  const alignedLabelWidth = input.items.reduce(
    (maximum, item) => profileIcon(item.id, input.icons)
      ? Math.max(maximum, input.widthTools.visibleWidth(displayText(item.label)))
      : maximum,
    0,
  );

  let footer = footerLines(input.hints, undefined, width, input.theme, input.widthTools);
  let allocation = allocate(height, input.items.length, footer.length);
  if (allocation.optionCapacity < input.items.length && selectedItem) {
    footer = footerLines(
      input.hints,
      `${selectedIndex + 1}/${input.items.length}`,
      width,
      input.theme,
      input.widthTools,
    );
    allocation = allocate(height, input.items.length, footer.length);
  }

  const firstVisibleIndex = allocation.optionCapacity === 0
    ? 0
    : Math.min(
      Math.max(0, selectedIndex - Math.floor(allocation.optionCapacity / 2)),
      Math.max(0, input.items.length - allocation.optionCapacity),
    );
  const visibleItems = input.items.slice(firstVisibleIndex, firstVisibleIndex + allocation.optionCapacity);
  const lines: string[] = [];

  if (allocation.header) {
    lines.push(fit(input.theme.dim("pi-profile"), width, input.widthTools));
    lines.push(fit(input.theme.dim("│"), width, input.widthTools));
    lines.push(fit(input.theme.accent(width < 40 ? "◆ Profile" : "◆ 今日は何をしますか？"), width, input.widthTools));
    lines.push(fit(input.theme.dim("│"), width, input.widthTools));
  }

  const optionStartRow = lines.length;
  for (const item of visibleItems) {
    const selected = item === selectedItem;
    const marker = selected ? "● " : "  ";
    const content = marker + itemDisplay(
      item, width, input.icons, alignedLabelWidth, Math.max(1, width - 5), input.widthTools,
    );
    lines.push(prefixedLine("│  ", content, width, selected ? input.theme.accent : input.theme.text, input.theme, input.widthTools));
  }

  let descriptionStartRow: number | null = null;
  if ((allocation.description || allocation.packageRow) && selectedItem) {
    lines.push(fit(input.theme.dim("│"), width, input.widthTools));
    if (allocation.description) {
      descriptionStartRow = lines.length;
      const contentWidth = Math.max(1, width - 3);
      for (const row of wrappedContent(selectedItem.description, contentWidth, 2, input.widthTools)) {
        lines.push(prefixedLine("│  ", row, width, input.theme.muted, input.theme, input.widthTools));
      }
    }
    if (allocation.packageRow) {
      lines.push(prefixedLine("│  ", packageText(selectedItem, width), width, input.theme.muted, input.theme, input.widthTools));
    }
  }

  if (allocation.footerSeparator) lines.push(fit(input.theme.dim("│"), width, input.widthTools));
  lines.push(...footer.slice(0, allocation.footerCapacity));

  return {
    lines: lines.slice(0, height),
    firstVisibleIndex,
    selectedRow: selectedItem && allocation.optionCapacity > 0
      ? optionStartRow + selectedIndex - firstVisibleIndex
      : -1,
    descriptionStartRow,
  };
}

export function renderProfileSelection(
  item: SelectorItem,
  width: number,
  icons: boolean,
  theme: SelectorTheme,
  widthTools: SelectorWidth,
): string {
  const normalizedWidth = terminalSize(width);
  const label = displayText(item.label);
  const withoutIcon = `◇ Profile  ${label}`;
  const icon = profileIcon(item.id, icons && normalizedWidth >= 40);
  const withIcon = icon ? `${withoutIcon} ${icon}` : withoutIcon;
  const text = widthTools.visibleWidth(withIcon) <= normalizedWidth ? withIcon : withoutIcon;
  return fit(theme.accent(text), normalizedWidth, widthTools);
}
