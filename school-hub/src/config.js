import "dotenv/config";

function required(name) {
  const v = process.env[name];
  if (!v) console.warn(`[config] Warning: ${name} is not set in .env`);
  return v;
}

export const config = {
  geminiApiKey: required("GEMINI_API_KEY"),
  autoAddThreshold: Number(process.env.AUTO_ADD_THRESHOLD || 80),
  householdChildren: (process.env.HOUSEHOLD_CHILDREN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  google: {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  },

  email: {
    address: required("GMAIL_ADDRESS"),
    appPassword: required("GMAIL_APP_PASSWORD"),
    notifyTo: required("NOTIFY_EMAIL"),
  },

  dashboard: {
    port: Number(process.env.DASHBOARD_PORT || 4173),
    publicUrl:
      process.env.DASHBOARD_PUBLIC_URL ||
      `http://localhost:${process.env.DASHBOARD_PORT || 4173}`,
  },

  classCharts: {
    students: (process.env.CLASSCHARTS_STUDENTS || "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [name, code, dob] = entry.split(",").map((s) => s.trim());
        return { name, code, dob };
      }),
  },
  classDojo: {
    email: process.env.CLASSDOJO_EMAIL,
    password: process.env.CLASSDOJO_PASSWORD,
  },
  mcas: {
    schoolId: process.env.MCAS_SCHOOL_ID,
    email: process.env.MCAS_EMAIL,
    password: process.env.MCAS_PASSWORD,
  },
};
