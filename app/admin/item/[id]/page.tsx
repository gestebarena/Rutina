import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import ItemForm from "../../ItemForm";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  const { id } = await params;
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item) notFound();

  return (
    <main className="min-h-dvh bg-sky-50 p-6">
      <ItemForm item={item} />
    </main>
  );
}
