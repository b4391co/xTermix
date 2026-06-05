# XTermix: lógica de pantalla dividida, pestañas y tmux

## Archivos principales

- `src/ui/desktop/navigation/tabs/TabContext.tsx`
- `src/ui/desktop/navigation/TopNavbar.tsx`
- `src/ui/desktop/navigation/AppView.tsx`
- `src/ui/desktop/navigation/SplitTerminalPicker.tsx`
- `src/ui/desktop/apps/features/terminal/Terminal.tsx`
- `src/types/index.ts`

## Resumen

La pantalla dividida de XTermix **no se hace con panes de tmux**.

La división visual se hace en React con un árbol `SplitNode` y `react-resizable-panels`.

`tmux` se usa para que cada terminal/pestaña tenga sesión persistente propia:

```bash
tmux new-session -Ad -s termix_<tabId>
tmux attach-session -t termix_<tabId>
```

Cada panel dividido apunta a una pestaña real mediante `tabId`.

---

## Atajos

```txt
Alt+D      dividir verticalmente, izquierda/derecha
Alt+E      dividir horizontalmente, arriba/abajo
Alt+T      abrir nueva terminal desde el panel enfocado
Alt+W      cerrar panel enfocado
Alt+←      mover/intercambiar panel hacia izquierda
Alt+→      mover/intercambiar panel hacia derecha
Alt+↑      mover/intercambiar panel hacia arriba
Alt+↓      mover/intercambiar panel hacia abajo
```

---

# 1. Tipos base del split

Archivo: `src/ui/desktop/navigation/tabs/TabContext.tsx`

```ts
export type SplitDirection = "horizontal" | "vertical";

export type SplitNode =
  | { kind: "leaf"; tabId: number }
  | {
      kind: "split";
      direction: SplitDirection;
      first: SplitNode;
      second: SplitNode;
    };
```

La estructura es un árbol binario:

```txt
leaf(tab 1)

split vertical
├─ leaf(tab 1)
└─ leaf(tab 2)

split horizontal
├─ leaf(tab 1)
└─ split vertical
   ├─ leaf(tab 2)
   └─ leaf(tab 3)
```

---

# 2. Tipo de pestaña

Archivo: `src/types/index.ts`

```ts
export interface TabContextTab {
  id: number;
  instanceId?: string;
  type:
    | "home"
    | "terminal"
    | "split_picker"
    | "ssh_manager"
    | "server_stats"
    | "admin"
    | "file_manager"
    | "user_profile"
    | "docker"
    | "network_graph"
    | "rdp"
    | "vnc"
    | "telnet";
  title: string;
  hostConfig?: SSHHost;
  terminalRef?: RefObject<TerminalRefHandle | null>;
  initialTab?: string;
  _updateTimestamp?: number;
  connectionConfig?: Record<string, unknown>;
  persistentSessionId?: string;
  executeCommand?: string;
}
```

Campos importantes:

- `type: "terminal"`: terminal SSH.
- `type: "split_picker"`: panel temporal para elegir qué abrir en una división.
- `persistentSessionId`: nombre de sesión persistente.
- `executeCommand`: comando que se ejecuta al abrir la terminal.
- `terminalRef`: referencia para hacer `focus`, `fit`, `sendInput`, etc.

---

# 3. tmux: persistencia de cada terminal

Archivo: `src/ui/desktop/navigation/tabs/TabContext.tsx`

```ts
function buildPersistentShellCommand(sessionId: string): string {
  const safeSession = (sessionId || "termix_default").replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );

  return `if command -v tmux >/dev/null 2>&1; then tmux new-session -Ad -s "${safeSession}" 2>/dev/null && { tmux set-option -t "${safeSession}" -g mouse on; tmux set-option -t "${safeSession}" -g set-clipboard off; tmux set-option -t "${safeSession}" -g xterm-keys on 2>/dev/null || true; tmux set-option -t "${safeSession}" -g extended-keys on 2>/dev/null || true; tmux set-option -t "${safeSession}" -as terminal-features "xterm-256color:extkeys" 2>/dev/null || true; tmux attach-session -t "${safeSession}"; } || tmux attach-session -t "${safeSession}" 2>/dev/null || true; elif command -v screen >/dev/null 2>&1; then screen -xRR "${safeSession}" 2>/dev/null || screen -R "${safeSession}"; else echo "[Termix] tmux/screen no disponible; esta terminal no sera persistente al recargar."; for shell in bash sh /bin/bash /usr/bin/bash /bin/sh /usr/bin/sh /bin/ash /bin/dash /bin/busybox; do if command -v "\$shell" >/dev/null 2>&1; then exec "\$shell"; fi; done; fi`;
}
```

Lógica:

1. Sanea el nombre de sesión.
2. Si existe `tmux`, crea/reutiliza una sesión:

```bash
tmux new-session -Ad -s "$session"
```

3. Configura tmux:

```bash
tmux set-option -g mouse on
tmux set-option -g set-clipboard off
tmux set-option -g xterm-keys on
tmux set-option -g extended-keys on
```

4. Se engancha a la sesión:

```bash
tmux attach-session -t "$session"
```

5. Si no hay tmux, intenta `screen`.
6. Si no hay tmux ni screen, abre shell normal.

---

# 4. Creación de una pestaña terminal con tmux

Archivo: `TabContext.tsx`

```ts
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
  isPinned: Boolean(tabData.isPinned),
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
```

Cada terminal nueva recibe:

```ts
persistentSessionId = `termix_${id}`;
executeCommand = buildPersistentShellCommand(persistentSessionId);
```

---

# 5. Atajos Alt+D, Alt+E, Alt+W

Archivo: `src/ui/desktop/navigation/TopNavbar.tsx`

```ts
React.useEffect(() => {
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
      openNewTerminalFromFocused();
      return;
    }

    if (key === "w") {
      e.preventDefault();
      e.stopPropagation();
      closeFocusedPane();
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      moveFocusedPane("left");
      return;
    }

    if (e.key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      moveFocusedPane("right");
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      moveFocusedPane("up");
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      moveFocusedPane("down");
    }
  };

  window.addEventListener("keydown", onGlobalKeyDown, true);
  return () => window.removeEventListener("keydown", onGlobalKeyDown, true);
}, [
  splitFocusedPane,
  openNewTerminalFromFocused,
  closeFocusedPane,
  moveFocusedPane,
]);
```

---

# 6. Dividir el panel enfocado

Archivo: `TabContext.tsx`

```ts
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
```

Lógica:

1. Busca layout actual.
2. Si no hay layout, crea uno desde la pestaña actual.
3. Localiza el panel enfocado.
4. Crea una pestaña temporal `split_picker`.
5. Sustituye la hoja actual por un nodo `split`.
6. Enfoca el nuevo panel.

---

# 7. Selector de host para el nuevo panel

Archivo: `src/ui/desktop/navigation/SplitTerminalPicker.tsx`

```ts
export function SplitTerminalPicker({
  pickerTabId,
}: SplitTerminalPickerProps): React.ReactElement {
  const { recentTerminalTabs, resolveSplitPickerToTerminal, cancelSplitPicker } =
    useTabs() as any;

  const [hosts, setHosts] = useState<any[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    getSSHHosts()
      .then((data) => {
        if (active) setHosts(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (active) setHosts([]);
      });
    return () => {
      active = false;
    };
  }, []);
```

Al elegir host:

```ts
const openFromHost = (
  host: any,
  appType?: "terminal" | "file_manager" | "server_stats",
) => {
  const title = resolveTitle(host);
  resolveSplitPickerToTerminal(pickerTabId, {
    title,
    hostConfig: host,
    appType,
  });
};
```

Flujo:

```txt
Alt+D / Alt+E
└─ splitFocusedPane()
   └─ crea tab split_picker
      └─ SplitTerminalPicker
         └─ usuario elige host/app
            └─ resolveSplitPickerToTerminal()
               └─ sustituye split_picker por terminal real
```

---

# 8. Añadir o quitar una pestaña existente del split

Archivo: `TabContext.tsx`

```ts
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
```

---

# 9. Cerrar panel enfocado con Alt+W

Archivo: `TabContext.tsx`

```ts
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
```

---

# 10. Render visual del split

Archivo: `src/ui/desktop/navigation/AppView.tsx`

```ts
function toPanelDirection(direction: "horizontal" | "vertical") {
  return direction === "horizontal" ? "vertical" : "horizontal";
}
```

Importante:

- `SplitDirection: "horizontal"` significa dividir arriba/abajo.
- `ResizablePanelGroup orientation="vertical"` hace paneles arriba/abajo.
- `SplitDirection: "vertical"` significa dividir izquierda/derecha.
- `ResizablePanelGroup orientation="horizontal"` hace paneles izquierda/derecha.

Render recursivo:

```tsx
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
      orientation={toPanelDirection(node.direction)}
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
```

---

# 11. Barra de título dentro de cada panel dividido

Archivo: `AppView.tsx`

```tsx
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
```

Cada panel dividido muestra una mini barra con el título de la pestaña.

También permite arrastrar un panel para intercambiarlo con otro.

---

# 12. Foco del panel

Archivo: `AppView.tsx`

```ts
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
```

Al hacer click en un panel:

```tsx
onMouseDown={() => {
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
```

Esto permite que `Alt+D`, `Alt+E` y `Alt+W` actúen sobre el panel correcto.

---

# 13. Mover/intercambiar panel con Alt+flechas

Archivo: `TabContext.tsx`

```ts
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
```

No mueve nodos completos: intercambia los `tabId` de las hojas.

---

# 14. Render final de raíces/pestañas

Archivo: `AppView.tsx`

```tsx
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
```

Cada raíz se mantiene montada, pero solo la activa se muestra.

---

# Esquema general

```txt
TopNavbar
└─ Captura Alt+D / Alt+E / Alt+W
   └─ Llama funciones de TabContext

TabContext
├─ tabs[]
├─ currentTab
├─ focusedSplitTabId
├─ splitLayouts[rootTabId] = SplitNode
├─ splitPanelSizes[panelKey]
├─ splitFocusedPane()
├─ closeFocusedPane()
├─ moveFocusedPane()
└─ buildPersistentShellCommand() -> tmux

AppView
├─ Lee splitLayouts
├─ renderSplitNode()
│  ├─ ResizablePanelGroup
│  ├─ ResizablePanel first
│  ├─ ResizableHandle
│  └─ ResizablePanel second
└─ renderLeaf()
   └─ Terminal / FileManager / ServerStats / Docker / etc.

Terminal
└─ Al conectar ejecuta executeCommand
   └─ tmux new-session -Ad -s termix_<tabId>
   └─ tmux attach-session -t termix_<tabId>
```

---

# Conclusión

La división visual es frontend React:

```ts
splitLayouts[rootId] = {
  kind: "split",
  direction: "vertical" | "horizontal",
  first: { kind: "leaf", tabId: ... },
  second: { kind: "leaf", tabId: ... },
};
```

`tmux` no divide la pantalla en XTermix.

`tmux` solo mantiene viva cada terminal/pestaña:

```bash
tmux new-session -Ad -s termix_<tabId>
tmux attach-session -t termix_<tabId>
```

Los splits principales se activan desde `TopNavbar.tsx`:

```txt
Alt+D => split vertical
Alt+E => split horizontal
Alt+W => cerrar panel
Alt+T => nueva terminal desde panel enfocado
```
