import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/separator";
import { Button } from "@/components/button";
import { Sheet, SheetContent } from "@/components/sheet";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { useState, useRef, useCallback, useEffect, createRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileBottomBar } from "@/shell/MobileBottomBar";
import { CommandPalette } from "@/shell/CommandPalette";
import { AppRail } from "@/sidebar/AppRail";
import type { RailView } from "@/sidebar/AppRail";
import { HostsPanel } from "@/sidebar/HostsPanel";
import { QuickConnectPanel } from "@/sidebar/QuickConnectPanel";
import { SshToolsPanel } from "@/sidebar/SshToolsPanel";
import { SnippetsPanel } from "@/sidebar/SnippetsPanel";
import { HistoryPanel } from "@/sidebar/HistoryPanel";
import { SplitScreenPanel } from "@/sidebar/SplitScreenPanel";
import { UserProfilePanel } from "@/sidebar/UserProfilePanel";
import { AdminSettingsPanel } from "@/sidebar/AdminSettingsPanel";
import { CredentialsPanel } from "@/sidebar/CredentialsPanel";
import { SplitView } from "@/shell/SplitView";
import { renderTabContent, tabIcon } from "@/shell/tabUtils";
import { TabBar } from "@/shell/TabBar";
import { SplitTerminalPicker } from "@/shell/SplitTerminalPicker";
import { Group as ResizablePanelGroup, Panel as ResizablePanel, Separator as ResizableHandle } from "react-resizable-panels";
import type {
  Tab,
  TabType,
  Host,
  SplitMode,
  HostFolder,
} from "@/types/ui-types";
import { PANE_COUNTS } from "@/lib/theme";
import {
  getSSHHosts,
  getUserInfo,
  getOpenTabs,
  addOpenTab,
  deleteOpenTab,
  patchOpenTab,
  getActiveSessions,
  getAllServerStatuses,
  getUserPreferences,
  type UserPreferences,
  type OpenTabRecord,
} from "@/main-axios";

type AltSplitNode =
  | { kind: "leaf"; tabId: string }
  | {
      kind: "split";
      direction: "horizontal" | "vertical";
      first: AltSplitNode;
      second: AltSplitNode;
    };

function replaceAltLeaf(
  node: AltSplitNode,
  tabId: string,
  replacement: AltSplitNode,
): AltSplitNode {
  if (node.kind === "leaf") return node.tabId === tabId ? replacement : node;
  return {
    ...node,
    first: replaceAltLeaf(node.first, tabId, replacement),
    second: replaceAltLeaf(node.second, tabId, replacement),
  };
}

function removeAltLeaf(node: AltSplitNode, tabId: string): AltSplitNode | null {
  if (node.kind === "leaf") return node.tabId === tabId ? null : node;
  const first = removeAltLeaf(node.first, tabId);
  const second = removeAltLeaf(node.second, tabId);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function collectAltLeaves(node: AltSplitNode | null, out: string[] = []): string[] {
  if (!node) return out;
  if (node.kind === "leaf") out.push(node.tabId);
  else {
    collectAltLeaves(node.first, out);
    collectAltLeaves(node.second, out);
  }
  return out;
}

function collectAltLeafPaths(
  node: AltSplitNode | null,
  path = "root",
  out = new Map<string, string>(),
): Map<string, string> {
  if (!node) return out;
  if (node.kind === "leaf") out.set(node.tabId, path);
  else {
    collectAltLeafPaths(node.first, `${path}:first`, out);
    collectAltLeafPaths(node.second, `${path}:second`, out);
  }
  return out;
}

function firstAltLeaf(node: AltSplitNode | null): string | null {
  if (!node) return null;
  return node.kind === "leaf" ? node.tabId : firstAltLeaf(node.first);
}

function lastAltLeaf(node: AltSplitNode | null): string | null {
  if (!node) return null;
  return node.kind === "leaf" ? node.tabId : lastAltLeaf(node.second);
}

function findAltDirectionalNeighbor(
  node: AltSplitNode | null,
  tabId: string,
  direction: "left" | "right" | "up" | "down",
): string | null {
  let result: string | null = null;

  function visit(current: AltSplitNode): boolean {
    if (current.kind === "leaf") return current.tabId === tabId;

    const inFirst = visit(current.first);
    if (result) return true;
    const inSecond = visit(current.second);
    if (result) return true;

    if (current.direction === "vertical") {
      if (direction === "left" && inSecond) result = lastAltLeaf(current.first);
      if (direction === "right" && inFirst) result = firstAltLeaf(current.second);
    } else {
      if (direction === "up" && inSecond) result = lastAltLeaf(current.first);
      if (direction === "down" && inFirst) result = firstAltLeaf(current.second);
    }

    return inFirst || inSecond;
  }

  if (node) visit(node);
  return result;
}

function swapAltLeafIds(
  node: AltSplitNode,
  firstTabId: string,
  secondTabId: string,
): AltSplitNode {
  if (node.kind === "leaf") {
    if (node.tabId === firstTabId) return { ...node, tabId: secondTabId };
    if (node.tabId === secondTabId) return { ...node, tabId: firstTabId };
    return node;
  }
  return {
    ...node,
    first: swapAltLeafIds(node.first, firstTabId, secondTabId),
    second: swapAltLeafIds(node.second, firstTabId, secondTabId),
  };
}

function pruneAltSplitLayout(
  node: AltSplitNode | null,
  validTabIds: Set<string>,
): AltSplitNode | null {
  if (!node) return null;
  if (node.kind === "leaf") return validTabIds.has(node.tabId) ? node : null;
  const first = pruneAltSplitLayout(node.first, validTabIds);
  const second = pruneAltSplitLayout(node.second, validTabIds);
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function getAltSplitRootTabId(node: AltSplitNode | null): string | null {
  return firstAltLeaf(node);
}

function getAltSplitChildTabIds(node: AltSplitNode | null): Set<string> {
  const ids = collectAltLeaves(node);
  return new Set(ids.slice(1));
}
import { dbHealthMonitor } from "@/lib/db-health-monitor";
import type { SSHHostWithStatus } from "@/main-axios";
import { ConnectionsPanel } from "@/sidebar/ConnectionsPanel";

function asArray<T>(value: T[] | string | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function sshHostToHost(h: SSHHostWithStatus): Host {
  const quickActions = asArray<{ name: string; snippetId: string | number }>(
    h.quickActions as unknown as { name: string; snippetId: string | number }[] | string | null | undefined,
  );
  const jumpHosts = asArray<{ hostId: string | number }>(
    h.jumpHosts as unknown as { hostId: string | number }[] | string | null | undefined,
  );

  return {
    id: String(h.id),
    name: h.name,
    username: h.username,
    ip: h.ip,
    port: h.port,
    folder: h.folder ?? "",
    online: h.status === "online",
    cpu: 0,
    ram: 0,
    lastAccess: "",
    tags: h.tags ?? [],
    authType: h.authType,
    password: h.password,
    key: typeof h.key === "string" ? h.key : undefined,
    keyPassword: h.keyPassword,
    keyType: h.keyType,
    credentialId: h.credentialId != null ? String(h.credentialId) : undefined,
    notes: h.notes,
    pin: h.pin ?? false,
    macAddress: h.macAddress,
    enableSsh: h.enableSsh ?? (h.connectionType === "ssh" || !h.connectionType),
    enableTerminal: h.enableTerminal ?? true,
    enableTunnel: h.enableTunnel ?? false,
    enableFileManager: h.enableFileManager ?? false,
    enableDocker: h.enableDocker ?? false,
    enableRdp: h.enableRdp ?? h.connectionType === "rdp",
    enableVnc: h.enableVnc ?? h.connectionType === "vnc",
    enableTelnet: h.enableTelnet ?? h.connectionType === "telnet",
    sshPort: h.port,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    quickActions: quickActions.map((a) => ({
      name: a.name,
      snippetId: String(a.snippetId),
    })),
    jumpHosts: jumpHosts.map((j) => ({
      hostId: String(j.hostId),
    })),
    serverTunnels: [],
    defaultPath: h.defaultPath,
    terminalConfig: {
      ...((h.terminalConfig as Host["terminalConfig"]) ?? {}),
      autoTmux: (h.terminalConfig as Host["terminalConfig"] | undefined)?.autoTmux ?? true,
    } as Host["terminalConfig"],
    useSocks5: h.useSocks5,
    socks5Host: h.socks5Host,
    socks5Port: h.socks5Port,
    socks5Username: h.socks5Username,
    socks5Password: h.socks5Password,
    socks5ProxyChain: h.socks5ProxyChain ?? [],
  };
}

function buildHostTree(hosts: SSHHostWithStatus[]): HostFolder {
  const root: HostFolder = { name: "root", children: [] };
  const folderMap = new Map<string, HostFolder>();
  const getOrCreateFolder = (path: string): HostFolder => {
    if (folderMap.has(path)) return folderMap.get(path)!;
    const parts = path.split(" / ");
    let current = root;
    let accumulated = "";
    for (const part of parts) {
      accumulated = accumulated ? `${accumulated} / ${part}` : part;
      if (!folderMap.has(accumulated)) {
        const folder: HostFolder = { name: part, children: [] };
        folderMap.set(accumulated, folder);
        current.children.push(folder);
      }
      current = folderMap.get(accumulated)!;
    }
    return current;
  };
  for (const h of hosts) {
    const host = sshHostToHost(h);
    if (h.folder) {
      getOrCreateFolder(h.folder).children.push(host);
    } else {
      root.children.push(host);
    }
  }
  return root;
}
export { tabIcon, renderTabContent } from "@/shell/tabUtils";

// ─── AppShell ────────────────────────────────────────────────────────────────

export function AppShell({
  username,
  onLogout,
}: {
  username: string;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "dashboard",
      instanceId: "dashboard",
      type: "dashboard",
      label: t("nav.dashboard"),
      openedAt: Date.now(),
    },
  ]);
  const [activeTabId, setActiveTabId] = useState("dashboard");
  const [userPrefs, setUserPrefs] = useState<UserPreferences>({
    reopenTabsOnLogin: false,
  });
  const [userPrefsLoaded, setUserPrefsLoaded] = useState(false);
  const [hostsLoaded, setHostsLoaded] = useState(false);
  // Flips to true once the initial DB read (restore or skip) is done — sync must not fire before this
  const [tabsReady, setTabsReady] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [splitMode, setSplitMode] = useState<SplitMode>(
    () => (localStorage.getItem("termix_splitMode") as SplitMode) ?? "none",
  );
  const [paneTabIds, setPaneTabIds] = useState<(string | null)[]>(
    () =>
      JSON.parse(localStorage.getItem("termix_paneTabIds") ?? "null") ??
      Array(6).fill(null),
  );
  const [focusedPaneIndex, setFocusedPaneIndex] = useState<number | null>(null);
  const [realHostTree, setRealHostTree] = useState<HostFolder | null>(null);
  const [hostsLoading, setHostsLoading] = useState(true);
  const [allHosts, setAllHosts] = useState<Host[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [backgroundTabRecords, setBackgroundTabRecords] = useState<
    OpenTabRecord[]
  >([]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railView, setRailView] = useState<RailView>("hosts");
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem("termix_sidebarWidth");
    return saved ? parseInt(saved, 10) : 266;
  });
  const [sidebarDragging, setSidebarDragging] = useState(false);
  const [sidebarEditing, setSidebarEditing] = useState(false);

  useEffect(() => {
    localStorage.setItem("termix_sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    localStorage.setItem("termix_splitMode", splitMode);
  }, [splitMode]);

  useEffect(() => {
    localStorage.setItem("termix_paneTabIds", JSON.stringify(paneTabIds));
  }, [paneTabIds]);


  const isMobile = useIsMobile();

  const sidebarOpenBeforeMobile = useRef(sidebarOpen);
  useEffect(() => {
    if (isMobile) {
      sidebarOpenBeforeMobile.current = sidebarOpen;
      setSidebarOpen(false);
    } else {
      setSidebarOpen(sidebarOpenBeforeMobile.current);
    }
  }, [isMobile]);

  useEffect(() => {
    getUserInfo()
      .then((info) => setIsAdmin(info.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  const lastShiftTime = useRef(0);
  const [commandPaletteShortcutEnabled, setCommandPaletteShortcutEnabled] =
    useState<boolean>(() => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      return v !== null ? v === "true" : true;
    });
  const terminalRefs = useRef<Map<string, ReturnType<typeof createRef>>>(
    new Map(),
  );
  const [paneContentEls, setPaneContentEls] = useState<
    (HTMLDivElement | null)[]
  >(Array(6).fill(null));
  const [altSplitLayout, setAltSplitLayout] = useState<AltSplitNode | null>(() => {
    try {
      return JSON.parse(localStorage.getItem("termix_altSplitLayout") ?? "null");
    } catch {
      return null;
    }
  });
  const [focusedAltTabId, setFocusedAltTabId] = useState<string | null>(null);
  const [altPaneEls, setAltPaneEls] = useState<
    Record<string, HTMLDivElement | null>
  >({});
  const [altSplitPanelSizes, setAltSplitPanelSizes] = useState<Record<string, number[]>>(
    () => {
      try {
        return JSON.parse(localStorage.getItem("termix_altSplitPanelSizes") ?? "{}");
      } catch {
        return {};
      }
    },
  );
  const altPaneRefCallbacks = useRef(
    new Map<string, (el: HTMLDivElement | null) => void>(),
  );

  const getAltPaneRef = useCallback((path: string) => {
    const existing = altPaneRefCallbacks.current.get(path);
    if (existing) return existing;

    const callback = (el: HTMLDivElement | null) => {
      setAltPaneEls((prev) =>
        prev[path] === el ? prev : { ...prev, [path]: el },
      );
    };
    altPaneRefCallbacks.current.set(path, callback);
    return callback;
  }, []);

  useEffect(() => {
    localStorage.setItem("termix_altSplitPanelSizes", JSON.stringify(altSplitPanelSizes));
  }, [altSplitPanelSizes]);

  useEffect(() => {
    if (altSplitLayout) {
      localStorage.setItem("termix_altSplitLayout", JSON.stringify(altSplitLayout));
    } else {
      localStorage.removeItem("termix_altSplitLayout");
    }
  }, [altSplitLayout]);

  // Stable per-tab DOM nodes — created once per tab, never destroyed while the tab lives.
  // We always portal each tab's content into its own node, then move that node between
  // the normal-view container and the pane container via vanilla DOM so React's portal
  // target never changes (changing the target causes a remount).
  const tabNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const normalViewRef = useRef<HTMLDivElement>(null);

  const getTabNode = useCallback((tabId: string, isTerminal: boolean) => {
    if (!tabNodesRef.current.has(tabId)) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.inset = "0";
      el.style.overflow = "hidden";
      if (!isTerminal) el.classList.add("bg-background");
      tabNodesRef.current.set(tabId, el);
    }
    return tabNodesRef.current.get(tabId)!;
  }, []);

  const onPaneContentRef = useCallback(
    (paneIndex: number, el: HTMLDivElement | null) => {
      setPaneContentEls((prev) => {
        if (prev[paneIndex] === el) return prev;
        const next = [...prev];
        next[paneIndex] = el;
        return next;
      });
    },
    [],
  );

  const sidebarTitle: Record<RailView, string> = {
    hosts: "Hosts",
    credentials: "Credentials",
    "quick-connect": "Quick Connect",
    "ssh-tools": "SSH Tools",
    snippets: "Snippets",
    history: "History",
    "split-screen": "Split Screen",
    connections: t("nav.connections"),
    "user-profile": "User Profile",
    "admin-settings": "Admin Settings",
  };

  // Double-shift opens command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "ShiftLeft" && !e.repeat) {
        const now = Date.now();
        if (now - lastShiftTime.current < 300 && commandPaletteShortcutEnabled)
          setCommandPaletteOpen((prev) => !prev);
        lastShiftTime.current = now;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteShortcutEnabled]);

  useEffect(() => {
    const handler = () => {
      const v = localStorage.getItem("commandPaletteShortcutEnabled");
      setCommandPaletteShortcutEnabled(v !== null ? v === "true" : true);
    };
    window.addEventListener("commandPaletteShortcutEnabledChanged", handler);
    return () =>
      window.removeEventListener(
        "commandPaletteShortcutEnabledChanged",
        handler,
      );
  }, []);

  useEffect(() => {
    const handle = () => onLogout();
    window.addEventListener("termix:logout", handle);
    return () => window.removeEventListener("termix:logout", handle);
  }, [onLogout]);

  useEffect(() => {
    const handleSessionExpired = () => onLogout();
    dbHealthMonitor.on("session-expired", handleSessionExpired);
    return () => dbHealthMonitor.off("session-expired", handleSessionExpired);
  }, [onLogout]);

  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab?.terminalRef) return;
    let innerRafId: number;
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(() => {
        const ref = activeTab.terminalRef?.current;
        ref?.fit?.();
        ref?.notifyResize?.();
        ref?.refresh?.();
      });
    });
    return () => {
      cancelAnimationFrame(outerRafId);
      cancelAnimationFrame(innerRafId);
    };
  }, [activeTabId]);

  useEffect(() => {
    const handleDegraded = () => {
      toast.loading(t("common.connectionDegraded"), {
        id: "db-connection-degraded",
        duration: Infinity,
        dismissible: false,
        action: {
          label: t("common.reload"),
          onClick: () => window.location.reload(),
        },
      });
    };

    const handleRestored = () => {
      toast.dismiss("db-connection-degraded");
      toast.success(t("common.backendReconnected"), { duration: 3000 });
    };

    dbHealthMonitor.on("database-connection-degraded", handleDegraded);
    dbHealthMonitor.on("database-connection-degraded-cleared", handleRestored);

    return () => {
      dbHealthMonitor.off("database-connection-degraded", handleDegraded);
      dbHealthMonitor.off(
        "database-connection-degraded-cleared",
        handleRestored,
      );
    };
  }, [t]);

  useEffect(() => {
    getUserPreferences()
      .then((prefs) => setUserPrefs(prefs))
      .catch(() => {})
      .finally(() => setUserPrefsLoaded(true));
  }, []);

  // Load real hosts from API
  const loadHosts = useCallback(async () => {
    try {
      const raw = await getSSHHosts();
      const converted = raw.map(sshHostToHost);
      setAllHosts(converted);
      setRealHostTree(buildHostTree(raw));
    } catch {
      // Keep empty state on error
    } finally {
      setHostsLoading(false);
      setHostsLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadHosts();
  }, [loadHosts]);

  const refreshHostStatuses = useCallback(async () => {
    try {
      const statuses = await getAllServerStatuses();
      setAllHosts((prev) =>
        prev.map((host) => {
          const status = statuses[Number(host.id)]?.status;
          return status ? { ...host, online: status === "online" } : host;
        }),
      );
    } catch {
      // Keep the last known status if the background status poll fails.
    }
  }, []);

  useEffect(() => {
    if (!hostsLoaded) return;
    refreshHostStatuses();
    const id = window.setInterval(refreshHostStatuses, 10000);
    return () => window.clearInterval(id);
  }, [hostsLoaded, refreshHostStatuses]);

  useEffect(() => {
    window.addEventListener("termix:hosts-changed", loadHosts);
    return () => window.removeEventListener("termix:hosts-changed", loadHosts);
  }, [loadHosts]);

  // Sync tab host data when allHosts updates (e.g. after editing terminal theme in host settings)
  useEffect(() => {
    if (allHosts.length === 0) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.host
          ? { ...t, host: allHosts.find((h) => h.id === t.host!.id) ?? t.host }
          : t,
      ),
    );
  }, [allHosts]);

  // Let HostManager trigger tab opens via custom event
  useEffect(() => {
    const handle = (e: Event) => {
      const { hostId, type } = (
        e as CustomEvent<{ hostId: string; type?: TabType }>
      ).detail;
      const host = allHosts.find((h) => h.id === hostId);
      if (host) connectHost(host, type);
    };
    window.addEventListener("termix:open-tab", handle);
    return () => window.removeEventListener("termix:open-tab", handle);
  }, [allHosts]);

  const PERSISTENT_TAB_TYPES: TabType[] = [
    "terminal",
    "rdp",
    "vnc",
    "telnet",
    "files",
    "docker",
    "stats",
    "tunnel",
  ];

  // On load: always read saved tabs from DB so background sessions are preserved across refreshes.
  // If reopenTabsOnLogin is on, also restore them as open tabs in the tab bar.
  const tabRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (!hostsLoaded || !userPrefsLoaded) return;
    if (tabRestoreAttemptedRef.current) return;
    tabRestoreAttemptedRef.current = true;

    async function loadSavedTabs() {
      try {
        const [savedTabs, activeSessions] = await Promise.all([
          getOpenTabs(),
          getActiveSessions(),
        ]);

        if (!Array.isArray(savedTabs) || savedTabs.length === 0) return;

        const sessionByInstanceId = new Map(
          (Array.isArray(activeSessions) ? activeSessions : [])
            .filter((s) => s.tabInstanceId != null)
            .map((s) => [s.tabInstanceId, s]),
        );

        {
          const hasPersistentTabs = tabs.some((t) =>
            PERSISTENT_TAB_TYPES.includes(t.type),
          );
          if (!hasPersistentTabs) {
            const restoredTabs: Tab[] = [];
            for (const saved of savedTabs as OpenTabRecord[]) {
              const host = saved.hostId
                ? allHosts.find((h) => h.id === String(saved.hostId))
                : undefined;
              const hostlessTypes: TabType[] = ["dashboard", "tunnel"];
              if (!host && !hostlessTypes.includes(saved.tabType as TabType))
                continue;

              // Singleton tabs use their type as the stable ID; host-bound tabs get a unique ID
              const tabId = saved.id;
              const liveSession = sessionByInstanceId.get(saved.id);
              const restoredSessionId =
                liveSession?.sessionId ?? saved.backendSessionId ?? null;

              restoredTabs.push({
                id: tabId,
                instanceId: saved.id,
                type: saved.tabType as TabType,
                label: saved.label,
                host,
                openedAt: new Date(saved.createdAt).getTime(),
                restoredSessionId,
                terminalRef:
                  saved.tabType === "terminal" ? createRef() : undefined,
              });
            }

            if (restoredTabs.length > 0) {
              const restoredIds = new Set(restoredTabs.map((tab) => tab.id));
              const restoredAltLayout = pruneAltSplitLayout(
                altSplitLayout,
                restoredIds,
              );
              const restoredRootId = getAltSplitRootTabId(restoredAltLayout);

              setTabs((prev) => {
                const existingIds = new Set(prev.map((t) => t.id));
                const newTabs = restoredTabs.filter(
                  (t) => !existingIds.has(t.id),
                );
                return newTabs.length > 0 ? [...prev, ...newTabs] : prev;
              });
              setAltSplitLayout(
                restoredAltLayout && restoredAltLayout.kind === "leaf"
                  ? null
                  : restoredAltLayout,
              );
              setFocusedAltTabId(restoredRootId ?? restoredTabs[0].id);
              setActiveTabId(restoredRootId ?? restoredTabs[0].id);
            }
            // Restored tabs are in the tab bar, not in background records
          }
        }
      } catch {
        // silently fail
      } finally {
        setTabsReady(true);
      }
    }

    loadSavedTabs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostsLoaded, userPrefsLoaded]);

  // Debounced tab-order sync: when tab order changes, patch each persistent tab's tabOrder in DB.
  const orderSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevTabOrderRef = useRef<string>("");
  useEffect(() => {
    if (!tabsReady) return;
    const persistable = tabs.filter((t) =>
      PERSISTENT_TAB_TYPES.includes(t.type),
    );
    const orderKey = persistable.map((t) => t.instanceId).join(",");
    if (orderKey === prevTabOrderRef.current) return;
    prevTabOrderRef.current = orderKey;

    if (orderSyncTimeoutRef.current) clearTimeout(orderSyncTimeoutRef.current);
    orderSyncTimeoutRef.current = setTimeout(() => {
      persistable.forEach((t, i) => {
        patchOpenTab(t.instanceId, { tabOrder: i }).catch(() => {});
      });
    }, 500);

    return () => {
      if (orderSyncTimeoutRef.current)
        clearTimeout(orderSyncTimeoutRef.current);
    };
  }, [tabs, tabsReady]);

  // ─── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(function openTab(
    host: Host,
    type: TabType,
    restore?: { instanceId: string; restoredSessionId: string | null },
  ) {
    const instanceId =
      restore?.instanceId ??
      (typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    const tabId = PERSISTENT_TAB_TYPES.includes(type)
      ? instanceId
      : `${host.name}-${type}-${Date.now()}`;
    const openedAt = Date.now();
    const ref = type === "terminal" ? createRef() : undefined;
    if (ref) terminalRefs.current.set(tabId, ref);

    let finalLabel = host.name;
    setTabs((prev) => {
      const same = prev.filter(
        (t) =>
          t.type === type && t.label.replace(/ \(\d+\)$/, "") === host.name,
      );
      finalLabel =
        same.length === 0 ? host.name : `${host.name} (${same.length + 1})`;

      // Retrofit the first duplicate's label to "(1)" if needed
      const next =
        same.length === 1 && !/\(\d+\)$/.test(same[0].label)
          ? prev.map((t) =>
              t.id === same[0].id ? { ...t, label: `${host.name} (1)` } : t,
            )
          : prev;

      return [
        ...next,
        {
          id: tabId,
          instanceId,
          type,
          label: finalLabel,
          host,
          openedAt,
          terminalRef: ref,
          restoredSessionId: restore?.restoredSessionId ?? null,
        },
      ];
    });
    setActiveTabId(tabId);

    if (PERSISTENT_TAB_TYPES.includes(type)) {
      addOpenTab({
        id: instanceId,
        tabType: type,
        hostId: host ? parseInt(host.id) : null,
        label: finalLabel,
        tabOrder: 0,
      }).catch(() => {});
    }
  }, []);

  function connectHost(host: Host, preferredType?: TabType) {
    const type: TabType =
      preferredType ??
      (host.enableSsh
        ? "terminal"
        : host.enableRdp
          ? "rdp"
          : host.enableVnc
            ? "vnc"
            : host.enableTelnet
              ? "telnet"
              : "terminal");
    openTab(host, type);
  }

  const openSingletonTab = useCallback(
    function openSingletonTab(type: TabType, pendingEvent?: string) {
      if (type === "host-manager") {
        if (pendingEvent === "host-manager:add-credential") {
          setSidebarOpen(true);
          setRailView("credentials");
          setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("host-manager:add-credential"),
              ),
            0,
          );
        } else {
          setSidebarOpen(true);
          setRailView("hosts");
          if (pendingEvent) {
            setTimeout(
              () => window.dispatchEvent(new CustomEvent(pendingEvent)),
              0,
            );
          }
        }
        return;
      }
      if (type === "user-profile" || type === "admin-settings") {
        setSidebarEditing(false);
        setRailView(type as RailView);
        setSidebarOpen(true);
        return;
      }
      const id = type;
      const singletonLabels: Partial<Record<TabType, string>> = {
        "host-manager": t("nav.hostManager"),
        docker: t("nav.docker"),
        tunnel: t("nav.tunnels"),
        network_graph: t("nav.networkGraph"),
      };
      setTabs((prev) => {
        if (prev.find((t) => t.id === id)) return prev;
        return [
          ...prev,
          {
            id,
            instanceId: id,
            type,
            label: singletonLabels[type] ?? type,
            openedAt: Date.now(),
          },
        ];
      });
      setActiveTabId(id);
      if (PERSISTENT_TAB_TYPES.includes(type)) {
        addOpenTab({
          id,
          tabType: type,
          hostId: null,
          label: singletonLabels[type] ?? type,
          tabOrder: 0,
        }).catch(() => {});
      }
    },
    [t],
  );

  const SESSION_TAB_TYPES: TabType[] = ["terminal", "rdp", "vnc", "telnet"];

  function doCloseTab(id: string) {
    const tabToClose = tabs.find((t) => t.id === id);
    if (
      tabToClose?.instanceId &&
      PERSISTENT_TAB_TYPES.includes(tabToClose.type)
    ) {
      deleteOpenTab(tabToClose.instanceId).catch(() => {});
    }

    terminalRefs.current.delete(id);
    if (id === activeTabId) {
      const remaining = tabs.filter((t) => t.id !== id);
      setActiveTabId(
        remaining.length > 0 ? remaining[remaining.length - 1].id : "dashboard",
      );
    }
    setPaneTabIds((prev) => prev.map((p) => (p === id ? null : p)));
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (next.length === 0)
        return [
          {
            id: "dashboard",
            instanceId: "dashboard",
            type: "dashboard",
            label: t("nav.dashboard"),
            openedAt: Date.now(),
          },
        ];
      return next;
    });
  }

  function refreshTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    if (tab.type === "terminal") {
      const ref = tab.terminalRef?.current;
      ref?.reconnect?.();
    } else if (["rdp", "vnc", "telnet"].includes(tab.type)) {
      window.dispatchEvent(
        new CustomEvent("termix:refresh-guacamole", { detail: { tabId: id } }),
      );
    }
  }

  function closeTab(id: string) {
    const tab = tabs.find((t) => t.id === id);
    const confirmEnabled = localStorage.getItem("confirmTabClose") === "true";
    if (tab && SESSION_TAB_TYPES.includes(tab.type) && confirmEnabled) {
      toast(t("nav.confirmClose"), {
        duration: 5000,
        action: {
          label: t("nav.close"),
          onClick: () => doCloseTab(id),
        },
        cancel: {
          label: t("nav.cancel"),
          onClick: () => {},
        },
      });
      return;
    }
    doCloseTab(id);
  }

  function splitTabQuick(tabId: string, mode: SplitMode) {
    setSplitMode(mode);
    setPaneTabIds(() => {
      const count = PANE_COUNTS[mode];
      const next: (string | null)[] = Array(6).fill(null);
      next[0] = tabId;
      // Fill remaining panes with other non-dashboard tabs in order
      let slot = 1;
      for (const tab of tabs) {
        if (slot >= count) break;
        if (tab.id !== tabId && tab.type !== "dashboard") {
          next[slot] = tab.id;
          slot++;
        }
      }
      return next;
    });
  }

  function addTabToSplit(tabId: string) {
    setPaneTabIds((prev) => {
      // Remove from any current slot first
      const next = prev.map((p) => (p === tabId ? null : p));
      // Find first empty slot within the current pane count
      const count = PANE_COUNTS[splitMode];
      for (let i = 0; i < count; i++) {
        if (!next[i]) {
          next[i] = tabId;
          break;
        }
      }
      return next;
    });
  }

  function removeTabFromSplit(tabId: string) {
    setPaneTabIds((prev) => prev.map((p) => (p === tabId ? null : p)));
  }

  function assignPane(paneIndex: number, tabId: string) {
    setPaneTabIds((prev) => {
      const next = prev.map((p) => (p === tabId ? null : p));
      next[paneIndex] = tabId;
      return next;
    });
  }

  function createSplitPicker(): string {
    const pickerId = `split-picker-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const pickerTab: Tab = {
      id: pickerId,
      instanceId: pickerId,
      type: "split_picker",
      label: "Select connection",
      openedAt: Date.now(),
    };
    setTabs((prev) => [
      ...prev.filter((tab) => tab.type !== "split_picker"),
      pickerTab,
    ]);
    return pickerId;
  }

  function splitFocusedPane(direction: "horizontal" | "vertical") {
    if (isMobile) return;
    setSplitMode("none");

    const leafIds = collectAltLeaves(altSplitLayout);
    const sourceTabId =
      focusedAltTabId && leafIds.includes(focusedAltTabId)
        ? focusedAltTabId
        : activeTabId;
    const sourceTab = tabs.find((tab) => tab.id === sourceTabId);
    if (!sourceTab || sourceTab.type === "dashboard" || sourceTab.type === "split_picker") {
      return;
    }

    const pickerId = createSplitPicker();
    const splitNode: AltSplitNode = {
      kind: "split",
      direction,
      first: { kind: "leaf", tabId: sourceTab.id },
      second: { kind: "leaf", tabId: pickerId },
    };

    setAltSplitLayout((prev) =>
      prev ? replaceAltLeaf(prev, sourceTab.id, splitNode) : splitNode,
    );
    setFocusedAltTabId(pickerId);
  }

  function closeFocusedPane() {
    if (!altSplitLayout) {
      closeTab(activeTabId);
      return;
    }

    const leafIds = collectAltLeaves(altSplitLayout);
    const targetId =
      focusedAltTabId && leafIds.includes(focusedAltTabId)
        ? focusedAltTabId
        : activeTabId;
    const targetTab = tabs.find((tab) => tab.id === targetId);
    const nextLayout = removeAltLeaf(altSplitLayout, targetId);

    if (targetTab?.instanceId && PERSISTENT_TAB_TYPES.includes(targetTab.type)) {
      deleteOpenTab(targetTab.instanceId).catch(() => {});
    }
    terminalRefs.current.delete(targetId);
    setTabs((prev) => prev.filter((tab) => tab.id !== targetId));
    setAltSplitLayout(nextLayout && nextLayout.kind === "leaf" ? null : nextLayout);
    const remaining = collectAltLeaves(nextLayout);
    const nextFocus = remaining[0] ?? null;
    setFocusedAltTabId(nextFocus);
    if (nextFocus) setActiveTabId(nextFocus);
  }

  function activateTab(tabId: string) {
    const altChildIds = getAltSplitChildTabIds(altSplitLayout);
    if (altChildIds.has(tabId)) {
      setFocusedAltTabId(tabId);
      return;
    }

    setActiveTabId(tabId);
    if (altLeafIds.has(tabId)) setFocusedAltTabId(tabId);
  }

  function resolveSplitPicker(pickerTab: Tab, host: Host, type: TabType) {
    const instanceId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const tabId = PERSISTENT_TAB_TYPES.includes(type)
      ? instanceId
      : `${host.name}-${type}-${Date.now()}`;
    const ref = type === "terminal" ? createRef() : undefined;
    if (ref) terminalRefs.current.set(tabId, ref);
    const label = host.name;
    const nextTab: Tab = {
      id: tabId,
      instanceId,
      type,
      label,
      host,
      openedAt: Date.now(),
      terminalRef: ref,
      restoredSessionId: null,
    };

    setTabs((prev) => [...prev.filter((tab) => tab.id !== pickerTab.id), nextTab]);
    setAltSplitLayout((prev) =>
      prev ? replaceAltLeaf(prev, pickerTab.id, { kind: "leaf", tabId }) : prev,
    );
    setActiveTabId(tabId);
    setFocusedAltTabId(tabId);

    if (PERSISTENT_TAB_TYPES.includes(type)) {
      addOpenTab({
        id: instanceId,
        tabType: type,
        hostId: parseInt(host.id),
        label,
        tabOrder: 0,
      }).catch(() => {});
    }
  }

  function cancelSplitPicker(pickerTab: Tab) {
    setTabs((prev) => prev.filter((tab) => tab.id !== pickerTab.id));
    setAltSplitLayout((prev) => {
      const next = prev ? removeAltLeaf(prev, pickerTab.id) : null;
      return next && next.kind === "leaf" ? null : next;
    });
    setFocusedAltTabId(activeTabId);
  }


  function openTerminalFromFocusedPane() {
    if (isMobile) return;
    const leafIds = collectAltLeaves(altSplitLayout);
    const sourceTabId =
      focusedAltTabId && leafIds.includes(focusedAltTabId)
        ? focusedAltTabId
        : activeTabId;
    const sourceTab = tabs.find((tab) => tab.id === sourceTabId);
    if (!sourceTab?.host) return;

    const instanceId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const tabId = instanceId;
    const ref = createRef();
    terminalRefs.current.set(tabId, ref);
    const nextTab: Tab = {
      id: tabId,
      instanceId,
      type: "terminal",
      label: sourceTab.host.name,
      host: sourceTab.host,
      openedAt: Date.now(),
      terminalRef: ref,
      restoredSessionId: null,
    };

    setTabs((prev) => [...prev, nextTab]);
    setAltSplitLayout((prev) =>
      prev ? replaceAltLeaf(prev, sourceTabId, { kind: "leaf", tabId }) : prev,
    );
    setActiveTabId(tabId);
    setFocusedAltTabId(tabId);
    addOpenTab({
      id: instanceId,
      tabType: "terminal",
      hostId: parseInt(sourceTab.host.id),
      label: nextTab.label,
      tabOrder: 0,
    }).catch(() => {});
  }

  function moveFocusedPane(direction: "left" | "right" | "up" | "down") {
    if (!altSplitLayout) return;
    const leafIds = collectAltLeaves(altSplitLayout);
    const targetId =
      focusedAltTabId && leafIds.includes(focusedAltTabId)
        ? focusedAltTabId
        : activeTabId;
    const neighborId = findAltDirectionalNeighbor(altSplitLayout, targetId, direction);
    if (!neighborId) return;

    setAltSplitLayout((prev) =>
      prev ? swapAltLeafIds(prev, targetId, neighborId) : prev,
    );
    setFocusedAltTabId(targetId);
    setActiveTabId(targetId);
  }

  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === "d") {
        e.preventDefault();
        e.stopPropagation();
        splitFocusedPane("vertical");
        return;
      }
      if (key === "e") {
        e.preventDefault();
        e.stopPropagation();
        splitFocusedPane("horizontal");
        return;
      }
      if (key === "t") {
        e.preventDefault();
        e.stopPropagation();
        openTerminalFromFocusedPane();
        return;
      }
      if (key === "w") {
        e.preventDefault();
        e.stopPropagation();
        closeFocusedPane();
        return;
      }
      const arrowDirections: Partial<Record<string, "left" | "right" | "up" | "down">> = {
        arrowleft: "left",
        arrowright: "right",
        arrowup: "up",
        arrowdown: "down",
      };
      const moveDirection = arrowDirections[key];
      if (moveDirection) {
        e.preventDefault();
        e.stopPropagation();
        moveFocusedPane(moveDirection);
        return;
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown, true);
    return () => window.removeEventListener("keydown", onGlobalKeyDown, true);
  }, [activeTabId, focusedAltTabId, altSplitLayout, isMobile, tabs]);

  // ─── Rail / sidebar ──────────────────────────────────────────────────────

  function handleRailClick(view: RailView) {
    if (railView === view && sidebarOpen) {
      setSidebarOpen(false);
    } else {
      if (view !== railView) setSidebarEditing(false);
      setRailView(view);
      setSidebarOpen(true);
    }
  }

  function editHostInManager(host: Host) {
    setSidebarOpen(true);
    setRailView("hosts");
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("host-manager:edit-host", { detail: host.id }),
      );
    }, 0);
  }

  const onSidebarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setSidebarDragging(true);
      const startX = e.clientX;
      const startW = sidebarWidth;
      function onMove(ev: MouseEvent) {
        setSidebarWidth(
          Math.max(160, Math.min(480, startW + ev.clientX - startX)),
        );
      }
      function onUp() {
        setSidebarDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  // Resize all terminals in panes + active terminal when split mode or sidebar changes
  const resizeAllTerminals = useCallback(() => {
    const id = requestAnimationFrame(() => {
      tabs.forEach((tab) => {
        if (!tab.terminalRef) return;
        const ref = tab.terminalRef.current as any;
        ref?.fit?.();
        ref?.notifyResize?.();
      });
    });
    return id;
  }, [tabs]);

  useEffect(() => {
    const id = resizeAllTerminals();
    return () => cancelAnimationFrame(id);
  }, [splitMode, sidebarWidth, sidebarOpen]);

  const isSplit = splitMode !== "none";
  const altLeafPaths = useMemo(() => collectAltLeafPaths(altSplitLayout), [altSplitLayout]);
  const altLeafIds = useMemo(() => new Set(collectAltLeaves(altSplitLayout)), [altSplitLayout]);
  const hiddenAltTabIds = useMemo(
    () => getAltSplitChildTabIds(altSplitLayout),
    [altSplitLayout],
  );

  useEffect(() => {
    if (!tabsReady) return;

    const validTabIds = new Set(tabs.map((tab) => tab.id));
    setAltSplitLayout((prev) => {
      const pruned = pruneAltSplitLayout(prev, validTabIds);
      if (pruned && pruned.kind === "leaf") return null;
      return pruned;
    });
  }, [tabs, tabsReady]);

  // Move each tab's stable DOM node to the right container (pane or normal-view).
  // This is vanilla DOM so React's portal target never changes — changing the portal
  // target causes a remount which is exactly what we're trying to avoid.
  useEffect(() => {
    const normalView = normalViewRef.current;
    if (!normalView) return;

    const tabIds = new Set(tabs.map((t) => t.id));

    // Remove nodes for closed tabs
    for (const [id, node] of tabNodesRef.current) {
      if (!tabIds.has(id)) {
        node.remove();
        tabNodesRef.current.delete(id);
      }
    }

    for (const tab of tabs) {
      const isTerminal = tab.type === "terminal";
      const node = getTabNode(tab.id, isTerminal);
      const altPath = altLeafPaths.get(tab.id);
      const altPaneEl = altPath ? altPaneEls[altPath] : null;
      const paneIdx = !altSplitLayout && isSplit ? paneTabIds.indexOf(tab.id) : -1;
      const inPane = paneIdx !== -1;
      const paneEl = inPane ? paneContentEls[paneIdx] : null;
      const activeInline = !altSplitLayout && !inPane && tab.id === activeTabId;

      if (altPaneEl) {
        if (node.parentElement !== altPaneEl) altPaneEl.appendChild(node);
        node.style.visibility = "visible";
        node.style.pointerEvents = "auto";
        node.style.display = "";
        node.style.zIndex = "";
      } else if (inPane && paneEl) {
        if (node.parentElement !== paneEl) paneEl.appendChild(node);
        node.style.visibility = "visible";
        node.style.pointerEvents = "auto";
        node.style.display = "";
        node.style.zIndex = "";
      } else {
        if (node.parentElement !== normalView) normalView.appendChild(node);
        if (isTerminal) {
          node.style.display = "";
          node.style.visibility = activeInline ? "visible" : "hidden";
          node.style.pointerEvents = activeInline ? "auto" : "none";
          node.style.zIndex = activeInline && !isSplit ? "1" : "0";
        } else {
          node.style.visibility = "";
          node.style.pointerEvents = "";
          node.style.zIndex = activeInline ? "2" : "";
          node.style.display = activeInline ? "" : "none";
        }
      }
    }
  });

  const activeTab = tabs.find((t) => t.id === activeTabId)!;

  function renderAltSplitNode(node: AltSplitNode, path = "root"): React.ReactNode {
    if (node.kind === "split") {
      const panelSizes = altSplitPanelSizes[path];
      return (
        <ResizablePanelGroup
          orientation={node.direction === "vertical" ? "horizontal" : "vertical"}
          defaultLayout={panelSizes}
          className="w-full h-full min-w-0 min-h-0"
          onLayoutChange={(sizes) =>
            setAltSplitPanelSizes((prev) => ({ ...prev, [path]: sizes }))
          }
        >
          <ResizablePanel defaultSize={panelSizes?.[0] ?? 50} minSize={12}>
            <div className="relative w-full h-full min-w-0 min-h-0">
              {renderAltSplitNode(node.first, `${path}:first`)}
            </div>
          </ResizablePanel>
          <ResizableHandle className={node.direction === "vertical" ? "w-1 bg-border hover:bg-accent-brand transition-colors data-[resize-handle-state=drag]:bg-accent-brand" : "h-1 bg-border hover:bg-accent-brand transition-colors data-[resize-handle-state=drag]:bg-accent-brand"} />
          <ResizablePanel defaultSize={panelSizes?.[1] ?? 50} minSize={12}>
            <div className="relative w-full h-full min-w-0 min-h-0">
              {renderAltSplitNode(node.second, `${path}:second`)}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      );
    }

    const tab = tabs.find((t) => t.id === node.tabId) ?? null;
    const focused = focusedAltTabId === node.tabId;
    return (
      <div
        className={`absolute inset-0 flex flex-col min-w-0 min-h-0 bg-background ${focused ? "ring-1 ring-inset ring-accent-brand/50" : ""}`}
        onMouseDown={() => {
          setFocusedAltTabId(node.tabId);
          setActiveTabId(node.tabId);
        }}
      >
        <div className={`flex items-center gap-1.5 px-2.5 h-7 shrink-0 border-b text-xs font-medium ${focused ? "bg-accent-brand/10 border-accent-brand/40 text-accent-brand" : "bg-sidebar border-border text-muted-foreground"}`}>
          {tab ? (
            <>
              <span className={focused ? "text-accent-brand" : "opacity-60"}>{tabIcon(tab.type)}</span>
              <span className="truncate">{tab.label}</span>
            </>
          ) : (
            <span className="opacity-40">Empty</span>
          )}
        </div>
        <div
          className="relative flex-1 min-h-0 overflow-hidden"
          ref={getAltPaneRef(path)}
        />
      </div>
    );
  }

  const terminalTabs = tabs.filter((t) => t.type === "terminal");

  // Sidebar panel content — shared between desktop inline sidebar and mobile sheet
  const sidebarPanelContent = (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div
        className={`flex flex-col flex-1 min-h-0 ${railView === "hosts" ? "" : "hidden"}`}
      >
        <HostsPanel
          onOpenTab={(host, type) => {
            connectHost(host, type);
            if (isMobile) setSidebarOpen(false);
          }}
          onEditHost={editHostInManager}
          hostTree={realHostTree ?? undefined}
          loading={hostsLoading}
          onEditingChange={setSidebarEditing}
          active={railView === "hosts"}
        />
      </div>

      <div
        className={`flex flex-col flex-1 min-h-0 ${railView === "credentials" ? "" : "hidden"}`}
      >
        <CredentialsPanel
          onEditingChange={setSidebarEditing}
          active={railView === "credentials"}
        />
      </div>

      {railView === "quick-connect" && (
        <QuickConnectPanel
          onConnect={(host, type) => {
            openTab(host, type);
            if (isMobile) setSidebarOpen(false);
          }}
        />
      )}

      {railView === "ssh-tools" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SshToolsPanel
            terminalTabs={terminalTabs}
            activeTabId={activeTabId}
          />
        </div>
      )}

      {railView === "snippets" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SnippetsPanel
            terminalTabs={terminalTabs}
            activeTabId={activeTabId}
          />
        </div>
      )}

      {railView === "history" && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto">
          <HistoryPanel terminalTabs={terminalTabs} activeTabId={activeTabId} />
        </div>
      )}

      {railView === "split-screen" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <SplitScreenPanel
            tabs={tabs}
            splitMode={splitMode}
            setSplitMode={setSplitMode}
            paneTabIds={paneTabIds}
            setPaneTabIds={setPaneTabIds}
            onAssignPane={assignPane}
          />
        </div>
      )}

      {railView === "connections" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ConnectionsPanel
            tabs={tabs}
            activeTabId={activeTabId}
            allHosts={allHosts}
            backgroundTabRecords={backgroundTabRecords}
            onSwitchToTab={(tabId) => {
              setActiveTabId(tabId);
              if (isMobile) setSidebarOpen(false);
            }}
            onCloseTab={closeTab}
            onReopenTab={(record, restoredSessionId) => {
              const host = record.hostId
                ? allHosts.find((h) => h.id === String(record.hostId))
                : undefined;
              const hostlessTypes: TabType[] = ["tunnel"];
              if (!host && !hostlessTypes.includes(record.tabType as TabType))
                return;
              setBackgroundTabRecords((prev) =>
                prev.filter((r) => r.id !== record.id),
              );
              if (host) {
                const effectiveSessionId =
                  restoredSessionId ?? record.backendSessionId ?? null;
                openTab(host, record.tabType as TabType, {
                  instanceId: record.id,
                  restoredSessionId: effectiveSessionId,
                });
              } else {
                openSingletonTab(record.tabType as TabType);
              }
              if (isMobile) setSidebarOpen(false);
            }}
            onForgetBackground={(recordId) => {
              setBackgroundTabRecords((prev) =>
                prev.filter((r) => r.id !== recordId),
              );
            }}
          />
        </div>
      )}

      {railView === "user-profile" && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <UserProfilePanel
            username={username}
            onLogout={onLogout}
            userPrefs={userPrefs}
            onPrefsChange={setUserPrefs}
          />
        </div>
      )}

      {railView === "admin-settings" && isAdmin && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <AdminSettingsPanel />
        </div>
      )}
    </div>
  );

  // Sidebar header — shared
  const sidebarHeader = (
    <div className="flex flex-row items-center border-b border-border h-12.5 shrink-0">
      <span className="flex-1 text-base font-bold tracking-tight text-foreground px-3">
        {sidebarTitle[railView]}
      </span>
      {!isMobile && (
        <>
          <Separator orientation="vertical" />
          <Button
            variant="ghost"
            size="icon"
            className="h-full w-12.5 border-y-0 border-border rounded-none text-muted-foreground hover:text-foreground"
            title="Reset width"
            onClick={() => setSidebarWidth(266)}
          >
            <Maximize2 className="size-3.5" />
          </Button>
        </>
      )}
      <Separator orientation="vertical" />
      <Button
        variant="ghost"
        size="icon"
        className="h-full w-12.5 rounded-none text-muted-foreground hover:text-foreground"
        onClick={() => setSidebarOpen(false)}
      >
        <ChevronLeft className="size-4" />
      </Button>
    </div>
  );

  return (
    <>
      <div className="flex w-screen bg-background" style={{ height: "100dvh" }}>
        {/* Skinny icon rail — desktop only, hidden on mobile */}
        <AppRail
          railView={railView}
          sidebarOpen={sidebarOpen}
          splitMode={splitMode}
          connectionCount={
            tabs.filter((t) => PERSISTENT_TAB_TYPES.includes(t.type)).length +
            backgroundTabRecords.length
          }
          username={username}
          isAdmin={isAdmin}
          profileDropdownOpen={profileDropdownOpen}
          onProfileDropdownChange={setProfileDropdownOpen}
          onRailClick={handleRailClick}
          onOpenTab={openSingletonTab}
          onLogout={onLogout}
        />

        {/* Desktop: inline resizable sidebar */}
        {!isMobile && (
          <div
            className={`relative flex flex-col bg-sidebar shrink-0 overflow-hidden ${sidebarOpen ? `border-r transition-colors ${sidebarDragging ? "border-accent-brand/60" : "border-border"}` : ""}`}
            style={{
              width: sidebarOpen ? (sidebarEditing ? 560 : sidebarWidth) : 0,
              transition: sidebarDragging ? "none" : "width 0.2s",
            }}
          >
            {sidebarHeader}
            {sidebarPanelContent}

            {sidebarOpen && !sidebarEditing && (
              <div
                onMouseDown={onSidebarMouseDown}
                className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-30 transition-colors ${sidebarDragging ? "bg-accent-brand/60" : "hover:bg-accent-brand/40"}`}
              />
            )}
          </div>
        )}

        {/* Mobile: sidebar as overlay sheet */}
        {isMobile && (
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="p-0 flex flex-col w-[min(85vw,360px)] max-w-full bg-sidebar border-r border-border gap-0"
              style={{ height: "100dvh" }}
            >
              {sidebarHeader}
              {sidebarPanelContent}
            </SheetContent>
          </Sheet>
        )}

        {/* Main content area */}
        <div
          className={`relative flex flex-col flex-1 min-w-0 overflow-hidden transition-all duration-200 ${!isMobile && !sidebarOpen ? "pl-6" : ""}`}
        >
          {!isMobile && !sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              title="Open Sidebar"
              className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-center w-6 bg-sidebar border-r border-border text-muted-foreground hover:text-accent-brand hover:bg-accent-brand/5 transition-colors"
            >
              <ChevronRight className="size-3.5" />
            </button>
          )}
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
            <TabBar
              tabs={tabs}
              activeTabId={activeTabId}
              splitMode={splitMode}
              paneTabIds={paneTabIds}
              focusedPaneIndex={focusedPaneIndex}
              hiddenTabIds={hiddenAltTabIds}
              onSetActiveTab={activateTab}
              onCloseTab={closeTab}
              onRefreshTab={refreshTab}
              onReorderTabs={setTabs}
              onSplitTab={splitTabQuick}
              onAddToSplit={addTabToSplit}
              onRemoveFromSplit={removeTabFromSplit}
            />
            <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
              {altSplitLayout && !isMobile && (
                <div className="absolute inset-0 z-10 bg-background">
                  {renderAltSplitNode(altSplitLayout)}
                </div>
              )}

              {/* Split view — always mounted when not mobile, hidden via CSS when inactive */}
              {!isMobile && (
                <div
                  className="absolute inset-0"
                  style={{
                    display: !altSplitLayout && isSplit ? "flex" : "none",
                    flexDirection: "column",
                  }}
                >
                  <SplitView
                    tabs={tabs}
                    paneTabIds={paneTabIds}
                    splitMode={splitMode}
                    focusedPaneIndex={focusedPaneIndex}
                    onTerminalResize={resizeAllTerminals}
                    onPaneContentRef={onPaneContentRef}
                    onPaneClick={setFocusedPaneIndex}
                    onAssignPane={assignPane}
                  />
                </div>
              )}

              {/* Normal-view container. Tab nodes are appended here (or to pane elements)
                  by the DOM-placement effect above. React portals each tab's content
                  into its stable per-tab node so the component is never remounted.
                  Hidden when split is active — pane-assigned nodes escape via vanilla DOM
                  appendChild to paneEl, so hiding this doesn't affect them. */}
              <div
                ref={normalViewRef}
                className="absolute inset-0"
                style={{ display: (isSplit || altSplitLayout) && !isMobile ? "none" : undefined }}
              >
                {tabs.map((tab) => {
                  const tabNode = getTabNode(tab.id, tab.type === "terminal");
                  const paneIdx = isSplit ? paneTabIds.indexOf(tab.id) : -1;
                  const inPane = paneIdx !== -1;
                  const activeInline = !inPane && tab.id === activeTabId;
                  const inAltPane = altLeafIds.has(tab.id);
                  return createPortal(
                    tab.type === "split_picker" ? (
                      <SplitTerminalPicker
                        recentTabs={tabs}
                        onPick={(host, type) => resolveSplitPicker(tab, host, type)}
                        onCancel={() => cancelSplitPicker(tab)}
                      />
                    ) : renderTabContent(
                      tab,
                      openSingletonTab,
                      openTab,
                      closeTab,
                      inPane || inAltPane || activeInline,
                    ),
                    tabNode,
                    tab.id,
                  );
                })}
              </div>
            </div>
          </div>

          {/* Bottom nav bar — mobile only */}
          <MobileBottomBar
            railView={railView}
            sidebarOpen={sidebarOpen}
            splitMode={splitMode}
            onRailClick={handleRailClick}
          />
        </div>
      </div>

      <CommandPalette
        isOpen={commandPaletteOpen}
        setIsOpen={setCommandPaletteOpen}
        hosts={allHosts}
        onOpenTab={(type, label, pendingEvent) => {
          if (
            [
              "dashboard",
              "host-manager",
              "user-profile",
              "admin-settings",
            ].includes(type)
          ) {
            openSingletonTab(type, pendingEvent);
          } else if (label) {
            const host = allHosts.find((h) => h.name === label);
            if (host) openTab(host, type);
          }
        }}
      />
    </>
  );
}
