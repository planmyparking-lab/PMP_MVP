"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getConsoleSession, FACILITY_COOKIE } from "../src/lib/data/session";
import { sanitizeRedirect } from "../src/lib/safeRedirect";
import { createSupabaseServerClient } from "../src/lib/supabase/server";

export interface SignInState {
  error: string | null;
}

/** T-CON-03-N2: wrong password and unknown email give the same message. */
const GENERIC_SIGN_IN_ERROR = "That email and password did not match an account.";

export async function signIn(_prev: SignInState, form: FormData): Promise<SignInState> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      error: "Sign-in is not configured for this build. Add the Supabase URL and anon key.",
    };
  }
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };

  let failed = false;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    failed = error !== null;
    if (error && error.status !== undefined && error.status >= 500) {
      return { error: "Sign-in is temporarily unavailable. Try again in a minute." };
    }
  } catch {
    return { error: "Sign-in is temporarily unavailable. Try again in a minute." };
  }
  if (failed) return { error: GENERIC_SIGN_IN_ERROR };
  redirect(sanitizeRedirect(form.get("next")));
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  (await cookies()).delete(FACILITY_COOKIE);
  redirect("/login");
}

/** CON-02 multi-site switcher. Only a facility the user may open is accepted. */
export async function selectFacility(form: FormData): Promise<void> {
  const id = String(form.get("facility") ?? "");
  const session = await getConsoleSession();
  if (session.kind !== "ok" || !session.facilities.some((f) => f.id === id)) return;
  (await cookies()).set(FACILITY_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 180,
  });
  revalidatePath("/", "layout");
}
