"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Menu } from "lucide-react";
import { useState } from "react";
import { AuthModal } from "@/components/auth/auth-modal";
import { useAddress } from "@/hooks/use-address";
import { CongressStatus } from "@/components/congress-status/congress-status";
import { GlobalSearch } from "@/components/global-search";

export function NavBar() {
  const { user, loading, signOut } = useAuth();
  const { address, isLoaded } = useAddress();
  const [authOpen, setAuthOpen] = useState(false);
  const logoHref = isLoaded && address ? "/bills" : "/";

  return (
    <header className="bg-ink border-paper/10 sticky top-0 z-50 border-b">
      <nav className="mx-auto grid h-14 max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-6">
        <Link
          href={logoHref}
          className="group flex flex-shrink-0 items-center gap-2.5"
        >
          {/* The gold node ringed in the ground colour — the same mark
              that means "current position" on a route. */}
          <span aria-hidden className="brand-node brand-node--reversed" />
          <span className="font-heading wdth-125 text-paper text-[1.3rem] leading-none font-extrabold tracking-[0.02em] uppercase">
            Govroll
          </span>
        </Link>

        <div className="flex justify-center">
          <GlobalSearch />
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <CongressStatus />
          {!loading && !user && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAuthOpen(true)}
              className="text-paper/80 hover:text-paper border-paper/20 hover:border-paper/40 hover:bg-paper/10 h-8 border px-4 text-sm tracking-wide uppercase"
            >
              Sign In
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger className="text-paper/60 hover:text-paper hover:bg-paper/5 flex size-8 cursor-pointer items-center justify-center transition-colors">
              <Menu className="size-[18px]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="min-w-[180px]"
            >
              {user && (
                <>
                  <div className="text-muted-foreground max-w-[200px] truncate px-1.5 py-1 text-sm font-medium">
                    {user.email}
                  </div>
                  <DropdownMenuItem render={<Link href="/account" />}>
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem render={<Link href="/bills" />}>
                Bills
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/support" />}>
                Support Govroll
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/about" />}>
                About
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/contact" />}>
                Contact
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/privacy" />}>
                Privacy Policy
              </DropdownMenuItem>
              <DropdownMenuItem render={<Link href="/terms" />}>
                Terms of Service
              </DropdownMenuItem>
              {user && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={signOut}
                    className="text-muted-foreground"
                  >
                    Sign Out
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </nav>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </header>
  );
}
