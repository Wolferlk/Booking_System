/**
 * Delete my account — drivers and vehicle vendors (App Store guideline 5.1.1(v)).
 *
 * Sign-in stops the moment this succeeds; operations then erase the remaining
 * personal details within 30 days. Trip and payment records are kept as
 * business records. Server side: /api/mobile/me/delete.
 */
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, H1, IconButton, Ionicons, P, Row, type IconName } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { OPS_PHONE, PRIVACY_URL } from '@/lib/config';
import { C, R, S } from '@/lib/theme';

function Point({ icon, color, text }: { icon: IconName; color: string; text: string }) {
  return (
    <Row style={{ alignItems: 'flex-start' }} gap={S.md}>
      <Ionicons name={icon} size={20} color={color} style={{ marginTop: 1 }} />
      <Text style={{ color: C.text, fontSize: 15, lineHeight: 21, flex: 1 }}>{text}</Text>
    </Row>
  );
}

export default function DeleteAccount() {
  const { actor, signOut } = useAuth();
  const [confirm, setConfirm] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (!actor) return null;
  if (actor.kind === 'STAFF') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: S.xl, gap: S.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <H1 style={{ flex: 1 }}>Delete account</H1>
          <IconButton icon="close" onPress={() => router.back()} />
        </Row>
        <P>Your company login is managed by Aahaas. Ask your admin to close it on ops.aahaas.com.</P>
      </SafeAreaView>
    );
  }

  const isDriver = actor.kind === 'DRIVER';
  const ready = confirm.trim().toUpperCase() === 'DELETE';

  function ask() {
    Alert.alert(
      'Delete your account?',
      'You will be signed out straight away and cannot sign in again with this account. This cannot be undone.',
      [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: run }],
    );
  }

  async function run() {
    setBusy(true);
    try {
      await api('/api/mobile/me/delete', { body: { confirm: 'DELETE', reason: reason.trim() || undefined } });
      await signOut();
      router.replace('/welcome');
      Alert.alert('Account deleted', 'Your account is closed. Operations will erase your remaining details within 30 days.');
    } catch (e) {
      Alert.alert('Could not delete', `${(e as ApiError).message}\n\nYou can also call operations on ${OPS_PHONE}.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: S.xl, gap: S.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          <Row style={{ justifyContent: 'space-between' }}>
            <H1 style={{ flex: 1 }}>Delete my account</H1>
            <IconButton icon="close" onPress={() => router.back()} />
          </Row>

          <Card style={{ gap: S.md }}>
            <Text style={{ color: C.dim, fontWeight: '900', fontSize: 12, letterSpacing: 1.2 }}>WHAT HAPPENS</Text>
            <Point icon="log-out" color={C.red} text={isDriver
              ? 'Your app login is deleted now. You are signed out on every phone and will not get new trips.'
              : 'Your vendor login is deleted now, in the app and on the web portal.'} />
            <Point icon="trash" color={C.red} text={isDriver
              ? 'Within 30 days we erase your name, phone, e-mail, licence, photo and bank details.'
              : 'Within 30 days we erase your company name, contact and bank details.'} />
            <Point icon="document-text" color={C.sub} text="Trip and payment records are kept for accounting and tax, without your name on them." />
            {isDriver && <Point icon="navigate" color={C.sub} text="Location tracking stops at once." />}
            <Point icon="call" color={C.sub} text={`Money still owed to you is paid as normal. Questions: ${OPS_PHONE}.`} />
          </Card>

          <View style={{ gap: S.sm }}>
            <Text style={{ color: C.sub, fontWeight: '700' }}>Why are you leaving? (optional)</Text>
            <TextInput value={reason} onChangeText={setReason} placeholder="A few words help us improve" placeholderTextColor={C.dim} multiline maxLength={500}
              style={{ color: C.text, fontSize: 16, minHeight: 70, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: S.lg, textAlignVertical: 'top' }} />
          </View>

          <View style={{ gap: S.sm }}>
            <Text style={{ color: C.sub, fontWeight: '700' }}>Type DELETE to confirm</Text>
            <TextInput value={confirm} onChangeText={setConfirm} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE" placeholderTextColor={C.dim}
              accessibilityLabel="Type DELETE to confirm"
              style={{ color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: 2, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: ready ? C.red : C.line, padding: S.lg }} />
          </View>

          <Button title="Delete my account" icon="trash-outline" kind="danger" onPress={ask} loading={busy} disabled={!ready} />
          <Button title="Privacy policy" icon="shield-checkmark-outline" kind="ghost" onPress={() => WebBrowser.openBrowserAsync(PRIVACY_URL)} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
