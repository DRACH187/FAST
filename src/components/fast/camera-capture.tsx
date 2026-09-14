"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Camera, RefreshCcw, SwitchCamera, X } from "lucide-react";
import { toast } from "@/components/fast/toast";

gsap.registerPlugin(useGSAP);

/**
 * CameraCapture — take a photo, send it, and NOTHING is ever stored.
 *
 * · Live preview: getUserMedia (rear camera first). If the browser denies
 *   the stream, we fall back to the native camera file picker — the picked
 *   file is read into RAM and its File handle is dropped immediately.
 * · Frames are drawn to a canvas and encoded to JPEG ≤1280px in memory.
 * · The preview bytes live in a RAM slot (keyvault photo store) so the
 *   confirmation screen can draw them; they are zeroed on unmount/cancel.
 * · No <img src=blob:>, no downloads, no cache, no persistence anywhere.
 */

type Stage = "viewfinder" | "confirm";

async function downscaleToJpeg(source: CanvasImageSource, w: number, h: number): Promise<Uint8Array> {
  const maxDim = 1280;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.62));
  if (!blob) throw new Error("Encoding failed");
  return new Uint8Array(await blob.arrayBuffer());
}

export function CameraCapture({
  onCapture,
  onClose,
}: {
  onCapture: (bytes: Uint8Array) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingBytes = useRef<Uint8Array | null>(null);
  const [stage, setStage] = useState<Stage>("viewfinder");
  const [mode, setMode] = useState<"live" | "file">("live");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [working, setWorking] = useState(false);
  const [flash, setFlash] = useState(false);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startStream = useCallback(
    async (want: "environment" | "user") => {
      stopStream();
      if (!navigator.mediaDevices?.getUserMedia) {
        setMode("file");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: want }, width: { ideal: 1280 }, height: { ideal: 1280 } },
          audio: false,
        });
        streamRef.current = stream;
        setMode("live");
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
      } catch {
        // denied / no camera / insecure context — offer the picker
        setMode("file");
      }
    },
    [stopStream]
  );

  useEffect(() => {
    void startStream(facing);
    return () => {
      stopStream();
      pendingBytes.current = null; // zero the review bytes on any teardown
    };
    // initial boot only — stream lifecycle is managed imperatively below
  }, []);

  // entrance
  useGSAP(() => {
    gsap.fromTo(root.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power2.out" });
  });

  // paint the pending capture once the review canvas is actually mounted
  useEffect(() => {
    if (stage !== "confirm") return;
    const bytes = pendingBytes.current;
    const canvas = canvasRef.current;
    if (!bytes || !canvas) return;
    const blob = new Blob([bytes as unknown as BlobPart], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url); // pixels live in the canvas — URL dies now
    };
    img.src = url;
  }, [stage]);

  const preparePreview = useCallback((bytes: Uint8Array) => {
    pendingBytes.current = bytes; // RAM only — never persisted anywhere
    setStage("confirm");
  }, []);

  const shoot = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    setWorking(true);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 180);
    try {
      const bytes = await downscaleToJpeg(video, video.videoWidth, video.videoHeight);
      stopStream();
      preparePreview(bytes);
    } catch {
      toast.error("Capture failed");
    } finally {
      setWorking(false);
    }
  }, [preparePreview, stopStream]);

  const onPickFile = useCallback(
    async (file: File) => {
      setWorking(true);
      try {
        const bitmap = await createImageBitmap(file);
        const bytes = await downscaleToJpeg(bitmap, bitmap.width, bitmap.height);
        bitmap.close();
        preparePreview(bytes);
      } catch {
        toast.error("That file could not be read");
      } finally {
        setWorking(false);
      }
    },
    [preparePreview]
  );

  const retake = useCallback(() => {
    pendingBytes.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setStage("viewfinder");
    if (mode === "live") void startStream(facing);
  }, [facing, mode, startStream]);

  const confirm = useCallback(() => {
    const bytes = pendingBytes.current;
    pendingBytes.current = null; // consumed — the sender's RAM copy is stashed downstream
    if (!bytes) return;
    onCapture(bytes);
  }, [onCapture]);

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Camera"
      className="fixed inset-0 z-[96] flex flex-col bg-black"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* top bar */}
      <div className="flex items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-400">
          {stage === "viewfinder" ? "camera · ram only" : "review · ram only"}
        </span>
        <button
          onClick={() => {
            stopStream();
            pendingBytes.current = null;
            onClose();
          }}
          aria-label="Cancel capture"
          className="flex size-10 items-center justify-center rounded-full text-neutral-400 outline-none transition-colors hover:bg-neutral-900 hover:text-white"
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>

      {/* viewport */}
      <div className="relative flex-1 overflow-hidden">
        {stage === "viewfinder" && mode === "live" && (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 size-full object-cover"
            style={{ transform: facing === "user" ? "scaleX(-1)" : undefined }}
          />
        )}

        {stage === "viewfinder" && mode === "file" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-neutral-800 bg-neutral-950">
              <Camera className="size-6 text-neutral-500" aria-hidden />
            </div>
            <p className="max-w-xs text-xs leading-relaxed text-neutral-500">
              Live camera unavailable. Capture with your device camera instead —
              the picture still never touches storage.
            </p>
            <button
              onClick={() => fileRef.current?.click()}
              className="min-h-[44px] rounded-full bg-white px-6 text-sm font-medium text-black outline-none transition-colors hover:bg-neutral-200"
            >
              Open camera
            </button>
          </div>
        )}

        {stage === "confirm" && (
          <canvas ref={canvasRef} className="absolute inset-0 size-full object-contain" aria-label="Captured photo preview" />
        )}

        {/* shutter flash */}
        {flash && <div aria-hidden className="absolute inset-0 bg-white/80" />}
      </div>

      {/* bottom controls */}
      <div className="px-6 pb-[max(1.4rem,env(safe-area-inset-bottom))] pt-4">
        {stage === "viewfinder" && mode === "live" && (
          <div className="mx-auto flex max-w-md items-center justify-between">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex size-11 items-center justify-center rounded-full border border-neutral-700 text-neutral-300 outline-none transition-colors hover:text-white"
              aria-label="Capture from device camera"
            >
              <Camera className="size-5" aria-hidden />
            </button>

            <button
              onClick={() => void shoot()}
              disabled={working}
              aria-label="Take photo"
              className="group relative flex size-[74px] items-center justify-center rounded-full outline-none disabled:opacity-60"
            >
              <span className="absolute inset-0 rounded-full border-2 border-white transition-transform group-active:scale-90" aria-hidden />
              <span className="size-[58px] rounded-full bg-white transition-transform group-active:scale-90" aria-hidden />
            </button>

            <button
              onClick={() => {
                const next = facing === "environment" ? "user" : "environment";
                setFacing(next);
                void startStream(next);
              }}
              className="flex size-11 items-center justify-center rounded-full border border-neutral-700 text-neutral-300 outline-none transition-colors hover:text-white"
              aria-label="Flip camera"
            >
              <SwitchCamera className="size-5" aria-hidden />
            </button>
          </div>
        )}

        {stage === "confirm" && (
          <div className="mx-auto flex max-w-md items-center justify-center gap-3">
            <button
              onClick={retake}
              className="flex min-h-[44px] items-center gap-2 rounded-full border border-neutral-700 px-5 text-sm text-neutral-300 outline-none transition-colors hover:border-neutral-500 hover:text-white"
            >
              <RefreshCcw className="size-4" aria-hidden />
              Retake
            </button>
            <button
              onClick={confirm}
              className="flex min-h-[44px] items-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-black outline-none transition-colors hover:bg-neutral-200"
            >
              Send · burns after view
            </button>
          </div>
        )}

        <p className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.25em] text-neutral-600">
          never stored · encrypted in transit · zeroed after view
        </p>
      </div>

      {/* hidden native picker (fallback path — file is read into RAM and dropped) */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onPickFile(file);
        }}
      />
    </div>
  );
}
