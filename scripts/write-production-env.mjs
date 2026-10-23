import { writeFileSync } from "node:fs";

const googleAuth = process.env.AUTH_MODE === "google";
const required = googleAuth
  ? ["AUTH_SECRET", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "ADMIN_EMAILS", "AUTH_URL", "TABLE_NAME", "APP_REGION"]
  : ["APP_PASSWORD", "SESSION_SECRET", "TABLE_NAME", "APP_REGION"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
}
if (process.env.DATA_MODE && process.env.DATA_MODE !== "legacy" && process.env.DATA_MODE !== "multi-user") {
  throw new Error("DATA_MODE must be legacy or multi-user");
}

const password = process.env.APP_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const tableName = process.env.TABLE_NAME;
const region = process.env.APP_REGION;
const timeZone = process.env.APP_TIME_ZONE || "America/New_York";
if (!googleAuth) {
  if (password.toLowerCase().includes("replace-with")) {
    throw new Error("APP_PASSWORD must be a non-placeholder value");
  }
  if (password.length < 12) {
    // Preserve an existing installation's login during an application upgrade.
    // Password rotation is a separate, deliberate configuration change.
    console.warn("APP_PASSWORD is shorter than the recommended 12 characters");
  }
  if (sessionSecret.length < 32 || sessionSecret.toLowerCase().includes("replace-with")) {
    throw new Error("SESSION_SECRET must be a non-placeholder value of at least 32 characters");
  }
}
if (googleAuth) {
  const authSecret = process.env.AUTH_SECRET;
  const googleSecret = process.env.AUTH_GOOGLE_SECRET;
  if (authSecret.length < 32 || authSecret.toLowerCase().includes("replace-with")) {
    throw new Error("AUTH_SECRET must be a non-placeholder value of at least 32 characters");
  }
  if (googleSecret.length < 8 || googleSecret.toLowerCase().includes("replace-with")) {
    throw new Error("AUTH_GOOGLE_SECRET must be a non-placeholder value");
  }
  if (!process.env.ADMIN_EMAILS.split(",").some((email) => email.trim())) {
    throw new Error("ADMIN_EMAILS must list at least one verified Google email");
  }
  let authUrl;
  try {
    authUrl = new URL(process.env.AUTH_URL);
  } catch {
    throw new Error("AUTH_URL must be an absolute https URL");
  }
  if (authUrl.protocol !== "https:") throw new Error("AUTH_URL must be an absolute https URL");
}

if (!/^[A-Za-z0-9_.-]{3,255}$/.test(tableName)) {
  throw new Error("TABLE_NAME is not a valid DynamoDB table name");
}
if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+-\d+$/.test(region)) {
  throw new Error("APP_REGION is not a valid AWS region name");
}
if (!/^[A-Za-z0-9_+./-]+$/.test(timeZone)) {
  throw new Error("APP_TIME_ZONE contains unsupported characters");
}
try {
  new Intl.DateTimeFormat("en-US", { timeZone }).format();
} catch {
  throw new Error("APP_TIME_ZONE must be a valid IANA time zone");
}

// dotenv deliberately has only limited escaping support. Hex keeps arbitrary
// Unicode passwords and secrets byte-for-byte safe from comments, expansion,
// quotes, backslashes, and newlines; lib/auth.ts decodes these at runtime.
const values = {
  ...(password ? { APP_PASSWORD_HEX: Buffer.from(password, "utf8").toString("hex") } : {}),
  ...(sessionSecret ? { SESSION_SECRET_HEX: Buffer.from(sessionSecret, "utf8").toString("hex") } : {}),
  TABLE_NAME: tableName,
  APP_REGION: region,
  APP_TIME_ZONE: timeZone,
};
if (googleAuth) {
  values.AUTH_MODE = "google";
  values.AUTH_SECRET_HEX = Buffer.from(process.env.AUTH_SECRET, "utf8").toString("hex");
  values.AUTH_GOOGLE_ID = process.env.AUTH_GOOGLE_ID;
  values.AUTH_GOOGLE_SECRET_HEX = Buffer.from(process.env.AUTH_GOOGLE_SECRET, "utf8").toString("hex");
  values.ADMIN_EMAILS = process.env.ADMIN_EMAILS;
  values.AUTH_URL = process.env.AUTH_URL;
  values.AUTH_TRUST_HOST = "true";
}
if (process.env.DATA_MODE) values.DATA_MODE = process.env.DATA_MODE;
if (process.env.LEGACY_OWNER_EMAIL) values.LEGACY_OWNER_EMAIL = process.env.LEGACY_OWNER_EMAIL;
const contents =
  Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n") + "\n";

writeFileSync(".env.production", contents, { encoding: "utf8", mode: 0o600 });
console.log("Wrote validated production environment configuration");
