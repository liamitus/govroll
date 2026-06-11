import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { RepHero } from "@/components/representatives/rep-hero";
import { RepDetailInteractive } from "@/components/representatives/rep-detail-interactive";

async function findRep(slug: string) {
  // Try slug first, fall back to bioguideId for old/shared URLs
  return (
    (await prisma.representative.findUnique({ where: { slug } })) ??
    (await prisma.representative.findUnique({ where: { bioguideId: slug } }))
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rep = await findRep(slug);

  const name = rep ? `${rep.firstName} ${rep.lastName}` : "Representative";
  const title = `${name} — Govroll`;
  const description = rep
    ? `See how ${rep.firstName} ${rep.lastName} (${rep.party}-${rep.state}) votes in the ${rep.chamber === "senator" ? "Senate" : "House"} and compare with public opinion.`
    : "See how this representative votes and compare with public opinion.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Govroll",
      type: "profile",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function RepresentativeDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const rep = await findRep(slug);

  if (!rep) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-6 py-8">
      <RepHero rep={rep} />
      <RepDetailInteractive bioguideId={rep.bioguideId} />
    </div>
  );
}
