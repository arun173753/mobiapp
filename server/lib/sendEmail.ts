export interface EmailResult {
  success: boolean;
  error?: string;
  details?: string;
}

export async function sendOTPEmail(userEmail: string, otp: string): Promise<EmailResult> {
  try {
    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = "onboarding@resend.dev";
    
    console.log("[Email] Using Resend to send OTP");
    console.log("[Email] To:", userEmail);
    console.log("[Email] From:", fromEmail);
    
    if (!resendApiKey) {
      console.error("[Email] RESEND_API_KEY not configured");
      return { success: false, error: "Email service not configured" };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: userEmail,
        subject: "Your OTP Code",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px;">
            <h2>Verification Code</h2>
            <p>Your verification code is:</p>
            <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center;">
              <h1 style="letter-spacing: 8px; color: #FF6B35; font-family: monospace;">${otp}</h1>
            </div>
            <p>This code is valid for <strong>5 minutes</strong>. Do not share this code.</p>
          </div>
        `,
      }),
    });

    console.log("[Email] Resend response status:", response.status);
    const responseText = await response.text();
    console.log("[Email] Raw response:", responseText);

    if (!response.ok) {
      try {
        const error = JSON.parse(responseText);
        console.error("[Email] Resend error parsed:", JSON.stringify(error, null, 2));
        return { success: false, error: error.message || responseText };
      } catch (e) {
        console.error("[Email] Could not parse error response:", responseText);
        return { success: false, error: responseText };
      }
    }

    const data = JSON.parse(responseText);
    console.log("[Email] ✓ Email sent successfully, ID:", data.id);
    return { success: true };

  } catch (err: any) {
    console.error("[Email] Unexpected error:", err.message);
    return { success: false, error: err.message };
  }
}

export async function sendWelcomeEmail(userEmail: string, userName: string): Promise<EmailResult> {
  if (!process.env.RESEND_API_KEY) {
    console.error("[Email] RESEND_API_KEY not set, cannot send welcome email to:", userEmail);
    return { success: false, error: "Email service not configured", details: "RESEND_API_KEY missing" };
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    console.log("[Email] Sending welcome email to:", userEmail);
    const { data, error } = await resend.emails.send({
      from: `Mobi App <${fromEmail}>`,
      to: userEmail,
      subject: "Welcome to Mobi App 🎉",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
          <h2 style="color: #FF6B35;">Hello ${userName}</h2>
          <p>You have successfully signed in to <strong>Mobi App</strong> using your Google account.</p>
          <p>We're excited to have you on board! 🚀</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 12px; color: #888;">If you didn't sign in to Mobi App, please ignore this email.</p>
        </div>
      `,
    });

    if (error) {
      console.error("[Email] Welcome email error:", JSON.stringify(error));
      return { success: false, error: error.message || "Failed to send welcome email", details: JSON.stringify(error) };
    }

    if (!data?.id) {
      console.error("[Email] Welcome email: no ID returned");
      return { success: false, error: "No email ID returned", details: JSON.stringify(data) };
    }

    console.log("[Email] ✓ Welcome email sent to:", userEmail, "ID:", data.id);
    return { success: true };
  } catch (err: any) {
    console.error("[Email] Unexpected error sending welcome email:", err);
    return { success: false, error: err.message || "Unexpected error", details: err.toString() };
  }
}
