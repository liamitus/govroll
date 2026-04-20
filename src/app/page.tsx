import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AddressHero } from "@/components/address-hero";
import { HAS_ADDRESS_COOKIE } from "@/lib/address-cookie";

export default async function HomePage() {
  // Server-side redirect for returning users: avoids the hero flash
  // while localStorage is read on the client. The cookie only signals
  // presence (1), never the address itself.
  if ((await cookies()).get(HAS_ADDRESS_COOKIE)) {
    redirect("/bills");
  }
  return <AddressHero />;
}
