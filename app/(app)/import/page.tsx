import { redirect } from "next/navigation";
import ImportWizard from "@/components/ImportWizard";
import { getAppSession } from "@/lib/app-session";
import { listDecks } from "@/lib/db";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  if ((await getAppSession())?.role === "admin") redirect("/admin/upload");
  const [{ deck }, decks] = await Promise.all([searchParams, listDecks()]);
  const privateDecks = decks.filter((item) => item.source !== "global");
  const sharedDecks = decks.filter((item) => item.source === "global");
  return (
    <div className="space-y-5 py-6">
      <h1 className="text-3xl font-bold tracking-tight">Import CSV</h1>
      <ImportWizard decks={privateDecks} sharedDecks={sharedDecks} initialDeckId={deck} />
    </div>
  );
}
