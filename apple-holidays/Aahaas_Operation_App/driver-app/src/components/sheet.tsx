import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { C, R, S } from '@/lib/theme';
import { Ionicons } from './ui';

/** Bottom sheet used for every confirm / form on the company side. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(14,21,37,0.45)' }} onPress={onClose} />
        <View style={{ backgroundColor: C.card, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, maxHeight: '88%', paddingBottom: 34 }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}><View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: C.line }} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: S.xl, paddingVertical: S.md }}>
            <Text style={{ color: C.text, fontSize: 19, fontWeight: '800', flex: 1 }}>{title}</Text>
            <Ionicons name="close-circle" size={28} color={C.dim} onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: S.xl, gap: S.md, paddingBottom: S.lg }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
