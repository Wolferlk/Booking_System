import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { fmtRange } from '@/lib/format';
import { FLAG, STATUS_LABELS, statusTone } from '@/lib/status';
import { C, S } from '@/lib/theme';
import { Card, Ionicons, Pill, Row } from './ui';

export interface BookingLite {
  bookingRef: string; fileNo?: string; isNumber?: string | null; status: string; country?: string | null; operationCountry?: string | null
  leadGuest?: string | null; passengers?: { name: string }[]; pax?: number; paxAdults?: number; paxChildren?: number
  agent?: string | null; arrivalDate: string; departureDate: string
}

export function BookingCard({ b, accent }: { b: BookingLite; accent?: string }) {
  const country = b.country ?? b.operationCountry ?? '';
  const guest = b.leadGuest ?? b.passengers?.[0]?.name ?? 'Guest';
  const pax = b.pax ?? (b.paxAdults ?? 0) + (b.paxChildren ?? 0);
  return (
    <Card onPress={() => router.push({ pathname: '/booking/[ref]', params: { ref: b.bookingRef } })} style={{ gap: 6, borderLeftWidth: accent ? 4 : 1, borderLeftColor: accent ?? C.line }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6}>
          <Text style={{ fontSize: 16 }}>{FLAG[country] ?? '🌏'}</Text>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '900' }}>{b.bookingRef}</Text>
          {b.isNumber && b.isNumber !== b.bookingRef ? <Text style={{ color: C.dim, fontSize: 12 }}>{b.isNumber}</Text> : null}
        </Row>
        <Pill text={STATUS_LABELS[b.status] ?? b.status} tone={statusTone(b.status)} />
      </Row>
      <Text style={{ color: C.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{guest}</Text>
      <Row gap={S.md} style={{ flexWrap: 'wrap' }}>
        <Row gap={4}><Ionicons name="calendar-outline" size={14} color={C.sub} /><Text style={{ color: C.sub, fontSize: 13 }}>{fmtRange(b.arrivalDate.slice(0, 10), b.departureDate.slice(0, 10))}</Text></Row>
        <Row gap={4}><Ionicons name="people-outline" size={14} color={C.sub} /><Text style={{ color: C.sub, fontSize: 13 }}>{pax}</Text></Row>
        {b.agent ? <View style={{ flexShrink: 1 }}><Text style={{ color: C.dim, fontSize: 13 }} numberOfLines={1}>{b.agent}</Text></View> : null}
      </Row>
    </Card>
  );
}
