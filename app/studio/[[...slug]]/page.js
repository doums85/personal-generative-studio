import StandaloneShell from '@/components/StandaloneShell';
import StudioShell from '@/components/studio/StudioShell';
import { isStudioView } from '@/lib/studio/views';

export const metadata = {
  title: 'Studio — Personal Generative Studio',
};

// Views handled by the Gateway-native studio. Any other segment (layers, cinema,
// workflows…) keeps opening the advanced MuAPI studios of the upstream project.
export default async function StudioPage({ params }) {
  const { slug = [] } = await params;
  const [first] = slug;
  if (isStudioView(first)) return <StudioShell view={first || 'home'} />;
  if (first === 'library') return <StudioShell view="elements" />;
  if (first === 'audio') return <StudioShell view="voice" />;
  return <StandaloneShell />;
}
