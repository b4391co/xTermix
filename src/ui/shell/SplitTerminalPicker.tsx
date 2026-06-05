import { useEffect, useMemo, useState } from "react";
import { FolderOpen, MonitorCog, Search, Terminal } from "lucide-react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { getSSHHosts } from "@/main-axios";
import type { Host, Tab, TabType } from "@/types/ui-types";
import type { SSHHostWithStatus } from "@/main-axios";

function toHost(h: SSHHostWithStatus): Host {
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
    quickActions: [],
    jumpHosts: [],
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

function labelFor(host: Host) {
  return host.name?.trim() || `${host.username}@${host.ip}:${host.port}`;
}

export function SplitTerminalPicker({
  recentTabs,
  onPick,
  onCancel,
}: {
  recentTabs: Tab[];
  onPick: (host: Host, type: TabType) => void;
  onCancel: () => void;
}) {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let active = true;
    getSSHHosts()
      .then((data) => {
        if (active) setHosts((Array.isArray(data) ? data : []).map(toHost));
      })
      .catch(() => {
        if (active) setHosts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const filteredHosts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return hosts;
    return hosts.filter((host) =>
      [host.name, host.username, host.ip, host.port, host.folder, ...(host.tags ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [hosts, query]);

  const recentTerminalTabs = recentTabs
    .filter((tab) => tab.host && tab.type !== "split_picker")
    .slice(0, 6);

  function actions(host: Host) {
    return (
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="outline" onClick={() => onPick(host, "terminal")} title="Abrir terminal">
          <Terminal className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="outline" onClick={() => onPick(host, "files")} title="Abrir archivos">
          <FolderOpen className="size-3.5" />
        </Button>
        <Button size="icon-sm" variant="outline" onClick={() => onPick(host, "stats")} title="Abrir estado">
          <MonitorCog className="size-3.5" />
        </Button>
      </div>
    );
  }

  function row(host: Host, key: string) {
    return (
      <div key={key} className="border border-border bg-background/60 hover:bg-muted/60 p-2 transition-colors">
        <div className="flex items-center gap-2">
          <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onPick(host, "terminal")}>
            <div className="text-sm font-medium truncate">{labelFor(host)}</div>
            <div className="text-xs text-muted-foreground truncate">{host.username}@{host.ip}:{host.port}</div>
          </button>
          {actions(host)}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full bg-background p-3 overflow-auto">
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar host..." className="pl-7" autoFocus />
        </div>
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
      </div>

      {recentTerminalTabs.length > 0 && (
        <div className="mb-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Recientes</div>
          <div className="space-y-2">{recentTerminalTabs.map((tab) => row(tab.host!, `recent-${tab.id}`))}</div>
        </div>
      )}

      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Todos los hosts</div>
      <div className="space-y-2">
        {filteredHosts.map((host) => row(host, `host-${host.id}`))}
        {filteredHosts.length === 0 && <div className="text-sm text-muted-foreground p-2">No se encontraron hosts.</div>}
      </div>
    </div>
  );
}
