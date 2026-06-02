import React, { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getSSHHosts } from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";
import { FolderOpen, MonitorCog, Terminal } from "lucide-react";

interface SplitTerminalPickerProps {
  pickerTabId: number;
}

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

  const q = query.trim().toLowerCase();
  const filteredHosts = useMemo(() => {
    if (!q) return hosts;
    return hosts.filter((h: any) => {
      const text = [
        h?.name || "",
        h?.username || "",
        h?.ip || "",
        h?.port?.toString?.() || "",
        h?.folder || "",
        ...(Array.isArray(h?.tags) ? h.tags : []),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(q);
    });
  }, [hosts, q]);

  const resolveTitle = (host: any) => {
    if (host?.name?.trim()) {
      return host.name;
    }
    if (host?.username) {
      return `${host.username}@${host.ip}:${host.port}`;
    }
    return `${(host?.connectionType || "ssh").toUpperCase()} ${host.ip}:${host.port}`;
  };

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

  const renderHostActions = (host: any) => {
    return (
      <div className="flex items-center gap-1">
        <Button
          size="icon"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            openFromHost(host, "terminal");
          }}
          title="Abrir terminal"
        >
          <Terminal className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            openFromHost(host, "file_manager");
          }}
          title="Abrir carpeta"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            openFromHost(host, "server_stats");
          }}
          title="Abrir estado"
        >
          <MonitorCog className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  };

  const renderRecentHost = (item: any, idx: number) => {
    const host = item?.hostConfig || {};
    const label = item?.title || resolveTitle(host);
    return (
      <div
        key={`${label}-${idx}`}
        className="rounded border border-edge hover:bg-hover transition-colors p-2"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex-1 text-left"
            onClick={() => openFromHost(host, "terminal")}
          >
            <div className="text-sm text-foreground truncate">{label}</div>
            <div className="text-xs text-foreground-secondary truncate">
              {resolveTitle(host)}
            </div>
          </button>
          {renderHostActions(host)}
        </div>
      </div>
    );
  };

  const renderHostRow = (host: any) => {
    const label = resolveTitle(host);
    const detail = host?.username
      ? `${host.username}@${host.ip}:${host.port}`
      : `${(host?.connectionType || "ssh").toUpperCase()} ${host.ip}:${host.port}`;
    return (
      <div
        key={host.id}
        className="rounded border border-edge hover:bg-hover transition-colors p-2"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex-1 text-left"
            onClick={() => openFromHost(host, "terminal")}
          >
            <div className="text-sm text-foreground truncate">{label}</div>
            <div className="text-xs text-foreground-secondary truncate">
              {detail}
            </div>
          </button>
          {renderHostActions(host)}
        </div>
      </div>
    );
  };

  const hasRecent =
    Array.isArray(recentTerminalTabs) && recentTerminalTabs.length > 0;

  return (
    <div className="h-full w-full bg-canvas p-3 overflow-auto">
      <div className="flex items-center gap-2 mb-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar host..."
          className="h-9"
          autoFocus
        />
        <Button variant="outline" onClick={() => cancelSplitPicker(pickerTabId)}>
          Cancelar
        </Button>
      </div>

      {hasRecent && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wide text-foreground-secondary mb-2">
            Recientes
          </div>
          <div className="space-y-2">
            {recentTerminalTabs.map((item: any, idx: number) =>
              renderRecentHost(item, idx),
            )}
          </div>
        </div>
      )}

      <div className="text-xs uppercase tracking-wide text-foreground-secondary mb-2">
        Todos los hosts
      </div>
      <div className="space-y-2">
        {filteredHosts.map((host: any) => renderHostRow(host))}
        {filteredHosts.length === 0 && (
          <div className="text-sm text-foreground-secondary p-2">
            No se encontraron terminales.
          </div>
        )}
      </div>
    </div>
  );
}
