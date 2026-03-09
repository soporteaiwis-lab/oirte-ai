import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DemoUserProvider } from "@/components/DemoUserProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OIRTE AI",
  description: "Prototipo de comunicación accesible para personas sordas",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#09090b" />
      </head>
      <body className={`${inter.className}`}>
        <DemoUserProvider>
          {children}
        </DemoUserProvider>
      </body>
    </html>
  );
}
