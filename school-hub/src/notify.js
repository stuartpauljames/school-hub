import nodemailer from "nodemailer";
import { config } from "./config.js";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: config.email.address, pass: config.email.appPassword },
});

export async function sendApprovalEmail(item) {
  const base = config.dashboard.publicUrl;
  const approveUrl = `${base}/approve/${item.id}`;
  const declineUrl = `${base}/decline/${item.id}`;

  await transporter.sendMail({
    from: config.email.address,
    to: config.email.notifyTo,
    subject: `Review: ${item.summary} (${item.confidence}% confidence)`,
    html: `
      <p><strong>${item.summary}</strong></p>
      <p>Date: ${item.date || "unclear"}${item.category ? ` &middot; Category: ${item.category}` : ""}${
      item.class_name ? ` &middot; Class: ${item.class_name}` : ""
    }${item.child_name ? ` &middot; ${item.child_name}` : ""}</p>
      <p>Source: ${item.source} (${item.poster || "unknown"}) &middot; Confidence: ${item.confidence}%</p>
      <blockquote style="color:#555;border-left:3px solid #ccc;padding-left:10px;">${item.original_text}</blockquote>
      <p>
        <a href="${approveUrl}" style="background:#4f46e5;color:white;padding:8px 16px;text-decoration:none;border-radius:6px;">Add to calendar</a>
        &nbsp;
        <a href="${declineUrl}" style="background:#eee;color:#333;padding:8px 16px;text-decoration:none;border-radius:6px;">Ignore</a>
      </p>
    `,
  });
}
