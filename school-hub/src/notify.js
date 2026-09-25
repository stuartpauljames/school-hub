import nodemailer from "nodemailer";
import { config } from "./config.js";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: config.email.address, pass: config.email.appPassword },
});

export async function sendApprovalEmail(item) {
  const dashboardUrl = config.dashboard.publicUrl;
  const approveUrl = `${dashboardUrl}/approve/${item.id}`;
  const declineUrl = `${dashboardUrl}/decline/${item.id}`;

  await transporter.sendMail({
    from: config.email.address,
    to: config.email.notifyTo,
    subject: `New event needs approval: ${item.summary}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          /* Two entirely separate versions of this email. The desktop
             version (full detail + buttons) is the default -- shown to
             any client, including ones that don't understand this media
             query at all, which is the safe direction to fail in. Only
             when the media query IS understood, and the screen is narrow,
             does it swap to the stripped-down mobile version instead. */
          .mobile-version { display: none; }
          @media (max-width: 600px) {
            .desktop-version { display: none !important; }
            .mobile-version { display: block !important; }
          }
        </style>
      </head>
      <body>
        <div class="desktop-version" style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1b2a4a;">
          <p style="margin:0 0 12px;font-size:18px;"><strong>${item.summary}</strong></p>
          <p style="margin:0 0 4px;color:#555;">Date: ${item.date || "unclear"}${item.category ? ` &middot; Category: ${item.category}` : ""}${
      item.class_name ? ` &middot; Class: ${item.class_name}` : ""
    }${item.child_name ? ` &middot; ${item.child_name}` : ""}</p>
          <p style="margin:0 0 16px;color:#555;">Source: ${item.source} (${item.poster || "unknown"}) &middot; Confidence: ${item.confidence}%</p>
          <blockquote style="color:#555;border-left:3px solid #ccc;padding-left:12px;margin:0 0 24px;">${item.original_text}</blockquote>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
            <tr><td>
              <a href="${approveUrl}" style="display:block;width:100%;box-sizing:border-box;background:#4f46e5;color:#ffffff;padding:16px 20px;text-decoration:none;border-radius:8px;font-size:17px;font-weight:600;text-align:center;">Add to calendar</a>
            </td></tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td>
              <a href="${declineUrl}" style="display:block;width:100%;box-sizing:border-box;background:#eeeeee;color:#333333;padding:16px 20px;text-decoration:none;border-radius:8px;font-size:17px;font-weight:600;text-align:center;">Ignore</a>
            </td></tr>
          </table>
        </div>

        <div class="mobile-version" style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1b2a4a;">
          <p style="margin:0 0 16px;font-size:18px;"><strong>${item.summary}</strong></p>
          <p style="margin:0;padding:14px 16px;background:#f5f4f0;border-radius:8px;">
            Open School Hub on your computer to approve or ignore this:<br>
            <a href="${dashboardUrl}" style="color:#4f46e5;">${dashboardUrl}</a>
          </p>
        </div>
      </body>
      </html>
    `,
  });
}
