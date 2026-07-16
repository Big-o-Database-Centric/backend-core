import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Backend Core API",
  description: "Database-centric platform API (Auth + provisioning)",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
