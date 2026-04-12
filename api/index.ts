import { createApp } from "../server/app";
import type { VercelRequest, VercelResponse } from "@vercel/node";

let appReady: Promise<any> | null = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!appReady) {
    appReady = createApp();
  }
  const app = await appReady;
  app(req, res);
}

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
};
