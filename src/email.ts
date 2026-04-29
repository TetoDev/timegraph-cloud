import { createTransport } from "nodemailer";
import { getSmtpConfig } from "./config/secrets";

export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const config = await getSmtpConfig();

  console.log(`[email] Connecting to ${config.host}:${config.port} (secure: true) as ${config.user}`);

  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: true,
    auth: { user: config.user, pass: config.pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });

  await transport.sendMail({
    from: config.from,
    to,
    subject: "PLPP - Your Verification Code",
    html: `<html><body style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
      <h2 style="color:#2563eb;">PLPP Verification Code</h2>
      <p style="font-size:16px;color:#334155;">Enter the following code to verify your email address:</p>
      <div style="background:#f1f5f9;border-radius:8px;padding:16px;text-align:center;margin:24px 0;">
        <span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e293b;">${code}</span>
      </div>
      <p style="font-size:14px;color:#64748b;">This code expires in 10 minutes.</p>
      <p style="font-size:12px;color:#94a3b8;">If you did not request this code, please ignore this email.</p>
    </body></html>`,
  });

  console.log(`[email] Verification code sent to ${to}`);
}
