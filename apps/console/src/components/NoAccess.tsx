import { signOut } from "../../app/actions";
import type { ConsoleSession } from "../lib/data/types";
import { Icon } from "./ui/Icon";

/** CON-03: signed in, but not an owner or manager (or RLS returns no membership yet). */
export function NoAccess({ session }: { session: Extract<ConsoleSession, { kind: "denied" }> }) {
  return (
    <div className="empty no-access">
      <div className="empty-icon">
        <Icon name="lock" size={24} />
      </div>
      <h3>This account cannot open the Console</h3>
      <p>
        Signed in as <b>{session.email}</b>. {session.detail}
      </p>
      <form action={signOut}>
        <button type="submit" className="btn btn-secondary">
          <Icon name="arrowLeft" size={16} />
          Sign out
        </button>
      </form>
    </div>
  );
}
