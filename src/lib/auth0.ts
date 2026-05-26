import { Auth0Client } from "@auth0/nextjs-auth0/server";

const connection = process.env.AUTH0_CONNECTION;

export const auth0 = new Auth0Client({
  authorizationParameters: connection
    ? {
        connection,
      }
    : undefined,
  signInReturnToPath: "/today",
});
