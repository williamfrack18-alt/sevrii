"use client";

import { useLang } from "@/components/LangProvider";
import { STORE_TEXT } from "@/lib/storeI18n";
import { sendStoreChatAction, uploadStoreImageAction } from "@/app/storeActions";
import ChatPanel, { type Msg } from "./ChatPanel";
import { toClientBusiness, type ClientBusiness, type ClientService } from "./types";

export default function StoreChat({
  greeting,
  initialMessages,
  onUpdated,
  onMessages,
}: {
  greeting: string;
  initialMessages: Msg[];
  onUpdated: (business: ClientBusiness, services: ClientService[]) => void;
  onMessages?: (m: Msg[]) => void;
}) {
  const t = STORE_TEXT[useLang()].editor;
  return (
    <ChatPanel
      greeting={greeting}
      initialMessages={initialMessages}
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
      onUpload={async (file) => {
        if (file.size > 4 * 1024 * 1024) return { error: t.photos.tooBig };
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { error: t.photos.badType };
        const fd = new FormData();
        fd.set("kind", "gallery");
        fd.set("file", file);
        const res = await uploadStoreImageAction(fd);
        if (!res.ok) return { error: t.photos[res.error === "rate" ? "failed" : res.error] };
        const url = res.business.site.gallery[res.business.site.gallery.length - 1];
        return url ? { send: `📷 ${url}` } : { error: t.photos.failed };
      }}
    />
  );
}
