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
    <header className="bg-navy sticky top-0 z-50 border-b border-white/10">
      <nav className="mx-auto grid h-14 max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-4 px-6">
        <Link
          href={logoHref}
          className="group flex flex-shrink-0 items-center gap-2"
        >
          <span className="text-civic-gold text-sm tracking-widest">
            &#9733;
          </span>
          <span className="font-heading text-lg font-semibold tracking-wide text-white uppercase">
            Govroll
          </span>
          <span className="text-civic-gold text-sm tracking-widest">
            &#9733;
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
              className="h-8 border border-white/15 px-4 text-sm tracking-wide text-white/80 uppercase hover:border-white/30 hover:bg-white/10 hover:text-white"
            >
              Sign In
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger className="flex size-8 cursor-pointer items-center justify-center rounded text-white/60 transition-colors hover:bg-white/5 hover:text-white">
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
