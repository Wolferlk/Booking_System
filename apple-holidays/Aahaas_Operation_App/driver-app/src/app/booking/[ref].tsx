/**
 * Booking — everything the web booking page does that makes sense on a phone:
 * status actions, operation checklist, guests, flights, hotels, agenda (with
 * per-movement driver WhatsApp), tickets, P&L, timeline, PDF / agenda Word,
 * portal link, WhatsApp to the client, agent e-mail, feedback and cancellation
 * (with the same e-mailed code as the web).
 *
 * Every call goes through the bridge to the web's own routes, so the person's
 * role decides what works — exactly as on ops.aahaas.com.
 */
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sheet } from '@/components/sheet';
import { Button, Card, ErrorBox, IconButton, Ionicons, Label, Loading, P, Pill, Row, type IconName } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { ago, fmtDay } from '@/lib/format';
import { CHECKLIST, FLAG, STATUS_LABELS, money, reached, statusTone } from '@/lib/status';
import { C, R, S, shadow } from '@/lib/theme';
import { openWebFile, web, webAction } from '@/lib/web';

type B = Record<string, any>;

interface Action { to: string; label: string; endpoint: string; body: Record<string, unknown>; needsNote: boolean; feedback: boolean; danger: boolean }
interface Actions { status: string; statusLabel: string; actions: Action[]; tools: Record<string, boolean> }

const TABS = ['Overview', 'Agenda', 'Tickets', 'P&L', 'Timeline'] as const;
type Tab = (typeof TABS)[number];

function d(v: string | null | undefined) { return v ? fmtDay(String(v).slice(0, 10)) : '—'; }
function phoneDigits(p?: string | null) { return (p ?? '').replace(/\D/g, ''); }

function Tool({ icon, label, onPress, tone = C.red, busy }: { icon: IconName; label: string; onPress: () => void; tone?: string; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => [{ width: '31%', alignItems: 'center', gap: 6, paddingVertical: S.md, borderRadius: R.md, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, opacity: pressed || busy ? 0.6 : 1 }, shadow]}>
      <Ionicons name={icon} size={22} color={tone} />
      <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', textAlign: 'center' }} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: C.sub, fontSize: 14 }}>{k}</Text>
      <Text style={{ color: C.text, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{v}</Text>
    </Row>
  );
}

export default function BookingScreen() {
  const { ref } = useLocalSearchParams<{ ref: string }>();
  const enc = encodeURIComponent(ref);
  const [b, setB] = useState<B | null>(null);
  const [acts, setActs] = useState<Actions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>('Overview');
  const [busy, setBusy] = useState<string | null>(null);
  // sheets
  const [noteFor, setNoteFor] = useState<Action | null>(null);
  const [note, setNote] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [cancel, setCancel] = useState<{ step: 'reason' | 'code'; reason: string; verificationId?: string; mask?: string; code: string } | null>(null);
  const [brief, setBrief] = useState<{ itemId: string; title: string; recipients: B[]; chosen: Set<number>; note: string; history: B[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const [bk, ac] = await Promise.all([
        web<B>(`bookings/${enc}`),
        api<Actions>(`/api/mobile/staff/booking-actions/${enc}`),
      ]);
      setB(bk); setActs(ac); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setRefreshing(false); }
  }, [enc]);
  useEffect(() => { load(); }, [load]);

  async function run(key: string, fn: () => Promise<string | void>, confirm?: string) {
    const go = async () => {
      setBusy(key);
      try {
        const msg = await fn();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (msg) Alert.alert('Done', msg);
        await load();
      } catch (e) { Alert.alert('Not done', (e as ApiError).message); }
      finally { setBusy(null); }
    };
    if (confirm) Alert.alert('Please confirm', confirm, [{ text: 'Cancel', style: 'cancel' }, { text: 'Yes', onPress: go }]);
    else go();
  }

  function onAction(a: Action) {
    if (a.feedback) { setRating(b?.customerFeedback?.rating ?? 0); setComment(b?.customerFeedback?.comment ?? ''); setFeedbackOpen(true); return; }
    if (a.needsNote) { setNote(''); setNoteFor(a); return; }
    run(a.to, () => webAction(`bookings/${enc}/${a.endpoint}`, a.body), `${a.label} for ${ref}?`);
  }

  async function sharePortal() {
    await run('portal', async () => {
      const r = await web<{ path: string }>(`bookings/${enc}/portal-link`);
      const url = `${API_URL}${r.path}`;
      await Clipboard.setStringAsync(url);
      await Share.share({ message: `Your trip with Aahaas — everything in one place:\n${url}` });
    });
  }

  async function openBrief(item: B) {
    setBusy(`brief-${item.id}`);
    try {
      const r = await web<{ recipients: B[]; history: B[]; canSend: boolean }>(`bookings/${enc}/agenda/items/${item.id}/whatsapp`);
      if (!r.canSend) throw new Error('Your role cannot send movement briefs.');
      setBrief({ itemId: item.id, title: `${item.meetingTime ?? ''} ${item.fromPoint || item.location}`.trim(), recipients: r.recipients ?? [], chosen: new Set((r.recipients ?? []).map((x, n) => (x.selected ? n : -1)).filter(n => n >= 0)), note: '', history: r.history ?? [] });
    } catch (e) { Alert.alert('Cannot open', (e as Error).message); }
    finally { setBusy(null); }
  }

  const agendaDays = useMemo(() => {
    const items: B[] = b?.tourAgenda?.items ?? [];
    const m = new Map<string, B[]>();
    for (const i of items) { const k = String(i.date).slice(0, 10); m.set(k, [...(m.get(k) ?? []), i]); }
    return Array.from(m.entries());
  }, [b]);

  if (!b && !error) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}><Loading /></SafeAreaView>;
  if (!b) return <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, padding: S.lg, gap: S.lg }}><IconButton icon="chevron-back" onPress={() => router.back()} /><ErrorBox message={error!} onRetry={load} /></SafeAreaView>;

  const status = String(b.status);
  const lead = (b.passengers ?? []).find((p: B) => p.isLead) ?? b.passengers?.[0];
  const daysUntil = Math.ceil((new Date(b.arrivalDate).getTime() - Date.now()) / 86_400_000);
  const clientPhone = phoneDigits(b.contactWhatsapp || b.contactPhone);
  const tools = acts?.tools ?? {};
  const pnl = b.pnl as B | null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: S.lg, gap: S.lg, paddingBottom: 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.sub} />}>
        <Row style={{ justifyContent: 'space-between' }}>
          <IconButton icon="chevron-back" onPress={() => router.back()} />
          <Row gap={S.sm}>
            {clientPhone ? <IconButton icon="logo-whatsapp" color={C.green} onPress={() => router.push({ pathname: '/wa/[phone]', params: { phone: clientPhone } })} /> : null}
            <IconButton icon="refresh" onPress={load} />
          </Row>
        </Row>

        {/* Header */}
        <Card style={{ gap: S.sm }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 }}>{b.bookingRef}</Text>
              <Row gap={S.sm} style={{ flexWrap: 'wrap', marginTop: 4 }}>
                {b.cntlNumber ? <Pill text={`CNTL ${b.cntlNumber}`} tone="blue" /> : null}
                {b.isNumber ? <Pill text={`IS ${b.isNumber}`} tone="blue" /> : null}
                <Pill text={`V${b.version}`} />
              </Row>
            </View>
            <Text style={{ fontSize: 28 }}>{FLAG[b.operationCountry] ?? '🌏'}</Text>
          </Row>
          <Pill text={STATUS_LABELS[status] ?? status} tone={statusTone(status)} />
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{lead?.name ?? 'Guest'}</Text>
          <Text style={{ color: C.sub }}>{b.agent ?? '—'}{b.agentBookingId ? ` · Agent ${b.agentBookingId}` : ''}</Text>
          <Row gap={S.lg} style={{ flexWrap: 'wrap' }}>
            <Row gap={4}><Ionicons name="calendar-outline" size={15} color={C.sub} /><Text style={{ color: C.text }}>{d(b.arrivalDate)} → {d(b.departureDate)}</Text></Row>
            <Row gap={4}><Ionicons name="people-outline" size={15} color={C.sub} /><Text style={{ color: C.text }}>{b.paxAdults}A {b.paxChildren}C</Text></Row>
            {b.quotedTotal != null && <Row gap={4}><Ionicons name="card-outline" size={15} color={C.sub} /><Text style={{ color: C.text }}>{money(b.quotedTotal, b.currency)}</Text></Row>}
          </Row>
          {daysUntil > 0 && <Text style={{ color: daysUntil <= 7 ? C.red : daysUntil <= 21 ? C.amber : C.sub, fontWeight: '700' }}>T−{daysUntil} days{daysUntil <= 21 ? ' · cancellation penalty window' : ''}</Text>}
        </Card>

        {/* Operation checklist */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
          {CHECKLIST.map(c => {
            const ok = reached(status, c.status);
            return (
              <View key={c.status} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, backgroundColor: ok ? C.greenSoft : C.card, borderWidth: 1, borderColor: ok ? C.green : C.line, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Ionicons name={(ok ? 'checkmark-circle' : c.icon) as IconName} size={15} color={ok ? C.green : C.dim} />
                <Text style={{ color: ok ? C.green : C.sub, fontWeight: '700', fontSize: 12 }}>{c.label}</Text>
              </View>
            );
          })}
        </ScrollView>

        {/* Status actions */}
        {!!acts?.actions.length && (
          <View style={{ gap: S.sm }}>
            {acts.actions.map(a => (
              <Button key={a.to} title={a.label} kind={a.danger ? 'secondary' : 'primary'} icon={a.danger ? 'create-outline' : 'arrow-forward-circle'}
                loading={busy === a.to} onPress={() => onAction(a)} />
            ))}
          </View>
        )}

        {/* Tools */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S.sm, justifyContent: 'space-between' }}>
          {tools.pdf && <Tool icon="document-text" label="PDF" busy={busy === 'pdf'} onPress={() => run('pdf', () => openWebFile(`ops-ai/pdf/${enc}`, `${ref}.pdf`))} />}
          <Tool icon="document-attach" label="Agenda Word" tone={C.blue} busy={busy === 'word'} onPress={() => run('word', () => openWebFile(`bookings/${enc}/agenda/word`, `${ref}-agenda.docx`))} />
          {tools.portalLink && <Tool icon="link" label="Portal link" tone={C.gold} busy={busy === 'portal'} onPress={sharePortal} />}
          {tools.whatsapp && <Tool icon="logo-whatsapp" label="Send TC" tone={C.green} onPress={() => router.push({ pathname: '/booking/send', params: { ref, phone: clientPhone, name: lead?.name ?? '' } })} />}
          {clientPhone ? <Tool icon="chatbubbles" label="Guest chat" tone={C.green} onPress={() => router.push({ pathname: '/wa/[phone]', params: { phone: clientPhone } })} /> : null}
          {tools.agentEmail && <Tool icon="mail" label="Agent e-mail" tone={C.blue} busy={busy === 'mail'} onPress={() => run('mail', () => webAction(`bookings/${enc}/send-agent-email`, {}), `E-mail the confirmation to the agent for ${ref}?`)} />}
          <Tool icon="star" label="Feedback" tone={C.gold} onPress={() => { setRating(b.customerFeedback?.rating ?? 0); setComment(b.customerFeedback?.comment ?? ''); setFeedbackOpen(true); }} />
          {tools.cancel && <Tool icon="close-circle" label="Cancel" busy={busy === 'cancel'} onPress={() => setCancel({ step: 'reason', reason: '', code: '' })} />}
        </View>

        {/* Section tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm }}>
          {TABS.filter(t => t !== 'P&L' || tools.pnl).map(t => (
            <Pressable key={t} onPress={() => setTab(t)} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99, backgroundColor: tab === t ? C.ink : C.card, borderWidth: 1, borderColor: tab === t ? C.ink : C.line }}>
              <Text style={{ color: tab === t ? '#FFFFFF' : C.text, fontWeight: '700' }}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {tab === 'Overview' && (
          <>
            <Card style={{ gap: S.sm }}>
              <Label>Guests ({(b.passengers ?? []).length})</Label>
              {(b.passengers ?? []).map((p: B) => (
                <Row key={p.id} style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontWeight: p.isLead ? '800' : '500', flex: 1 }}>{p.name}{p.isLead ? '  ★' : ''}</Text>
                  <Text style={{ color: C.sub, fontSize: 13 }}>{[p.type === 'CHILD' ? 'Child' : 'Adult', p.nationality, p.mealPreference].filter(Boolean).join(' · ')}</Text>
                </Row>
              ))}
            </Card>
            {(b.contactPhone || b.contactWhatsapp || b.contactEmail) && (
              <Card style={{ gap: S.sm }}>
                <Label>Contact</Label>
                {b.contactWhatsapp && <Pressable onPress={() => router.push({ pathname: '/wa/[phone]', params: { phone: phoneDigits(b.contactWhatsapp) } })}><Row><Ionicons name="logo-whatsapp" size={18} color={C.green} /><Text style={{ color: C.text }}>{b.contactWhatsapp}</Text></Row></Pressable>}
                {b.contactPhone && <Pressable onPress={() => Linking.openURL(`tel:${b.contactPhone}`)}><Row><Ionicons name="call" size={18} color={C.blue} /><Text style={{ color: C.text }}>{b.contactPhone}</Text></Row></Pressable>}
                {b.contactEmail && <Pressable onPress={() => Linking.openURL(`mailto:${b.contactEmail}`)}><Row><Ionicons name="mail" size={18} color={C.blue} /><Text style={{ color: C.text }}>{b.contactEmail}</Text></Row></Pressable>}
              </Card>
            )}
            <Card style={{ gap: S.sm }}>
              <Label>Flights ({(b.flights ?? []).length})</Label>
              {(b.flights ?? []).length === 0 && <P>No flights.</P>}
              {(b.flights ?? []).map((f: B) => (
                <Row key={f.id} gap={S.md}>
                  <Ionicons name="airplane" size={18} color={C.blue} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontWeight: '700' }}>{f.flightNo} · {d(f.date)}</Text>
                    <Text style={{ color: C.sub }}>{f.fromApt} {f.depTime} → {f.toApt} {f.arrTime}</Text>
                  </View>
                </Row>
              ))}
            </Card>
            <Card style={{ gap: S.sm }}>
              <Label>Hotels ({(b.accommodations ?? []).length})</Label>
              {(b.accommodations ?? []).map((a: B) => (
                <Row key={a.id} gap={S.md} style={{ alignItems: 'flex-start' }}>
                  <Ionicons name="bed" size={18} color={C.gold} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontWeight: '700' }}>{a.hotel}</Text>
                    <Text style={{ color: C.sub }}>{a.city} · {d(a.checkIn)} → {d(a.checkOut)} · {a.nights}N{a.roomType ? ` · ${a.roomType}` : ''}{a.mealType ? ` · ${a.mealType}` : ''}</Text>
                  </View>
                </Row>
              ))}
            </Card>
            {(b.specialOccasions || b.clientRequest) && (
              <Card tone="gold" style={{ gap: 4 }}>
                <Label>Special notes</Label>
                {b.specialOccasions && <Text style={{ color: C.text }}>🎁 {b.specialOccasions}</Text>}
                {b.clientRequest && <Text style={{ color: C.text }}>{b.clientRequest}</Text>}
              </Card>
            )}
          </>
        )}

        {tab === 'Agenda' && (
          <>
            {agendaDays.length === 0 && <P>No agenda yet. It is generated on ops.aahaas.com.</P>}
            {agendaDays.map(([day, items], n) => (
              <Card key={day} style={{ gap: S.md }}>
                <Text style={{ color: C.red, fontWeight: '800' }}>Day {n + 1} · {fmtDay(day, { weekday: 'long', day: 'numeric', month: 'short' })}</Text>
                {items.map(i => (
                  <View key={i.id} style={{ gap: 4, paddingLeft: S.md, borderLeftWidth: 3, borderLeftColor: i.isLeisure ? C.line : C.red }}>
                    <Text style={{ color: C.text, fontWeight: '700' }}>{i.meetingTime || i.timeFrom ? `${i.meetingTime || i.timeFrom} · ` : ''}{i.fromPoint || i.location}{i.toPoint ? ` → ${i.toPoint}` : ''}</Text>
                    {i.details ? <Text style={{ color: C.sub, fontSize: 13 }} numberOfLines={3}>{i.details}</Text> : null}
                    <Row gap={S.sm} style={{ flexWrap: 'wrap' }}>
                      <Pill text={String(i.serviceType).replace(/_/g, ' ')} />
                      {i.isLeisure && <Pill text="Leisure" tone="dim" />}
                      {i.assignment?.driverName && <Pill text={`🚗 ${i.assignment.driverName}`} tone="green" />}
                      {i.assignment?.vehiclePlate && <Pill text={i.assignment.vehiclePlate} />}
                      {i.assignment?.guideName && <Pill text={`Guide ${i.assignment.guideName}`} tone="blue" />}
                      {!i.isLeisure && !i.isHotelOnly && !i.assignment?.driverName && !i.assignment?.vendorName && <Pill text="No driver" tone="red" />}
                      {(i.tickets ?? []).length > 0 && <Pill text={`${i.tickets.length} ticket(s)`} tone="gold" />}
                    </Row>
                    <Row gap={S.lg}>
                      {i.assignment?.driverPhone && <Text style={{ color: C.blue, fontWeight: '700' }} onPress={() => Linking.openURL(`tel:${i.assignment.driverPhone}`)}>Call driver</Text>}
                      {!i.isLeisure && <Text style={{ color: C.green, fontWeight: '700' }} onPress={() => openBrief(i)}>{busy === `brief-${i.id}` ? 'Opening…' : 'WhatsApp brief'}</Text>}
                    </Row>
                  </View>
                ))}
              </Card>
            ))}
            <P dim>Allocating drivers and editing the movement chart stays on ops.aahaas.com — saving the chart rewrites every movement, which is safer on a full screen.</P>
          </>
        )}

        {tab === 'Tickets' && (
          <>
            {(b.tickets ?? []).length === 0 && <P>No tickets.</P>}
            {(b.tickets ?? []).map((t: B) => (
              <Card key={t.id} style={{ gap: 4 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text style={{ color: C.text, fontWeight: '800', flex: 1 }}>{t.type} × {t.qty}</Text>
                  <Pill text={t.status} tone={t.status === 'DRAFT' ? 'gold' : 'green'} />
                </Row>
                {t.supplier && <Text style={{ color: C.sub }}>{t.supplier}</Text>}
                {t.reference && <Text style={{ color: C.text }}>Ref: {t.reference}</Text>}
                {t.totalCost != null && <Text style={{ color: C.sub }}>{money(t.totalCost, t.currency)}</Text>}
                {t.fileUrl && <Text style={{ color: C.blue, fontWeight: '700' }} onPress={() => Linking.openURL(String(t.fileUrl).startsWith('http') ? t.fileUrl : `${API_URL}${t.fileUrl}`)}>Open ticket file</Text>}
              </Card>
            ))}
          </>
        )}

        {tab === 'P&L' && (
          pnl ? (
            <>
              <Row gap={S.md}>
                {[['Revenue', pnl.totalRevenue, C.text], ['Cost', pnl.totalCost, C.text], ['Profit', pnl.profit, Number(pnl.profit) >= 0 ? C.green : C.red]].map(([k, v, col]) => (
                  <Card key={String(k)} style={{ flex: 1, padding: S.md, gap: 2 }}>
                    <Text style={{ color: C.sub, fontSize: 12 }}>{k as string}</Text>
                    <Text style={{ color: col as string, fontWeight: '900', fontSize: 16 }}>{Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</Text>
                  </Card>
                ))}
              </Row>
              {pnl.margin != null && <Text style={{ color: C.sub }}>Margin {Number(pnl.margin).toFixed(1)}% · {b.pnlSource ?? ''}</Text>}
              {(pnl.lineItems ?? []).map((l: B) => (
                <Card key={l.id} style={{ gap: 2 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text style={{ color: C.text, fontWeight: '700', flex: 1 }}>{l.activity}</Text>
                    <Pill text={l.paymentStatus} tone={l.paymentStatus === 'CONFIRMED' ? 'green' : 'gold'} />
                  </Row>
                  <Text style={{ color: C.sub, fontSize: 13 }}>{l.category} · sell {Number(l.mmtRate).toLocaleString()} · cost {Number(l.totalCost ?? 0).toLocaleString()}</Text>
                </Card>
              ))}
            </>
          ) : <P>No P&L for this booking yet, or your role sees it after the portal opens.</P>
        )}

        {tab === 'Timeline' && (
          <Card style={{ gap: S.md }}>
            {(b.statusEvents ?? []).length === 0 && <P>No history.</P>}
            {(b.statusEvents ?? []).map((e: B) => (
              <Row key={e.id} gap={S.md} style={{ alignItems: 'flex-start' }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.red, marginTop: 5 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>{STATUS_LABELS[e.toState] ?? e.toState}</Text>
                  <Text style={{ color: C.sub, fontSize: 13 }}>{e.actor?.name ?? 'System'} · {ago(e.createdAt)}</Text>
                  {e.note ? <Text style={{ color: C.text, fontSize: 13 }}>{e.note}</Text> : null}
                </View>
              </Row>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* Note for change request / resubmit / client confirm */}
      <Sheet open={!!noteFor} onClose={() => setNoteFor(null)} title={noteFor?.label ?? ''}>
        <P>{noteFor?.to === 'CHANGE_REQUESTED' ? 'What needs to change?' : 'Add a note for the record.'}</P>
        <TextInput value={note} onChangeText={setNote} multiline placeholder="Note" placeholderTextColor={C.dim}
          style={{ color: C.text, minHeight: 110, backgroundColor: C.cardHi, borderRadius: R.md, padding: S.lg, fontSize: 16, textAlignVertical: 'top' }} />
        <Button title={noteFor?.label ?? 'Save'} loading={!!busy} disabled={noteFor?.to === 'CHANGE_REQUESTED' && !note.trim()}
          onPress={() => { const a = noteFor!; setNoteFor(null); run(a.to, () => webAction(`bookings/${enc}/${a.endpoint}`, { ...a.body, note, notes: note })); }} />
      </Sheet>

      {/* Feedback + complete */}
      <Sheet open={feedbackOpen} onClose={() => setFeedbackOpen(false)} title="Guest feedback">
        <Row gap={S.md} style={{ justifyContent: 'center' }}>
          {[1, 2, 3, 4, 5].map(n => <Ionicons key={n} name={n <= rating ? 'star' : 'star-outline'} size={38} color={C.gold} onPress={() => setRating(n)} />)}
        </Row>
        <TextInput value={comment} onChangeText={setComment} multiline placeholder="What did the guest say?" placeholderTextColor={C.dim}
          style={{ color: C.text, minHeight: 110, backgroundColor: C.cardHi, borderRadius: R.md, padding: S.lg, fontSize: 16, textAlignVertical: 'top' }} />
        <Button title="Save feedback & complete" icon="checkmark-done" onPress={() => { setFeedbackOpen(false); run('feedback', () => webAction(`bookings/${enc}/feedback`, { rating: rating || null, comment })); }} />
      </Sheet>

      {/* Cancellation — reason, then the e-mailed code, like the web */}
      <Sheet open={!!cancel} onClose={() => setCancel(null)} title={`Cancel ${ref}`}>
        {cancel?.step === 'reason' && (
          <>
            <Card tone="red"><Text style={{ color: C.text }}>This sends a cancellation request to the Accounts team. Nothing is cancelled until they approve it.</Text></Card>
            <TextInput value={cancel.reason} onChangeText={v => setCancel(c => c && { ...c, reason: v })} multiline placeholder="Reason for cancellation" placeholderTextColor={C.dim}
              style={{ color: C.text, minHeight: 100, backgroundColor: C.cardHi, borderRadius: R.md, padding: S.lg, fontSize: 16, textAlignVertical: 'top' }} />
            <Button title="Send me a confirmation code" icon="mail" kind="danger" disabled={!cancel.reason.trim()} loading={busy === 'cancel'}
              onPress={async () => {
                setBusy('cancel');
                try {
                  const r = await web<{ verificationId: string; maskedEmail: string }>('verification/request', { body: { action: 'BOOKING_CANCEL', bookingRef: ref } });
                  setCancel(c => c && { ...c, step: 'code', verificationId: r.verificationId, mask: r.maskedEmail });
                } catch (e) { Alert.alert('Could not send the code', (e as Error).message); }
                finally { setBusy(null); }
              }} />
          </>
        )}
        {cancel?.step === 'code' && (
          <>
            <P>Enter the 6-digit code sent to {cancel.mask}.</P>
            <TextInput value={cancel.code} onChangeText={v => setCancel(c => c && { ...c, code: v.replace(/\D/g, '').slice(0, 6) })} keyboardType="number-pad" maxLength={6}
              style={{ color: C.text, fontSize: 32, letterSpacing: 12, textAlign: 'center', backgroundColor: C.cardHi, borderRadius: R.md, paddingVertical: 14, fontWeight: '800' }} />
            <Button title="Confirm cancellation request" kind="danger" disabled={cancel.code.length !== 6} loading={busy === 'cancel'}
              onPress={() => { const c = cancel; setCancel(null); run('cancel', () => webAction(`bookings/${enc}/cancel`, { reason: c.reason, fees: [], verificationId: c.verificationId, verificationCode: c.code })); }} />
          </>
        )}
      </Sheet>

      {/* Movement WhatsApp brief */}
      <Sheet open={!!brief} onClose={() => setBrief(null)} title={`WhatsApp brief · ${brief?.title ?? ''}`}>
        {brief && brief.recipients.length === 0 && <P>No driver, guide or vendor with a phone on this movement.</P>}
        {brief?.recipients.map((r, n) => {
          const on = brief.chosen.has(n);
          return (
            <Pressable key={n} onPress={() => setBrief(s => { if (!s) return s; const c = new Set(s.chosen); c.has(n) ? c.delete(n) : c.add(n); return { ...s, chosen: c }; })}>
              <Card tone={on ? 'green' : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? C.green : C.dim} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>{r.name ?? r.label ?? 'Recipient'}</Text>
                  <Text style={{ color: C.sub }}>{[r.role, r.phone, r.source].filter(Boolean).join(' · ')}</Text>
                </View>
              </Card>
            </Pressable>
          );
        })}
        <TextInput value={brief?.note ?? ''} onChangeText={v => setBrief(s => s && { ...s, note: v })} placeholder="Short note (optional)" placeholderTextColor={C.dim}
          style={{ color: C.text, backgroundColor: C.cardHi, borderRadius: R.md, padding: S.lg, fontSize: 16 }} />
        {!!brief?.history.length && <Text style={{ color: C.dim, fontSize: 12 }}>Already sent {brief.history.length} time(s).</Text>}
        <Button title="Send brief" icon="logo-whatsapp" disabled={!brief?.chosen.size}
          onPress={() => {
            const s = brief!; setBrief(null);
            run('brief', () => webAction(`bookings/${enc}/agenda/items/${s.itemId}/whatsapp`, { recipients: Array.from(s.chosen).map(i => ({ role: s.recipients[i].role, name: s.recipients[i].name, phone: s.recipients[i].phone })), note: s.note || undefined }));
          }} />
      </Sheet>
    </SafeAreaView>
  );
}
