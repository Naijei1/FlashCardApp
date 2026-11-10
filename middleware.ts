import { NextResponse, type NextRequest } from "next/server";

// Link unfurlers do not sign in. `/` normally redirects to `/login`, and a
// redirect can drop the preview. Rewrite those crawlers to the public login
// page so the shared root returns 200 with the Open Graph head.
const LINK_PREVIEW_CRAWLER =
  /LinkedInBot|Twitterbot|facebookexternalhit|Slackbot|Discordbot|WhatsApp/i;

export function middleware(request: NextRequest) {
  if (!LINK_PREVIEW_CRAWLER.test(request.headers.get("user-agent") ?? "")) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/"],
};
