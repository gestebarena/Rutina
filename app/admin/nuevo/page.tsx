import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ItemForm from "../ItemForm";

export default async function NewItemPage({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  const { cat } = await searchParams;

  return (
    <main className="min-h-dvh bg-sky-50 p-6">
      <ItemForm defaultCategory={cat} />
    </main>
  );
}
