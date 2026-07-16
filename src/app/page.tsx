import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Backend Core API</h1>
      <p>Database-centric platform running.</p>
      <ul>
        <li><Link href="/api/health">Health check</Link></li>
        <li><Link href="/api/auth/providers">Auth providers</Link></li>
      </ul>
    </main>
  );
}