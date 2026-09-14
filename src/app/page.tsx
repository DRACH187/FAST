"use client";

import { useState } from "react";
import { ChatScreen } from "@/components/fast/chat-screen";
import { GateScreen } from "@/components/fast/gate-screen";
import { HubScreen } from "@/components/fast/hub-screen";
import { MapScreen } from "@/components/fast/map-screen";
import { SplashScreen } from "@/components/fast/splash-screen";
import { useSessionManager } from "@/lib/fast/session-manager";

/**
 * FAST — discreet secure sessions.
 * Flow: splash (logo + maker credit) -> access gate ("187") -> hub <-> chat.
 * A monochrome South Africa safety map with live analytics is available from
 * the hub and chat. Multiple sessions can be open at once; keys live only in
 * RAM; every chat self-wipes 5 hours after it was created.
 */
export default function Page() {
  const mgr = useSessionManager();
  const [mapOpen, setMapOpen] = useState(false);
  const openMap = () => setMapOpen(true);
  const active = mgr.activeSession;

  return (
    <div className="min-h-dvh bg-black text-neutral-100 flex flex-col">
      {mgr.phase === "splash" && <SplashScreen onComplete={() => mgr.setPhase("gate")} />}

      {mgr.phase === "gate" && <GateScreen onUnlock={mgr.unlock} />}

      {mgr.phase === "app" &&
        (active ? (
          <ChatScreen
            session={active}
            myFp={mgr.identityFp}
            onBack={() => mgr.setActiveCode(null)}
            onSend={(text) => mgr.sendMessage(active.code, text)}
            onSendPhoto={(bytes) => mgr.sendPhoto(active.code, bytes)}
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
            onJoin={async (code) => {
              await mgr.joinSession(code);
            }}
            onDelete={mgr.deleteSession}
            onClose={mgr.closeSession}
            onOpenMap={openMap}
          />
        ))}

      <MapScreen open={mapOpen} onClose={() => setMapOpen(false)} />
    </div>
  );
}
