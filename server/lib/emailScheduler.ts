import cron from "node-cron";
import { db } from "../db";
import { emailCampaigns } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";
import { executeBulkEmailSend, getUsersForRole } from "./emailCampaignSender";

export function startEmailScheduler() {
  if (!process.env.RESEND_API_KEY) {
    console.log("[EmailScheduler] RESEND_API_KEY not set — scheduler inactive");
    return;
  }

  let running = false;

  cron.schedule("* * * * *", async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      const pending = await db
        .select()
        .from(emailCampaigns)
        .where(
          and(
            eq(emailCampaigns.status, "scheduled"),
            lt(emailCampaigns.scheduledAt as any, now)
          )
        );

      for (const campaign of pending) {
        console.log(`[EmailScheduler] Running scheduled campaign: ${campaign.id} — "${campaign.subject}"`);

        await db
          .update(emailCampaigns)
          .set({ status: "sending" })
          .where(eq(emailCampaigns.id, campaign.id));

        const appDomain =
          process.env.API_PUBLIC_URL ||
          process.env.APP_DOMAIN ||
          "";

        const users = await getUsersForRole(campaign.targetRole || "all");

        if (users.length === 0) {
          await db
            .update(emailCampaigns)
            .set({ status: "sent", sent: 0, failed: 0, sentAt: Date.now() })
            .where(eq(emailCampaigns.id, campaign.id));
          continue;
        }

        await db
          .update(emailCampaigns)
          .set({ total: users.length })
          .where(eq(emailCampaigns.id, campaign.id));

        executeBulkEmailSend(
          campaign.id,
          users,
          campaign.subject,
          campaign.message,
          appDomain
        ).catch((err) => {
          console.error(`[EmailScheduler] Campaign ${campaign.id} failed:`, err.message);
        });
      }
    } catch (err: any) {
      console.error("[EmailScheduler] Error:", err.message);
    } finally {
      running = false;
    }
  });

  console.log("[EmailScheduler] Started — checking for scheduled campaigns every minute");
}
