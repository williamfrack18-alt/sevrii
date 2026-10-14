// Transactional email through Resend (resend.com). Turned on by setting
// RESEND_API_KEY in Vercel. The sender address must belong to a domain
// verified in Resend (sevrii.com).

export function emailReady(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

const FROM = process.env.EMAIL_FROM || "Sevrii <hola@sevrii.com>";

export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text }),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[email] send failed", res.status, (await res.text()).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send error", (err as Error)?.message);
    return false;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// A simple, clean email with one button. Works in every email app.
export function simpleEmail(opts: { title: string; intro: string; button: string; url: string; outro: string }): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:20px;padding:32px 28px">
<tr><td style="font-size:20px;font-weight:700;padding-bottom:20px">Sevrii</td></tr>
<tr><td style="font-size:22px;font-weight:600;line-height:1.3;padding-bottom:12px">${esc(opts.title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#4b4f47;padding-bottom:24px">${esc(opts.intro)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${esc(opts.url)}" style="display:inline-block;background:#22704b;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:14px 26px;border-radius:999px">${esc(opts.button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#7a7d74">${esc(opts.outro)}</td></tr>
</table>
<p style="font-size:12px;color:#9a9d94;margin-top:16px">Sevrii · Moengli LLC</p>
</td></tr></table></body></html>`;
  const text = `${opts.title}\n\n${opts.intro}\n\n${opts.button}: ${opts.url}\n\n${opts.outro}\n\nSevrii · Moengli LLC`;
  return { html, text };
}
