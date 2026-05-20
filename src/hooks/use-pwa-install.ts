import { useEffect, useState } from "react";

type PwaPromptOutcome = "accepted" | "dismissed";
type InstallOutcome =
  | PwaPromptOutcome
  | "unavailable"
  | "installed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: PwaPromptOutcome; platform: string }>;
}

interface PwaInstallState {
  canInstall: boolean;
  isInstalled: boolean;
  isSecureContext: boolean;
  browserName: string;
  installHelp: string;
  installUrl: string;
  install: () => Promise<InstallOutcome>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function getBrowserName(): string {
  const userAgent = navigator.userAgent;
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/Brave\//.test(userAgent)) return "Brave";
  if (/Chrome\//.test(userAgent) || /Chromium\//.test(userAgent)) {
    return "Chrome/Chromium";
  }
  return "este navegador";
}

function getInstallHelp(canInstall: boolean): string {
  if (isStandalone()) return "Termix ya esta abierto como aplicacion.";

  if (!window.isSecureContext) {
    return [
      "Chrome, Edge y Brave solo permiten instalar una PWA desde HTTPS o localhost.",
      "Con HTTP sin TLS el navegador puede bloquear el instalador.",
      "Entra por HTTPS con un certificado aceptado y vuelve a pulsar Instalar Termix.",
    ].join(" ");
  }

  if (canInstall) {
    return "Pulsa Instalar Termix para abrir el instalador nativo del navegador.";
  }

  return [
    "El navegador aun no ha habilitado el instalador.",
    "Recarga la pagina una vez y abre Tools > Instalar aplicacion.",
    "Si sigue sin aparecer, usa el menu del navegador: Chrome/Brave > Guardar y compartir > Instalar pagina como aplicacion; Edge > Aplicaciones > Instalar este sitio como una aplicacion.",
  ].join(" ");
}

export function usePwaInstall(): PwaInstallState {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [browserName, setBrowserName] = useState("este navegador");

  useEffect(() => {
    setIsInstalled(isStandalone());
    setBrowserName(getBrowserName());

    void (async () => {
      const maybeBrave = navigator as Navigator & {
        brave?: { isBrave?: () => Promise<boolean> };
      };
      if (await maybeBrave.brave?.isBrave?.()) {
        setBrowserName("Brave");
      }
    })();

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (isInstalled) return "installed";
    if (!installPrompt) return "unavailable";

    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (outcome === "accepted") {
      setIsInstalled(true);
    }
    return outcome;
  };

  return {
    canInstall: Boolean(installPrompt),
    isInstalled,
    isSecureContext: window.isSecureContext,
    browserName,
    installHelp: getInstallHelp(Boolean(installPrompt)),
    installUrl: "https://localhost/",
    install,
  };
}
