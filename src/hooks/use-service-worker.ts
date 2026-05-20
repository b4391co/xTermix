import { useEffect, useState } from "react";
import { getBasePath } from "@/lib/base-path";

interface ServiceWorkerState {
  isSupported: boolean;
  isRegistered: boolean;
  updateAvailable: boolean;
}

export function useServiceWorker(): ServiceWorkerState {
  const [state, setState] = useState<ServiceWorkerState>({
    isSupported: false,
    isRegistered: false,
    updateAvailable: false,
  });

  useEffect(() => {
    const isSupported = false;
    const reloadKey = "termix_sw_ready_reloaded";

    setState((prev) => ({ ...prev, isSupported }));

    const registerServiceWorker = async () => {
      if (!isSupported) {
        if ("serviceWorker" in navigator) {
          try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((r) => r.unregister()));
          } catch (error) {
            console.error("[SW] Failed to unregister existing service workers:", error);
          }
        }
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register(
          `${getBasePath()}/sw.js`,
          { updateViaCache: "none" },
        );
        await registration.update();

        setState({
          isSupported: true,
          isRegistered: true,
          updateAvailable: false,
        });

        if (!navigator.serviceWorker.controller) {
          await navigator.serviceWorker.ready;
          if (sessionStorage.getItem(reloadKey) !== "true") {
            sessionStorage.setItem(reloadKey, "true");
            window.location.reload();
          }
        }
      } catch (error) {
        console.error("[SW] Registration failed:", error);
        setState({
          isSupported: true,
          isRegistered: false,
          updateAvailable: false,
        });
      }
    };

    if (document.readyState === "complete") {
      void registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker);
    }

    return () => {
      window.removeEventListener("load", registerServiceWorker);
    };
  }, []);

  return state;
}
