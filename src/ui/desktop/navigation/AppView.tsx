import React from "react";
import { Terminal } from "@/ui/desktop/apps/features/terminal/Terminal.tsx";
import { ServerStats as ServerView } from "@/ui/desktop/apps/features/server-stats/ServerStats.tsx";
import { FileManager } from "@/ui/desktop/apps/features/file-manager/FileManager.tsx";
import {
  GuacamoleDisplay,
  type GuacamoleConnectionConfig,
} from "@/ui/desktop/apps/features/guacamole/GuacamoleDisplay.tsx";
import { TunnelManager } from "@/ui/desktop/apps/features/tunnel/TunnelManager.tsx";
import { DockerManager } from "@/ui/desktop/apps/features/docker/DockerManager.tsx";
import { NetworkGraphCard } from "@/ui/desktop/apps/dashboard/cards/NetworkGraphCard";
import { SplitTerminalPicker } from "@/ui/desktop/navigation/SplitTerminalPicker.tsx";
import {
  useTabs,
  type SplitNode,
} from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable.tsx";
import { useSidebar } from "@/components/ui/sidebar.tsx";
import { toast } from "sonner";

interface TabData {
  id: number;
  type: string;
  title: string;
  terminalRef?: React.RefObject<any>;
  hostConfig?: any;
  connectionConfig?: GuacamoleConnectionConfig;
  instanceId?: string;
  executeCommand?: string;
}

interface AppViewProps {
  isTopbarOpen?: boolean;
  rightSidebarOpen?: boolean;
  rightSidebarWidth?: number;
}

function toPanelDirection(direction: "horizontal" | "vertical") {
  return direction === "horizontal" ? "vertical" : "horizontal";
}

export function AppView({
  isTopbarOpen = true,
  rightSidebarOpen = false,
  rightSidebarWidth = 400,
}: AppViewProps): React.ReactElement {
	  const {
	    tabs,
	    currentTab,
	    splitLayout,
	    splitLayouts,
	    splitPanelSizes,
	    focusedSplitTabId,
	    setFocusedSplitTab,
	    updateSplitPanelSizes,
	    getSessionRootForTab,
	    swapPaneTabs,
	    removeTab,
	    updateTab,
	  } = useTabs() as any;
  const { state: sidebarState } = useSidebar();
  const dragSourceRef = React.useRef<number | null>(null);
  const focusedPaneRef = React.useRef<number | null>(null);
  const [draggingPaneId, setDraggingPaneId] = React.useState<number | null>(
    null,
  );
  const [dragHoverPaneId, setDragHoverPaneId] = React.useState<number | null>(
    null,
  );

	  const tabMap = new Map(tabs.map((tab: TabData) => [tab.id, tab]));
	  const isSplitScreen = !!splitLayout;
	  const activeRootId =
	    currentTab && typeof getSessionRootForTab === "function"
	      ? getSessionRootForTab(currentTab)
	      : currentTab;

	  const renderedRootIds = React.useMemo(() => {
	    const roots = new Set<number>();
	    tabs.forEach((tab: TabData) => {
	      if (!tab?.id) return;
	      const rootId =
	        typeof getSessionRootForTab === "function"
	          ? getSessionRootForTab(tab.id)
	          : tab.id;
	      if (rootId && tabMap.has(rootId)) roots.add(rootId);
	    });
	    if (currentTab && !roots.has(currentTab)) roots.add(currentTab);
	    return Array.from(roots);
	  }, [tabs, currentTab, getSessionRootForTab, tabMap]);

	  const scheduleTerminalLayoutRefresh = React.useCallback(() => {
	    const refresh = () => {
	      tabs.forEach((tab: TabData) => {
	        const rootId =
	          typeof getSessionRootForTab === "function"
	            ? getSessionRootForTab(tab.id)
	            : tab.id;
	        if (rootId !== activeRootId) return;
	        const handle = tab.terminalRef?.current;
	        if (!handle) return;
	        if (typeof handle.fit === "function") {
	          handle.fit();
	          return;
	        }
	        if (typeof handle.notifyResize === "function") {
	          handle.notifyResize();
	          return;
	        }
	        if (typeof handle.refresh === "function") {
	          handle.refresh();
	        }
	      });
	    };
	    requestAnimationFrame(refresh);
	    window.setTimeout(refresh, 80);
	    window.setTimeout(refresh, 220);
	  }, [tabs, activeRootId, getSessionRootForTab]);

  React.useEffect(() => {
    focusedPaneRef.current = focusedSplitTabId || currentTab || null;
  }, [focusedSplitTabId, currentTab]);

  const focusPaneTerminal = React.useCallback(
    (tabId: number) => {
      focusedPaneRef.current = tabId;
      const allHelpers = Array.from(
        document.querySelectorAll(".xterm-helper-textarea"),
      ) as HTMLTextAreaElement[];
      allHelpers.forEach((el) => el.blur());
      const targetHelper = document.querySelector(
        `[data-termix-tab-id="${tabId}"] .xterm-helper-textarea`,
      ) as HTMLTextAreaElement | null;
      if (targetHelper) {
        targetHelper.focus();
      }
      const tab = tabMap.get(tabId);
      const focusFn = tab?.terminalRef?.current?.focus;
      if (typeof focusFn !== "function") return;
      focusFn();
      requestAnimationFrame(() => {
        focusFn();
        if (targetHelper) targetHelper.focus();
      });
      setTimeout(() => {
        focusFn();
        if (targetHelper) targetHelper.focus();
      }, 80);
    },
    [tabMap],
  );

  React.useEffect(() => {
    const targetTabId = splitLayout ? focusedSplitTabId || currentTab : currentTab;
    if (!targetTabId) return;
    focusPaneTerminal(targetTabId);
  }, [splitLayout, focusedSplitTabId, currentTab, tabs, focusPaneTerminal]);

	  React.useEffect(() => {
	    scheduleTerminalLayoutRefresh();
	  }, [currentTab, splitLayout, scheduleTerminalLayoutRefresh]);

	  const renderAppContent = (
	    tab: TabData,
	    splitScreen: boolean,
	    isVisible: boolean,
	  ) => {
    if (!tab) return null;

    if (tab.type === "terminal") {
	      const activeTabId = splitScreen ? focusedSplitTabId || currentTab : currentTab;
	      return (
	        <Terminal
	          key={`term-${tab.id}-${tab.instanceId || ""}`}
	          tabId={tab.id}
	          isActive={isVisible && activeTabId === tab.id}
	          ref={tab.terminalRef}
	          hostConfig={tab.hostConfig}
	          isVisible={isVisible}
          title={tab.title}
          showTitle={false}
          splitScreen={splitScreen}
          onClose={() => removeTab(tab.id)}
          onTitleChange={(title) => updateTab(tab.id, { title })}
          executeCommand={tab.executeCommand}
        />
      );
    }

    if (tab.type === "rdp" || tab.type === "vnc" || tab.type === "telnet") {
      if (tab.connectionConfig) {
        return (
	          <GuacamoleDisplay
	            key={`guac-${tab.id}-${tab.instanceId || ""}`}
	            connectionConfig={tab.connectionConfig}
	            isVisible={isVisible}
            onDisconnect={() => removeTab(tab.id)}
            onError={(err) => {
              toast.error(err || "Remote desktop connection error");
              removeTab(tab.id);
            }}
          />
        );
      }
      return (
        <div className="flex items-center justify-center h-full text-red-500">
          Missing connection configuration
        </div>
      );
    }

    if (tab.type === "server_stats") {
      return (
        <ServerView
          key={`stats-${tab.id}-${tab.instanceId || ""}`}
          hostConfig={tab.hostConfig}
          title={tab.title}
          isVisible
          isTopbarOpen={isTopbarOpen}
          embedded
        />
      );
    }

    if (tab.type === "split_picker") {
      return <SplitTerminalPicker pickerTabId={tab.id} />;
    }

    if (tab.type === "network_graph") {
      return (
        <NetworkGraphCard
          key={`netgraph-${tab.id}-${tab.instanceId || ""}`}
          isTopbarOpen={isTopbarOpen}
          rightSidebarOpen={rightSidebarOpen}
          rightSidebarWidth={rightSidebarWidth}
          embedded={false}
        />
      );
    }

    if (tab.type === "tunnel") {
      return (
        <TunnelManager
          key={`tunnel-${tab.id}-${tab.instanceId || ""}`}
          hostConfig={tab.hostConfig}
          title={tab.title}
          isVisible
          isTopbarOpen={isTopbarOpen}
          embedded
        />
      );
    }

    if (tab.type === "docker") {
      return (
        <DockerManager
          key={`docker-${tab.id}-${tab.instanceId || ""}`}
          hostConfig={tab.hostConfig}
          title={tab.title}
          isVisible
          isTopbarOpen={isTopbarOpen}
          embedded
          onClose={() => removeTab(tab.id)}
        />
      );
    }

    return (
      <FileManager
        key={`filemgr-${tab.id}-${tab.instanceId || ""}`}
        embedded
        initialHost={tab.hostConfig}
        onClose={() => removeTab(tab.id)}
      />
    );
  };

	  const renderLeaf = (
	    tabId: number,
	    isInSplitScreen: boolean,
	    isVisible: boolean,
	  ) => {
	    const tab = tabMap.get(tabId);
	    if (!tab) return <div className="h-full w-full bg-canvas" />;

	    const focusedId = focusedSplitTabId || currentTab;
	    const isFocused = isVisible && focusedId === tabId;

    const commitDropSwap = (targetId: number) => {
      const src = dragSourceRef.current;
      if (src === null || src === targetId) return;
      swapPaneTabs(src, targetId);
    };

    return (
      <div
        className={`h-full w-full overflow-hidden ${isFocused ? "ring-1 ring-primary" : ""} ${
          draggingPaneId !== null &&
          dragHoverPaneId === tabId &&
          draggingPaneId !== tabId
            ? "ring-2 ring-emerald-400"
            : ""
        }`}
	        onMouseDown={() => {
	          if (!isVisible) return;
	          focusedPaneRef.current = tabId;
	          setFocusedSplitTab(tabId);
	          focusPaneTerminal(tabId);
	        }}
	        onMouseDownCapture={() => {
	          if (!isVisible) return;
	          focusedPaneRef.current = tabId;
	          setFocusedSplitTab(tabId);
	          focusPaneTerminal(tabId);
	        }}
	        onClickCapture={() => {
	          if (!isVisible) return;
	          focusedPaneRef.current = tabId;
	          setFocusedSplitTab(tabId);
	          focusPaneTerminal(tabId);
	        }}
	        onDragEnter={() => {
	          if (!isVisible || !isInSplitScreen || draggingPaneId === null) return;
	          setDragHoverPaneId(tabId);
	        }}
	        onDragOver={(e) => {
	          if (!isVisible || !isInSplitScreen || draggingPaneId === null) return;
	          e.preventDefault();
	          if (dragHoverPaneId !== tabId) setDragHoverPaneId(tabId);
	        }}
	        onDrop={(e) => {
	          if (!isVisible || !isInSplitScreen) return;
	          e.preventDefault();
          const raw =
            e.dataTransfer.getData("text/plain") ||
            e.dataTransfer.getData("text/termix-pane-id");
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) {
            dragSourceRef.current = parsed;
          }
          commitDropSwap(tabId);
          setDraggingPaneId(null);
          setDragHoverPaneId(null);
          dragSourceRef.current = null;
        }}
      >
	        {isInSplitScreen && (
          <div
            className="bg-surface text-foreground text-[13px] h-[28px] leading-[28px] px-[10px] border-b border-edge tracking-[0px] cursor-grab active:cursor-grabbing"
            draggable
            onDragStart={(e) => {
              dragSourceRef.current = tabId;
              setDraggingPaneId(tabId);
              setDragHoverPaneId(tabId);
              e.dataTransfer.setData("text/plain", String(tabId));
              e.dataTransfer.setData("text/termix-pane-id", String(tabId));
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => {
              setDraggingPaneId(null);
              setDragHoverPaneId(null);
              dragSourceRef.current = null;
            }}
          >
            {tab.title}
          </div>
        )}
	        <div className={isInSplitScreen ? "h-[calc(100%-28px)]" : "h-full"}>
	          {renderAppContent(tab, isInSplitScreen, isVisible)}
	        </div>
      </div>
    );
  };

	  const renderSplitNode = (
	    node: SplitNode,
	    path = "root",
	    rootId = activeRootId || currentTab || 0,
	    isVisible = true,
	  ): React.ReactElement => {
		    if (node.kind === "leaf") {
	      return renderLeaf(node.tabId, true, isVisible);
		    }

	    const panelKey = `${rootId || "root"}:${path}`;
	    const storedSizes = Array.isArray(splitPanelSizes?.[panelKey])
	      ? splitPanelSizes[panelKey]
	      : null;
	    const firstSize =
	      storedSizes && Number.isFinite(Number(storedSizes[0]))
	        ? Number(storedSizes[0])
	        : 50;
	    const secondSize =
	      storedSizes && Number.isFinite(Number(storedSizes[1]))
	        ? Number(storedSizes[1])
	        : 50;

	    return (
	      <ResizablePanelGroup
	        key={`split:${path}:${node.direction}`}
	        direction={toPanelDirection(node.direction) as any}
	        className="h-full w-full"
	        onLayout={(sizes: number[]) => {
	          if (typeof updateSplitPanelSizes === "function") {
	            updateSplitPanelSizes(panelKey, sizes);
	          }
	          scheduleTerminalLayoutRefresh();
	        }}
	      >
	        <ResizablePanel
	          key={`${path}:first`}
	          defaultSize={firstSize}
	          minSize={15}
	          onResize={scheduleTerminalLayoutRefresh}
	        >
	          {renderSplitNode(node.first, `${path}:first`, rootId, isVisible)}
	        </ResizablePanel>
	        <ResizableHandle
	          className="bg-edge"
	          onDragging={scheduleTerminalLayoutRefresh}
	        />
	        <ResizablePanel
	          key={`${path}:second`}
	          defaultSize={secondSize}
	          minSize={15}
	          onResize={scheduleTerminalLayoutRefresh}
	        >
	          {renderSplitNode(node.second, `${path}:second`, rootId, isVisible)}
	        </ResizablePanel>
	      </ResizablePanelGroup>
    );
  };

  const topMarginPx = isTopbarOpen ? 74 : 26;
  const leftMarginPx = sidebarState === "collapsed" ? 26 : 8;
  const bottomMarginPx = 8;

  return (
    <div
      className="border-2 border-edge rounded-lg overflow-hidden overflow-x-hidden relative"
      style={{
        background: "var(--color-canvas)",
        marginLeft: leftMarginPx,
        marginRight: rightSidebarOpen
          ? `calc(var(--right-sidebar-width, ${rightSidebarWidth}px) + 8px)`
          : 17,
        marginTop: topMarginPx,
        marginBottom: bottomMarginPx,
        height: `calc(100vh - ${topMarginPx + bottomMarginPx}px)`,
        transition:
          "margin-left 200ms linear, margin-right 200ms linear, margin-top 200ms linear",
      }}
    >
	      {renderedRootIds.length > 0 ? (
	        renderedRootIds.map((rootId) => {
	          const rootLayout = splitLayouts?.[rootId] as SplitNode | undefined;
	          const isVisible = rootId === activeRootId;
	          return (
	            <div
	              key={`root:${rootId}`}
	              className={`absolute inset-0 ${isVisible ? "block" : "hidden"}`}
	              aria-hidden={!isVisible}
	            >
	              {rootLayout
	                ? renderSplitNode(rootLayout, "root", rootId, isVisible)
	                : renderLeaf(rootId, false, isVisible)}
	            </div>
	          );
	        })
	      ) : (
	        <div className="h-full w-full bg-canvas" />
	      )}
    </div>
  );
}
