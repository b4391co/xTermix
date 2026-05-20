import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { isElectron } from "@/lib/electron";
import { toast } from "sonner";

export function PwaInstallButton() {
  const {
    canInstall,
    isInstalled,
    isSecureContext,
    installUrl,
    installHelp,
    install,
  } = usePwaInstall();

  if (isElectron() || isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (!isSecureContext) {
      window.location.href = installUrl;
      return;
    }

    const outcome = await install();
    if (outcome === "accepted" || outcome === "installed") {
      toast.success("Termix instalado como aplicacion");
      return;
    }

    if (outcome === "dismissed") {
      return;
    }

    toast.info(installHelp, { duration: 12000 });
  };

  return (
    <Button
      type="button"
      variant={canInstall ? "default" : "outline"}
      size="sm"
      className="fixed bottom-4 left-4 z-50 gap-2 shadow-lg"
      onClick={handleClick}
    >
      <Download className="h-4 w-4" />
      {isSecureContext ? "Instalar Termix" : "Abrir HTTPS para instalar"}
    </Button>
  );
}
