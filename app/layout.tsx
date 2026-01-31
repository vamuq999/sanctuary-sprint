export const metadata = {
  title: "Sanctuary Sprint",
  description: "A neon micro-arcade built for phone-first flow.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}