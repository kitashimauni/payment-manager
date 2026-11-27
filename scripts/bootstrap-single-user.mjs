import postgres from "postgres";

if (process.env.AUTH_MODE !== "trusted-proxy-single-user") {
  throw new Error("Bootstrap is only valid with AUTH_MODE=trusted-proxy-single-user");
}

const userId = process.env.SINGLE_USER_ID;
if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  throw new Error("SINGLE_USER_ID must be a fixed UUID");
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const sql = postgres(process.env.DATABASE_URL, { max: 1 });
try {
  await sql`
    insert into users (id, name)
    values (${userId}, 'Tailnet single user')
    on conflict (id) do nothing
  `;
  const users = await sql`select id, name from users where id = ${userId}`;
  if (users.length !== 1 || users[0].name !== "Tailnet single user") {
    throw new Error("UUID is already associated with another principal or could not be verified");
  }
  console.log(`Single-user principal verified: ${userId}`);
} finally {
  await sql.end();
}
