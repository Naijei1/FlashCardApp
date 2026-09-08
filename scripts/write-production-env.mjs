import { writeFileSync } from "node:fs";

const required = ["APP_PASSWORD", "SESSION_SECRET", "TABLE_NAME", "APP_REGION"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
}

const password = process.env.APP_PASSWORD;
const sessionSecret = process.env.SESSION_SECRET;
const tableName = process.env.TABLE_NAME;
const region = process.env.APP_REGION;
const timeZone = process.env.APP_TIME_ZONE || "America/New_York";
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
  APP_PASSWORD_HEX: Buffer.from(password, "utf8").toString("hex"),
  SESSION_SECRET_HEX: Buffer.from(sessionSecret, "utf8").toString("hex"),
  TABLE_NAME: tableName,
  APP_REGION: region,
  APP_TIME_ZONE: timeZone,
};
const contents =
  Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .join("\n") + "\n";

writeFileSync(".env.production", contents, { encoding: "utf8", mode: 0o600 });
console.log("Wrote validated production environment configuration");
