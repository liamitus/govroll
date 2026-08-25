import type { Metadata } from "next";
import { Archivo, Public_Sans } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import "./globals.css";
import { NavBar } from "@/components/nav-bar";
import { Footer } from "@/components/footer";
import { BfcacheReload } from "@/components/bfcache-reload";
import { QueryProvider } from "@/components/query-provider";

// Roll Call carries exactly two families (docs/design/roll-call.md):
// Public Sans for body/UI/data, Archivo (with its width axis) for display.
const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const SITE_TITLE = "Govroll — See What Your Representatives Are Doing";
const SITE_DESCRIPTION =
  "Track bills, see how your elected officials vote, and make your voice heard in the legislative process.";
const SITE_URL = "https://www.govroll.com";

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: "/" },
  openGraph: {
    siteName: "Govroll",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${publicSans.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <QueryProvider>
          <NuqsAdapter>
            <BfcacheReload />
            <NavBar />
            <main className="flex-1">{children}</main>
            <Footer />
          </NuqsAdapter>
        </QueryProvider>
      </body>
    </html>
  );
}
