import React, { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input.tsx";
import { Button } from "@/components/ui/button.tsx";
import { getSSHHosts } from "@/ui/main-axios.ts";
import { useTabs } from "@/ui/desktop/navigation/tabs/TabContext.tsx";

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

  const openFromHost = (host: any) => {
    const title = host?.name?.trim()
      ? host.name
      : host?.username
        ? `${host?.username}@${host?.ip}:${host?.port}`
        : `${(host?.connectionType || "ssh").toUpperCase()} ${host?.ip}:${host?.port}`;
    resolveSplitPickerToTerminal(pickerTabId, { title, hostConfig: host });
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
          <div className="flex flex-wrap gap-2">
            {recentTerminalTabs.map((item: any, idx: number) => {
              const host = item?.hostConfig;
              const label =
                item?.title || `${host?.username}@${host?.ip}:${host?.port}`;
              return (
                <Button
                  key={`${label}-${idx}`}
                  variant="outline"
                  className="max-w-full"
                  onClick={() => openFromHost(host)}
                >
                  <span className="truncate">{label}</span>
                </Button>
              );
            })}
          </div>
        </div>
      )}

      <div className="text-xs uppercase tracking-wide text-foreground-secondary mb-2">
        Todos los hosts
      </div>
      <div className="space-y-2">
        {filteredHosts.map((host: any) => {
          const label = host?.name?.trim()
            ? host.name
            : host?.username
              ? `${host?.username}@${host?.ip}:${host?.port}`
              : `${(host?.connectionType || "ssh").toUpperCase()} ${host?.ip}:${host?.port}`;
          const detail = host?.username
            ? `${host?.username}@${host?.ip}:${host?.port}`
            : `${(host?.connectionType || "ssh").toUpperCase()} ${host?.ip}:${host?.port}`;
          return (
            <button
              key={host.id}
              type="button"
              className="w-full text-left p-2 rounded border border-edge hover:bg-hover transition-colors"
              onClick={() => openFromHost(host)}
            >
              <div className="text-sm text-foreground truncate">{label}</div>
              <div className="text-xs text-foreground-secondary truncate">
                {detail}
              </div>
            </button>
          );
        })}
        {filteredHosts.length === 0 && (
          <div className="text-sm text-foreground-secondary p-2">
            No se encontraron terminales.
          </div>
        )}
      </div>
    </div>
  );
}
