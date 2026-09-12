import './globals.css';
import { headers } from 'next/headers';
import { getLocaleConfig } from '@/lib/locales';

export const metadata = {
  title: 'Personal Generative Studio',
  description: 'Private AI studio for images, video, music, voice, cinema and creative workflows.',
};

export default async function RootLayout({ children }) {
  // Locale is derived from the URL path by middleware.js and passed
  // through as a plain response header — the root layout is shared by
  // every locale's route tree, so it can't take a `locale` prop directly.
  const headerList = await headers();
  const { htmlLang } = getLocaleConfig(headerList.get('x-locale'));

  return (
    <html lang={htmlLang}>
      <body>{children}</body>
    </html>
  );
}
