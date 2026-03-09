import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { DemoUserProvider } from "@/components/DemoUserProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OIRTE AI",
  description: "Prototipo de comunicación accesible",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      <body className={`${inter.className} min-h-screen flex flex-col`}>
        <DemoUserProvider>
          {children}
        </DemoUserProvider>
      </body>
    </html>
  );
}
