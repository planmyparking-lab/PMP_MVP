import { SCHEMA_VERSION } from "@pmp/contracts";

// Placeholder. Real screens are tracked as CON-xx features in docs/team/member-03-anamika.md.
export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1>ParkOS Operator Console</h1>
      <p>Schema version {SCHEMA_VERSION}</p>
    </main>
  );
}
