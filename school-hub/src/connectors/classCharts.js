// ClassCharts' parent web login has reCAPTCHA protection that this
// unofficial library's ParentClient can't get past (and its own docs admit
// the parent path was never actually tested). The StudentClient path -- the
// same login your child uses at school with their pupil code + DOB -- is
// the one that's actually tested and working, so we log in as each child
// separately instead of once as the parent.
import { StudentClient } from "classcharts-api";
import { config } from "../config.js";

async function fetchForStudent({ name, code, dob }) {
  const client = new StudentClient(code, dob);
  await client.login();

  const items = [];

  const announcements = await client.getAnnouncements?.();
  for (const a of announcements?.data || []) {
    items.push({
      source: "ClassCharts",
      poster: a.teacher_name || "School",
      classContext: null,
      childName: name,
      postDate: a.timestamp?.slice(0, 10) || null,
      text: `${a.title ? a.title + "\n" : ""}${a.description || ""}`.trim(),
    });
  }

  const homework = await client.getHomeworks?.();
  for (const h of homework?.data || []) {
    items.push({
      source: "ClassCharts",
      poster: h.teacher_name || "Teacher",
      classContext: null,
      childName: name,
      postDate: h.issue_date || null,
      text: `Homework: ${h.title || ""}\nDue: ${h.due_date || "not stated"}\n${h.description || ""}`.trim(),
    });
  }

  return items;
}

export async function fetchClassChartsItems() {
  if (config.classCharts.students.length === 0) {
    console.warn("[classCharts] Skipping: no students configured in .env");
    return [];
  }

  const results = await Promise.allSettled(config.classCharts.students.map(fetchForStudent));

  const items = [];
  for (const [i, r] of results.entries()) {
    if (r.status === "fulfilled") {
      items.push(...r.value);
    } else {
      const name = config.classCharts.students[i]?.name || "unknown child";
      console.error(`[classCharts] Failed for ${name}:`, r.reason?.message || r.reason);
    }
  }
  return items;
}
