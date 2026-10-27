import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { WalletProviders } from "@/components/recallos/wallet";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RECALLOS — Your AI doesn't just remember your past. It learns from it.",
  description:
    "A personal AI decision agent with portable long-term memory. Decision DNA, ChainLens evidence, and an evidence-gated learning loop built on Walrus Memory and Tatum.",
  keywords: ["RECALLOS", "Walrus Memory", "Tatum", "AI decision agent", "persistent memory", "Sui", "learning loop"],
  authors: [{ name: "RECALLOS" }],
  icons: { icon: "/logo.svg" },
  openGraph: {
    title: "RECALLOS",
    description: "Your AI doesn't just remember your past. It learns from it.",
    siteName: "RECALLOS",
    type: "website",
  },
};

/* Explicit mobile viewport: fluid width, pinch-zoom allowed (accessibility),
   and a theme-color that follows the dark/light palette on Android/iOS browsers. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 5,
  viewportFit: "cover", // lets safe-area padding work on notched/gesture-nav Android devices
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <WalletProviders>
            {children}
            <Toaster />
          </WalletProviders>
        </ThemeProvider>
      </body>
    </html>
  );
}
