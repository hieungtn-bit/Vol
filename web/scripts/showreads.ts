/** In hợp đồng API mới cho vài mã. Chạy: npx tsx scripts/showreads.ts ENAUSDT BTCUSDT */
import { scanSymbol } from '../lib/scan';

async function main() {
  const syms = process.argv.slice(2).filter((s) => /USDT$/.test(s));
  for (const sym of syms.length ? syms : ['ENAUSDT']) {
    const s = await scanSymbol(sym);
    console.log(`\n===== SAU · ${s.symbol} giá ${s.price} =====`);
    for (const tf of ['1d', '4h', '1h', '15m'] as const) {
      const r = s.reads[tf];
      if (!r) { console.log(JSON.stringify({ tf, read: null })); continue; }
      console.log(JSON.stringify({
        tf: r.tf, state: r.state, bias: r.bias, layer: r.layer,
        poc: r.poc, vah: r.vah, val: r.val, score: r.score,
        gate: r.gate, plan: r.plan,
      }));
      console.log('     ' + r.state_text);
      if (!r.plan) console.log('     xem lại: ' + r.watch);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
