"use client";

import { ChatScreen } from "@/components/fast/chat-screen";
import { GateScreen } from "@/components/fast/gate-screen";
import { HubScreen } from "@/components/fast/hub-screen";
import { SplashScreen } from "@/components/fast/splash-screen";
import { useSessionManager } from "@/lib/fast/session-manager";

/**
 * FAST — secure session chat.
 * Flow: splash (logo only) -> access gate ("187") -> hub <-> chat.
 * Multiple sessions can be open at once; each holds its own keys in RAM.
 */
export default function Page() {
  const mgr = useSessionManager();

  return (
    <div className="min-h-dvh bg-black text-neutral-100 flex flex-col">
      {mgr.phase === "splash" && <SplashScreen onComplete={() => mgr.setPhase("gate")} />}

      {mgr.phase === "gate" && <GateScreen onUnlock={mgr.unlock} />}

      {mgr.phase === "app" &&
        (mgr.activeSession ? (
          <ChatScreen
            session={mgr.activeSession}
            myFp={mgr.identityFp}
            onBack={() => mgr.setActiveCode(null)}
            onSend={(text) => mgr.sendMessage(mgr.activeSession.code, text)}
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
          />
        ))}
    </div>
  );
}
