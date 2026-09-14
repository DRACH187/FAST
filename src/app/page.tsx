"use client";

import { useState } from "react";
import { CallsignScreen } from "@/components/fast/callsign-screen";
import { ChatScreen } from "@/components/fast/chat-screen";
import { GateScreen } from "@/components/fast/gate-screen";
import { HubScreen } from "@/components/fast/hub-screen";
import { LiveScreen } from "@/components/fast/live-screen";
import { MapScreen } from "@/components/fast/map-screen";
import { SplashScreen } from "@/components/fast/splash-screen";
import { WantedScreen } from "@/components/fast/wanted-screen";
import { useSessionManager } from "@/lib/fast/session-manager";

/**
 * FAST — discreet secure sessions.
 * Flow: splash (logo + maker credit) -> access gate ("187") -> callsign login
 * (first visit only) -> hub <-> chat. Overlays: SURROUNDINGS map, WANTED
 * board (zero-knowledge encrypted bulletins) and the LIVE operatives board.
 * A monochrome South Africa safety map with live analytics is available from
 * the hub and chat. Multiple sessions can be open at once; keys live only in
 * RAM; every chat self-wipes 5 hours after it was created.
 */
export default function Page() {
  const mgr = useSessionManager();
  const [mapOpen, setMapOpen] = useState(false);
  const [wantedOpen, setWantedOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const openMap = () => setMapOpen(true);
  const active = mgr.activeSession;

  return (
    <div className="min-h-dvh bg-black text-neutral-100 flex flex-col">
      {mgr.phase === "splash" && <SplashScreen onComplete={() => mgr.setPhase("gate")} />}

      {mgr.phase === "gate" && <GateScreen onUnlock={mgr.unlock} />}

      {mgr.phase === "callsign" && (
        <CallsignScreen fingerprint={mgr.identityFp} onReady={mgr.setCallsign} />
      )}

      {mgr.phase === "app" &&
        (active ? (
          <ChatScreen
            session={active}
            myFp={mgr.identityFp}
            callsign={mgr.callsign}
            onBack={() => mgr.setActiveCode(null)}
            onSend={(text) => mgr.sendMessage(active.code, text)}
            onSendPhoto={(bytes) => mgr.sendPhoto(active.code, bytes)}
            onOpenMap={openMap}
            onOpenWanted={() => setWantedOpen(true)}
            onOpenLive={() => setLiveOpen(true)}
            onDelete={(code) => mgr.deleteSession(code)}
          />
        ) : (
          <HubScreen
            identityFp={mgr.identityFp}
            callsign={mgr.callsign}
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
            onOpenWanted={() => setWantedOpen(true)}
            onOpenLive={() => setLiveOpen(true)}
          />
        ))}

      <MapScreen open={mapOpen} onClose={() => setMapOpen(false)} />
      <WantedScreen
        open={wantedOpen}
        onClose={() => setWantedOpen(false)}
        myFp={mgr.identityFp}
        myNickname={mgr.callsign?.nickname ?? "GHOST"}
        myRole={mgr.callsign?.role ?? "member"}
      />
      <LiveScreen
        open={liveOpen}
        onClose={() => setLiveOpen(false)}
        myFp={mgr.identityFp}
      />
    </div>
  );
}
