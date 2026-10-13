import { Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function Index() {
  const { actor } = useAuth();
  if (!actor) return <Redirect href="/welcome" />;
  return <Redirect href={actor.kind === 'DRIVER' ? '/today' : '/home'} />;
}
