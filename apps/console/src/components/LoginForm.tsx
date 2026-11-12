"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn } from "../../app/actions";
import type { SignInState } from "../../app/actions";
import { Icon } from "./ui/Icon";

export function LoginForm({ next, configured }: { next: string; configured: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, { error: null });
  const [show, setShow] = useState(false);

  if (!configured) {
    return (
      <div className="auth-form">
        <div className="auth-notice">
          <span className="auth-notice-icon">
            <Icon name="plugOff" size={18} />
          </span>
          <div>
            <b>Sign-in is not set up on this computer</b>
            <p>
              Add these two values to <code>apps/console/.env.local</code>, then restart the server:
            </p>
            <ul>
              <li>
                <code>NEXT_PUBLIC_SUPABASE_URL</code>
              </li>
              <li>
                <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
              </li>
            </ul>
          </div>
        </div>
        <Link href="/" className="btn btn-primary btn-lg">
          Continue in offline preview
          <Icon name="arrowRight" size={17} />
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="auth-form" noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">Work email</label>
        <div className="input-icon">
          <Icon name="user" size={17} />
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            className="input"
            required
            placeholder="you@company.in"
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <div className="input-icon">
          <Icon name="lock" size={17} />
          <input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            className="input"
            required
            placeholder="Your password"
          />
          <button
            type="button"
            className="input-toggle"
            onClick={() => setShow((s) => !s)}
            aria-pressed={show}
            aria-label={show ? "Hide password" : "Show password"}
          >
            <Icon name={show ? "eyeOff" : "eye"} size={17} />
          </button>
        </div>
      </div>
      {state.error && (
        <div className="issue tone-bad" role="alert">
          <Icon name="alert" size={17} />
          <div>{state.error}</div>
        </div>
      )}
      <button type="submit" className="btn btn-primary btn-lg" disabled={pending}>
        {pending ? <span className="spinner" aria-hidden="true" /> : null}
        {pending ? "Signing in…" : "Sign in"}
        {!pending && <Icon name="arrowRight" size={17} />}
      </button>
    </form>
  );
}
