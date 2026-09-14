import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Full-Stack SEO & AI Search — Study Guide",
  description: "A complete study guide for SEO, GEO, technical search and AI visibility.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" dir="ltr"><body>{children}</body></html>;
}
