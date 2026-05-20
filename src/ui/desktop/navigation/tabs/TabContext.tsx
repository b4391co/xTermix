import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { TabContextTab, TerminalRefHandle } from "../../../types/index.js";

export type Tab = TabContextTab;
export type SplitDirection = "horizontal" | "vertical";
export type SplitNode =
  | { kind: "leaf"; tabId: number }
  | {
      kind: "split";
      direction: SplitDirection;
      first: SplitNode;
      second: SplitNode;
    };

const DESKTOP_STATE_KEY = "termix.desktop.tabs.v3";

function getDesktopStateApiUrl(): string {
  if (typeof window === "undefined") return "/users/desktop-state";

  const configuredServerUrl = (window as any).configuredServerUrl as
    | string
    | undefined;
  if (configuredServerUrl) {
    const base = configuredServerUrl.replace(/\/$/, "");
    try {
      const url = new URL(base);
      const isBackendPort = ["30001", "8443"].includes(url.port);
      const isLocalhost =
        url.hostname === "localhost" || url.hostname === "127.0.0.1";
      const isLanIp = url.hostname === "127.0.0.1";
      const prefix = isBackendPort || isLocalhost || isLanIp ? "" : "/api";
      return `${base}${prefix}/users/desktop-state`;
    } catch {
      return `${base}/users/desktop-state`;
    }
  }

  const host = window.location.hostname;
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  const isLanIp = host === "127.0.0.1";
  const shouldUseProxyPaths = window.location.port === "" && !isLocalhost && !isLanIp;
  if (shouldUseProxyPaths) {
    return `${window.location.origin}/api/users/desktop-state`;
  }

  if (window.location.port === "5173") {
    const protocol = window.location.protocol === "https:" ? "https" : "http";
    const port = protocol === "https" ? "8443" : "30001";
    return `${protocol}://${host}:${port}/users/desktop-state`;
  }

  return `${window.location.origin}/users/desktop-state`;
}

async function fetchServerDesktopState(): Promise<any | null> {
  const token = localStorage.getItem("jwt");
  if (!token) return null;

  const response = await fetch(getDesktopStateApiUrl(), {
    credentials: "include",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.state || null;
}

async function saveServerDesktopState(state: any): Promise<void> {
  const token = localStorage.getItem("jwt");
  if (!token) return;

  await fetch(getDesktopStateApiUrl(), {
    method: "PUT",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ state }),
  });
}

function buildPersistentShellCommand(sessionId: string): string {
  const safeSession = (sessionId || "termix_default").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
  return `if command -v tmux >/dev/null 2>&1; then tmux new-session -Ad -s "${safeSession}"; tmux set-option -t "${safeSession}" -g mouse on; tmux set-option -t "${safeSession}" -g xterm-keys on 2>/dev/null || true; tmux set-option -t "${safeSession}" -g extended-keys on 2>/dev/null || true; tmux set-option -t "${safeSession}" -as terminal-features "xterm-256color:extkeys" 2>/dev/null || true; tmux attach-session -t "${safeSession}"; elif command -v screen >/dev/null 2>&1; then screen -xRR "${safeSession}"; else echo "[Termix] tmux/screen no disponible; esta terminal no sera persistente al recargar."; fi`;
}

interface TabContextType {
  tabs: Tab[];
  currentTab: number | null;
  allSplitScreenTab: number[];
  splitLayout: SplitNode | null;
  splitLayouts: Record<number, SplitNode>;
  splitPanelSizes: Record<string, number[]>;
  focusedSplitTabId: number | null;
  recentTerminalTabs: Array<{ title: string; hostConfig: any }>;
  addTab: (tab: Omit<Tab, "id">) => number;
  removeTab: (tabId: number) => void;
  closeTabGroup: (tabId: number) => void;
  setCurrentTab: (tabId: number) => void;
  setSplitScreenTab: (tabId: number) => void;
  splitFocusedPane: (direction: SplitDirection) => void;
  openNewTerminalFromFocused: () => void;
  setFocusedSplitTab: (tabId: number) => void;
  closeFocusedPane: () => void;
  moveFocusedPane: (direction: "left" | "right" | "up" | "down") => void;
  updateSplitPanelSizes: (panelKey: string, sizes: number[]) => void;
  swapPaneTabs: (sourceTabId: number, targetTabId: number) => void;
  renameTab: (tabId: number, newTitle: string) => void;
  getSessionRootForTab: (tabId: number) => number;
  resolveSplitPickerToTerminal: (
    pickerTabId: number,
    payload: { title: string; hostConfig: any },
  ) => void;
  cancelSplitPicker: (pickerTabId: number) => void;
  getTab: (tabId: number) => Tab | undefined;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateHostConfig: (
    hostId: number,
    newHostConfig: {
      id: number;
      name?: string;
      username: string;
      ip: string;
      port: number;
    },
  ) => void;
  updateTab: (tabId: number, updates: Partial<Omit<Tab, "id">>) => void;
  previewTerminalTheme: string | null;
  setPreviewTerminalTheme: (theme: string | null) => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

type ElectronWindow = Window & {
  electronAPI?: unknown;
};

export function useTabs() {
  const context = useContext(TabContext);
  if (context === undefined) {
    throw new Error("useTabs must be used within a TabProvider");
  }
  return context;
}

interface TabProviderProps {
  children: ReactNode;
}

function collectLeafIds(node: SplitNode): number[] {
  if (node.kind === "leaf") return [node.tabId];
  return [...collectLeafIds(node.first), ...collectLeafIds(node.second)];
}

function hasLeaf(node: SplitNode, tabId: number): boolean {
  if (node.kind === "leaf") return node.tabId === tabId;
  return hasLeaf(node.first, tabId) || hasLeaf(node.second, tabId);
}

function replaceLeaf(
  node: SplitNode,
  targetTabId: number,
  replacement: SplitNode,
): SplitNode {
  if (node.kind === "leaf") {
    return node.tabId === targetTabId ? replacement : node;
  }
  return {
    ...node,
    first: replaceLeaf(node.first, targetTabId, replacement),
    second: replaceLeaf(node.second, targetTabId, replacement),
  };
}

function removeLeaf(node: SplitNode, targetTabId: number): SplitNode | null {
  if (node.kind === "leaf") {
    return node.tabId === targetTabId ? null : node;
  }
  const first = removeLeaf(node.first, targetTabId);
  const second = removeLeaf(node.second, targetTabId);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function mapLeafRects(
  node: SplitNode,
  x: number,
  y: number,
  w: number,
  h: number,
  out: Record<number, { x: number; y: number; w: number; h: number }>,
) {
  if (node.kind === "leaf") {
    out[node.tabId] = { x, y, w, h };
    return;
  }

  if (node.direction === "vertical") {
    const w1 = w / 2;
    mapLeafRects(node.first, x, y, w1, h, out);
    mapLeafRects(node.second, x + w1, y, w - w1, h, out);
    return;
  }

  const h1 = h / 2;
  mapLeafRects(node.first, x, y, w, h1, out);
  mapLeafRects(node.second, x, y + h1, w, h - h1, out);
}

function swapLeafIds(node: SplitNode, a: number, b: number): SplitNode {
  if (node.kind === "leaf") {
    if (node.tabId === a) return { kind: "leaf", tabId: b };
    if (node.tabId === b) return { kind: "leaf", tabId: a };
    return node;
  }
  return {
    ...node,
    first: swapLeafIds(node.first, a, b),
    second: swapLeafIds(node.second, a, b),
  };
}

export function clearTermixSessionStorage() {
  localStorage.removeItem(DESKTOP_STATE_KEY);
  localStorage.removeItem("termix_tabs");
  localStorage.removeItem("termix_currentTab");
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("termix_session_")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

export function TabProvider({ children }: TabProviderProps) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 1, type: "home", title: "Home" },
  ]);
  const [currentTab, setCurrentTabState] = useState<number>(1);
  const [splitLayouts, setSplitLayouts] = useState<Record<number, SplitNode>>(
    {},
  );
  const [splitPanelSizes, setSplitPanelSizes] = useState<Record<string, number[]>>(
    {},
  );
  const [focusedSplitTabId, setFocusedSplitTabId] = useState<number | null>(
    null,
  );
  const [recentTerminalTabs, setRecentTerminalTabs] = useState<
    Array<{ title: string; hostConfig: any }>
  >([]);
  const [previewTerminalTheme, setPreviewTerminalTheme] = useState<string | null>(
    null,
  );
  const nextTabId = useRef(2);
  const hasHydratedStateRef = useRef(false);
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function computeUniqueTitle(
    tabType: Tab["type"],
    desiredTitle: string | undefined,
  ): string {
    const defaultTitle =
      tabType === "server_stats"
        ? t("nav.serverStats")
        : tabType === "file_manager"
          ? t("nav.fileManager")
          : tabType === "tunnel"
            ? t("nav.tunnels")
            : tabType === "docker"
              ? t("nav.docker")
              : tabType === "network_graph"
                ? t("dashboard.networkGraph")
                : tabType === "rdp" || tabType === "vnc" || tabType === "telnet"
                  ? tabType.toUpperCase()
                  : t("nav.terminal");
    const baseTitle = (desiredTitle || defaultTitle).trim();
    const match = baseTitle.match(/^(.*) \((\d+)\)$/);
    const root = match ? match[1] : baseTitle;

    const usedNumbers = new Set<number>();
    let rootUsed = false;
    tabs.forEach((tab) => {
      if (!tab.title) return;
      if (tab.title === root) {
        rootUsed = true;
        return;
      }
      const m = tab.title.match(
        new RegExp(
          `^${root.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")} \\((\\d+)\\)$`,
        ),
      );
      if (m) {
        const n = parseInt(m[1], 10);
        if (!isNaN(n)) usedNumbers.add(n);
      }
    });

    if (!rootUsed) return root;
    let n = 2;
    while (usedNumbers.has(n)) n += 1;
    return `${root} (${n})`;
  }

  const findLayoutRootForTab = (tabId: number): number | null => {
    if (splitLayouts[tabId]) return tabId;
    for (const [rootId, layout] of Object.entries(splitLayouts)) {
      if (hasLeaf(layout, tabId)) {
        return Number(rootId);
      }
    }
    return null;
  };

  const getLayoutForTab = (tabId: number | null) => {
    if (!tabId) return null;
    const rootId = findLayoutRootForTab(tabId);
    if (!rootId) return null;
    const node = splitLayouts[rootId];
    if (!node) return null;
    const leafIds = collectLeafIds(node);
    return { rootId, node, leafIds };
  };

  const createTabInternal = (
    tabData: Omit<Tab, "id">,
    setAsCurrent: boolean,
  ): number => {
    const id = nextTabId.current++;
    const instanceId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const needsUniqueTitle =
      tabData.type === "terminal" ||
      tabData.type === "server_stats" ||
      tabData.type === "file_manager" ||
      tabData.type === "tunnel" ||
      tabData.type === "docker" ||
      tabData.type === "network_graph" ||
      tabData.type === "rdp" ||
      tabData.type === "vnc" ||
      tabData.type === "telnet";
    const effectiveTitle = needsUniqueTitle
      ? computeUniqueTitle(tabData.type, tabData.title)
      : tabData.title || "";

    const persistentSessionId =
      tabData.type === "terminal"
        ? `termix_${id}`
        : (tabData as any).persistentSessionId;
    const executeCommand =
      tabData.type === "terminal"
        ? (tabData.executeCommand ||
            buildPersistentShellCommand(persistentSessionId as string))
        : undefined;

    const newTab: Tab = {
      ...tabData,
      id,
      instanceId,
      title: effectiveTitle,
      persistentSessionId,
      executeCommand,
      terminalRef:
        tabData.type === "terminal"
          ? React.createRef<TerminalRefHandle>()
          : undefined,
      hostConfig: tabData.hostConfig
        ? {
            ...tabData.hostConfig,
            instanceId,
          }
        : undefined,
    };

    setTabs((prev) => [...prev, newTab]);
    if (setAsCurrent) {
      setCurrentTabState(id);
      setFocusedSplitTabId(id);
    }
    return id;
  };

  const addTab = (tabData: Omit<Tab, "id">): number => {
    if (tabData.type === "ssh_manager") {
      const existing = tabs.find((tab) => tab.type === "ssh_manager");
      if (existing) {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === existing.id
              ? {
                  ...tab,
                  title: tabData.title || tab.title,
                  hostConfig: tabData.hostConfig || tab.hostConfig,
                  initialTab: tabData.initialTab,
                  _updateTimestamp: Date.now(),
                }
              : tab,
          ),
        );
        setCurrentTabState(existing.id);
        setFocusedSplitTabId(existing.id);
        return existing.id;
      }
    }
    return createTabInternal(tabData, true);
  };

  const removeTab = (tabId: number) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab?.terminalRef?.current?.disconnect) {
      tab.terminalRef.current.disconnect();
    }

    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    setSplitLayouts((prev) => {
      const next: Record<number, SplitNode> = {};
      Object.entries(prev).forEach(([rootId, node]) => {
        const pruned = removeLeaf(node, tabId);
        if (pruned && collectLeafIds(pruned).length > 1) {
          next[Number(rootId)] = pruned;
        }
      });
      return next;
    });

    if (focusedSplitTabId === tabId) {
      setFocusedSplitTabId(null);
    }

    if (currentTab === tabId) {
      const remainingTabs = tabs.filter((t) => t.id !== tabId);
      setCurrentTabState(remainingTabs.length > 0 ? remainingTabs[0].id : 1);
    }
  };

  const closeTabGroup = (tabId: number) => {
    const layoutInfo = getLayoutForTab(tabId);
    if (!layoutInfo) {
      removeTab(tabId);
      return;
    }

    const idsToRemove = new Set(layoutInfo.leafIds);
    tabs.forEach((tab) => {
      if (idsToRemove.has(tab.id) && tab?.terminalRef?.current?.disconnect) {
        tab.terminalRef.current.disconnect();
      }
    });

    setTabs((prev) => prev.filter((t) => !idsToRemove.has(t.id)));
    setSplitLayouts((prev) => {
      const next: Record<number, SplitNode> = {};
      Object.entries(prev).forEach(([rootId, node]) => {
        const root = Number(rootId);
        if (root === layoutInfo.rootId) return;
        let pruned: SplitNode | null = node;
        layoutInfo.leafIds.forEach((id) => {
          pruned = pruned ? removeLeaf(pruned, id) : null;
        });
        if (pruned && collectLeafIds(pruned).length > 1) {
          next[root] = pruned;
        }
      });
      return next;
    });
    setSplitPanelSizes((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${layoutInfo.rootId}:`)) delete next[key];
      });
      return next;
    });

    if (focusedSplitTabId !== null && idsToRemove.has(focusedSplitTabId)) {
      setFocusedSplitTabId(null);
    }

    if (idsToRemove.has(currentTab)) {
      const remaining = tabs.filter((t) => !idsToRemove.has(t.id));
      setCurrentTabState(remaining.length > 0 ? remaining[0].id : 1);
    }
  };

  const setSplitScreenTab = (tabId: number) => {
    if (!currentTab || tabId === currentTab) return;
    const layoutInfo = getLayoutForTab(currentTab);
    const rootId = layoutInfo?.rootId || currentTab;
    const baseNode: SplitNode =
      layoutInfo?.node || { kind: "leaf", tabId: currentTab };
    const leafIds = collectLeafIds(baseNode);

    if (leafIds.includes(tabId)) {
      const pruned = removeLeaf(baseNode, tabId);
      setSplitLayouts((prev) => {
        const next = { ...prev };
        if (!pruned || collectLeafIds(pruned).length <= 1) {
          delete next[rootId];
          setSplitPanelSizes((prevSizes) => {
            const nextSizes = { ...prevSizes };
            Object.keys(nextSizes).forEach((key) => {
              if (key.startsWith(`${rootId}:`)) delete nextSizes[key];
            });
            return nextSizes;
          });
          return next;
        }
        next[rootId] = pruned;
        return next;
      });
      return;
    }

    const targetId =
      focusedSplitTabId && leafIds.includes(focusedSplitTabId)
        ? focusedSplitTabId
        : currentTab;
    const nextNode = replaceLeaf(baseNode, targetId, {
      kind: "split",
      direction: "vertical",
      first: { kind: "leaf", tabId: targetId },
      second: { kind: "leaf", tabId },
    });
    setSplitLayouts((prev) => ({ ...prev, [rootId]: nextNode }));
    setFocusedSplitTabId(tabId);
    setCurrentTabState(rootId);
  };

  const splitFocusedPane = (direction: SplitDirection) => {
    if (!currentTab) return;
    const layoutInfo = getLayoutForTab(currentTab);
    const rootId = layoutInfo?.rootId || currentTab;
    const baseNode: SplitNode =
      layoutInfo?.node || { kind: "leaf", tabId: currentTab };
    const leafIds = collectLeafIds(baseNode);
    const sourceTabId =
      focusedSplitTabId && leafIds.includes(focusedSplitTabId)
        ? focusedSplitTabId
        : currentTab;
    const sourceTab = tabs.find((tab) => tab.id === sourceTabId);
    if (!sourceTab) return;

    const isSplittableSource =
      sourceTab.type === "terminal" ||
      sourceTab.type === "rdp" ||
      sourceTab.type === "vnc" ||
      sourceTab.type === "telnet" ||
      sourceTab.type === "server_stats" ||
      sourceTab.type === "file_manager" ||
      sourceTab.type === "tunnel" ||
      sourceTab.type === "docker" ||
      sourceTab.type === "network_graph";
    if (!isSplittableSource) return;

    const newTabId = createTabInternal(
      { type: "split_picker", title: "Select terminal" } as Omit<Tab, "id">,
      false,
    );
    const updatedNode = replaceLeaf(baseNode, sourceTabId, {
      kind: "split",
      direction,
      first: { kind: "leaf", tabId: sourceTabId },
      second: { kind: "leaf", tabId: newTabId },
    });

    setSplitLayouts((prev) => ({ ...prev, [rootId]: updatedNode }));
    setFocusedSplitTabId(newTabId);
    setCurrentTabState(rootId);
  };

  const openNewTerminalFromFocused = () => {
    if (!currentTab) return;
    const layoutInfo = getLayoutForTab(currentTab);
    const sourceCandidates = layoutInfo?.leafIds || [currentTab];
    const sourceTabId =
      focusedSplitTabId && sourceCandidates.includes(focusedSplitTabId)
        ? focusedSplitTabId
        : currentTab;
    const sourceTab = tabs.find((tab) => tab.id === sourceTabId);
    if (!sourceTab || sourceTab.type !== "terminal") return;

    const newTabId = createTabInternal(
      {
        type: "terminal",
        title: sourceTab.title,
        hostConfig: sourceTab.hostConfig,
      },
      true,
    );
    setFocusedSplitTabId(newTabId);
  };

  const closeFocusedPane = () => {
    if (!currentTab) return;
    const layoutInfo = getLayoutForTab(currentTab);
    if (!layoutInfo) {
      const tab = tabs.find((t) => t.id === currentTab);
      if (tab && tab.type !== "home") {
        removeTab(currentTab);
      }
      return;
    }

    const targetId =
      focusedSplitTabId && layoutInfo.leafIds.includes(focusedSplitTabId)
        ? focusedSplitTabId
        : currentTab;
    const remaining = layoutInfo.leafIds.filter((id) => id !== targetId);
    removeTab(targetId);
    if (remaining.length > 0) {
      setCurrentTabState(remaining[0]);
      setFocusedSplitTabId(remaining[0]);
    }
  };

  const moveFocusedPane = (direction: "left" | "right" | "up" | "down") => {
    if (!currentTab) return;
    const layoutInfo = getLayoutForTab(currentTab);
    if (!layoutInfo) return;
    const targetId =
      focusedSplitTabId && layoutInfo.leafIds.includes(focusedSplitTabId)
        ? focusedSplitTabId
        : currentTab;

    const rects: Record<number, { x: number; y: number; w: number; h: number }> =
      {};
    mapLeafRects(layoutInfo.node, 0, 0, 1, 1, rects);
    const cur = rects[targetId];
    if (!cur) return;
    const cx = cur.x + cur.w / 2;
    const cy = cur.y + cur.h / 2;

    let bestId: number | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    layoutInfo.leafIds.forEach((id) => {
      if (id === targetId) return;
      const r = rects[id];
      if (!r) return;
      const ox = r.x + r.w / 2;
      const oy = r.y + r.h / 2;
      const dx = ox - cx;
      const dy = oy - cy;

      if (direction === "left" && dx >= 0) return;
      if (direction === "right" && dx <= 0) return;
      if (direction === "up" && dy >= 0) return;
      if (direction === "down" && dy <= 0) return;

      const primary =
        direction === "left" || direction === "right"
          ? Math.abs(dx)
          : Math.abs(dy);
      const secondary =
        direction === "left" || direction === "right"
          ? Math.abs(dy)
          : Math.abs(dx);
      const score = primary * 10 + secondary;
      if (score < bestScore) {
        bestScore = score;
        bestId = id;
      }
    });

    if (!bestId) return;
    const swapped = swapLeafIds(layoutInfo.node, targetId, bestId);
    setSplitLayouts((prev) => ({ ...prev, [layoutInfo.rootId]: swapped }));
    setFocusedSplitTabId(targetId);
  };

  const updateSplitPanelSizes = (panelKey: string, sizes: number[]) => {
    if (!panelKey || !Array.isArray(sizes) || sizes.length < 2) return;
    const normalized = sizes.slice(0, 2).map((size) => {
      const value = Number(size);
      if (!Number.isFinite(value)) return 50;
      return Math.max(5, Math.min(95, Math.round(value * 1000) / 1000));
    });
    setSplitPanelSizes((prev) => {
      const current = prev[panelKey];
      if (
        current &&
        current.length === normalized.length &&
        current.every((value, index) => value === normalized[index])
      ) {
        return prev;
      }
      return { ...prev, [panelKey]: normalized };
    });
  };

  const swapPaneTabs = (sourceTabId: number, targetTabId: number) => {
    if (!currentTab || sourceTabId === targetTabId) return;
    const layoutInfo = getLayoutForTab(currentTab);
    if (!layoutInfo) return;
    if (
      !layoutInfo.leafIds.includes(sourceTabId) ||
      !layoutInfo.leafIds.includes(targetTabId)
    ) {
      return;
    }
    const swapped = swapLeafIds(layoutInfo.node, sourceTabId, targetTabId);
    setSplitLayouts((prev) => ({ ...prev, [layoutInfo.rootId]: swapped }));
    setFocusedSplitTabId(sourceTabId);
  };

  const renameTab = (tabId: number, newTitle: string) => {
    const title = (newTitle || "").trim();
    if (!title) return;
    setTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, title } : tab)),
    );
  };

  const getSessionRootForTab = (tabId: number): number => {
    return findLayoutRootForTab(tabId) || tabId;
  };

  const resolveSplitPickerToTerminal = (
    pickerTabId: number,
    payload: { title: string; hostConfig: any },
  ) => {
    const connectionType = payload.hostConfig?.connectionType || "ssh";
    const tabType =
      connectionType === "rdp" ||
      connectionType === "vnc" ||
      connectionType === "telnet"
        ? (connectionType as "rdp" | "vnc" | "telnet")
        : "terminal";
    const persistentSessionId = `termix_${pickerTabId}`;
    const newInstanceId = `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === pickerTabId
          ? {
              ...tab,
              instanceId: tab.instanceId || newInstanceId,
              type: tabType,
              title: payload.title,
              hostConfig: payload.hostConfig
                ? {
                    ...payload.hostConfig,
                    instanceId: tab.instanceId || newInstanceId,
                  }
                : payload.hostConfig,
              terminalRef:
                tabType === "terminal" ? React.createRef<any>() : undefined,
              persistentSessionId,
              executeCommand:
                tabType === "terminal"
                  ? buildPersistentShellCommand(persistentSessionId)
                  : undefined,
            }
          : tab,
      ),
    );

    setRecentTerminalTabs((prev) => {
      const key = `${payload.hostConfig?.id ?? ""}:${payload.hostConfig?.ip ?? ""}:${payload.hostConfig?.username ?? ""}`;
      const deduped = prev.filter((item) => {
        const itemKey = `${item.hostConfig?.id ?? ""}:${item.hostConfig?.ip ?? ""}:${item.hostConfig?.username ?? ""}`;
        return itemKey !== key;
      });
      return [{ title: payload.title, hostConfig: payload.hostConfig }, ...deduped].slice(0, 8);
    });
    setFocusedSplitTabId(pickerTabId);
  };

  const cancelSplitPicker = (pickerTabId: number) => {
    removeTab(pickerTabId);
  };

  const setCurrentTab = (tabId: number) => {
    setCurrentTabState(tabId);
    setFocusedSplitTabId(tabId);
  };

  const getTab = (tabId: number) => {
    return tabs.find((tab) => tab.id === tabId);
  };

  const isReorderingRef = useRef(false);
  const reorderTabs = (fromIndex: number, toIndex: number) => {
    if (isReorderingRef.current) return;
    isReorderingRef.current = true;
    setTabs((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      const safeToIndex = Math.min(toIndex, next.length);
      next.splice(safeToIndex, 0, moved);
      setTimeout(() => {
        isReorderingRef.current = false;
      }, 100);
      return next;
    });
  };

  const updateHostConfig = (
    hostId: number,
    newHostConfig: {
      id: number;
      name?: string;
      username: string;
      ip: string;
      port: number;
    },
  ) => {
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.hostConfig && tab.hostConfig.id === hostId) {
          if (tab.type === "ssh_manager") {
            return {
              ...tab,
              hostConfig: {
                ...newHostConfig,
                instanceId: (tab.hostConfig as any)?.instanceId,
              },
            };
          }
          return {
            ...tab,
            hostConfig: {
              ...newHostConfig,
              instanceId: (tab.hostConfig as any)?.instanceId,
            },
            title: newHostConfig.name?.trim()
              ? newHostConfig.name
              : `${newHostConfig.username}@${newHostConfig.ip}:${newHostConfig.port}`,
          };
        }
        return tab;
      }),
    );
  };

  const updateTab = (tabId: number, updates: Partial<Omit<Tab, "id">>) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? { ...tab, ...updates, _updateTimestamp: Date.now() }
          : tab,
      ),
    );
  };

  const applyPersistedState = (parsed: any) => {
    if (!parsed || typeof parsed !== "object") return;
    const storedTabs = Array.isArray(parsed?.tabs) ? parsed.tabs : [];
    const sanitizedTabs = storedTabs
      .filter((tab: any) => tab && tab.type !== "split_picker")
      .map((tab: any) => {
        const instanceId =
          tab.instanceId ||
          `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        const normalizedHostConfig = tab.hostConfig
          ? { ...tab.hostConfig, instanceId }
          : tab.hostConfig;
        if (tab?.type === "terminal") {
          const persistentSessionId = tab.persistentSessionId || `termix_${tab.id}`;
          return {
            ...tab,
            instanceId,
            hostConfig: normalizedHostConfig,
            persistentSessionId,
            executeCommand: buildPersistentShellCommand(persistentSessionId),
            terminalRef: React.createRef<any>(),
          };
        }
        return {
          ...tab,
          instanceId,
          hostConfig: normalizedHostConfig,
          terminalRef: undefined,
        };
      });

    if (sanitizedTabs.length === 0) return;
    if (!sanitizedTabs.some((tab: any) => tab.type === "home")) {
      sanitizedTabs.unshift({ id: 1, type: "home", title: "Home" });
    }

    setTabs(sanitizedTabs);
    const validIds = new Set(sanitizedTabs.map((t: any) => t.id));
    const persistedCurrentTab = Number(parsed?.currentTab);
    const nextCurrentTab = validIds.has(persistedCurrentTab)
      ? persistedCurrentTab
      : sanitizedTabs[0].id;
    setCurrentTabState(nextCurrentTab);

    const rawLayouts = parsed?.splitLayouts || {};
    const nextLayouts: Record<number, SplitNode> = {};
    Object.entries(rawLayouts).forEach(([rootId, layout]) => {
      if (validIds.has(Number(rootId))) {
        nextLayouts[Number(rootId)] = layout as SplitNode;
      }
    });
    setSplitLayouts(nextLayouts);

    const rawPanelSizes = parsed?.splitPanelSizes || {};
    const nextPanelSizes: Record<string, number[]> = {};
    Object.entries(rawPanelSizes).forEach(([key, sizes]) => {
      const rootId = Number(String(key).split(":")[0]);
      if (!validIds.has(rootId) || !Array.isArray(sizes)) return;
      const normalized = sizes.slice(0, 2).map((size: any) => Number(size));
      if (normalized.length === 2 && normalized.every(Number.isFinite)) {
        nextPanelSizes[key] = normalized;
      }
    });
    setSplitPanelSizes(nextPanelSizes);

    const focusedId = Number(parsed?.focusedSplitTabId);
    setFocusedSplitTabId(validIds.has(focusedId) ? focusedId : nextCurrentTab);

    const recent = Array.isArray(parsed?.recentTerminalTabs)
      ? parsed.recentTerminalTabs.filter((r: any) => r?.hostConfig)
      : [];
    setRecentTerminalTabs(recent.slice(0, 8));

    const maxId = sanitizedTabs.reduce(
      (acc: number, tab: any) => (tab.id > acc ? tab.id : acc),
      1,
    );
    nextTabId.current = Math.max(maxId + 1, Number(parsed?.nextTabId) || 2);
  };

  const buildPersistedPayload = () => {
    const tabsToPersist = tabs
      .filter((tab) => tab.type !== "split_picker")
      .map((tab) => ({
        id: tab.id,
        type: tab.type,
        title: tab.title,
        hostConfig: tab.hostConfig,
        instanceId: tab.instanceId,
        connectionConfig: tab.connectionConfig,
        persistentSessionId: tab.persistentSessionId,
        executeCommand: tab.executeCommand,
      }));
    return {
      tabs: tabsToPersist,
      currentTab,
      splitLayouts,
      splitPanelSizes,
      focusedSplitTabId,
      recentTerminalTabs,
      nextTabId: nextTabId.current,
    };
  };

  useEffect(() => {
    if (hasHydratedStateRef.current) return;
    let cancelled = false;

    async function hydrateState() {
      let localState: any | null = null;
      try {
        const raw = localStorage.getItem(DESKTOP_STATE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw || "{}");
          localState = parsed;
          if (!cancelled) applyPersistedState(parsed);
        }
      } catch {
        // ignore
      }

      try {
        const serverState = await fetchServerDesktopState();
        if (!cancelled && serverState) {
          applyPersistedState(serverState);
          localStorage.setItem(DESKTOP_STATE_KEY, JSON.stringify(serverState));
        } else if (!cancelled && localState) {
          saveServerDesktopState(localState).catch(() => {
            // local state remains the fallback
          });
        }
      } catch {
        // local state remains the fallback
      } finally {
        if (!cancelled) {
          hasHydratedStateRef.current = true;
        }
      }
    }

    hydrateState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedStateRef.current) return;
    try {
      const payload = buildPersistedPayload();
      localStorage.setItem(DESKTOP_STATE_KEY, JSON.stringify(payload));
      if (saveStateTimerRef.current) {
        clearTimeout(saveStateTimerRef.current);
      }
      saveStateTimerRef.current = setTimeout(() => {
        saveServerDesktopState(payload).catch(() => {
          // local state remains the fallback
        });
      }, 500);
    } catch {
      // ignore
    }
  }, [
    tabs,
    currentTab,
    splitLayouts,
    splitPanelSizes,
    focusedSplitTabId,
    recentTerminalTabs,
  ]);

  useEffect(() => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === 1 && tab.type === "home" ? { ...tab, title: t("nav.home") } : tab,
      ),
    );
  }, [t]);

  const activeLayout = getLayoutForTab(currentTab);
  const splitLayout = activeLayout?.node || null;
  const allSplitScreenTab =
    activeLayout?.leafIds.filter((id) => id !== currentTab) || [];

  const value: TabContextType = useMemo(
    () => ({
      tabs,
      currentTab,
      allSplitScreenTab,
      splitLayout,
      splitLayouts,
      splitPanelSizes,
      focusedSplitTabId,
      recentTerminalTabs,
      addTab,
      removeTab,
      closeTabGroup,
      setCurrentTab,
      setSplitScreenTab,
      splitFocusedPane,
      openNewTerminalFromFocused,
      setFocusedSplitTab: setFocusedSplitTabId,
      closeFocusedPane,
      moveFocusedPane,
      updateSplitPanelSizes,
      swapPaneTabs,
      renameTab,
      getSessionRootForTab,
      resolveSplitPickerToTerminal,
      cancelSplitPicker,
      getTab,
      reorderTabs,
      updateHostConfig,
      updateTab,
      previewTerminalTheme,
      setPreviewTerminalTheme,
    }),
    [
      tabs,
      currentTab,
      allSplitScreenTab,
      splitLayout,
      splitLayouts,
      splitPanelSizes,
      focusedSplitTabId,
      recentTerminalTabs,
      previewTerminalTheme,
    ],
  );

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}
