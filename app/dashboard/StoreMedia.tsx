"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { useLang } from "@/components/LangProvider";
import { prepareImage } from "@/lib/clientImage";
import { LIMITS } from "@/lib/site";
import {
  removeStoreImageAction,
  removeStoreVideoAction,
  setStoreCoverAction,
  setStoreVideoAction,
  uploadStoreImageAction,
} from "@/app/storeActions";
import { toClientBusiness, type ClientBusiness } from "./types";
import { ACCENT, BRAND_BTN, TINT } from "@/lib/brand";

const MAX_VIDEO_MB = 200;
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

const TEXT = {
  es: {
    title: "Fotos y video de tu página",
    sub: "La primera foto es la principal. Las demás salen en cuadritos debajo. Cuantas más fotos reales tuyas y de tu trabajo, más confianza.",
    videoTitle: "Tu video (recomendado)",
    videoWhy:
      "Un video tuyo explicando tu servicio es lo que más confianza genera: el cliente te ve, te escucha y sabe con quién va a tratar. Sale primero en la galería.",
    videoHow: "Grábalo con tu celular: 30 a 60 segundos, mirando a la cámara, con buena luz y sin ruido.",
    script: "Ver el guion que te preparó el Cerebro",
    noScript: "Idea: di tu nombre, qué haces, en qué zona trabajas, qué incluye tu servicio y cómo te pueden escribir.",
    uploadVideo: "Subir video",
    changeVideo: "Cambiar video",
    removeVideo: "Quitar video",
    videoHint: `MP4 o MOV, hasta ${MAX_VIDEO_MB} MB.`,
    uploading: (p: number) => `Subiendo… ${p}%`,
    saving: "Guardando…",
    photos: "Fotos",
    addPhotos: "Agregar fotos",
    main: "Principal",
    makeMain: "Hacer principal",
    remove: "Quitar",
    ideas: "Fotos que te recomendamos",
    empty: "Aún no hay fotos. Sube una foto clara tuya (sonriendo, con ropa de trabajo) y fotos de tus trabajos.",
    errVideoType: "Usa un video MP4 o MOV.",
    errVideoBig: `El video pesa más de ${MAX_VIDEO_MB} MB. Grábalo más corto o en calidad 1080p.`,
    errVideo: "No se pudo subir el video. Inténtalo de nuevo.",
    errPhoto: "No se pudo subir una foto.",
    errFull: `La galería admite hasta ${LIMITS.gallery + 1} fotos.`,
    errBig: "Una foto pesa más de 4 MB.",
  },
  en: {
    title: "Photos and video on your page",
    sub: "The first photo is the main one. The rest show as small squares below it. More real photos of you and your work = more trust.",
    videoTitle: "Your video (recommended)",
    videoWhy:
      "A video of you explaining your service builds the most trust: clients see you, hear you and know who they'll deal with. It shows first in the gallery.",
    videoHow: "Record it with your phone: 30 to 60 seconds, looking at the camera, good light, no noise.",
    script: "See the script the Brain wrote for you",
    noScript: "Idea: say your name, what you do, the area you serve, what your service includes and how to reach you.",
    uploadVideo: "Upload video",
    changeVideo: "Change video",
    removeVideo: "Remove video",
    videoHint: `MP4 or MOV, up to ${MAX_VIDEO_MB} MB.`,
    uploading: (p: number) => `Uploading… ${p}%`,
    saving: "Saving…",
    photos: "Photos",
    addPhotos: "Add photos",
    main: "Main",
    makeMain: "Make main",
    remove: "Remove",
    ideas: "Photos we recommend",
    empty: "No photos yet. Upload a clear photo of you (smiling, work clothes) and photos of your work.",
    errVideoType: "Use an MP4 or MOV video.",
    errVideoBig: `The video is over ${MAX_VIDEO_MB} MB. Record a shorter one or in 1080p.`,
    errVideo: "The video couldn't be uploaded. Try again.",
    errPhoto: "A photo couldn't be uploaded.",
    errFull: `The gallery holds up to ${LIMITS.gallery + 1} photos.`,
    errBig: "A photo is over 4 MB.",
  },
};

export default function StoreMedia({ business, onUpdated }: { business: ClientBusiness; onUpdated: (b: ClientBusiness) => void }) {
  const lang = useLang();
  const t = TEXT[lang];
  const site = business.site;
  const photos = [site.coverUrl, ...site.gallery].filter(Boolean);
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showScript, setShowScript] = useState(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  async function onVideo(file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.type && !VIDEO_TYPES.includes(file.type)) return setError(t.errVideoType);
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) return setError(t.errVideoBig);
    setBusy("video");
    setPct(0);
    try {
      const ext = file.type === "video/quicktime" || /\.mov$/i.test(file.name) ? "mov" : file.type === "video/webm" ? "webm" : "mp4";
      const blob = await upload(`stores/${business.id}/video-${Date.now()}.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
        multipart: file.size > 30 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => setPct(Math.round(percentage)),
      });
      setPct(null);
      const res = await setStoreVideoAction(blob.url);
      if (!res.ok) throw new Error("save");
      onUpdated(toClientBusiness(res.business));
    } catch {
      setError(t.errVideo);
    } finally {
      setBusy(null);
      setPct(null);
      if (videoInput.current) videoInput.current.value = "";
    }
  }

  async function onPhotos(list: FileList | null) {
    if (!list?.length) return;
    setError("");
    setBusy("photos");
    let last: ClientBusiness | null = null;
    let count = photos.length;
    try {
      for (const picked of Array.from(list)) {
        if (count >= LIMITS.gallery + 1) {
          setError(t.errFull);
          break;
        }
        const file = await prepareImage(picked);
        if (file.size > 4 * 1024 * 1024) {
          setError(t.errBig);
          continue;
        }
        const fd = new FormData();
        // The first photo of an empty page becomes the main one.
        fd.set("kind", count === 0 && !site.coverUrl ? "cover" : "gallery");
        fd.set("file", file);
        const res = await uploadStoreImageAction(fd);
        if (res.ok) {
          last = toClientBusiness(res.business);
          count++;
        } else setError(res.error === "galleryFull" ? t.errFull : res.error === "tooBig" ? t.errBig : t.errPhoto);
      }
    } catch {
      setError(t.errPhoto);
    } finally {
      if (last) onUpdated(last);
      setBusy(null);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  async function act(key: string, fn: () => Promise<Parameters<typeof toClientBusiness>[0]>) {
    setBusy(key);
    setError("");
    try {
      onUpdated(toClientBusiness(await fn()));
    } catch {
      setError(t.errPhoto);
    } finally {
      setBusy(null);
    }
  }

  const card = { background: "#0f0f0f", boxShadow: "0 0 0 1px rgba(255,255,255,.08)" };
  const ghost = { background: "rgba(255,255,255,.08)", color: "#e5e5e5" };

  return (
    <div className="rounded-2xl p-4 md:p-5 mb-5" style={card}>
      <h3 className="text-[15px] font-semibold text-white">{t.title}</h3>
      <p className="text-[13px] text-[#9a9a9a] mt-1">{t.sub}</p>
      {error && <p className="text-[13px] text-red-400 mt-2">{error}</p>}

      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-4 mt-4">
        {/* Video */}
        <div className="rounded-xl p-4" style={{ background: "linear-gradient(135deg, rgba(46,122,85,.2), rgba(46,122,85,.06))", boxShadow: "0 0 0 1px rgba(46,122,85,.4)" }}>
          <div className="text-[14px] font-semibold text-white">🎥 {t.videoTitle}</div>
          {site.videoUrl ? (
            <video src={site.videoUrl} controls playsInline preload="metadata" className="w-full rounded-lg mt-3 bg-black" style={{ maxHeight: 260 }} />
          ) : (
            <>
              <p className="text-[13px] text-[#d0d0d0] mt-2 leading-relaxed">{t.videoWhy}</p>
              <p className="text-[12.5px] text-[#a1a1a1] mt-2 leading-relaxed">{t.videoHow}</p>
            </>
          )}
          {business.plan.videoScript ? (
            <div className="mt-3">
              <button type="button" onClick={() => setShowScript((v) => !v)} className="text-[12.5px] font-medium" style={{ color: ACCENT }}>
                {showScript ? "▾" : "▸"} {t.script}
              </button>
              {showScript && (
                <p className="text-[13px] text-[#e5e5e5] mt-2 whitespace-pre-line leading-relaxed rounded-lg p-3" style={{ background: "rgba(0,0,0,.35)" }}>
                  {business.plan.videoScript}
                </p>
              )}
            </div>
          ) : (
            !site.videoUrl && <p className="text-[12.5px] text-[#a1a1a1] mt-2">{t.noScript}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => videoInput.current?.click()}
              className="h-9 px-4 rounded-full text-[13px] font-semibold disabled:opacity-60"
              style={BRAND_BTN}
            >
              {busy === "video" ? (pct !== null && pct < 100 ? t.uploading(pct) : t.saving) : site.videoUrl ? t.changeVideo : t.uploadVideo}
            </button>
            {site.videoUrl && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => act("rmvideo", removeStoreVideoAction)}
                className="h-9 px-4 rounded-full text-[13px] disabled:opacity-60"
                style={ghost}
              >
                {t.removeVideo}
              </button>
            )}
            <span className="text-[11.5px] text-[#8e8e8e]">{t.videoHint}</span>
          </div>
          {busy === "video" && pct !== null && (
            <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: "rgba(255,255,255,.1)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: ACCENT }} />
            </div>
          )}
          <input ref={videoInput} type="file" accept="video/mp4,video/quicktime,video/webm,.mov,.mp4" className="hidden" onChange={(e) => onVideo(e.target.files?.[0])} />
        </div>

        {/* Photos */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[14px] font-semibold text-white">
              📷 {t.photos} <span className="text-[#8e8e8e] font-normal">({photos.length}/{LIMITS.gallery + 1})</span>
            </div>
            <button
              type="button"
              disabled={busy !== null || photos.length >= LIMITS.gallery + 1}
              onClick={() => photoInput.current?.click()}
              className="h-8 px-3.5 rounded-full text-[12.5px] font-semibold disabled:opacity-50"
              style={{ background: TINT, color: ACCENT }}
            >
              {busy === "photos" ? t.saving : `+ ${t.addPhotos}`}
            </button>
            <input ref={photoInput} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPhotos(e.target.files)} />
          </div>
          {photos.length === 0 ? (
            <button
              type="button"
              onClick={() => photoInput.current?.click()}
              className="w-full mt-3 rounded-xl p-5 text-[13px] text-[#a1a1a1] text-left"
              style={{ border: "1px dashed rgba(255,255,255,.18)" }}
            >
              {t.empty}
            </button>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 mt-3">
              {photos.map((src, n) => (
                <div key={src} className={`relative rounded-xl overflow-hidden ${n === 0 ? "col-span-2 row-span-2" : ""}`} style={{ aspectRatio: "1", boxShadow: n === 0 ? `0 0 0 2px ${ACCENT}` : "0 0 0 1px rgba(255,255,255,.1)" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" />
                  {n === 0 && (
                    <span className="absolute top-1.5 left-1.5 text-[10.5px] font-bold px-2 py-0.5 rounded-full" style={{ background: ACCENT, color: "#04120a" }}>
                      ★ {t.main}
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-1.5 flex flex-wrap gap-1" style={{ background: "linear-gradient(transparent, rgba(0,0,0,.75))" }}>
                    {n > 0 && (
                      <button type="button" disabled={busy !== null} onClick={() => act(`main${n}`, () => setStoreCoverAction(src))} className="text-[10.5px] px-2 py-0.5 rounded-full bg-white/90 text-black font-medium disabled:opacity-60">
                        {t.makeMain}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => act(`rm${n}`, () => removeStoreImageAction(n === 0 && src === site.coverUrl ? "cover" : "gallery", src))}
                      className="text-[10.5px] px-2 py-0.5 rounded-full bg-black/70 text-white disabled:opacity-60"
                    >
                      {t.remove}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {business.plan.photoIdeas.length > 0 && (
            <div className="mt-3 text-[12.5px] text-[#a1a1a1]">
              <span className="text-[#d4d4d4] font-medium">{t.ideas}:</span>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {business.plan.photoIdeas.slice(0, 4).map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
