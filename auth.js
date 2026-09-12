import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { isAllowedEmail } from '@/lib/access-control.mjs';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== 'google') return false;
      return profile?.email_verified === true && isAllowedEmail(profile.email);
    },
    authorized({ auth: session }) {
      return isAllowedEmail(session?.user?.email);
    },
  },
});
