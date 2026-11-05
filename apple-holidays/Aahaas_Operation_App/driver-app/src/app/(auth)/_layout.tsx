import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { C } from '@/lib/theme';

export default function AuthLayout() {
  const { actor } = useAuth();
  if (actor) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />;
}
