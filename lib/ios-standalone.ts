/** True only for an iOS or iPadOS Home Screen web app. Android does not set this. */
export function isIosHomeScreenApp(nav: object): boolean {
  return "standalone" in nav && (nav as { standalone?: boolean }).standalone === true;
}
