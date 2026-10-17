"use client";

import { useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { sendStoreChatAction, setStoreVideoAction, uploadStoreImageAction } from "@/app/storeActions";
import ChatPanel, { type Msg } from "./ChatPanel";
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
}: {
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
      texts={{
        placeholder: t.chatPlaceholder,
        emptyTitle: t.emptyTitle,
        emptySub: t.emptySub,
        disclaimer: t.disclaimer,
        seeBelow: t.seePageBelow,
        seeBelowHref: "#store-page",
        thinking: t.thinking,
        attach: t.attach,
        failed: t.saveFailed,
        uploadingPhoto: t.photos.uploading,
        uploadingVideo: t.video.uploading,
        uploadFailed: t.photos.failed,
      }}
      onSend={async (text) => {
        const res = await sendStoreChatAction(text);
        onMessages?.(res.messages);
        onUpdated(
          toClientBusiness(res.business),
          res.services.map((s) => ({ id: s.id, name: s.name, price: s.price, description: s.description }))
        );
        return res.messages;
      }}
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
