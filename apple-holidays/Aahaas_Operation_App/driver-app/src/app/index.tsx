import { Redirect } from 'expo-router';
import { homeFor, useAuth } from '@/lib/auth';

export default function Index() {
  const { actor } = useAuth();
  if (!actor) return <Redirect href="/welcome" />;
  return <Redirect href={homeFor(actor)} />;
}
