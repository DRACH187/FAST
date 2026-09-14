"use client";

import { useState } from "react";
import { ChatScreen } from "@/components/fast/chat-screen";
import { GateScreen } from "@/components/fast/gate-screen";
import { GtaLoading } from "@/components/fast/gta-loading";
import { HubScreen } from "@/components/fast/hub-screen";
import { MapScreen } from "@/components/fast/map-screen";
import { SplashScreen } from "@/components/fast/splash-screen";
import { useSessionManager } from "@/lib/fast/session-manager";

/**
 * FAST — secure session chat.
 * Flow: splash (logo) -> GTA-style boot (2 banners, exactly 6s) ->
 *       access gate ("187") -> hub <-> chat. A custom monochrome map of
 *       South African gang hotspots is available from the hub and chat.
 * Multiple sessions can be open at once; each holds its own keys in RAM.
 */
export default function Page() {
  const mgr = useSessionManager();
  const [mapOpen, setMapOpen] = useState(false);
  const openMap = () => setMapOpen(true);

  return (
    <div className="min-h-dvh bg-black text-neutral-100 flex flex-col">
      {mgr.phase === "splash" && <SplashScreen onComplete={() => mgr.setPhase("loading")} />}

      {mgr.phase === "loading" && <GtaLoading onComplete={() => mgr.setPhase("gate")} />}

      {mgr.phase === "gate" && <GateScreen onUnlock={mgr.unlock} />}

      {mgr.phase === "app" &&
        (mgr.activeSession ? (
          <ChatScreen
            session={mgr.activeSession}
            myFp={mgr.identityFp}
            onBack={() => mgr.setActiveCode(null)}
            onSend={(text) => mgr.sendMessage(mgr.activeSession.code, text)}
            onSendPhoto={(bytes) => mgr.sendPhoto(mgr.activeSession.code, bytes)}
            onOpenMap={openMap}
            onDelete={(code) => mgr.deleteSession(code)}
          />
        ) : (
          <HubScreen
            identityFp={mgr.identityFp}
            sessions={mgr.sessions}
            busy={mgr.connecting}
            onOpen={(code) => void mgr.openSession(code)}
            onStart={mgr.startSession}
            onJoin={mgr.joinSession}
            onDelete={mgr.deleteSession}
            onClose={mgr.closeSession}
            onOpenMap={openMap}
          />
        ))}

      <MapScreen open={mapOpen} onClose={() => setMapOpen(false)} />
    </div>
  );
}
