import { scanSymbol } from '../lib/scan';
import { ALWAYS_INCLUDE } from '../config/universe';
const RANK: Record<string, number> = { du_dieu_kien: 0, cho_xac_nhan: 1, dang_theo_doi: 2, thieu_du_lieu: 3 };
const L: Record<string, string> = { du_dieu_kien: 'ĐỦ ĐIỀU KIỆN', cho_xac_nhan: 'CHỜ XÁC NHẬN', dang_theo_doi: 'ĐANG THEO DÕI', thieu_du_lieu: 'THIẾU DỮ LIỆU' };
async function main() {
  const rows: any[] = [];
  for (const s of ALWAYS_INCLUDE) {
    const r = await scanSymbol(s);
    for (const tf of ['15m','1h','4h','1d'] as const) {
      const x = r.reads?.[tf]; if (!x) continue;
      rows.push({ sym: r.symbol, price: r.price, r: x });
    }
  }
  rows.sort((a,b)=> RANK[a.r.setup_status]-RANK[b.r.setup_status] || b.r.score-a.r.score);
  const c: Record<string,number> = {};
  for (const x of rows) c[x.r.setup_status]=(c[x.r.setup_status]??0)+1;
  console.log('TỔNG:', Object.entries(c).map(([k,v])=>`${L[k]} ${v}`).join(' · '), `| ${rows.length} setup`);
  for (const x of rows.slice(0, 12)) {
    const p = x.r.plan ?? x.r.prospect;
    console.log(`\n${x.sym} ${x.r.tf}  ${L[x.r.setup_status]}  ${x.r.bias}  điểm ${x.r.score.toFixed(1)}/7  lớp ${x.r.layer}`);
    console.log(`  vùng ${x.r.val}–${x.r.vah} · POC ${x.r.poc[0]}–${x.r.poc[1]} · giá ${x.price}`);
    if (p) console.log(`  ${x.r.plan?'KẾ HOẠCH':'dự kiến'}: vào ${p.entry[0]}–${p.entry[1]} · cắt ${p.sl} · chốt ${p.tp1}/${p.tp2} · R:R ${p.rr1}/${p.rr2} · phí ${p.feeR}R · R sau phí ${p.rrNet}`);
    if (x.r.missing_conditions.length) console.log(`  còn thiếu: ${x.r.missing_conditions.join(' | ')}`);
  }
}
main().catch(e=>{console.error(e);process.exit(1)});
