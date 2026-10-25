/** User-facing copy for Auth.js and our own sign-in errors. */
export function googleSignInError(error: string | undefined): string {
  if (error === "AccessDenied") return "Google must confirm your email before you can sign in.";
  if (error === "TooManyAttempts") return "Too many attempts. Wait a moment and try again.";
  if (error === "AccountDisabled") return "This account is disabled. Ask an admin to enable it.";
  if (error === "TryAgain" || error === "OAuthCallback" || error === "OAuthSignin" || error === "Configuration") {
    return "Could not sign in with Google. Try again.";
  }
  if (error) return "Could not sign in with Google. Try again.";
  return "";
}
