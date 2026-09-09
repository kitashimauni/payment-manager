import { auth, authEnabled, e2eAuthEnabled, signIn, signOut } from "@/auth";

async function signInWithGoogle() {
  "use server";
  await signIn("google", { redirectTo: "/" });
}

async function signOutUser() {
  "use server";
  await signOut({ redirectTo: "/" });
}

async function signInWithE2e() {
  "use server";
  if (!e2eAuthEnabled) return;
  await signIn("e2e", { accessKey: process.env.E2E_AUTH_SECRET, redirectTo: "/" });
}

export async function AuthStatus() {
  if (!authEnabled) {
    return <span className="auth-status local-only">Local Only</span>;
  }

  try {
    const session = await auth();

    if (session?.user) {
      return (
        <div className="auth-status auth-user">
          <span className="auth-user-name" title={session.user.email ?? undefined}>
            {session.user.name ?? session.user.email ?? "ログイン中"}
          </span>
          <form action={signOutUser}>
            <button type="submit" className="small-button ghost">
              ログアウト
            </button>
          </form>
        </div>
      );
    }
  } catch {
    // A temporarily unavailable database must not prevent Local First entry.
    return <span className="auth-status local-only">Local Only</span>;
  }

  if (e2eAuthEnabled) {
    return (
      <form action={signInWithE2e}>
        <button type="submit" className="small-button auth-button">
          E2Eテストユーザーでログイン
        </button>
      </form>
    );
  }

  return (
    <form action={signInWithGoogle}>
      <button type="submit" className="small-button auth-button">
        Googleでログイン
      </button>
    </form>
  );
}
