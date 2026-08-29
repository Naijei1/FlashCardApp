import ImportWizard from "@/components/ImportWizard";
import { listDecks } from "@/lib/db";

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  const [{ deck }, decks] = await Promise.all([searchParams, listDecks()]);
  return (
    <div className="space-y-5 py-6">
      <h1 className="text-2xl font-bold">Import CSV</h1>
      <ImportWizard decks={decks} initialDeckId={deck} />
    </div>
  );
}
