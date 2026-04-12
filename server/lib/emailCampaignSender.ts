import { db } from "../db";
import { profiles, emailCampaigns } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export function buildMarketingEmailHtml(
  userName: string,
  subject: string,
  message: string,
  userEmail: string,
  appDomain: string
): string {
  const unsubscribeUrl = `${appDomain}/unsubscribe?email=${encodeURIComponent(userEmail)}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:#FF6B35;padding:24px 32px;border-radius:12px 12px 0 0;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;letter-spacing:1px;">Mobi App</h1>
            <p style="color:#FFD0B5;margin:4px 0 0;font-size:13px;">Connecting Technicians, Teachers &amp; Suppliers</p>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e8e8e8;border-top:none;">
            <p style="color:#333;font-size:16px;margin:0 0 8px;">Hello ${userName || 'Mobi User'},</p>
            <h2 style="color:#FF6B35;font-size:22px;margin:0 0 20px;font-weight:700;">${subject}</h2>
            <div style="color:#555;font-size:15px;line-height:1.7;">${message.replace(/\n/g, '<br/>')}</div>
            <div style="margin:28px 0;text-align:center;">
              <a href="https://play.google.com/store" style="background:#FF6B35;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Open Mobi App</a>
            </div>
            <hr style="border:none;border-top:1px solid #eee;margin:24px 0;"/>
            <p style="font-size:12px;color:#aaa;margin:0;text-align:center;">
              You received this because you registered with Mobi App.<br/>
              <a href="${unsubscribeUrl}" style="color:#aaa;">Unsubscribe</a> from marketing emails.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function executeBulkEmailSend(
  campaignId: string,
  users: { email: string; name: string }[],
  subject: string,
  message: string,
  appDomain: string
): Promise<{ sent: number; failed: number }> {
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const BATCH_SIZE = 50;
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (user) => {
        try {
          const html = buildMarketingEmailHtml(user.name, subject, message, user.email, appDomain);
          await resend.emails.send({
            from: "Mobi App <onboarding@resend.dev>",
            to: user.email.trim(),
            subject: subject.trim(),
            html,
          });
          sent++;
        } catch (err: any) {
          console.error(`[Email] Failed to send to ${user.email}:`, err.message);
          failed++;
        }
      })
    );
    if (i + BATCH_SIZE < users.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  await db
    .update(emailCampaigns)
    .set({ sent, failed, status: "sent", sentAt: Date.now() })
    .where(eq(emailCampaigns.id, campaignId));

  console.log(`[Email] Campaign ${campaignId} complete: sent=${sent}, failed=${failed}`);
  return { sent, failed };
}

export async function getUsersForRole(role: string): Promise<{ email: string; name: string }[]> {
  let rows: { email: string | null; name: string }[];

  if (!role || role === "all") {
    rows = await db
      .select({ email: profiles.email, name: profiles.name })
      .from(profiles)
      .where(eq(profiles.allowMarketing, 1));
  } else if (role === "paid") {
    rows = await db
      .select({ email: profiles.email, name: profiles.name })
      .from(profiles)
      .where(and(eq(profiles.allowMarketing, 1), eq(profiles.subscriptionActive, 1)));
  } else {
    rows = await db
      .select({ email: profiles.email, name: profiles.name })
      .from(profiles)
      .where(and(eq(profiles.allowMarketing, 1), eq(profiles.role, role)));
  }

  return rows.filter((r) => r.email && r.email.trim().includes("@")) as { email: string; name: string }[];
}
