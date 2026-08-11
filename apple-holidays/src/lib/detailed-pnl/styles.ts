/**
 * Detailed P&L — the styles the sheet renders into.
 *
 * Ported from the Accounts app's `pnl/partials/detailed-pnl-styles.blade.php`,
 * scoped under `.dtp-root` so nothing here can reach the rest of the Booking
 * system's Tailwind pages. The Accounts version leans on that app's `--border`
 * / `--primary` / `--secondary` custom properties; they are declared on the
 * root here with the same values so the two sheets look identical.
 *
 * The Accounts sheet also draws Font Awesome glyphs in its section headers and
 * notes. This app carries no icon font, so the markup omits them and the header
 * chip is rendered as the section's colour swatch alone — the layout, columns
 * and every figure are unchanged.
 */
export const DETAILED_PNL_CSS = `
.dtp-root{
  --border:#e2e8f0;
  --primary:#0f172a;
  --secondary:#64748b;
  color:var(--primary);
  font-size:14px;
  line-height:1.45;
  text-align:left;
}
.dtp-root *{box-sizing:border-box;}
.dtp-root .dt-muted{color:var(--secondary);}
.dtp-root .dt-strong{font-weight:600;}
.dtp-root .profit-pos{color:#15803d;font-weight:800;}
.dtp-root .profit-neg{color:#be123c;font-weight:800;}
.dtp-root .profit-zero{color:#64748b;font-weight:700;}
.dtp-root .pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:.65rem;font-weight:700;
  background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;text-transform:capitalize;}

/* Wide tables scroll inside their own block rather than the page. */
.dtp-root .dt-scroll{overflow-x:auto;}

/* ===== header ===== */
.dtp-root .dt-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;
  background:linear-gradient(120deg,#0f172a,#312e81);color:#fff;border-radius:16px;padding:16px 18px;margin-bottom:16px;}
.dtp-root .dt-head .dt-id{font-size:1.25rem;font-weight:800;letter-spacing:-.4px;}
.dtp-root .dt-head .dt-meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px;}
.dtp-root .dt-head .dt-chip{display:inline-flex;align-items:center;gap:6px;font-size:.7rem;font-weight:700;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);padding:5px 10px;border-radius:999px;color:#e2e8f0;}
.dtp-root .dt-head .dt-grand{text-align:right;}
.dtp-root .dt-head .dt-grand .l{font-size:.62rem;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#c7d2fe;}
.dtp-root .dt-head .dt-grand .v{font-size:1.5rem;font-weight:800;letter-spacing:-.5px;}
.dtp-root .dt-head .dt-grand .p{display:inline-flex;align-items:center;gap:7px;margin-top:7px;padding:4px 10px;border-radius:999px;
  font-size:.68rem;font-weight:800;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);}
.dtp-root .dt-head .dt-grand .p.up{color:#86efac;}
.dtp-root .dt-head .dt-grand .p.down{color:#fca5a5;}

/* ===== cost composition ===== */
.dtp-root .dt-flow{border:1px solid var(--border);border-radius:16px;background:#fff;padding:14px 16px 12px;margin-bottom:18px;
  box-shadow:0 10px 26px -22px rgba(15,23,42,.5);}
.dtp-root .dt-flow .h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px;}
.dtp-root .dt-flow .h .t{font-size:.68rem;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#475569;}
.dtp-root .dt-flow .h .s{font-size:.66rem;color:var(--secondary);}
.dtp-root .dtf-bar{display:flex;gap:2px;height:15px;}
.dtp-root .dtf-seg{position:relative;min-width:3px;border-radius:2px;transition:transform .12s,filter .12s;}
.dtp-root .dtf-bar .dtf-seg:first-child{border-radius:4px 2px 2px 4px;}
.dtp-root .dtf-bar .dtf-seg:last-child{border-radius:2px 4px 4px 2px;}
.dtp-root .dtf-seg:hover{transform:translateY(-2px);filter:brightness(1.08);}
.dtp-root .dtf-legend{display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:11px;}
.dtp-root .dtf-item{display:flex;align-items:center;gap:7px;font-size:.72rem;}
.dtp-root .dtf-item .sw{width:10px;height:10px;border-radius:3px;flex:none;}
.dtp-root .dtf-item .nm{font-weight:700;color:var(--primary);}
.dtp-root .dtf-item .am{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--secondary);}
.dtp-root .dtf-item .pc{font-weight:800;color:#94a3b8;font-size:.66rem;}

/* ===== hotel row extras ===== */
.dtp-root .dt-idx{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:6px;
  background:#eef2ff;color:#4338ca;font-size:.62rem;font-weight:800;margin-right:7px;flex:none;}
.dtp-root .occ{display:inline-flex;align-items:center;gap:3px;flex-wrap:wrap;justify-content:flex-end;}
.dtp-root .occ .r{background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;border-radius:5px;padding:1px 5px;font-size:.68rem;font-weight:700;}
.dtp-root .occ .x{color:#94a3b8;font-size:.66rem;font-weight:800;}
.dtp-root .occ .n{color:var(--secondary);font-size:.68rem;font-weight:700;}
.dtp-root .occ.off .r{background:#f8fafc;border-color:#e2e8f0;color:#cbd5e1;}
.dtp-root .mp{display:inline-block;border-radius:6px;padding:2px 7px;font-size:.65rem;font-weight:800;letter-spacing:.3px;
  background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;}
.dtp-root .mp.bb{background:#fef3c7;color:#92400e;border-color:#fde68a;}
.dtp-root .mp.hb{background:#dbeafe;color:#1e40af;border-color:#bfdbfe;}
.dtp-root .mp.fb{background:#dcfce7;color:#166534;border-color:#bbf7d0;}
.dtp-root .mp.ai{background:#fae8ff;color:#86198f;border-color:#f5d0fe;}
.dtp-root .mp.ro{background:#f1f5f9;color:#475569;border-color:#e2e8f0;}

/* ===== section blocks ===== */
.dtp-root .dt-block{border:1px solid var(--border);border-radius:16px;overflow:hidden;margin-bottom:18px;background:#fff;
  box-shadow:0 10px 26px -22px rgba(15,23,42,.5);}
.dtp-root .dt-block-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;
  background:linear-gradient(180deg,#f8fafc,#eef2ff);border-bottom:1px solid var(--border);}
.dtp-root .dt-block-head .t{display:flex;align-items:center;gap:9px;font-size:.82rem;font-weight:800;color:#312e81;
  text-transform:uppercase;letter-spacing:.5px;}
.dtp-root .dt-block-head .t .ic{width:14px;height:14px;border-radius:5px;flex:none;}
.dtp-root .dt-block-head .sub-total{font-size:.78rem;font-weight:800;color:#15803d;white-space:nowrap;}
.dtp-root .dt-table{width:100%;font-size:.8rem;border-collapse:collapse;}
.dtp-root .dt-table thead th{font-size:.6rem;text-transform:uppercase;letter-spacing:.5px;color:#475569;font-weight:800;
  background:#dbeafe;padding:9px 12px;text-align:left;border-bottom:1px solid #bfdbfe;white-space:nowrap;}
.dtp-root .dt-table thead th.num{text-align:right;}
.dtp-root .dt-table tbody td{padding:9px 12px;border-bottom:1px solid #f1f5f9;color:var(--primary);vertical-align:top;}
.dtp-root .dt-table tbody td.num{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.dtp-root .dt-table tbody tr:hover{background:#f8fafc;}
.dtp-root .dt-table tbody tr:last-child td{border-bottom:none;}
.dtp-root .dt-table tfoot td{padding:10px 12px;font-weight:800;background:#0f172a;color:#fff;}
.dtp-root .dt-table tfoot td.num{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.dtp-root .dt-table tfoot td.grand{color:#fde047;white-space:nowrap;}
.dtp-root .dt-recon td{background:#fffbeb;border-top:1px dashed #f59e0b;color:#92400e;}
.dtp-root .dt-recon td.num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;text-align:right;font-weight:700;}
.dtp-root .dt-recon .dt-sub{color:#b45309;}
.dtp-root .dt-info td{background:#f8fafc;color:var(--secondary);font-style:italic;}
.dtp-root .dt-info td.num{font-style:normal;}
.dtp-root .dt-table td.pax{text-align:right;white-space:nowrap;}
.dtp-root .px{display:inline-block;border-radius:6px;padding:1px 6px;margin-left:3px;font-size:.66rem;font-weight:800;
  background:#eef2ff;color:#3730a3;border:1px solid #e0e7ff;}
.dtp-root .px.c{background:#fef3c7;color:#92400e;border-color:#fde68a;}
.dtp-root .dt-calc{font-size:.63rem;font-weight:600;color:#64748b;margin-top:2px;white-space:nowrap;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
.dtp-root .dt-table tfoot .dt-calc{color:#cbd5e1;font-weight:600;white-space:normal;text-align:left;}
.dtp-root .dt-note{padding:9px 16px;font-size:.68rem;color:#64748b;background:#f8fafc;border-top:1px dashed var(--border);}
.dtp-root .dt-sub{font-size:.66rem;color:var(--secondary);margin-top:2px;line-height:1.35;font-weight:400;font-style:normal;}
.dtp-root .dt-empty{padding:26px 16px;text-align:center;color:var(--secondary);font-size:.8rem;}

/* ===== fact box and result block ===== */
.dtp-root .cs-facts{display:grid;grid-template-columns:repeat(4,1fr);gap:0;
  border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:18px;background:#fff;}
@media (max-width:900px){.dtp-root .cs-facts{grid-template-columns:repeat(2,1fr);}}
.dtp-root .cs-fact{display:flex;align-items:baseline;gap:8px;padding:11px 14px;
  border-right:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;}
.dtp-root .cs-fact .l{font-size:.63rem;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#64748b;white-space:nowrap;}
.dtp-root .cs-fact .v{font-size:.86rem;font-weight:700;color:var(--primary);}
.dtp-root .cs-result{display:flex;justify-content:flex-end;margin:6px 0 4px;}
.dtp-root .cs-result table{border-collapse:collapse;min-width:min(420px,100%);font-size:.84rem;}
.dtp-root .cs-result td{padding:10px 16px;border:1px solid var(--border);color:var(--primary);}
.dtp-root .cs-result td.num{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:700;white-space:nowrap;}
.dtp-root .cs-result tr.hi td{background:#eef2ff;font-weight:800;color:#312e81;}
.dtp-root .cs-result tr.pl td{background:#0f172a;color:#fff;font-weight:800;}
.dtp-root .cs-result tr.pl td.profit-pos{color:#86efac;}
.dtp-root .cs-result tr.pl td.profit-neg{color:#fca5a5;}
`
