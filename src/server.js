import express from "express";
import { config } from "./config.js";
import { getPending, resolvePending, logAdded } from "./store.js";
import { upsertCalendarEvent } from "./calendarSync.js";

const app = express();

const CATEGORY_COLORS = {
  trip: "#3f51b5",
  deadline: "#d60000",
  payment: "#f5511d",
  meeting: "#8e24aa",
  non_uniform: "#f6c026",
  club: "#0b8043",
  other: "#616161",
};

const STYLE = `
  :root {
    --ink: #1b2a4a;
    --parchment: #faf7f0;
    --card: #ffffff;
    --slate: #6b7280;
    --rule: #e5e0d5;
  }
  * { box-sizing: border-box; }
  body {
    font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
    background: var(--parchment);
    color: var(--ink);
    margin: 0;
    padding: 48px 24px 80px;
  }
  .wrap { max-width: 640px; margin: 0 auto; }
  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 2px solid var(--ink);
    padding-bottom: 14px;
    margin-bottom: 8px;
  }
  .masthead h1 { font-size: 26px; font-weight: 600; margin: 0; letter-spacing: 0.2px; }
  .masthead .count {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 13px;
    color: var(--slate);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12px;
    color: var(--slate);
    margin: 16px 0 32px;
  }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .empty {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: var(--slate);
    padding: 40px 0;
    font-size: 15px;
  }
  .item {
    background: var(--card);
    border-left: 4px solid var(--tab-color, var(--slate));
    padding: 18px 22px;
    margin-bottom: 14px;
  }
  .item .summary { font-size: 18px; line-height: 1.4; margin: 0 0 10px; }
  .meta {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 12.5px;
    color: var(--slate);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0;
    margin-bottom: 12px;
  }
  .meta > span { padding: 0 12px; border-left: 1px solid var(--rule); }
  .meta > span:first-child { padding-left: 0; border-left: none; }
  .confidence { display: flex; align-items: center; gap: 6px; }
  .confidence .bar { width: 40px; height: 5px; background: var(--rule); border-radius: 3px; overflow: hidden; }
  .confidence .fill { height: 100%; background: var(--tab-color, var(--slate)); }
  .original {
    font-size: 14px;
    color: #4a4a4a;
    border-top: 1px solid var(--rule);
    padding-top: 12px;
    margin: 12px 0 16px;
    white-space: pre-wrap;
  }
  .actions { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: flex; gap: 10px; flex-wrap: wrap; }
  .actions .btn { flex: 1; text-align: center; min-width: 120px; }
  .btn { display: inline-block; font-size: 14.5px; font-weight: 500; padding: 12px 20px; text-decoration: none; border-radius: 4px; min-height: 44px; box-sizing: border-box; }
  .btn-primary { background: var(--ink); color: white; }
  .btn-secondary { background: transparent; color: var(--ink); border: 1px solid var(--rule); }
`;

function layout(bodyHtml, title = "School Hub") {
  return `
    <html>
    <head>
      <title>${title}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2032%2032%22%3E%0A%20%20%3Crect%20width%3D%2232%22%20height%3D%2232%22%20rx%3D%227%22%20fill%3D%22%231b2a4a%22%2F%3E%0A%20%20%3Crect%20x%3D%2210%22%20y%3D%225%22%20width%3D%222%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%23faf7f0%22%2F%3E%0A%20%20%3Crect%20x%3D%2220%22%20y%3D%225%22%20width%3D%222%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%23faf7f0%22%2F%3E%0A%20%20%3Crect%20x%3D%227%22%20y%3D%229%22%20width%3D%2218%22%20height%3D%2216%22%20rx%3D%222%22%20fill%3D%22%23faf7f0%22%2F%3E%0A%20%20%3Crect%20x%3D%227%22%20y%3D%229%22%20width%3D%2218%22%20height%3D%225%22%20rx%3D%222%22%20fill%3D%22%23ffffff%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%2211.5%22%20cy%3D%2218.5%22%20r%3D%221.7%22%20fill%3D%22%233f51b5%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%2216%22%20cy%3D%2218.5%22%20r%3D%221.7%22%20fill%3D%22%23d60000%22%2F%3E%0A%20%20%3Ccircle%20cx%3D%2220.5%22%20cy%3D%2218.5%22%20r%3D%221.7%22%20fill%3D%22%230b8043%22%2F%3E%0A%20%20%3Crect%20x%3D%2210%22%20y%3D%2221.8%22%20width%3D%2212%22%20height%3D%221.6%22%20rx%3D%220.8%22%20fill%3D%22%23d8d2c4%22%2F%3E%0A%3C%2Fsvg%3E" />
      <style>${STYLE}</style>
    </head>
    <body><div class="wrap">${bodyHtml}</div></body>
    </html>
  `;
}

function categoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.other;
}

function iconApproved(color) {
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.5 2.5L16 9"/></svg>`;
}
function iconDeclined(color) {
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>`;
}
function iconNotFound(color) {
  return `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><circle cx="10" cy="10" r="6"/><path d="M15 15l5 5"/></svg>`;
}

function renderMessagePage({ icon, title, message, color }) {
  return layout(`
    <div style="min-height: 60vh; display: flex; align-items: center; justify-content: center;">
      <div style="text-align: center; max-width: 320px;">
        <div style="margin-bottom: 18px;">${icon}</div>
        <h1 style="font-size: 20px; margin: 0 0 8px; color: ${color};">${title}</h1>
        <p style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: var(--slate); font-size: 14px; line-height: 1.5; margin: 0;">${message}</p>
        <p style="margin-top: 24px;">
          <a href="/" style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: var(--ink); font-size: 13px;">Back to pending approvals</a>
        </p>
      </div>
    </div>
  `);
}

app.get("/", (req, res) => {
  const pending = getPending();
  const categoriesInUse = [...new Set(pending.map((p) => p.category).filter(Boolean))];

  const itemsHtml = pending.length
    ? pending
        .map((item) => {
          const color = categoryColor(item.category);
          return `
        <div class="item" style="--tab-color: ${color};">
          <p class="summary">${item.summary}</p>
          <div class="meta">
            <span>${item.date || "date unclear"}</span>
            <span>${item.source}</span>
            ${item.category ? `<span>${item.category.replace("_", " ")}</span>` : ""}
            ${item.class_name ? `<span>${item.class_name}</span>` : ""}
            <span class="confidence">
              <span class="bar"><span class="fill" style="width: ${item.confidence}%;"></span></span>
              ${item.confidence}%
            </span>
          </div>
          <div class="original">${item.original_text}</div>
          <div class="actions">
            <a class="btn btn-primary" href="/approve/${item.id}">Add to calendar</a>
            <a class="btn btn-secondary" href="/decline/${item.id}">Ignore</a>
          </div>
        </div>`;
        })
        .join("")
    : `<p class="empty">Nothing waiting on you right now.</p>`;

  const legendHtml = categoriesInUse.length
    ? `<div class="legend">${categoriesInUse
        .map((c) => `<span><i style="background: ${categoryColor(c)};"></i>${c.replace("_", " ")}</span>`)
        .join("")}</div>`
    : "";

  const installedBanner =
    req.query.installed === "1"
      ? `<div style="background:#f0fdf4;border:1px solid #bbf7d0;color:#15803d;border-radius:8px;padding:14px 18px;margin-bottom:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;">
          ✅ School Hub is installed and running in the background. This is your dashboard -- bookmark it if you'd like.
        </div>`
      : "";

  res.send(
    layout(`
      <div class="masthead">
        <h1>School Hub</h1>
        <span class="count">${pending.length} ${pending.length === 1 ? "item" : "items"} waiting on you</span>
      </div>
      ${installedBanner}
      ${legendHtml}
      ${itemsHtml}
    `)
  );
});

app.get("/approve/:id", async (req, res) => {
  const item = resolvePending(req.params.id, "approved");
  if (!item) {
    return res.status(404).send(
      renderMessagePage({
        icon: iconNotFound("#b45309"),
        title: "Not found",
        message: "This item wasn't found, or has already been resolved.",
        color: "#b45309",
      })
    );
  }
  const sync = await upsertCalendarEvent(item);
  logAdded({ ...item, syncAction: sync.action });
  res.send(
    renderMessagePage({
      icon: iconApproved("#15803d"),
      title: "Added to calendar",
      message: `"${item.summary}" is now on your calendar.`,
      color: "#15803d",
    })
  );
});

app.get("/decline/:id", (req, res) => {
  const item = resolvePending(req.params.id, "declined");
  if (!item) {
    return res.status(404).send(
      renderMessagePage({
        icon: iconNotFound("#b45309"),
        title: "Not found",
        message: "This item wasn't found, or has already been resolved.",
        color: "#b45309",
      })
    );
  }
  res.send(
    renderMessagePage({
      icon: iconDeclined("#475569"),
      title: "Ignored",
      message: `"${item.summary}" won't be added to your calendar.`,
      color: "#475569",
    })
  );
});

app.listen(config.dashboard.port, () => {
  console.log(`[server] Dashboard running at http://localhost:${config.dashboard.port}`);
  if (!config.dashboard.publicUrl.includes("localhost")) {
    console.log(`[server] Publicly reachable at ${config.dashboard.publicUrl}`);
  }
});
