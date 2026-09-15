"use client";

import { useState } from "react";
import { DockNav, SideRail, type AppTab } from "@/components/fast/app-nav";
import { BossPanel } from "@/components/fast/boss-panel";
import { CallsignScreen } from "@/components/fast/callsign-screen";
import { ChatScreen } from "@/components/fast/chat-screen";
import { GateScreen } from "@/components/fast/gate-screen";
import { HubScreen } from "@/components/fast/hub-screen";
import { LiveScreen } from "@/components/fast/live-screen";
import { MapScreen } from "@/components/fast/map-screen";
import { SplashScreen } from "@/components/fast/splash-screen";
import { WantedScreen } from "@/components/fast/wanted-screen";
import { ProfileSheet } from "@/components/fast/profile-sheet";
import { useSessionManager } from "@/lib/fast/session-manager";

/**
 * FAST — discreet secure sessions.
 * Flow: splash (logo + maker credit) -> access gate ("187") -> callsign login
 * (first visit only) -> the shell. The shell owns ONE tab state:
 *
 *   mobile  — content full-bleed + a floating pill dock (Mobbin-grade);
 *             a focused chat hides the dock and exits via its back arrow.
 *   desktop — a persistent SideRail beside a content pane; tool views
 *             (WANTED / KAART / LIVE) fill the pane instead of the screen.
 *
 * Keys live only in RAM; every chat self-wipes 5 hours after creation.
 */
export default function Page() {
  const mgr = useSessionManager();
  const [tab, setTab] = useState<AppTab>("hub");
  const [profileOpen, setProfileOpen] = useState(false);
  const [bossPanelOpen, setBossPanelOpen] = useState(false);
  const active = mgr.activeSession;

  // Werwe on the dock/rail is the LIST — tapping it deliberately closes a
  // focused chat (native messenger behaviour).
  const handleTab = (t: AppTab) => {
    setTab(t);
    if (t === "hub") mgr.setActiveCode(null);
  };

  // Tool views outrank the chat (opening KAART from a chat's menu overlays it;
  // closing the tool lands you straight back in the conversation).
  const toolView = tab !== "hub" ? tab : null;
  const openSession = (code: string) => {
    setTab("hub");
    void mgr.openSession(code);
  };

  const unreadTotal = mgr.sessions.reduce((n, s) => n + s.unread, 0);

  return (
    <div className="min-h-dvh bg-black text-neutral-100 flex flex-col">
      {mgr.phase === "splash" && <SplashScreen onComplete={() => mgr.setPhase("gate")} />}

      {mgr.phase === "gate" && (
        <div key="gate" className="fast-fade">
          <GateScreen onUnlock={mgr.unlock} />
        </div>
      )}

      {mgr.phase === "callsign" && (
        <div key="callsign" className="fast-fade">
          <CallsignScreen fingerprint={mgr.identityFp} onReady={mgr.setCallsign} />
        </div>
      )}

      {mgr.phase === "app" && (
        <div className="flex h-dvh overflow-hidden bg-black">
          {/* desktop spine — the custom desktop layout's rail */}
          <SideRail
            tab={tab}
            onTab={handleTab}
            callsign={mgr.callsign}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenBossPanel={() => setBossPanelOpen(true)}
            openSessions={mgr.sessions.length}
            unread={unreadTotal}
          />

          {/* content pane — every view lives or overlays in here */}
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
            {toolView === "wanted" ? (
              <div key="wanted" className="fast-fade absolute inset-0">
                <WantedScreen
                  open
                  onClose={() => setTab("hub")}
                  myFp={mgr.identityFp}
                  myNickname={mgr.callsign?.nickname ?? "GHOST"}
                  myRole={mgr.callsign?.role ?? "member"}
                  myToken={mgr.callsign?.token ?? ""}
                />
              </div>
            ) : toolView === "map" ? (
              <div key="map" className="fast-fade absolute inset-0">
                <MapScreen open onClose={() => setTab("hub")} />
              </div>
            ) : toolView === "live" ? (
              <div key="live" className="fast-fade absolute inset-0">
                <LiveScreen open onClose={() => setTab("hub")} myFp={mgr.identityFp} />
              </div>
            ) : active ? (
              <div key={`chat-${active.code}`} className="fast-fade flex min-h-0 flex-1 flex-col">
                <ChatScreen
                  session={active}
                  myFp={mgr.identityFp}
                  callsign={mgr.callsign}
                  onBack={() => mgr.setActiveCode(null)}
                  onSend={(text) => mgr.sendMessage(active.code, text)}
                  onSendPhoto={(bytes) => mgr.sendPhoto(active.code, bytes)}
                  onOpenMap={() => setTab("map")}
                  onOpenWanted={() => setTab("wanted")}
                  onOpenLive={() => setTab("live")}
                  onDelete={(code) => mgr.deleteSession(code)}
                />
              </div>
            ) : (
              <div key="hub" className="fast-fade flex min-h-0 flex-1 flex-col">
                <HubScreen
                  identityFp={mgr.identityFp}
                  callsign={mgr.callsign}
                  sessions={mgr.sessions}
                  busy={mgr.connecting}
                  onOpen={openSession}
                  onStart={mgr.startSession}
                  onJoin={async (code) => {
                    await mgr.joinSession(code);
                  }}
                  onDelete={mgr.deleteSession}
                  onClose={mgr.closeSession}
                  onSwitchCallsign={mgr.switchCallsign}
                  onOpenProfile={() => setProfileOpen(true)}
                  onOpenBossPanel={() => setBossPanelOpen(true)}
                  onOpenLive={() => setTab("live")}
                  onBossSummon={(targets, opts) =>
                    mgr.bossSummon(targets, opts?.private ? { ttlMinutes: 120 } : undefined)
                  }
                />
              </div>
            )}
          </div>

          {/* mobile dock — hidden inside a focused chat */}
          {(toolView !== null || !active) && (
            <DockNav tab={tab} onTab={handleTab} unread={unreadTotal} />
          )}

          {/* profile — owned once by the shell, opened from hub or rail */}
          <ProfileSheet
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
            callsign={mgr.callsign}
            onSwitch={mgr.switchCallsign}
          />

          {/* boss command panel — DRACH's admin room, shell-owned like the profile */}
          <BossPanel
            open={bossPanelOpen}
            onClose={() => setBossPanelOpen(false)}
            identityFp={mgr.identityFp}
            callsign={mgr.callsign}
          />
        </div>
      )}
    </div>
  );
}
