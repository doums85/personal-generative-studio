import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { isAllowedEmail } from '@/lib/access-control.mjs';
import { verifyPassword } from '@/lib/password.mjs';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').trim().toLowerCase();
        const password = String(credentials?.password ?? '');
        // Always run the hash so a wrong address and a wrong password take the same time.
        const passwordOk = verifyPassword(password, process.env.AUTH_PASSWORD_HASH ?? '');
        if (!passwordOk || !isAllowedEmail(email)) return null;
        return { id: email, email };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    authorized({ auth: session }) {
      return isAllowedEmail(session?.user?.email);
    },
  },
});
