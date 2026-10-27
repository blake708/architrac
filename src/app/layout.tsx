import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Barlow, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ArchiTrac",
  description: "Projects, time and invoicing for architecture firms",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${barlow.variable} ${plexMono.variable}`}>
      <body className="antialiased">
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          appearance={{
            variables: {
              colorPrimary: "var(--color-ink)",
              borderRadius: "var(--radius-sm)",
              fontFamily: "var(--font-sans)",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
