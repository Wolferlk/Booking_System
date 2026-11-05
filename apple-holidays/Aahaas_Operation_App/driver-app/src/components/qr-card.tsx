import QRCode from 'react-native-qrcode-svg';
import { Text, View } from 'react-native';
import { C, R, S } from '@/lib/theme';

/** Big white QR the guest scans from the driver's phone — brightness-friendly. */
export function QrCard({ value, title, caption }: { value: string; title: string; caption?: string }) {
  return (
    <View style={{ alignItems: 'center', gap: S.md }}>
      <View style={{ backgroundColor: '#fff', padding: 22, borderRadius: R.lg }}>
        <QRCode value={value} size={240} color="#0B0F1A" backgroundColor="#fff" />
      </View>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', textAlign: 'center' }}>{title}</Text>
      {caption && <Text style={{ color: C.sub, fontSize: 15, textAlign: 'center', paddingHorizontal: S.lg }}>{caption}</Text>}
    </View>
  );
}
