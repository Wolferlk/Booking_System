'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  Plane, LogIn, LogOut, Users, Globe2, TrendingUp, RefreshCw,
  Calendar, MapPin, Mail,
  AlertCircle, CheckCircle, Loader2,
  ArrowRight, FileSpreadsheet, X, ChevronRight,
} from 'lucide-react'
import type { ProcessedEmail } from '@/lib/mail-processor'
import { CountryFlag } from '@/components/ui/country-flag'

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
*{box-sizing:border-box}
@keyframes floatY   { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-18px)} }
@keyframes drift    { 0%{transform:translateX(0)translateY(0)} 100%{transform:translateX(50px)translateY(-35px)} }
@keyframes ticker   { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
@keyframes glowRing { 0%,100%{box-shadow:0 0 10px 2px rgba(234,179,8,.2)} 50%{box-shadow:0 0 30px 8px rgba(234,179,8,.55)} }
@keyframes slideUp  { from{opacity:0;transform:translateY(28px)} to{opacity:1;transform:translateY(0)} }
@keyframes slideLeft{ from{opacity:0;transform:translateX(40px)} to{opacity:1;transform:translateX(0)} }
@keyframes slideRight{from{opacity:0;transform:translateX(-40px)} to{opacity:1;transform:translateX(0)} }
@keyframes countUp  { from{opacity:0;transform:scale(.75)} to{opacity:1;transform:scale(1)} }
@keyframes scanBar  { 0%{top:-3px} 100%{top:100%} }
@keyframes scanWipe { 0%{left:-4px;opacity:1} 100%{left:100%;opacity:0} }
@keyframes pulse2   { 0%,100%{opacity:.6} 50%{opacity:1} }
@keyframes borderP  { 0%,100%{border-color:rgba(234,179,8,.2)} 50%{border-color:rgba(234,179,8,.7)} }
@keyframes notifIn  { 0%{opacity:0;backdrop-filter:blur(0px);transform:scale(1.04)} 100%{opacity:1;backdrop-filter:blur(12px);transform:scale(1)} }
@keyframes notifCard{ 0%{opacity:0;transform:translateY(-32px) scale(.93)} 100%{opacity:1;transform:translateY(0) scale(1)} }
@keyframes mailBounce{0%,100%{transform:scale(1) rotate(0deg)} 20%{transform:scale(1.15) rotate(-8deg)} 40%{transform:scale(1.12) rotate(8deg)} 60%{transform:scale(1.08) rotate(-5deg)} }
@keyframes progressBar{ from{width:100%} to{width:0%} }
@keyframes glitch1  { 0%,92%,100%{transform:none;filter:none} 93%{transform:skewX(-4deg);filter:hue-rotate(90deg)} 95%{transform:skewX(4deg)} 97%{transform:skewX(-2deg);filter:hue-rotate(0deg)} }
@keyframes screenOut{ 0%{opacity:1;transform:scale(1)} 100%{opacity:0;transform:scale(.97)} }
@keyframes screenIn { 0%{opacity:0;transform:scale(1.02)} 100%{opacity:1;transform:scale(1)} }
@keyframes timerRing{ from{stroke-dashoffset:0} to{stroke-dashoffset:126} }
.anim-float  { animation:floatY 7s ease-in-out infinite }
.anim-drift  { animation:drift 20s ease-in-out infinite alternate }
.anim-ticker { animation:ticker 40s linear infinite }
.anim-glow   { animation:glowRing 3s ease-in-out infinite }
.anim-up     { animation:slideUp .45s ease-out both }
.anim-left   { animation:slideLeft .45s ease-out both }
.anim-right  { animation:slideRight .45s ease-out both }
.anim-count  { animation:countUp .7s cubic-bezier(.34,1.56,.64,1) both }
.anim-glitch { animation:glitch1 8s infinite }
.anim-borderP{ animation:borderP 2.5s ease-in-out infinite }
.scanbar{position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,rgba(99,102,241,.6),transparent);pointer-events:none;animation:scanBar 4s linear infinite}
.screen-out  { animation:screenOut .5s ease-in forwards }
.screen-in   { animation:screenIn .5s ease-out both }
`

// ── Constants ─────────────────────────────────────────────────────────────────
const SCREEN_INTERVAL  = 30      // seconds per screen
const DATA_INTERVAL_MS = 30_000  // 30s data refresh
const MAIL_POLL_MS     = 120_000 // 2-min poll — only to detect NEW arrivals, no reprocessing
const NOTIF_DURATION   = 10      // seconds notification stays visible

// ── Types ─────────────────────────────────────────────────────────────────────
interface OverviewData {
  today:{ checkIns:number; checkOuts:number; flights:number; arrivals:number; totalPax:number }
  todayFlights:{
    id:string; flightNo:string; date:string; fromApt:string; toApt:string
    depTime:string; arrTime:string; airline:string|null
    booking:{ bookingRef:string; agent:string|null; paxAdults:number; paxChildren:number; operationCountry:string|null; status:string }
  }[]
  lifetime:{ total:number; byCountry:Record<string,number>; byStatus:Record<string,number> }
  recentBookings:{
    bookingRef:string; agent:string|null; arrivalDate:string; status:string
    operationCountry:string|null; paxAdults:number; paxChildren:number
  }[]
}
interface EmailWithMailbox extends ProcessedEmail { mailboxKind:'TOUR_CONFIRMATION'|'PNL'; mailboxUser:string }
interface ProcessResult {
  bookingRef:string; bookingId:string; isNew:boolean; pnlLines:number; agendaItems:number
  status:string; xlsxUsed?:boolean; processedAt?:string|null; bookingCreatedAt?:string|null
  extracted?:{
    agent:string|null; fileHandler:string|null; arrivalDate:string|null; departureDate:string|null
    paxAdults:number; paxChildren:number; quotedTotal:number|null; currency:string
    passengers:{name:string;type:string;isLead:boolean}[]
    flights:{flightNo:string;date:string;fromApt:string;toApt:string;depTime?:string;arrTime?:string}[]
    accommodations:{hotel:string;city:string;checkIn:string;checkOut:string;nights:number;mealType?:string}[]
    emergencyContacts:{name:string;phone?:string;role?:string}[]
    pnlLines:{activity:string;category:string;mmtRate:number;sicRate:number;pvtRatePP:number;adEntrance:number;chEntrance:number}[]
  }
}

const COUNTRY_META:Record<string,{label:string;bar:string;glow:string;border:string;grad:string}> = {
  VIETNAM:            {label:'Vietnam',       bar:'bg-red-500',    glow:'text-red-400',    border:'border-red-500/25',  grad:'from-red-600/15'},
  SRILANKA:           {label:'Sri Lanka',     bar:'bg-yellow-500', glow:'text-yellow-400', border:'border-yellow-500/25',grad:'from-yellow-600/15'},
  SINGAPORE_MALAYSIA: {label:'SG & Malaysia', bar:'bg-blue-500',   glow:'text-blue-400',   border:'border-blue-500/25',  grad:'from-blue-600/15'},
}
const STATUS_DOT:Record<string,string> = {
  DRAFT:'bg-slate-400',SUBMITTED:'bg-blue-400',GT_REVIEW:'bg-orange-400',
  GT_VERIFIED:'bg-teal-400',CHANGE_REQUESTED:'bg-yellow-400',OPERATIONS_READY:'bg-emerald-400',
  CLIENT_LIVE:'bg-cyan-400',IN_PROGRESS:'bg-purple-400',COMPLETED:'bg-green-500',
  CANCELLED:'bg-red-500',AWAITING_PAYMENT_CONFIRM:'bg-pink-400',
}
function fmt(d?:string|null){if(!d)return'—';try{return new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short'})}catch{return d}}
function fmtTs(d?:string|null){if(!d)return null;try{return new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}catch{return null}}
function sl(s:string){return s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({target,dur=1400}:{target:number;dur?:number}){
  const [v,setV]=useState(0)
  useEffect(()=>{
    const t0=performance.now()
    const run=(now:number)=>{
      const p=Math.min((now-t0)/dur,1)
      setV(Math.round(p*target))
      if(p<1)requestAnimationFrame(run)
    }
    requestAnimationFrame(run)
  },[target,dur])
  return <>{v.toLocaleString()}</>
}

// ── Background ────────────────────────────────────────────────────────────────
function Background(){
  return(
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {[[300,300,'-5%','8%','rgba(234,179,8,.035)',80,22],[500,500,'15%','-5%','rgba(99,102,241,.04)',110,30],[350,350,'55%','75%','rgba(16,185,129,.03)',90,26],[250,250,'70%','5%','rgba(239,68,68,.03)',70,18]].map(([w,h,top,left,c,b,d],i)=>(
      <div key={i} className="absolute rounded-full anim-drift" style={{width:w,height:h,top:top as string,left:left as string,background:c as string,filter:`blur(${b}px)`,animationDuration:`${d}s`,animationDelay:`${i*4}s`}}/>
    ))}
      <div className="absolute inset-0 opacity-[.02]" style={{backgroundImage:'linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px)',backgroundSize:'55px 55px'}}/>
      <div className="absolute inset-0" style={{background:'radial-gradient(ellipse 80% 50% at 50% 0%,rgba(234,179,8,.04) 0%,transparent 70%)'}}/>
    </div>
  )
}

// ── Ticker ────────────────────────────────────────────────────────────────────
function Ticker({data}:{data:OverviewData|null}){
  const items:React.ReactNode[]=data?[
    `🟢 ${data.lifetime.total.toLocaleString()} TOTAL BOOKINGS`,
    `✈️ ${data.today.flights} FLIGHTS TODAY`,
    `🛬 ${data.today.checkIns} CHECK-INS`,
    `🛫 ${data.today.checkOuts} DEPARTURES`,
    `👥 ${data.today.totalPax} PAX ARRIVING`,
    <span key="vn" className="inline-flex items-center gap-1"><CountryFlag country="VIETNAM" className="w-3.5 h-2.5" />VIETNAM {(data.lifetime.byCountry.VIETNAM??0).toLocaleString()}</span>,
    <span key="lk" className="inline-flex items-center gap-1"><CountryFlag country="SRILANKA" className="w-3.5 h-2.5" />SRI LANKA {(data.lifetime.byCountry.SRILANKA??0).toLocaleString()}</span>,
    <span key="sg" className="inline-flex items-center gap-1"><CountryFlag country="SINGAPORE_MALAYSIA" className="w-3.5 h-2.5" />SG & MY {(data.lifetime.byCountry.SINGAPORE_MALAYSIA??0).toLocaleString()}</span>,
    `📊 ${(data.lifetime.byStatus.OPERATIONS_READY??0)+(data.lifetime.byStatus.CLIENT_LIVE??0)} LIVE OPS`,
  ]:['● LOADING LIVE OPERATIONS DATA…']
  const doubled=[...items,...items]
  return(
    <div className="relative border-b border-brand-500/12 bg-brand-500/4 overflow-hidden h-7 flex items-center">
      <div className="absolute left-0 w-20 z-10 h-full bg-gradient-to-r from-[#030711] to-transparent"/>
      <div className="absolute right-0 w-20 z-10 h-full bg-gradient-to-l from-[#030711] to-transparent"/>
      <div className="anim-ticker flex items-center whitespace-nowrap">
        {doubled.map((t,i)=>(
          <span key={i} className="text-[10px] text-brand-400/70 font-bold tracking-[.2em] px-10 inline-flex items-center gap-1">{t}</span>
        ))}
      </div>
    </div>
  )
}

// ── Screen transition overlay ─────────────────────────────────────────────────
function TransitionOverlay({nextScreen}:{nextScreen:number}){
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{animation:'notifIn .3s ease-out both',background:'rgba(3,7,17,.85)',backdropFilter:'blur(6px)'}}>
      <div className="text-center space-y-6">
        <div className="relative w-20 h-20 mx-auto">
          <svg viewBox="0 0 44 44" className="w-20 h-20 -rotate-90">
            <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(234,179,8,.15)" strokeWidth="2"/>
            <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(234,179,8,.8)" strokeWidth="2"
              strokeDasharray="126" strokeDashoffset="126"
              style={{animation:'timerRing .5s ease-out forwards',animationFillMode:'forwards'}}/>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <RefreshCw className="w-7 h-7 text-brand-400 animate-spin"/>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-slate-500 uppercase tracking-[.4em] mb-2">Switching to</p>
          <p className="text-3xl font-black text-white tracking-tight">SCREEN 0{nextScreen+1}</p>
          <p className="text-[10px] text-slate-600 uppercase tracking-widest mt-2">
            {nextScreen===0?'OPERATIONS OVERVIEW':'FLIGHTS & BOOKINGS'}
          </p>
        </div>
        {/* Scan wipe */}
        <div className="absolute inset-x-0 h-0.5 bg-brand-500/40" style={{animation:'scanWipe .4s ease-in .1s both',top:'50%'}}/>
      </div>
    </div>
  )
}

// ── Full-screen email notification ────────────────────────────────────────────
function EmailNotification({email,result,onDismiss}:{
  email:EmailWithMailbox
  result?:{success:boolean;data?:ProcessResult;error?:string}
  onDismiss:()=>void
}){
  const [countdown,setCountdown]=useState(NOTIF_DURATION)
  useEffect(()=>{
    const id=setInterval(()=>setCountdown(c=>{if(c<=1){onDismiss();return 0}return c-1}),1000)
    return()=>clearInterval(id)
  },[onDismiss])
  const isPnl=email.mailboxKind==='PNL'
  const ref=result?.data?.bookingRef
  const isNew=result?.data?.isNew
  const pct=((countdown/NOTIF_DURATION)*100).toFixed(1)

  return(
    <div className="fixed inset-0 z-[100] flex items-center justify-center" onClick={onDismiss}
      style={{animation:'notifIn .4s ease-out both',background:'rgba(1,3,10,.88)',backdropFilter:'blur(16px)'}}>
      {/* Ambient rings */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {[240,360,480,600].map((s,i)=>(
          <div key={i} className="absolute rounded-full border border-brand-500/10" style={{width:s,height:s,animation:`pulse2 ${2+i*.5}s ease-in-out infinite`,animationDelay:`${i*.3}s`}}/>
        ))}
      </div>

      <div className="relative max-w-xl w-full mx-6" onClick={e=>e.stopPropagation()}
        style={{animation:'notifCard .5s cubic-bezier(.34,1.56,.64,1) both'}}>

        {/* Card */}
        <div className={`relative rounded-3xl border-2 overflow-hidden ${isPnl?'border-teal-500/50':'border-brand-500/50'}`}
          style={{background:'linear-gradient(135deg,rgba(3,7,17,.98) 0%,rgba(10,16,30,.98) 100%)',boxShadow:isPnl?'0 0 60px 0 rgba(20,184,166,.25)':'0 0 60px 0 rgba(234,179,8,.25)',animation:'glowRing 2s ease-in-out infinite'}}>

          {/* Top strip */}
          <div className={`px-6 py-3 flex items-center gap-3 border-b ${isPnl?'border-teal-500/20 bg-teal-500/8':'border-brand-500/20 bg-brand-500/8'}`}>
            <span className={`w-2 h-2 rounded-full animate-pulse ${isPnl?'bg-teal-400':'bg-brand-400'}`}/>
            <span className={`text-[10px] font-black uppercase tracking-[.35em] ${isPnl?'text-teal-400':'text-brand-400'}`}>
              {isPnl?'P&L EMAIL RECEIVED':'TRAVEL QUOTATION RECEIVED'}
            </span>
            <span className="ml-auto text-[10px] text-slate-500">{new Date(email.date).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
            <button onClick={onDismiss} className="text-slate-600 hover:text-slate-300 transition-colors"><X className="w-4 h-4"/></button>
          </div>

          <div className="p-8">
            {/* Icon */}
            <div className="flex items-start gap-6">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 ${isPnl?'bg-teal-500/12 border border-teal-500/30':'bg-brand-500/12 border border-brand-500/30'}`}
                style={{animation:'mailBounce 2s ease-in-out infinite'}}>
                <Mail className={`w-8 h-8 ${isPnl?'text-teal-400':'text-brand-400'}`}/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mb-2">Subject</p>
                <p className="text-xl font-black text-white leading-tight mb-3">{email.subject||'(no subject)'}</p>
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <span>From:</span>
                  <span className="font-semibold text-slate-200">{email.fromName||email.from}</span>
                </div>
                {email.fromName&&<p className="text-xs font-mono text-slate-600 mt-0.5">{email.from}</p>}
              </div>
            </div>

            {/* Processing status */}
            <div className="mt-6 space-y-3">
              {!result&&(
                <div className="flex items-center gap-3 p-4 rounded-xl bg-purple-500/8 border border-purple-500/20">
                  <Loader2 className="w-5 h-5 text-purple-400 animate-spin shrink-0"/>
                  <div>
                    <p className="text-sm font-bold text-purple-300">{isPnl?'Matching PNL to Tour Reference…':'Extracting booking data via GPT-4o…'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Automated processing in progress</p>
                  </div>
                </div>
              )}
              {result?.success&&ref&&(
                <div className={`flex items-center gap-3 p-4 rounded-xl ${isNew?'bg-brand-500/8 border border-brand-500/20':'bg-emerald-500/8 border border-emerald-500/20'}`}>
                  <CheckCircle className={`w-5 h-5 shrink-0 ${isNew?'text-brand-400':'text-emerald-400'}`}/>
                  <div>
                    <p className={`text-sm font-bold ${isNew?'text-brand-300':'text-emerald-300'}`}>
                      {isPnl?`PNL merged → `:`${isNew?'New booking created':'Booking updated'} → `}
                      <span className="font-mono text-white">{ref}</span>
                    </p>
                    {result.data?.agendaItems?<p className="text-xs text-slate-400 mt-0.5">{result.data.agendaItems} agenda items generated</p>:null}
                    {isPnl&&result.data?.pnlLines?<p className="text-xs text-slate-400 mt-0.5">{result.data.pnlLines} PNL lines imported</p>:null}
                  </div>
                </div>
              )}
              {result?.error&&(
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/8 border border-red-500/20">
                  <AlertCircle className="w-5 h-5 text-red-400 shrink-0"/>
                  <p className="text-sm text-red-300">{result.error}</p>
                </div>
              )}
              {email.hasAttachments&&(
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-teal-500"/>{isPnl?'XLSX attachment detected — parsing rates directly':'Attachment included'}
                </div>
              )}
            </div>
          </div>

          {/* Auto-dismiss bar */}
          <div className="px-8 pb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-600 uppercase tracking-widest">Auto-dismiss in {countdown}s</span>
              <button onClick={onDismiss} className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-wider">Dismiss now</button>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-none ${isPnl?'bg-teal-500':'bg-brand-500'}`} style={{width:`${pct}%`,transition:`width 1s linear`}}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Screen 1: Stats Overview ──────────────────────────────────────────────────
function StatsScreen({data,loading}:{data:OverviewData|null;loading:boolean}){
  const total=data?.lifetime.total??0
  const countryTotal=['VIETNAM','SRILANKA','SINGAPORE_MALAYSIA'].reduce((s,k)=>s+(data?.lifetime.byCountry[k]??0),0)||1
  return(
    <div className="space-y-8">
      {/* Hero + stat cards */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Big counter */}
        <div className="lg:col-span-2 relative rounded-3xl border-2 border-brand-500/20 bg-gradient-to-br from-brand-500/8 via-transparent to-transparent p-8 overflow-hidden anim-up anim-borderP">
          <div className="scanbar"/>
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-brand-500/5 blur-3xl"/>
          <div className="flex items-center gap-2 mb-8">
            <Globe2 className="w-4 h-4 text-brand-500"/>
            <span className="text-[9px] text-brand-400/60 font-black uppercase tracking-[.35em]">All Countries · All Time</span>
          </div>
          <div className="anim-count">
            <p className="text-[88px] sm:text-[112px] font-black text-white leading-none tabular-nums">
              {loading?<span className="text-slate-800">…</span>:<Counter target={total} dur={1600}/>}
            </p>
          </div>
          <p className="text-slate-400 text-xl mt-2">Total Bookings</p>
          <div className="mt-8 grid grid-cols-3 gap-3 pt-6 border-t border-white/5">
            {['COMPLETED','IN_PROGRESS','CANCELLED'].map(s=>(
              <div key={s} className="text-center">
                <p className="text-2xl font-black text-white tabular-nums">{loading?'…':(data?.lifetime.byStatus[s]??0)}</p>
                <p className="text-[9px] text-slate-600 uppercase tracking-wider mt-1">{sl(s)}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 6 today cards */}
        <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            {icon:<LogIn className="w-5 h-5"/>,label:'CHECK-INS',value:data?.today.checkIns??0,sub:'Arrivals today',c:'text-emerald-400',border:'border-emerald-500/20',d:0},
            {icon:<LogOut className="w-5 h-5"/>,label:'CHECK-OUTS',value:data?.today.checkOuts??0,sub:'Departures today',c:'text-sky-400',border:'border-sky-500/20',d:60},
            {icon:<MapPin className="w-5 h-5"/>,label:'ARRIVALS',value:data?.today.arrivals??0,sub:'Guests arriving',c:'text-purple-400',border:'border-purple-500/20',d:120},
            {icon:<Users className="w-5 h-5"/>,label:'TOTAL PAX',value:data?.today.totalPax??0,sub:'Across arrivals',c:'text-amber-400',border:'border-amber-500/20',d:180},
            {icon:<Plane className="w-5 h-5"/>,label:"TODAY'S FLIGHTS",value:data?.today.flights??0,sub:'Scheduled',c:'text-brand-400',border:'border-brand-500/20',d:240},
            {icon:<TrendingUp className="w-5 h-5"/>,label:'LIVE OPS',value:(data?.lifetime.byStatus?.OPERATIONS_READY??0)+(data?.lifetime.byStatus?.CLIENT_LIVE??0)+(data?.lifetime.byStatus?.IN_PROGRESS??0),sub:'Active bookings',c:'text-rose-400',border:'border-rose-500/20',d:300},
          ].map(s=>(
            <div key={s.label} className={`relative rounded-2xl border ${s.border} bg-slate-950/60 p-5 overflow-hidden anim-up`} style={{animationDelay:`${s.d}ms`}}>
              <div className="scanbar"/>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 bg-white/4 ${s.c}`}>{s.icon}</div>
              <p className="text-[9px] text-slate-500 uppercase tracking-[.2em] font-black mb-1">{s.label}</p>
              <p className={`text-4xl font-black text-white tabular-nums anim-count`} style={{animationDelay:`${s.d+200}ms`}}>
                {loading?'…':<Counter target={s.value}/>}
              </p>
              <p className="text-slate-600 text-[11px] mt-2">{s.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Country breakdown */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-5 h-px bg-brand-500/40"/>
          <span className="text-[9px] text-brand-400/60 font-black uppercase tracking-[.35em]">Bookings by Country</span>
          <div className="flex-1 h-px bg-white/4"/>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {(['VIETNAM','SRILANKA','SINGAPORE_MALAYSIA'] as const).map((k,i)=>{
            const m=COUNTRY_META[k]; const count=data?.lifetime.byCountry[k]??0
            const pct=Math.round((count/countryTotal)*100)
            return(
              <div key={k} className={`relative rounded-2xl border ${m.border} bg-gradient-to-br ${m.grad} bg-slate-950/70 p-6 overflow-hidden anim-left`} style={{animationDelay:`${i*80}ms`}}>
                <div className="scanbar"/>
                <div className="flex items-start justify-between mb-5">
                  <span className="anim-float" style={{animationDelay:`${i*900}ms`}}><CountryFlag country={k} className="w-12 h-8" /></span>
                  <span className="text-[10px] text-slate-500 font-black">{pct}%</span>
                </div>
                <p className={`text-5xl font-black text-white tabular-nums anim-count`} style={{animationDelay:`${i*100+200}ms`}}>
                  {loading?'…':<Counter target={count}/>}
                </p>
                <p className={`text-sm mt-1 mb-4 ${m.glow}`}>{m.label}</p>
                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${m.bar}`} style={{width:loading?'0%':`${pct}%`,transition:'width 1.2s cubic-bezier(.4,0,.2,1)'}}/>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Screen 2: Flights & Bookings ──────────────────────────────────────────────
function OpsScreen({data,loading,onNavigate}:{data:OverviewData|null;loading:boolean;onNavigate:(ref:string)=>void}){
  return(
    <div className="space-y-8">
      {/* Flights */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-5 h-px bg-sky-500/40"/>
          <span className="text-[9px] text-sky-400/60 font-black uppercase tracking-[.35em]">Today&apos;s Flight Operations</span>
          <span className="text-[10px] text-slate-600">{data?.todayFlights.length??0} movements</span>
          <div className="flex-1 h-px bg-white/4"/>
        </div>
        {loading?(
          <div className="h-48 rounded-2xl border border-white/5 bg-slate-950/50 flex items-center justify-center gap-3 text-slate-600">
            <Loader2 className="w-5 h-5 animate-spin"/><span className="text-sm">Loading flight data…</span>
          </div>
        ):!data?.todayFlights.length?(
          <div className="h-48 rounded-2xl border border-white/5 bg-slate-950/50 flex flex-col items-center justify-center gap-3 text-slate-700">
            <Plane className="w-10 h-10 opacity-20"/><p className="text-sm">No flights scheduled today</p>
          </div>
        ):(
          <div className="rounded-2xl border border-white/6 bg-slate-950/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-white/5">
                {['Flight','Route','Dep','Arr','Booking','Agent','Pax','Country','Status'].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-[9px] uppercase tracking-[.2em] text-slate-600 font-black">{h}</th>
                ))}
              </tr></thead>
              <tbody className="divide-y divide-white/4">
                {data.todayFlights.map((f,i)=>{
                  const cm=f.booking.operationCountry?COUNTRY_META[f.booking.operationCountry]:null
                  return(
                    <tr key={f.id} className="hover:bg-white/2 transition-colors anim-up" style={{animationDelay:`${i*35}ms`}}>
                      <td className="px-4 py-3"><div className="flex items-center gap-2"><Plane className="w-3.5 h-3.5 text-sky-400 shrink-0"/><span className="font-mono font-black text-white text-xs">{f.flightNo}</span></div>{f.airline&&<p className="text-[10px] text-slate-600 ml-5">{f.airline}</p>}</td>
                      <td className="px-4 py-3 font-mono text-xs"><span className="text-slate-300">{f.fromApt}</span><span className="text-slate-700 mx-1">→</span><span className="text-slate-300">{f.toApt}</span></td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{f.depTime}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">{f.arrTime}</td>
                      <td className="px-4 py-3"><button onClick={()=>onNavigate(f.booking.bookingRef)} className="font-mono text-brand-400 text-xs font-black hover:text-brand-300 transition-colors">{f.booking.bookingRef}</button></td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-[140px] truncate">{f.booking.agent??'—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{f.booking.paxAdults}A{f.booking.paxChildren>0?` ${f.booking.paxChildren}C`:''}</td>
                      <td className="px-4 py-3 text-xs">{cm&&<span className={`inline-flex items-center gap-1 ${cm.glow}`}><CountryFlag country={f.booking.operationCountry} className="w-4 h-3" />{cm.label}</span>}</td>
                      <td className="px-4 py-3"><span className="flex items-center gap-1.5 text-xs text-slate-500"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[f.booking.status]??'bg-slate-600'}`}/>{sl(f.booking.status)}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent bookings */}
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-5 h-px bg-purple-500/40"/>
          <span className="text-[9px] text-purple-400/60 font-black uppercase tracking-[.35em]">Recent Bookings</span>
          <div className="flex-1 h-px bg-white/4"/>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
          {loading?Array.from({length:8}).map((_,i)=>(
            <div key={i} className="rounded-xl border border-white/4 bg-slate-950/50 h-28 animate-pulse"/>
          )):(data?.recentBookings??[]).map((b,i)=>{
            const cm=b.operationCountry?COUNTRY_META[b.operationCountry]:null
            return(
              <button key={b.bookingRef} onClick={()=>onNavigate(b.bookingRef)}
                className="rounded-xl border border-white/6 bg-slate-950/50 p-4 text-left hover:bg-white/2 hover:border-brand-500/25 transition-all anim-up"
                style={{animationDelay:`${i*30}ms`}}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-brand-400 text-xs font-black">{b.bookingRef}</span>
                  {cm&&<CountryFlag country={b.operationCountry} className="w-5 h-4" />}
                </div>
                <p className="text-slate-300 text-xs truncate">{b.agent??'—'}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="flex items-center gap-1 text-[10px] text-slate-600"><Calendar className="w-2.5 h-2.5"/>{fmt(b.arrivalDate)}</span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-500"><span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[b.status]??'bg-slate-600'}`}/>{sl(b.status)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
// LiveMailPanel removed — mail processing is now handled entirely by the backend.
// The overview only shows a notification overlay when the backend processes a new email.

// ── Main ──────────────────────────────────────────────────────────────────────
export default function OverviewPage(){
  const router=useRouter()
  const [data,setData]           = useState<OverviewData|null>(null)
  const [loading,setLoading]     = useState(true)
  const [screen,setScreen]       = useState(0)          // 0=stats, 1=ops, 2=mail
  const [transitioning,setTrans] = useState(false)
  const [nextScreen,setNext]     = useState(1)
  const [countdown,setCountdown] = useState(SCREEN_INTERVAL)
  const [mailOpen,setMailOpen]   = useState(false)
  const [emailNotif,setEmailNotif]=useState<{email:EmailWithMailbox;result?:{success:boolean;data?:ProcessResult;error?:string}}|null>(null)
  const [notifQueue,setNotifQueue]=useState<{email:EmailWithMailbox;result?:{success:boolean;data?:ProcessResult;error?:string}}[]>([])
  const screenRef = useRef(screen)
  useEffect(()=>{screenRef.current=screen},[screen])

  const load=useCallback(async()=>{
    try{const res=await fetch('/api/overview');const j=await res.json();if(j.data)setData(j.data)}catch{}finally{setLoading(false)}
  },[])

  // Data refresh
  useEffect(()=>{load();const id=setInterval(load,DATA_INTERVAL_MS);return()=>clearInterval(id)},[load])

  // Screen rotation: 3 screens (0=stats, 1=ops, 2=mail)
  const SCREEN_COUNT=3
  useEffect(()=>{
    const tick=setInterval(()=>{
      const next=(screenRef.current+1)%SCREEN_COUNT
      setNext(next); setTrans(true)
      setTimeout(()=>{setScreen(next);setTrans(false);setCountdown(SCREEN_INTERVAL)},600)
    },SCREEN_INTERVAL*1000)
    const cd=setInterval(()=>setCountdown(c=>c>1?c-1:SCREEN_INTERVAL),1000)
    return()=>{clearInterval(tick);clearInterval(cd)}
  },[])

  // Handle new emails
  const handleNewEmail=useCallback((email:EmailWithMailbox,result?:{success:boolean;data?:ProcessResult;error?:string})=>{
    setNotifQueue(q=>[...q,{email,result}])
  },[])

  // Show notifications one at a time from queue
  useEffect(()=>{
    if(!emailNotif&&notifQueue.length>0){
      setEmailNotif(notifQueue[0])
      setNotifQueue(q=>q.slice(1))
    }
  },[emailNotif,notifQueue])

  const dismissNotif=useCallback(()=>setEmailNotif(null),[])

  const screenLabels=['OPERATIONS OVERVIEW','FLIGHTS & BOOKINGS','LIVE MAIL PIPELINE']
  const today=new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})

  return(
    <>
      <style>{CSS}</style>
      <div className="min-h-screen bg-[#030711] text-white font-sans anim-glitch">
        <Background/>

        {/* Email notification */}
        {emailNotif&&<EmailNotification email={emailNotif.email} result={emailNotif.result} onDismiss={dismissNotif}/>}

        {/* Screen transition */}
        {transitioning&&<TransitionOverlay nextScreen={nextScreen}/>}

        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="relative z-20 border-b border-white/5 bg-[#030711]/90 backdrop-blur-xl sticky top-0">
          <div className="max-w-[1400px] mx-auto px-6 py-3.5 flex items-center justify-between">
            <button onClick={()=>router.push('/')} className="flex items-center gap-3 hover:opacity-80 transition-opacity group">
              <div className="relative w-8 h-8 rounded-lg overflow-hidden anim-glow">
                <Image src="/png/aahaslogo.png" alt="Aahas" fill className="object-contain"/>
              </div>
              <div className="border-l border-white/8 pl-3 flex items-center gap-2">
                <div className="relative h-5 w-14 opacity-50 group-hover:opacity-70 transition-opacity"><Image src="/png/aahaas.png" alt="Aahaas" fill className="object-contain"/></div>
              </div>
              <div className="border-l border-white/6 pl-3 hidden sm:block">
                <p className="text-white text-xs font-black tracking-tight leading-none">GLOBAL COMMAND CENTER</p>
                <p className="text-brand-500/50 text-[9px] tracking-[.2em] uppercase mt-0.5">All Operations · Live</p>
              </div>
            </button>

            {/* Screen indicator */}
            <div className="flex items-center gap-4">
              <div className="hidden md:flex items-center gap-3">
                {Array.from({length:SCREEN_COUNT}).map((_,i)=>(
                  <button key={i} onClick={()=>{if(!transitioning){setNext(i);setTrans(true);setTimeout(()=>{setScreen(i);setTrans(false);setCountdown(SCREEN_INTERVAL)},600)}}}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-all text-[10px] font-black uppercase tracking-wider ${screen===i?'border-brand-500/40 bg-brand-500/12 text-brand-400':'border-white/5 text-slate-600 hover:border-white/10 hover:text-slate-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${screen===i?'bg-brand-400 animate-pulse':'bg-slate-700'}`}/>
                    {['Stats','Flights','Mail'][i]}
                  </button>
                ))}
              </div>
              {/* Countdown ring */}
              <div className="relative w-10 h-10" title={`Next screen in ${countdown}s`}>
                <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                  <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="2"/>
                  <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(234,179,8,.5)" strokeWidth="2"
                    strokeDasharray="94" strokeDashoffset={94-(94*(countdown/SCREEN_INTERVAL))} style={{transition:'stroke-dashoffset 1s linear'}}/>
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[10px] font-black text-brand-400">{countdown}</span>
                </div>
              </div>
              <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-slate-600">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"/>
                {today}
              </div>
            </div>
          </div>
        </header>

        {/* ── Ticker ──────────────────────────────────────────────── */}
        <div className="relative z-10"><Ticker data={data}/></div>

        {/* ── Screen label bar ────────────────────────────────────── */}
        <div className="relative z-10 border-b border-white/4 bg-[#030711]/60 px-6 py-2">
          <div className="max-w-[1400px] mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[8px] text-slate-700 font-black uppercase tracking-[.4em]">SCREEN 0{screen+1}/{SCREEN_COUNT}</span>
              <span className="text-[9px] text-slate-400 font-black uppercase tracking-[.25em]">{screenLabels[screen]}</span>
            </div>
            <div className="flex items-center gap-1">
              {Array.from({length:SCREEN_COUNT}).map((_,i)=>(
                <div key={i} className={`h-0.5 rounded-full transition-all ${screen===i?'w-8 bg-brand-400':'w-3 bg-slate-700'}`}/>
              ))}
            </div>
          </div>
        </div>

        {/* ── Main content area ───────────────────────────────────── */}
        <main className={`relative z-10 max-w-[1400px] mx-auto px-6 py-8 ${transitioning?'screen-out':'screen-in'}`}>

          {screen===0&&<StatsScreen data={data} loading={loading}/>}
          {screen===1&&<OpsScreen data={data} loading={loading} onNavigate={ref=>router.push(`/dashboard/bookings/${ref}`)}/>}
          {screen===2&&(
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-5 h-px bg-brand-500/40"/>
                <span className="text-[9px] text-brand-400/60 font-black uppercase tracking-[.35em]">Live Email Processing Pipeline</span>
                <span className="flex items-center gap-1.5 text-[9px] text-emerald-400 font-black"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>NEW ARRIVAL DETECTION</span>
                <div className="flex-1 h-px bg-white/4"/>
              </div>
            
            </div>
          )}

          
        </main>

        <footer className="relative z-10 border-t border-white/4 py-4 text-center text-slate-700 text-[9px] tracking-[.3em] uppercase mt-4">
          AppleHolidays · Global Command Center · Screen auto-rotates every {SCREEN_INTERVAL}s
        </footer>
      </div>
    </>
  )
}
