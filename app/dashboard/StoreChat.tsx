"use client";

import { BRAND_BTN } from "@/lib/panel";

import { useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { sendStoreChatAction, setStoreVideoAction, uploadStoreImageAction } from "@/app/storeActions";
import ChatPanel, { type ChatChip, type Msg } from "./ChatPanel";
import { prepareImage } from "@/lib/clientImage";
import { upload } from "@vercel/blob/client";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";

export default function StoreChat({
  business,
  onBusiness,
  greeting,
  initialMessages,
  onUpdated,
  onMessages,
  sync,
  head,
  dock,
  dockLabel,
  chips,
  area = "store",
  pickKey,
  onPlans,
  onGo,
}: {
  // The next sections, as buttons under a reply ([[go:marketing]]…).
  onGo?: (to: "marketing" | "payments" | "chats") => void;
  onPlans?: () => void;
  pickKey?: number;
  area?: "store" | "agent"; // Store (the sales page) or Agente (the agent itself)
  head?: React.ReactNode;
  dock?: React.ReactNode;
  dockLabel?: string;
  chips?: ChatChip[];
  business: ClientBusiness;
  onBusiness: (b: ClientBusiness) => void;
  sync?: { key: number; messages: Msg[] };
  greeting: string;
  initialMessages: Msg[];
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: Msg[]) => void;
}) {
  const lang = useLang();
  const t = STORE_TEXT[lang].editor;
  return (
    <ChatPanel
      greeting={greeting}
      initialMessages={initialMessages}
      sync={sync}
      head={head}
      dock={dock}
      dockLabel={dockLabel}
      chips={chips}
      pickKey={pickKey}
      texts={{
        placeholder: t.chatPlaceholder,
        emptyTitle: t.emptyTitle,
        emptySub: t.emptySub,
        disclaimer: t.disclaimer,
        seeBelow: "",
        seeBelowHref: "",
        thinking: t.thinking,
        attach: t.attach,
        failed: t.saveFailed,
        uploadingPhoto: t.photos.uploading,
        uploadingVideo: t.video.uploading,
        uploadFailed: t.photos.failed,
      }}
      onSend={async (text) => {
        const res = await sendStoreChatAction(text, area);
        onMessages?.(res.messages);
        onUpdated(
          toClientBusiness(res.business),
          res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }))
        );
        return { messages: res.messages, limit: res.limit, notice: res.notice };
      }}
      onPlans={onPlans}
      renderToken={(tk) => (tk.kind === "go" && onGo ? <GoButtons to={tk.arg} lang={lang} onGo={onGo} /> : null)}
      onUpload={async (picked, onProgress) => {
        // A video goes straight to storage (it can be big), then onto the page.
        if (picked.type.startsWith("video/") || /\.(mov|mp4|webm)$/i.test(picked.name)) {
          if (picked.size > 200 * 1024 * 1024) return { error: t.video.tooBig };
          try {
            const ext = /\.mov$/i.test(picked.name) || picked.type === "video/quicktime" ? "mov" : picked.type === "video/webm" ? "webm" : "mp4";
            const blob = await upload(`stores/${business.id}/video-${Date.now()}.${ext}`, picked, {
              access: "public",
              handleUploadUrl: "/api/upload",
              multipart: picked.size > 30 * 1024 * 1024,
              onUploadProgress: ({ percentage }) => onProgress(percentage),
            });
            const res = await setStoreVideoAction(blob.url);
            if (!res.ok) throw new Error("save");
            onBusiness(toClientBusiness(res.business));
            return { send: `🎥 ${blob.url}` };
          } catch {
            return { error: t.video.failed };
          }
        }
        try {
          const file = await prepareImage(picked);
          if (file.size > 4 * 1024 * 1024) return { error: t.photos.tooBig };
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { error: t.photos.badType };
          const fd = new FormData();
          fd.set("kind", "gallery");
          fd.set("file", file);
          const res = await uploadStoreImageAction(fd);
          if (!res.ok) return { error: t.photos[res.error === "rate" ? "failed" : res.error] };
          const url = res.business.site.gallery[res.business.site.gallery.length - 1];
          return url ? { send: `📷 ${url}` } : { error: t.photos.failed };
        } catch {
          return { error: t.photos.failed };
        }
      }}
    />
  );
}

// "What's next" as real buttons, never "búscalo en el menú".
function GoButtons({ to, lang, onGo }: { to: string; lang: "es" | "en"; onGo: (to: "marketing" | "payments" | "chats") => void }) {
  const es = lang === "es";
  const label = { marketing: es ? "Ir a Marketing" : "Go to Marketing", payments: es ? "Ir a Payments" : "Go to Payments", chats: es ? "Ir a Conversaciones" : "Go to Conversations" } as const;
  const list: ("marketing" | "payments" | "chats")[] = to === "next" ? ["marketing", "payments"] : to === "marketing" || to === "payments" || to === "chats" ? [to] : [];
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-2.5">
      {list.map((x, i) => (
        <button
          key={x}
          type="button"
          onClick={() => onGo(x)}
          className="h-10 px-5 rounded-full text-[14px] font-semibold"
          style={i === 0 ? BRAND_BTN : { background: "rgba(10,10,10,0.068)", color: "#27272A" }}
        >
          {label[x]} →
        </button>
      ))}
    </div>
  );
}
