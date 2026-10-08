import { createHash, randomBytes } from "node:crypto";

function required(name: "COGNITO_DOMAIN" | "COGNITO_CLIENT_ID" | "COGNITO_REDIRECT_URI"): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required when AUTH_MODE=cognito`);
  return value;
}

function hostedUiOrigin(): string {
  const domain = required("COGNITO_DOMAIN").replace(/\/$/, "");
  return domain.startsWith("http://") || domain.startsWith("https://") ? domain : `https://${domain}`;
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState(): string {
  return randomBytes(16).toString("base64url");
}

/** Authorization-code + PKCE URL for the Cognito hosted login page. */
export function cognitoAuthorizeUrl(state: string, challenge: string): string {
  const url = new URL("/oauth2/authorize", hostedUiOrigin());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", required("COGNITO_CLIENT_ID"));
  url.searchParams.set("redirect_uri", required("COGNITO_REDIRECT_URI"));
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCognitoCode(code: string, verifier: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: required("COGNITO_CLIENT_ID"),
    code,
    redirect_uri: required("COGNITO_REDIRECT_URI"),
    code_verifier: verifier,
  });
  const response = await fetch(new URL("/oauth2/token", hostedUiOrigin()), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error("Cognito token exchange failed");
  const payload: unknown = await response.json().catch(() => null);
  const idToken =
    payload && typeof payload === "object" && "id_token" in payload ? payload.id_token : undefined;
  if (typeof idToken !== "string" || !idToken) {
    throw new Error("Cognito response did not include an ID token");
  }
  return idToken;
}
