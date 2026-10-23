import { redirect } from "next/navigation";
import AdminUploadWizard from "@/components/AdminUploadWizard";
import { getAppSession } from "@/lib/app-session";

export default async function AdminUploadPage() {
  const session = await getAppSession();
  if (session?.role !== "admin") redirect("/");
  return (
    <div className="space-y-5 py-6">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Weekly upload</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Preview a CSV, save it as a draft, then set a week and a release date or publish immediately.
        </p>
      </header>
      <AdminUploadWizard />
    </div>
  );
}
